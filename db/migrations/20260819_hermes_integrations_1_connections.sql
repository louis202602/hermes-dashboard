-- HERMÈS / INTÉGRATIONS 1 — Connexions self-service par tenant (OAuth).
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO. GOOGLE_OAUTH_LIVE = NO.
--
-- ═══ POURQUOI CETTE ARCHITECTURE — trois contraintes constatées, pas choisies ═══
--
--  A. L'application Next.js ne détient AUCUN secret, par conception documentée
--     (`lib/voice/README.md`, `.env.example` : seules la URL Supabase et la clé
--     publiable). Or un échange OAuth `code → token` exige un `client_secret`.
--     ⇒ L'échange NE PEUT PAS avoir lieu dans l'application.
--
--  B. Postgres ne peut pas émettre de requête HTTP : ni `pg_net` ni `http`
--     ne sont installés (extensions constatées : btree_gist, pg_stat_statements,
--     pgcrypto, plpgsql, supabase_vault, uuid-ossp).
--     ⇒ L'échange NE PEUT PAS avoir lieu dans une fonction SQL non plus.
--
--  C. `supabase_vault` 0.3.1 EST installé, et son schéma `vault` n'accorde
--     AUCUN privilège à `authenticated` ni à `anon` (vérifié :
--     has_schema_privilege = false pour les deux ; true pour service_role et
--     postgres). C'est donc DÉJÀ le mécanisme de secrets d'Hermès.
--     ⇒ On ne crée PAS une seconde infrastructure de secrets.
--
--  CONSÉQUENCE — répartition des rôles, la seule qui respecte les trois :
--
--    Navigateur    → ne voit qu'un STATUT ('CONNECTED', 'REVOKED', …).
--                    Jamais un jeton, jamais un identifiant de secret.
--    Application   → démarre le flux (URL d'autorisation + `state` anti-CSRF).
--                    Ne détient aucun secret, ne reçoit aucun jeton.
--    n8n           → porte le `client_secret`, reçoit le callback du
--                    fournisseur, échange le code contre les jetons, puis
--                    appelle `complete_integration_connection` en service_role.
--                    C'est la couche d'intégration DÉJÀ utilisée par Hermès.
--    Vault         → détient les jetons. `tenant_integration_connections` ne
--                    stocke qu'un `vault_secret_id`, jamais le jeton lui-même.
--
--  ⚠️ BLOCAGE HONNÊTE : cette architecture dépend de n8n, aujourd'hui
--     indisponible (blocage OVH). Le schéma et les façades sont prêts ; le flux
--     ne peut pas être bouclé tant que n8n ne l'est pas.
--
-- Réversible : 20260819_hermes_integrations_9_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalogue des fournisseurs — CONFIGURATION PUBLIQUE UNIQUEMENT.
--
--    `client_id` figure ici : ce n'est PAS un secret (il transite dans l'URL
--    d'autorisation, visible du navigateur). Le `client_secret`, lui, n'a
--    aucune colonne — il vit côté n8n. Cette absence est le contrat.
--
--    Généricité voulue : ajouter `gmail` ou `meta` sera une ligne, pas une
--    migration. On n'implémente pour autant que ce qui sert maintenant.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.integration_providers (
  provider          text primary key
                      check (provider in ('google_calendar', 'gmail', 'meta', 'instagram')),
  label             text not null check (length(btrim(label)) between 1 and 80),
  authorize_url     text not null check (left(authorize_url, 8) = 'https://'),
  -- URL d'échange, utilisée par n8n — jamais par l'application.
  token_url         text not null check (left(token_url, 8) = 'https://'),
  client_id         text,
  default_scopes    text[] not null default '{}',
  -- VERTICALES autorisées à connecter ce fournisseur. Miroir en base de
  -- VERTICAL_MANIFEST.integrationProviders : l'interface et la base appliquent
  -- désormais LA MÊME règle, au lieu que la base laisse tout passer.
  -- Vide = personne. Un fournisseur ne devient joignable que délibérément.
  verticals         text[] not null default '{}',
  -- Un fournisseur non activé n'apparaît pas dans la page « Connecter ».
  enabled           boolean not null default false,
  sort_order        integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table hermes_os.integration_providers enable row level security;

comment on table hermes_os.integration_providers is
  'Catalogue des fournisseurs OAuth. Configuration PUBLIQUE : aucun client_secret ici.';

-- ---------------------------------------------------------------------------
-- 2. Connexions par tenant — le cœur.
--
--    ISOLATION : `tenant_id` en tête de clé primaire. Deux tenants ne peuvent
--    pas voir la connexion l'un de l'autre : la table est en RLS deny-all et
--    la seule lecture possible passe par une façade qui résout le tenant
--    SERVER-SIDE (`resolve_active_tenant`), jamais depuis le client.
--
--    JETONS : `vault_secret_id` est un POINTEUR vers `vault.secrets`, pas un
--    jeton. La façade de lecture ne le renvoie jamais. Le navigateur ne peut
--    donc rien exfiltrer, même en cas de bug applicatif.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.tenant_integration_connections (
  tenant_id          text not null,
  provider           text not null references hermes_os.integration_providers(provider),
  status             text not null default 'NOT_CONNECTED'
                       check (status in ('NOT_CONNECTED', 'CONNECTING', 'CONNECTED',
                                         'ERROR', 'REAUTH_REQUIRED', 'REVOKED')),
  -- Pointeur Vault. JAMAIS le jeton. JAMAIS renvoyé par une façade.
  vault_secret_id    uuid,
  -- Libellé du compte connecté, pour que la photographe reconnaisse SON compte
  -- (ex. « v•••@gmail.com »). Masqué à la source : on ne stocke pas l'adresse.
  account_label      text check (account_label is null or length(account_label) <= 120),
  scopes_granted     text[] not null default '{}',
  connected_at       timestamptz,
  expires_at         timestamptz,
  last_refresh_at    timestamptz,
  revoked_at         timestamptz,
  last_error_code    text check (last_error_code is null or length(last_error_code) <= 60),
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, provider),
  -- Un statut CONNECTED sans jeton serait un mensonge exploitable : la lecture
  -- d'agenda croirait pouvoir appeler le fournisseur.
  constraint integration_connected_has_secret
    check (status <> 'CONNECTED' or vault_secret_id is not null),
  -- Une révocation doit être datée (traçabilité RGPD et support).
  constraint integration_revoked_dated
    check (status <> 'REVOKED' or revoked_at is not null)
);
alter table hermes_os.tenant_integration_connections enable row level security;
create index if not exists tenant_integrations_by_status
  on hermes_os.tenant_integration_connections (tenant_id, status);

