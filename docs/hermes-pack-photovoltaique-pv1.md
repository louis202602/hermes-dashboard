# Pack Photovoltaïque Hermès — LOT PV-1 : modèle de données métier

**Statut : SCHÉMA APPLIQUÉ · `GO_LIVE = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` · `N8N_TOUCHED = NO`**

Ce lot construit la couche métier photovoltaïque native d'Hermès. Il ne fait rien
d'autre : ni devis, ni facture client, ni paiement, ni Consuel, ni raccordement, ni
commande fournisseur, ni planning, ni réception, ni SAV, ni avis client, ni PVGIS en
production, ni UI, ni consumer n8n, ni activation d'agent.

---

## 1. Pourquoi ce lot

L'audit read-only du 2026-08-19 a établi, requête à l'appui, que le schéma `hermes_os`
(178 tables) ne contenait **aucune** colonne photovoltaïque :

```sql
select table_name, column_name from information_schema.columns
where table_schema='hermes_os'
  and column_name ~* 'kwc|panneau|onduleur|toitur|inclin|ombrag|orient|pvgis|consuel|
      raccord|autoconsom|surplus|edf|production_estim|batterie|solar|photovolt';
→ []   -- 0 ligne
```

Les **Agents 4 et 5 existent et sont actifs dans n8n**, mais ils étaient **orphelins** :
aucune table ne pouvait recevoir leur sortie. Ce lot leur donne une destination — sans
les activer.

---

## 2. Les 9 tables

| Table | Rôle | Parent |
|---|---|---|
| `pv_prospects` | Prospect (particulier / pro / industriel / agricole) | — |
| `pv_prospect_transitions` | Machine à états, **pilotée par données** | — |
| `pv_sites` | Site d'implantation (1..n par prospect) | `pv_prospects` |
| `pv_consumption_profiles` | Profil de consommation du site | `pv_sites` |
| `pv_energy_bills` | Facture d'énergie : document source + **valeurs retenues** | `pv_sites` |
| `pv_energy_bill_extractions` | Ce que l'IA a **lu**, avec sa confiance | `pv_energy_bills` |
| `pv_studies` | Étude PV versionnée | `pv_sites` |
| `pv_study_assumptions` | Hypothèses **en colonnes typées** (1:1) | `pv_studies` |
| `pv_economics` | Chiffrage économique | `pv_studies` |

### Machines à états

**Prospect** — table `pv_prospect_transitions`, 33 chemins déclarés. Ajouter un chemin
= insérer une ligne, jamais modifier du code.

```
NEW ─→ CONTACTED ─→ QUALIFYING ─→ QUALIFIED ─→ STUDY_REQUESTED ─→ STUDY_DELIVERED ─→ WON
 │         │             │            │               │                  │            │
 └→ UNQUALIFIED ←────────┘            └───────────────┴──────────────────┴─→ LOST     └→ ARCHIVED
 └→ ON_HOLD ⇄ (reprise vers tout état actif)
```

`NEW → WON` est **refusé** : on ne gagne pas une affaire qu'on n'a jamais qualifiée.

**Facture** `RECEIVED → EXTRACTED → NEEDS_REVIEW → VERIFIED | REJECTED`
**Étude** `DRAFT → CALCULATED → NEEDS_REVIEW → VALIDATED | REJECTED | SUPERSEDED`
**Économie** `DRAFT → CALCULATED → NEEDS_REVIEW → VERIFIED | REJECTED`
**Consommation** `UNVERIFIED → NEEDS_REVIEW → VERIFIED | REJECTED`

---

## 3. L'invariant central : l'IA ne s'auto-valide jamais

Ce n'est pas une consigne de prompt, c'est un **déclencheur de base de données**
(`pv_human_validation_guard`) opposable à tout écrivain — façade, migration, runner n8n,
ou requête SQL directe :

1. `auth.uid()` NULL ⇒ **refus**. Un runner en `service_role` n'a pas d'identité
   authentifiée : il ne peut structurellement pas valider.
2. `verified_by` / `validated_by` doit être **l'utilisateur authentifié appelant
   lui-même**. On ne valide pas au nom d'autrui.
3. Contrainte `CHECK` complémentaire : l'état validé exige acteur **et** horodatage.
4. FK `verified_by → auth.users(id)` : l'acteur est un compte réel.

Vérifié : une étude `prepared_by = 'AGENT_5'` en `CALCULATED` **ne peut pas** passer
`VALIDATED` sans qu'un humain identifié le fasse.

**Trois autres garde-fous structurels** : `tenant_id` immuable ; FK **composites**
`(tenant_id, parent_id)` — un site ne peut pas référencer le prospect d'un autre tenant ;
`ON DELETE RESTRICT` sur les chaînes porteuses de données.

---

## 4. Agent 4 — Analyse Facture EDF IA

> **NON ACTIVÉ. Workflow n8n NON MODIFIÉ. Non connecté.** Ce qui suit est le contrat
> que le lot PV-2 câblera, pas un état actuel.

