-- PHOTO-P0 / 5 — Registres de configuration, TOUS DORMANTS.
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO.
--
-- Ce lot n'ACTIVE rien. Preuve, ligne par ligne :
--
--   * `agent_action_catalog` : chaque ligne est insérée `enabled = false`. Or
--     `hermes_os.request_agent_action` filtre explicitement
--     `where action_key = … and enabled = true` et répond `UNKNOWN_ACTION`
--     sinon. Une action photo est donc INEXÉCUTABLE, y compris par un appelant
--     authentifié et autorisé, tant qu'un opérateur ne l'a pas activée.
--     Corollaire voulu : `get_available_capabilities()` ne les renvoie pas, donc
--     aucun widget, profil ou menu photo n'apparaît côté dashboard.
--
--   * `resolver_runtime_config` : `enabled = false`, circuit `CLOSED`. La garde
--     `claim_semantic_resolver_batch(action_key, lease)` est DÉJÀ paramétrée par
--     action_key — on réutilise donc telle quelle toute la sûreté d'exécution
--     existante (kill-switch, plafonds, disjoncteur, preflight, reaper, control
--     plane opérateur) sans écrire une seule ligne de runtime-safety.
--
--   * `sw15_policies` : `status = 'DISABLED'` (même posture que les politiques
--     SW18 déjà en base). Elles décrivent la doctrine d'approbation cible ;
--     elles ne gouvernent rien tant qu'un opérateur ne les passe pas ACTIVE.
--
--   * `sw20_subscribers` : `status = 'DISABLED'` — aucun événement photo n'est
--     routé.
--
--   * `sw19_metric_definitions` : 4 définitions ADDITIVES. Elles ne modifient
--     aucune métrique existante et ne produisent aucune valeur par elles-mêmes.
--
--   * `sw23_tenant_budget_config` : insertion CONDITIONNELLE (le tenant doit
--     exister) et `on conflict do nothing` — un budget déjà configuré par un
--     opérateur n'est JAMAIS écrasé.
--
-- NON FAIT VOLONTAIREMENT — `component_registry` :
--   `get_platform_health()` compte TOUTES les lignes de `component_registry`
--   sans filtre de visibilité. Y déclarer 5 agents photo qui n'existent pas
--   encore dans n8n changerait un chiffre affiché sur le dashboard (« composants
--   enregistrés »). L'enregistrement des composants est donc une étape de
--   go-live, à faire quand les workflows existent réellement.

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalogue des capacités photo — TOUTES `enabled = false`.
--    `target_workflow_id` reste NULL : le runner n8n n'existe pas encore
--    (blocage OVH). L'activation d'une ligne EXIGE d'y renseigner d'abord son
--    workflow — c'est la leçon `diag.echo` (une action sans agent réel).
-- ---------------------------------------------------------------------------
insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id, target_agent,
   required_permission, required_payload_keys, enabled, is_sensitive,
   nl_enabled, nl_keywords, nl_primary_slot, nl_help_text)
values
  ('photo.culling.start',
   'Lancer le tri IA d''une séance (photo)',
   'Passe 2 du tri : analyse VLM du reliquat ambigu, sur proxies uniquement. Coût gouverné par SW23.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['session_id'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Culling ». DORMANT.'),

  ('photo.edit.profile.learn',
   'Apprendre le style de la photographe (photo)',
   'Met à jour le PHOTOGRAPHER_STYLE_PROFILE à partir de retouches validées.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['genre'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Signature Edit ». DORMANT.'),

  ('photo.edit.prepare',
   'Préparer la retouche signature (photo)',
   'Génère les sidecars XMP depuis le profil de style, ou délègue à un provider BYO.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['session_id'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Signature Edit ». DORMANT.'),

  ('photo.export.prepare',
   'Préparer l''export des photos validées (photo)',
   'Prépare les livrables JPEG de la sélection approuvée.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['session_id'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Delivery ». DORMANT.'),

  ('photo.gallery.prepare',
   'Préparer la galerie client (photo)',
   'Construit le brouillon de galerie et le soumet au contrôle qualité SW16.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['session_id'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Delivery ». DORMANT.'),

  ('photo.gallery.publish',
   'Publier la galerie et notifier le client (photo)',
   'Action SORTANTE visible par le client : publication de la galerie + notification.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['gallery_id'],
   false, true, false, array[]::text[], null,
   'Approbation humaine obligatoire (SW15). DORMANT.'),

  ('photo.client.message.send',
   'Envoyer un message au client (photo)',
   'Action SORTANTE : envoi via SW11 (email/SMS/WhatsApp), idempotent.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['client_id', 'template_key'],
   false, true, false, array[]::text[], null,
   'Approbation humaine obligatoire (SW15). DORMANT.'),

  ('photo.upsell.propose',
   'Rédiger une proposition commerciale (photo)',
   'Transforme une opportunité détectée en brouillon de proposition. N''envoie rien.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['opportunity_id'],
   false, true, false, array[]::text[], null,
   'Requiert le consumer « GW Consumer — Photo Revenue ». DORMANT.'),

  ('photo.upsell.send',
   'Envoyer une proposition commerciale (photo)',
   'Action SORTANTE commerciale.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['opportunity_id'],
   false, true, false, array[]::text[], null,
   'Approbation humaine obligatoire (SW15). DORMANT.'),

  ('photo.marketing.prepare',
   'Préparer un contenu marketing (photo)',
   'Sélection + légende. Refus fail-closed si le consentement média est absent ou expiré.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['session_id', 'canal'],
   false, true, false, array[]::text[], null,
   'Gate consentement obligatoire. DORMANT.'),

  ('photo.marketing.publish',
   'Publier un contenu marketing (photo)',
   'Action SORTANTE publique.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['draft_id'],
   false, true, false, array[]::text[], null,
   'Approbation humaine + consentement valide obligatoires. DORMANT.')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Sûreté d'exécution — RÉUTILISATION intégrale du moteur existant.
