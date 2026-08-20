# Pack Photovoltaïque Hermès — LOT PV-3

**Exploitation manuelle complète : documents réels, purge, étude et chiffrage à la main, widgets.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 ligne métier PV, 0 objet dans le bucket.**

PV-1 a posé le modèle, PV-2 les portes. Il restait un trou honnête : **on ne
pouvait rien faire sans agent IA.** Pas de fichier déposable, pas d'étude
créable, pas de chiffrage saisissable. PV-3 ferme ce trou — et **sans activer
quoi que ce soit**.

---

## 1. Documents : le flux réel

```
prepare_pv_document   →   upload SERVEUR   →   finalize_pv_document
   (la base attribue         (les octets          (le chemin, le MIME
    l'id ET le chemin)        transitent par        et la taille sont
                              le serveur)           REVALIDÉS)
```

**Le navigateur ne choisit rien de ce qui compte.** Ni le tenant, ni le bucket,
ni le chemin. Aucun formulaire ne porte de champ `path`, `bucket` ou `tenant` —
c'est une assertion testée. Le chemin est construit par la base :
`<tenant>/<site>/<document>/<nom assaini>`.

Trois refus **avant** qu'un octet soit écrit : MIME hors allowlist, taille
au-delà de 25 Mo, site hors du tenant. Si l'upload réussit mais que la
finalisation refuse le chemin, l'objet reste **orphelin et non référencé** —
jamais rattaché à une donnée métier.

Un **SHA-256** est calculé côté serveur sur les octets réellement reçus.
Empreinte d'**intégrité**, pas de sécurité : elle permet de constater qu'un
document a changé, elle n'authentifie personne.

Téléchargement : **URL signée 300 s**, produite à la demande, jamais persistée.

## 2. Purge — la seule façon correcte

PV-2 savait marquer un document supprimé mais pas retirer les octets. Or
Postgres **refuse** toute suppression directe dans `storage.*`
(`storage.protect_delete()` → `ERROR 42501`). La purge est donc un geste en
**trois temps, dans cet ordre exact** :

1. `list_pv_documents_to_purge()` — lister (tenant-scopé, délai de grâce 7 jours)
2. suppression via **l'API Storage**, côté serveur
3. `mark_pv_document_purged()` — enregistrer

**L'ordre n'est pas interchangeable.** Marquer avant d'effacer rendrait l'objet
définitivement orphelin : plus aucune ligne ne porterait son chemin, donc plus
personne ne saurait qu'il existe. Un test de mutation le vérifie.

**Idempotente** : rejouée, elle ne trouve plus rien. Un document déjà purgé
répond `ALREADY_PURGED`, jamais une erreur. **Bornée au tenant** : la liste vient
d'une façade tenant-scopée, et chaque chemin est re-vérifié avant suppression.

Après purge : `storage_path` devient NULL, `purged_path` conserve l'ancien chemin
pour l'audit, et la **ligne d'inventaire survit** — un document purgé reste traçable.

## 3. Rollbacks corrigés — un défaut, trois fichiers

Le défaut trouvé au lot PV-2 touchait **deux** fichiers de plus qu'annoncé :

| Fichier | État |
|---|---|
| `20260818_photo_studio_9_rollback.sql` | **corrigé** — l'instruction faisait échouer tout le rollback |
| `20260813_hermes_chat_attachments_9_rollback.sql` | **corrigé** — ligne exécutable, même défaut |
| `20260819_pv2_9_rollback.sql` | déjà exempt ; sa note est mise à jour |

Deux tests structurels **dépôt-wide** l'interdisent désormais : aucun
`*_rollback.sql` — et plus largement aucune migration — ne peut contenir
`delete from storage.buckets` ni `delete from storage.objects`.

Aucune autre modification n'a été apportée au Pack Photo.

## 4. Vérification humaine de la consommation

**Aucune évolution de schéma n'a été nécessaire** — vérifié en base, pas supposé :
`pv_consumption_profiles` portait déjà `verification_status`, `verified_by`,
`verified_at` et la garde `pv_human_validation_guard` depuis PV-1. Il ne manquait
que la façade. On n'ajoute pas une colonne pour le plaisir d'en ajouter.

`verify_pv_consumption_profile` suit le même contrat que la facture, l'étude et
le chiffrage : `verified_by = auth.uid()`, imposé server-side. Un runner
`service_role` n'a pas d'`auth.uid()` : il ne peut **structurellement pas** produire
`VERIFIED`.

## 5. Machines à états — le raccourci qui était encore ouvert

PV-1 avait donné une machine à états pilotée par données au **prospect** mais
laissé `pv_studies.status` et `pv_economics.status` sous simple `CHECK` :
n'importe quel chemin entre deux statuts valides passait, y compris
**`DRAFT → VALIDATED`**. Tant que seules des façades de validation existaient, le
trou restait théorique. PV-3 ouvre la création manuelle : il devient réel.

`pv_status_transitions` (31 chemins, une seule table pour les deux entités) +
`pv_status_guard()`. Le déclencheur **lit** la table, il ne code aucun chemin.

