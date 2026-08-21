# Pack Photovoltaïque Hermès — LOT PV-7

**L'approvisionnement matériel : ce qu'il faut, ce qui est commandé, ce qui est
arrivé — et l'écart entre les trois, montré et non caché.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 email fournisseur, 0 API fournisseur, 0 webhook,
> 0 paiement, 0 stock physique automatique.**

---

## 1. Le trou, mesuré avant d'être traité

```sql
select table_name from information_schema.tables
 where table_schema='hermes_os'
   and (table_name like 'pv_%material%' or table_name like 'pv_%supplier%'
        or table_name like 'pv_%purchase%' or table_name like 'pv_%commande%');
-- → AUCUNE LIGNE
```

À la fin de PV-6, Hermès savait qu'un devis était **accepté** et qu'une visite
était **validée**. Il ne savait rien de ce qu'il fallait **acheter** pour tenir
cet engagement. Entre « le client a signé » et « le chantier peut démarrer », il
manquait le seul objet qui décide de la date réelle : le matériel.

PV-7 pose la chaîne **besoin → fournisseur → commande → réception**, et rien de
plus.

---

## 2. La règle centrale : structuré → consolidable ; texte libre → confirmation humaine

C'est la propriété structurante du lot, et elle est **contre-intuitive** : la
tentation serait de deviner. Une ligne de devis « Pose de panneaux » ne dit pas
qu'il faut 24 panneaux de 425 Wc. Le deviner produirait une commande fausse avec
l'apparence de l'exactitude.

`pv_derive_requirements_from_quote` ne fait donc **que des correspondances
exactes** : la désignation de la ligne est égale au libellé d'un article du
catalogue, ou égale à son SKU. Tout le reste est créé comme **besoin en texte
libre** portant `needs_confirmation = true`.

```
Ligne de devis                         → Besoin
« PAN-425-N »            (= SKU)       → Panneau 425 Wc            [structuré]
« Panneau 425 Wc »       (= libellé)   → Panneau 425 Wc            [structuré]
« Pose de panneaux »     (rien)        → « Pose de panneaux »      [À CONFIRMER]
```

Un besoin non confirmé n'est pas ignoré : il **bloque** le passage en `READY`
du matériel et **rend la marge non fiable**. Le système ne devine pas, mais il
n'oublie pas non plus.

La dérivation depuis la visite technique obéit à la même règle, en plus strict :
sur les dix familles d'écarts de PV-6, **trois seulement** ont une conséquence
matérielle univoque (`CABLE_ROUTE_ISSUE`, `ELECTRICAL_PANEL_ISSUE`,
`HEIGHT_ACCESS_NOTICE`), et les trois produisent du texte libre à confirmer.

---

## 3. L'écart est montré, jamais absorbé

Sept statuts, calculés en base par `pv_material_balance`, jamais par le
navigateur ni par le service :

| Statut | Signification |
|---|---|
| `NOT_ORDERED` | besoin identifié, rien de commandé |
| `PARTIALLY_ORDERED` | commandé < besoin |
| `ORDERED` | commandé ≥ besoin, rien reçu |
| `PARTIALLY_RECEIVED` | reçu > 0 et < besoin |
| `RECEIVED` | reçu = besoin |
| `OVER_ORDERED` | reçu > besoin |
| `SHORTAGE` | plus rien en attente et le besoin n'est pas couvert |

`SHORTAGE` est le statut qui compte. Il apparaît quand toutes les commandes sont
soldées — reçues ou annulées — et qu'il manque quand même de la matière. C'est
exactement le cas qu'un tableau naïf efface : commande « terminée », besoin non
couvert. Ici, la commande peut être `RECEIVED` et l'élément `SHORTAGE` : les deux
vérités coexistent parce qu'elles portent sur deux objets différents.

Le cas obligatoire du cahier des charges — besoin 30, commandé 30, reçu 24 — rend
`PARTIALLY_RECEIVED` avec **6 manquants affichés**, et la commande n'est **pas**
considérée comme terminée.

---

## 4. `ORDERED` = un humain déclare. Hermès n'envoie rien.

C'est le malentendu le plus coûteux que ce lot pouvait produire, et il est fermé
**structurellement**, pas par une note :

* aucune des six migrations ne contient, **commentaires exclus**, `http`,
  `net.`, `webhook`, `smtp`, `n8n` (les seules occurrences du dépôt sont des
  commentaires qui disent précisément qu'il n'y en a pas) ;
* ni le service, ni les actions serveur, ni les deux écrans ne contiennent
  `fetch(`, `nodemailer`, `sendMail`, `n8n` ;
