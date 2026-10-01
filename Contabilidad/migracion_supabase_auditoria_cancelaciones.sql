-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (diferenciar en Auditoría un pedido
-- ELIMINADO — ya estaba pagado, generó ingreso real — de uno CANCELADO
-- — nunca llegó a pagarse, no generó ingreso)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columna nueva en "pedidos_eliminados" ------------------------------------
-- Hasta ahora esta tabla solo registraba eliminaciones de ingresos ya
-- pagados (eliminarGrupoIngreso()). Ahora también registra cancelaciones
-- de pendientes (cancelarPendiente()/cancelarGrupoPendiente(), incluidos
-- los fiados huérfanos) — mismo rastro para Auditoría, pero con un motivo
-- distinto para no mezclar las dos cosas. El default 'eliminado' deja las
-- filas históricas correctas sin tener que tocarlas a mano.
alter table pedidos_eliminados
  add column if not exists motivo text not null default 'eliminado'
  check (motivo in ('eliminado', 'cancelado'));

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un CREATE TABLE/ALTER TABLE, la API de Supabase a veces tarda
-- en darse cuenta de los cambios y responde "Could not find the 'x' column
-- ... in the schema cache" aunque ya exista. Esta línea le avisa a PostgREST
-- que recargue el esquema de una vez, sin esperar el auto-refresco periódico.
notify pgrst, 'reload schema';
