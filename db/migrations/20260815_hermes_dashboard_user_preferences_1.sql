-- DASH-4A — Dashboard user preferences (per-user personalization).
-- (project smubxqorirlfldatzmym)
--
-- ONE user-scoped table (not many) holding appearance / behavior / regional /
-- layout / profiles as JSONB, plus optimistic-concurrency (version) and layout
-- schema versioning. hermes_os table = RLS deny-all; all access through two
-- SECURITY DEFINER facades (caller's user + tenant only, never a client id).
-- No LLM, no external API, no scheduler. Personalization is purely user data.
begin;

create table if not exists hermes_os.dashboard_user_preferences (
  user_id        uuid    not null,
  tenant_id      text    not null,
  appearance     jsonb   not null default '{}'::jsonb,
  behavior       jsonb   not null default '{}'::jsonb,
  regional       jsonb   not null default '{}'::jsonb,
  layout         jsonb   not null default '{}'::jsonb,
  profiles       jsonb   not null default '{}'::jsonb,
  schema_version integer not null default 1,
  version        integer not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

comment on table hermes_os.dashboard_user_preferences is
  'DASH-4A per-user dashboard personalization (appearance/behavior/regional/layout/'
  'profiles as JSONB). User-scoped; resolution is user override → tenant default → '
  'Hermès default (app-side). RLS deny-all; reached only via public facades.';

-- RLS deny-all: no policy = ordinary roles get nothing; only SECURITY DEFINER
-- facades (running as owner) can read/write.
alter table hermes_os.dashboard_user_preferences enable row level security;

-- Read facade: the caller's own row only (auth.uid + resolved tenant). Empty ⇒
-- version 0 + empty sub-objects (the app resolves defaults).
create or replace function public.get_dashboard_user_preferences()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_row hermes_os.dashboard_user_preferences;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),'tenant_id',v_tenant);
  end if;

  select * into v_row from hermes_os.dashboard_user_preferences
    where user_id = v_uid and tenant_id = v_tenant;

  if not found then
    return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,
      'version',0,'schema_version',1,
      'appearance','{}'::jsonb,'behavior','{}'::jsonb,'regional','{}'::jsonb,
      'layout','{}'::jsonb,'profiles','{}'::jsonb);
  end if;

  return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,
    'version',v_row.version,'schema_version',v_row.schema_version,
    'appearance',v_row.appearance,'behavior',v_row.behavior,'regional',v_row.regional,
    'layout',v_row.layout,'profiles',v_row.profiles);
end;
$function$;

revoke all on function public.get_dashboard_user_preferences() from public;
grant execute on function public.get_dashboard_user_preferences() to authenticated;

-- Write facade: optimistic-concurrency upsert of the caller's own row. `p_patch`
-- may carry any of appearance/behavior/regional/layout/profiles (full sub-objects,
-- replace-wins); absent keys are preserved. `p_expected_version` must equal the
-- current version (0 for a first insert) or the call fails VERSION_CONFLICT — never
-- a silent last-write-wins.
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
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'status', coalesce(v_status,'NO_TENANT'));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
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
