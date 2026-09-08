CREATE TABLE IF NOT EXISTS hermes_os.hb_business_experiments(
  experiment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL REFERENCES hermes_os.tenants(tenant_id),
  niche_key text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','DISCOVERY','QUALIFICATION','OUTREACH','ENGAGEMENT','COMMERCIAL','REVENUE','PROFIT','PAUSED','REJECTED')),
  target_prospects integer NOT NULL DEFAULT 100 CHECK(target_prospects BETWEEN 1 AND 100000), data_budget_eur numeric NOT NULL DEFAULT 0 CHECK(data_budget_eur>=0),
  next_action text, decision_reason text, evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_tick_at timestamptz,
  UNIQUE(tenant_id,niche_key));
REVOKE ALL ON hermes_os.hb_business_experiments FROM public;
GRANT SELECT,INSERT,UPDATE ON hermes_os.hb_business_experiments TO service_role;

CREATE OR REPLACE FUNCTION hermes_os.hb_business_factory_tick(p_tenant text DEFAULT 'heliosolar') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE r record; v_status text; v_action text; v_count int:=0;
BEGIN
  INSERT INTO hermes_os.hb_business_experiments(tenant_id,niche_key,status,next_action,decision_reason)
  SELECT p_tenant,n.niche_key,'DRAFT','ASSESS_EVIDENCE','AUTO_CREATED_FROM_NICHE_REGISTRY' FROM hermes_os.hb_niches n
  WHERE NOT EXISTS(SELECT 1 FROM hermes_os.hb_business_experiments e WHERE e.tenant_id=p_tenant AND e.niche_key=n.niche_key)
  ON CONFLICT DO NOTHING;
  FOR r IN SELECT * FROM hermes_os.hb_business_factory_scorecard LOOP
    v_status:=CASE r.evidence_stage WHEN 'PROFIT_PROVEN' THEN 'PROFIT' WHEN 'REVENUE_PROVEN' THEN 'REVENUE' WHEN 'ORDER_PROVEN' THEN 'COMMERCIAL' WHEN 'PROPOSAL_PROVEN' THEN 'COMMERCIAL' WHEN 'MEETING_PROVEN' THEN 'ENGAGEMENT' WHEN 'INTEREST_PROVEN' THEN 'ENGAGEMENT' WHEN 'OUTREACH_PROVEN' THEN 'OUTREACH' WHEN 'QUALIFICATION_PROVEN' THEN 'QUALIFICATION' WHEN 'DISCOVERY_PROVEN' THEN 'DISCOVERY' ELSE 'DRAFT' END;
    v_action:=CASE v_status WHEN 'PROFIT' THEN 'SCALE_IF_CAPACITY_AND_MARGIN_ALLOW' WHEN 'REVENUE' THEN 'VERIFY_NET_MARGIN' WHEN 'COMMERCIAL' THEN 'CLOSE_AND_COLLECT_CASH' WHEN 'ENGAGEMENT' THEN 'CONVERT_TO_PROPOSAL' WHEN 'OUTREACH' THEN 'MEASURE_REPLIES_AND_MEETINGS' WHEN 'QUALIFICATION' THEN 'PREPARE_COMPLIANT_OUTREACH_TEST' WHEN 'DISCOVERY' THEN 'QUALIFY_SAMPLE' ELSE 'BUILD_TESTABLE_HYPOTHESIS' END;
    UPDATE hermes_os.hb_business_experiments e SET
      status=CASE WHEN e.status IN ('PAUSED','REJECTED') THEN e.status ELSE v_status END,
      next_action=CASE WHEN e.status IN ('PAUSED','REJECTED') THEN e.next_action ELSE v_action END,
      decision_reason='EVIDENCE_STAGE_'||r.evidence_stage,
      evidence_snapshot=jsonb_build_object('catalog_score',r.catalog_score,'prospects_found',r.prospects_found,'prospects_qualified',r.prospects_qualified,'emails_delivered',r.emails_delivered,'positive_replies',r.positive_replies,'meetings',r.meetings,'proposals',r.proposals,'orders',r.orders,'cash_in_eur',r.cash_in_eur,'delivery_cost_eur',r.delivery_cost_eur,'evidence_stage',r.evidence_stage),
      updated_at=now(),last_tick_at=now()
    WHERE e.tenant_id=p_tenant AND e.niche_key=r.niche_key;
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('status','OK','tenant_id',p_tenant,'experiments_evaluated',v_count,'policy','EVIDENCE_FIRST_NO_FAKE_VALIDATION');
END $$;
REVOKE ALL ON FUNCTION hermes_os.hb_business_factory_tick(text) FROM public;
GRANT EXECUTE ON FUNCTION hermes_os.hb_business_factory_tick(text) TO service_role;

CREATE OR REPLACE FUNCTION hermes_os.hb_business_factory_readiness(p_tenant text DEFAULT 'heliosolar') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_exp int; v_funnel int; v_missing int; v_score int:=0; v_blockers jsonb:='[]'::jsonb;
BEGIN
  SELECT count(*) INTO v_exp FROM hermes_os.hb_business_experiments WHERE tenant_id=p_tenant;
  SELECT count(*) INTO v_funnel FROM hermes_os.hb_funnel_events WHERE tenant_id=p_tenant;
  SELECT count(*) INTO v_missing FROM hermes_os.hb_niches n WHERE NOT EXISTS(SELECT 1 FROM hermes_os.hb_business_experiments e WHERE e.tenant_id=p_tenant AND e.niche_key=n.niche_key);
  IF to_regclass('hermes_os.hb_business_factory_scorecard') IS NOT NULL THEN v_score:=v_score+25; ELSE v_blockers:=v_blockers||jsonb_build_object('code','NO_SCORECARD'); END IF;
  IF v_funnel>0 THEN v_score:=v_score+25; ELSE v_blockers:=v_blockers||jsonb_build_object('code','NO_FUNNEL_EVIDENCE'); END IF;
  IF v_exp>0 AND v_missing=0 THEN v_score:=v_score+25; ELSE v_blockers:=v_blockers||jsonb_build_object('code','EXPERIMENT_COVERAGE_INCOMPLETE','missing',v_missing); END IF;
  IF to_regprocedure('hermes_os.hb_business_factory_tick(text)') IS NOT NULL THEN v_score:=v_score+15; END IF;
  IF to_regprocedure('hermes_os.hb_record_funnel_event(text,text,text,uuid,uuid,text,numeric,text,text,text,jsonb)') IS NOT NULL THEN v_score:=v_score+10; END IF;
  RETURN jsonb_build_object('score',v_score,'internal_ready',v_score>=95,'status',CASE WHEN v_score>=95 THEN 'INTERNAL_FACTORY_READY' ELSE 'INTERNAL_FACTORY_NOT_READY' END,'experiment_count',v_exp,'funnel_events',v_funnel,'missing_experiments',v_missing,'blockers',v_blockers,'profit_proof_required_per_niche',true);
END $$;
REVOKE ALL ON FUNCTION hermes_os.hb_business_factory_readiness(text) FROM public;
GRANT EXECUTE ON FUNCTION hermes_os.hb_business_factory_readiness(text) TO service_role;

SELECT hermes_os.hb_business_factory_tick('heliosolar');
