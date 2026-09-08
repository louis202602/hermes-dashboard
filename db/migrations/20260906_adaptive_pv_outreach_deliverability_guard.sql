CREATE OR REPLACE FUNCTION hermes_os.fn_guard_heliosolar_pv_first_outreach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
DECLARE
  v_tenant text; v_niche text; v_verdict text; v_active boolean; v_contact uuid; v_tier text; v_health text;
BEGIN
  IF NEW.kind <> 'prospection' OR coalesce(NEW.is_test,false) THEN RETURN NEW; END IF;
  SELECT p.tenant_id,p.niche_key,p.qualification_verdict,p.active_status_verified
    INTO v_tenant,v_niche,v_verdict,v_active
  FROM hermes_os.hb_prospects p WHERE p.prospect_id=NEW.prospect_id;
  IF v_tenant <> 'heliosolar' OR v_niche <> 'pv_toitures' THEN RETURN NEW; END IF;
  IF v_verdict IS DISTINCT FROM 'QUALIFIED' THEN RAISE EXCEPTION 'HELIOSOLAR_PV_OUTREACH_BLOCKED: prospect not QUALIFIED'; END IF;
  IF coalesce(v_active,false) IS NOT TRUE THEN RAISE EXCEPTION 'HELIOSOLAR_PV_OUTREACH_BLOCKED: active company not verified'; END IF;
  v_contact:=hermes_os.hb_pick_contact(NEW.prospect_id);
  IF v_contact IS NULL THEN RAISE EXCEPTION 'HELIOSOLAR_PV_OUTREACH_BLOCKED: no deliverable contact'; END IF;
  v_tier:=coalesce(hermes_os.hb_b2b_deliverability_check(v_contact)->>'confidence_tier','');
  v_health:=coalesce(hermes_os.hb_pv_deliverability_health(3)->>'status','INSUFFICIENT_SAMPLE');
  IF v_health='CRITICAL' AND v_tier<>'STRONG' THEN
    RAISE EXCEPTION 'HELIOSOLAR_PV_OUTREACH_BLOCKED: deliverability critical, STRONG contact required (tier=%)',v_tier;
  END IF;
  IF v_tier NOT IN ('STRONG','PROBABLE') THEN
    RAISE EXCEPTION 'HELIOSOLAR_PV_OUTREACH_BLOCKED: contact tier % not strong enough',v_tier;
  END IF;
  RETURN NEW;
END $$;
