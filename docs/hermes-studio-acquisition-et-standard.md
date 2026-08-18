# Hermès Studio — Acquisition & Standard téléphonique (P1)

État : **architecture + code préparatoire**. Rien n'est activé, aucune migration
P1 n'est appliquée, aucun appel réel n'est possible. `GO_LIVE = NO`.

---

## 1. Ce qui existait déjà — audit, pas supposition

Interrogé en lecture seule sur la base de production.

| Composant | `stable_id` | Actif ? | Ce qu'il fait réellement |
| :-- | :-- | :-- | :-- |
| Agent 2 | `agent_2_crm_notion` | oui | **CRM Notion IA** — connecteur vers un CRM **externe**. Côté Postgres : uniquement des verrous (`agent2_contact_lock`, `agent2_request_lock`, `agent2_update_lock`) et `agent2_audit_log`. |
| Agent 7 | `agent_7_directeur_marketing` | oui | Stratégie, Brand DNA, publicité **en brouillons uniquement**. « Appelable uniquement par SW4. » |
| Agent 8 | `agent_8_community_manager` | oui | Community management & réputation. |
| Agent 9 | `agent_9_telephone` | oui | Téléphone IA **sortant**. Porte déjà : validation, **consentement/opposition**, idempotence, horaires, quotas/plafonds (3 modes), **adaptateur fournisseur**, coûts, journalisation, alertes, **délégation CRM**. |
| Agent 10 | `agent_10_telephonie_entrant` | oui | Téléphonie IA **entrante**. « Brouillon V1 : identification appelant uniquement. **Blocage externe : credential Retell et Google Calendar absents.** » Possède `agent10_call_index`. |

Deux conséquences directes, qui décident de toute l'architecture :

1. **Le fournisseur téléphonique est déjà tranché dans Hermès : Retell.** Agent 10
   est bloqué *sur son credential*, pas sur un choix à faire. Proposer un autre
   fournisseur serait réouvrir une décision déjà prise et déjà câblée.
2. **Agent 9 a déjà l'abstraction fournisseur** (« adaptateur fournisseur
   simulation déterministe ») et le socle consentement/quotas/coûts. Le standard
   entrant doit s'y adosser, pas le réécrire.

### Pourquoi `photo_leads` n'est *pas* un second CRM

Hermès **n'a aucune table de leads générique**. Le patron réel du dépôt est
**une table prospects par verticale** : `peinture_prospects` (21 colonnes),
`immo_prospects` (12 colonnes). `photo_leads` suit ce patron, et délègue la
synchronisation externe au même Agent 2 via `crm_external_id` — miroir exact de
`peinture_prospects.crm_notion_page_id`.

---

## 2. Matrice de réutilisation

| Capacité | Composant Hermès existant | Décision | Justification |
| :-- | :-- | :-- | :-- |
| Stockage des leads | `peinture_prospects` / `immo_prospects` (patron) | **NEW** (même patron) | Aucune table générique n'existe ; chaque verticale a la sienne. |
| Synchronisation CRM externe | Agent 2 (Notion) | **REUSE** | `crm_external_id` délègue ; on ne réécrit pas le connecteur. |
| Déduplication / verrous | `agent2_contact_lock`, `agent2_request_lock` | **REUSE** | Déjà atomiques et éprouvés. |
| Campagnes & contenu | Agent 7 (brouillons), Agent 8 | **REUSE** | Agent 7 produit déjà des brouillons publicitaires sous garde-fous. |
| Envois (e-mail/SMS/WhatsApp) | SW11 (`sw11_idempotency_claim/complete`) | **REUSE** | Idempotence d'envoi déjà résolue. |
| Webhooks fournisseur téléphonie | `sw11_webhook_event_claim/complete` | **REUSE** | Exactement le contrat d'un webhook d'appel (provider, event_id, hash, bail). |
| Approbations des envois sensibles | SW15 | **REUSE** | 11 policies photo déjà seedées (DISABLED). |
| Événements | SW20 + outbox SW13 | **REUSE** | 5 abonnés photo déjà seedés (DISABLED). |
| ROI / valeur | SW19 (`sw19_baselines`, `sw19_human_interventions`) | **REUSE** | 4 métriques photo déjà seedées. |
| Budgets & coûts | SW23 (`sw23_commit_budget`) | **REUSE** | Plafonds durs déjà en place. |
| Mémoire | SW3 | **REUSE** | Aucune mémoire propre à la verticale. |
| Sûreté d'exécution | `resolver_runtime_config` | **REUSE** | Kill-switch/disjoncteur déjà paramétrés par `action_key`. |
| Téléphonie entrante | Agent 10 | **EXTEND** | Verticalisation par profil, pas nouvel agent. `photo_calls.call_id` référence `agent10_call_index`. |
| Adaptateur fournisseur | Agent 9 | **REUSE** | L'abstraction existe ; on ne s'enferme pas sur un fournisseur. |
| Scoring de lead | — | **NEW** | Aucun scoring commercial n'existe. Déterministe, 0 LLM. |
| Entonnoir CAC/ROAS | — | **NEW** | Aucun calcul d'acquisition n'existe. |

---

## 3. Actions à créer (toutes dormantes)

Vérifié : le catalogue ne contient **aucune** action `lead.*`, `campaign.*` ou
`phone.*`. Les 10 actions ci-dessous sont donc réellement nouvelles — aucun
doublon.