**Lira** : `pv_energy_bills` (document : bucket + chemin, jamais d'URL), `pv_sites`
(contexte), `pv_prospects` (tenant).

**Pourra proposer de remplir** : `pv_energy_bill_extractions` **uniquement** —
fournisseur, périodes, montants HT/TTC, consommation kWh, puissance souscrite, option
tarifaire, PDL, `confidence` (obligatoire, 0–1), `field_confidence`, `raw_output`.

**Ne pourra JAMAIS écrire** : les colonnes retenues de `pv_energy_bills`, ni son
`status`, ni `verified_by` / `verified_at`.

**Chemin sanctionné** : `pv_promote_bill_extraction(extraction_id)` — exige un humain
authentifié membre du tenant, recopie les valeurs vers la facture et la place en
**`NEEDS_REVIEW`**. Elle ne met **jamais** `VERIFIED` : promouvoir et certifier sont
deux gestes distincts.

**Restera obligatoirement à valider humainement** : le passage en `VERIFIED`, donc toute
consommation ou tout montant qui alimentera ensuite une étude et un chiffrage client.

| Étape | Acteur | Écrit |
|---|---|---|
| Dépôt du document | humain / portail | `pv_energy_bills` (`RECEIVED`) |
| Lecture du document | **Agent 4** | `pv_energy_bill_extractions` + confiance |
| Promotion | **humain authentifié** | facture ⇒ `NEEDS_REVIEW` |
| Certification | **humain authentifié** | facture ⇒ `VERIFIED` |

---

## 5. Agent 5 — Bureau d'Études PV IA

> **NON ACTIVÉ. Workflow n8n NON MODIFIÉ. Non connecté.**

**Lira** : `pv_sites` (surface, azimut, inclinaison, ombrage — tous **numériques**,
donc directement exploitables par un moteur de calcul), `pv_consumption_profiles`,
`pv_energy_bills` **en `VERIFIED` uniquement**, `pv_study_assumptions`.

**Pourra préparer** : `pv_studies` avec `prepared_by = 'AGENT_5'`,
`pv_study_assumptions`, `pv_economics` avec `computed_by = 'AGENT_5'`.

**Devra rester en `DRAFT` / `CALCULATED` / `NEEDS_REVIEW`** : toute étude et tout
chiffrage produits par l'agent. `VALIDATED` et `VERIFIED` lui sont structurellement
inaccessibles.

**Validations humaines obligatoires** : passage de l'étude en `VALIDATED`, passage du
chiffrage en `VERIFIED`. Ce sont les deux seuls états qui autorisent une transmission au
client — c'est là que se situe le risque contractuel.

**Hypothèses en colonnes, jamais en blob** : prix de l'énergie, inflation, horizon,
actualisation, dégradation panneaux, pertes système, prix de rachat du surplus, aides,
TVA. Un chiffre présenté à un client doit pouvoir être remonté à une hypothèse nommée et
requêtable. `extra_assumptions` (jsonb) est un **complément**, jamais la source.

---

## 6. Sécurité et isolation

| Garantie | Mise en œuvre | Vérifiée |
|---|---|---|
| `tenant_id` NOT NULL + FK `tenants` | 9 tables | T3 |
| Aucun lien inter-tenant | FK **composites** `(tenant_id, id)` | T1b |
| `tenant_id` immuable | déclencheur `pv_tenant_immutable` | T2 |
| RLS deny-all | 9 tables, **0 policy** | RLS |
| Aucun accès direct | `REVOKE ALL … FROM anon, authenticated` | T1 |
| Statuts contraints | `CHECK` sur chaque table | T4 |
| Transitions contrôlées | table + déclencheur | T5 |
| Pas d'auto-validation IA | déclencheur + `CHECK` + FK `auth.users` | T6, T7, T8 |
| Pas de perte silencieuse | `ON DELETE RESTRICT` | T9 |
| Audit | brique **existante** `entity_audit_log` réutilisée | AUDIT |
| Documents | (bucket privé, chemin), URL interdite par `CHECK` | — |

**Accès applicatif** : aucune façade n'est créée dans PV-1 — donc **aucun chemin de
lecture applicatif n'existe encore**. C'est volontaire : les façades sont le lot PV-2,
et une table sans façade est une table que personne ne peut lire.

---

## 7. Ce qui reste à faire (PV-2 et au-delà)

1. **Façades `SECURITY DEFINER`** `public.get_pv_*` / `upsert_pv_*`, scopées tenant.
2. **Bucket privé `hermes-pv-documents`** + RLS `storage.objects` (patron
   `hermes-chat-attachments`). PV-1 pose le contrat de colonnes, pas le bucket.
3. **Capacités `agent_action_catalog`** `pv.*` — créées **désactivées**, avec politiques
   SW15 `ACTIVE` **avant** activation (leçon de la Phase 1).
4. **Consumers n8n** — bloqué tant que le quota n8n Cloud l'est.
5. **UI** Prospects / Site / Étude.
6. **PVGIS** (API publique gratuite de la Commission européenne) — à préférer à
   OpenSolar tant que le volume ne le justifie pas.
