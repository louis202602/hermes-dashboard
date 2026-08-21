# Un seul migrateur production à la fois

> `ONE_PRODUCTION_MIGRATOR_AT_A_TIME = TRUE` — `MIGRATION_LOCK_MODE = COOPERATIVE`

## Pourquoi ce document existe

Le 2026-08-19, trois travaux ont touché la même base Supabase en quelques heures :

| heure (UTC) | qui | quoi |
|---|---|---|
| 13:22 | session « pack photovoltaïque » | PV-1 appliqué en production |
| 13:30 | idem | fichiers commités — **8 minutes après** l'application |
| 15:56 | — | PR #64 mergée |
| 16:10 → 16:14 | idem | PV-2 appliqué : 5 migrations en 4 minutes |
| 16:11 | session « gouvernance » | audit de la même base, **en cours** |

Personne n'a mal agi. Chaque session a fait exactement ce qu'on lui demandait.
Le problème n'est pas la faute, c'est la **cécité mutuelle** : aucune des deux
sessions ne pouvait savoir que l'autre écrivait. Une session qui mesure un écart
pendant qu'une autre le crée mesure du bruit ; une session qui applique un lot
pendant qu'une autre modifie le même schéma joue à pile ou face.

Le verrou ne rend pas les migrations plus sûres. Il rend l'occupation **visible**.

## Ce que le verrou fait, et ce qu'il ne fait pas

**Il ne peut pas empêcher une écriture.** Le mode est coopératif : il n'y a pas
d'`event trigger` DDL. Un migrateur qui ne consulte pas le verrou passera au
travers sans rien casser et sans rien savoir. C'est un choix assumé — une
interception globale de tout le DDL production est un objet à poser sur une base
au repos, avec un plan de repli, pas au détour d'une mission.

Ce qu'il apporte est plus modeste et suffit aujourd'hui :

* une session peut **savoir** qu'une autre est en train de migrer ;
* elle peut le savoir **avant** d'écrire, pas après ;
* un verrou abandonné (session morte, container recyclé) **se reprend tout seul**
  après son TTL, et laisse une trace de la reprise.

## Garanties structurelles

| Règle | Comment elle tient |
|---|---|
| `ONE_ACTIVE_LOCK_MAX` | `primary key (lock_id)` + `check (lock_id = 'PRODUCTION')`. La table **ne peut pas** contenir deux lignes. Aucun code ne peut se tromper. |
| `TTL_REQUIRED` | `check (expires_at > acquired_at)` et `expires_at <= acquired_at + interval '2 hours'`. Un verrou éternel est refusé par la base, pas par la fonction. |
| `EXPIRED_LOCK_CAN_BE_RECLAIMED` | `acquire_…()` archive le détenteur périmé en `…_lock_history` avec `RECLAIMED_AFTER_EXPIRY`, **puis** reprend. |
| Pas de course | `pg_advisory_xact_lock` sérialise les acquisitions : la seconde session reçoit un verdict, pas une erreur de contrainte. |
| Aucune capacité métier | RLS deny-all, `revoke all … from public, anon, authenticated`, aucune façade `public`. Ce n'est pas une fonctionnalité du produit. |
| `base_sha` réel | `check (base_sha ~ '^[0-9a-f]{40}$')`. On ne peut pas verrouiller en déclarant « main » : ce mot ne désigne rien deux heures plus tard. |

## La procédure — `BEFORE_ANY_PRODUCTION_DB_WRITE`

À appliquer par tout Claude, Codex ou migrateur Hermès, sans exception.
**Si une étape échoue : STOP.** On ne passe pas à la suivante, on ne contourne pas.

```
1. PULL / FETCH MAIN
   git fetch origin --prune

2. VÉRIFIER LE SHA
   git rev-parse origin/main
   → c'est le base_sha à déclarer à l'étape 4. Un SHA de 40 hexadécimaux :
     « main » et « HEAD » ne désignent rien deux heures plus tard.

3. LANCER LE GARDE-FOU DE DÉRIVE
   select hermes_os.migration_baseline_summary();
   select * from hermes_os.migrations_since_baseline();
   → node scripts/check-migration-drift.mjs      (code 1 = STOP)

4. ACQUÉRIR LE VERROU
   select hermes_os.acquire_production_migration_lock(
            '<qui>', '<mission>', '<sha40>', <ttl_minutes>);
   → STOP_CONCURRENT_MIGRATION  ⇒ STOP, ne pas écrire
   → ACQUIRED_AFTER_EXPIRY      ⇒ lire l'avertissement AVANT d'écrire : la
                                  migration précédente peut être incomplète

5. RELIRE LA VERSION DE LA BASE
   select max(version) from supabase_migrations.schema_migrations;
   → si elle a bougé depuis l'étape 3 : relâcher le verrou et reprendre à 1.
     Ce n'est pas de la paranoïa — c'est exactement ce qui s'est produit le
     2026-08-20 à 06:38, où une migration est arrivée pendant l'installation
     de ce verrou.

6. APPLIQUER
   Une migration = un fichier dans db/migrations/, commité AVANT ou AVEC
   l'application. Le nom appliqué doit être EXACTEMENT le nom du fichier privé
   de son préfixe `YYYYMMDD_` et de `.sql`.

7. VALIDER
   Les assertions du lot, dans une transaction annulée.

8. RELÂCHER LE VERROU
   select hermes_os.release_production_migration_lock('<qui>');
   Même si la migration a échoué. Un verrou qu'on abandonne bloque les autres
   jusqu'à son TTL.
```

