# Pack Photovoltaïque Hermès — LOT PV-2

**Façades sécurisées, stockage privé, capacités dormantes, UI minimale.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 ligne métier PV en production.**

PV-1 avait construit le modèle de données et l'avait rendu inaccessible : RLS
deny-all, aucune policy, aucun `GRANT`. C'était volontaire — un schéma sans porte
ne fuit pas. PV-2 pose les portes, et seulement des portes contrôlées.

---

## 1. Le portillon : ce qui décide quoi

Trois décisions, trois endroits, **aucune redondance** :

| Question | Qui décide | Où |
|---|---|---|
| Cette page existe-t-elle pour ce tenant ? | moteur de verticales | `lib/verticals/*` (module `solar.studies`) |
| De quel tenant sont ces données ? | `resolve_active_tenant(null)` | `hermes_os.pv_guard()` |
| Cette écriture est-elle légitime ? | déclencheurs PV-1 | `pv_human_validation_guard`, `pv_prospect_status_guard`, `pv_tenant_immutable` |

### Décision explicite : pas de table `pv_module_activation`

La verticale photo possède `photo_studio_activation` parce qu'elle devait rester
**dormante**. PV-2 a l'objectif inverse : rendre PV-1 *utilisable*. Ajouter un
troisième registre d'activation aurait créé une deuxième vérité à synchroniser —
exactement ce que le moteur de verticales a supprimé.

Conséquence assumée **et testée** : un tenant photo qui appellerait les façades
en direct (hors UI) n'obtiendrait que **son propre espace PV, vide**. Aucune
fuite inter-tenant n'est possible — c'est le tenant résolu côté serveur qui borne,
pas l'écran.

---

## 2. Façades — 23 fonctions

Toutes : `SECURITY DEFINER`, `search_path` verrouillé, `REVOKE ALL FROM public`
puis `GRANT EXECUTE TO authenticated`. **Aucun `GRANT anon`. Aucun paramètre
`tenant_id`, sur aucune signature** — le navigateur n'a littéralement pas de
champ pour en proposer un.

### Lecture (11)

`get_pv_prospects` · `get_pv_prospect` · `get_pv_sites` · `get_pv_site` ·
`get_pv_consumption_profiles` · `get_pv_energy_bills` · `get_pv_bill_extractions` ·
`get_pv_studies` · `get_pv_study_assumptions` · `get_pv_economics` ·
`get_pv_documents`

Toutes bornées par `LIMIT` plafonné. Un identifiant appartenant à un autre tenant
renvoie `NOT_FOUND` — **le même code qu'un identifiant inexistant** : l'existence
de la ressource n'est jamais révélée, pas même par une erreur différente.

### Écriture humaine (9)

`upsert_pv_prospect` · `upsert_pv_site` · `upsert_pv_consumption_profile` ·
`set_pv_prospect_status` · `register_pv_energy_bill` · `promote_pv_bill_extraction` ·
`verify_pv_energy_bill` · `validate_pv_study` · `verify_pv_economics`

### Documentaire (3)

`prepare_pv_document` · `finalize_pv_document` · `soft_delete_pv_document`

### Ces façades n'assouplissent RIEN

`SECURITY DEFINER` ne donne aucun pouvoir de validation : `auth.uid()` lit la
revendication JWT de la **requête**, pas le propriétaire de la fonction. Les
déclencheurs PV-1 s'exécutent après la façade et refusent toujours un acteur
absent, nul, ou différent de l'appelant.

**Anti mass-assignment par construction** : les colonnes protégées — `tenant_id`,
`verified_by`, `validated_by`, `verified_at`, `validated_at`, `promoted_by` — ne
sont exposées sur **aucun paramètre**. Elles sont dérivées de `auth.uid()` et de
`now()`. Valider au nom d'autrui est *inexprimable*.

---

## 3. `pv_documents` — la référence documentaire

Une ligne = un objet dans un bucket **privé**, rattaché à un site.

* FK **composites** `(tenant_id, site_id)` et `(tenant_id, bill_id)` — un document
  ne peut pas pointer le site d'un autre tenant, quelles que soient les façades ;
