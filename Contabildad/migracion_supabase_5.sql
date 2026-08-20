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


-- 2) Columna nueva en "aperturas_turno" -----------------------------------
-- Antes toda la venta de desayuno se guardaba en "venta_desayuno" y se
-- contaba 100% como efectivo. Esta columna separa cuánto de esa venta fue
-- por transferencia, para que Cierre, Caja, Ingresos y Tablero repartan el
-- dinero en la columna correcta.
alter table aperturas_turno add column if not exists venta_desayuno_transferencia numeric default 0;