Si le verrou est occupé : **`STOP_CONCURRENT_MIGRATION`**. On ne force pas, on ne
contourne pas, on attend ou on prévient.

## La ligne de base réellement posée

Installée le **2026-08-20 à 06:38:07 UTC**, après PV-1 et PV-2 :

| | |
|---|---|
| `cutoff_version` | `20260820063740` |
| migrations en héritage | **205** |
| première migration soumise à la règle | `20260820063807` |

Tout ce qui précède ce cutoff est de la dette documentée et **ne bloque rien**.
Tout ce qui suit doit avoir un fichier.

### Le garde-fou a servi dans la minute

Deux secondes après la pose de la ligne de base, `pv3_1_status_machines` a été
appliquée par une autre session, sans fichier au dépôt. Premier passage réel du
garde-fou :

```
STOP_UNVERSIONED_DB_DRIFT
1 migration(s) appliquee(s) apres la ligne de base 20260820063740
sans fichier declarant :
  - 20260820063809 pv3_1_status_machines
```

Il a laissé passer `hermes_migration_governance_3_baseline` — qui a son fichier —
et arrêté l'autre. C'est le comportement voulu, vérifié sur un cas non fabriqué.
Cela illustre aussi la limite du mode coopératif, énoncée plus haut : le garde-fou
**constate**, il n'empêche pas. PV-3 n'a consulté ni le verrou ni la règle, et
n'avait aucun moyen de les connaître.

## Dette historique — ce qui ne bloque pas

Sur ~203 migrations appliquées à cette base, la grande majorité n'a **aucun**
fichier dans le dépôt. Ce n'est pas un accident isolé : c'est le mode de
fonctionnement qui a prévalu jusqu'ici.

Une règle naïve — « toute migration sans fichier = STOP » — bloquerait Hermès
définitivement et serait désactivée le lendemain. Un garde-fou qu'on contourne ne
protège rien. On sépare donc :

* **`LEGACY_BASELINE`** — tout ce qui était appliqué au moment où la règle est
  posée. Photographié une fois dans `hermes_os.migration_baseline`. Documenté,
  **non bloquant**, résorbable quand on voudra, migration par migration.
* **`NEW_UNVERSIONED_DRIFT`** — tout ce qui est appliqué **après**. Doit avoir un
  fichier déclarant. Sinon `STOP_UNVERSIONED_DB_DRIFT`.

La frontière est `cutoff_version`, une comparaison de chaînes horodatées. Elle est
**exacte** : aucune migration ne peut « passer pour » de l'héritage.

Le rapprochement nom-de-fichier ↔ nom-de-migration est lui aussi **strict**, et
c'est délibéré. PV-1 en donne le cas d'école : le fichier
`20260819_pv1_2_functions.sql` déclare `pv1_2_functions`, alors que la base a
enregistré `pv1_2_functions_guards`. Un rapprochement « intelligent » aurait
absorbé l'écart en silence ; l'égalité stricte le montre. C'est le genre de
détail qui, cumulé, fait qu'un dépôt cesse d'être une source de vérité.

## Fichiers

| Fichier | Rôle |
|---|---|
| `db/migrations/20260820_hermes_migration_governance_1_lock.sql` | tables du verrou + historique |
| `db/migrations/20260820_hermes_migration_governance_2_functions.sql` | acquérir / relâcher / consulter |
| `db/migrations/20260820_hermes_migration_governance_3_baseline.sql` | photo de la dette + lecture des migrations postérieures |
| `db/migrations/20260820_hermes_migration_governance_9_rollback.sql` | démontage complet |
| `lib/db/migrationDrift.ts` | classement legacy / dérive, pur, testable hors ligne |
| `scripts/check-migration-drift.mjs` | étape 1 de la procédure, fail-closed |
| `tests/migration-drift-guard.test.ts` | contrat du verrou + du classement |

## Limites connues, dites franchement

* **Coopératif** : contournable par qui ne regarde pas. Voir plus haut.
* **`migration_baseline` n'est pas rejouable** : son contenu dépend de l'instant
  où on l'applique. C'est son objet — dater une frontière. Le marqueur singleton
  empêche une seconde photo, mais un rollback puis une réapplication déplacerait
  la frontière à la date du jour et ferait basculer en héritage tout ce qui s'est
  appliqué entre-temps. À ne faire qu'en connaissance de cause.
* **Le script ne se connecte pas à la base** : l'accès production passe par
  l'outil de l'agent. Le script reçoit l'état et rend le verdict. Le prix est une
  étape manuelle ; le gain est un classement testable hors ligne.
