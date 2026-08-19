-- 20260819_phase2_hygiene_1_stale_queue_ttl.sql
-- PHASE 2 — HYGIÈNE DU SOCLE. Mécanisme d'expiration des requêtes gateway orphelines.
-- Idempotent (CREATE OR REPLACE). Ne modifie AUCUNE ligne à l'application.
--
-- PROBLÈME MESURÉ. 11 requêtes sont `QUEUED` depuis le 10 août :
--   10 × hermes.intent.resolve · 1 × btp.qualification.create
--   toutes avec attempts = 0, policy_decision NULL, approval_request_id NULL.
-- Aucune n'a jamais été réclamée : aucun consumer n8n n'est actif et
-- `resolver_runtime_config.enabled = false` sur les 7 clés. Elles resteront
-- QUEUED indéfiniment, tout en étant comptées comme « file en attente » par
-- `get_action_audit_trail` et scannées par chaque sondage du dashboard.
--
-- CAUSE RACINE. Elle est EXTERNE (quota n8n Cloud bloqué) et hors du périmètre
-- de cette phase. Ce lot ne prétend donc pas la corriger : il fournit le
-- mécanisme d'hygiène qui manquait — une file sans consumer n'avait aucune
-- porte de sortie, même manuelle.
--
-- CE QUI EST PRÉSERVÉ. La ligne, son `payload`, son `payload_hash`, son
-- `created_at`, son `correlation_id` et toute sa piste d'audit restent intacts.
-- Seuls `status`, `error` et `finished_at` changent. Aucune suppression, jamais.
-- L'idempotence du gateway est donc conservée : rejouer le même
-- (tenant_id, request_id) reste un IDEMPOTENT_HIT sur la même ligne.
--
-- ⚠️ CE LOT N'EXÉCUTE PAS LA FONCTION. Les 11 requêtes réelles ne sont PAS
-- touchées par la migration. L'expiration est une décision d'exploitation
-- explicite, à déclencher par un opérateur.
--
-- Réversible : 20260819_phase2_hygiene_9_rollback.sql

create or replace function hermes_os.expire_stale_queued_agent_actions(
  p_older_than interval default interval '30 days',
  p_action_key text default null,
  p_limit integer default 100
)
returns table(id uuid, tenant_id text, action_key text, request_id text, age_days integer)
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_cutoff timestamptz := now() - greatest(coalesce(p_older_than, interval '30 days'), interval '1 hour');
  v_row record;
begin
  -- Seules les requêtes JAMAIS réclamées sont concernées : `attempts = 0` et
  -- aucune décision de politique. Une requête en cours de traitement, en
  -- attente d'approbation, ou déjà décidée n'est jamais touchée.
  for v_row in
    select r.id, r.tenant_id, r.action_key, r.request_id, r.correlation_id, r.user_id, r.created_at
      from hermes_os.agent_action_requests r
     where r.status = 'QUEUED'
       and coalesce(r.attempts, 0) = 0
       and r.policy_decision is null
       and r.approval_request_id is null
       and r.created_at < v_cutoff
       and (p_action_key is null or r.action_key = p_action_key)
     order by r.created_at
     limit v_limit
     for update skip locked
  loop
    update hermes_os.agent_action_requests
       set status      = 'FAILED',
           error       = jsonb_build_object(
                           'code', 'STALE_NO_CONSUMER',
                           'message', 'Requête expirée : aucun runner ne l''a réclamée avant la limite d''âge.',
                           'expired_at', now(),
                           'age_days', floor(extract(epoch from (now() - v_row.created_at)) / 86400)::int),
           finished_at = now(),
           updated_at  = now()
     where agent_action_requests.id = v_row.id;

    perform hermes_os._agent_action_audit(
      v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
      v_row.correlation_id, 'EXPIRED_STALE',
      jsonb_build_object('age_days', floor(extract(epoch from (now() - v_row.created_at)) / 86400)::int));

    id := v_row.id;
    tenant_id := v_row.tenant_id;
    action_key := v_row.action_key;
    request_id := v_row.request_id;
    age_days := floor(extract(epoch from (now() - v_row.created_at)) / 86400)::int;
    return next;
  end loop;
end;
$function$;

-- Exploitation seulement : ni `anon`, ni `authenticated`. Même posture que les
-- autres fonctions de maintenance du gateway (reap_dead_letter_agent_actions).
revoke all on function hermes_os.expire_stale_queued_agent_actions(interval, text, integer) from public;
grant execute on function hermes_os.expire_stale_queued_agent_actions(interval, text, integer) to service_role;

comment on function hermes_os.expire_stale_queued_agent_actions(interval, text, integer) is
  'PHASE 2 — marque FAILED/STALE_NO_CONSUMER les requêtes QUEUED jamais réclamées et plus vieilles que p_older_than. Ne supprime rien : payload, hash, dates et audit sont conservés. Ne touche jamais une requête réclamée, en attente d''approbation ou déjà décidée.';
