-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase #2 (Cierre con ajuste manual + sección Caja)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- Requiere haber corrido antes migracion_supabase.sql
-- ════════════════════════════════════════════════════════════════════

-- 1) Columnas nuevas en "cierres_dia" ------------------------------------
-- Ajuste manual del cierre: suma o resta dinero al resultado final sin que
-- cuente como venta ni como gasto (ej: faltante/sobrante de caja sin explicar
-- con una venta o gasto concreto). Siempre debe ir con una nota explicando por qué.
alter table cierres_dia add column if not exists ajuste_manual numeric default 0;
alter table cierres_dia add column if not exists ajuste_manual_nota text default '';


-- 2) Tabla nueva: movimientos_caja ---------------------------------------
-- Gastos generales del negocio (ej: mercado, arreglos) y aportes de capital
-- (dinero que entra al negocio por una razón distinta a las ventas).
-- Ambos afectan el total disponible general de la sección Caja.
create table if not exists movimientos_caja (
  id           bigint generated always as identity primary key,
  fecha        date not null,
  tipo         text not null check (tipo in ('gasto','aporte')),
  descripcion  text not null,
  monto        numeric not null default 0,
  created_at   timestamptz not null default now()
);


-- 3) Permisos (RLS) --------------------------------------------------------
-- Igual que las tablas anteriores: RLS activado con política abierta, para
-- que la app siga funcionando con la llave anónima igual que con el resto.
alter table movimientos_caja enable row level security;
drop policy if exists "allow all movimientos_caja" on movimientos_caja;
create policy "allow all movimientos_caja" on movimientos_caja for all using (true) with check (true);
