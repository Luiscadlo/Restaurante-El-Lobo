-- ═════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER sql/restaurar_respaldo.sql
-- ═════════════════════════════════════════════════════════════════
-- Quita las dos funciones («Restaurar desde un respaldo» y «Empezar de cero»). Los datos del restaurante no se
-- tocan. La bitácora seguridad.restauraciones se CONSERVA (es el historial de lo que se restauró o borró);
-- si de verdad quieres borrarla, hazlo aparte: drop table seguridad.restauraciones;
-- Seguro de volver a correr.
begin;
drop function if exists public.lobo_restaurar_respaldo(jsonb, text);
drop function if exists public.lobo_empezar_de_cero(text, boolean);
commit;

notify pgrst, 'reload schema';

select count(*) as funciones_que_quedan
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('lobo_restaurar_respaldo', 'lobo_empezar_de_cero');   -- esperado: 0
