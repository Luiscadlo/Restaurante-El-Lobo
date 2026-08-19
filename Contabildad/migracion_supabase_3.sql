-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase #3 (agrupar varios almuerzos en un pedido)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columna nueva en "pedidos" ----------------------------------------------
-- Identifica qué filas de "pedidos" pertenecen al MISMO pedido (por ejemplo,
-- varios almuerzos registrados juntos con "Agregar almuerzo" a la misma mesa).
-- Así se pueden distinguir dos pedidos DISTINTOS sentados en la misma mesa,
-- y mover/pagar cada uno por separado sin mezclarlos.
-- Los pedidos ya existentes (antes de este cambio) quedan con este campo
-- vacío — la app los sigue agrupando por mesa como hasta ahora, sin que
-- tengas que hacer nada más.
alter table pedidos add column if not exists grupo_pedido text;
