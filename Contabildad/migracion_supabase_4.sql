-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase #4 (categorías en gastos del Cierre +
-- tabla de ingresos adicionales personalizados)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- 1) Columna nueva en "gastos_dia" -----------------------------------
-- Categoría del gasto registrado durante el Cierre: 'nomina' | 'proveedor'
-- | 'otro' | 'prestamo'. Los gastos categorizados (excepto 'prestamo') se
-- muestran también en la sección Egresos, para saber el total del mes por
-- categoría. Los de categoría 'prestamo' NUNCA se muestran en Egresos —
-- solo restan del flujo de caja del día (ver nota en la app).
alter table gastos_dia add column if not exists categoria text;


-- 2) Tabla nueva: ingresos_extra --------------------------------------
-- Ingresos adicionales personalizados que no vienen de un pedido ni de un
-- cierre (ej: venta de algo puntual, un reembolso, etc.), registrados
-- manualmente desde la nueva pestaña "Ingresos".
create table if not exists ingresos_extra (
  id           bigint generated always as identity primary key,
  fecha        date not null,
  descripcion  text not null,
  monto        numeric not null default 0,
  created_at   timestamptz not null default now()
);


-- 3) Permisos (RLS) --------------------------------------------------------
alter table ingresos_extra enable row level security;
drop policy if exists "allow all ingresos_extra" on ingresos_extra;
create policy "allow all ingresos_extra" on ingresos_extra for all using (true) with check (true);
