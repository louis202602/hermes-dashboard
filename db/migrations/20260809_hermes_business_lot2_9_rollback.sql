-- Rollback for Hermès Business Capabilities — lot 2.
-- Reverses the planning WRITE capability, the read consultations (planning /
-- devis), and the qualification keyword-collision fix.

-- (a) Remove the planning WRITE capability from the registry. The n8n
--     "GW Consumer — BTP Planning" (2MMvwJ8zb3jBftDi) is INACTIVE and can be
--     archived separately; it performs no work once the catalog entry is gone.
delete from hermes_os.agent_action_catalog where action_key = 'btp.planning.phase.add';

-- (b) Restore the pre-lot-2 qualification keywords (re-adds the "chantier" noun
--     trigger removed by the collision fix).
update hermes_os.agent_action_catalog
   set nl_keywords = array['qualifie','qualifier','qualification','chantier']::text[], updated_at = now()
 where action_key = 'btp.qualification.create';

-- (c) Restore the pre-lot-2 informational layer (no planning/devis consultation)
--     and the pre-lot-2 slot extractor (no leading business-noun strip) by
--     re-applying, in order:
--       20260809_hermes_capability_expansion_1_consultation_and_diag.sql
--       20260809_hermes_nl_orchestration_2_functions.sql   (_nl_extract_slot)
--     Both are idempotent (create or replace); re-running them reverts the two
--     function bodies to their first-lot definitions exactly. They are additive
--     supersets, so leaving them in place is harmless if a full revert is not
--     wanted — only (a) and (b) change routable behaviour.
