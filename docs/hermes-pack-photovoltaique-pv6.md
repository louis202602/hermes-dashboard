# Pack Photovoltaïque Hermès — LOT PV-6

**La visite technique : le moment où le terrain confirme, ou infirme, ce qui a été déclaré.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 signature, 0 acompte, 0 paiement, 0 fournisseur, 0 Consuel, 0 Enedis.**

---

## 1. Le trou, mesuré avant d'être traité

```sql
select column_name from information_schema.columns
 where table_schema='hermes_os' and table_name='pv_sites'
   and (column_name like '%verif%' or column_name like '%visit%');
-- → AUCUNE LIGNE
```

`pv_sites` ne portait **aucun champ de vérification**. Les six données qui
déterminent la puissance, la production et donc le prix — surface exploitable,
azimut, inclinaison, état de couverture, ombrage, accès — étaient saisies au
bureau et jamais confrontées au terrain.

PV-5 en avait fait la base d'un **engagement contractuel**. Pire : les deux PDF
que Hermès produit **promettaient déjà cette visite** — la synthèse d'étude
(« sous réserve de … visite technique … ») et le devis (« L'exécution reste
soumise à la visite technique préalable … »).

Le système promettait une visite technique que rien n'implémentait. PV-6 la pose.

---

## 2. La règle centrale : la mesure n'écrase jamais la déclaration

C'est la propriété structurante du lot.

Une valeur relevée sur le toit **ne remplace pas** la valeur saisie au bureau.
Les deux coexistent, l'écart est nommé, et c'est un humain qui décide.

```
Déclaré 80 m²   ·   Mesuré 62 m²   ·   Écart -18 m²   ·   Statut : Bloquant
                                                        [ Appliquer au site ]
```

Preuve structurelle, pas déclaration d'intention : **une seule fonction de tout
le lot écrit dans `pv_sites`**, `apply_pv_survey_measurement`. Aucun déclencheur
ne le fait, aucune saisie de relevé ne le fait, le moteur d'écarts ne le fait
pas. Une assertion découpe le SQL des cinq migrations par fonction et compte les
écritures : il doit y en avoir exactement une, et elle doit porter ce nom.

L'application est **confirmée** (case à cocher « APPLIQUER »), **champ par
champ** (liste close de neuf champs côté base), et **auditée** avec son
avant/après dans `entity_audit_log` :

```
mesure de visite technique appliquee au site : roof_area_usable_m2 (80.00 -> 50.00)
```

---

## 3. Les mesures sont des colonnes, pas un blob

`pv_site_surveys` porte **15 colonnes typées** de mesure — `numeric(10,2)`,
`numeric(6,2)`, `integer`, vocabulaires contraints par `CHECK`. Une seule colonne
`jsonb`, `metadata`, et elle est le **complément**, jamais la source.

La raison n'est pas esthétique : une surface cachée dans du JSON ne peut être ni
contrainte, ni indexée, ni comparée par une règle déterministe — et c'est
exactement ce qu'on veut faire d'elle.

Les vocabulaires mesurés sont **alignés sur `pv_sites`** :

| Grandeur | Vocabulaire |
|---|---|
| Type de couverture | `PENTE` `TERRASSE` `MULTIPENTE` `SHED` `COURBE` `SOL` `OMBRIERE` `AUTRE` |
| État de couverture | `BON` `MOYEN` `MAUVAIS` `INCONNU` |
| Ombrage | `AUCUN` `FAIBLE` `MODERE` `FORT` |
| Difficulté d'accès | `FACILE` `MOYEN` `DIFFICILE` `TRES_DIFFICILE` |

Deux échelles différentes pour la même grandeur auraient exigé une table de
traduction que personne n'aurait maintenue, et la comparaison déclaré/mesuré
serait devenue une approximation.

---

## 4. Les seuils sont des données, pas des nombres magiques

```sql
create table hermes_os.pv_survey_thresholds (
  tenant_id text references hermes_os.tenants(tenant_id) on delete cascade,
  code text not null, value numeric not null, unit text not null, description text not null
);
```

`tenant_id` **nullable** : `NULL` = défaut global, une ligne par tenant surcharge.
Un nouveau tenant hérite des défauts sans qu'on ait rien à semer — c'est le piège
classique d'une table « réglages » qui n'aurait que des lignes par tenant.

