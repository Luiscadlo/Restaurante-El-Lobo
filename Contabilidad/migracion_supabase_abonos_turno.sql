-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (abonos de fiado en el cierre del turno)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS) y va en UNA transacción:
-- si algo falla, no queda nada a medias.
--
-- ⚠ ANTES DE CORRERLO: respalda las tablas afectadas (Table Editor →
--   Export to CSV, o Datos → Exportar desde la app): abonos_fiado, pedidos,
--   cierres_dia. (Este archivo solo AGREGA columnas vacías; no cambia ni
--   borra ningún dato existente.)
--
-- ORDEN: 1) este archivo  2) desplegar el HTML nuevo
--        3) correcciones_octubre_fiados.sql
-- ════════════════════════════════════════════════════════════════════

begin;

-- Columna nueva en "abonos_fiado" ----------------------------------------
-- Turno REAL en que se recibió el abono (por la hora al registrarlo; de
-- 00:00 a 08:59 cuenta como la cena del día anterior). La plata del abono
-- entra al cierre de ese fecha+turno, en la columna de su cuenta.
-- Es nullable A PROPÓSITO: NULL = abono viejo (anterior a este cambio), que
-- se sigue calculando como antes y NO se suma a ningún cierre.
alter table abonos_fiado add column if not exists turno text;
alter table abonos_fiado drop constraint if exists abonos_fiado_turno_check;
alter table abonos_fiado add constraint abonos_fiado_turno_check
  check (turno is null or turno in ('almuerzo', 'cena'));

-- Columnas nuevas en "pedidos" -------------------------------------------
-- Cuándo se terminó de cobrar un fiado saldado con abonos NUEVOS. El pedido
-- conserva su fecha/turno de CONSUMO (la venta cuenta ese día); estas dos
-- solo dicen cuándo quedó saldado. Su plata ya entró al cierre con cada
-- abono, así que el pedido no suma plata otra vez.
-- NULL = pedido normal, o fiado saldado con abonos VIEJOS (esos tienen la
-- fecha de cobro en "fecha" y la de consumo en "fecha_original", como antes).
alter table pedidos add column if not exists fecha_pago date;
alter table pedidos add column if not exists turno_pago text;
alter table pedidos drop constraint if exists pedidos_turno_pago_check;
alter table pedidos add constraint pedidos_turno_pago_check
  check (turno_pago is null or turno_pago in ('almuerzo', 'cena'));

-- Columnas nuevas en "cierres_dia" ---------------------------------------
-- Parte del efectivo / la transferencia del cierre que vino de abonos de
-- fiado. Ya está DENTRO de "efectivo" y "transferencia" (Caja no cambia);
-- se guarda aparte solo para el desglose y el historial de cierres.
-- NULL = cierre anterior a este cambio.
alter table cierres_dia add column if not exists abonos_efectivo numeric;
alter table cierres_dia add column if not exists abonos_transferencia numeric;

commit;

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un ALTER TABLE, la API de Supabase a veces tarda en darse
-- cuenta de las columnas nuevas y responde "Could not find the 'x' column
-- ... in the schema cache" aunque ya exista. Esta línea le avisa a PostgREST
-- que recargue el esquema de una vez, sin esperar el auto-refresco periódico.
notify pgrst, 'reload schema';

-- Verificación (debe devolver 5 filas) ------------------------------------
select table_name, column_name, data_type
from information_schema.columns
where (table_name, column_name) in (
  ('abonos_fiado', 'turno'),
  ('pedidos', 'fecha_pago'), ('pedidos', 'turno_pago'),
  ('cierres_dia', 'abonos_efectivo'), ('cierres_dia', 'abonos_transferencia')
)
order by table_name, column_name;