* une assertion de contrat balaie ces cinq surfaces et échoue à la première
  occurrence.

Le geste est le même qu'en PV-5 pour « devis marqué envoyé » : l'écran affiche
**à l'endroit du clic** que « Hermès n'envoie rien », et l'action exige une
confirmation explicite `COMMANDER` — pas une case cochée par inadvertance.

---

## 5. La machine à états est en données, et refuse les raccourcis

`pv_purchase_order_transitions`, 10 lignes. Ce qui n'y figure **pas** est aussi
important que ce qui y figure :

```
DRAFT ──▶ READY ──▶ ORDERED ──▶ PARTIALLY_RECEIVED ──▶ RECEIVED
  │         │          │                                  (terminal)
  └─────────┴──────────┴──▶ CANCELLED
```

* `DRAFT → RECEIVED` : **absent**. On ne reçoit pas ce qu'on n'a jamais commandé.
* `DRAFT → PARTIALLY_RECEIVED`, `READY → RECEIVED` : **absents**, même raison.
* `RECEIVED` : **terminal**. Aucune transition n'en part.
* `ORDERED` : le contenu commercial se **fige** — article, quantité, prix, TVA.
  Une commande transmise ne se modifie plus silencieusement.

---

## 6. Le prix de vente n'est jamais écrasé par le prix d'achat

Aucune fonction du lot n'écrit dans `pv_quotes` ni `pv_quote_lines` — une
assertion découpe le SQL des six migrations et le vérifie. Le prix fournisseur
vit dans `pv_supplier_prices`, **daté** (`valid_from` / `valid_until`) : un prix
change, l'historique reste, et une commande passée hier n'est pas réécrite par un
tarif d'aujourd'hui.

### « MARGE MATÉRIELLE INDICATIVE », et rien de plus

Hermès ne connaît pas la main-d'œuvre, pas les frais de chantier, pas le
Consuel. Afficher une « marge réelle » serait un mensonge chiffré. Le libellé
est donc explicite, et le montant **disparaît** dès qu'un ingrédient manque :

```
Marge non calculable : aucun devis accepté.
Marge non calculable : 2 article(s) sans coût connu.
Marge non calculable : 1 article(s) sans coût connu et 3 besoin(s) non confirmé(s).
```

`margin_reliable` est décidé par `pv_material_costs` en base. Le service le
**recopie** ; il ne le recalcule pas.

---

## 7. `MATERIAL_READINESS` : trois états, une seule façon d'être prêt

`NOT_READY` · `PARTIAL` · `READY`.

`READY` exige **deux** conditions cumulatives :

1. tous les besoins **obligatoires** couverts par les quantités **reçues** —
   pas commandées, reçues ;
2. **zéro** besoin en attente de confirmation.

La seconde condition est celle qu'on oublie. Sans elle, un besoin en texte libre
jamais confirmé — donc jamais commandé — laisserait le chantier passer en
« prêt » avec un trou dedans.

---

## 8. La porte d'achat réutilise les portes existantes

`pv_purchase_blockers` ne réinvente rien : il rappelle `pv_survey_gate` (PV-6)
et lit l'état du devis (PV-5).

| Code | Ce qu'il empêche |
|---|---|
| `NO_LINE` / `TOTAL_NOT_POSITIVE` | commander du vide |
| `SUPPLIER_INACTIVE` | commander chez un fournisseur désactivé |
| `QUOTE_NOT_ACCEPTED` | engager de l'argent avant l'accord du client |
| `SITE_SURVEY_NOT_VALIDATED` / `SITE_SURVEY_BLOCKING` | acheter pour un toit qu'on n'a pas vu, ou qu'on a vu impraticable |
| `SURVEY_FINDINGS_UNRESOLVED` | acheter avec un écart bloquant non traité |

Un **DRAFT** d'approvisionnement reste préparable avant tout cela : préparer
n'est pas engager.

---

## 9. Numérotation sûre entre tenants et entre appels concurrents

`CMD-2026-000001`, servi par `next_pv_purchase_order_number(tenant, year)` sur
`pv_purchase_order_sequences` avec `insert … on conflict do update … returning` —
une opération atomique, sous verrou de ligne. Pas de `max(...)+1`, pas de
compteur navigateur. Deux onglets ouverts en même temps ne peuvent pas produire
deux fois `CMD-2026-000042`.

---

## 10. Permissions — décision documentée

