-- LOT PV-8 / 4 — FACADES
--
-- Meme discipline que PV-1 a PV-7 : les tables sont deny-all (RLS active, zero
-- policy, aucun GRANT a anon ni authenticated). Tout passe par des facades
-- SECURITY DEFINER dans `public`, accordees a `authenticated` seulement, qui
-- resolvent le tenant SERVEUR via `pv_guard()`.
--
-- AUCUNE facade n'accepte de tenant_id : le navigateur ne choisit jamais son
-- tenant. AUCUNE facade n'accepte de montant recu total : le total est agrege
-- par declencheur depuis les evenements de paiement.
--
-- PERMISSIONS — DECISION DOCUMENTEE. Constater l'accord d'un client et pointer
-- un virement recu sont des gestes de suivi commercial quotidien, pas des actes
-- d'administration. Exiger `tenant.admin` obligerait a partager un compte
-- d'administration pour saisir un cheque, ce qui serait pire que le risque
-- evite. Les facades passent donc par `pv_guard()` (membre du tenant), comme
-- PV-3, PV-6 et PV-7. En revanche CHACUN de ces gestes exige un HUMAIN
-- authentifie au niveau des declencheurs : aucun agent ne peut produire une
-- preuve d'acceptation ni declarer un paiement.

begin;

-- ---------------------------------------------------------------------------
-- 1. Politique commerciale
-- ---------------------------------------------------------------------------

create or replace function public.get_pv_commercial_policy()
returns jsonb
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_p hermes_os.pv_commercial_policies;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant';
  select * into v_p from hermes_os.pv_commercial_policies where tenant_id = v_t;
  return jsonb_build_object('ok', true, 'code', 'OK',
    'deposit_required', coalesce(v_p.deposit_required, true),
    'default_deposit_pct', v_p.default_deposit_pct,
    'policy_note', v_p.policy_note,
    'configured', v_p.tenant_id is not null);
end;
$$;