| `action_key` | Sortante ? | Approbation SW15 cible |
| :-- | :-- | :-- |
| `photo.lead.capture` | non | PERMIT |
| `photo.lead.qualify` | non | PERMIT |
| `photo.lead.followup.prepare` | non (prépare un brouillon) | PERMIT |
| `photo.campaign.prepare` | non | PERMIT |
| `photo.campaign.analyze` | non | PERMIT |
| `photo.phone.answer` | — (entrant) | PERMIT |
| `photo.phone.qualify` | non | PERMIT |
| `photo.phone.callback` | **oui** | REQUIRE_APPROVAL |
| `photo.phone.transfer` | **oui** | REQUIRE_APPROVAL |
| `photo.phone.summarize` | non | PERMIT |

L'envoi effectif d'une relance réutilise `photo.client.message.send`, **déjà au
catalogue** (dormante, REQUIRE_APPROVAL) : on ne crée pas de second canal
d'envoi.

---

## 4. Architecture téléphonique proposée

| Choix | Valeur | Pourquoi |
| :-- | :-- | :-- |
| `TELEPHONY_PROVIDER` | **Retell AI** | Déjà le fournisseur câblé de l'Agent 10 ; le blocage est le credential, pas la décision. Gère nativement barge-in et tours de parole. |
| `STT_PROVIDER` | Deepgram Nova-2 (via Retell) | Français solide, streaming, latence partielle ~100–200 ms. |
| `TTS_PROVIDER` | ElevenLabs Flash / Turbo (via Retell) | Le plus naturel en français à cette latence ; priorité n° 1 du brief. |
| `LLM_ROUTING` | **SW23** — modèle rapide par défaut, escalade sur ambiguïté | Le routeur coût/modèle existe déjà ; aucun routage parallèle à créer. |
| `FALLBACK_PROVIDER` | Twilio (transport) + adaptateur Agent 9 | L'abstraction fournisseur d'Agent 9 évite le verrouillage ; un second transport reste branchable. |
| `EXPECTED_LATENCY` | **~800 ms – 1,2 s** de tour de parole | Objectif de conception, **non mesuré** : aucun appel réel n'a eu lieu. |
| `ESTIMATED_COST_PER_MINUTE` | **~0,10 – 0,18 USD/min** | Ordre de grandeur (transport + STT + TTS + LLM), **non contractuel**, à confirmer sur facture réelle. |

> Ces deux dernières lignes sont des **estimations d'architecture**, pas des
> mesures. Elles ne doivent pas être présentées comme des engagements tant
> qu'un appel réel n'a pas été facturé.

**Aucun secret ne descend dans ce dépôt** : les credentials vivent côté n8n /
Retell. L'application Next.js ne détient que la clé publiable Supabase — c'est
la même règle que celle documentée dans `lib/voice/README.md`.

### `lib/voice/` n'est pas réutilisable ici — et c'est normal

Le module `lib/voice/` est une couche **navigateur** (Web Speech API) pour le
chat du tableau de bord. Il n'a ni téléphonie, ni barge-in, ni latence
téléphonique, et ne détient volontairement aucun secret fournisseur. Le
standard téléphonique est un problème différent : il vit côté n8n/Retell.

---

## 5. Comportement conversationnel — tenu par du code, pas par un prompt

Implémenté dans `lib/photo/phoneConversation.ts`, testé dans
`tests/photo-phone.test.ts`.

- **Un seul créneau demandé à la fois**, dans l'ordre d'une vraie conversation :
  projet (prestation → date → lieu) **avant** identité (prénom → téléphone),
  puis confort (budget → e-mail). Le scénario du brief est un test :
  après « mon mariage le 12 juin », l'agent enchaîne sur le **secteur**.
- **Le nom de famille n'est jamais demandé** (minimisation RGPD).
- **Anti-hallucination structurelle** : répondre sur un tarif exige *à la fois*
  l'autorisation du studio *et* une donnée réelle en base. Une prestation sans
  `price_from_eur` et sans `quotable_by_phone` n'est pas citable — le modèle ne
  peut pas contourner une absence de ligne.
- **Ordre de décision** : sécurité humaine → incertitude → périmètre →
  conversation. Une réclamation mal entendue reste une réclamation.
- **Sans numéro de transfert, on promet un rappel**, jamais un transfert qui
  échouerait.

---

## 6. Anti-spam des relances

Les plafonds sont appliqués **en base** (`hermes_os.photo_followups_due`) *et*
en TypeScript, avec un test qui vérifie que les deux ne divergent pas :

- opposition (`opted_out`) honorée ;
- 72 h minimum entre deux relances, tous motifs confondus ;
- 1 relance par motif ;
- 3 relances maximum par lead ;
- abandon après 45 jours.

Aucune relance n'est **envoyée** par ces fonctions : elles listent ce qui est
*dû*. L'envoi reste une action sortante sous approbation SW15.

---

## 7. Honnêteté des chiffres

`cost`, `cac` et `roas` valent **`null`** — et jamais `0` — quand la dépense de
campagne n'est pas renseignée. Afficher « CAC : 0 € » pour une campagne sans
budget saisi serait un chiffre faux ; `null` se rend « non mesuré ».

---

## 8. Ce qui reste bloqué

| Bloqué | Par quoi |
| :-- | :-- |
| Appels réels | Credential Retell absent (blocage constaté sur Agent 10) |
| Consultation d'agenda pendant l'appel | Credential Google Calendar absent (même constat) |
| Exécution des 10 actions | n8n (aucun consumer), + actions dormantes |
| Mesure réelle de latence et de coût/minute | Aucun appel réel autorisé |
| Pilote | Tenant Vanessa inexistant |
