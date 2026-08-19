# Hermès Studio — commerce, portail client et fidélisation

État : **architecture + moteurs + migrations préparées**. Rien d'appliqué, rien
d'activé, aucun message envoyé, aucun paiement, aucune réservation.
`GO_LIVE = NO`.

---

## 1. Ce qui existait déjà — et qui n'est donc pas réécrit

L'audit a précédé le code. Ces briques sont **réutilisées telles quelles** :

| Existant | Ce qu'il apporte aux 5 briques |
| :-- | :-- |
| `photo_upsell_opportunities` | kind · status · score · `revenue_generated_eur` — **étendue**, pas remplacée |
| `photo_service_offerings` (lot 6) | **LE catalogue**. Les prix ne viennent que d'ici |
| `photo_leads` + `photo_lead_events` (lot 6) | cycle du prospect + compteur anti-spam |
| `photo_followups_due()` (lot 6) | 6 motifs de relance, plafonds déjà encodés en SQL |
| `photo_client_members` | `relation`, `birth_month`, `birth_year` → source du cycle de vie |
| `photo_media_consent` | `status`, `expires_at` → le portillon de contactabilité |
| `photo_sessions` | `status = BOOKED`, `quote_amount_eur`, `deposit_paid_eur` |
| `sw15_*` | approbations humaines |
| `sw19_cost_events` / `sw23_*` | coûts et budgets par tenant |
| `photo_calls.status = ABANDONED` (lot 7) | l'appel manqué |

**10 tables neuves seulement**, là où il en manquait vraiment.

---

## 2. Brique 1 — la réservation ne se décrète pas

Le risque réel : un agent affirme « c'est noté, le 14 juin est à vous » avec une
assurance parfaite et zéro paiement derrière.

Trois barrières indépendantes :

1. **Provenance.** `canConfirmBooking` n'accepte qu'un fait `VERIFIED`, daté
   **et** référencé. Un acompte « déclaré payé » ne vaut rien.
2. **Contraintes de table.** `photo_payment_paid_is_verified` et
   `photo_contract_signature_traceable` rendent l'état mensonger **impossible à
   stocker** — pas seulement impossible à afficher.
3. **Trigger.** La porte est rejouée en base, donc un webhook de paiement ou un
   runner n8n qui n'passe pas par Next.js la rencontre quand même.

Les obstacles sont rendus **tous à la fois**, pas un refus à la fois :
`WRONG_STATE`, `CONTRACT_NOT_SIGNED`, `SIGNATURE_NOT_TRACEABLE`,
`DEPOSIT_NOT_VERIFIED`, `DEPOSIT_INSUFFICIENT`, `DEPOSIT_AMOUNT_UNKNOWN`,
`HUMAN_APPROVAL_MISSING`, `DATE_NOT_AVAILABLE`, `DATE_AVAILABILITY_UNKNOWN`.

> **Acompte** : `computeDeposit` renvoie une **erreur** plutôt qu'un montant par
> défaut. Un acompte de 0 € inventé confirmerait une réservation gratuite.

### Un trou trouvé par l'exécution, pas par relecture

La première sonde sur PG17 a montré qu'un `UPDATE` direct passait de
`QUOTE_SENT` à `BOOKING_CONFIRMED` : la porte finale existait, mais **la table
des transitions n'était pas rejouée en base**. Tous les états intermédiaires
étaient donc décoratifs côté SQL. Corrigé, re-testé, vérifié.

---

## 3. Brique 2 — relances et appels manqués

La garde anti-spam n'est pas dupliquée : c'est `canFollowUp` (lot 6), déjà
appliquée aussi en SQL. Deux ajouts seulement :

* **`MISSED_CALL`** comme motif à part entière — rattraper un appel ne consomme
  pas le quota d'une relance de devis, et inversement.
* **Cadence configurable**, qui ne peut que **resserrer** : `min_hours ≥ 72`,
  `max_total ≤ 3`, `max_per_reason ≤ 1`. Les CHECK le garantissent, donc une
  configuration trop permissive est rejetée par la base, pas seulement par
  l'application.

La décision sépare l'**interne** du **sortant** :

```
appel ABANDONED
   ├─ lead créé / mis à jour     ← TOUJOURS. Aucune autorisation requise.
   └─ contact                     ← opposition, autorisation SMS, anti-spam
        opted_out        → NONE
        SMS non autorisé → PREPARE_CALLBACK
        quota épuisé     → PREPARE_CALLBACK
        sinon            → SEND_SMS
```

Le pire cas n'est jamais « on a perdu l'appel » : Vanessa le voit et rappelle.

---

## 4. Brique 3 — le portail client

