# Hermès Studio — Verticale Photographe Premium

**Statut : ARCHITECTURE + CONSTRUCTION PRÉPARATOIRE — `GO_LIVE = NO`**
Aucun déploiement, aucune migration appliquée, aucun workflow n8n activé, aucune donnée de
production modifiée. Ce document est le livrable ; l'audit qui le fonde a été fait en
**lecture seule** sur le repo et sur la base Supabase `Hermes OS` (`smubxqorirlfldatzmym`).

---

## 0. Audit préalable — ce qui existe déjà (mesuré, pas supposé)

### 0.1 Méthode

| Source | Ce qui a été lu |
|---|---|
| Repo | `db/migrations/README.md` (50 Ko de journal d'architecture), `n8n/README.md`, `types/*`, `services/hermes/*`, `lib/dashboard/*` |
| Base (SELECT only) | `information_schema`, `pg_proc`, `pg_stat_user_tables`, `agent_action_catalog`, `component_registry`, `sw19_metric_definitions`, `sw23_model_catalog`, `storage.buckets` |
| Web | vérification de la **disponibilité réelle des APIs** photo (culling / édition / galerie) |

### 0.2 Chiffres réels constatés

- **164 tables** dans `hermes_os` ; 1 tenant (`heliosolar`) ; **95 composants** au registre.
- **24 modules SW** (`SW1`…`SW24`) — **tous actifs** en n8n.
- **37 agents IA** (32 actifs), dont plusieurs directement réutilisables.
- **5 entrées** seulement dans `agent_action_catalog` (`btp.qualification.create`,
  `btp.planning.phase.add`, `btp.suivi.progress.report`, `diag.echo`, `hermes.intent.resolve`)
  → **le catalogue de capacités est le goulot, pas la plateforme**.
- **1 bucket** privé (`hermes-chat-attachments`, 25 MiB, RLS par `tenant/user`).
- **13 définitions de métriques SW19** déjà en base, dont `TIME_SAVED`,
  `REALIZED_VALUE_TOTAL`, `AI_COST_TOTAL`, `HUMAN_INTERVENTION_COUNT`,
  `HUMAN_INTERVENTION_AVG_DURATION`, `AUTONOMY_RATE`.
- **Catalogue modèles SW23** : `gpt-5.4-nano` (0,20/1,25 $/M), `claude-haiku-4-5` (1/5 $/M),
  `claude-sonnet-5`, `claude-opus-5` — prix réels, `cost_status='real'`.

### 0.3 Briques réutilisables — inventaire de décision

| Brique existante | Rôle | Réutilisation Studio Photo |
|---|---|---|
| `request_agent_action` / `claim_agent_action(action_key,lease)` / `complete_agent_action(…,lease_token)` | **Gateway unique** async, idempotent, bail (lease), dead-letter, exclusions de claim | **100 %** — aucune action photo ne contourne cette passerelle |
| `orchestrate_hermes_message` + `apply_hermes_resolution` | Orchestrateur NL : branche informationnelle → chemin déterministe → repli sémantique | **100 %** — le « Studio Director » n'est **pas** un 2ᵉ orchestrateur |
| `agent_action_catalog` | Registre capability-first (`required_payload_keys`, `is_sensitive`, `nl_*`) | **100 %** — +22 lignes `photo.*` |
| **SW15** (`sw15_policies`, `sw15_approval_requests`, `list_pending_agent_approvals`, `approve/reject_agent_action`) | Moteur d'autonomie & approbations humaines | **100 %** — `APPROVAL_REQUIRED` du cahier des charges = policies SW15 |
| **SW23** (`sw23_route_and_reserve`, `reserve/commit/release_budget`, `sw23_model_catalog`, `sw23_tenant_budget_config`) | Routeur modèle + budget hard-stop | **100 %** — COST-FIRST, caps par tenant |
| **SW9** (`sw9_quota_check_and_increment`, idempotence, registre fournisseurs) | Passerelle API externe sécurisée + quotas | **100 %** — c'est le `PHOTO_EDIT_PROVIDER` gateway |
| **SW19** (`sw19_value_events`, `sw19_human_interventions`, `sw19_baselines`, `sw19_metric_samples`, `sw19_roi_snapshots`, `sw19_attribution`) | Coûts / valeur / ROI auditables | **100 %** — `HERMES_VALUE_CREATED_EUR` et `HERMES_ROI` ont déjà leur maison |
| **SW13** (`sw13_event_outbox`) + **SW20** (`sw20_subscribers`, retry, DLQ, ordering) | Event bus | **100 %** — event-driven, **0 polling**, 0 scheduler métier |
| **SW11** (omnicanal email/SMS/WhatsApp, `sw11_idempotency_claim`, permission engine, retry executor, webhooks) | Communications | **100 %** — le Client Concierge n'écrit pas un 2ᵉ système d'envoi |
| **SW10** (documents & versions) | Devis / contrats / factures PDF | **100 %** |
| **SW3** (Mémoire & RAG Qdrant) | Mémoire sémantique | **100 %** — `STUDIO_MEMORY` non structurée |
| **SW8** (Perception multimodale) + sous-workflow `immo_photo_defect_analysis` | Analyse image | **Précédent direct** pour le culling |
| **SW16 / SW17 / SW18 / SW22 / SW24** | Critic, shadow-mode, apprentissage, saga/compensation, provisioning | Réutilisés (voir §6, §9, §12) |
| `peinture_media_consent` + `peinture_verifier_consentement_media()` | **Consentement média déjà modélisé** (`use_cases_granted`, `identity_scope`, `location_scope`, `expires_at`, `revoked_at`, preuve) | **Contrat copié à l'identique** en `photo_media_consent` |
| `peinture_marketing_draft` | Brouillon marketing → `approved_by`/`rejected_by` → `publish_result` | **Contrat copié** en `photo_marketing_draft` |
| `youtube_publication_requests/approvals/log` + `reserve_youtube_publication()` | Moteur générique « aucune publication sans approbation » (colonne `platform`, hash fichier/titre, expiration, révocation) | **100 %** — sert Instagram/Facebook via `platform` |
| Agent 56 — Média & Photothèque (`agent56_config`: `dry_run`, `max_ia_calls_per_run`) | Indexation média | **Réutilisé** |
| Agent 6 Relance · Agent 7 Marketing/Brand DNA · Agent 8 Community Manager · Agent BI | Relances, contenu, publication sociale, reporting | **Réutilisés** |
| `resolver_runtime_config` + `claim_semantic_resolver_batch(action_key, lease)` + circuit breaker + preflight + control plane | Kill-switch, `max_batch`, `max_concurrency`, cadence, disjoncteur, **par `action_key`** | **100 % — découverte clé** : la table est déjà clé-par-action ⇒ **0 ligne de code runtime-safety à écrire**, il suffit de seeder une ligne par action photo |
| Bucket `hermes-chat-attachments` + `finalize/link/get_hermes_message_attachments` + orphelins TTL | Upload privé, chemin `tenant/user/…`, URLs signées, purge | **Patron copié** pour les proxies photo |
| Registre widgets / profils (`lib/dashboard/widgets.ts`, `profiles.ts`, `CAPABILITY_TOKEN_RULES`) | Dashboard capability-first, extensible par append | **100 %** — ajouter une verticale = ajouter des entrées de registre |

### 0.4 Ce qui manque réellement

1. **Modèle de données photo** (séances, assets, verdicts de tri, profil de style, galeries, upsell).
2. **Pipeline proxy** (références + vignettes, jamais de RAW durable).
3. **Consentement média & marketing photo** (les tables existantes sont scopées `peinture`/`chantier_id`).
4. **6 consumers n8n** (un par capacité d'écriture photo).
5. **Un CRM natif** : le seul CRM existant est *Agent 2 — CRM Notion*, qui crée une
   **dépendance externe irréversible** (Notion). ⇒ **à ne pas réutiliser** pour cette verticale.

---

## 1. Décisions d'architecture structurantes

### D1 — Le Studio Director n'est PAS un nouvel orchestrateur

Le cahier des charges demande un « point d'entrée unique ». Il **existe déjà** :
`orchestrate_hermes_message`. Créer un second orchestrateur violerait l'invariant
« *il n'y a qu'une seule passerelle* » qui structure tout le projet.

> **`PHOTO_STUDIO_DIRECTOR` = une projection déterministe (SQL) + un jeu de capacités**,
> pas un agent LLM. Il expose l'état complet d'une séance et la *next-best-action*, et la
> branche informationnelle de l'orchestrateur y répond en `ANSWER_ONLY`, **coût IA = 0**.

Conséquence directe : « Hermès, où en est la séance Dupont ? » coûte **0,000 $** et répond
en < 100 ms. Seules les formulations libres non résolues déterministiquement descendent
vers le résolveur sémantique (`gpt-5.4-nano`, ~0,0006 $).

### D2 — BYO-provider : les coûts lourds restent chez la photographe

L'édition IA premium coûte ~0,05 $/photo. À 150 photos livrées × 8 séances/mois = **60 $/mois**,
soit 25 % d'un abonnement à 250 € : la marge est détruite.

> **Hermès orchestre, il n'achète pas.** Les comptes Imagen / Pic-Time / stockage RAW
> restent ceux de la photographe (référencés via `tenant_platform_channel_config.credential_reference`,
> table existante avec colonne `platform`). Hermès facture l'orchestration, pas le traitement.
> Un mode « inclus » reste possible **en add-on facturé**, jamais dans le forfait de base.

Bénéfice secondaire : **zéro lock-in**. Elle peut changer de provider, ses données restent chez elle.

### D3 — Le culling est construit par Hermès, pas acheté

Vérification faite : **aucun** des leaders du tri (Aftershoot, FilterPixel, Narrative Select)
n'expose d'API publique — ce sont des applications de bureau. Imagen AI expose une API, mais
pour l'**édition**, pas pour le tri instruit.

> Le tri Hermès s'exécute en **deux passes** : (1) déterministe, **côté navigateur**, sur les
> proxies (netteté, histogramme, hash perceptuel, rafales/EXIF) → **0 €, 0 n8n** ;
> (2) VLM sur le reliquat ambigu seulement → ~0,39 $/séance.

C'est aussi le **différenciateur non copiable** : aucun outil de bureau n'accepte
« *garde toutes les photos des grands-parents* ». Les instructions en langage naturel sont
la propriété du produit.

### D4 — Signature Edit : XMP d'abord, provider ensuite

Le chemin par défaut produit des **sidecars XMP** (réglages develop calculés par Hermès à
partir du `PHOTOGRAPHER_STYLE_PROFILE`) que Lightroom Classic lit nativement.
Coût marginal **0 €**, aucun provider, aucun lock-in, contrôle artistique intégral.
L'API Imagen (RAW natif, profil personnel entraîné sur *son* catalogue) est le chemin
premium optionnel, **après benchmark sur ses vraies séances**.

### D5 — Aucun RAW stocké durablement

Hermès manipule des **références** (chemin/URL chez elle) + des **proxies** JPEG (grand côté
1 600 px, ~400 Ko) générés **localement** à partir des aperçus embarqués du RAW.
TTL 90 jours après livraison, purge automatique bornée. Voir §10.

---

## 2. LIVRABLE — Synthèse

```
PRODUCT_NAME:        Hermès Studio
VALUE_PROPOSITION:   L'assistant de studio permanent du photographe professionnel.
                     Il connaît chaque séance, trie, prépare la retouche dans SON style,
                     livre, relance, détecte le chiffre d'affaires dormant — et demande
                     toujours son avis avant toute action visible par un client.

PILOT_SCOPE:         P0 complet + tri photo réel + Signature Edit XMP (voir §11)
FINAL_SCOPE:         Modules 1→9 (voir §4)

AGENTS_TOTAL:        39   (34 réutilisés + 5 nouveaux)
REUSED_HERMES_AGENTS: 34  (24 modules SW + 10 agents IA)
NEW_PHOTO_AGENTS:     5   (dont 1 sans runner : projection SQL déterministe)

READY_FOR_IMPLEMENTATION: YES (Phase 1) / NO (go-live — voir §14)
GO_LIVE: NO
```

---

## 3. AGENT_LIST

### 3.1 Réutilisés (aucune duplication)

| ID stable | Rôle dans Hermès Studio |
|---|---|
| `sw1_hermes_core` | Orchestration / routage central |
| `sw2_super_routeur_registre` | Super-routeur sémantique + registre |
| `sw3_memoire_rag` | Mémoire sémantique (préférences, historiques, style verbalisé) |
| `sw4_agent_execution` | Exécution des agents spécialisés |
| `sw5_quality_security` | Contrôle qualité/sécurité des réponses |
| `sw6_synthese_logs_kpi` | `execution_logs`, KPI |
| `sw8_perception_multimodale` | Passe VLM du culling |
| `sw9_passerelle_api_securisee` | Appels providers photo + quotas + idempotence |
| `sw10_documents_fichiers` | Devis, contrat, facture (versionnés) |
| `sw11_communications_omnicanales` | **Tout** envoi client (email/SMS/WhatsApp) |
| `sw12_observabilite_supervision` | Supervision, incidents |
| `sw13_company_digital_twin` | Outbox événementielle + entités |
| `sw14_goal_strategy` | Objectifs studio (CA, délai de livraison) |
| `sw15_autonomy_policy` | **Toutes** les approbations humaines |
| `sw16_critic_verification` | Contrôle qualité avant livraison de galerie |
| `sw17_simulation_shadow_mode` | Comparaison tri Hermès vs tri manuel (semaines 1-2) |
| `sw18_autonomous_improvement_engine` | Boucle d'apprentissage du profil de style |
| `sw19_autonomy_roi_intelligence` | Temps gagné, valeur, ROI |
| `sw20_event_bus` | Abonnés, retry, DLQ |
| `sw21_global_sandbox` | Limites ressources |
| `sw22_recovery_rollback_compensation` | Saga : annuler un export/upload partiel |
| `sw23_model_cost_router` | Choix du modèle le moins cher suffisant + budget |
| `sw24_provisioning_deployment` | Onboarding du tenant photographe |
| `agent_56_media_phototheque` | Indexation photothèque |
| `agent_6_relance_automatique` | Relances devis / solde / avis |
| `agent_7_directeur_marketing` | Contenu, Brand DNA |
| `agent_8_community_manager` | Publication sociale + réputation |
| `agent_bi_reporting` | Synthèse business |
| `immo_photo_defect_analysis` | Patron d'analyse photo multimodale (référence) |
| `hermes_os_chat_webhook` | Entrée chat |

> **Non réutilisé volontairement** : `agent_2_crm_notion` (dépendance SaaS irréversible),
> agents BTP / immo / industrie / juridique / santé (hors verticale),
> `agent_9`/`agent_10` téléphonie (P2, non requis pour le pilote).

### 3.2 Nouveaux (5, dont 1 sans runner)

| ID stable | Type | Runner | Justification d'existence |
|---|---|---|---|
| `photo_studio_director` | **Projection SQL** | *aucun* | État séance + next-best-action, déterministe, 0 IA. N'existe nulle part ailleurs. |
| `agent_photo_culling` | AGENT_IA | `GW Consumer — Photo Culling` | Passe VLM instruite. Aucun provider n'expose cette capacité en API. |
| `agent_photo_signature_edit` | AGENT_IA | `GW Consumer — Photo Signature Edit` | Calcul XMP depuis le style profile + orchestration provider. |
| `agent_photo_delivery` | AGENT_IA | `GW Consumer — Photo Delivery` | Export → galerie → notification, avec gate d'approbation. |
| `agent_photo_revenue` | AGENT_IA | `GW Consumer — Photo Revenue` | Détection d'opportunités (déterministe) + rédaction de proposition. |

> Le Client Concierge et le Growth **ne sont pas de nouveaux agents** : ce sont des jeux
> d'actions branchés sur SW11 + Agent 6 / Agent 7 / Agent 8. Créer `PHOTO_CLIENT_CONCIERGE`
> et `PHOTO_GROWTH` serait de la duplication décorative.
> `PHOTO_MEMORY` non plus : c'est SW3 + SW13 + les tables `photo_*`.

---

## 4. ACTION_CATALOG

Toutes les colonnes correspondent à `hermes_os.agent_action_catalog`.
`APPROVAL_POLICY` est appliquée par **SW15**, jamais en dur dans l'UI.
`EXPECTED_COST` = coût IA Hermès par exécution (hors providers BYO).

| ACTION_KEY | DESCRIPTION | SENSITIVE | APPROVAL_POLICY | AGENT | CONSUMER | EXPECTED_COST | IDEMPOTENCY_KEY | LOT |
|---|---|:--:|---|---|---|---|---|:--:|
| `photo.session.create` | Crée une séance | ✅ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, client_id, date_seance, type)` | P0 |
| `photo.session.import.register` | Enregistre un lot (références + proxies) | ✅ | PERMIT | `agent_56_media_phototheque` | *(SQL direct)* | 0 $ | `(tenant, session_id, batch_fingerprint)` | P0 |
| `photo.culling.instruct` | Enregistre une consigne NL de tri | ❌ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, session_id, sha256(instruction))` | P0 |
| `photo.culling.start` | Lance la passe VLM sur le reliquat ambigu | ✅ | PERMIT + cap budget | `agent_photo_culling` | Photo Culling | ~0,39 $ | `(tenant, session_id, pass_no)` | P0 |
| `photo.culling.review.apply` | Applique la validation humaine du tri | ✅ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, session_id, review_fingerprint)` | P0 |
| `photo.edit.profile.learn` | Met à jour le `PHOTOGRAPHER_STYLE_PROFILE` | ✅ | PERMIT | `agent_photo_signature_edit` | Signature Edit | ~0,01 $ | `(tenant, profile_key, sample_batch_id)` | P1 |
| `photo.edit.prepare` | Prépare la retouche (XMP ou provider) | ✅ | **REQUIRE_APPROVAL si provider payant** | `agent_photo_signature_edit` | Signature Edit | 0 $ (XMP) | `(tenant, session_id, profile_version)` | P1 |
| `photo.edit.approve` | Valide la retouche | ✅ | *(c'est l'approbation)* | — | — | 0 $ | `(tenant, edit_job_id)` | P1 |
| `photo.export.prepare` | Prépare l'export des validées | ✅ | PERMIT | `agent_photo_delivery` | Photo Delivery | 0 $ | `(tenant, session_id, export_spec_hash)` | P1 |
| `photo.gallery.prepare` | Prépare la galerie (brouillon) | ✅ | PERMIT | `agent_photo_delivery` | Photo Delivery | ~0,005 $ | `(tenant, session_id, gallery_draft_hash)` | P1 |
| `photo.gallery.publish` | **Publie / envoie au client** | ✅ | **REQUIRE_APPROVAL** | `agent_photo_delivery` | Photo Delivery | 0 $ | `(tenant, gallery_id, content_hash)` | P1 |
| `photo.client.message.prepare` | Rédige un message client | ❌ | PERMIT | `agent_6_relance_automatique` | Photo Client Comms | ~0,004 $ | `(tenant, client_id, template_key, context_hash)` | P2 |
| `photo.client.message.send` | **Envoie** au client | ✅ | **REQUIRE_APPROVAL** (sauf 4 templates transactionnels allowlistés) | `sw11_communications_omnicanales` | Photo Client Comms | 0 $ | `sw11_idempotency_claim` (existant) | P2 |
| `photo.consent.record` | Enregistre un consentement média | ✅ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, client_id, consent_text_version)` | P0 |
| `photo.upsell.detect` | Détecte les opportunités (SQL pur) | ❌ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, as_of_date)` | P2 |
| `photo.upsell.propose` | Rédige une proposition (brouillon) | ✅ | PERMIT | `agent_photo_revenue` | Photo Revenue | ~0,004 $ | `(tenant, opportunity_id)` | P2 |
| `photo.upsell.send` | **Envoie la proposition commerciale** | ✅ | **REQUIRE_APPROVAL** | `sw11_communications_omnicanales` | Photo Client Comms | 0 $ | `(tenant, opportunity_id, content_hash)` | P2 |
| `photo.review.request` | **Demande d'avis** | ✅ | **REQUIRE_APPROVAL** | `agent_6_relance_automatique` | Photo Client Comms | 0 $ | `(tenant, session_id)` | P2 |
| `photo.marketing.prepare` | Prépare un post (sélection + texte) | ✅ | PERMIT + **gate consentement** | `agent_7_directeur_marketing` | Photo Marketing | ~0,006 $ | `(tenant, session_id, canal, use_case)` | P2 |
| `photo.marketing.publish` | **Publie sur un réseau** | ✅ | **REQUIRE_APPROVAL + consentement valide obligatoire** | `agent_8_community_manager` | Photo Marketing | 0 $ | `reserve_publication(idempotency_key)` (moteur existant) | P2 |
| `photo.memory.upsert` | Met à jour la mémoire structurée client | ✅ | PERMIT | `photo_studio_director` | *(SQL direct)* | 0 $ | `(tenant, client_id, field_set_hash)` | P0 |
| `photo.session.purge` | **Purge les proxies d'une séance** | ✅ | **REQUIRE_APPROVAL** | `agent_56_media_phototheque` | Photo Culling | 0 $ | `(tenant, session_id, purge_reason)` | P1 |

**22 actions. 8 en P0.** Les 7 actions marquées *(SQL direct)* sont des écritures
déterministes exposées par façade `SECURITY DEFINER` — elles passent quand même par
`request_agent_action` pour l'audit et SW15, mais leur runner est une fonction Postgres,
**pas un workflow n8n** ⇒ **elles fonctionnent malgré le blocage n8n**.

---

## 5. END_TO_END_WORKFLOW

Colonnes : TRIGGER · AGENT · INPUT → OUTPUT · APPROVAL · COST_CLASS
(`FREE` = 0 IA / `NANO` ≤ 0,001 $ / `LOW` ≤ 0,05 $ / `MEDIUM` ≤ 0,5 $) · FAILURE_MODE · RETRY · IDEMPOTENCY

| # | Étape | TRIGGER | AGENT | INPUT → OUTPUT | APPR. | COST | FAILURE_MODE | RETRY | IDEMPOTENCY |
|---|---|---|---|---|:--:|---|---|---|---|
| 1 | **Demande client** | Webhook SW11 / saisie | SW11 | message → `photo_leads` | non | FREE | webhook perdu → relecture `sw11_webhook_event_claim` | 3× exp. | `(provider,event_id)` |
| 2 | **Qualification** | event `photo.lead.created` | `photo_studio_director` | lead → type, date, budget, complétude | non | NANO | infos manquantes → `NEEDS_CLARIFICATION` | 0 | `sha256(lead)` |
| 3 | **Devis** | commande NL | SW10 | qualif → devis PDF v1 | non (brouillon) | NANO | modèle absent → `NO_TEMPLATE` | 0 | `(client,version)` |
| 4 | **Envoi devis** | validation humaine | SW11 | devis → email | **OUI** | FREE | bounce → `sw11_retry_executor` | 3× exp. | `sw11_idempotency_claim` |
| 5 | **Contrat** | devis accepté | SW10 | devis → contrat + lien signature | **OUI** | FREE | signature expirée → relance J+3 | 1× | `(devis_id)` |
| 6 | **Acompte** | contrat signé | SW10 + webhook paiement | contrat → facture acompte | non | FREE | paiement partiel → `PARTIAL_PAYMENT` | 0 | `(facture_id, payment_ref)` |
| 7 | **Réservation** | acompte reçu | `photo_studio_director` | → `photo_sessions` + calendrier | non | FREE | collision agenda → `SLOT_CONFLICT` | 0 | `(client,date,type)` |
| 8 | **Préparation** | J-7 (event daté, **pas de scheduler**) | `agent_6_relance` | séance → checklist + conseils vêtements + lieu | **OUI** (envoi) | NANO | — | 3× | `(session_id,'J7')` |
| 9 | **Rappel J-1** | event daté | `agent_6_relance` | → SMS/email | **OUI** (allowlist transactionnelle possible) | FREE | — | 3× | `(session_id,'J1')` |
| 10 | **Shooting** | déclaration NL (« *j'ai terminé la séance Dupont* ») | `photo_studio_director` | → statut `SHOT` | non | FREE | séance ambiguë → clarification | 0 | `(session_id,'shot')` |
| 11 | **Import** | upload local | client (navigateur) + `agent_56` | RAW locaux → **références + proxies** | non | FREE | proxy illisible → `PROXY_FAILED` (photo ignorée, jamais supprimée) | 2× | `(session_id, file_sha256)` |
| 12 | **Tri passe 1 (déterministe)** | fin d'import | **navigateur** | proxies → netteté, expo, pHash, rafales | non | **FREE** | onglet fermé → reprise idempotente | ∞ | `(asset_id,'pass1')` |
| 13 | **Tri passe 2 (VLM)** | passe 1 finie + reliquat > 0 | `agent_photo_culling` | reliquat + consignes NL → `KEEP_SUGGESTION` / `REJECTED_SUGGESTION` / `BEST_OF_SERIES` | non | **MEDIUM** (~0,39 $) | budget dépassé → `HARD_LIMIT`, passe 1 conservée | 2× puis DLQ | `(session_id, pass_no)` |
| 14 | **Validation tri** | revue humaine | — | verdicts → sélection finale | **OUI (implicite)** | FREE | **aucune suppression définitive, jamais** | — | `review_fingerprint` |
| 15 | **Signature Edit** | sélection validée | `agent_photo_signature_edit` | sélection + style profile → **XMP** (ou job provider) | **OUI si provider payant** | FREE (XMP) | provider HS → repli XMP | 2× | `(session_id, profile_version)` |
| 16 | **Validation photographe** | revue humaine | — | → `EDIT_APPROVED` | **OUI** | FREE | — | — | `(edit_job_id)` |
| 17 | **Export** | édition validée | `agent_photo_delivery` | → JPEG livrables | non | FREE | disque plein → `EXPORT_FAILED` + SW22 compensation | 2× | `export_spec_hash` |
| 18 | **Galerie** | export prêt | `agent_photo_delivery` | → galerie brouillon + contrôle SW16 | non | NANO | provider galerie HS → `GALLERY_UNAVAILABLE` | 3× | `gallery_draft_hash` |
| 19 | **Livraison** | approbation | `agent_photo_delivery` + SW11 | → publication + notification client | **OUI** | FREE | envoi échoué → retry SW11 | 3× | `(gallery_id, content_hash)` |
| 20 | **Solde** | galerie livrée | SW10 | → facture solde + relances | **OUI** (relance) | FREE | impayé J+15 → alerte | 3× | `(facture_id)` |
| 21 | **Upsell** | event daté (anniversaire, saison) | `agent_photo_revenue` | mémoire → opportunités scorées | **OUI** (envoi) | LOW | — | 1× | `(opportunity_id)` |
| 22 | **Avis** | J+7 après consultation galerie | `agent_6_relance` | → demande d'avis | **OUI** | FREE | — | 2× | `(session_id)` |
| 23 | **Marketing** | séance approuvée + **consentement valide** | `agent_7` → `agent_8` | → post + légende + carrousel | **OUI** | LOW | consentement absent/expiré → **refus fail-closed** | 0 | `reserve_publication()` |
| 24 | **CRM / mémoire** | tout event terminal | `photo_studio_director` | → `photo_clients`, LTV, `follow_up_date` | non | FREE | — | ∞ | `field_set_hash` |
| 25 | **Relance future** | event daté | `agent_6_relance` | → proposition de reprise de contact | **OUI** | NANO | — | 1× | `(client_id, follow_up_date)` |

**Aucun scheduler permanent.** Les étapes « datées » (8, 9, 21, 22, 25) sont des **événements
avec `occurred_at` futur** dans `sw13_event_outbox`, consommés par le driver borné existant
au tick, exactement comme `get_dashboard_agenda()` bucketise déjà par timezone tenant.

---

## 6. PHOTO_PROVIDER_BENCHMARK

> ⚠️ **Prix et disponibilités relevés en août 2026, à revérifier au contrat.**
> Aucun fournisseur n'est retenu définitivement à ce stade.

### 6.1 CULLING

| | Aftershoot | FilterPixel | Narrative Select | **Hermès (proposé)** |
|---|---|---|---|---|
| PROVIDER | Aftershoot | FilterPixel | Narrative | interne |
| FEATURES | tri + édition + retouche + galerie (suite 2026) | tri par genre (DeepCull) | tri centré visages | tri + **consignes NL** |
| **API** | **❌ aucune API publique** | ❌ | ❌ | ✅ natif |
| AUTOMATION | app bureau / plugin Lr | app bureau | app macOS | ✅ event-driven |
| RAW | ✅ | ✅ | ✅ | via proxy (aperçu embarqué) |
| BATCH | ✅ (1000 photos ~3-18 min) | ✅ | ✅ | ✅ |
| QUALITY | référence marché | rapide, genre-spécifique | excellent sur visages | **à prouver en shadow-mode** |
| COST | abonnement | abonnement | abonnement | ~0,39 $/séance |
| PRICING_MODEL | SaaS/poste | SaaS | SaaS | usage |
| **LOCK_IN** | 🔴 élevé (suite complète) | 🟠 | 🟠 | 🟢 nul |
| GDPR | à vérifier | à vérifier | local (macOS) | 🟢 UE (Supabase eu-west-1) |
| DATA_LOCATION | cloud US probable | cloud | **local** | UE |
| COMMERCIAL_USE | ✅ | ✅ | ✅ | ✅ |
| **HERMÈS_INTEGRATION_DIFFICULTY** | **impossible (pas d'API)** | impossible | impossible | moyenne |

**Conclusion tri : aucune intégration automatisée n'est possible.** Le choix n'est pas
« construire ou acheter » mais « construire ou renoncer à l'automatisation ».
⇒ **Construire**, en le validant en shadow-mode (SW17) contre son tri manuel réel.

### 6.2 RAW EDITING / RETOUCHING

| | **Imagen AI** | Adobe Lightroom API (Firefly Services) | Evoto | **XMP natif (Hermès)** |
|---|---|---|---|---|
| **API** | ✅ **API développeur publique** | ✅ REST (autoTone, autoStraighten, applyPreset) | ❌ | n/a (fichier) |
| RAW | ✅ natif | ✅ | ✅ | ✅ (sidecar lu par Lr) |
| STYLE_CONSISTENCY | ✅ **profil personnel entraîné sur son catalogue** | via ses propres presets XMP | presets | ✅ son profil mesuré |
| BATCH | ✅ | ✅ | ✅ | ✅ |
| COST | **~0,05 $/photo** (1000 éditions offertes) | **contrat entreprise**, ~0,02-0,10 $/image, engagement ~1 000 $/mois signalé | abonnement | **0 €** |
| PRICING_MODEL | usage, plan Business requis pour l'API | entreprise | SaaS | — |
| **LOCK_IN** | 🟠 moyen (profil chez eux) | 🔴 élevé | 🔴 | 🟢 nul |
| GDPR / DATA_LOCATION | à contractualiser (DPA) | Adobe, DPA dispo | à vérifier | 🟢 rien ne sort |
| RETOUCHE PEAU/CHEVEUX | ✅ (add-ons) | partiel | ✅ (le meilleur) | ❌ |
| **DIFFICULTÉ HERMÈS** | **faible** (via SW9) | élevée (contrat) | impossible | **très faible** |

**Le seuil d'engagement d'Adobe (~1 000 $/mois) est rédhibitoire pour un pilote à 1 studio.**

### 6.3 GALLERIES / DELIVERY

| | **Pic-Time** | Pixieset | CloudSpot | SmugMug |
|---|---|---|---|---|
| **API** | ❌ pas de REST publique — **✅ intégration Zapier officielle** (triggers : *New Gallery Visitor*, *New Order Placed*, *Gallery Invite Sent*) | ❌ (absent de Zapier) | partiel | API REST historique |
| AUTOMATION | 🟢 via Zapier/webhook | 🔴 | 🟠 | 🟠 |
| VENTE INTÉGRÉE | ✅ boutique + labo mondial + automatisations marketing | ✅ | ✅ | ✅ |
| COST | abonnement photographe | abonnement | abonnement | 25-45 $/mois |
| **LOCK_IN** | 🟠 (mais migration documentée) | 🟠 | 🟠 | 🟠 |
| **DIFFICULTÉ HERMÈS** | faible (entrant Zapier→webhook SW11 ; création galerie = étape humaine assistée au pilote) | élevée | moyenne | moyenne |

**Ne pas reconstruire une plateforme galerie.** Pic-Time couvre présentation + vente + labo ;
Hermès prépare, contrôle, fait approuver, puis **récupère les signaux** (consultation, commande)
par webhook — ce qui alimente directement le module Revenue.

### 6.4 STORAGE

| | Cloudflare R2 | Backblaze B2 | Supabase Storage |
|---|---|---|---|
| Stockage | ~0,015 $/Go/mois | ~0,006 $/Go/mois | inclus/plan |
| **Egress** | **0 $** | gratuit jusqu'à 3× le stockage, puis 0,01 $/Go ; **gratuit via CDN partenaires (dont Cloudflare)** | limité |
| S3-compatible | ✅ | ✅ | ✅ |
| GDPR / UE | ✅ (localisation configurable) | ✅ | ✅ eu-west-1 (déjà en place) |
| Verdict | **proxies + vignettes** | archives froides éventuelles | **rester ici au pilote** (0 nouvelle dépendance) |

**Décision pilote : Supabase Storage**, bucket privé dédié — le volume (§10) est de l'ordre
de **6 Go**, ce qui ne justifie aucune infrastructure supplémentaire. R2 devient pertinent
au-delà de ~10 studios.

### 6.5 RECOMMENDED_STACK / ALTERNATIVE_STACK

```
RECOMMENDED_STACK (pilote)
  CULLING          Hermès (2 passes : navigateur déterministe + VLM Haiku 4.5 via SW23)
  RAW EDITING      Hermès → sidecars XMP + Lightroom Classic (elle garde son outil)
  RETOUCHING       manuel (elle) — Hermès prépare et priorise
  GALLERY          Pic-Time (SON compte) — webhooks entrants via SW11
  DELIVERY         Pic-Time + notification SW11 après approbation
  STORAGE          Supabase Storage privé (proxies, TTL 90 j) ; RAW = chez elle
  CRM/DEVIS/FACT.  natif Hermès (SW10 + tables photo_*), PAS Notion
  LOCK_IN GLOBAL   🟢 faible — chaque brique externe est remplaçable sans migration de données

