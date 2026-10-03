-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (descuentos/promociones en pedidos)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columnas nuevas en "pedidos" ---------------------------------------------
-- Un descuento es plata que NO ingresó (no es un gasto, no cambia la
-- cantidad vendida). Con descuento d en una fila: monto_almuerzo y
-- monto_total quedan NETOS (restando d); monto_unit, cantidad y
-- monto_domicilio NO se tocan. Valor de lista de la fila = monto_almuerzo + d.
alter table pedidos add column if not exists descuento integer not null default 0;
alter table pedidos add column if not exists motivo_descuento text;

-- Tabla nueva: log de auditoría de descuentos aplicados ---------------------
-- Una fila por cada vez que se aplica/cambia un descuento sobre un pedido
-- completo (grupo_pedido) — tanto al registrar el pedido como al aplicarlo
-- después, desde Pendientes o desde Ingresos ya pagados.
create table if not exists pedidos_descuentos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  grupo_pedido text,
  pedido_ids text,
  fecha text,
  hora text,
  turno text,
  estado_pedido text,
  valor_lista integer not null default 0,
  descuento_anterior integer not null default 0,
  descuento_nuevo integer not null default 0,
  motivo text,
  ajuste_efectivo integer not null default 0,
  ajuste_transferencia integer not null default 0,
  cierre_ajustado boolean not null default false,
  gastos_eliminados text
);
alter table pedidos_descuentos disable row level security;

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un ALTER TABLE/CREATE TABLE, la API de Supabase a veces tarda
-- en darse cuenta de los cambios y responde "Could not find the 'x' column
-- ... in the schema cache" aunque ya exista. Esta línea le avisa a PostgREST
-- que recargue el esquema de una vez, sin esperar el auto-refresco periódico.
notify pgrst, 'reload schema';