create or replace function public.set_pv_commercial_policy(
  p_deposit_required boolean,
  p_default_deposit_pct numeric default null,
  p_policy_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  -- Ne plus exiger d'acompte est une decision, pas un reglage anodin : elle
  -- ouvre la commande fournisseur sans avance encaissee. Elle se justifie.
  if p_deposit_required is not true
     and (p_policy_note is null or btrim(p_policy_note) = '') then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  insert into hermes_os.pv_commercial_policies
    (tenant_id, deposit_required, default_deposit_pct, policy_note, updated_by)
  values (v_t, coalesce(p_deposit_required, true), p_default_deposit_pct,
          nullif(btrim(coalesce(p_policy_note,'')),''), v_uid)
  on conflict (tenant_id) do update
    set deposit_required    = excluded.deposit_required,
        default_deposit_pct = excluded.default_deposit_pct,
        policy_note         = excluded.policy_note,
        updated_by          = excluded.updated_by,
        updated_at          = now();

  perform hermes_os._pv_audit(v_t, 'pv_commercial_policies', null, '{}'::jsonb,
    jsonb_build_object('deposit_required', coalesce(p_deposit_required, true)),
    format('politique commerciale : acompte %s',
           case when coalesce(p_deposit_required,true) then 'exige' else 'non exige' end));

  return jsonb_build_object('ok', true, 'code', 'OK');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Preuve d'acceptation
-- ---------------------------------------------------------------------------

create or replace function public.record_pv_quote_acceptance(
  p_quote_id uuid,
  p_method text,
  p_accepted_on date default null,
  p_signatory_name text default null,
  p_signatory_role text default null,
  p_external_reference text default null,
  p_proof_document_id uuid default null,
  p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_doc hermes_os.pv_documents; v_id uuid; v_sha text;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  if p_method not in ('SIGNED_DOCUMENT','EXTERNAL_REFERENCE','MANUAL_CONFIRMATION') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_METHOD');
  end if;

  -- L'empreinte n'est PAS un parametre : elle est LUE sur le PDF final du devis
  -- dans sa version courante. Un navigateur ne peut donc pas fournir un hash de
  -- son choix, et la preuve pointe forcement le document reellement produit.
  select * into v_doc from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.quote_id = p_quote_id
     and d.document_stage = 'QUOTE_FINAL' and d.deleted_at is null
   order by d.uploaded_at desc limit 1;
  v_sha := v_doc.sha256;

  insert into hermes_os.pv_quote_acceptances (
    tenant_id, quote_id, prospect_id, site_id, quote_version, quote_pdf_sha256,
    quote_document_id, method, accepted_on, signatory_name, signatory_role,
    external_reference, proof_document_id, comment, recorded_by, recorded_at)
  values (
    v_t, p_quote_id, v_q.prospect_id, v_q.site_id, v_q.version, v_sha,
    v_doc.id, p_method, coalesce(p_accepted_on, current_date),
    nullif(btrim(coalesce(p_signatory_name,'')),''),
    nullif(btrim(coalesce(p_signatory_role,'')),''),
    nullif(btrim(coalesce(p_external_reference,'')),''),
    p_proof_document_id, nullif(btrim(coalesce(p_comment,'')),''),
    v_uid, now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id,
    'quote_version', v_q.version, 'quote_pdf_sha256', v_sha);
exception
  when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
  when unique_violation then return jsonb_build_object('ok', false, 'code', 'ALREADY_RECORDED');
  when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  when check_violation then return jsonb_build_object('ok', false, 'code', 'REFUSED', 'detail', sqlerrm);
end;
$$;

create or replace function public.supersede_pv_quote_acceptance(
  p_acceptance_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_n int;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant';
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  -- Une preuve ne se supprime pas et ne se reecrit pas : elle est marquee
  -- remplacee, avec sa raison et sa date. L'historique reste lisible.
  update hermes_os.pv_quote_acceptances
     set status = 'SUPERSEDED', superseded_at = now(),
         supersede_reason = btrim(p_reason), updated_at = now()
   where id = p_acceptance_id and tenant_id = v_t and status = 'ACTIVE';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND_OR_ALREADY_SUPERSEDED'); end if;
  return jsonb_build_object('ok', true, 'code', 'OK');
end;
$$;

create or replace function public.get_pv_quote_acceptances(p_quote_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_rows jsonb;
        v_q hermes_os.pv_quotes; v_proof hermes_os.pv_quote_acceptances;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant';

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  select * into v_proof from hermes_os.pv_quote_acceptance_proof(v_t, p_quote_id);

  select coalesce(jsonb_agg(to_jsonb(a) - 'tenant_id' order by a.recorded_at desc), '[]'::jsonb)
    into v_rows
    from hermes_os.pv_quote_acceptances a
   where a.tenant_id = v_t and a.quote_id = p_quote_id;

  return jsonb_build_object('ok', true, 'code', 'OK',
    'quote_version', v_q.version, 'quote_status', v_q.status,
    'valid_proof_id', v_proof.id,
    'acceptances', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptation du devis — le geste complet
-- ---------------------------------------------------------------------------

create or replace function public.accept_pv_quote(
  p_quote_id uuid,
  p_method text,
  p_accepted_on date default null,
  p_signatory_name text default null,
  p_signatory_role text default null,
  p_external_reference text default null,
  p_proof_document_id uuid default null,
  p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_rec jsonb;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status = 'ACCEPTED' then return jsonb_build_object('ok', true, 'code', 'ALREADY_ACCEPTED'); end if;

  -- ORDRE : la preuve D'ABORD, le statut ENSUITE. Si l'enregistrement de la
  -- preuve echoue, le devis reste SENT — jamais l'inverse, qui laisserait un
  -- ACCEPTED sans preuve, c'est-a-dire exactement le trou que PV-8 comble.
  v_rec := public.record_pv_quote_acceptance(
    p_quote_id, p_method, p_accepted_on, p_signatory_name, p_signatory_role,
    p_external_reference, p_proof_document_id, p_comment);
  if not (v_rec->>'ok')::boolean then return v_rec; end if;

  begin
    update hermes_os.pv_quotes
       set status = 'ACCEPTED', accepted_by = v_uid, accepted_at = now(),
           accepted_on = coalesce(p_accepted_on, current_date),
           acceptance_reference = nullif(btrim(coalesce(p_external_reference,'')),''),
           updated_by = v_uid, updated_at = now()
     where id = p_quote_id and tenant_id = v_t;
  exception
    when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_q.status,
                                'detail', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'code', 'ACCEPTED',
    'acceptance_id', v_rec->>'id', 'quote_version', v_q.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Acompte
-- ---------------------------------------------------------------------------

create or replace function public.create_pv_deposit(
  p_quote_id uuid,
  p_amount_expected_eur numeric default null,
  p_percentage_pct numeric default null,
  p_basis text default 'QUOTE_TOTAL_TTC',
  p_due_on date default null,
  p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_acc hermes_os.pv_quote_acceptances;
  v_basis numeric(14,2); v_amount numeric(14,2); v_id uuid;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  if p_basis not in ('QUOTE_TOTAL_TTC','QUOTE_TOTAL_HT','FIXED_AMOUNT') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_BASIS');
  end if;

  -- Le montant est CALCULE en base a partir du total du devis, jamais recu du
  -- navigateur — sauf en FIXED_AMOUNT, ou il est saisi assume et ou aucun
  -- pourcentage n'a de sens.
  v_basis := case p_basis
               when 'QUOTE_TOTAL_TTC' then v_q.total_ttc_eur
               when 'QUOTE_TOTAL_HT'  then v_q.total_ht_eur
               else null end;

  if p_basis = 'FIXED_AMOUNT' then
    v_amount := p_amount_expected_eur;
  elsif p_percentage_pct is not null then
    v_amount := round(coalesce(v_basis,0) * p_percentage_pct / 100, 2);
  else
    v_amount := p_amount_expected_eur;
  end if;

  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'AMOUNT_NOT_POSITIVE');
  end if;

  select * into v_acc from hermes_os.pv_quote_acceptance_proof(v_t, p_quote_id);

  insert into hermes_os.pv_deposits (
    tenant_id, quote_id, prospect_id, site_id, acceptance_id,
    amount_expected_eur, percentage_pct, basis, basis_amount_eur, due_on,
    comment, created_by)
  values (
    v_t, p_quote_id, v_q.prospect_id, v_q.site_id, v_acc.id,
    v_amount, case when p_basis = 'FIXED_AMOUNT' then null else p_percentage_pct end,
    p_basis, v_basis, p_due_on,
    nullif(btrim(coalesce(p_comment,'')),''), v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id,
    'amount_expected_eur', v_amount, 'basis_amount_eur', v_basis);
exception
  when unique_violation then return jsonb_build_object('ok', false, 'code', 'ALREADY_EXISTS');
  when check_violation then return jsonb_build_object('ok', false, 'code', 'REFUSED', 'detail', sqlerrm);
end;
$$;

create or replace function public.record_pv_deposit_payment(
  p_deposit_id uuid,
  p_amount_eur numeric,
  p_received_on date default null,
  p_method text default 'VIREMENT',
  p_external_reference text default null,
  p_proof_document_id uuid default null,
  p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_d hermes_os.pv_deposits; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_d from hermes_os.pv_deposits d where d.id = p_deposit_id and d.tenant_id = v_t;
  if v_d.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if p_amount_eur is null or p_amount_eur <= 0 then
    return jsonb_build_object('ok', false, 'code', 'AMOUNT_NOT_POSITIVE');
  end if;
  if p_method not in ('VIREMENT','CHEQUE','ESPECES','CB_TERMINAL','AUTRE') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_METHOD');
  end if;

  insert into hermes_os.pv_deposit_payments (
    tenant_id, deposit_id, amount_eur, received_on, method,
    external_reference, proof_document_id, comment, recorded_by, recorded_at)
  values (
    v_t, p_deposit_id, p_amount_eur, coalesce(p_received_on, current_date), p_method,
    nullif(btrim(coalesce(p_external_reference,'')),''), p_proof_document_id,
    nullif(btrim(coalesce(p_comment,'')),''), v_uid, now())
  returning id into v_id;

  -- Relire APRES le rollup : le statut renvoye est celui que la base a calcule,
  -- pas celui que l'appelant esperait.
  select * into v_d from hermes_os.pv_deposits d where d.id = p_deposit_id and d.tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id,
    'status', v_d.status,
    'amount_received_eur', v_d.amount_received_eur,
    'amount_expected_eur', v_d.amount_expected_eur,
    'remaining_eur', greatest(v_d.amount_expected_eur - v_d.amount_received_eur, 0));
exception
  when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'PAYMENT_REFUSED', 'detail', sqlerrm);
  when check_violation then return jsonb_build_object('ok', false, 'code', 'REFUSED', 'detail', sqlerrm);
  when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
end;
$$;

create or replace function public.waive_pv_deposit(p_deposit_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_n int;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  begin
    update hermes_os.pv_deposits
       set status = 'WAIVED', waiver_reason = btrim(p_reason),
           waived_by = v_uid, waived_at = now(),
           updated_by = v_uid, updated_at = now()
     where id = p_deposit_id and tenant_id = v_t and status in ('EXPECTED','PARTIALLY_PAID');
    get diagnostics v_n = row_count;
  exception
    when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'detail', sqlerrm);
  end;

  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND_OR_NOT_WAIVABLE'); end if;
  return jsonb_build_object('ok', true, 'code', 'WAIVED');
end;
$$;

create or replace function public.cancel_pv_deposit(p_deposit_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_n int;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  begin
    update hermes_os.pv_deposits
       set status = 'CANCELLED', cancelled_at = now(), cancellation_reason = btrim(p_reason),
           updated_by = v_uid, updated_at = now()
     where id = p_deposit_id and tenant_id = v_t and status in ('EXPECTED','PARTIALLY_PAID','WAIVED');
    get diagnostics v_n = row_count;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'detail', sqlerrm);
  end;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND_OR_NOT_CANCELLABLE'); end if;
  return jsonb_build_object('ok', true, 'code', 'CANCELLED');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Lecture consolidee : l'engagement client d'une affaire
-- ---------------------------------------------------------------------------

create or replace function public.get_pv_commitment(p_prospect_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v_site hermes_os.pv_sites; v_q hermes_os.pv_quotes;
  v_proof hermes_os.pv_quote_acceptances; v_dep hermes_os.pv_deposits;
  v_payments jsonb; v_docs jsonb; v_any_proof int := 0;
begin
  if not (v_g->>'ok')::boolean then return jsonb_build_object('ok', false, 'code', v_g->>'code'); end if;
  v_t := v_g->>'tenant';

  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = p_prospect_id
   order by s.created_at, s.id limit 1;
  if v_site.id is null then
    return jsonb_build_object('ok', true, 'code', 'OK', 'commitment', 'NOT_ACCEPTED',
      'quote', 'null'::jsonb, 'acceptance', 'null'::jsonb, 'deposit', 'null'::jsonb,
      'payments', '[]'::jsonb, 'documents', '[]'::jsonb,
      'acceptance_superseded_by_version', false,
      'deposit_required', hermes_os.pv_deposit_required(v_t));
  end if;

  -- Le devis qui engage, s'il existe ; sinon le dernier envoye, pour que
  -- l'ecran puisse proposer d'enregistrer une acceptation.
  select * into v_q from hermes_os.pv_quotes q
   where q.tenant_id = v_t and q.site_id = v_site.id and q.status = 'ACCEPTED'
   order by q.accepted_at desc nulls last, q.version desc limit 1;
  if v_q.id is null then
    select * into v_q from hermes_os.pv_quotes q
     where q.tenant_id = v_t and q.site_id = v_site.id and q.status = 'SENT'
     order by q.sent_at desc nulls last, q.version desc limit 1;
  end if;

  if v_q.id is not null then
    select * into v_proof from hermes_os.pv_quote_acceptance_proof(v_t, v_q.id);
    select count(*) into v_any_proof from hermes_os.pv_quote_acceptances a
     where a.tenant_id = v_t and a.quote_id = v_q.id and a.status = 'ACTIVE';

    select * into v_dep from hermes_os.pv_deposits d
     where d.tenant_id = v_t and d.quote_id = v_q.id and d.status <> 'CANCELLED'
     order by d.sequence limit 1;

    select coalesce(jsonb_agg(to_jsonb(p) - 'tenant_id' order by p.received_on, p.created_at), '[]'::jsonb)
      into v_payments
      from hermes_os.pv_deposit_payments p
     where p.tenant_id = v_t and p.deposit_id = v_dep.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
             'original_filename', d.original_filename, 'mime_type', d.mime_type,
             'size_bytes', d.size_bytes, 'uploaded_at', d.uploaded_at,
             'storage_path', d.storage_path)
             order by d.uploaded_at desc), '[]'::jsonb)
      into v_docs
      from hermes_os.pv_documents d
     where d.tenant_id = v_t and d.quote_id = v_q.id and d.deleted_at is null
       and d.doc_type in ('DEVIS_SIGNE','PREUVE_ACCEPTATION','PREUVE_ACOMPTE');
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'commitment', hermes_os.pv_commercial_commitment(v_t, v_site.id),
    'deposit_required', hermes_os.pv_deposit_required(v_t),
    'quote', case when v_q.id is null then 'null'::jsonb else
      jsonb_build_object('id', v_q.id, 'quote_number', v_q.quote_number,
                         'version', v_q.version, 'status', v_q.status,
                         'total_ttc_eur', v_q.total_ttc_eur, 'total_ht_eur', v_q.total_ht_eur) end,
    'acceptance', case when v_proof.id is null then 'null'::jsonb else to_jsonb(v_proof) - 'tenant_id' end,
    'acceptance_superseded_by_version', (v_any_proof > 0 and v_proof.id is null),
    'deposit', case when v_dep.id is null then 'null'::jsonb else to_jsonb(v_dep) - 'tenant_id' end,
    'payments', coalesce(v_payments, '[]'::jsonb),
    'documents', coalesce(v_docs, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — `authenticated` seulement, jamais `anon`
-- ---------------------------------------------------------------------------

revoke all on function public.get_pv_commercial_policy() from public, anon;
revoke all on function public.set_pv_commercial_policy(boolean, numeric, text) from public, anon;
revoke all on function public.record_pv_quote_acceptance(uuid, text, date, text, text, text, uuid, text) from public, anon;
revoke all on function public.supersede_pv_quote_acceptance(uuid, text) from public, anon;
revoke all on function public.get_pv_quote_acceptances(uuid) from public, anon;
revoke all on function public.accept_pv_quote(uuid, text, date, text, text, text, uuid, text) from public, anon;
revoke all on function public.create_pv_deposit(uuid, numeric, numeric, text, date, text) from public, anon;
revoke all on function public.record_pv_deposit_payment(uuid, numeric, date, text, text, uuid, text) from public, anon;
revoke all on function public.waive_pv_deposit(uuid, text) from public, anon;
revoke all on function public.cancel_pv_deposit(uuid, text) from public, anon;
revoke all on function public.get_pv_commitment(uuid) from public, anon;

grant execute on function public.get_pv_commercial_policy() to authenticated;
grant execute on function public.set_pv_commercial_policy(boolean, numeric, text) to authenticated;
grant execute on function public.record_pv_quote_acceptance(uuid, text, date, text, text, text, uuid, text) to authenticated;
grant execute on function public.supersede_pv_quote_acceptance(uuid, text) to authenticated;
grant execute on function public.get_pv_quote_acceptances(uuid) to authenticated;
grant execute on function public.accept_pv_quote(uuid, text, date, text, text, text, uuid, text) to authenticated;
grant execute on function public.create_pv_deposit(uuid, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.record_pv_deposit_payment(uuid, numeric, date, text, text, uuid, text) to authenticated;
grant execute on function public.waive_pv_deposit(uuid, text) to authenticated;
grant execute on function public.cancel_pv_deposit(uuid, text) to authenticated;
grant execute on function public.get_pv_commitment(uuid) to authenticated;

commit;