Ce qui est **refusé** : `DRAFT → VALIDATED`, `DRAFT → VERIFIED`, tout chemin
sortant de `SUPERSEDED`, tout chemin sortant de `VALIDATED` sauf `SUPERSEDED`.
Ce qui reste **ouvert** : les chemins réellement empruntés par PV-2
(`CALCULATED → VALIDATED`, `CALCULATED → VERIFIED`) — compatibilité vérifiée.

## 6. Étude et chiffrage à la main

| Geste | Façade | Statut produit |
|---|---|---|
| Créer une étude | `upsert_pv_study` | **`DRAFT`**, `prepared_by = MANUAL` |
| Modifier une étude | `upsert_pv_study` | inchangé |
| Hypothèses typées | `upsert_pv_study_assumptions` | — |
| Avancer l'étude | `set_pv_study_status` | tout **sauf** `VALIDATED` |
| Valider l'étude | `validate_pv_study` (PV-2) | `VALIDATED` + acteur |
| Créer un chiffrage | `upsert_pv_economics` | **`DRAFT`**, `computed_by = MANUAL` |
| Avancer le chiffrage | `set_pv_economics_status` | tout **sauf** `VERIFIED` |
| Vérifier le chiffrage | `verify_pv_economics` (PV-2) | `VERIFIED` + acteur |

Les façades de statut **refusent explicitement** `VALIDATED` et `VERIFIED`
(`USE_VALIDATION_FACADE`). Sans ce refus, elles seraient une porte dérobée
contournant l'inscription de l'acteur.

**La version d'étude est calculée EN BASE** (`max + 1` sur le site) — pas proposée
par le client, sinon deux onglets ouverts produiraient deux « version 1 ».

**Aucun chiffre n'est déduit.** Le reste à charge et le temps de retour sont
saisis, pas calculés en douce : un chiffre montré au client doit avoir été posé
par quelqu'un.

## 7. Widgets — gardés par le MODULE, pas par une capacité

Trois widgets : **Études à valider** · **Factures énergie à vérifier** ·
**Prospects sans site**.

Le registre existant gagne un troisième portillon, `requiredModule`, et voici
pourquoi il fallait l'ajouter plutôt que réutiliser `requiredCapabilityPrefix` :
un préfixe de capacité exige une capacité **active** au catalogue. Les trois
capacités `pv.*` sont volontairement `enabled = false` — un widget gardé par
`"pv."` n'aurait **jamais** été visible, y compris chez un tenant solaire. Le bon
portillon est le **module** `solar.studies`, accordé par `quotes + worksites`,
indépendamment de toute activation d'IA.

**FAIL-CLOSED** : un appelant qui ne fournit pas la liste des modules **ferme** le
widget. Les trois appelants d'`availableWidgetIds` ont été câblés — dont la
galerie de réglages, sinon un tenant photo y aurait vu « Études à valider »
proposée alors qu'il ne peut pas l'afficher.

**COST-FIRST** : les trois lisent **un seul** instantané partagé
(`get_pv_pilot_snapshot`). Trois widgets ne font jamais trois lectures.

## 8. Audit — la brique existante, rien de plus

`entity_audit_log` est réutilisée. Trois déclencheurs ajoutés couvrent ce qui ne
l'était pas : création et modification d'étude, de chiffrage, de profil de
consommation. Par **déclencheur** plutôt que par façade, pour qu'une écriture SQL
directe soit tracée elle aussi.

Anti-doublon : quand le statut atteint la valeur validée, la garde de validation
humaine a déjà écrit l'entrée — on ne la redouble pas. Le journal resterait vrai,
mais deviendrait illisible.

Gestes tracés : dépôt de document · suppression logique · **purge** · validation
de consommation · création/modification d'étude · validation d'étude ·
création/modification de chiffrage · vérification de chiffrage.

## 9. Sécurité — inchangée, et re-testée

Tenant résolu server-side · **aucune façade avec paramètre `tenant_id`** ·
FK composites · RLS deny-all · aucune lecture directe · `SECURITY DEFINER` ·
`search_path` verrouillé · `auth.uid()` pour toute validation humaine ·
**aucun paramètre d'acteur** sur aucune signature.

Dix assertions tenant A / tenant B portent sur les **nouvelles** façades.

## 10. Ce que PV-3 ne construit pas

Devis · contrats · factures clients · paiements · fournisseurs · commandes ·
stock · planning chantier · Consuel · Enedis · mise en service · réception ·
SAV · avis client · PVGIS réel · OpenSolar réel · téléphone · e-mails réels ·
n8n · activation d'agent.

Une assertion échoue si l'un de ces mots réapparaît dans la surface PV-3.

## 11. Rollback

```sql
\i db/migrations/20260820_pv3_9_rollback.sql
```

Retire les 9 façades PV-3, la table de transitions, les deux gardes, les trois
déclencheurs d'audit et les colonnes de purge. **Préserve** PV-1, PV-2, le bucket,
les capacités dormantes et les Phases 1 et 2.

⚠️ **Perte de traçabilité assumée** : `purged_at` / `purged_path` disparaissent.
Un document dont les octets ont réellement été purgés redeviendrait indiscernable
d'un document jamais purgé — et son `storage_path` est déjà NULL, donc le
`SET NOT NULL` du rollback **échouerait**. C'est voulu : l'échec vaut mieux qu'un
silence. Contrôle préalable :

```sql
select count(*) from hermes_os.pv_documents where purged_at is not null;
```
