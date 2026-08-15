-- CARTE-1 — Canonical geographic source for worksites (btp_chantiers).
-- (project smubxqorirlfldatzmym)
--
-- ONE geo table (separate from btp_chantiers, which the BTP agent writes) holding the
-- geocoded coordinates + address metadata. The SAME lat/lon feed the map AND the
-- worksite weather (Open-Meteo) — no second geographic system. hermes_os table =
-- RLS deny-all; all access through SECURITY DEFINER facades (caller's tenant only,
-- never a client id). No LLM, no paid API.
begin;

create table if not exists hermes_os.btp_chantier_geo (
  chantier_id       uuid primary key,
  tenant_id         text not null,
  latitude          double precision,
  longitude         double precision,
  formatted_address text,
  country_code      text,
  iana_timezone     text,
  geocoded_at       timestamptz,
  geocode_provider  text,
  geocode_status    text not null default 'PENDING',
  updated_at        timestamptz not null default now()
);

comment on table hermes_os.btp_chantier_geo is
  'CARTE-1 canonical worksite geo (lat/lon/address). Separate from btp_chantiers to '
  'avoid write collisions with the BTP agent. Tenant-scoped; RLS deny-all; reached '
  'only via public facades. Same coords feed the map + Open-Meteo worksite weather.';

create index if not exists btp_chantier_geo_tenant_idx
  on hermes_os.btp_chantier_geo (tenant_id);

alter table hermes_os.btp_chantier_geo enable row level security;

-- Read facade: the active tenant's geocoded worksites only (bounded). Joins the
-- worksite business row with its geo row; returns only rows with real coordinates.
create or replace function public.get_chantiers_map()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED','chantiers','[]'::jsonb);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),'chantiers','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row order by row->>'chantier_name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'chantier_name', c.chantier_name,
      'client_name', c.client_name,
      'adresse', c.adresse,
      'formatted_address', g.formatted_address,
      'status', c.status,
      'type_chantier', c.type_chantier,
      'date_debut', coalesce(c.date_debut_reel, c.date_debut_planifie),
      'date_fin', coalesce(c.date_fin_reelle, c.date_fin_planifiee),
      'latitude', g.latitude,
      'longitude', g.longitude,
      'country_code', g.country_code,
      'iana_timezone', g.iana_timezone
    ) as row
    from hermes_os.btp_chantiers c
    join hermes_os.btp_chantier_geo g on g.chantier_id = c.id
    where c.tenant_id = v_tenant
      and g.tenant_id = v_tenant
      and g.latitude is not null
      and g.longitude is not null
    limit 500
  ) s;

  return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,'chantiers',v_rows);
end;
$function$;

revoke all on function public.get_chantiers_map() from public;
grant execute on function public.get_chantiers_map() to authenticated;

-- Write facade: persist a ONE-SHOT geocode for a worksite the caller's tenant owns.
-- The app never geocodes at render — only when an address is set/changed.
create or replace function public.upsert_chantier_geocode(
  p_chantier_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_formatted text,
  p_country text,
  p_timezone text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'status', coalesce(v_status,'NO_TENANT'));
  end if;
  -- The worksite must belong to the caller's tenant (no cross-tenant writes).
  if not exists (select 1 from hermes_os.btp_chantiers where id = p_chantier_id and tenant_id = v_tenant) then
    return jsonb_build_object('ok',false,'status','NOT_FOUND');
  end if;
  if p_lat is null or p_lon is null
     or p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    return jsonb_build_object('ok',false,'status','BAD_COORDS');
  end if;

  insert into hermes_os.btp_chantier_geo(
    chantier_id, tenant_id, latitude, longitude, formatted_address, country_code,
    iana_timezone, geocoded_at, geocode_provider, geocode_status, updated_at)
  values (p_chantier_id, v_tenant, p_lat, p_lon, p_formatted,
    nullif(upper(p_country),''), nullif(p_timezone,''), now(),
    coalesce(nullif(p_provider,''),'nominatim'), 'OK', now())
  on conflict (chantier_id) do update set
    tenant_id = excluded.tenant_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    formatted_address = excluded.formatted_address,
    country_code = excluded.country_code,
    iana_timezone = excluded.iana_timezone,
    geocoded_at = now(),
    geocode_provider = excluded.geocode_provider,
    geocode_status = 'OK',
    updated_at = now();

  return jsonb_build_object('ok',true,'status','OK');
end;
$function$;

revoke all on function public.upsert_chantier_geocode(uuid, double precision, double precision, text, text, text, text) from public;
grant execute on function public.upsert_chantier_geocode(uuid, double precision, double precision, text, text, text, text) to authenticated;

commit;
