-- Canonicalize execution observability without deleting legacy snapshots.
-- execution_logs is the canonical execution ledger; hermes_core_runs remains the SW snapshot.
CREATE OR REPLACE FUNCTION hermes_os.sync_core_run_to_execution_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'hermes_os','pg_catalog','pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hermes_os.execution_logs e
    WHERE e.trace_id='hermes-core-run:'||NEW.run_id::text
  ) THEN
    INSERT INTO hermes_os.execution_logs(
      trace_id,tenant_id,path,domain,execution_status,validation_status,
      degraded,execution_started_at,execution_finished_at,details,created_at
    ) VALUES (
      'hermes-core-run:'||NEW.run_id::text,NEW.tenant_id,'hermes_core_tick','HERMES_CORE',
      NEW.status,CASE WHEN NEW.status='OK' THEN 'VALIDATED' ELSE 'DEGRADED' END,
      NEW.status<>'OK',NEW.run_at,NEW.run_at,
      jsonb_build_object('source','hermes_core_runs','run_id',NEW.run_id,'sw20',NEW.sw20,'sw19',NEW.sw19,'sw22',NEW.sw22,'sw24',NEW.sw24),
      NEW.run_at
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION hermes_os.sync_core_run_to_execution_log() FROM public;

DROP TRIGGER IF EXISTS trg_sync_core_run_to_execution_log ON hermes_os.hermes_core_runs;
CREATE TRIGGER trg_sync_core_run_to_execution_log
AFTER INSERT ON hermes_os.hermes_core_runs
FOR EACH ROW EXECUTE FUNCTION hermes_os.sync_core_run_to_execution_log();

INSERT INTO hermes_os.execution_logs(
  trace_id,tenant_id,path,domain,execution_status,validation_status,
  degraded,execution_started_at,execution_finished_at,details,created_at
)
SELECT
  'hermes-core-run:'||r.run_id::text,r.tenant_id,'hermes_core_tick','HERMES_CORE',r.status,
  CASE WHEN r.status='OK' THEN 'VALIDATED' ELSE 'DEGRADED' END,
  r.status<>'OK',r.run_at,r.run_at,
  jsonb_build_object('source','hermes_core_runs','run_id',r.run_id,'sw20',r.sw20,'sw19',r.sw19,'sw22',r.sw22,'sw24',r.sw24),
  r.run_at
FROM hermes_os.hermes_core_runs r
WHERE NOT EXISTS (
  SELECT 1 FROM hermes_os.execution_logs e
  WHERE e.trace_id='hermes-core-run:'||r.run_id::text
);