Recevoir une livraison est un geste **d'atelier**, pas un geste d'administrateur.
Exiger `tenant.admin` pour pointer 24 palettes obligerait à partager un compte
d'administration — ce qui serait pire que le risque évité. Les 20 façades du lot
passent donc par `pv_guard()` (membre du tenant), comme PV-3 et PV-6. La seule
irréversibilité du Pack PV, la purge d'octets, reste réservée à `tenant.admin`
(PV-4).

Trois gestes exigent en revanche un **humain identifié** (`auth.uid()` non nul,
acteur = appelant) via la garde `pv_human_validation_guard` réutilisée de PV-1 :
passage en `READY`, passage en `ORDERED`, et enregistrement d'une réception
(`pv_purchase_receipt_guard`). Un agent ne peut faire aucun des trois.

---

## 11. Le défaut trouvé par les tests, et corrigé

**La réception était purement et simplement impossible.** Premier passage de la
suite SQL : 66/76, dix échecs en cascade.

Cause réelle, capturée en relevant le message d'erreur au lieu de le supposer :

```
PV_LIGNE_COMMANDE_FIGEE: le contenu commercial d'une commande passee est fige
```

`pv_purchase_order_lines.line_total_ht_eur` est une colonne
`generated always as (…) stored`. Dans un déclencheur **BEFORE UPDATE**,
PostgreSQL n'a pas encore calculé cette colonne : elle est **NULL dans `NEW`**
alors qu'`OLD` porte le total. La comparaison `to_jsonb(new) … is distinct from
to_jsonb(old) …` était donc **toujours vraie**, et le gel du contenu commercial
refusait **toute** mise à jour de ligne sur une commande passée — y compris celle
que fait le rollup de réception. Le garde-fou ne protégeait pas la commande : il
interdisait de recevoir.

Corrigé par la migration **`pv7_3b`**, dans un **fichier séparé** — `pv7_3` était
déjà appliquée, et on ne réécrit pas une migration appliquée. `line_total_ht_eur`
est exclue de la comparaison ; aucune garantie n'est perdue, puisque le total
dérive de `quantity` et `unit_price_ht_eur`, toutes deux toujours comparées.
Vérifié après correctif : réception partielle possible, sur-réception toujours
refusée, prix **et** quantité toujours figés.

---

## 12. Non-buts explicites de ce lot

Signature électronique, acompte, paiement, facture client, paiement fournisseur,
transmission réelle de commande (email ou API), planning de chantier complet,
équipes, Consuel, Enedis, mise en service, SAV : **rien de tout cela n'est
construit ici**, et rien ne le simule.

Un non-but a été découvert en cours de route et documenté plutôt que contourné :
**une fiche technique d'article ne peut pas être attachée**. `pv_documents.site_id`
est `NOT NULL` depuis PV-2, et un article de catalogue n'appartient à aucun site.
Assouplir cette contrainte pour une commodité aurait affaibli le cloisonnement de
PV-2. Les documents de PV-7 sont donc rattachés à une **commande**, qui a un site.

---

## Preuves

* **76 assertions SQL** (`db/tests/pv7_material_procurement.test.sql`), en
  transaction annulée, tenant synthétique — **76/76 PASS**.
* **33 assertions de contrat TS** (`tests/pv7-material.test.ts`) — **33/33 PASS**.
* **Mutation testing (6 mutations), toutes tuées** : brouillons comptés comme
  commandés ; readiness ignorant les besoins non confirmés ; porte n'exigeant
  plus de devis accepté ; journal d'audit parallèle introduit ; service
  recalculant un statut d'écart ; service recalculant la fiabilité de marge.
* **Rollback exécuté** dans une transaction annulée : 9 tables et 20 façades
  retirées, `get_pv_deal` restauré **avant** la suppression de
  `pv_material_readiness`, `pv_survey_gate` et les façades PV-6 **intactes**,
  0 objet de stockage supprimé, bucket intact.
* **Équivalence fichier ↔ production vérifiée** : le SQL de chaque migration du
  dépôt est identique (commentaires exclus) à celui réellement appliqué —
  empreintes MD5 comparées, **5/5 identiques**.
* **Dérive de migration = 0** (`scripts/check-migration-drift.mjs`, sortie 0).
* `npm run lint` · `npm run typecheck` · `npm test` (**972/972**) ·
  `npm run build` — **PASS**.

## Rappel de sécurité — non résolu, non simulé

**Leaked Password Protection** reste **désactivé** sur le projet Supabase. Ce
réglage n'est pas accessible en SQL ni par migration : il s'active dans
**Supabase → Authentication → Password protection**. À activer **avant le premier
pilote réel**. Statut : `BLOCKED_EXTERNAL`.
