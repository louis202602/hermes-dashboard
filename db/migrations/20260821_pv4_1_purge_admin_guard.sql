-- PACK PHOTOVOLTAÏQUE — LOT PV-4 / 1 — La purge devient un geste d'administrateur.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- PV-3 a livré la purge physique des octets. Le rapport la classait comme le
-- SEUL geste réellement irréversible du Pack PV, et proposait de la restreindre.
-- C'est ce que fait ce lot.
--
-- RÉUTILISATION, PAS DE NOUVEAU SYSTÈME DE RÔLES. Hermès porte déjà son modèle
-- de droits dans `hermes_os.user_tenant_permissions` : des CHAÎNES de permission
-- accordées par (utilisateur, tenant). `tenant.admin` existe déjà et est déjà
-- attribuée. On l'utilise telle quelle — aucune table, aucune colonne, aucun
-- rôle parallèle.
--
-- POURQUOI AUSSI SUR LA LISTE, et pas seulement sur la purge : énumérer ce qui
-- est purgeable fait partie du geste de purge. Laisser un membre standard
-- dresser la liste des fichiers effaçables n'a aucune utilité métier et donne
-- une carte à qui ne peut rien en faire.
--
-- LE SERVEUR RESTE L'AUTORITÉ. La confirmation ajoutée dans l'interface est une
-- protection contre l'erreur humaine, pas contre la malveillance : contourner
-- l'écran ne permet à personne de purger. C'est cette fonction qui refuse.

begin;

-- ---------------------------------------------------------------------------
-- 1. La garde d'administration. Extension STRICTE de `pv_guard()` : mêmes codes
--    de refus, plus un seul — `NOT_ADMIN`. Distinguer ce refus des autres est
--    délibéré : l'interface doit pouvoir dire « demandez à un administrateur »
--    plutôt que « accès refusé », qui n'apprend rien.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_guard_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
begin
  if not (v_g->>'ok')::boolean then
    return v_g;
  end if;
  if not exists (
    select 1 from hermes_os.user_tenant_permissions p
     where p.user_id = (v_g->>'uid')::uuid
       and p.tenant_id = v_g->>'tenant'
       and p.permission = 'tenant.admin'
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN', 'tenant', v_g->>'tenant');
  end if;
  return v_g;
end;
$function$;

revoke all on function hermes_os.pv_guard_admin() from public;

comment on function hermes_os.pv_guard_admin() is
  'PV-4 — garde des gestes irréversibles : pv_guard() + permission tenant.admin sur le tenant résolu.';

-- ---------------------------------------------------------------------------
-- 2. Lister les documents purgeables — RÉSERVÉ À UN ADMINISTRATEUR.
--    Le comparateur `<=` du correctif PV-3/3b est conservé.
-- ---------------------------------------------------------------------------
create or replace function public.list_pv_documents_to_purge(
  p_older_than interval default '7 days',
  p_limit      integer  default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard_admin();
  v_t text;
  v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_age interval := greatest(coalesce(p_older_than, interval '7 days'), interval '0');
  v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.id, 'bucket', d.storage_bucket, 'path', d.storage_path,
           'deleted_at', d.deleted_at) order by d.deleted_at), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_documents d
           where d.tenant_id = v_t
             and d.deleted_at is not null
             and d.purged_at is null
             and d.storage_path is not null
             and d.deleted_at <= now() - v_age
           order by d.deleted_at limit v_lim) d;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.list_pv_documents_to_purge(interval, integer) from public;
grant execute on function public.list_pv_documents_to_purge(interval, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enregistrer une purge — RÉSERVÉ À UN ADMINISTRATEUR.
--    Le délai de grâce est REVÉRIFIÉ ici : la liste le respecte déjà, mais un
--    appel direct avec un identifiant connu ne passerait pas par la liste.
--    Une garde qui ne tient que sur le chemin nominal ne tient pas.
-- ---------------------------------------------------------------------------
create or replace function public.mark_pv_document_purged(
  p_document_id uuid,
  p_older_than  interval default '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard_admin();
  v_t text; v_d hermes_os.pv_documents;
  v_age interval := greatest(coalesce(p_older_than, interval '7 days'), interval '0');
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_d from hermes_os.pv_documents d
   where d.id = p_document_id and d.tenant_id = v_t;
  if v_d.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_d.purged_at is not null then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_PURGED', 'document_id', v_d.id);
  end if;
  if v_d.deleted_at is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_DELETED');
  end if;
  if v_d.deleted_at > now() - v_age then
    return jsonb_build_object('ok', false, 'code', 'GRACE_PERIOD',
      'deleted_at', v_d.deleted_at);
  end if;

  update hermes_os.pv_documents
     set purged_at    = now(),
         purged_path  = storage_path,
         storage_path = null,
         updated_at   = now()
   where id = p_document_id and tenant_id = v_t;

  perform hermes_os._pv_audit(
    v_t, 'pv_documents', v_d.id,
    jsonb_build_object('storage_path', v_d.storage_path),
    jsonb_build_object('purged_at', now()),
    'octets du document PV purges via l''API Storage');

  return jsonb_build_object('ok', true, 'code', 'PURGED', 'document_id', v_d.id);
end;
$function$;

revoke all on function public.mark_pv_document_purged(uuid, interval) from public;
grant execute on function public.mark_pv_document_purged(uuid, interval) to authenticated;

-- L'ancienne signature à un argument disparaît : la laisser vivante offrirait un
-- chemin sans contrôle de délai de grâce, et PostgreSQL choisirait la surcharge
-- la plus spécifique sans prévenir personne.
drop function if exists public.mark_pv_document_purged(uuid);

-- ---------------------------------------------------------------------------
-- 4. JOURNAL DE PURGE — lecture, ouverte à tout membre du tenant.
--
--    AUCUNE NOUVELLE TABLE D'AUDIT. Tout est déjà là :
--      * `pv_documents` porte `deleted_at`, `deleted_by`, `purged_at`, `purged_path` ;
--      * `entity_audit_log` porte QUI a agi (`changed_by`) et QUAND.
--    Le journal est donc une JOINTURE, pas un second système. La ligne d'audit
--    est rapprochée par (tenant, entité, identifiant) et par sa formulation :
--    c'est la seule entrée d'audit écrite au moment d'une purge.
--
--    Transparence assumée : la lecture est ouverte au membre. Savoir qu'un
--    document a été détruit, par qui et quand, n'est pas un privilège
--    d'administrateur — c'est ce qui rend l'irréversible acceptable.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_purge_journal(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.id,
           'site_id', d.site_id,
           'doc_type', d.doc_type,
           'original_filename', d.original_filename,
           'size_bytes', d.size_bytes,
           'deleted_at', d.deleted_at,
           'deleted_by', d.deleted_by,
           'purged_at', d.purged_at,
           'purged_path', d.purged_path,
           'purged_by', (select a.changed_by
                           from hermes_os.entity_audit_log a
                          where a.tenant_id = v_t
                            and a.entity_type = 'pv_documents'
                            and a.entity_id = d.id
                            and a.change_summary like 'octets du document PV purges%'
                          order by a.timestamp desc limit 1),
           'outcome', 'PURGED') order by d.purged_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_documents d
           where d.tenant_id = v_t and d.purged_at is not null
           order by d.purged_at desc limit v_lim) d;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_purge_journal(integer) from public;
grant execute on function public.get_pv_purge_journal(integer) to authenticated;

commit;