Un client du studio n'a ni compte, ni tenant, ni permission. Le portail repose
donc sur un **jeton de portée** `(tenant_id, client_id)` — jamais une identité.

* **Double appartenance** vérifiée ressource par ressource. Le bon tenant ne
  suffit pas.
* **Liste blanche de champs.** Le portail n'en connaît qu'une liste finie : une
  colonne ajoutée demain à `photo_clients` n'apparaît pas par accident.
  `notes`, `lead_score`, `lifetime_value_eur`, `crm_external_id` n'existent pas
  pour lui.
* Jeton **stocké en empreinte SHA-256**, `expires_at` **NOT NULL** — un lien
  éternel finit par circuler.
* Une section vide n'est pas affichée : pas d'onglet « Galerie » devant un
  client qui attend ses photos.

C'est un **module de la verticale photographie**, pas une seconde application.

---

## 5. Brique 4 — upsell et parrainage

`buildUpsellProposals` ne peut pas inventer :

* le **produit** vient d'une règle écrite par Vanessa ;
* le **prix** vient de `photo_service_offerings` ;
* une offre **sans prix** produit `amountEur: null` et `quotable: false` — jamais
  une estimation ;
* plafond de propositions **inconnu ⇒ on ne propose rien**.

Les refus sont rendus **avec leur motif** : une règle silencieuse serait
indiagnosticable.

`upsell_offered` ne compte pas les `DETECTED` : **détecter n'est pas proposer**.
Aucune proposition ⇒ `conversionRate = null`, jamais 0 %.

**Parrainage** : le lien est toujours écrit (il documente l'origine du lead) ;
la récompense est conditionnelle. Sans règle configurée, `rewardEur = null` — on
ne promet pas un montant.

---

## 6. Brique 5 — cycle de vie, et la ligne à ne pas franchir

C'est la brique la plus rentable, et la plus dangereuse. « Grossesse » et
« naissance » sont des données de santé et de vie familiale. Écrire à une femme
au sujet d'une grossesse **déduite**, après une fausse couche, est exactement le
message qu'aucun système ne doit envoyer.

> **On ne déduit jamais un événement.** On ne chaîne que depuis un fait que la
> cliente a elle-même posé.

Deux ancres, et deux seulement — la contrainte SQL le garantit :

| Ancre | Pourquoi elle est légitime |
| :-- | :-- |
| `SESSION_DELIVERED` | la cliente est venue, a payé, sait ce qu'elle a photographié |
| `MEMBER_BIRTH` | elle a elle-même déclaré la naissance |

`INFERRED_PREGNANCY` et tout équivalent sont **rejetés par la base**.

**Limite dite, pas contournée** : `photo_client_members` ne stocke que
`birth_month` + `birth_year` (minimisation RGPD). Les échéances sont donc
précises au **mois**, et le moteur renvoie `precision: "MONTH"` au lieu de
fabriquer un jour.

Une opportunité non contactable est **tout de même rendue**, avec
`contactAllowed: false` et `nextAction: "ASK_HUMAN"` : Vanessa la voit, Hermès
n'écrit pas.

---

## 7. KPI — l'invention rendue impossible

Chaque indicateur déclare sa **source réelle** (table + colonne) et sa formule.
Un indicateur sans source ne compile pas.

**Un dénominateur nul rend `null`, jamais 0.** « 0 % d'acceptation de devis »
quand aucun devis n'est parti est un chiffre faux — et un chiffre faux dans un
tableau de bord est pire qu'une case vide, parce qu'on décide dessus.
Un ratio > 100 % rend `null` aussi : c'est le signe de deux populations
différentes.

---

## 8. Menu Studio — composé, jamais écrit en dur

Les 5 briques deviennent 5 modules du `MODULE_REGISTRY` : `photo.quotes`,
`photo.payments`, `photo.portal`, `photo.upsell`, `photo.lifecycle`. Le menu
cible du brief est l'`moduleOrder` de la verticale `photography` — c'est de la
**mise en page**, chaque entrée restant soumise à l'activation réelle du module
chez le tenant.

---

## 9. Ce qui reste bloqué

| Bloqué | Par quoi |
| :-- | :-- |
| Application des lots 6, 7 et 8 | ton autorisation |
| Prestataire de signature | non choisi — `signature_method` est prêt, l'intégration non |
| Prestataire de paiement | non choisi — `provider_reference` est prêt, le webhook non |
| Pages `/devis`, `/paiements`, `/portail`, `/upsell`, `/fidelisation` | non construites (modules déclarés « bientôt ») |
| `photo_calls` → `sw19_cost_events` | raccordement à préparer |
| Câblage du moteur de verticales | PR #60, non mergée |
