-- LOT PV-8 / 3 — DURCISSEMENT : ACCEPTED EXIGE UNE PREUVE, LA COMMANDE EXIGE L'ACOMPTE
--
-- C'est ici que PV-8 gagne son utilite. Les deux migrations precedentes ont
-- construit des objets ; celle-ci les rend OPPOSABLES.
--
-- ETAT REEL MESURE AVANT CE DURCISSEMENT (section 20 de la mission) :
--   devis total ................ 0
--   devis ACCEPTED ............. 0
--   devis hors DRAFT ........... 0
--   commandes fournisseur ...... 0
--   commandes READY/ORDERED/RECEIVED  0
--   prospects .................. 0
--   documents .................. 0
-- Aucune ligne reelle n'existe : le durcissement peut etre strict d'emblee,
-- sans backfill ni regle progressive. Ce n'est pas une supposition, c'est une
-- mesure ; et la regle est malgre tout ecrite pour ne s'appliquer QU'AUX
-- TRANSITIONS, de sorte qu'une eventuelle ligne ACCEPTED preexistante ne serait
-- pas cassee retroactivement.
--
-- ORDRE RETENU (section 12) : SENT -> preuve enregistree -> ACCEPTED.
-- Cet ordre est le seul coherent : la preuve constate un accord sur un document
-- envoye. L'inverse (ACCEPTED puis preuve) laisserait une fenetre pendant
-- laquelle PV-7 autoriserait deja une commande fournisseur.

begin;

-- ---------------------------------------------------------------------------
-- 1. La preuve valide d'un devis
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_quote_acceptance_proof(p_tenant text, p_quote_id uuid)
returns hermes_os.pv_quote_acceptances
language sql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
  -- Une preuve n'est valide que pour la version EXACTE en cours. Le join sur
  -- `a.quote_version = q.version` est toute la regle : si le devis passe en v2,
  -- la preuve de la v1 cesse d'etre retournee, sans qu'aucun statut ait bouge.
  select a.*
    from hermes_os.pv_quote_acceptances a
    join hermes_os.pv_quotes q
      on q.id = a.quote_id and q.tenant_id = a.tenant_id
   where a.tenant_id = p_tenant
     and a.quote_id  = p_quote_id
     and a.status    = 'ACTIVE'
     and a.quote_version = q.version
   limit 1;
$$;

comment on function hermes_os.pv_quote_acceptance_proof(text, uuid) is
  'PV-8 : preuve d''acceptation ACTIVE couvrant la version COURANTE du devis. '
  'Retourne 0 ligne si le devis a change de version depuis : nouvelle version = nouvelle preuve.';

-- ---------------------------------------------------------------------------
-- 2. ACCEPTED exige une preuve — sur les TRANSITIONS uniquement
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_quote_acceptance_proof_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_proof hermes_os.pv_quote_acceptances;
begin
  -- Ne mordre que sur l'ENTREE en ACCEPTED. Une ligne deja ACCEPTED avant PV-8
  -- (il n'y en a aucune, c'est mesure) ne serait jamais reevaluee : elle peut
  -- continuer a vivre, etre lue, etre superseded. On durcit l'avenir, on ne
  -- casse pas le passe.
  if new.status is distinct from 'ACCEPTED' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ACCEPTED' then return new; end if;

  select * into v_proof from hermes_os.pv_quote_acceptance_proof(new.tenant_id, new.id);
  if v_proof.id is null then
    raise exception 'PV_ACCEPTATION_SANS_PREUVE: un devis ne peut pas passer ACCEPTED sans preuve d''acceptation ACTIVE couvrant sa version courante (v%). Enregistrer d''abord la preuve sur le devis SENT.', new.version
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Ce declencheur doit s'executer APRES la garde de transition et APRES la garde
-- humaine de PV-1 ; l'ordre alphabetique des noms de declencheurs le garantit
-- (`trg_pv_quotes_status_guard` < `trg_pv_quotes_z_acceptance_proof`).
drop trigger if exists trg_pv_quotes_z_acceptance_proof on hermes_os.pv_quotes;
create trigger trg_pv_quotes_z_acceptance_proof
  before update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_quote_acceptance_proof_guard();

