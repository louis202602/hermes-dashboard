-- 20260819_phase1_security_1_gateway_fail_closed.sql
-- PHASE 1 — SÉCURISATION DU SOCLE. Correctif du BLOCKER B2 de l'audit READ-ONLY.
-- Applied to project smubxqorirlfldatzmym. Idempotent (CREATE OR REPLACE).
--
-- ÉTAT CONSTATÉ (avant) — hermes_os.gateway_policy_gate(uuid) :
--   1. ne sélectionne que les politiques `sw15_policies.status = 'ACTIVE'` ;
--   2. quand AUCUNE politique ne correspond, applique `v_effect := 'PERMIT'` — donc
--      FAIL-OPEN ;
--   3. `agent_action_catalog.is_sensitive` n'intervient PAS dans la décision.
--   Or les 13 politiques en base sont toutes `DISABLED` ⇒ dans les faits, TOUTES les
--   actions — y compris `btp.qualification.create`, `btp.planning.phase.add` et
--   `btp.suivi.progress.report`, marquées `is_sensitive = true` — étaient
--   automatiquement PERMISES, sans aucune approbation humaine.
--
-- COMPORTEMENT CIBLE (après) — FAIL-CLOSED sur les actions sensibles :
--
--   is_sensitive = true
--     politique ACTIVE 'DENY'              -> DENY
--     politique ACTIVE 'REQUIRE_APPROVAL'  -> REQUIRE_APPROVAL
--     politique ACTIVE 'PERMIT'            -> PERMIT   (autonomie INTENTIONNELLE :
--                                            elle exige une ligne sw15_policies
--                                            explicite, ACTIVE, dans la fenêtre de
--                                            validité, et scopée au tenant. Le motif
--                                            enregistré est distinct et gréppable.)
--     aucune politique                     -> REQUIRE_APPROVAL   <-- LE CORRECTIF
--
--   is_sensitive = false
--     politique ACTIVE                     -> effet de la politique
--     aucune politique                     -> PERMIT  (défaut conservé — DÉCISION
--       DOCUMENTÉE, cf. ci-dessous)
--
-- POURQUOI LE DÉFAUT `PERMIT` RESTE ACCEPTABLE POUR UNE ACTION NON SENSIBLE :
--   `is_sensitive = false` est une déclaration explicite du catalogue : l'action n'a
--   aucun effet métier, contractuel, financier ni sortant. Les deux seules actions
--   dans ce cas aujourd'hui sont `diag.echo` (renvoie son payload, aucun effet) et
--   `hermes.intent.resolve` (produit une PROPOSITION ; l'exécution réelle repasse par
--   `apply_hermes_resolution` puis par cette même passerelle, où l'action cible est
--   réévaluée avec SA propre sensibilité). Exiger une approbation humaine sur ces deux
--   actions bloquerait la boucle de résolution sans aucun gain de sécurité.
--   Le garde-fou reste : c'est le CATALOGUE qui décide, et le catalogue n'est
--   modifiable que par une migration.
--
-- FAIL-CLOSED SUR ACTION INCONNUE : si `action_key` n'a plus de ligne de catalogue
--   (action retirée ou renommée après la mise en file), `is_sensitive` est traité
--   comme TRUE. Une requête orpheline ne peut donc pas devenir autonome par accident.
--
-- LIMITE CONNUE, VOLONTAIREMENT NON MODIFIÉE ICI (aucune régression) :
--   la sélection de politique reste strictement scopée `p.tenant_id = v_req.tenant_id`.
--   Les politiques à `tenant_id IS NULL` (les 13 lignes photo, toutes DISABLED) ne
--   correspondent donc jamais. Élargir le matching aux politiques globales
--   ÉLARGIRAIT la surface d'autonomie (des PERMIT globaux deviendraient effectifs) :
--   c'est l'inverse de l'objectif de cette phase. À traiter séparément, si besoin,
--   quand les verticales concernées sortiront de dormance.
--
-- AUCUNE AUTRE MODIFICATION : le court-circuit « approuvé par un humain », la
--   sélection/ordonnancement des politiques, la création de la demande d'approbation
--   SW15 et les valeurs de retour ('NOT_FOUND'/'DENY'/'REQUIRE_APPROVAL'/'PERMIT')
--   sont identiques à l'existant.
--
-- Réversible : 20260819_phase1_security_9_rollback.sql

