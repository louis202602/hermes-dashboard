# Hermès — ordre de merge et ordre d'application des migrations

Trois PR empilées, une seule ligne. **L'ordre n'est pas une préférence : il est
imposé par le graphe.**

## 1. Graphe réel

```
main 7d0f0440
  └── #59  OAuth serveur + filtre d'intégrations en base
        └── #60  moteur dynamique construit ET câblé
              └── #61  5 briques Studio + coûts téléphone
```

Chaîne **linéaire** : chaque branche contient sa base. Vérifié par
`git merge-base --is-ancestor` dans les trois sens.

**Conséquence : aucun conflit possible.** Les fichiers touchés par plusieurs PR
(`lib/verticals/modules.ts`, les six catalogues i18n, `profiles.ts`) le sont
**séquentiellement**, pas en parallèle.

`SAFE_MERGE_ORDER = #59 → #60 → #61`

Merger #60 avant #59 embarquerait #59 dans sa diff. Merger #61 avant #60 est
impossible : sa base est #60.

> **Rebase après merge ?** Non. Si chaque PR est mergée dans l'ordre, `main`
> avance d'un cran à chaque fois et la suivante devient automatiquement
> mergeable. Une PR mergée en *squash* romprait ce chaînage — merge classique
> ou rebase, mais pas squash.

## 2. Ordre d'application des migrations

Sept migrations préparées, **aucune appliquée**. Dépendances établies par
analyse (FK, `%rowtype`, triggers, appels de fonction) :

| # | Migration | Dépend de |
| :-- | :-- | :-- |
| 1 | `20260819_photo_studio_6_acquisition` | lot 1 (appliqué) |
| 2 | `20260819_photo_studio_7_phone` | lot 6 (`photo_leads`, `photo_service_offerings`) |
| 3 | `20260820_photo_studio_8_commerce` | lot 6 + lot 1 |
| 4 | `20260820_photo_studio_10_phone_costs` | lot 7 (`photo_calls`) |
| 5 | `20260819_hermes_integrations_1_connections` | `tenants` (appliqué) |
| 6 | `20260819_hermes_integrations_2_phone_provisioning` | **lot 7** + integrations_1 |
| 7 | `20260820_hermes_tenant_selection_1` | aucune (autonome) |

> ⚠️ **Le lien à ne pas manquer** : `hermes_integrations_2` appartient à **#59**
> mais dépend de `photo_studio_7`, qui vit sur `main` et **n'est pas appliqué**.
> Merger #59 seul puis appliquer ses migrations **échouerait**. Le lot 7 doit
> être appliqué d'abord — ou les migrations d'intégration attendre.

**Conflits de noms entre lots préparés : aucun.** Vérifié par intersection des
tables et fonctions créées.

## 3. Après application : renseigner les verticales

`tenants.vertical` est **NULL** par défaut et le filtre d'intégrations est
fail-closed : tant qu'elle n'est pas renseignée, **aucun fournisseur n'est
autorisé**, même Google Calendar. C'est voulu, et le code d'erreur le dit
(`TENANT_VERTICAL_UNKNOWN`) plutôt que de renvoyer une liste vide.

## 4. Rollbacks

Les sept migrations ont leur rollback, et la couverture est **vérifiée
automatiquement** : chaque table, fonction, trigger et colonne créés est
retrouvé dans le fichier d'annulation correspondant.

Deux exceptions **délibérées**, documentées dans les fichiers :

* les colonnes ajoutées à des tables **préexistantes** (`tenants.vertical`,
  `photo_upsell_opportunities.offering_id`) sont retirées — jamais la table ;
* les lignes déjà écrites dans `sw19_cost_events` **ne sont pas effacées** : ce
  sont des faits comptables, pas des objets de schéma.

## 5. Pages Studio restant à construire

Les cinq modules de commerce sont **déclarés sans route** (`route: null`), donc
rendus au menu en bouton désactivé « bientôt disponible » — jamais un lien qui
mène à un 404. Un test vérifie l'équivalence dans les deux sens.

| Route | Module | Contenu attendu |
| :-- | :-- | :-- |
| `/prospects` | `crm.prospects` | file de leads, score, relances dues |
| `/agenda` | `agenda` | disponibilités, séances planifiées |
| `/devis` | `photo.quotes` | devis, contrats, signatures |
| `/paiements` | `photo.payments` | acomptes, soldes, échéances |
| `/telephone` | `phone` | appels, appels manqués, coûts |
| `/campagnes` | `campaigns` | campagnes, dépense, CAC |
| `/galeries` | `photo.gallery` | galeries livrées, vues, commandes |
| `/portail` | `photo.portal` | administration des accès client |
| `/upsell` | `photo.upsell` | offres complémentaires, taux d'acceptation |
| `/fidelisation` | `photo.lifecycle` | opportunités de cycle de vie |
| `/documents` | `documents` | contrats, factures, pièces |
| `/biens` `/vendeurs` `/acquereurs` `/visites` | `immo.*` | verticale immobilier |
| `/etudes` | `solar.studies` | verticale solaire |