-- ---------------------------------------------------------------------------
-- 3. L'engagement commercial — indicateur deterministe, aucune IA
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_commercial_commitment(p_tenant text, p_site_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_q hermes_os.pv_quotes;
  v_proof hermes_os.pv_quote_acceptances;
  v_dep hermes_os.pv_deposits;
  v_required boolean;
begin
  if p_site_id is null then return 'NOT_ACCEPTED'; end if;

  -- Le devis qui engage : le plus recent en ACCEPTED sur ce site.
  select * into v_q from hermes_os.pv_quotes q
   where q.tenant_id = p_tenant and q.site_id = p_site_id and q.status = 'ACCEPTED'
   order by q.accepted_at desc nulls last, q.version desc limit 1;
  if v_q.id is null then return 'NOT_ACCEPTED'; end if;

  -- Un devis ACCEPTED dont la preuve ne couvre plus la version courante est
  -- exactement aussi peu prouve qu'un devis sans preuve du tout. Les deux
  -- rendent ACCEPTED_UNPROVEN : le mot dit ce qu'il se passe, et l'ecran
  -- affichera pourquoi.
  select * into v_proof from hermes_os.pv_quote_acceptance_proof(p_tenant, v_q.id);
  if v_proof.id is null then return 'ACCEPTED_UNPROVEN'; end if;

  v_required := hermes_os.pv_deposit_required(p_tenant);

  select * into v_dep from hermes_os.pv_deposits d
   where d.tenant_id = p_tenant and d.quote_id = v_q.id
     and d.status <> 'CANCELLED'
   order by d.sequence limit 1;

  -- Politique : pas d'acompte exige -> la preuve suffit a securiser.
  if not v_required then return 'SECURED'; end if;

  -- Acompte exige mais rien de prepare : l'affaire est acceptee et prouvee,
  -- l'acompte reste a mettre en place. C'est l'etat ACCEPTED tout court.
  if v_dep.id is null then return 'ACCEPTED'; end if;

  if v_dep.status in ('PAID','OVERPAID','WAIVED') then return 'SECURED'; end if;
  return 'DEPOSIT_PENDING';
end;
$$;

comment on function hermes_os.pv_commercial_commitment(text, uuid) is
  'PV-8 : NOT_ACCEPTED < ACCEPTED_UNPROVEN < ACCEPTED < DEPOSIT_PENDING < SECURED. '
  'SECURED signifie : devis accepte, preuve couvrant exactement la version courante, '
  'et acompte paye ou explicitement renonce (ou non exige par la politique du tenant).';

-- ---------------------------------------------------------------------------
-- 4. La porte fournisseur — c'est le coeur de PV-8
-- ---------------------------------------------------------------------------
--
-- COMPATIBILITE AVEC LES COMMANDES EXISTANTES. `pv_purchase_blockers` n'est
-- consulte QUE par `set_pv_purchase_order_ready` et
-- `mark_pv_purchase_order_ordered`, au moment de la transition. Une commande
-- deja ORDERED, PARTIALLY_RECEIVED ou RECEIVED n'est jamais reevaluee : etendre
-- cette fonction ne peut donc pas casser retroactivement une commande passee.
-- La protection est STRUCTURELLE, pas une precaution ecrite.

create or replace function hermes_os.pv_purchase_blockers(p_order_id uuid)
returns text[]
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  o hermes_os.pv_purchase_orders; v_out text[] := '{}'; v_lines int;
  v_gate text; v_accepted int; v_blocking int;
  v_q hermes_os.pv_quotes; v_proof hermes_os.pv_quote_acceptances;
  v_dep hermes_os.pv_deposits; v_any_proof int;
begin
  select * into o from hermes_os.pv_purchase_orders where id = p_order_id;
  if o.id is null then return array['ORDER_NOT_FOUND']; end if;

  select count(*) into v_lines from hermes_os.pv_purchase_order_lines where order_id = p_order_id;
  if v_lines = 0 then v_out := array_append(v_out, 'NO_LINE'); end if;
  if o.subtotal_ht_eur is null or o.subtotal_ht_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;

  if not exists (select 1 from hermes_os.pv_suppliers s
                  where s.id = o.supplier_id and s.tenant_id = o.tenant_id and s.is_active) then
    v_out := array_append(v_out, 'SUPPLIER_INACTIVE');
  end if;

  select count(*) into v_accepted from hermes_os.pv_quotes q
   where q.tenant_id = o.tenant_id and q.site_id = o.site_id and q.status = 'ACCEPTED';
  if v_accepted = 0 then v_out := array_append(v_out, 'QUOTE_NOT_ACCEPTED'); end if;

  -- ===== PV-8 : la preuve et l'acompte =====
  if v_accepted > 0 then
    select * into v_q from hermes_os.pv_quotes q
     where q.tenant_id = o.tenant_id and q.site_id = o.site_id and q.status = 'ACCEPTED'
     order by q.accepted_at desc nulls last, q.version desc limit 1;

    select * into v_proof from hermes_os.pv_quote_acceptance_proof(o.tenant_id, v_q.id);
    if v_proof.id is null then
      -- Deux causes, deux codes. Elles n'appellent pas le meme geste : dans un
      -- cas il faut enregistrer une preuve, dans l'autre il faut la refaire
      -- parce que le devis a change sous les pieds du client.
      select count(*) into v_any_proof from hermes_os.pv_quote_acceptances a
       where a.tenant_id = o.tenant_id and a.quote_id = v_q.id and a.status = 'ACTIVE';
      if v_any_proof > 0 then
        v_out := array_append(v_out, 'QUOTE_ACCEPTANCE_VERSION_MISMATCH');
      else
        v_out := array_append(v_out, 'QUOTE_ACCEPTANCE_PROOF_REQUIRED');
      end if;
    end if;

    if hermes_os.pv_deposit_required(o.tenant_id) then
      select * into v_dep from hermes_os.pv_deposits d
       where d.tenant_id = o.tenant_id and d.quote_id = v_q.id and d.status <> 'CANCELLED'
       order by d.sequence limit 1;

      if v_dep.id is null then
        v_out := array_append(v_out, 'DEPOSIT_REQUIRED');
      elsif v_dep.status not in ('PAID','OVERPAID','WAIVED') then
        v_out := array_append(v_out, 'DEPOSIT_NOT_PAID');
      end if;
    end if;
  end if;
  -- ===== fin PV-8 =====

  v_gate := hermes_os.pv_survey_gate(o.tenant_id, o.site_id);
  if v_gate = 'BLOCKING' then
    v_out := array_append(v_out, 'SITE_SURVEY_BLOCKING');
  elsif v_gate <> 'OK' then
    v_out := array_append(v_out, 'SITE_SURVEY_NOT_VALIDATED');
  end if;

  select count(*) into v_blocking
    from hermes_os.pv_site_survey_findings f
    join hermes_os.pv_site_surveys v on v.id = f.survey_id and v.tenant_id = f.tenant_id
   where f.tenant_id = o.tenant_id and v.site_id = o.site_id
     and f.is_blocking and f.resolution is null
     and v.status <> 'CANCELLED';
  if v_blocking > 0 then v_out := array_append(v_out, 'SURVEY_FINDINGS_UNRESOLVED'); end if;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_pv_deal expose l'engagement commercial
-- ---------------------------------------------------------------------------

create or replace function public.get_pv_deal(p_prospect_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_p hermes_os.pv_prospects;
  v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies;
  v_latest hermes_os.pv_studies;
  v_econ hermes_os.pv_economics;
  v_cons jsonb; v_bill jsonb; v_assum jsonb; v_docs jsonb; v_studies jsonb;
  v_gate text := 'NONE'; v_material text := 'NOT_READY';
  v_commitment text := 'NOT_ACCEPTED';
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;

  if v_site.id is not null then
    select coalesce(to_jsonb(c) - 'tenant_id', 'null'::jsonb) into v_cons
      from hermes_os.pv_consumption_profiles c
     where c.tenant_id = v_t and c.site_id = v_site.id
     order by c.created_at desc limit 1;

    select coalesce(to_jsonb(b) - 'tenant_id', 'null'::jsonb) into v_bill
      from hermes_os.pv_energy_bills b
     where b.tenant_id = v_t and b.site_id = v_site.id and b.status = 'VERIFIED'
     order by b.period_end desc nulls last, b.created_at desc limit 1;

    select * into v_study from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
     order by s.version desc limit 1;

    select * into v_latest from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id
     order by s.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'version', s.version, 'status', s.status,
             'prepared_by', s.prepared_by, 'target_power_kwc', s.target_power_kwc)
             order by s.version desc), '[]'::jsonb)
      into v_studies
      from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
             'original_filename', d.original_filename, 'mime_type', d.mime_type,
             'size_bytes', d.size_bytes, 'status', d.status,
             'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
             order by d.uploaded_at desc), '[]'::jsonb)
      into v_docs
      from hermes_os.pv_documents d
     where d.tenant_id = v_t and d.site_id = v_site.id and d.deleted_at is null;

    v_gate := hermes_os.pv_survey_gate(v_t, v_site.id);
    v_material := hermes_os.pv_material_readiness(v_t, v_site.id);
    v_commitment := hermes_os.pv_commercial_commitment(v_t, v_site.id);
  end if;

  if v_study.id is not null then
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;

    select coalesce(to_jsonb(a) - 'tenant_id', 'null'::jsonb) into v_assum
      from hermes_os.pv_study_assumptions a
     where a.tenant_id = v_t and a.study_id = v_study.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'prospect', to_jsonb(v_p) - 'tenant_id',
    'site', case when v_site.id is null then 'null'::jsonb else to_jsonb(v_site) - 'tenant_id' end,
    'consumption', coalesce(v_cons, 'null'::jsonb),
    'verified_bill', coalesce(v_bill, 'null'::jsonb),
    'retained_study', case when v_study.id is null then 'null'::jsonb else to_jsonb(v_study) - 'tenant_id' end,
    'latest_study', case when v_latest.id is null then 'null'::jsonb else to_jsonb(v_latest) - 'tenant_id' end,
    'retained_assumptions', coalesce(v_assum, 'null'::jsonb),
    'retained_economics', case when v_econ.id is null then 'null'::jsonb else to_jsonb(v_econ) - 'tenant_id' end,
    'studies', coalesce(v_studies, '[]'::jsonb),
    'documents', coalesce(v_docs, '[]'::jsonb),
    'survey_gate', v_gate,
    'material_readiness', v_material,
    'commercial_commitment', v_commitment);
end;
$$;

commit;
