-- Migration: hermes_business_lot2_fix_qualif_keyword_collision (project smubxqorirlfldatzmym)
-- Fix keyword collision: "chantier" (a noun present in many intents, incl.
-- planning) must not be a qualification trigger. Qualification intent = the verb.
-- The slot extractor now strips a leading noun (chantier/projet/dossier/client)
-- so "qualifie le chantier X" still extracts "X".

update hermes_os.agent_action_catalog
   set nl_keywords = array['qualifie','qualifier','qualification']::text[], updated_at = now()
 where action_key = 'btp.qualification.create';

create or replace function hermes_os._nl_extract_slot(p_message text, p_keywords text[])
returns text
language plpgsql
immutable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_low  text := lower(coalesce(p_message,''));
  kw     text; pos int; endpos int; best int := -1;
  v_rest text; v_out text;
begin
  if p_keywords is null then return null; end if;
  foreach kw in array p_keywords loop
    if kw is null or kw = '' then continue; end if;
    pos := position(lower(kw) in v_low);
    if pos > 0 then
      endpos := pos + length(kw) - 1;
      if endpos > best then best := endpos; end if;
    end if;
  end loop;
  if best < 0 then return null; end if;

  v_rest := substr(p_message, best + 1);
  v_rest := regexp_replace(v_rest, '^[[:space:]:,\.\-]+', '', '');
  -- strip a leading article/filler
  v_rest := regexp_replace(v_rest,
    '^(le|la|les|du|de|des|un|une|mon|ma|nomm[eé]+|appel[eé]+|intitul[eé]+)[[:space:]:,\-]+', '', 'i');
  -- strip a leading business noun that anchors the name (chantier/projet/...)
  v_rest := regexp_replace(v_rest,
    '^(chantiers?|projets?|dossiers?|clients?)[[:space:]:,\-]+', '', 'i');
  v_out := trim(regexp_replace(v_rest, '[[:space:]]+', ' ', 'g'));
  if length(v_out) = 0 then return null; end if;
  return left(v_out, 200);
end;
$function$;