| Code | Défaut | Ce que ça veut dire |
|---|---|---|
| `AZIMUTH_REVIEW_DEG` | 10 ° | au-delà, une revue est demandée |
| `AZIMUTH_BLOCKING_DEG` | 30 ° | au-delà, le productible retenu n'est plus défendable |
| `TILT_REVIEW_DEG` | 5 ° | au-delà, une revue est demandée |
| `TILT_BLOCKING_DEG` | 15 ° | au-delà, le calcul de production est faux |
| `USABLE_AREA_REVIEW_PCT` | 10 % | écart relatif demandant une revue |
| `USABLE_AREA_BLOCKING_PCT` | 25 % | écart rendant l'implantation irréalisable en l'état |
| `ROOF_AREA_REVIEW_PCT` | 15 % | écart de surface totale demandant une revue |
| `HEIGHT_INFO_M` | 6 m | au-delà, les moyens d'accès sont signalés (information) |
| `CABLE_DISTANCE_REVIEW_M` | 50 m | au-delà, la chute de tension mérite une revue |

**Ces valeurs sont un point de départ défendable, pas une vérité métier.** Elles
sont là pour être discutées et ajustées par tenant ; aucune n'est déduite d'un
modèle. Deux paliers par grandeur permettent de dire « regardez ça » sans arrêter
une affaire pour trois degrés.

Une assertion vérifie qu'**aucun de ces codes ni aucune de ces valeurs** n'est
recopié dans l'UI ou dans les actions serveur : la divergence silencieuse entre
ce que l'écran annonce et ce que la base applique est fermée structurellement.

---

## 5. Le moteur d'écarts : déterministe, documenté, sans IA

Dix règles, écrites en SQL, lisant les seuils en base. Le même relevé produit
toujours les mêmes écarts — assertion T37, deux exécutions comparées.

| Code | Règle | Gravités possibles |
|---|---|---|
| `USABLE_AREA_MISMATCH` | écart relatif de surface exploitable | `REVIEW` / `BLOCKING` |
| `ROOF_AREA_MISMATCH` | écart relatif de surface totale | `REVIEW` |
| `AZIMUTH_MISMATCH` | écart **circulaire** d'azimut | `REVIEW` / `BLOCKING` |
| `TILT_MISMATCH` | écart d'inclinaison | `REVIEW` / `BLOCKING` |
| `ROOF_TYPE_MISMATCH` | couverture constatée ≠ déclarée | `REVIEW` |
| `ROOF_CONDITION_ISSUE` | couverture `MOYEN` / `MAUVAIS` | `REVIEW` / `BLOCKING` |
| `SHADING_MISMATCH` | classe d'ombrage ; **2 crans vers le pire** | `REVIEW` / `BLOCKING` |
| `ACCESS_BLOCKED` | accès au toit `IMPOSSIBLE` | `BLOCKING` |
| `HEIGHT_ACCESS_NOTICE` | hauteur au-delà du seuil | `INFO` |
| `ELECTRICAL_PANEL_ISSUE` | tableau dégradé ou 0 module libre | `REVIEW` |
| `EARTHING_ISSUE` | prise de terre observée absente | `REVIEW` |
| `CABLE_ROUTE_ISSUE` | cheminement au-delà du seuil | `REVIEW` |
| `STRUCTURAL_CONCERN` | site `DEGRADE` / `CRITIQUE` | `REVIEW` / `BLOCKING` |
| `ASBESTOS_SUSPICION` | suspicion relevée | `REVIEW` — **jamais bloquant d'office** |

### L'azimut est circulaire

```sql
select least(abs(a - b), 360 - abs(a - b));
```

350° et 10° sont distants de **20°**, pas de 340°. Sans cela, une correction de
plein nord signalerait un écart énorme là où il n'y en a presque pas.

### La régénération ne détruit pas une analyse humaine

Les écarts sont recalculés à chaque saisie. Mais une **résolution** déjà posée
n'est pas effacée — sinon chaque frappe au clavier annulerait le travail
d'arbitrage. L'`on conflict … do update` ne touche ni `resolution`, ni
`resolved_by`, ni `resolved_at`, et la suppression des écarts devenus caducs est
bornée par `and f.resolution is null`.

### L'amiante est un constat, jamais un diagnostic

Hermès ne produit **aucun diagnostic amiante** : la réglementation impose un
opérateur certifié et un rapport dédié. Le champ enregistre une **suspicion de
terrain**, le commentaire de colonne le dit, l'écran le dit à l'endroit où l'on
coche, et le PDF le répète en mention encadrée. Même logique pour la prise de
terre : `earthing_observed` est une observation visuelle, pas un contrôle
réglementaire.

---

## 6. La machine à états : en données, et ce qu'elle interdit

