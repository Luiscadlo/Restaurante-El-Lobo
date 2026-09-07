-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Migración Supabase (ajuste de Cierre separado en efectivo y
-- transferencia)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro volver a correrlo (usa IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

-- Antes, "ajuste_manual" era un solo valor que Cierre siempre trataba como
-- parte del efectivo. Ahora se puede ajustar el efectivo y la transferencia
-- por separado, así que se necesitan dos columnas nuevas.
alter table cierres_dia add column if not exists ajuste_efectivo numeric not null default 0;
alter table cierres_dia add column if not exists ajuste_transferencia numeric not null default 0;

-- Migra los ajustes viejos (guardados en la columna original "ajuste_manual")
-- a la nueva columna "ajuste_efectivo", ya que siempre se calcularon como si
-- fueran efectivo. Solo toca las filas que aún no tienen nada en la columna
-- nueva, así que es seguro volver a correr esta migración sin duplicar ni
-- pisar ajustes ya migrados. Si la columna "ajuste_manual" no existe (una
-- instalación nueva, sin ese campo viejo), este bloque no hace nada.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'cierres_dia' and column_name = 'ajuste_manual') then
    update cierres_dia
      set ajuste_efectivo = ajuste_manual
      where ajuste_manual is not null and ajuste_manual <> 0 and (ajuste_efectivo is null or ajuste_efectivo = 0);
  end if;
end $$;

-- Refrescar el caché de esquema de PostgREST ------------------------------
-- Después de un ALTER TABLE, la API de Supabase a veces tarda en darse
-- cuenta de las columnas nuevas y responde "Could not find the 'x' column
-- ... in the schema cache" aunque la columna sí exista. Esta línea le avisa
-- a PostgREST que recargue el esquema de una vez, sin esperar el
-- auto-refresco periódico.
notify pgrst, 'reload schema';
