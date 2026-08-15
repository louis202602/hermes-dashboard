-- DASH-4A (hardening) — server-side JSONB guards on the preferences upsert.
-- (project smubxqorirlfldatzmym)
--
-- Defense-in-depth: the frontend clamps, but the DB must NOT trust the client.
-- Adds a payload size ceiling and per-sub-object type checks so an authenticated
-- user cannot stash multi-MB blobs or non-object junk in this table. Idempotent
-- CREATE OR REPLACE of the same signature (the rollback already drops it).
begin;

create or replace function public.upsert_dashboard_user_preferences(
  p_patch jsonb,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_current integer;
  v_new integer;
  -- MAX_PREFS_PAYLOAD_BYTES: generous for appearance/behavior/regional and future
  -- layout/profiles (DASH-4B/C), tiny vs any abuse vector.
  c_max_bytes constant integer := 16384;
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'status', coalesce(v_status,'NO_TENANT'));
  end if;

  -- Payload must be a JSON object …
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok',false,'status','BAD_PAYLOAD');
  end if;
  -- … within a sane size ceiling …
  if octet_length(p_patch::text) > c_max_bytes then
    return jsonb_build_object('ok',false,'status','PAYLOAD_TOO_LARGE');
  end if;
  -- … and every present sub-object must itself be a JSON object.
  if (p_patch ? 'appearance' and jsonb_typeof(p_patch->'appearance') <> 'object')
     or (p_patch ? 'behavior' and jsonb_typeof(p_patch->'behavior') <> 'object')
     or (p_patch ? 'regional' and jsonb_typeof(p_patch->'regional') <> 'object')
     or (p_patch ? 'layout'   and jsonb_typeof(p_patch->'layout')   <> 'object')
     or (p_patch ? 'profiles' and jsonb_typeof(p_patch->'profiles') <> 'object') then
    return jsonb_build_object('ok',false,'status','BAD_PAYLOAD');
  end if;

  select version into v_current from hermes_os.dashboard_user_preferences
    where user_id = v_uid and tenant_id = v_tenant;

  if not found then
    -- First write: expected must be 0.
    if coalesce(p_expected_version,-1) <> 0 then
      return jsonb_build_object('ok',false,'status','VERSION_CONFLICT','version',0);
    end if;
    insert into hermes_os.dashboard_user_preferences(
      user_id, tenant_id, appearance, behavior, regional, layout, profiles, schema_version, version, updated_at)
    values (v_uid, v_tenant,
      coalesce(p_patch->'appearance','{}'::jsonb),
      coalesce(p_patch->'behavior','{}'::jsonb),
      coalesce(p_patch->'regional','{}'::jsonb),
      coalesce(p_patch->'layout','{}'::jsonb),
      coalesce(p_patch->'profiles','{}'::jsonb),
      coalesce((p_patch->>'schema_version')::int, 1), 1, now());
    return jsonb_build_object('ok',true,'status','OK','version',1);
  end if;

  if p_expected_version is distinct from v_current then
    return jsonb_build_object('ok',false,'status','VERSION_CONFLICT','version',v_current);
  end if;

  v_new := v_current + 1;
  update hermes_os.dashboard_user_preferences set
    appearance = case when p_patch ? 'appearance' then p_patch->'appearance' else appearance end,
    behavior   = case when p_patch ? 'behavior'   then p_patch->'behavior'   else behavior end,
    regional   = case when p_patch ? 'regional'   then p_patch->'regional'   else regional end,
    layout     = case when p_patch ? 'layout'     then p_patch->'layout'     else layout end,
    profiles   = case when p_patch ? 'profiles'   then p_patch->'profiles'   else profiles end,
    schema_version = coalesce((p_patch->>'schema_version')::int, schema_version),
    version = v_new,
    updated_at = now()
    where user_id = v_uid and tenant_id = v_tenant;

  return jsonb_build_object('ok',true,'status','OK','version',v_new);
end;
$function$;

revoke all on function public.upsert_dashboard_user_preferences(jsonb, integer) from public;
grant execute on function public.upsert_dashboard_user_preferences(jsonb, integer) to authenticated;

commit;
