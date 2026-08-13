-- Rollback: sw23_catalog_gpt_5_4_nano (project smubxqorirlfldatzmym)
-- Removes the openai/gpt-5.4-nano catalog row added by the forward migration.
-- Safe: only affects that exact global, open-ended row.
delete from hermes_os.sw23_model_catalog
where provider='openai' and model_id='gpt-5.4-nano'
  and coalesce(tenant_scope,'__GLOBAL__')='__GLOBAL__' and effective_to is null;