--    Une ligne par action consommée par un runner. `enabled = false` ⇒
--    `claim_semantic_resolver_batch` renvoie DISABLED / 0 claim.
-- ---------------------------------------------------------------------------
insert into hermes_os.resolver_runtime_config
  (action_key, enabled, max_batch, max_concurrency, cadence_seconds, circuit_state)
values
  ('photo.culling.start',       false, 2, 1, 60,  'CLOSED'),
  ('photo.edit.prepare',        false, 2, 1, 120, 'CLOSED'),
  ('photo.export.prepare',      false, 2, 1, 120, 'CLOSED'),
  ('photo.gallery.prepare',     false, 2, 1, 120, 'CLOSED'),
  ('photo.client.message.send', false, 5, 1, 60,  'CLOSED'),
  ('photo.marketing.prepare',   false, 2, 1, 300, 'CLOSED')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Doctrine d'approbation SW15 — DISABLED.
--    Règle : tout ce qui est INTERNE est PERMIT ; tout ce qui est VISIBLE PAR UN
--    CLIENT ou PUBLIC exige une approbation humaine. `photo.session.purge` n'est
--    pas listée : la purge est une façade appelable, jamais un agent.
-- ---------------------------------------------------------------------------
insert into hermes_os.sw15_policies
  (policy_name, tenant_id, action_pattern, effect, priority, status, require_dual_approval)
select v.* from (values
  ('PHOTO culling interne',        null, 'photo.culling.start',       'PERMIT',           20, 'DISABLED', false),
  ('PHOTO apprentissage style',    null, 'photo.edit.profile.learn',  'PERMIT',           20, 'DISABLED', false),
  ('PHOTO préparation retouche',   null, 'photo.edit.prepare',        'REQUIRE_APPROVAL', 20, 'DISABLED', false),
  ('PHOTO export interne',         null, 'photo.export.prepare',      'PERMIT',           20, 'DISABLED', false),
  ('PHOTO galerie brouillon',      null, 'photo.gallery.prepare',     'PERMIT',           20, 'DISABLED', false),
  ('PHOTO publication galerie',    null, 'photo.gallery.publish',     'REQUIRE_APPROVAL', 10, 'DISABLED', false),
  ('PHOTO envoi client',           null, 'photo.client.message.send', 'REQUIRE_APPROVAL', 10, 'DISABLED', false),
  ('PHOTO proposition brouillon',  null, 'photo.upsell.propose',      'PERMIT',           20, 'DISABLED', false),
  ('PHOTO envoi commercial',       null, 'photo.upsell.send',         'REQUIRE_APPROVAL', 10, 'DISABLED', false),
  ('PHOTO marketing brouillon',    null, 'photo.marketing.prepare',   'PERMIT',           20, 'DISABLED', false),
  ('PHOTO publication marketing',  null, 'photo.marketing.publish',   'REQUIRE_APPROVAL', 10, 'DISABLED', false)
) as v(policy_name, tenant_id, action_pattern, effect, priority, status, require_dual_approval)
-- `sw15_policies` n'a pas de contrainte d'unicité : `on conflict` n'y protège de
-- rien. L'anti-jointure rend donc ce lot réellement rejouable.
where not exists (
  select 1 from hermes_os.sw15_policies p where p.policy_name = v.policy_name
);