comment on column hermes_os.tenant_integration_connections.vault_secret_id is
  'Pointeur vers vault.secrets. JAMAIS le jeton, JAMAIS renvoyé par une façade.';

-- ---------------------------------------------------------------------------
-- 3. `state` OAuth — anti-CSRF, à usage unique et à durée de vie courte.
--
--    On stocke une EMPREINTE du state, pas le state : une fuite de la table ne
--    permettrait pas de forger un retour de callback.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.tenant_integration_oauth_states (
  state_hash    text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id     text not null,
  provider      text not null references hermes_os.integration_providers(provider),
  -- Utilisateur qui a cliqué « Connecter » : la connexion lui est imputable.
  requested_by  uuid not null,
  redirect_after text check (redirect_after is null or left(redirect_after, 1) = '/'),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table hermes_os.tenant_integration_oauth_states enable row level security;
create index if not exists oauth_states_expiry
  on hermes_os.tenant_integration_oauth_states (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- 3 bis. VERTICALE DU TENANT + autorisation de fournisseur.
--
--    Défaut corrigé ici : `get_tenant_integrations` filtrait sur `p.enabled`
--    SEUL. Tout tenant voyait donc tout fournisseur activé, et un installateur
--    solaire pouvait obtenir Instagram en appelant la RPC directement — le
--    filtre par verticale n'existait que dans l'interface, donc nulle part.
--
--    ⚠️ À L'APPLICATION : renseigner `tenants.vertical` pour chaque tenant AVANT
--    d'activer un fournisseur. Une verticale NULL n'autorise RIEN (fail-closed),
--    et le code d'erreur le dit (`TENANT_VERTICAL_UNKNOWN`) plutôt que de
--    renvoyer une liste vide qu'on lirait comme « aucun outil disponible ».
-- ---------------------------------------------------------------------------
alter table hermes_os.tenants
  add column if not exists vertical text
    check (vertical is null
           or vertical in ('photography','real_estate','solar','construction','generic'));

comment on column hermes_os.tenants.vertical is
  'Verticale déclarée. NULL = non déterminée : aucun fournisseur n''est '
  'autorisé tant qu''elle ne l''est pas.';

create or replace function hermes_os.tenant_allows_provider(p_tenant text, p_provider text)
returns boolean
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select exists (
    select 1
      from hermes_os.integration_providers p
      join hermes_os.tenants t on t.tenant_id = p_tenant
     where p.provider = p_provider
       and p.enabled
       and t.vertical is not null
       and t.vertical = any (p.verticals)
  );
$function$;

revoke all on function hermes_os.tenant_allows_provider(text, text) from public;

comment on function hermes_os.tenant_allows_provider(text, text) is
  'Fail-closed : verticale inconnue, fournisseur désactivé ou hors verticale '
  '⇒ faux. Un appel direct à la RPC ne contourne donc plus le filtre.';

-- ---------------------------------------------------------------------------
-- 4. Garde commune — authentification + tenant. Même patron que `photo_guard`.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.integration_guard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', coalesce(v_status, 'NO_TENANT'));
  end if;
  return jsonb_build_object('ok', true, 'code', 'OK', 'tenant', v_tenant, 'uid', v_uid);
end;
$function$;

revoke all on function hermes_os.integration_guard() from public;

-- ---------------------------------------------------------------------------
-- 5. LECTURE — état des connexions du tenant appelant.
--
--    Renvoie un STATUT et rien d'autre : ni jeton, ni `vault_secret_id`, ni
--    portée technique inutile. C'est la seule surface exposée au navigateur.
-- ---------------------------------------------------------------------------
create or replace function public.get_tenant_integrations()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.integration_guard();
  v_t text; v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'integrations', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', p.provider,
           'label', p.label,
           'status', coalesce(c.status, 'NOT_CONNECTED'),
           'account_label', c.account_label,
           'connected_at', c.connected_at,
           'expires_at', c.expires_at,
           'last_error_code', c.last_error_code
           -- vault_secret_id est VOLONTAIREMENT absent de cette projection.
         ) order by p.sort_order, p.label), '[]'::jsonb)
    into v_rows
    from hermes_os.integration_providers p
    left join hermes_os.tenant_integration_connections c
      on c.provider = p.provider and c.tenant_id = v_t
   -- MÊME règle que l'interface, appliquée ici : un fournisseur hors verticale
   -- n'est pas masqué à l'affichage, il n'est pas renvoyé.
   where p.enabled
     and hermes_os.tenant_allows_provider(v_t, p.provider);

  return jsonb_build_object('resolution_status', 'OK', 'tenant_id', v_t,
    'integrations', v_rows, 'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_tenant_integrations() from public;
grant execute on function public.get_tenant_integrations() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. DÉMARRER une connexion — l'application ne détient toujours aucun secret.
--
--    Renvoie l'URL d'autorisation et enregistre l'empreinte du `state`.
--    Le `state` en clair n'est renvoyé QU'UNE FOIS, à l'appelant authentifié.
-- ---------------------------------------------------------------------------
create or replace function public.begin_integration_connection(
  p_provider       text,
  p_redirect_after text default '/integrations'
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.integration_guard();
  v_t text; v_p hermes_os.integration_providers%rowtype;
  v_state text; v_hash text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.integration_providers
   where provider = p_provider and enabled;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_UNAVAILABLE');
  end if;
  -- Le démarrage est refusé, pas seulement masqué : sans cela, un appel direct
  -- à cette RPC lancerait un flux OAuth pour un fournisseur hors verticale.
  if not hermes_os.tenant_allows_provider(v_t, p_provider) then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_ALLOWED_FOR_VERTICAL');
  end if;
  if v_p.client_id is null then
    -- Fournisseur déclaré mais pas encore provisionné côté Hermès : on le dit,
    -- plutôt que de renvoyer une URL d'autorisation qui échouerait chez Google.
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_PROVISIONED');
  end if;

  v_state := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_state, 'UTF8')), 'hex');

  insert into hermes_os.tenant_integration_oauth_states
    (state_hash, tenant_id, provider, requested_by, redirect_after, expires_at)
  values (v_hash, v_t, p_provider, (v_g->>'uid')::uuid, p_redirect_after,
          now() + interval '10 minutes');

  -- La connexion passe en CONNECTING : l'UI peut afficher l'état intermédiaire.
  insert into hermes_os.tenant_integration_connections (tenant_id, provider, status)
  values (v_t, p_provider, 'CONNECTING')
  on conflict (tenant_id, provider) do update
    set status = case
                   -- Ne JAMAIS écraser une connexion saine par un simple clic.
                   when hermes_os.tenant_integration_connections.status = 'CONNECTED'
                   then 'CONNECTED' else 'CONNECTING' end,
        updated_at = now();

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'provider', p_provider,
    'authorize_url', v_p.authorize_url,
    'client_id', v_p.client_id,
    'scopes', to_jsonb(v_p.default_scopes),
    'state', v_state);
