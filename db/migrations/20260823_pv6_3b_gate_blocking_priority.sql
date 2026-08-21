-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / 3b — CORRECTIF de la porte de visite.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- CE QUE LA PREMIÈRE VERSION FAISAIT DE FAUX, constaté en écrivant l'assertion
-- T54 : `pv_survey_gate` testait `VALIDATED` AVANT `BLOCKING`. Conséquence —
-- une visite validée en mars masquait une visite d'octobre qui constate un toit
-- devenu impraticable. La porte répondait `OK`, et un nouveau devis pouvait
-- partir sur un site que le terrain venait de déclarer bloqué. C'est exactement
-- le silence que ce lot est censé supprimer.
--
-- LA RÈGLE CORRIGÉE : un BLOCAGE prime sur une validation antérieure. Il n'est
-- pas définitif pour autant — la machine à états offre deux sorties déjà
-- déclarées, `BLOCKING -> IN_PROGRESS` (on retourne sur le toit) et
-- `BLOCKING -> CANCELLED` (le constat était erroné). La porte se rouvre donc
-- par un geste, jamais par oubli.
--
-- Fichier SÉPARÉ, conformément à la gouvernance des migrations : `pv6_3` est
-- déjà appliquée en production ; on ne réécrit pas une migration appliquée.
--
-- Rollback : le fichier `20260823_pv6_9_rollback.sql` supprime `pv_survey_gate`
-- en entier — il couvre donc aussi ce correctif.

begin;

create or replace function hermes_os.pv_survey_gate(p_tenant text, p_site_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_n integer; v_blocking integer;
begin
  -- 1. UN BLOCAGE D'ABORD. Le constat le plus grave gagne, quelle que soit son
  --    antériorité : on ne pose pas sur un toit déclaré impraticable parce
  --    qu'une visite plus ancienne avait dit l'inverse.
  select count(*) into v_blocking from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id and status = 'BLOCKING';
  if v_blocking > 0 then return 'BLOCKING'; end if;

  -- 2. Une visite validée vaut preuve terrain. Elle ne peut pas porter d'écart
  --    bloquant non résolu : `validate_pv_site_survey` le refuse en amont.
  select count(*) into v_n from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id and status = 'VALIDATED';
  if v_n > 0 then return 'OK'; end if;

  -- 3. Une visite en cours n'est pas une preuve, mais ce n'est pas rien non plus.
  select count(*) into v_n from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id
     and status in ('PLANNED','IN_PROGRESS','DONE','NEEDS_REVIEW');
  if v_n > 0 then return 'NOT_VALIDATED'; end if;

  return 'NONE';
end;
$function$;

revoke all on function hermes_os.pv_survey_gate(text, uuid) from public;

comment on function hermes_os.pv_survey_gate(text, uuid) is
  'PV-6 — état de la preuve terrain d''un site. Un BLOCAGE prime sur une validation antérieure.';

commit;