ALTERNATIVE_STACK (si le pilote demande plus de puissance d'édition)
  EDITING          Imagen AI API (compte de la photographe, BYO) via SW9
                   → +0,05 $/photo à SA charge, profil entraîné sur SON catalogue
  RETOUCHING       Evoto en poste manuel (aucune API — orchestration impossible)
  GALLERY          CloudSpot ou SmugMug si une vraie API devient nécessaire
  STORAGE          Cloudflare R2 (egress 0) dès ~10 studios

REJETÉ
  Adobe Firefly/Lightroom API   engagement ~1 000 $/mois — incompatible avec la cible de marge
  Aftershoot/FilterPixel/Narrative   aucune API : orchestration impossible
  Agent 2 CRM Notion            dépendance SaaS irréversible
```

---

## 7. DASHBOARD_STRUCTURE

Le dashboard photographe **n'est pas un nouveau dashboard** : c'est un **profil** dans le
registre existant (`lib/dashboard/profiles.ts`) + des widgets ajoutés au registre
(`lib/dashboard/widgets.ts`). Aucun changement d'architecture, aucune migration.

### 7.1 Accueil

```
┌──────────────────────────────────────────────────────────────┐
│  HERMÈS STUDIO                    Paris · 14:32 · 18 °C ☀︎    │
├──────────────────────────────────────────────────────────────┤
│  AUJOURD'HUI                                                 │
│    3 h 42 économisées          7 tâches automatisées          │
│    2 séances préparées         340 € de revenus détectés      │
│    ▲ 4 validations nécessaires                     [Voir]     │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Demandez à Hermès…                              🎤 +  │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  SÉANCES EN COURS                                            │
│    Dupont — mariage       tri validé → retouche en attente    │
│    Martin — famille       galerie prête → à approuver         │
└──────────────────────────────────────────────────────────────┘
```

Le **chat reste central** — il occupe le tiers supérieur, juste sous les 5 chiffres du jour.
Aucun autre widget n'est visible sans défilement.

### 7.2 Sections

| Section | Route | Contenu | Source |
|---|---|---|---|
| **AUJOURD'HUI** | `/` | 5 chiffres + validations + séances actives | `get_photo_today()` (nouveau) + `get_unified_alerts()` (existant) |
| **SÉANCES** | `/seances` | pipeline par statut, une séance = une timeline | `get_photo_sessions()` |
| **CLIENTS** | `/clients` | fiche, famille, dates clés, LTV, historique | `get_photo_client()` |
| **PHOTOS** | `/seances/[id]/tri` | grille de revue du tri (clavier : garder/écarter/comparer) | `get_photo_culling_review()` |
| **GALERIES** | `/galeries` | brouillons, publiées, consultations, commandes | `get_photo_galleries()` |
| **REVENUS** | `/revenus` | opportunités scorées, CA généré par Hermès | `get_photo_revenue()` |
| **MARKETING** | `/marketing` | brouillons en attente d'approbation + statut consentement | `get_photo_marketing()` |
| **HERMÈS** | `/activite`, `/approbations`, `/agents` | **pages existantes**, aucune duplication | RPC existants |

### 7.3 Widgets ajoutés au registre (append seul)

`photo-today`, `photo-sessions`, `photo-culling-queue`, `photo-galleries`,
`photo-revenue`, `photo-approvals` (alias du widget `approvals` existant),
`photo-time-saved`.
Tous avec `requiredCapabilityPrefix: "photo."` ⇒ ils **disparaissent** pour un tenant BTP.

### 7.4 Profil + tokens

```ts
// lib/dashboard/profiles.ts — append
{ id: "photographe", kind: "specialized", availability: "capability",
  requiredCapabilities: ["photo_studio"], priority: 25,
  recommendedWidgets: ["photo-today","photo-sessions","photo-culling-queue",
                       "photo-galleries","photo-revenue","approvals"] }

// CAPABILITY_TOKEN_RULES — append
{ prefix: "photo.", tokens: ["photo_studio","projects","planning","operations",
                             "crm","leads","sales","quotes","marketing",
                             "appointments","documents","invoicing"] }
```
`CAPABILITY_TOKENS` reçoit un token supplémentaire : `photo_studio`.

### 7.5 i18n

~90 clés à ajouter dans les **6 locales** (`fr`, `en`, `de`, `es`, `it`, `pt`) — la structure
existe, c'est du remplissage, pas de l'architecture.

---

## 8. DATABASE_CHANGES

### NEW_TABLES_REQUIRED (12)

Toutes dans `hermes_os`, **RLS activée sans policy** (deny-all, accès par façades uniquement),
colonne `tenant_id text` + index `(tenant_id, …)`, exactement comme les tables existantes.

| Table | Contenu | Note GDPR |
|---|---|---|
| `photo_clients` | client, contacts, canal préféré, `client_lifetime_value`, `follow_up_date`, statut consentement | données personnelles standard |
| `photo_client_members` | membres de la famille, enfants, **dates importantes** | 🔴 **enfants** — minimisation stricte, prénom + mois/année seulement |
| `photo_sessions` | type, date, lieu, statut (machine à états §5), montants, liens devis/contrat/facture | |
| `photo_session_assets` | **référence** (chemin/URL chez elle), `proxy_path`, `file_sha256`, EXIF réduit (datetime, focale, ISO, vitesse, rafale) | **jamais de RAW** |
| `photo_culling_signals` | résultats passe 1 : netteté, clipping, pHash, `burst_group_id` | déterministe |
| `photo_culling_verdicts` | `KEEP_SUGGESTION` / `REJECTED_SUGGESTION` / `BEST_OF_SERIES`, score, motif, `human_decision` | **aucune suppression** |
| `photo_culling_instructions` | consignes NL horodatées, portée (séance / global / profil) | |
| `photo_style_profiles` | `PHOTOGRAPHER_STYLE_PROFILE` versionné par genre (mariage, famille, grossesse, naissance, portrait, événement) | |
| `photo_edit_jobs` | job XMP ou provider, `provider`, `profile_version`, statut, résultat | |
| `photo_galleries` | galerie externe (`provider`, `external_id`, `url`), statut, consultations, commandes | |
| `photo_upsell_opportunities` | type, déclencheur, score, montant estimé, statut, `revenue_generated_eur` | |
| `photo_media_consent` | **contrat copié de `peinture_media_consent`** : `use_cases_granted`, `media_types_granted`, `identity_scope`, `location_scope`, `granted_at`, `revoked_at`, `expires_at`, `proof` | 🔴 pilier GDPR |
| `photo_marketing_draft` | **contrat copié de `peinture_marketing_draft`** : brouillon → `approved_by` / `rejected_by` → `publish_result` | |

> 12 tables + 1 (`photo_marketing_draft`) = **13**. Aucune ne duplique une table générique :
> les tables `peinture_*` sont scopées `chantier_id` et ne peuvent pas porter une séance photo.
> Le **contrat** et les **fonctions** sont copiés, pas réinventés.

### NEW_RPC_REQUIRED (16 façades `public.*`)

Toutes : `SECURITY DEFINER`, `search_path` verrouillé, `REVOKE PUBLIC` / `GRANT authenticated`,
tenant résolu **serveur** par `resolve_active_tenant()`, fail-closed
(`UNAUTHENTICATED` / `NO_TENANT` → vide), **jamais** de `tenant_id` fourni par le client.

**Lecture (10)** — `get_photo_today`, `get_photo_sessions`, `get_photo_session_detail`,
`get_photo_client`, `get_photo_culling_review`, `get_photo_galleries`, `get_photo_revenue`,
`get_photo_marketing`, `get_photo_style_profile`, `get_photo_value_snapshot`.

**Écriture (6)** — `upsert_photo_session`, `register_photo_import`,
`record_photo_culling_signals` (batch, appelé par le navigateur),
`apply_photo_culling_review`, `record_photo_consent`, `upsert_photo_memory`.

**Interne `hermes_os` (3 services canoniques, une seule implémentation métier)** —
`hermes_os.compute_photo_session_state(session_id)` (machine à états),
`hermes_os.detect_photo_upsell_opportunities(tenant_id, as_of)` (SQL pur, **0 LLM**),
`hermes_os.verifier_consentement_photo(tenant, client, use_case, media_type)`
(copie de `peinture_verifier_consentement_media`).

### Modifications de tables existantes

**Aucune.** Seulement des **INSERT de configuration** :
`agent_action_catalog` (+22, `enabled=false` tant qu'aucun runner),
`resolver_runtime_config` (+6, une ligne par action à consumer, `enabled=false`),
`sw15_policies` (+8), `sw19_metric_definitions` (+4, voir §12),
`sw20_subscribers` (+10), `sw23_tenant_budget_config` (+1 tenant),
`component_registry` (+5), `tenant_platform_channel_config` (+N credential refs),
`tenant_module_activation` (+1).

---

## 9. N8N_WORKFLOWS_REQUIRED & EVENTS_REQUIRED

### 9.1 Consumers (6, tous `active:false` jusqu'au go-live explicite)

| Workflow | `action_key` claimés | Notes |
|---|---|---|
| `GW Consumer — Photo Culling` | `photo.culling.start`, `photo.session.purge` | SW23 route+reserve → Haiku 4.5 vision → commit/release ; `complete_agent_action` **6 args avec `lease_token`** |
| `GW Consumer — Photo Signature Edit` | `photo.edit.profile.learn`, `photo.edit.prepare` | chemin XMP par défaut ; provider via SW9 seulement si credential configuré |
| `GW Consumer — Photo Delivery` | `photo.export.prepare`, `photo.gallery.prepare`, `photo.gallery.publish` | gate SW15 obligatoire sur `publish` |
| `GW Consumer — Photo Client Comms` | `photo.client.message.prepare/send`, `photo.upsell.send`, `photo.review.request` | pont vers SW11, réutilise `sw11_idempotency_claim` |
| `GW Consumer — Photo Revenue` | `photo.upsell.propose` | la **détection** est SQL, seule la **rédaction** est ici |
| `GW Consumer — Photo Marketing` | `photo.marketing.prepare/publish` | gate consentement **avant** SW15 ; publication via le moteur `*_publication_requests` existant |

**Règles non négociables (déjà éprouvées sur BTP) :** chaque consumer ne claim **que son
propre `action_key`** ; `complete_agent_action` en **6 arguments** avec `lease_token`
(la signature 5 args n'existe plus) ; coût gouverné par SW23 uniquement.

### 9.2 Drivers / reaper : **0 nouveau workflow**

`resolver_runtime_config` et `claim_semantic_resolver_batch(action_key, lease)` sont **déjà
paramétrés par `action_key`**. Il suffit d'insérer 6 lignes de configuration
(`enabled=false`, `max_batch=3`, `max_concurrency=1`, `cadence_seconds=60`).
Le kill-switch, le disjoncteur (`resolver_circuit_evaluate`), le preflight fail-closed
(`resolver_enable_preflight`), le reaper de dead-letters et le control plane opérateur
**s'appliquent tels quels**. C'est le plus gros gain de non-duplication du projet.

### 9.3 EVENTS_REQUIRED (SW13 outbox → SW20)

Nomenclature alignée sur l'existant (`policy.denied`, `critic.passed`, …) :

`photo.lead.created` · `photo.session.created` · `photo.session.shot` ·
`photo.import.registered` · `photo.culling.pass1.completed` · `photo.culling.completed` ·
`photo.selection.approved` · `photo.edit.completed` · `photo.edit.approved` ·
`photo.gallery.published` · `photo.gallery.viewed` · `photo.order.placed` ·
`photo.payment.received` · `photo.upsell.detected` · `photo.review.received` ·
`photo.consent.granted` · `photo.consent.revoked` · `photo.followup.due`

Abonnés déclarés dans `sw20_subscribers` par `event_type_pattern` (`photo.*`,
`photo.gallery.*`, …). **Aucun polling, aucun scheduler métier.**

---

## 10. STORAGE_ARCHITECTURE

```
RAW (20-45 Mo/photo)   ──►  RESTE CHEZ ELLE (disque, NAS, son cloud)
                            Hermès stocke une RÉFÉRENCE + un sha256
        │
        ├─ aperçu JPEG embarqué extrait LOCALEMENT (navigateur)
        │
        ▼
PROXY 1600 px ~400 Ko  ──►  bucket privé `hermes-photo-proxies`
                            chemin : <tenant_id>/<session_id>/<asset_id>/p1600.jpg
                            RLS : foldername[1] = tenant (is_active_tenant_member)
                            lecture : URL signée TTL 300 s — jamais getPublicUrl
                            TTL : 90 jours après livraison → purge bornée
        │
        ▼
VIGNETTE 400 px ~40 Ko ──►  même bucket, affichage dashboard
```

**Volumétrie mesurée (hypothèse 8 séances/mois, 600 photos/séance)**

| Poste | Calcul | Volume |
|---|---|---|
| Proxies | 600 × 400 Ko | 240 Mo / séance |
| Vignettes | 600 × 40 Ko | 24 Mo / séance |
| Stationnaire (rétention 90 j) | 264 Mo × 8 × 3 | **≈ 6,3 Go** |
| Coût Supabase/R2 | 6,3 Go × 0,015 $ | **≈ 0,09 $/mois** |

**Garde-fous** : hard cap **25 Go/tenant** (au-delà : refus d'import + alerte, jamais de
suppression silencieuse) ; purge exécutée par la façade bornée existante
(patron `list_orphan_hermes_attachments` / `mark_hermes_attachment_deleted`) ;
`photo.session.purge` est **sensible et soumise à approbation**.

**Le RAW n'est téléchargé que si** un provider d'édition RAW est explicitement activé,
pour la seule sélection validée, en transit, sans persistance côté Hermès.

---

## 11. COST_MODEL

### 11.1 Coût IA par séance (600 photos brutes, 150 livrées)

| Poste | Détail | Coût |
|---|---|---|
| Routage NL | ~10 résolutions sémantiques × `gpt-5.4-nano` (1 500 in / 200 out) | **0,006 $** |
| Studio Director | SQL déterministe | **0,000 $** |
| Tri passe 1 | navigateur, WASM/canvas | **0,000 $** |
| Tri passe 2 | ~270 photos ambiguës, `claude-haiku-4-5` vision, **4 images/appel**, proxy 1024 px (≈ 950 tk/image) → 0,00145 $/image | **0,392 $** |
| Rédaction (concierge, upsell, marketing) | ~8 générations courtes Haiku (1 200 in / 500 out) | **0,030 $** |
| Signature Edit (XMP) | calcul déterministe depuis le profil | **0,000 $** |
| **TARGET_AI_COST_PER_SESSION** | | **≈ 0,43 $ (~0,39 €)** |
| Hard cap SW23 par séance | | **1,50 $** |

### 11.2 Coût mensuel par studio

| Poste | Montant |
|---|---|
| IA (8 séances) | 3,44 $ |
| Stockage proxies | 0,09 $ |
| APIs externes (BYO — compte de la photographe) | **0,00 $** |
| Infra amortie (Supabase + n8n OVH + hébergement) | 8-15 $ *(non amortie à 1 tenant — chiffre honnête : à un seul tenant, l'infra est un coût fixe complet, pas 8-15 $)* |
| **TOTAL_HERMES_COST** | **≈ 12-19 $/mois → 11-17 €** |

```
TARGET_COST_PER_SMALL_STUDIO      ≤ 25 €/mois      hard cap SW23 : 30 $/mois · 2 $/jour
TARGET_COST_PER_ACTIVE_SESSION    ≤ 0,60 €         hard cap : 1,50 $
TARGET_AI_COST_PER_SESSION        ≤ 0,45 $
TARGET_STORAGE_COST               ≤ 0,50 $/mois    hard cap : 25 Go/tenant
TARGET_EXTERNAL_API_COST          0 $ (BYO)        si add-on activé : refacturé à 100 %

ESTIMATED_COST_PER_SESSION        ≈ 0,39 €
ESTIMATED_COST_PER_CLIENT         ≈ 0,70 €/an  (1,5 séance + messagerie concierge)
```

### 11.3 TARGET_SUBSCRIPTION_MARGIN

| Tarif | Coût interne | Marge brute |
|---|---|---|
| **200 €/mois** (lancement) | ~15 € | **92,5 %** |
| **250 €/mois** (lancement) | ~15 € | **94,0 %** |
| **400 €/mois** (normal) | ~20 € | **95,0 %** |
| **500 €/mois** (normal) | ~20 € | **96,0 %** |

Marge cible tenue **sans compromis qualité**, parce que les postes coûteux
(édition provider, galerie, stockage RAW) restent sur les comptes de la photographe (D2).
Le seul risque de marge est l'activation d'un add-on d'édition non refacturé : c'est
verrouillé par un `HARD_LIMIT` SW23 et une approbation SW15 sur `photo.edit.prepare`.

---

## 12. MESURE DE LA VALEUR — `HERMES_VALUE_CREATED_EUR` / `HERMES_ROI`

**Aucun nouveau moteur.** SW19 fournit déjà les tables et 13 définitions de métriques,
dont `TIME_SAVED`, `REALIZED_VALUE_TOTAL`, `AI_COST_TOTAL`, `HUMAN_INTERVENTION_*`,
`AUTONOMY_RATE`. Il faut : **mesurer la baseline** et **ajouter 4 définitions**.

### 12.1 Baselines (mesurées en semaine 1, jamais inventées)

`sw19_baselines` reçoit, pour son studio, la durée réelle mesurée de :
`CULL_MINUTES_PER_100_PHOTOS`, `EDIT_MINUTES_PER_100_PHOTOS`,
`DELIVERY_MINUTES_PER_SESSION`, `ADMIN_MINUTES_PER_SESSION`, `CLIENT_RESPONSE_HOURS`.
`measurement_status` reste `MEASURED` ou la métrique est `UNAVAILABLE` — **jamais fabriquée**.

### 12.2 Métriques suivies dès le JOUR 1

| Métrique demandée | Source Hermès | Statut |
|---|---|---|
| `TIME_SAVED_MINUTES` | `TIME_SAVED` (SW19, existant) : baseline − durée réelle | ✅ existant |
| `TASKS_AUTOMATED` | `count(agent_action_requests where status='SUCCEEDED')` | ✅ existant |
| `SESSIONS_PROCESSED` | `photo_sessions` par statut terminal | nouveau (SQL) |
| `DELIVERY_TIME_REDUCTION` | `photo.session.shot` → `photo.gallery.published`, vs baseline | nouveau |
| `CLIENT_RESPONSE_TIME` | event entrant → `photo.client.message.send` | nouveau |
| `LEADS_CONVERTED` | `photo_leads` → `photo_sessions` | nouveau (SQL) |
| `UPSELL_OPPORTUNITIES` / `_ACCEPTED` | `photo_upsell_opportunities` | nouveau (SQL) |
| `UPSELL_REVENUE` / `REVENUE_GENERATED_BY_HERMES` | `sw19_value_events` (`is_realized=true`) + `sw19_attribution` | ✅ existant |
| `MANUAL_ACTIONS_AVOIDED` | actions réussies − interventions humaines | ✅ dérivé |
| `APPROVALS_REQUIRED` | `SW15_APPROVAL_REQUIRED_COUNT` | ✅ existant |
| `AI_COST` | `AI_COST_TOTAL` (SW19) + `sw23_budget_ledger` | ✅ existant |
| `TOTAL_HERMES_COST` | `sw19_roi_snapshots` (ventilé : IA / API / humain / autres) | ✅ existant |

**4 définitions à ajouter** dans `sw19_metric_definitions` :
`PHOTO_DELIVERY_LEAD_TIME`, `PHOTO_CULL_REVIEW_MINUTES`, `PHOTO_UPSELL_ACCEPT_RATE`,
`PHOTO_CLIENT_RESPONSE_HOURS`.

### 12.3 Formule (transparente, auditable, versionnée)

```
HERMES_VALUE_CREATED_EUR =
      Σ TIME_SAVED_MINUTES / 60 × TAUX_HORAIRE_STUDIO_EUR      ← temps
    + Σ sw19_value_events.value_amount WHERE is_realized=true    ← CA attribué
    − Σ sw19_human_interventions.duration_seconds / 3600 × TAUX  ← temps de supervision

HERMES_ROI = (HERMES_VALUE_CREATED_EUR − TOTAL_HERMES_COST_EUR) / TOTAL_HERMES_COST_EUR
```

Règles : `roi_formula_version` stocké sur chaque snapshot ; `TAUX_HORAIRE_STUDIO_EUR` est
**saisi par elle**, jamais deviné ; le **temps de supervision est soustrait** (sinon le ROI
est malhonnête) ; `sw19_check_attribution_cumulative()` (existant) empêche la double
attribution ; toute composante non mesurée est `UNAVAILABLE`, pas 0.

### 12.4 Projection de valeur (à valider par la mesure réelle)

| Poste | Avant | Après | Gain/séance |
|---|---|---|---|
| Tri 600 photos | ~2 h 30 | ~25 min de revue | **~2 h 05** |
| Préparation retouche 150 photos | ~1 h 40 | ~20 min | **~1 h 20** |
| Galerie, messages, relances, admin | ~1 h 00 | ~15 min | **~45 min** |
| **Total** | | | **≈ 4 h / séance** |

8 séances/mois → **≈ 32 h/mois**. À 45 €/h → **≈ 1 440 €/mois de valeur** pour 250 € →
**ROI ≈ 5,8×**. *Ces chiffres sont une projection ; seule la baseline mesurée en semaine 1
fera foi dans le dashboard.*

---

## 13. SECURITY_MODEL

Hérité intégralement de l'existant, plus 4 renforcements propres à la photo.

| Contrôle | Mécanisme | Statut |
|---|---|---|
| Isolation tenant | `resolve_active_tenant()` serveur ; **jamais** de `tenant_id` client ; RLS deny-all + façades | ✅ existant |
| Moindre privilège | `REVOKE PUBLIC` / `GRANT authenticated` ; `service_role` réservé aux consumers | ✅ existant |
| URLs signées | TTL 300 s ; `public=false` ; `getPublicUrl` interdit | ✅ patron existant |
| Chiffrement | TLS en transit, chiffrement au repos Supabase | ✅ |
| Journal d'audit | `agent_action_requests` + `get_action_audit_trail()` + `sw15_policy_audit` + `resolver_operator_audit` | ✅ existant |
| TTL fichiers temporaires | proxies 90 j, purge bornée idempotente | à câbler |
| Aucun bucket public | vérifié : 1 seul bucket, `public=false` | ✅ |
| Aucun secret dans un workflow | credentials n8n référencés, `credential_reference` en base | ✅ existant |
| Approbation avant action visible client | SW15 `REQUIRE_APPROVAL` sur 7 actions | à configurer |
| **Consentement** | `photo_media_consent` + `verifier_consentement_photo()` en **gate fail-closed** avant tout `marketing.*` | nouveau |
| **Photos d'enfants** | `identity_scope='NONE'` par défaut · consentement **explicite du représentant légal** obligatoire · aucune reconnaissance faciale · aucune publication sans double vérification consentement + SW15 | nouveau, strict |
| **Biométrie (clustering de visages)** | **désactivé par défaut** — voir R1 §14 | nouveau |
| Rétention / suppression / export | `photo_media_consent.expires_at` / `revoked_at` ; export par façade ; purge sur demande (droit à l'effacement) | à câbler |
| Accès limité aux images | aucune image ne quitte l'UE sans provider explicitement activé + DPA signé | politique |

**Fail-closed partout** : non authentifié, sans tenant, cross-tenant, action inconnue,
paramètre manquant, consentement absent ou expiré, budget dépassé, disjoncteur ouvert
⇒ **aucune exécution**, jamais d'exécution partielle silencieuse.

---

## 14. RISKS & BLOCKERS

### Risques

| # | Risque | Gravité | Mitigation |
|---|---|:--:|---|
| **R1** | **Biométrie / RGPD Art. 9.** « *Garde les photos des grands-parents* » implique une identification de personnes. Les gabarits faciaux sont des **données sensibles** ; les personnes photographiées ne sont pas les clientes d'Hermès. | 🔴 **Critique** | **P0 : désactivé.** Le tri P0 s'appuie sur des descripteurs de scène et le regroupement par rafale, pas sur l'identité. **P1 conditionnel** : clustering *sans identification* (pas de nommage automatique), modèle **auto-hébergé** (aucun transfert tiers), gabarits chiffrés + supprimés avec la séance, consentement explicite documenté, **revue juridique avant activation**. Si la revue ne conclut pas favorablement : la fonctionnalité est abandonnée, pas contournée. |
| **R2** | **Qualité du tri Hermès < Aftershoot.** Aucun benchmark ne peut être acheté : il faut prouver. | 🔴 Élevé | **SW17 shadow-mode** : semaines 1-2, Hermès trie en parallèle de son tri manuel sur 3 séances réelles ; métriques = rappel des « gardées » et taux de faux rejets. Seuil d'acceptation : **rappel ≥ 97 %** sur les photos qu'elle a gardées. Sous ce seuil → le tri reste assistant (regroupement, doublons) et la passe VLM est désactivée. |
| **R3** | **n8n bloqué (migration OVH).** 6 consumers non déployables. | 🟠 Moyen | §15 : la Phase 1 (60 % de la valeur pilote) ne dépend pas de n8n. |
| **R4** | **Pas d'API publique galerie/tri.** Intégrations par Zapier/webhook, contrat fragile. | 🟠 Moyen | Entrant seulement (webhooks Pic-Time) ; la création de galerie reste une étape humaine assistée au pilote ; aucun chemin critique ne dépend d'un connecteur non contractuel. **Aucun faux connecteur** n'est déclaré dans le registre. |
| **R5** | **Marge détruite si l'édition provider est incluse.** | 🟠 Moyen | D2 (BYO) + `HARD_LIMIT` SW23 + approbation SW15 sur `photo.edit.prepare`. |
| **R6** | **Bande passante d'import.** 600 RAW = ~18 Go ; un upload complet est inacceptable. | 🟠 Moyen | Extraction d'aperçu **locale** ; seuls ~264 Mo de proxies transitent (÷ 68). |
| **R7** | **Infra non amortie à 1 tenant.** Le coût réel par studio au pilote est le coût plein d'infra. | 🟢 Faible | Assumé et dit ; le modèle de marge vaut à partir de ~5 studios. |
| **R8** | **Biais mono-pilote.** Une seule photographe ≠ le marché. | 🟢 Faible | Ne figer aucun profil de style ni règle de tri en dur ; tout est en table, versionné par tenant. |
| **R9** | **Sur-approbation.** Si Hermès demande 15 validations/jour, elle décroche. | 🟠 Moyen | Cible : **≤ 5 validations/séance**. Les 4 messages transactionnels (confirmation, J-7, J-1, galerie prête) passent en allowlist après 2 semaines d'observation, si et seulement si aucun faux positif. |

### Blockers

| Blocker | Impact | Levée |
|---|---|---|
| **n8n OVH indisponible** | Bloque les 6 consumers (§9.1) | Hors de notre contrôle — Phase 1 avance sans |
| **Revue juridique consentement + mineurs** | Bloque tout `marketing.*` et R1 | Avant semaine 3 |
| **Comptes providers de la photographe** (Pic-Time, éventuellement Imagen) | Bloque galerie + édition premium | Semaine 1 de l'onboarding |
| **Baseline non mesurée** | Rend `HERMES_ROI` non calculable — **et il ne doit surtout pas être inventé** | Semaine 1 obligatoire |
| **Aucune donnée photo réelle** | Le tri ne peut être validé sur des fixtures | 3 séances réelles en semaine 2 |

---

## 15. PHASE_1_TO_BUILD_NOW — constructible **malgré** le blocage n8n

> Fondement : les 7 actions marquées *(SQL direct)* au §4 ont pour runner une **fonction
> Postgres**, pas un workflow. Et la passe 1 du tri tourne **dans le navigateur**.
> Résultat : la chaîne « séance → import → tri → validation » est **entièrement livrable
> sans n8n**, avec **0 $ de coût IA**.

### ✅ Constructible maintenant (aucun n8n, aucun go-live)

| # | Lot | Contenu | Dépend de n8n ? |
|---|---|---|---|
| 1 | **Schéma photo** | 13 tables + RLS deny-all + index (migration `_1` + rollback `_9`, **non appliquée**) | non |
| 2 | **Façades** | 10 lectures + 6 écritures + 3 services canoniques `hermes_os` | non |
| 3 | **Studio Director** | `compute_photo_session_state()` + branche informationnelle de l'orchestrateur (`ANSWER_ONLY`, 0 IA) | non |
| 4 | **Catalogue** | 22 actions insérées `enabled=false` (**jamais** d'action sans runner activée — la leçon `diag.echo` est intégrée) | non |
| 5 | **Runtime safety** | 6 lignes `resolver_runtime_config`, `enabled=false`, circuit `CLOSED` | non |
| 6 | **Policies SW15** | 8 politiques (`REQUIRE_APPROVAL` sur les 7 actions sortantes + `session.purge`) | non |
| 7 | **Budget SW23** | `sw23_tenant_budget_config` du tenant photo : **2 $/jour, 30 $/mois, `hard_stop=true`** | non |
| 8 | **Bucket proxies** | `hermes-photo-proxies` privé + RLS `tenant/session` + façades finalize/link/orphelins | non |
| 9 | **Import & proxies** | extraction d'aperçu + génération proxy/vignette **côté navigateur**, upload direct signé | non |
| 10 | **Tri passe 1** | netteté (variance de Laplacien), clipping histogramme, **pHash** (doublons/similaires), regroupement rafale par EXIF ; écriture par `record_photo_culling_signals` | non |
| 11 | **UI de revue** | grille clavier (garder / écarter / comparer la série), consignes NL enregistrées | non |
| 12 | **Dashboard** | profil `photographe`, 7 widgets, token `photo_studio`, i18n × 6 | non |
| 13 | **Mesure** | baselines SW19 + 4 définitions de métriques + `get_photo_value_snapshot()` | non |
| 14 | **Consentement** | `photo_media_consent` + `verifier_consentement_photo()` + UI de saisie | non |
| 15 | **Tests** | tests SQL d'isolation (patron `db/tests/*.test.sql`) + tests unitaires purs (patron `tests/*.test.ts`) | non |

**Valeur livrée sans n8n : le tri (le poste n°1 de douleur), la vue séance unifiée, la
mémoire client, le consentement et la mesure de valeur.** Soit **~60 % de la valeur du pilote**.

### ⏸ En attente de n8n OVH

- Passe 2 du tri (VLM) — sans elle, le tri reste déterministe : utile, mais moins fin.
- `photo.edit.*` (génération XMP en lot, orchestration provider).
- `photo.gallery.*` (préparation et publication).
- `photo.client.message.*`, `photo.upsell.send`, `photo.review.request` (SW11).
- `photo.marketing.*` (Agent 7 / Agent 8).
- Activation des drivers bornés (et même alors : `enabled=false` jusqu'à un go-live explicite).

---

## 16. 2_MONTH_PILOT_PLAN

### WEEK_1 — Mesurer avant d'automatiser
- Onboarding tenant (SW24) ; connexion de ses comptes (Pic-Time, stockage) via `credential_reference`.
- **Mesure des baselines** : elle chronomètre 2 séances complètes (tri, retouche, livraison, admin). **Rien n'est automatisé cette semaine.**
- Import des 12 derniers mois de clients/séances → `photo_clients`, `photo_sessions` (mémoire fondatrice).
- Livrer : lots 1-8 + 12 (schéma, façades, Studio Director, dashboard).
- **Critère de sortie** : elle pose 10 questions en langage naturel sur son activité et obtient 10 réponses justes, à coût IA nul.

### WEEK_2 — Le tri en shadow-mode
- Livrer lots 9-11, 14, 15 (import, proxies, tri passe 1, revue, consentement).
- **SW17 shadow-mode sur 3 séances réelles** : elle trie normalement, Hermès trie en parallèle, on compare.
- **Critère de sortie (bloquant)** : rappel ≥ 97 % sur ses « gardées ». Sinon → R2, on n'active pas la passe VLM.

### WEEK_3 — Le tri en production + Signature Edit
- Tri Hermès comme premier passage réel sur ses nouvelles séances.
- Construction du `PHOTOGRAPHER_STYLE_PROFILE` à partir de ses XMP existants (mariage + famille d'abord).
- Génération de sidecars XMP sur 1 séance, comparaison A/B avec sa retouche manuelle.
- Revue juridique consentement/mineurs (blocker).
- *Si n8n est revenu* : déploiement des consumers Culling + Signature Edit, `enabled=false`, preflight, puis activation contrôlée.
- **Critère de sortie** : temps de tri divisé par ≥ 3 ; XMP jugés « bon point de départ » sur ≥ 70 % des photos.

### WEEK_4 — Livraison et concierge
- Galerie : préparation + contrôle SW16 + approbation + notification.
- Webhooks Pic-Time entrants (consultation, commande) → `photo_galleries`.
- 4 messages transactionnels (confirmation, J-7, J-1, galerie prête) en `REQUIRE_APPROVAL`.
- **Critère de sortie** : délai shooting → galerie divisé par ≥ 2 ; 0 message parti sans son accord.

### MONTH_2 — Revenus, mémoire, marketing
- **S5** : `detect_photo_upsell_opportunities()` sur ses 12 mois d'historique → premières propositions (album, anniversaire, séance famille), toutes soumises à approbation.
- **S6** : mémoire avancée (membres de famille, dates clés, préférences, LTV) + relances futures.
- **S7** : marketing (sélection Instagram/carrousel/story + légendes), **gate consentement** actif, `APPROVAL_REQUIRED` sur chaque publication ; demandes d'avis.
- **S8** : bilan ROI auditable, passage des 4 messages transactionnels en allowlist **si et seulement si** 0 faux positif observé ; décision go/no-go commercial.

---

## 17. PILOT_SUCCESS_CRITERIA

Le pilote est **réussi** si, en fin de mois 2, **tous** ces seuils sont atteints :

| Critère | Seuil | Source (auditable) |
|---|---|---|
| Temps gagné | **≥ 3 h par séance** vs baseline mesurée | `TIME_SAVED` (SW19) |
| Temps de tri | **÷ 3 minimum** | `PHOTO_CULL_REVIEW_MINUTES` vs baseline |
| Qualité du tri | **rappel ≥ 97 %** sur ses gardées | comparaison SW17 |
| Délai de livraison | **÷ 2 minimum** | `PHOTO_DELIVERY_LEAD_TIME` |
| CA détecté | **≥ 1 500 €** d'opportunités, **≥ 1 acceptée** | `photo_upsell_opportunities` + `sw19_value_events` |
| Coût interne | **≤ 25 €/mois** | `get_cost_governance_snapshot()` |
| ROI | **≥ 4×**, formule auditable | `sw19_roi_snapshots` |
| Charge de validation | **≤ 5 approbations/séance** | `SW15_APPROVAL_REQUIRED_COUNT` |
| Sécurité | **0** message/publication parti sans approbation · **0** photo supprimée automatiquement · **0** fuite cross-tenant | `get_action_audit_trail()`, tests d'isolation |
| **Test décisif** | Elle répond **oui** à : « *Accepteriez-vous de revenir à votre méthode d'avant ?* » → **non** | entretien |

Le pilote est **en échec** si le tri est sous le seuil de rappel, ou si la charge de
validation dépasse 10/séance : dans les deux cas, le produit ajoute du travail au lieu d'en
retirer, et il faut corriger avant d'élargir.

---

## 18. Ce qui a été explicitement évité

| Anti-pattern | Décision |
|---|---|
| Sur-architecture | 5 nouveaux agents (dont 1 sans runner), pas 8 ; 22 actions dont 8 en P0 |
| Agents décoratifs | `PHOTO_CLIENT_CONCIERGE`, `PHOTO_GROWTH`, `PHOTO_MEMORY` **supprimés** — ce sont SW11/SW3/Agent 6/7/8 |
| Second orchestrateur | Le Studio Director est une **projection SQL**, pas un orchestrateur |
| LLM là où le déterministe suffit | État de séance, détection d'upsell, tri passe 1, alertes, ROI : **100 % SQL/navigateur** |
| Polling | Aucun — SW13 outbox + SW20, drivers bornés au tick |
| Scheduler permanent | Aucun — les rappels J-7/J-1 sont des events datés |
| Stockage massif | Aucun RAW durable ; ~6 Go de proxies, TTL 90 j |
| Suppression automatique de photo | **Impossible par construction** : seulement `REJECTED_SUGGESTION`, jamais de DELETE |
| Publication automatique | `REQUIRE_APPROVAL` + gate consentement fail-closed |
| Faux connecteurs | Aucun connecteur non contractuel déclaré ; les APIs absentes sont dites absentes |
| Fournisseur imposé | Aucun choix définitif ; benchmark §6 + architecture provider-agnostic (SW9) |
| Duplication | Runtime-safety, approbations, coûts, ROI, events, comms, consentement, publication : **tout réutilisé** |
| Go-live | **NON.** Rien n'est déployé, activé, ni appliqué. |

---

## 19. Recommandation d'ordre de priorité

Le cahier des charges propose P0 → P1 → P2. **Deux ajustements sont recommandés**, avec leur justification :

1. **Remonter le consentement média en P0** (il était implicitement en P2 avec le marketing).
   Sans consentement enregistré dès la première séance, tout le module marketing sera
   inexploitable au mois 2 — le consentement se collecte **au moment du shooting**, pas
   rétroactivement. Coût : une table + un formulaire. Bénéfice : débloque tout le P2.

2. **Remonter la mesure des baselines en P0, en semaine 1, avant toute automatisation.**
   C'est contre-intuitif (aucune valeur visible la première semaine) mais c'est la seule
   fenêtre où la baseline est mesurable. Sans elle, `HERMES_ROI` n'existe pas — et un ROI
   inventé disqualifierait le produit auprès de la seule personne qu'il doit convaincre.

Le reste de l'ordre proposé est confirmé : le tri **est** le bon point d'entrée. C'est la
douleur n°1, c'est mesurable en une semaine, et c'est ce qui n'a **pas** d'API achetable —
donc c'est là que se construit la barrière à l'entrée.

---

**FIN DU RAPPORT — `GO_LIVE = NO` · aucune modification de production · arrêt ici.**

### Sources externes (benchmark, août 2026 — à revérifier au contrat)

- [Aftershoot](https://aftershoot.com/) · [Roadmap 2026](https://aftershoot.com/roadmap-2026/) · [Aftershoot devient un workflow complet (Fstoppers)](https://fstoppers.com/software/aftershoot-just-became-entire-ai-photography-workflow-903026)
- [Imagen AI — API développeurs](https://imagen-ai.com/solution/photo-editor-api-for-developers/) · [Tarifs Imagen AI](https://imagen-ai.com/pricing/) · [Analyse tarifaire](https://filterpixel.com/imagen-ai-pricing)
- [Adobe Firefly Services — Lightroom API](https://developer.adobe.com/firefly-services/docs/lightroom/release-notes) · [Tarification Firefly API 2026](https://sudomock.com/blog/adobe-firefly-api-pricing-2026)
- [FilterPixel vs Narrative Select](https://filterpixel.com/filterpixel-vs-narrative-select) · [Comparatif outils de tri 2026](https://tovstudiophoto.com/ai-culling-tools-aftershoot-narrative-filterpixel-2026/)
- [Pic-Time + Zapier](https://pages.pic-time.com/zapier-integration) · [Intégrations Pic-Time](https://zapier.com/apps/pic-time/integrations) · [Pixieset sur Zapier (indisponible)](https://zapier.com/apps/pixieset/integrations)
- [Comparatif plateformes galeries 2026](https://tovstudiophoto.com/best-client-gallery-platforms-compared/) · [Pic-Time vs Pixieset](https://picflow.com/compare/pic-time-vs-pixieset)
- [Cloudflare R2 vs S3 vs Backblaze B2](https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/) · [Tarifs Backblaze B2](https://www.backblaze.com/cloud-storage/pricing)