15 chemins dans `pv_survey_transitions`. Ce qu'elle **n'a pas** est aussi
important que ce qu'elle a :

- `PLANNED → VALIDATED` — **absent**. On ne valide pas une visite qui n'a pas eu lieu.
- `BLOCKING → VALIDATED` — **absent**. Un blocage se lève par le terrain
  (`BLOCKING → IN_PROGRESS`) ou par une revue (`BLOCKING → NEEDS_REVIEW`), jamais
  par un changement de statut.
- `VALIDATED → *` — **absent**. Une preuve terrain validée ne se déjuge pas ; on
  planifie une nouvelle visite. Le relevé est gelé par déclencheur.

`set_pv_survey_status` **refuse explicitement** `VALIDATED` (`USE_VALIDATION_FACADE`) :
la validation a sa propre façade, qui porte la garde humaine.

L'écran ne redéclare pas cette machine : `get_pv_site_survey` renvoie
`next_statuses`, lu dans la table de transitions elle-même.

### Un agent ne valide jamais

`pv_human_validation_guard('status','VALIDATED','validated_by','validated_at')` —
la garde de PV-1, **réutilisée paramétrée**, la même qui protège l'étude, le
chiffrage et l'acceptation d'un devis. Elle refuse quand `auth.uid()` est NULL
(runner, `service_role`), quand l'acteur ou l'horodatage manque, ou quand l'acteur
déclaré n'est pas l'appelant. `SECURITY DEFINER` **ne la contourne pas** :
`auth.uid()` lit le jeton de la requête, pas le propriétaire de la fonction.

Vérifié en base, messages réels :

```
PV_VALIDATION_NON_HUMAINE: pv_site_surveys ne peut pas atteindre VALIDATED sans utilisateur authentifié
PV_VALIDATION_USURPEE: validated_by doit être l'utilisateur authentifié appelant
```

Et une visite ne peut pas être validée avec un **écart bloquant non résolu**
(`BLOCKING_FINDINGS_UNRESOLVED`) : sinon la preuve terrain dirait le contraire de
ce qu'elle a constaté.

---

## 7. L'impact devis : deux niveaux, et rien de cassé silencieusement

C'était la contrainte la plus délicate du lot : introduire une garde nouvelle
sans faire basculer d'un coup tous les dossiers existants en « non prêts ».

**Niveau 1 — signalement.** L'absence de visite et la visite non validée sont des
`PV_ADVISORIES`, pas des exigences. Le dossier reste `READY_FOR_OFFER`, on peut
préparer un brouillon de devis, l'alerte est visible.

**Niveau 2 — garde dure, ciblée sur le devis.** `pv_quote_blockers` — **une seule
source**, étendue et non dupliquée — ajoute trois codes :

| Code | Quand |
|---|---|
| `SITE_SURVEY_REQUIRED` | aucune visite sur ce site |
| `SITE_SURVEY_NOT_VALIDATED` | une visite existe, non validée |
| `SITE_SURVEY_BLOCKING` | une visite a constaté un empêchement |

Conséquence : un devis ne peut plus passer `READY`, être transmis, ni produire un
PDF `FINAL` sans visite validée. La **création d'un brouillon reste possible** —
`create_pv_quote` ne consulte pas la porte.

**Un devis déjà `SENT` ou `ACCEPTED` n'est jamais modifié.** Rien ne le relit pour
le changer : statut et total restent intacts (assertion T54, vérifiée sur un
devis réel à 5 400,00 €). Il affiche en revanche l'alerte — c'est le but : si la
visite découvre un problème après l'envoi, le commercial doit le savoir, et la
seule voie de correction reste la **révision**.

**Un blocage prime sur une validation antérieure.** Corrigé par `pv6_3b` : la
première version de la porte testait `VALIDATED` avant `BLOCKING`, si bien qu'une
visite validée en mars masquait une visite d'octobre constatant un toit devenu
impraticable. Le blocage se lève par un geste déclaré (`BLOCKING → IN_PROGRESS`
ou `BLOCKING → CANCELLED`), jamais par oubli.

**L'étude n'est jamais modifiée automatiquement.** Si une mesure change le
dimensionnement, c'est à l'utilisateur de réviser l'étude : l'historique
`VALIDATED` reste intact.

---

## 8. L'écran : des libellés, pas seulement des couleurs

Le tableau comparatif porte cinq colonnes :

```
Élément | Déclaré | Mesuré | Écart | Statut
```