* `tenant_id` immuable (déclencheur PV-1 réutilisé) ;
* RLS activée, **0 policy** ; `REVOKE ALL FROM anon, authenticated` ;
* `storage_path` refuse toute URL `http(s)://` par `CHECK` ;
* **suppression logique** (`deleted_at` / `deleted_by`) : la ligne survit, le
  document retiré de l'UI reste traçable ;
* 3 index, tous préfixés `tenant_id`.

---

## 4. Stockage privé `hermes-pv-documents`

Patron **identique** à `hermes-photo-proxies`, aucun second système.

| Contrainte | Valeur |
|---|---|
| `public` | `false` |
| Plafond | 25 MiB (26 214 400 octets) |
| MIME | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` |
| Policies | 3 (`insert`, `select`, `update`) — **aucune `DELETE`** |
| Clé d'objet | `<tenant_id>/<site_id>/<document_id>/<fichier>` |
| URL signée | **300 s**, produite à la demande, **jamais persistée** |

Le chemin n'est pas choisi par le client : `prepare_pv_document` attribue
l'identifiant **et** le chemin ; `finalize_pv_document` revalide le préfixe
(`PATH_OUT_OF_SCOPE`), le MIME (`BAD_MIME`) et la taille (`BAD_SIZE`). Le nom de
fichier d'origine est assaini avant d'entrer dans un chemin.

---

## 5. Capacités PV — créées DORMANTES

| `action_key` | `enabled` | `is_sensitive` | Cible n8n | Payload requis |
|---|---|---|---|---|
| `pv.bill.extract` | `false` | `true` | *aucune* | `bill_id` |
| `pv.study.prepare` | `false` | `true` | *aucune* | `site_id` |
| `pv.economics.compute` | `false` | `true` | *aucune* | `study_id` |

`request_agent_action` filtre `enabled = true` et répond `UNKNOWN_ACTION` sinon :
ces trois actions sont **inexécutables**, y compris par un appelant authentifié et
autorisé. `resolver_runtime_config` : 3 lignes `enabled = false`, circuit `CLOSED`.

## 6. Politiques SW15 — ACTIVE / REQUIRE_APPROVAL

**La politique précède la capacité.** Le jour où un opérateur passera
`enabled = true`, la toute première exécution partira déjà en approbation humaine :
aucune fenêtre de temps ne peut exister entre « appelable » et « gouverné ».

⚠️ **Portée — vérifiée, pas supposée.** `gateway_policy_gate` filtre
`p.tenant_id = v_req.tenant_id` : une politique à `tenant_id = null` ne serait
**jamais** sélectionnée. Les trois politiques sont donc scopées au seul tenant réel
(`heliosolar`), comme les trois politiques BTP de la Phase 1. Pour tout autre
tenant, la protection tient par le correctif Phase 1 : une action sensible sans
politique part en `REQUIRE_APPROVAL`. **Posture : REQUIRE_APPROVAL partout.**

Aucun `PERMIT` actif sur une action `pv.*` — assertion testée.

---

## 7. Contrat Agent 4 — Analyse Facture EDF · **INACTIF**

**Lira** : `pv_energy_bills` · le document privé (bucket + chemin) · `pv_sites` ·
`pv_prospects` · métadonnées nécessaires.

**Écrira** : `pv_energy_bill_extractions` — **et rien d'autre**.

**Pourra proposer** : fournisseur, période, consommation, coût, puissance, option
tarifaire, PDL/PRM, confiance globale, confiance par champ, sortie brute.

**Ne pourra JAMAIS** :

| Interdit | Ce qui l'empêche |
|---|---|
| produire `VERIFIED` | `pv_human_validation_guard` — un runner `service_role` a `auth.uid() = NULL` |
| modifier les valeurs retenues de `pv_energy_bills` | son contrat d'écriture ne porte que sur les extractions ; la promotion est un geste humain |
| valider humainement | même déclencheur : `verified_by` doit être l'appelant authentifié |
| supprimer un document | aucune policy `DELETE`, aucune façade de suppression physique |
| déclencher l'étude automatiquement | `pv.study.prepare` est `enabled = false`, sans consumer |
| contacter le client | aucune capacité sortante dans ce lot |

**Le chemin sanctionné** : lecture → `pv_energy_bill_extractions` (+ confiance) →
`promote_pv_bill_extraction` par un **humain** → facture en `NEEDS_REVIEW` →
`verify_pv_energy_bill` par un **humain** → `VERIFIED`.
*Promouvoir et certifier sont deux gestes distincts.*

## 8. Contrat Agent 5 — Bureau d'Études PV · **INACTIF**

**Lira** : site, toiture, surfaces, azimut, inclinaison, ombrage, consommation,
factures `VERIFIED`, hypothèses.

**Pourra préparer** : `pv_studies`, `pv_study_assumptions`, `pv_economics`.

**États maximum autorisés à l'IA** : `DRAFT` · `CALCULATED` · `NEEDS_REVIEW`.

**Ne pourra JAMAIS** : `VALIDATED` sur une étude · `VERIFIED` sur un chiffrage ·
transmettre au client · promettre un rendement ou une économie · émettre un devis ·
engager contractuellement.

Les deux premiers interdits sont **structurels** (déclencheurs PV-1), pas des
consignes de prompt. Les suivants tiennent au périmètre : rien de sortant n'existe.

---

## 9. UI — `/etudes`

| Route | Contenu |
|---|---|
| `/etudes` | Liste des prospects PV · recherche · filtres statut/type · création |
| `/etudes/[prospectId]` | Identité, coordonnées, statut, **historique**, sites, ajout de site |
| `/etudes/sites/[siteId]` | Site technique · énergie (consommation, factures, lectures IA) · études · chiffrage |

Le module **existant** `solar.studies` est allumé (`route: null` → `"/etudes"`).
**Aucun menu PV parallèle** : menu, garde serveur et filtre de widgets continuent
de lire la même table de modules.

### Ce que l'écran refuse de faire

* **Une étude non validée porte « À valider »**, en toutes lettres — pas seulement
  par une couleur, qu'un lecteur daltonien ne verrait pas. Un bandeau dit
  explicitement : *ni engagement, ni promesse de rendement, ni promesse d'économie*.
* **`CALCULATED` / `NEEDS_REVIEW` sont visuellement distincts de `VERIFIED`**
  (`lib/pv/status.ts`, ton `certified` réservé à la validation humaine).
* **Statut inconnu ⇒ « À vérifier »**, jamais un libellé rassurant : le doute ferme.
* **La lecture IA n'est jamais fusionnée aux valeurs retenues** : bloc séparé,
  confiance affichée, et le bouton s'appelle « Reprendre ces valeurs » — jamais
  « valider ».
* **La machine à états est LUE, pas redéclarée** : le menu de statut ne propose
  que les transitions réellement présentes dans `pv_prospect_transitions`.
* **État vide honnête** : aucun exemple, aucune ligne de démonstration, aucun
  chiffre illustratif. Un champ absent s'affiche « — ».

---

## 10. Ce que PV-2 ne construit pas, volontairement

Devis PV · contrats · factures clients · paiements · fournisseurs/commandes ·
stock · planning chantier · Consuel · Enedis · mise en service · réception · SAV ·
avis client · PVGIS réel · OpenSolar réel · Retell · workflows n8n · e-mails ou
appels réels.

Une assertion de test échoue si l'un de ces mots réapparaît dans la surface PV-2.

---

## 11. Rollback

```sql
\i db/migrations/20260819_pv2_9_rollback.sql
```

Retire les 23 façades, la garde `pv_guard`, les 3 déclencheurs et la fonction
d'audit documentaire, la table `pv_documents`, les 3 capacités, les 3 lignes de
runtime, les 3 politiques SW15 et les 3 policies `storage`.

**Préserve** : les 9 tables PV-1 et leurs fonctions, `is_active_tenant_member`
(partagée avec le chat et le bucket photo), les Phases 1 et 2, le journal d'audit.

⚠️ **Le bucket n'est pas supprimé en SQL.** Mesuré sur ce projet : Postgres
refuse toute suppression directe dans `storage.*`
(`storage.protect_delete()` → `ERROR 42501`). L'inclure ferait échouer *tout* le
rollback. Le bucket se retire par l'API Storage. Après rollback il **subsiste**,
mais privé et **sans aucune policy** : inerte, pas dangereux.
