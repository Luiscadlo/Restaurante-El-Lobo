-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase para los nuevos ajustes del sistema
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- ════════════════════════════════════════════════════════════════════

-- 1) Columnas nuevas en "pedidos" ---------------------------------------

-- "Sin mesa": cliente que espera de pie, sin mesa asignada
alter table pedidos add column if not exists es_sin_mesa boolean default false;

-- Checkboxes de entrega en la sección "Pedidos" (seguimiento de cocina)
-- entrega_sopa: solo aplica a pedidos que llevan sopa (completos y asados)
-- entrega_plato: entrega del plato/seco (o del pedido completo si no lleva sopa)
alter table pedidos add column if not exists entrega_sopa  boolean default false;
alter table pedidos add column if not exists entrega_plato boolean default false;

-- Guarda la fecha original de un pedido "fiado" antes de marcarlo pagado
-- (el sistema mueve la fecha del fiado a la fecha de pago; esta columna
-- permite revertir el pago sin perder la fecha original del pedido)
alter table pedidos add column if not exists fecha_original date;


-- 2) Tabla nueva: aperturas_turno ---------------------------------------
-- Se crea un registro cada vez que se hace clic en "Abrir turno".
-- Guarda la caja inicial (siempre) y la venta de desayuno (solo almuerzo).
create table if not exists aperturas_turno (
  id             bigint generated always as identity primary key,
  fecha          date not null,
  turno          text not null check (turno in ('almuerzo','cena')),
  caja_inicial   numeric not null default 0,
  venta_desayuno numeric default 0,
  created_at     timestamptz not null default now(),
  unique (fecha, turno)
);


-- 3) Tabla nueva: notas_dia -----------------------------------------------
-- Recordatorios rápidos del día (ej: "Jose me prestó 5.000 para dar vuelto")
create table if not exists notas_dia (
  id         bigint generated always as identity primary key,
  fecha      date not null,
  texto      text not null,
  created_at timestamptz not null default now()
);


-- 4) Permisos (RLS) --------------------------------------------------------
-- Supabase exige que toda tabla nueva tenga RLS activado. Como el resto
-- de la app ya funciona con la llave anónima (pedidos, egresos, etc.),
-- aquí se activa RLS pero con una política abierta para que el
-- comportamiento sea idéntico al de las demás tablas — sin esto, la
-- app se queda sin poder leer/escribir en aperturas_turno y notas_dia.

alter table aperturas_turno enable row level security;
drop policy if exists "allow all aperturas_turno" on aperturas_turno;
create policy "allow all aperturas_turno" on aperturas_turno for all using (true) with check (true);

alter table notas_dia enable row level security;
drop policy if exists "allow all notas_dia" on notas_dia;
create policy "allow all notas_dia" on notas_dia for all using (true) with check (true);
