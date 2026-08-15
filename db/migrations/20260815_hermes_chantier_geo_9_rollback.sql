-- Rollback: CARTE-1 worksite geo (project smubxqorirlfldatzmym)
-- Drops the two facades + the geo table only. No other data touched (btp_chantiers,
-- DASH-1/2/3/4A/4B/4C, resolver, SW23, attachments all untouched).
begin;

drop function if exists public.upsert_chantier_geocode(uuid, double precision, double precision, text, text, text, text);
drop function if exists public.get_chantiers_map();
drop table if exists hermes_os.btp_chantier_geo;

commit;
