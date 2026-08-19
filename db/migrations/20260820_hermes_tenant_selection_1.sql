-- ---------------------------------------------------------------------------
-- HERMÈS — sélection du tenant actif (ACTIVE_TENANT_SELECTION).
--
-- ⚠️ NON APPLIQUÉE. Fichier préparatoire. `GO_LIVE = NO`.
--
-- Problème constaté : `resolve_active_tenant(null)` renvoie
-- `AMBIGUOUS_TENANT_REQUIRE_SELECTION` dès qu'un utilisateur est membre de
-- plusieurs tenants, et aucun sélecteur n'existe. Un compte rattaché à deux
-- tenants casse donc ses propres lectures.
--
-- CE QUI N'EST PAS TOUCHÉ, volontairement : `resolve_active_tenant` elle-même.
-- Elle sait DÉJÀ vérifier l'appartenance quand on lui passe un tenant
-- (`p_requested_tenant_id` ⇒ `ACCESS_DENIED` si l'appelant n'est pas
-- `tenant.member`). Le contrat de sécurité existe ; il ne lui manquait qu'un
-- appelant. On n'y ajoute rien — donc aucun risque de régression sur le seul
-- chemin d'accès aux données de production.
--
-- LA RÈGLE : la sélection est une PRÉFÉRENCE, jamais une AUTORISATION.
-- Réversible : 20260820_hermes_tenant_selection_9_rollback.sql
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Persistance durable de la sélection.
--
--    Un cookie suffirait à la sécurité (l'appartenance est revérifiée à chaque
--    appel), mais pas au confort : il ne suit pas l'utilisateur d'un appareil à
--    l'autre. Cette table est donc un CONFORT, pas une barrière.
--
--    Aucune contrainte d'intégrité vers `user_tenant_permissions` : une ligne
--    peut survivre à une perte d'accès. C'est assumé — la lecture revérifie.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.user_active_tenant (
  user_id     uuid primary key,
  tenant_id   text not null,
  selected_at timestamptz not null default now()
);
alter table hermes_os.user_active_tenant enable row level security;

comment on table hermes_os.user_active_tenant is
  'Préférence de tenant actif. N''accorde AUCUN droit : l''appartenance est '
  'revérifiée par resolve_active_tenant à chaque appel.';

-- ---------------------------------------------------------------------------
-- 2. Les tenants de l'appelant — la SEULE source de la liste.
--
--    Ne remonte que des lignes `tenant.member`. Conséquence directe et voulue :
--    `hermes.founder` et `hermes.operator` N'ÉLARGISSENT PAS cette liste. Un
--    founder non membre d'un tenant ne le voit pas, ne le sélectionne pas, n'en
--    lit rien. Accéder à un tenant de plus est un acte d'administration tracé,
--    jamais un effet de bord d'un rôle.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_tenants()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_rows jsonb; v_sel text;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status', 'UNAUTHENTICATED', 'tenants', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tenant_id', t.tenant_id,
           'label', coalesce(t.display_name, t.name, t.tenant_id)
         ) order by t.tenant_id), '[]'::jsonb)
    into v_rows
    from hermes_os.user_tenant_permissions p
    join hermes_os.tenants t on t.tenant_id = p.tenant_id
   where p.user_id = v_uid
     and p.permission = 'tenant.member';

  select a.tenant_id into v_sel
    from hermes_os.user_active_tenant a
   where a.user_id = v_uid;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenants', v_rows,
    -- La sélection stockée n'est renvoyée que si elle est ENCORE valide : une
    -- préférence obsolète ne doit pas réapparaître dans l'interface.
    'selected_tenant_id',
      case when v_rows @> jsonb_build_array(jsonb_build_object('tenant_id', v_sel))
                or exists (select 1 from jsonb_array_elements(v_rows) e
                            where e->>'tenant_id' = v_sel)
           then v_sel else null end);
end;
$function$;

revoke all on function public.get_my_tenants() from public;
grant execute on function public.get_my_tenants() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enregistrer une sélection — appartenance vérifiée AVANT écriture.
--
--    Un `tenant_id` forgé n'est pas persisté : il est refusé. C'est la deuxième
--    barrière ; la première reste `resolve_active_tenant`, qui refuserait de
--    toute façon de servir des données.
-- ---------------------------------------------------------------------------
create or replace function public.set_active_tenant(p_tenant_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_member boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_tenant_id is null or length(btrim(p_tenant_id)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  select exists (
    select 1 from hermes_os.user_tenant_permissions p
     where p.user_id = v_uid
       and p.tenant_id = p_tenant_id
       and p.permission = 'tenant.member'
  ) into v_member;

  if not v_member then
    -- Ni erreur bavarde ni indice : on ne dit pas si le tenant existe.
    return jsonb_build_object('ok', false, 'code', 'NOT_A_MEMBER');
  end if;

  insert into hermes_os.user_active_tenant(user_id, tenant_id, selected_at)
       values (v_uid, p_tenant_id, now())
  on conflict (user_id) do update
     set tenant_id = excluded.tenant_id, selected_at = now();

  return jsonb_build_object('ok', true, 'code', 'OK', 'tenant_id', p_tenant_id);
end;
$function$;

revoke all on function public.set_active_tenant(text) from public;
grant execute on function public.set_active_tenant(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Effacer sa sélection. Sans effet sur les droits.
-- ---------------------------------------------------------------------------
create or replace function public.clear_active_tenant()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  delete from hermes_os.user_active_tenant where user_id = v_uid;
  return jsonb_build_object('ok', true, 'code', 'OK');
end;
$function$;

revoke all on function public.clear_active_tenant() from public;
grant execute on function public.clear_active_tenant() to authenticated;

commit;
