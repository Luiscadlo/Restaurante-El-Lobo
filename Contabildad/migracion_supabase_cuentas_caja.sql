-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (3 cuentas de Caja: efectivo / transferencia
-- comidas rápidas / transferencia almuerzos)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columna nueva en "egresos" ---------------------------------------------
-- Dice de cuál de las 3 cuentas salió el dinero de ese egreso. Por defecto
-- 'efectivo' para no romper los egresos que ya existían antes de esta
-- migración (quedan asumidos como pagados en efectivo).
alter table egresos add column if not exists cuenta text not null default 'efectivo';
alter table egresos drop constraint if exists egresos_cuenta_check;
alter table egresos add constraint egresos_cuenta_check check (cuenta in ('efectivo','transf_rapidas','transf_almuerzos'));

-- Columna nueva en "movimientos_caja" ------------------------------------
-- Igual que en egresos: de cuál cuenta sale un "Gasto" registrado en Caja,
-- o a cuál cuenta entra un "Aporte de capital".
alter table movimientos_caja add column if not exists cuenta text not null default 'efectivo';
alter table movimientos_caja drop constraint if exists movimientos_caja_cuenta_check;
alter table movimientos_caja add constraint movimientos_caja_cuenta_check check (cuenta in ('efectivo','transf_rapidas','transf_almuerzos'));

-- Columna nueva en "ingresos_extra" --------------------------------------
-- A cuál de las 3 cuentas entra un ingreso adicional (el que se registra
-- en Ingresos → "Registrar ingreso adicional").
alter table ingresos_extra add column if not exists cuenta text not null default 'efectivo';
alter table ingresos_extra drop constraint if exists ingresos_extra_cuenta_check;
alter table ingresos_extra add constraint ingresos_extra_cuenta_check check (cuenta in ('efectivo','transf_rapidas','transf_almuerzos'));

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un ALTER TABLE, la API de Supabase a veces tarda en darse
-- cuenta de las columnas nuevas (o hasta de columnas viejas, por un rato)
-- y responde "Could not find the 'x' column ... in the schema cache" aunque
-- la columna sí exista. Esta línea le avisa a PostgREST que recargue el
-- esquema de una vez, sin esperar el auto-refresco periódico.
notify pgrst, 'reload schema';
