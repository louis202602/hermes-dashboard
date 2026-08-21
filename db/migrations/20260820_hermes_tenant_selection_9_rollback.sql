-- ---------------------------------------------------------------------------
-- HERMÈS — ROLLBACK de la sélection de tenant actif.
--
-- ⚠️ Annule 20260820_hermes_tenant_selection_1.sql. Transactionnel.
--
-- `resolve_active_tenant` n'ayant PAS été modifiée par la migration aller, il
-- n'y a rien à y restaurer : c'est ce qui rend ce rollback sans risque pour le
-- chemin d'accès aux données de production.
-- ---------------------------------------------------------------------------

begin;

drop function if exists public.clear_active_tenant();
drop function if exists public.set_active_tenant(text);
drop function if exists public.get_my_tenants();
drop table if exists hermes_os.user_active_tenant;

commit;
