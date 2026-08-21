-- 20260820_hermes_migration_governance_9_rollback.sql
-- Rollback COMPLET de la gouvernance des migrations. Idempotent.
--
-- Ne touche à AUCUNE donnée métier : ces objets n'en contiennent pas. Le seul
-- élément à valeur historique est `migration_baseline` — la photo de la dette.
-- La supprimer efface la frontière legacy/nouveau ; si on rejoue le lot 3 ensuite,
-- une NOUVELLE frontière sera posée à la date du jour, et tout ce qui s'est
-- appliqué entre-temps passera en héritage. C'est le seul effet non réversible
-- de ce rollback, et il vaut d'être dit.

drop function if exists hermes_os.migration_baseline_summary();
drop function if exists hermes_os.migrations_since_baseline();
drop function if exists hermes_os.production_migration_lock_status();
drop function if exists hermes_os.release_production_migration_lock(text);
drop function if exists hermes_os.acquire_production_migration_lock(text, text, text, int);

drop table if exists hermes_os.migration_baseline_meta;
drop table if exists hermes_os.migration_baseline;
drop table if exists hermes_os.production_migration_lock_history;
drop table if exists hermes_os.production_migration_lock;
