-- Rollback: restore the anon EXECUTE grant on get_dashboard_public_kpis.
grant execute on function public.get_dashboard_public_kpis() to anon;