end;
$function$;

revoke all on function public.begin_integration_connection(text, text) from public;
grant execute on function public.begin_integration_connection(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RÉVOQUER — accessible au tenant, fail-closed et immédiat.
--
--    Le pointeur Vault est effacé DANS LA MÊME transaction que le passage à
--    REVOKED : il ne peut pas rester un statut révoqué pointant encore vers un
--    jeton. La destruction du secret dans Vault est faite par n8n (seul rôle
--    ayant accès au schéma `vault`).
-- ---------------------------------------------------------------------------
create or replace function public.revoke_integration_connection(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.integration_guard();
  v_t text; v_n int;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  update hermes_os.tenant_integration_connections
     set status = 'REVOKED',
         revoked_at = now(),
         vault_secret_id = null,
         scopes_granted = '{}',
         updated_at = now()
   where tenant_id = v_t and provider = p_provider;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', v_n > 0,
    'code', case when v_n > 0 then 'OK' else 'NOT_FOUND' end);
end;
$function$;

revoke all on function public.revoke_integration_connection(text) from public;
grant execute on function public.revoke_integration_connection(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. FINALISER — appelée UNIQUEMENT par n8n en `service_role`, jamais par le
--    navigateur. C'est le seul point où un `vault_secret_id` entre en base.
--
--    Le `state` est consommé de façon atomique : un rejeu du callback échoue.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.complete_integration_connection(
  p_state           text,
  p_vault_secret_id uuid,
  p_account_label   text,
  p_scopes          text[],
  p_expires_at      timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_hash text; v_s hermes_os.tenant_integration_oauth_states%rowtype;
begin
  if p_state is null or p_vault_secret_id is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;
  v_hash := encode(sha256(convert_to(p_state, 'UTF8')), 'hex');

  -- Consommation ATOMIQUE : `consumed_at is null` dans le WHERE rend le rejeu
  -- impossible même sous concurrence.
  update hermes_os.tenant_integration_oauth_states
     set consumed_at = now()
   where state_hash = v_hash and consumed_at is null and expires_at > now()
  returning * into v_s;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'STATE_INVALID_OR_EXPIRED');
  end if;

  update hermes_os.tenant_integration_connections
     set status = 'CONNECTED',
         vault_secret_id = p_vault_secret_id,
         account_label = p_account_label,
         scopes_granted = coalesce(p_scopes, '{}'),
         connected_at = now(),
         expires_at = p_expires_at,
         revoked_at = null,
         last_error_code = null,
         last_checked_at = now(),
         updated_at = now()
   where tenant_id = v_s.tenant_id and provider = v_s.provider;

  return jsonb_build_object('ok', true, 'code', 'OK',
    'tenant_id', v_s.tenant_id, 'provider', v_s.provider);
end;
$function$;

-- Aucun rôle client : ni `authenticated`, ni `anon`. Seuls `service_role`
-- (n8n) et le propriétaire peuvent l'appeler.
revoke all on function hermes_os.complete_integration_connection(text, uuid, text, text[], timestamptz) from public;
grant execute on function hermes_os.complete_integration_connection(text, uuid, text, text[], timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 9. LECTURE FAIL-CLOSED pour les consommateurs métier (ex. standard photo).
--
--    Répond « puis-je lire l'agenda de ce tenant MAINTENANT ? ». Toute
--    situation autre que CONNECTED non expiré ⇒ faux. C'est cette fonction, et
--    non l'appelant, qui décide.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.integration_is_usable(p_tenant text, p_provider text)
returns boolean
language sql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select exists (
    select 1 from hermes_os.tenant_integration_connections c
     where c.tenant_id = p_tenant
       and c.provider = p_provider
       and c.status = 'CONNECTED'
       and c.vault_secret_id is not null
       and (c.expires_at is null or c.expires_at > now())
  );
$function$;

revoke all on function hermes_os.integration_is_usable(text, text) from public;

-- ---------------------------------------------------------------------------
-- 10. Catalogue initial — DÉSACTIVÉ, sans client_id.
--     Rien n'est joignable tant qu'un opérateur Hermès n'a pas provisionné le
--     `client_id` ET activé la ligne.
-- ---------------------------------------------------------------------------
insert into hermes_os.integration_providers
  (provider, label, authorize_url, token_url, default_scopes, enabled, sort_order)
values
  ('google_calendar', 'Google Agenda',
   'https://accounts.google.com/o/oauth2/v2/auth',
   'https://oauth2.googleapis.com/token',
   array['https://www.googleapis.com/auth/calendar.readonly'], false, 10),
  ('gmail', 'Gmail',
   'https://accounts.google.com/o/oauth2/v2/auth',
   'https://oauth2.googleapis.com/token',
   array['https://www.googleapis.com/auth/gmail.send'], false, 20),
  ('meta', 'Facebook / Meta',
   'https://www.facebook.com/v21.0/dialog/oauth',
   'https://graph.facebook.com/v21.0/oauth/access_token',
   array['pages_manage_posts'], false, 30),
  ('instagram', 'Instagram',
   'https://www.facebook.com/v21.0/dialog/oauth',
   'https://graph.facebook.com/v21.0/oauth/access_token',
   array['instagram_content_publish'], false, 40)
on conflict (provider) do nothing;

-- ---------------------------------------------------------------------------
-- 9. COMPLÉTER LE FLUX DEPUIS L'APPLICATION — sans clé `service_role`.
--
--    Pourquoi cette fonction existe. La version `service_role` (§8) suppose que
--    n8n boucle le flux. Faire boucler l'application à la place exigerait
--    qu'elle porte la clé `service_role` — laquelle contourne TOUT le RLS et
--    serait bien pire qu'un `client_secret` Google. Cette variante supprime ce
--    dilemme : la route serveur Next.js n'a besoin d'AUCUNE clé Supabase
--    privilégiée, seulement de la session de l'utilisatrice, déjà présente.
--
--    CE QUI LA REND SÛRE, point par point — chacun est vérifié par un test :
--
--     1. `auth.uid()` obligatoire. Aucun appel anonyme.
--     2. Le `state` est consommé ATOMIQUEMENT (`consumed_at is null` DANS le
--        `where` de l'UPDATE). Un rejeu du callback ne trouve plus rien, même
--        sous concurrence : c'est le `UPDATE ... RETURNING` qui arbitre, pas une
--        lecture suivie d'une écriture.
--     3. L'appelant doit être CELUI qui a démarré le flux (`requested_by`).
--        Sans cela, un utilisateur pourrait terminer la connexion d'un autre.
--     4. Le `tenant_id` vient de la ligne de `state`, écrite côté serveur au
--        démarrage. Il n'est JAMAIS pris dans un paramètre : la signature ne
--        comporte aucun `p_tenant_id`, donc l'oubli est impossible.
--     5. Le fournisseur est revérifié : activé ET autorisé pour la verticale.
--        Une verticale changée entre le début et la fin du flux referme.
--     6. Le jeton part directement dans Vault (`vault.create_secret`), que
--        SECURITY DEFINER rend accessible sans donner l'accès à `authenticated`.
--     7. Le retour ne contient NI jeton NI `vault_secret_id`.
--
--    Ce qu'elle ne fait PAS : l'échange `code → token`. Il a lieu dans la route
--    serveur, qui seule détient `GOOGLE_CLIENT_SECRET` (variable serveur, jamais
--    préfixée NEXT_PUBLIC_, donc jamais dans le bundle navigateur).
-- ---------------------------------------------------------------------------
create or replace function public.complete_integration_connection_self(
  p_state         text,
  p_access_token  text,
  p_refresh_token text default null,
  p_expires_at    timestamptz default null,
  p_account_label text default null,
  p_scopes        text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_state hermes_os.tenant_integration_oauth_states%rowtype;
  v_secret_id uuid;
  v_payload text;
begin
  -- (1) Authentification.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_state is null or p_access_token is null or length(btrim(p_access_token)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  v_hash := encode(sha256(convert_to(p_state, 'UTF8')), 'hex');

  -- (2) Consommation ATOMIQUE du state. Un rejeu ne trouve rien : la condition
  --     `consumed_at is null` fait partie de l'UPDATE, pas d'un SELECT préalable.
  update hermes_os.tenant_integration_oauth_states
     set consumed_at = now()
   where state_hash = v_hash
     and consumed_at is null
     and expires_at > now()
  returning * into v_state;

  if not found then
    -- Volontairement indistinct : rejeu, expiration et state inconnu renvoient
    -- le même code. Distinguer aiderait surtout un attaquant à sonder.
    return jsonb_build_object('ok', false, 'code', 'STATE_INVALID');
  end if;

  -- (3) Le flux appartient à celui qui l'a démarré.
  if v_state.requested_by is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'STATE_NOT_YOURS');
  end if;

  -- (4) Le tenant vient du state, jamais du client. (5) Fournisseur revérifié.
  if not hermes_os.tenant_allows_provider(v_state.tenant_id, v_state.provider) then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_ALLOWED_FOR_VERTICAL');
  end if;

  -- (6) Le secret va dans Vault. `authenticated` n'a aucun droit sur le schéma
  --     `vault` ; c'est SECURITY DEFINER qui autorise cette écriture ici, et
  --     nulle part ailleurs.
  v_payload := jsonb_build_object(
                 'access_token', p_access_token,
                 'refresh_token', p_refresh_token)::text;

  select vault.create_secret(
           v_payload,
           format('integration/%s/%s/%s', v_state.tenant_id, v_state.provider,
                  encode(gen_random_bytes(8), 'hex')),
           format('OAuth %s — tenant %s', v_state.provider, v_state.tenant_id))
    into v_secret_id;

  update hermes_os.tenant_integration_connections
     set status          = 'CONNECTED',
         vault_secret_id = v_secret_id,
         account_label   = p_account_label,
         scopes_granted  = coalesce(p_scopes, '{}'),
         connected_at    = now(),
         expires_at      = p_expires_at,
         last_refresh_at = now(),
         last_error_code = null,
         revoked_at      = null,
         updated_at      = now()
   where tenant_id = v_state.tenant_id
     and provider  = v_state.provider;

  if not found then
    -- Le démarrage crée toujours la ligne ; son absence signale une incohérence
    -- réelle. On refuse plutôt que d'inventer une connexion.
    return jsonb_build_object('ok', false, 'code', 'CONNECTION_MISSING');
  end if;

  -- (7) Rien de secret ne sort. Pas de jeton, pas de vault_secret_id.
  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'provider', v_state.provider,
    'redirect_after', coalesce(v_state.redirect_after, '/integrations'));
end;
$function$;

revoke all on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) from public;
grant execute on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) to authenticated;

comment on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) is
  'Boucle le flux OAuth depuis la route serveur Next.js, SANS clé service_role. '
  'Le tenant vient du state (écrit côté serveur), jamais d''un paramètre.';

-- ---------------------------------------------------------------------------
-- 10. MARQUER UN ÉCHEC — pour que l'interface dise « réessayez » au lieu de
--     laisser une connexion éternellement « en cours ».
-- ---------------------------------------------------------------------------
create or replace function public.fail_integration_connection(
  p_state text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_hash text;
  v_state hermes_os.tenant_integration_oauth_states%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  v_hash := encode(sha256(convert_to(coalesce(p_state, ''), 'UTF8')), 'hex');

  update hermes_os.tenant_integration_oauth_states
     set consumed_at = now()
   where state_hash = v_hash and consumed_at is null
  returning * into v_state;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'STATE_INVALID');
  end if;
  if v_state.requested_by is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'STATE_NOT_YOURS');
  end if;

  update hermes_os.tenant_integration_connections
     set status = 'ERROR',
         -- Code BORNÉ : le message du fournisseur n'entre pas tel quel en base.
         last_error_code = left(coalesce(p_error_code, 'UNKNOWN'), 60),
         last_checked_at = now(),
         updated_at = now()
   where tenant_id = v_state.tenant_id
     and provider = v_state.provider
     and status <> 'CONNECTED';

  return jsonb_build_object('ok', true, 'code', 'OK',
    'redirect_after', coalesce(v_state.redirect_after, '/integrations'));
end;
$function$;

revoke all on function public.fail_integration_connection(text, text) from public;
grant execute on function public.fail_integration_connection(text, text) to authenticated;

commit;
