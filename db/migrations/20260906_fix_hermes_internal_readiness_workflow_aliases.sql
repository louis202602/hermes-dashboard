-- Production hotfix already applied to Supabase on 2026-09-06.
-- Fix PL/pgSQL record field names in hermes_internal_readiness_v1().
DO $$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='hermes_os'
    AND p.proname='hermes_internal_readiness_v1'
    AND pg_get_function_identity_arguments(p.oid)='p_tenant text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'hermes_os.hermes_internal_readiness_v1(text) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def, 'w.column1', 'w.id');
  v_def := replace(v_def, 'w.column2', 'w.label');
  EXECUTE v_def;
END $$;
