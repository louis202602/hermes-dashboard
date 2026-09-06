-- Canonical evidence loop for Autonomous Prospect + Hermès Business.
ALTER TABLE hermes_os.hb_funnel_events ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE hermes_os.hb_funnel_events ADD COLUMN IF NOT EXISTS source_event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_hb_funnel_source_event
ON hermes_os.hb_funnel_events(tenant_id,source_system,source_event_key)
WHERE source_system IS NOT NULL AND source_event_key IS NOT NULL;

CREATE OR REPLACE FUNCTION hermes_os.hb_record_funnel_event(
  p_tenant text,p_niche text,p_stage text,p_prospect uuid DEFAULT null,p_deal uuid DEFAULT null,
  p_channel text DEFAULT null,p_amount numeric DEFAULT null,p_evidence text DEFAULT null,
  p_source_system text DEFAULT null,p_source_event_key text DEFAULT null,p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_tenant IS NULL OR p_niche IS NULL THEN RETURN null; END IF;
  INSERT INTO hermes_os.hb_funnel_events(
    tenant_id,niche_key,stage,prospect_id,deal_id,channel,amount_eur,evidence,meta,
    occurred_at,recorded_by,source_system,source_event_key)
  VALUES(p_tenant,p_niche,p_stage,p_prospect,p_deal,p_channel,p_amount,p_evidence,
    coalesce(p_meta,'{}'::jsonb),now(),'SYSTEM',p_source_system,p_source_event_key)
  ON CONFLICT (tenant_id,source_system,source_event_key)
    WHERE source_system IS NOT NULL AND source_event_key IS NOT NULL DO NOTHING
  RETURNING event_id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION hermes_os.hb_record_funnel_event(text,text,text,uuid,uuid,text,numeric,text,text,text,jsonb) FROM public;

CREATE OR REPLACE FUNCTION hermes_os.trg_hb_prospect_funnel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,NEW.niche_key,'PROSPECT_FOUND',NEW.prospect_id,null,'OUTBOUND',null,null,'hb_prospects','found:'||NEW.prospect_id::text,jsonb_build_object('status',NEW.status,'pipeline_stage',NEW.pipeline_stage));
    IF NEW.qualification_verdict='QUALIFIED' THEN
      PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,NEW.niche_key,'PROSPECT_QUALIFIED',NEW.prospect_id,null,'OUTBOUND',null,null,'hb_prospects','qualified:'||NEW.prospect_id::text,jsonb_build_object('score',NEW.score));
    END IF;
  ELSIF NEW.qualification_verdict='QUALIFIED' AND OLD.qualification_verdict IS DISTINCT FROM 'QUALIFIED' THEN
    PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,NEW.niche_key,'PROSPECT_QUALIFIED',NEW.prospect_id,null,'OUTBOUND',null,null,'hb_prospects','qualified:'||NEW.prospect_id::text,jsonb_build_object('score',NEW.score));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hb_prospect_funnel ON hermes_os.hb_prospects;
CREATE TRIGGER trg_hb_prospect_funnel AFTER INSERT OR UPDATE OF qualification_verdict ON hermes_os.hb_prospects FOR EACH ROW EXECUTE FUNCTION hermes_os.trg_hb_prospect_funnel();

CREATE OR REPLACE FUNCTION hermes_os.trg_hb_email_funnel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_niche text; v_tenant text; v_prospect uuid;
BEGIN
  IF NEW.delivered_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.delivered_at IS NULL) THEN
    SELECT p.niche_key,coalesce(NEW.tenant_id,p.tenant_id),p.prospect_id INTO v_niche,v_tenant,v_prospect
    FROM hermes_os.hb_prospects p WHERE p.prospect_id=NEW.prospect_id;
    IF v_niche IS NOT NULL THEN
      PERFORM hermes_os.hb_record_funnel_event(v_tenant,v_niche,'EMAIL_DELIVERED',v_prospect,NEW.deal_id,'EMAIL',null,null,'hb_email_queue','delivered:'||NEW.email_id::text,jsonb_build_object('provider',NEW.provider,'provider_message_id',NEW.provider_message_id));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hb_email_funnel ON hermes_os.hb_email_queue;
CREATE TRIGGER trg_hb_email_funnel AFTER INSERT OR UPDATE OF delivered_at ON hermes_os.hb_email_queue FOR EACH ROW EXECUTE FUNCTION hermes_os.trg_hb_email_funnel();

CREATE OR REPLACE FUNCTION hermes_os.trg_hb_deal_funnel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_stage text;
BEGIN
  v_stage := CASE
    WHEN upper(coalesce(NEW.status,'')) IN ('ORDER','ORDERED','ACCEPTED','WON','SIGNED','CLOSED_WON') THEN 'ORDER'
    WHEN upper(coalesce(NEW.status,'')) IN ('PROPOSAL','QUOTE','QUOTED','OFFER_SENT') THEN 'PROPOSAL'
    WHEN upper(coalesce(NEW.status,'')) IN ('MEETING','MEETING_BOOKED','APPOINTMENT') THEN 'MEETING'
    ELSE null END;
  IF v_stage IS NOT NULL AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,NEW.niche_key,v_stage,NEW.prospect_id,NEW.deal_id,'BUSINESS',null,null,'hb_deals',lower(v_stage)||':'||NEW.deal_id::text,jsonb_build_object('status',NEW.status,'expected_revenue_eur',NEW.expected_revenue_eur,'expected_costs_eur',NEW.expected_costs_eur));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hb_deal_funnel_events ON hermes_os.hb_deals;
