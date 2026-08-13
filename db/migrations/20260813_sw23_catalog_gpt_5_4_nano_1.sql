-- Migration: sw23_catalog_gpt_5_4_nano (project smubxqorirlfldatzmym)
-- Add the Semantic Resolver's model (openai/gpt-5.4-nano) to the canonical SW23
-- model catalog with REAL pricing, so cost can be governed via the existing
-- engine (get_active_price + reserve/commit/release). No second catalog.
--
-- Pricing (USD per 1M tokens) — matches the canonical unit used by the other
-- `cost_status='real'` rows (claude-*) and by sw23_route_and_reserve, which
-- computes cost as tokens/1e6 * input_cost:
--   input        = 0.20   USD / 1M tokens
--   output       = 1.25   USD / 1M tokens
--   cached input = 0.02   USD / 1M tokens  (SW23 schema has no cached-input
--                                           column → recorded in metadata)
-- Source of truth: OpenAI official API pricing, as designated by the operator.
--   NOTE: this environment has no offline copy of OpenAI's official pricing
--   page and the figures are not independently derivable here; they are recorded
--   verbatim from the operator's designated official source.
-- Verified/recorded: 2026-08-13.
--
-- Idempotent (guarded insert). Reversible: 20260813_sw23_catalog_gpt_5_4_nano_9_rollback.sql.

insert into hermes_os.sw23_model_catalog
  (provider, model_id, display_name, enabled, capabilities, modalities,
   reasoning_level, latency_class, quality_class,
   input_cost, output_cost, currency, pricing_unit,
   cost_status, availability, fallback_priority, tenant_scope, effective_from, metadata)
select
  'openai', 'gpt-5.4-nano', 'GPT-5.4 nano (router)', true,
  '["text","tool_use"]'::jsonb, '["text"]'::jsonb,
  'basic', 'fast', 1,
  0.20, 1.25, 'USD', 'per_1M_tokens',
  'real', 'available', 5, null, now(),
  jsonb_build_object(
    'cached_input_cost_usd_per_1M', 0.02,
    'pricing_source', 'OpenAI official API pricing (operator-designated source of truth)',
    'independently_verified_in_env', false,
    'recorded_on', '2026-08-13',
    'used_by', 'GW Consumer — Hermes Semantic Resolver (IS1I8g0K8VXbm4oH)'
  )
where not exists (
  select 1 from hermes_os.sw23_model_catalog
  where provider='openai' and model_id='gpt-5.4-nano'
    and coalesce(tenant_scope,'__GLOBAL__')='__GLOBAL__' and effective_to is null
);
