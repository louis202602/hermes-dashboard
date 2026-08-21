-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / 5 — Capacités PV DORMANTES + politiques SW15.
-- (project smubxqorirlfldatzmym)
--
-- Ce lot n'ACTIVE rien. Il fait l'inverse de ce que fait une activation : il pose
-- la POLITIQUE D'APPROBATION AVANT que la capacité existe, pour qu'aucune fenêtre
-- de temps ne puisse exister entre « l'action devient appelable » et « l'action
-- devient gouvernée ».
--
-- 1. CAPACITÉS — `enabled = false`, `is_sensitive = true`, `target_workflow_id`
--    NULL. `hermes_os.request_agent_action` filtre `enabled = true` et répond
--    `UNKNOWN_ACTION` sinon : ces trois actions sont donc INEXÉCUTABLES, y compris
--    par un appelant authentifié et autorisé. Corollaire voulu :
--    `get_available_capabilities()` ne les renvoie pas ⇒ aucun widget, profil ou
--    menu ne peut s'appuyer dessus.
--
-- 2. POLITIQUES SW15 — `ACTIVE` + `REQUIRE_APPROVAL`. C'est l'inverse du choix
--    fait pour la verticale photo (politiques `DISABLED`), et c'est délibéré :
--    une politique DISABLED ne gouverne rien. Ici la politique est déjà en
--    vigueur, donc le jour où un opérateur passera `enabled = true`, la première
--    exécution partira DÉJÀ en approbation humaine.
--
--    ⚠️ PORTÉE — vérifiée, pas supposée : `hermes_os.gateway_policy_gate` filtre
--    `p.tenant_id = v_req.tenant_id`. Une politique à `tenant_id = null` ne serait
--    donc JAMAIS sélectionnée — elle serait décorative. Les trois politiques sont
--    par conséquent scopées au seul tenant réel (`heliosolar`), exactement comme
--    les trois politiques BTP activées en Phase 1.
--    Pour tout AUTRE tenant, la protection n'est pas perdue pour autant : le
--    correctif Phase 1 rend la passerelle FAIL-CLOSED — une action
--    `is_sensitive = true` sans politique correspondante part en
--    `REQUIRE_APPROVAL`. La posture est donc REQUIRE_APPROVAL partout, par
--    politique explicite chez `heliosolar` et par défaut fail-closed ailleurs.
--
-- 3. AUCUN PERMIT. Il n'existe et ne doit exister aucune politique `PERMIT`
--    ACTIVE sur une action `pv.*`. C'est une assertion testée (`db/tests/pv2_facades.test.sql`).
--
-- 4. AUCUN CONSUMER. `resolver_runtime_config` reçoit trois lignes
--    `enabled = false`, circuit `CLOSED` : `claim_semantic_resolver_batch` renvoie
--    DISABLED / 0 claim. Aucun runner, aucun scheduler, aucun workflow n8n n'est
--    créé, lu, modifié ou activé par ce lot — le quota n8n Cloud est bloqué et
--    n8n reste hors périmètre.
--
-- 5. `component_registry` N'EST PAS TOUCHÉ, pour la même raison qu'au lot photo :
--    `get_platform_health()` compte toutes ses lignes sans filtre de visibilité.
--    Y déclarer des agents PV qui n'existent pas dans n8n changerait un chiffre
--    affiché sur le dashboard. C'est une étape de go-live, pas de PV-2.

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalogue — 3 capacités PV, TOUTES dormantes et sensibles.
--    `required_payload_keys` = schéma de payload STRICT : la passerelle refuse
--    une requête dont il manque une clé. Chaque action est bornée à UN objet
--    métier — aucune ne prend d'identifiant de tenant.
-- ---------------------------------------------------------------------------
insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id, target_agent,
   required_permission, required_payload_keys, enabled, is_sensitive,
   nl_enabled, nl_keywords, nl_primary_slot, nl_help_text)
values
  ('pv.bill.extract',
   'Lire une facture d''énergie (Agent 4)',
   'Lit le document privé d''une facture et écrit une LECTURE dans pv_energy_bill_extractions, avec sa confiance. N''écrit jamais dans pv_energy_bills et ne peut pas produire VERIFIED.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['bill_id'],
   false, true, false, array[]::text[], null,
   'Agent 4 — Analyse Facture EDF. DORMANTE : aucun workflow n8n cible, aucun consumer.'),

  ('pv.study.prepare',
   'Préparer une étude photovoltaïque (Agent 5)',
   'Prépare une étude en DRAFT / CALCULATED / NEEDS_REVIEW à partir du site, de la consommation et des factures VERIFIED. Ne peut pas produire VALIDATED.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['site_id'],
   false, true, false, array[]::text[], null,
   'Agent 5 — Bureau d''Études PV. DORMANTE : aucun workflow n8n cible, aucun consumer.'),

  ('pv.economics.compute',
   'Calculer le chiffrage économique d''une étude (Agent 5)',
   'Calcule un chiffrage en DRAFT / CALCULATED / NEEDS_REVIEW à partir des hypothèses typées de l''étude. Ne peut pas produire VERIFIED, ni émettre un devis ou un engagement.',
   'N8N_WORKFLOW', null, null, 'tenant.member', array['study_id'],
   false, true, false, array[]::text[], null,
   'Agent 5 — Bureau d''Études PV. DORMANTE : aucun workflow n8n cible, aucun consumer.')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Sûreté d'exécution — trois lignes DÉSACTIVÉES. Réutilisation intégrale du
--    moteur existant (kill-switch, plafonds, disjoncteur, reaper) : aucune
--    mécanique de runtime-safety n'est réécrite ici.
-- ---------------------------------------------------------------------------
insert into hermes_os.resolver_runtime_config
  (action_key, enabled, max_batch, max_concurrency, cadence_seconds, circuit_state)
values
  ('pv.bill.extract',      false, 2, 1, 120, 'CLOSED'),
  ('pv.study.prepare',     false, 2, 1, 300, 'CLOSED'),
  ('pv.economics.compute', false, 2, 1, 300, 'CLOSED')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Politiques SW15 — ACTIVE / REQUIRE_APPROVAL, scopées au tenant réel.
--    `sw15_policies` n'a AUCUNE contrainte d'unicité : `on conflict` n'y
--    protégerait de rien. L'anti-jointure sur `policy_name` rend donc ce lot
--    réellement rejouable — même leçon qu'au lot photo.
--    L'insertion est CONDITIONNELLE à l'existence du tenant : si `heliosolar`
--    n'existe pas, rien n'est écrit (et rien ne casse).
-- ---------------------------------------------------------------------------
insert into hermes_os.sw15_policies
  (policy_name, tenant_id, action_pattern, effect, priority, status, require_dual_approval)
select v.* from (values
  ('PV lecture facture IA',      'heliosolar', 'pv.bill.extract',      'REQUIRE_APPROVAL', 10, 'ACTIVE', false),
  ('PV preparation etude IA',    'heliosolar', 'pv.study.prepare',     'REQUIRE_APPROVAL', 10, 'ACTIVE', false),
  ('PV chiffrage economique IA', 'heliosolar', 'pv.economics.compute', 'REQUIRE_APPROVAL', 10, 'ACTIVE', false)
) as v(policy_name, tenant_id, action_pattern, effect, priority, status, require_dual_approval)
where exists (select 1 from hermes_os.tenants t where t.tenant_id = v.tenant_id)
  and not exists (
    select 1 from hermes_os.sw15_policies p where p.policy_name = v.policy_name
  );

commit;