CREATE TRIGGER trg_hb_deal_funnel_events AFTER INSERT OR UPDATE OF status ON hermes_os.hb_deals FOR EACH ROW EXECUTE FUNCTION hermes_os.trg_hb_deal_funnel();

CREATE OR REPLACE FUNCTION hermes_os.trg_hb_payment_funnel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_niche text; v_prospect uuid; v_stage text;
BEGIN
  SELECT d.niche_key,d.prospect_id INTO v_niche,v_prospect FROM hermes_os.hb_deals d WHERE d.deal_id=NEW.deal_id;
  IF v_niche IS NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(NEW.direction,'')) IN ('IN','INBOUND','CREDIT','RECEIVED') AND NEW.amount_eur>0 THEN v_stage:='CASH_IN';
  ELSIF upper(coalesce(NEW.direction,'')) IN ('OUT','OUTBOUND','DEBIT','PAID') AND NEW.amount_eur>0 THEN v_stage:='DELIVERY_COST';
  ELSE RETURN NEW; END IF;
  PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,v_niche,v_stage,v_prospect,NEW.deal_id,'FINANCE',NEW.amount_eur,'payment:'||NEW.payment_id::text,'hb_payments',lower(v_stage)||':'||NEW.payment_id::text,jsonb_build_object('method',NEW.method,'detected_via',NEW.detected_via));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hb_payment_funnel_events ON hermes_os.hb_payments;
CREATE TRIGGER trg_hb_payment_funnel_events AFTER INSERT ON hermes_os.hb_payments FOR EACH ROW EXECUTE FUNCTION hermes_os.trg_hb_payment_funnel();

CREATE OR REPLACE VIEW hermes_os.hb_business_factory_scorecard AS
SELECT n.niche_key,n.name,n.status AS niche_status,n.score AS catalog_score,
  count(*) FILTER (WHERE f.stage='PROSPECT_FOUND') AS prospects_found,
  count(*) FILTER (WHERE f.stage='PROSPECT_QUALIFIED') AS prospects_qualified,
  count(*) FILTER (WHERE f.stage='EMAIL_DELIVERED') AS emails_delivered,
  count(*) FILTER (WHERE f.stage='REPLY') AS replies,
  count(*) FILTER (WHERE f.stage='REPLY_POSITIVE') AS positive_replies,
  count(*) FILTER (WHERE f.stage='MEETING') AS meetings,
  count(*) FILTER (WHERE f.stage='PROPOSAL') AS proposals,
  count(*) FILTER (WHERE f.stage='ORDER') AS orders,
  coalesce(sum(f.amount_eur) FILTER (WHERE f.stage='CASH_IN'),0) AS cash_in_eur,
  coalesce(sum(f.amount_eur) FILTER (WHERE f.stage='DELIVERY_COST'),0) AS delivery_cost_eur,
  coalesce(sum(f.minutes) FILTER (WHERE f.stage='HUMAN_TIME'),0) AS human_minutes,
  CASE WHEN count(*) FILTER(WHERE f.stage='PROSPECT_FOUND')>0 THEN round(100.0*count(*) FILTER(WHERE f.stage='PROSPECT_QUALIFIED')/count(*) FILTER(WHERE f.stage='PROSPECT_FOUND'),2) END AS qualification_rate_pct,
  CASE WHEN count(*) FILTER(WHERE f.stage='EMAIL_DELIVERED')>0 THEN round(100.0*count(*) FILTER(WHERE f.stage='REPLY_POSITIVE')/count(*) FILTER(WHERE f.stage='EMAIL_DELIVERED'),2) END AS positive_reply_rate_pct,
  CASE
    WHEN count(*) FILTER(WHERE f.stage='CASH_IN')>0 AND coalesce(sum(f.amount_eur) FILTER(WHERE f.stage='CASH_IN'),0)>coalesce(sum(f.amount_eur) FILTER(WHERE f.stage='DELIVERY_COST'),0) THEN 'PROFIT_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='CASH_IN')>0 THEN 'REVENUE_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='ORDER')>0 THEN 'ORDER_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='PROPOSAL')>0 THEN 'PROPOSAL_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='MEETING')>0 THEN 'MEETING_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='REPLY_POSITIVE')>0 THEN 'INTEREST_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='EMAIL_DELIVERED')>0 THEN 'OUTREACH_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='PROSPECT_QUALIFIED')>0 THEN 'QUALIFICATION_PROVEN'
    WHEN count(*) FILTER(WHERE f.stage='PROSPECT_FOUND')>0 THEN 'DISCOVERY_PROVEN'
    ELSE 'UNTESTED' END AS evidence_stage
FROM hermes_os.hb_niches n LEFT JOIN hermes_os.hb_funnel_events f ON f.niche_key=n.niche_key
GROUP BY n.niche_key,n.name,n.status,n.score;
REVOKE ALL ON hermes_os.hb_business_factory_scorecard FROM public;
GRANT SELECT ON hermes_os.hb_business_factory_scorecard TO service_role;
