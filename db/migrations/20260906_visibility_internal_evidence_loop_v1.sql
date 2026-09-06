ALTER TABLE hermes_os.social_leads ADD COLUMN IF NOT EXISTS niche_key text;

CREATE OR REPLACE FUNCTION hermes_os.trg_social_lead_funnel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_niche text;
BEGIN
  v_niche:=NEW.niche_key;
  IF v_niche IS NULL AND NEW.prospect_id IS NOT NULL THEN
    SELECT p.niche_key INTO v_niche FROM hermes_os.hb_prospects p WHERE p.prospect_id=NEW.prospect_id;
  END IF;
  IF v_niche IS NULL THEN RETURN NEW; END IF;
  PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,v_niche,'PROSPECT_FOUND',NEW.prospect_id,null,'SOCIAL',null,null,'social_leads','found:'||NEW.id::text,jsonb_build_object('platform',NEW.source_platform,'interest_level',NEW.interest_level));
  IF upper(coalesce(NEW.interest_level,'')) IN ('HIGH','QUALIFIED','HOT','VERY_HIGH') THEN
    PERFORM hermes_os.hb_record_funnel_event(NEW.tenant_id,v_niche,'PROSPECT_QUALIFIED',NEW.prospect_id,null,'SOCIAL',null,null,'social_leads','qualified:'||NEW.id::text,jsonb_build_object('platform',NEW.source_platform,'interest_level',NEW.interest_level));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_social_lead_funnel ON hermes_os.social_leads;
CREATE TRIGGER trg_social_lead_funnel AFTER INSERT OR UPDATE OF interest_level,niche_key,prospect_id ON hermes_os.social_leads FOR EACH ROW EXECUTE FUNCTION hermes_os.trg_social_lead_funnel();

CREATE OR REPLACE FUNCTION hermes_os.visibility_internal_readiness(p_tenant text DEFAULT 'heliosolar') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE v_obj int; v_plan int; v_conn int; v_live_unsafe int; v_tables int; v_score int:=0; v_blockers jsonb:='[]'::jsonb;
BEGIN
  SELECT count(*) INTO v_obj FROM hermes_os.social_autopilot_objectives WHERE tenant_id=p_tenant AND status='ACTIVE';
  SELECT count(*) INTO v_plan FROM hermes_os.social_content_plan WHERE tenant_id=p_tenant;
  SELECT count(*) INTO v_conn FROM hermes_os.social_platform_connections WHERE tenant_id=p_tenant;
  SELECT count(*) INTO v_live_unsafe FROM hermes_os.social_platform_connections WHERE tenant_id=p_tenant AND publish_mode<>'DRY_RUN' AND (status<>'CONNECTED' OR last_successful_call_at IS NULL);
  SELECT count(*) INTO v_tables FROM information_schema.tables WHERE table_schema='hermes_os' AND table_name IN ('social_autopilot_objectives','social_content_plan','social_publications','social_leads','social_events','social_analytics_daily','social_roi','social_platform_connections','social_visibility_directives');
  IF v_tables=9 THEN v_score:=v_score+25; ELSE v_blockers:=v_blockers||jsonb_build_object('code','SCHEMA_INCOMPLETE','tables',v_tables); END IF;
  IF v_obj>0 THEN v_score:=v_score+20; ELSE v_blockers:=v_blockers||jsonb_build_object('code','NO_ACTIVE_OBJECTIVE'); END IF;
  IF v_plan>0 THEN v_score:=v_score+15; ELSE v_blockers:=v_blockers||jsonb_build_object('code','NO_CONTENT_PLAN'); END IF;
  IF v_conn>=1 THEN v_score:=v_score+15; ELSE v_blockers:=v_blockers||jsonb_build_object('code','NO_CONNECTION_REGISTRY'); END IF;
  IF v_live_unsafe=0 THEN v_score:=v_score+15; ELSE v_blockers:=v_blockers||jsonb_build_object('code','UNSAFE_LIVE_CONNECTION','count',v_live_unsafe); END IF;
  IF to_regprocedure('hermes_os.hb_record_funnel_event(text,text,text,uuid,uuid,text,numeric,text,text,text,jsonb)') IS NOT NULL THEN v_score:=v_score+10; END IF;
  RETURN jsonb_build_object('status',CASE WHEN v_score>=95 THEN 'INTERNAL_READY_EXTERNAL_CONNECTIONS_PENDING' ELSE 'INTERNAL_NOT_READY' END,'score',v_score,'internal_ready',v_score>=95,'active_objectives',v_obj,'content_plan_rows',v_plan,'connection_registry_rows',v_conn,'unsafe_live_connections',v_live_unsafe,'blockers',v_blockers,'external_effectiveness_proven',false);
END $$;
REVOKE ALL ON FUNCTION hermes_os.visibility_internal_readiness(text) FROM public;
GRANT EXECUTE ON FUNCTION hermes_os.visibility_internal_readiness(text) TO service_role;

INSERT INTO hermes_os.social_autopilot_objectives(tenant_id,objective,given_by,status)
SELECT 'heliosolar','GENERATE_QUALIFIED_INBOUND_LEADS_AND_MEASURABLE_VISIBILITY','hermes_central','ACTIVE'
WHERE NOT EXISTS(SELECT 1 FROM hermes_os.social_autopilot_objectives WHERE tenant_id='heliosolar' AND status='ACTIVE');
