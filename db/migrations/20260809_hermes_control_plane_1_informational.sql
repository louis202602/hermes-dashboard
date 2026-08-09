-- Migration: hermes_conversational_informational_layer (project smubxqorirlfldatzmym)
-- Hermès Conversational Control Plane — informational (read-only) layer.
-- Deterministic, tenant/user-scoped ANSWER_ONLY answers derived from REAL data:
-- capability discovery (permission-aware), pending approvals, last-action status.
-- No execution, no parallel gateway. Reversible.

create or replace function hermes_os._hermes_informational(p_uid uuid, p_tenant text, p_message text)
returns text
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_low text := lower(coalesce(p_message,''));
  v_j jsonb; v_n int; v_list text; r record;
begin
  -- 1) Pending approvals (read-only, reuses the existing tenant-scoped reader).
  if v_low ~ 'approb' then
    v_j := hermes_os.list_pending_agent_approvals();
    if coalesce((v_j->>'ok')::boolean,false) then
      v_n := jsonb_array_length(coalesce(v_j->'approvals','[]'::jsonb));
      if v_n = 0 then
        return 'Aucune approbation en attente pour votre tenant.';
      end if;
      select string_agg(coalesce(a->>'summary', a->>'action_key'), ' ; ')
        into v_list from jsonb_array_elements(v_j->'approvals') a;
      return v_n||' demande(s) en attente d''approbation : '||coalesce(v_list,'')||
             '. Traitez-les dans « Approbations en attente » ci-dessous.';
    end if;
    return 'Aucune approbation visible pour votre profil.';
  end if;

  -- 2) Last action status (this user; excludes the internal resolve action).
  if v_low ~ '(derni[eè]re action|dernier statut|o[uù] en est|statut de (mon|ma)|mon action|ma demande|dernier r[eé]sultat)' then
    select coalesce(c.display_name, r0.action_key) as name, r0.status as st, r0.created_at as ca
      into r
      from hermes_os.agent_action_requests r0
      left join hermes_os.agent_action_catalog c on c.action_key = r0.action_key
      where r0.user_id = p_uid and r0.tenant_id = p_tenant and r0.action_key <> 'hermes.intent.resolve'
      order by r0.created_at desc limit 1;
    if not found then
      return 'Vous n''avez lancé aucune action récemment.';
    end if;
    return 'Votre dernière action : « '||r.name||' » — statut '||r.st||
           ' (le '||to_char(r.ca,'DD/MM/YYYY HH24:MI')||').';
  end if;

  -- 3) Capability discovery, PERMISSION-AWARE (derived from the registry).
  if v_low ~ '(peux[- ]tu faire|que tu peux faire|qu.est[- ]ce que tu peux|que peux[- ]tu|de quoi es[- ]tu capable|quelles? (actions?|capacit)|que sais[- ]tu|tes capacit|liste des actions|actions disponibles|capacit[eé]s? disponibles|disponibles pour moi)' then
    select string_agg(c.display_name||' — '||coalesce(c.description,''), E'\n' order by c.display_name)
      into v_list
      from hermes_os.agent_action_catalog c
      where c.enabled = true and c.nl_enabled = true
        and exists (select 1 from hermes_os.user_tenant_permissions p
                    where p.user_id = p_uid and p.tenant_id = p_tenant and p.permission = c.required_permission);
    if v_list is null then
      return 'Vous n''avez accès à aucune action pour le moment sur ce tenant.';
    end if;
    return 'Voici les actions que vous pouvez lancer : '||E'\n'||v_list||
           E'\n\nDécrivez votre demande en langage naturel.';
  end if;

  return null;
end;
$function$;

revoke all on function hermes_os._hermes_informational(uuid,text,text) from public;