-- ---------------------------------------------------------------------------
-- 4. Bus d'événements SW20 — DISABLED. Aucun polling, aucun scheduler : les
--    rappels datés sont des événements à `occurred_at` futur dans l'outbox SW13.
-- ---------------------------------------------------------------------------
insert into hermes_os.sw20_subscribers
  (subscriber_name, tenant_id, event_type_pattern, consumer_type, target, status,
   max_attempts, timeout_ms, ordering_required)
select v.* from (values
  ('PHOTO — Studio Director (état séance)', null, 'photo.session.*',  'n8n_workflow', 'PHOTO_STUDIO_DIRECTOR', 'DISABLED', 3, 15000, false),
  ('PHOTO — Tri',                            null, 'photo.culling.*',  'n8n_workflow', 'PHOTO_CULLING',         'DISABLED', 3, 30000, false),
  ('PHOTO — Livraison',                      null, 'photo.gallery.*',  'n8n_workflow', 'PHOTO_DELIVERY',        'DISABLED', 3, 30000, true),
  ('PHOTO — Revenus',                        null, 'photo.upsell.*',   'n8n_workflow', 'PHOTO_REVENUE',         'DISABLED', 3, 15000, false),
  ('PHOTO — Consentement',                   null, 'photo.consent.*',  'n8n_workflow', 'PHOTO_MEMORY',          'DISABLED', 3, 15000, true)
) as v(subscriber_name, tenant_id, event_type_pattern, consumer_type, target, status,
        max_attempts, timeout_ms, ordering_required)
-- Même raison que pour SW15 : pas de contrainte d'unicité en base.
where not exists (
  select 1 from hermes_os.sw20_subscribers x where x.subscriber_name = v.subscriber_name
);

-- ---------------------------------------------------------------------------
-- 5. Métriques SW19 — ADDITIVES. Les métriques existantes (TIME_SAVED,
--    REALIZED_VALUE_TOTAL, AI_COST_TOTAL, HUMAN_INTERVENTION_*, AUTONOMY_RATE)
--    sont RÉUTILISÉES telles quelles et ne sont pas touchées ici.
-- ---------------------------------------------------------------------------
insert into hermes_os.sw19_metric_definitions
  (metric_key, name, description, unit, category, source_type,
   calculation_method, aggregation_method, measurement_status, tenant_scope)
values
  ('PHOTO_CULL_MINUTES_PER_100', 'Temps de tri pour 100 photos',
   'Baseline mesurée en semaine 1 puis temps réel de revue. Jamais estimée.',
   'minutes', 'TIME', 'MEASURED',
   'observed_review_duration / photos_reviewed * 100', 'AVG', 'MEASURED', 'GLOBAL'),

  ('PHOTO_DELIVERY_LEAD_TIME', 'Délai shooting → galerie livrée',
   'Écart entre photo.session.shot et photo.gallery.published.',
   'hours', 'TIME', 'DERIVED',
   'gallery_published_at - shot_at', 'AVG', 'DERIVED', 'GLOBAL'),

  ('PHOTO_UPSELL_ACCEPT_RATE', 'Taux d''acceptation des propositions',
   'Opportunités acceptées / opportunités proposées.',
   'ratio', 'CONVERSION', 'DERIVED',
   'COUNT(status=ACCEPTED)/COUNT(status IN (PROPOSED,ACCEPTED,DECLINED))', 'RATE', 'DERIVED', 'GLOBAL'),

  ('PHOTO_CLIENT_RESPONSE_HOURS', 'Délai de réponse au client',
   'Écart entre le message entrant et la réponse envoyée.',
   'hours', 'LATENCY', 'DERIVED',
   'first_outbound_at - inbound_at', 'AVG', 'DERIVED', 'GLOBAL')
on conflict (metric_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Budget SW23 du tenant photo — plafonds DURS du rapport §11.
--    Conditionnel : n'insère que si le tenant existe, et n'écrase JAMAIS un
--    budget déjà posé par un opérateur. Remplacer 'photo-pilote' par le vrai
--    tenant_id au moment de l'onboarding.
-- ---------------------------------------------------------------------------
insert into hermes_os.sw23_tenant_budget_config
  (tenant_id, daily_budget_usd, monthly_budget_usd, per_request_budget_usd,
   alert_threshold_pct, hard_stop)
select t.tenant_id, 2.00, 30.00, 1.50, 80, true
  from hermes_os.tenants t
 where t.tenant_id = 'photo-pilote'
on conflict (tenant_id) do nothing;

commit;
