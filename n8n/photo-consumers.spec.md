# Consumers n8n — verticale Hermès Studio (PHOTO-P0)

**Statut : SPÉCIFICATION UNIQUEMENT. Aucun workflow n'est créé, importé ni activé.**

## Pourquoi une spécification et pas un fichier `.workflow.js`

Les autres consumers de ce dossier (`hermes-btp-suivi.workflow.js`, …) sont des
**graphes réellement déployés**, validés contre n8n via les outils MCP du SDK, puis
consignés ici. Le n8n OVH étant indisponible, aucun graphe ne peut être validé
aujourd'hui : publier un JSON non validé donnerait l'illusion d'un artefact prêt
alors qu'il serait, au mieux, plausible.

Ce document fixe donc le **contrat** que chaque consumer devra respecter. Le graphe
sera écrit et consigné au format habituel quand n8n sera de nouveau joignable.

## Contrat commun (non négociable, éprouvé sur BTP)

1. **Trigger manuel, `active: false`.** Aucun Schedule tant qu'un opérateur n'a pas
   fait la mise en service explicite.
2. **Claim action-scopé** : `hermes_os.claim_agent_action('<action_key>', <lease>)`.
   Un consumer ne peut jamais voler la requête d'un autre.
3. **Complétion fencée à 6 arguments** :
   `complete_agent_action(id, status, result, error, execution_id, lease_token)`.
   La signature à 5 arguments n'existe plus ; un worker dont le bail a été repris
   ne peut pas écraser une requête réattribuée.
4. **Gate SW15 avant tout effet** : le consumer ne procède que sur `PERMIT`
   (ce qui inclut une requête `PENDING` approuvée par un administrateur).
5. **Coût gouverné par SW23 uniquement** :
   `sw23_set_session_tenant` → `sw23_route_and_reserve` → appel modèle →
   `sw23_commit_budget` (succès) / `sw23_release_budget` (échec). Aucun second
   registre de coût, aucun montant forfaitaire.
6. **Sûreté d'exécution réutilisée telle quelle** : le driver borné passe par
   `hermes_os.claim_semantic_resolver_batch('<action_key>', <lease>)`, déjà
   paramétré par `action_key`. Kill-switch, `max_batch`, `max_concurrency`,
   disjoncteur, preflight et reaper s'appliquent sans une ligne de code nouvelle.
   Les configurations sont déjà seedées (`enabled = false`) par le lot 5.
7. **Fail-closed** : séance absente → `NO_SESSION` ; consentement absent ou expiré
   → refus ; budget dépassé → `HARD_LIMIT` ; toute erreur → `FAILED` avec un code,
   jamais un succès partiel silencieux.

## Les six consumers

| Workflow | `action_key` claimés | Effet | Garde spécifique |
|---|---|---|---|
| **GW Consumer — Photo Culling** | `photo.culling.start` | Passe 2 (VLM) sur le reliquat ambigu, **sur proxies uniquement** ; écrit des verdicts `pass_no = 2` | Ne lit JAMAIS un RAW. Cap SW23 : 1,50 $/séance. Aucun DELETE. |
| **GW Consumer — Photo Signature Edit** | `photo.edit.profile.learn`, `photo.edit.prepare` | Génère les sidecars XMP depuis `photo_style_profiles` ; délègue à un provider BYO si un `credential_reference` existe | `photo.edit.prepare` est `REQUIRE_APPROVAL` dès qu'un provider payant est retenu |
| **GW Consumer — Photo Delivery** | `photo.export.prepare`, `photo.gallery.prepare`, `photo.gallery.publish` | Export → brouillon de galerie → contrôle SW16 → publication | `publish` ne s'exécute jamais sans approbation SW15 |
| **GW Consumer — Photo Client Comms** | `photo.client.message.send`, `photo.upsell.send`, `photo.review.request` | Pont vers SW11 (email/SMS/WhatsApp) | Réutilise `sw11_idempotency_claim` — pas de second moteur d'envoi |
| **GW Consumer — Photo Revenue** | `photo.upsell.propose` | Rédige une proposition depuis une opportunité **déjà détectée en SQL** | La détection reste `hermes_os.detect_photo_upsell_opportunities` (0 LLM) |
| **GW Consumer — Photo Marketing** | `photo.marketing.prepare`, `photo.marketing.publish` | Sélection + légende, puis publication | Gate `hermes_os.verifier_consentement_photo` **avant** SW15 ; publication via le moteur `*_publication_requests` existant |

## Checklist de mise en service (par action, dans cet ordre)

1. Déployer le workflow, **inactif**, et relever son `workflow_id`.
2. Renseigner `agent_action_catalog.target_workflow_id` pour l'action concernée.
   *La leçon `diag.echo` : une action ne doit jamais être activée sans runner réel.*
3. Enregistrer le composant dans `component_registry` (non fait en Phase 1 pour ne
   pas gonfler le compteur « composants enregistrés » du dashboard).
4. Passer la politique SW15 correspondante de `DISABLED` à `ACTIVE`.
5. Passer `agent_action_catalog.enabled` à `true`.
6. Exécuter `hermes_os.resolver_enable_preflight('<action_key>')` et n'activer la
   configuration d'exécution que si `ready = true`.
7. Activer l'abonné SW20 correspondant.

Chaque étape est réversible indépendamment ; l'étape 5 est le seul point de
bascule qui rend une action réellement exécutable.
