-- Rollback for Hermès Business Capabilities — lot 3.
-- Reverses the suivi WRITE capability and the read consultations (reporting /
-- fournisseurs / avancement).

-- (a) Remove the suivi WRITE capability from the registry. The n8n
--     "GW Consumer — BTP Suivi" (1xCiexp3oVj0R8Tk) is INACTIVE and can be
--     archived separately; it performs no work once the catalog entry is gone.
--     The production Agent BTP-Suivi is untouched by lot 3 (SW4 stays its sole
--     caller), so nothing to revert there.
delete from hermes_os.agent_action_catalog where action_key = 'btp.suivi.progress.report';

-- (b) Restore the pre-lot-3 informational layer (no reporting / fournisseurs /
--     avancement branches, and the lot-2 KPI / last-action regexes) by
--     re-applying:
--       20260809_hermes_business_lot2_2_fix_consultation_guards.sql
--     That file is idempotent (create or replace); re-running it reverts
--     _hermes_informational to its lot-2 definition exactly. The lot-3 read
--     branches are additive, so leaving them in place is harmless if a full
--     revert is not wanted — only (a) changes routable/executable behaviour.

-- (c) Canonical suivi service (added by
--     20260809_hermes_business_lot3_2_canonical_suivi_service.sql). Dropping it
--     requires first reverting the two callers back to inline SQL:
--       - Agent BTP-Suivi (n8n O9BLGvhAGjd8oiv3): restore its "Check Idempotent"
--         + "Create Suivi" + "Create Incident if Needed" nodes;
--       - GW Consumer — BTP Suivi (n8n 1xCiexp3oVj0R8Tk): restore its inline
--         "Record Suivi" INSERT.
--     Both n8n reverts are available in git history. Only after both callers no
--     longer reference it:
-- drop function if exists hermes_os.record_btp_suivi_progress(text,uuid,date,text,integer,text,text,jsonb);
