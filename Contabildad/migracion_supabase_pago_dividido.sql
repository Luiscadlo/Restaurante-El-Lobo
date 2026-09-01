-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (pago dividido efectivo/transferencia)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columnas nuevas en "pedidos" -------------------------------------------
-- Cuando un pedido se paga con "Pago dividido" (parte efectivo, parte
-- transferencia), metodo queda como 'dividido' y estas dos columnas
-- guardan cuánto fue de cada uno. En un pedido con método normal
-- (efectivo o transferencia) estas columnas se quedan en 0 — el monto
-- completo sigue viniendo de monto_total, como siempre.
alter table pedidos add column if not exists monto_efectivo numeric default 0;
alter table pedidos add column if not exists monto_transferencia numeric default 0;


-- Restricción existente en "metodo" -----------------------------------
-- La tabla ya tenía un check constraint (pedidos_metodo_check) que solo
-- permitía 'efectivo' o 'transferencia' — por eso el pago dividido fallaba
-- con "violates check constraint". Se reemplaza para que también acepte
-- 'dividido' y 'gratis'.
alter table pedidos drop constraint if exists pedidos_metodo_check;
alter table pedidos add constraint pedidos_metodo_check check (metodo in ('efectivo','transferencia','dividido','gratis'));

-- Columna nueva para el botón "Gratis" de Pedidos -----------------------
-- Un pedido "gratis" (regalo de la casa / consumo del dueño) queda con
-- metodo='gratis' y NO suma a ningún total de ingresos/ventas, pero sí
-- queda registrado (qué se dio, cantidad, valor de referencia) para llevar
-- el conteo de cuánto se regala.
alter table pedidos add column if not exists es_gratis boolean default false;
