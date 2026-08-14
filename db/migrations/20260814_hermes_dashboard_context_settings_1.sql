-- DASH-1 — Command Center context bar: per-tenant international context settings.
-- (project smubxqorirlfldatzmym)
--
-- Adds a small, additive, read-only-by-app settings table carrying the FIVE i18n
-- axes kept strictly separate — LOCALE, COUNTRY, TIMEZONE, CURRENCY (+ optional
-- CITY/coordinates for weather). No business data. The dashboard reads it through
-- a single SECURITY DEFINER facade that resolves the CALLER'S tenant only (never a
-- client-supplied id), mirroring the existing panel readers.
--
-- COST-FIRST: this is pure configuration. Time/date/timezone are computed
-- client-side from `timezone` via Intl (0 external call); weather is fetched by
-- the app only when `latitude`/`longitude` are set (never fabricated). No LLM.
begin;

create table if not exists hermes_os.dashboard_context_settings (
  tenant_id      text primary key,
  city           text,
  iana_timezone  text        not null default 'UTC',
  latitude       double precision,
  longitude      double precision,
  locale         text        not null default 'fr-FR',
  country        text        not null default 'FR',
  currency       text        not null default 'EUR',
  updated_at     timestamptz not null default now()
);

comment on table hermes_os.dashboard_context_settings is
  'DASH-1 per-tenant context for the Command Center bar. Five i18n axes kept '
  'separate (locale/country/timezone/currency) + optional city/lat/lon for '
  'weather. Read-only from the app via public.get_dashboard_context_settings().';

-- Seed the France-consistent defaults for the existing tenant(s). These are
-- legitimate CONFIG defaults (the app UI is fr-FR / EUR today), NOT fabricated
-- data: city + coordinates are intentionally left NULL so weather stays honestly
-- UNAVAILABLE until an operator sets a real location.
insert into hermes_os.dashboard_context_settings (tenant_id, iana_timezone, locale, country, currency)
select distinct b.tenant_id, 'Europe/Paris', 'fr-FR', 'FR', 'EUR'
  from hermes_os.sw23_tenant_budget_config b
on conflict (tenant_id) do nothing;

-- Read facade: caller's tenant only. Returns the row (or neutral defaults) as a
-- flat JSON object. location_configured = both coordinates present.
create or replace function public.get_dashboard_context_settings()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_row hermes_os.dashboard_context_settings;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;

  if v_status is distinct from 'OK' then
    return jsonb_build_object(
      'resolution_status', coalesce(v_status,'NO_TENANT'),
      'tenant_id', v_tenant
    );
  end if;

  select * into v_row
    from hermes_os.dashboard_context_settings
    where tenant_id = v_tenant;

  if not found then
    -- No explicit row: neutral, honest defaults (no location ⇒ no weather).
    return jsonb_build_object(
      'resolution_status', 'OK',
      'tenant_id', v_tenant,
      'city', null,
      'iana_timezone', 'UTC',
      'latitude', null,
      'longitude', null,
      'locale', 'fr-FR',
      'country', 'FR',
      'currency', 'EUR',
      'location_configured', false
    );
  end if;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_tenant,
    'city', v_row.city,
    'iana_timezone', v_row.iana_timezone,
    'latitude', v_row.latitude,
    'longitude', v_row.longitude,
    'locale', v_row.locale,
    'country', v_row.country,
    'currency', v_row.currency,
    'location_configured', (v_row.latitude is not null and v_row.longitude is not null)
  );
end;
$function$;

-- Fail-closed exposure: no anon/public, authenticated only (tenant scoping is
-- enforced inside the function via resolve_active_tenant).
revoke all on function public.get_dashboard_context_settings() from public;
grant execute on function public.get_dashboard_context_settings() to authenticated;

commit;
