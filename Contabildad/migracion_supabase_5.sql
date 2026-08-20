-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase #5 (auditoría de pedidos eliminados +
-- venta de desayuno separada en efectivo/transferencia)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- 1) Tabla nueva: pedidos_eliminados --------------------------------------
-- Cada vez que se elimina un pedido pagado desde la sección Pedidos, queda
-- un rastro acá con la hora exacta (created_at) y los datos originales del
-- pedido, visible en Auditoría → "🗑 Pedidos pagados eliminados".
create table if not exists pedidos_eliminados (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(), -- hora exacta de eliminación
  pedido_id    bigint,
  fecha        date,    -- fecha original del pedido
  hora         text,    -- hora original del pedido
  turno        text,
  pedido       text,    -- tipo de plato
  detalle      text,
  ubicacion    text,
  metodo       text,
  monto_total  numeric
);

-- Permisos (RLS) — misma política abierta que el resto de tablas del
-- proyecto, para que la app siga funcionando con la llave anónima.
alter table pedidos_eliminados enable row level security;
drop policy if exists "allow all pedidos_eliminados" on pedidos_eliminados;
create policy "allow all pedidos_eliminados" on pedidos_eliminados for all using (true) with check (true);
