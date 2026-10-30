-- ═════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la configuración editable (sql/configuracion.sql)
-- ═════════════════════════════════════════════════════════════════
-- Quita el disparador, las funciones, las políticas y la TABLA public.configuracion.
-- ¡Borra el historial de configuración! El sistema vuelve a los valores de El Lobo (mesas = 8, recargo de «para llevar»
-- = $1.000, empaque de domicilio = $1.000, aviso de respaldo en 10 días, nombre «El Lobo»), que son los que usa
-- mientras la tabla no existe. Lo que ya se vendió no cambia: cada pedido y cada cierre guardan sus montos.
-- Si quieres conservar el historial, haz antes un «Respaldo completo» desde Datos (incluye esta tabla).
-- Seguro de correr dos veces.
begin;

drop trigger if exists configuracion_antes on public.configuracion;
drop policy if exists "lobo_configuracion_select" on public.configuracion;
drop policy if exists "lobo_configuracion_insert" on public.configuracion;
drop table if exists public.configuracion;
drop function if exists seguridad.configuracion_antes();
drop function if exists seguridad.validar_configuracion(text, jsonb);

commit;

-- Verificación. Lo esperado: tabla = 0 · funciones = 0
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'configuracion') as tabla,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'seguridad' and p.proname in ('configuracion_antes', 'validar_configuracion')) as funciones;