create or replace function hermes_os.gateway_policy_gate(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_req       hermes_os.agent_action_requests%rowtype;
  v_effect    text;
  v_policy    uuid;
  v_sensitive boolean;
  v_reason    text;
  v_ar        uuid;
begin
  select * into v_req from hermes_os.agent_action_requests where id = p_id;
  if not found then return 'NOT_FOUND'; end if;

  -- Court-circuit inchangé : une approbation humaine déjà accordée fait foi.
  if v_req.approved_by is not null then
    perform hermes_os.record_agent_action_policy(p_id, 'PERMIT', 'Human-approved');
    return 'PERMIT';
  end if;

  -- Sensibilité canonique de l'action. Action absente du catalogue => sensible.
  select c.is_sensitive into v_sensitive
    from hermes_os.agent_action_catalog c
   where c.action_key = v_req.action_key;
  v_sensitive := coalesce(v_sensitive, true);

  -- Sélection de politique : inchangée (tenant-scopée, ACTIVE, fenêtre de validité,
  -- DENY > REQUIRE_APPROVAL > PERMIT puis priorité décroissante).
  select p.effect, p.policy_id into v_effect, v_policy
  from hermes_os.sw15_policies p
  where p.tenant_id = v_req.tenant_id
    and p.status = 'ACTIVE'
    and (p.valid_from is null or p.valid_from <= now())
    and (p.valid_until is null or p.valid_until >= now())
    and v_req.action_key like replace(p.action_pattern, '*', '%')
  order by case p.effect
             when 'DENY'             then 0
             when 'REQUIRE_APPROVAL' then 1
             when 'PERMIT'           then 2
             else 3
           end,
           p.priority desc nulls last
  limit 1;

  if v_effect is null then
    if v_sensitive then
      -- LE CORRECTIF B2 : plus jamais de PERMIT implicite sur une action sensible.
      v_effect := 'REQUIRE_APPROVAL';
      v_reason := 'SW15 FAIL-CLOSED : action sensible sans politique explicite';
    else
      v_effect := 'PERMIT';
      v_reason := 'SW15 défaut PERMIT (action non sensible, catalogue is_sensitive=false)';
    end if;
  elsif v_effect = 'PERMIT' and v_sensitive then
    v_reason := 'SW15 PERMIT EXPLICITE (autonomie intentionnelle sur action sensible)';
  else
    v_reason := 'SW15 policy ' || v_effect;
  end if;

  if v_effect = 'DENY' then
    perform hermes_os.record_agent_action_policy(p_id, 'DENY', v_reason);
    return 'DENY';

  elsif v_effect = 'REQUIRE_APPROVAL' then
    if v_req.approval_request_id is null then
      v_ar := gen_random_uuid();
      insert into hermes_os.sw15_approval_requests
        (approval_request_id, tenant_id, request_id, action, policy_id,
         required_approvals, status, created_at, expires_at)
      values (v_ar, v_req.tenant_id, v_req.request_id, v_req.action_key, v_policy,
              1, 'PENDING', now(), now() + interval '7 days');
      update hermes_os.agent_action_requests set approval_request_id = v_ar where id = p_id;
    end if;
    perform hermes_os.record_agent_action_policy(p_id, 'REQUIRE_APPROVAL', v_reason);
    return 'REQUIRE_APPROVAL';

  else
    perform hermes_os.record_agent_action_policy(p_id, 'PERMIT', v_reason);
    return 'PERMIT';
  end if;
end;
$function$;

comment on function hermes_os.gateway_policy_gate(uuid) is
  'SW15 decision gate. FAIL-CLOSED depuis 20260819_phase1_security_1 : une action '
  'agent_action_catalog.is_sensitive=true sans politique SW15 ACTIVE correspondante '
  'retourne REQUIRE_APPROVAL (jamais PERMIT). Une action non sensible conserve le '
  'défaut PERMIT (décision documentée dans la migration).';
