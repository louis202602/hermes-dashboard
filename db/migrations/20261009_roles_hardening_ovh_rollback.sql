-- ROLLBACK de 20261009_roles_hardening_ovh.sql : redonne l'heritage et les EXECUTE directs constates avant correction
-- (genere a partir de l'etat teste ; exige le search_path par defaut qui contient public).
-- Appliquer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier
alter role staging_authenticator inherit;
grant execute on function get_hb_pv_outreach_snapshot() to authenticator;
grant execute on function get_hb_pv_outreach_snapshot() to staging_authenticator;
grant execute on function get_pv_outreach_kpi() to authenticator;
grant execute on function get_pv_outreach_kpi() to staging_authenticator;
grant execute on function hermes_os_check_social_objectives() to authenticator;
grant execute on function hermes_os_check_social_objectives() to staging_authenticator;
grant execute on function record_pv_project_purchase_receipt(uuid,numeric,date,text,text,text,text) to authenticator;
grant execute on function record_pv_project_purchase_receipt(uuid,numeric,date,text,text,text,text) to staging_authenticator;
grant execute on function set_pv_project_status(uuid,text) to authenticator;
grant execute on function set_pv_project_status(uuid,text) to staging_authenticator;
grant execute on function social_analyze_media(uuid) to authenticator;
grant execute on function social_analyze_media(uuid) to staging_authenticator;
grant execute on function social_dispatch_consumer(text,text,jsonb,uuid) to authenticator;
grant execute on function social_dispatch_consumer(text,text,jsonb,uuid) to staging_authenticator;
grant execute on function social_emit_event(text,jsonb) to authenticator;
grant execute on function social_emit_event(text,jsonb) to staging_authenticator;
grant execute on function social_generate_content(uuid) to authenticator;
grant execute on function social_generate_content(uuid) to staging_authenticator;
grant execute on function social_health_check() to authenticator;
grant execute on function social_health_check() to staging_authenticator;
grant execute on function social_ingest_drive_media(text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone) to authenticator;
grant execute on function social_ingest_drive_media(text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone) to staging_authenticator;
grant execute on function social_lead_to_prospect(uuid) to authenticator;
grant execute on function social_lead_to_prospect(uuid) to staging_authenticator;
grant execute on function social_plan_content(uuid,text) to authenticator;
grant execute on function social_plan_content(uuid,text) to staging_authenticator;
grant execute on function social_process_pending_events(integer) to authenticator;
grant execute on function social_process_pending_events(integer) to staging_authenticator;
grant execute on function social_publish(uuid) to authenticator;
grant execute on function social_publish(uuid) to staging_authenticator;
grant anon to staging_authenticator with inherit true granted by postgres;
grant authenticated to staging_authenticator with inherit true granted by postgres;
grant service_role to staging_authenticator with inherit true granted by postgres;
