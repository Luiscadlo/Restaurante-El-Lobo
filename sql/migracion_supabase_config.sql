-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla `config` (clave / valor) — Prompt A: respaldo completo + aviso.
--
-- Guarda datos de configuración del sistema. Hoy solo la usa el respaldo:
--   clave 'ultimo_respaldo' → valor { generado_en, fecha, conteos }
-- y de ahí sale el aviso en pantalla ("Hace X días no se hace respaldo").
--
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- Es SEGURO: solo crea la tabla si no existe; no toca ninguna otra tabla ni dato.
-- Córrelo ANTES de fusionar el cambio del respaldo. Si falta, el sistema no falla:
-- solo muestra un aviso de que la tabla no existe.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.config (
  clave          text        primary key,
  valor          jsonb,
  actualizado_en timestamptz not null default now()
);

-- Sin RLS por ahora, igual que las demás tablas (el SQL de seguridad la cubrirá después).
-- Mismos permisos que las otras tablas para la llave pública:
grant all on public.config to anon, authenticated, service_role;

-- Verificación (debe devolver 0 filas la primera vez):
-- select * from public.config;