Le **statut est textuel** — « Conforme », « À revoir », « Bloquant »,
« Non mesuré » — et la couleur ne fait que redire ce que le mot dit déjà. Un
lecteur daltonien lit la même information ; une impression noir et blanc aussi.

**« Non mesuré » n'est jamais « Conforme ».** Deux situations différentes, deux
libellés : confondre les deux affirmerait une vérification qui n'a pas eu lieu.

La gravité affichée **vient de la base**. L'écran ne redécide pas d'une
sévérité : il affiche celle que le moteur a produite.

Écrans livrés :

- `components/dashboard/PvSurveysPanel.tsx` — bloc « Visite technique » de la vue
  Affaire, avec l'état de la preuve terrain en une phrase.
- `components/dashboard/PvSurveyEditor.tsx` — écran dédié : relevés (toiture,
  implantation/électricité, conditions), comparatif, écarts et leur résolution,
  application d'une mesure, suites possibles, validation, rapport PDF.
- `app/(dashboard)/etudes/visites/[surveyId]/page.tsx` — route, **dans
  `solar.studies`**, même garde que le reste du module. Aucun menu parallèle.

Aucun `tenant_id` n'existe dans une URL, un formulaire ou un argument client.

---

## 9. Le rapport de visite technique (PDF)

`Rapport de visite technique photovoltaïque` — **ce n'est pas un devis** : aucun
prix, aucun montant, aucune signature électronique. Une mention encadrée le dit
en tête, le pied de page le répète sur chaque page.

- Une visite non validée porte un **bandeau** « VISITE NON VALIDÉE — CONSTAT
  PROVISOIRE » et un tampon d'angle.
- Les photos sont **référencées par leur nom**, pas incorporées : un rapport de
  40 Mo qu'aucune messagerie n'accepte n'aide personne, et les photos restent
  consultables dans Hermès derrière une URL signée.
- Le verdict est écrit **en toutes lettres** : « BLOQUANTE — 1 écart(s)
  bloquant(s) non résolu(s). La pose est impossible en l'état. »
- Traçabilité : `request_id` (idempotence), SHA-256, taille, MIME, chemin privé
  borné au tenant, `survey_id`. Moteur PDF partagé de PV-5, **zéro dépendance**.

---

## 10. Ce que ce lot ne fait pas

Signature électronique · acompte · paiement · facturation client · fournisseurs ·
commandes · stock · Consuel · Enedis · mise en service · SAV · n8n · cron ·
scheduler · capacité d'agent · IA.

`PV_ACTIONS_ENABLED = NO`, `AGENT_4_ACTIVATED = NO`, `AGENT_5_ACTIVATED = NO`.
Les trois capacités `pv.*` restent désactivées, aucun consumer n'est actif, et
les **13 requêtes QUEUED** sont intactes.

---

## 11. Preuves

| Preuve | Résultat |
|---|---|
| `db/tests/pv6_site_survey.test.sql` | **65 / 65 PASS** |
| `tests/pv6-survey.test.ts` | **33 / 33 PASS** |
| `tests/pv6-survey-pdf.test.ts` | **20 / 20 PASS** |
| Suite complète `npm test` | **938 / 938 PASS** |
| `npm run lint` · `typecheck` · `build` | propres |
| Mutation testing | **2 / 2 mutants tués** |
| Rollback en transaction annulée | 4 tables + 11 façades retirées, PV-5 restauré et appelable, **0 objet de stockage supprimé** |
| Équivalence fichier ↔ production | 5 / 5 migrations identiques (commentaires exclus), MD5 comparés |

### Deux défauts trouvés par les tests

1. **La porte masquait un blocage postérieur.** Trouvé en écrivant l'assertion
   T55. Corrigé par `pv6_3b`, dans un **fichier séparé** — `pv6_3` était déjà
   appliquée, et on ne réécrit pas une migration appliquée.
2. **Le rapport imprimait « ?18 m² ».** Le moins typographique `−` (U+2212) et le
   `≠` (U+2260) n'existent pas dans WinAnsi ; le moteur les remplaçait
   silencieusement par `?`. L'écran affichait donc une chose et le rapport une
   autre. Corrigé en ASCII et par le mot « différent » ; une assertion vérifie
   désormais qu'aucun `?` n'apparaît dans le PDF décodé.

---

## 12. Rappel de sécurité

**Leaked Password Protection : `BLOCKED_EXTERNAL`.** Le réglage n'est pas
accessible depuis cette session. Rien n'est simulé, rien n'est contourné.

> Supabase → Authentication → **activer Leaked Password Protection** avant le
> premier pilote réel.
