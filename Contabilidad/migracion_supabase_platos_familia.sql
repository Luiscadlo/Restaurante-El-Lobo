-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (almuerzos de la familia en el Cierre)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Columna nueva en "cierres_dia" -------------------------------------------
-- Cantidad de almuerzos que comió la familia SIN pagar ese turno. Desde este
-- cambio, la opción "Gratis" de Pedidos solo existe en Comidas Rápidas (donde
-- cada producto vale distinto y el consumo se lleva en pesos, con el pedido
-- Gratis); en Almuerzo todos los platos valen casi lo mismo, así que basta
-- con anotar CUÁNTOS fueron al cerrar el turno.
--
-- Es nullable A PROPÓSITO: NULL significa "no registrado", no "cero". Quedan
-- en NULL los cierres anteriores a este cambio, los cierres manuales donde
-- no se escribió el dato y TODOS los cierres de comida rápida (ahí no aplica).
-- Un 0 real significa "ese día la familia no comió", dato distinto de NULL.
alter table cierres_dia add column if not exists platos_familia integer;

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un ALTER TABLE, la API de Supabase a veces tarda en darse
-- cuenta de las columnas nuevas y responde "Could not find the 'x' column
-- ... in the schema cache" aunque ya exista. Esta línea le avisa a PostgREST
-- que recargue el esquema de una vez, sin esperar el auto-refresco periódico.
notify pgrst, 'reload schema';
