-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — SEGURIDAD: usuarios con rol + reglas de acceso (RLS) en Supabase
-- ═══════════════════════════════════════════════════════════════════════════
-- GENERADO por herramientas/generar_rls.py desde sql/matriz_permisos.json.
-- NO editar a mano: se cambia la matriz y se vuelve a generar.
-- Guía de uso: docs/DESPLIEGUE_SEGURIDAD.md  ·  Para deshacer: sql/rollback_rls.sql
--
-- Qué hace (todo en una sola transacción: si algo falla, no queda nada a medias):
--   0. Guarda cómo estaba cada tabla (para poder deshacer exactamente).
--   1. Crea la función que lee el rol del token (app_metadata.rol — el usuario NO puede
--      cambiarlo; user_metadata sí podría, por eso NO se usa).
--   2. Activa RLS en TODAS las tablas de 'public': sin política = cerrado.
--   3. Le quita a la llave pública (anon) todo acceso a las tablas.
--   4. Crea las políticas por tabla y operación (admin / caja / respaldo).
--
-- Seguro de volver a correr (idempotente).
begin;

-- 0. Estado anterior (solo se guarda la primera vez que se corre este script)
create schema if not exists seguridad;
create table if not exists seguridad.estado_previo (
  tabla text primary key,
  rls_activo boolean not null,
  anon_leia boolean not null,
  guardado_en timestamptz not null default now()
);
insert into seguridad.estado_previo (tabla, rls_activo, anon_leia)
select c.relname, c.relrowsecurity, has_table_privilege('anon', c.oid, 'select')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
on conflict (tabla) do nothing;

-- 1. Rol del usuario, leído de su token firmado
create or replace function seguridad.rol_app() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'rol', '')
$$;
grant usage on schema seguridad to authenticated;
grant execute on function seguridad.rol_app() to authenticated;

-- 2. RLS activo en TODAS las tablas de public (incluidas las que no estén en la lista de abajo)
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- 2b. Las VISTAS de Supabase, por defecto, se saltan el RLS. Se pasan a 'security_invoker' para que
--     respeten las reglas de quien consulta (si no hay vistas en public, esto no hace nada).
do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    if current_setting('server_version_num')::int >= 150000 then
      execute format('alter view public.%I set (security_invoker = true)', v.relname);
    else
      raise exception 'La vista public.% se saltaría las reglas y esta versión de Postgres no permite corregirlo; revísala antes de seguir', v.relname;
    end if;
  end loop;
end $$;

-- 3. La llave pública (anon) ya no abre ninguna tabla; las tablas nuevas tampoco
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
-- Los usuarios con sesión (authenticated) conservan los permisos de tabla; el filtro lo hacen
-- las políticas de abajo (sin política que los deje pasar, no ven ni tocan nada).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 4. Políticas (una por tabla y operación). Nombre: lobo_<tabla>_<operación>
-- pedidos
drop policy if exists "lobo_pedidos_select" on public.pedidos;
create policy "lobo_pedidos_select" on public.pedidos for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_pedidos_insert" on public.pedidos;
create policy "lobo_pedidos_insert" on public.pedidos for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_pedidos_update" on public.pedidos;
create policy "lobo_pedidos_update" on public.pedidos for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_pedidos_delete" on public.pedidos;
create policy "lobo_pedidos_delete" on public.pedidos for delete to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja'));
-- mesas
drop policy if exists "lobo_mesas_select" on public.mesas;
create policy "lobo_mesas_select" on public.mesas for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_mesas_insert" on public.mesas;
create policy "lobo_mesas_insert" on public.mesas for insert to authenticated with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_mesas_update" on public.mesas;
create policy "lobo_mesas_update" on public.mesas for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_mesas_delete" on public.mesas;
create policy "lobo_mesas_delete" on public.mesas for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- clientes_fiado
drop policy if exists "lobo_clientes_fiado_select" on public.clientes_fiado;
create policy "lobo_clientes_fiado_select" on public.clientes_fiado for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_clientes_fiado_insert" on public.clientes_fiado;
create policy "lobo_clientes_fiado_insert" on public.clientes_fiado for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_clientes_fiado_update" on public.clientes_fiado;
create policy "lobo_clientes_fiado_update" on public.clientes_fiado for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_clientes_fiado_delete" on public.clientes_fiado;
create policy "lobo_clientes_fiado_delete" on public.clientes_fiado for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- abonos_fiado
drop policy if exists "lobo_abonos_fiado_select" on public.abonos_fiado;
create policy "lobo_abonos_fiado_select" on public.abonos_fiado for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_abonos_fiado_insert" on public.abonos_fiado;
create policy "lobo_abonos_fiado_insert" on public.abonos_fiado for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_abonos_fiado_update" on public.abonos_fiado;
create policy "lobo_abonos_fiado_update" on public.abonos_fiado for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_abonos_fiado_delete" on public.abonos_fiado;
create policy "lobo_abonos_fiado_delete" on public.abonos_fiado for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- pedidos_eliminados
drop policy if exists "lobo_pedidos_eliminados_select" on public.pedidos_eliminados;
create policy "lobo_pedidos_eliminados_select" on public.pedidos_eliminados for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'respaldo'));
drop policy if exists "lobo_pedidos_eliminados_insert" on public.pedidos_eliminados;
create policy "lobo_pedidos_eliminados_insert" on public.pedidos_eliminados for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_pedidos_eliminados_update" on public.pedidos_eliminados;
create policy "lobo_pedidos_eliminados_update" on public.pedidos_eliminados for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_pedidos_eliminados_delete" on public.pedidos_eliminados;
create policy "lobo_pedidos_eliminados_delete" on public.pedidos_eliminados for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- pedidos_descuentos
drop policy if exists "lobo_pedidos_descuentos_select" on public.pedidos_descuentos;
create policy "lobo_pedidos_descuentos_select" on public.pedidos_descuentos for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'respaldo'));
drop policy if exists "lobo_pedidos_descuentos_insert" on public.pedidos_descuentos;
create policy "lobo_pedidos_descuentos_insert" on public.pedidos_descuentos for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_pedidos_descuentos_update" on public.pedidos_descuentos;
create policy "lobo_pedidos_descuentos_update" on public.pedidos_descuentos for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_pedidos_descuentos_delete" on public.pedidos_descuentos;
create policy "lobo_pedidos_descuentos_delete" on public.pedidos_descuentos for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- inventario
drop policy if exists "lobo_inventario_select" on public.inventario;
create policy "lobo_inventario_select" on public.inventario for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_inventario_insert" on public.inventario;
create policy "lobo_inventario_insert" on public.inventario for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_inventario_update" on public.inventario;
create policy "lobo_inventario_update" on public.inventario for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_inventario_delete" on public.inventario;
create policy "lobo_inventario_delete" on public.inventario for delete to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja'));
-- consumos
drop policy if exists "lobo_consumos_select" on public.consumos;
create policy "lobo_consumos_select" on public.consumos for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_consumos_insert" on public.consumos;
create policy "lobo_consumos_insert" on public.consumos for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_consumos_update" on public.consumos;
create policy "lobo_consumos_update" on public.consumos for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_consumos_delete" on public.consumos;
create policy "lobo_consumos_delete" on public.consumos for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- gastos_dia
drop policy if exists "lobo_gastos_dia_select" on public.gastos_dia;
create policy "lobo_gastos_dia_select" on public.gastos_dia for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_gastos_dia_insert" on public.gastos_dia;
create policy "lobo_gastos_dia_insert" on public.gastos_dia for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_gastos_dia_update" on public.gastos_dia;
create policy "lobo_gastos_dia_update" on public.gastos_dia for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_gastos_dia_delete" on public.gastos_dia;
create policy "lobo_gastos_dia_delete" on public.gastos_dia for delete to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja'));
-- cierres_dia
drop policy if exists "lobo_cierres_dia_select" on public.cierres_dia;
create policy "lobo_cierres_dia_select" on public.cierres_dia for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_cierres_dia_insert" on public.cierres_dia;
create policy "lobo_cierres_dia_insert" on public.cierres_dia for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_cierres_dia_update" on public.cierres_dia;
create policy "lobo_cierres_dia_update" on public.cierres_dia for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_cierres_dia_delete" on public.cierres_dia;
create policy "lobo_cierres_dia_delete" on public.cierres_dia for delete to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja'));
-- aperturas_turno
drop policy if exists "lobo_aperturas_turno_select" on public.aperturas_turno;
create policy "lobo_aperturas_turno_select" on public.aperturas_turno for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_aperturas_turno_insert" on public.aperturas_turno;
create policy "lobo_aperturas_turno_insert" on public.aperturas_turno for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_aperturas_turno_update" on public.aperturas_turno;
create policy "lobo_aperturas_turno_update" on public.aperturas_turno for update to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja')) with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_aperturas_turno_delete" on public.aperturas_turno;
create policy "lobo_aperturas_turno_delete" on public.aperturas_turno for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- notas_dia
drop policy if exists "lobo_notas_dia_select" on public.notas_dia;
create policy "lobo_notas_dia_select" on public.notas_dia for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_notas_dia_insert" on public.notas_dia;
create policy "lobo_notas_dia_insert" on public.notas_dia for insert to authenticated with check ((select seguridad.rol_app()) in ('admin', 'caja'));
drop policy if exists "lobo_notas_dia_update" on public.notas_dia;
create policy "lobo_notas_dia_update" on public.notas_dia for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_notas_dia_delete" on public.notas_dia;
create policy "lobo_notas_dia_delete" on public.notas_dia for delete to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja'));
-- config
drop policy if exists "lobo_config_select" on public.config;
create policy "lobo_config_select" on public.config for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'caja', 'respaldo'));
drop policy if exists "lobo_config_insert" on public.config;
create policy "lobo_config_insert" on public.config for insert to authenticated with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_config_update" on public.config;
create policy "lobo_config_update" on public.config for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_config_delete" on public.config;
create policy "lobo_config_delete" on public.config for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- egresos
drop policy if exists "lobo_egresos_select" on public.egresos;
create policy "lobo_egresos_select" on public.egresos for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'respaldo'));
drop policy if exists "lobo_egresos_insert" on public.egresos;
create policy "lobo_egresos_insert" on public.egresos for insert to authenticated with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_egresos_update" on public.egresos;
create policy "lobo_egresos_update" on public.egresos for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_egresos_delete" on public.egresos;
create policy "lobo_egresos_delete" on public.egresos for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- movimientos_caja
drop policy if exists "lobo_movimientos_caja_select" on public.movimientos_caja;
create policy "lobo_movimientos_caja_select" on public.movimientos_caja for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'respaldo'));
drop policy if exists "lobo_movimientos_caja_insert" on public.movimientos_caja;
create policy "lobo_movimientos_caja_insert" on public.movimientos_caja for insert to authenticated with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_movimientos_caja_update" on public.movimientos_caja;
create policy "lobo_movimientos_caja_update" on public.movimientos_caja for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_movimientos_caja_delete" on public.movimientos_caja;
create policy "lobo_movimientos_caja_delete" on public.movimientos_caja for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));
-- ingresos_extra
drop policy if exists "lobo_ingresos_extra_select" on public.ingresos_extra;
create policy "lobo_ingresos_extra_select" on public.ingresos_extra for select to authenticated using ((select seguridad.rol_app()) in ('admin', 'respaldo'));
drop policy if exists "lobo_ingresos_extra_insert" on public.ingresos_extra;
create policy "lobo_ingresos_extra_insert" on public.ingresos_extra for insert to authenticated with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_ingresos_extra_update" on public.ingresos_extra;
create policy "lobo_ingresos_extra_update" on public.ingresos_extra for update to authenticated using ((select seguridad.rol_app()) in ('admin')) with check ((select seguridad.rol_app()) in ('admin'));
drop policy if exists "lobo_ingresos_extra_delete" on public.ingresos_extra;
create policy "lobo_ingresos_extra_delete" on public.ingresos_extra for delete to authenticated using ((select seguridad.rol_app()) in ('admin'));

commit;

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   tablas_sin_rls = 0 · vistas_sin_proteger = 0 · anon_con_permisos = 0 · politicas = 64
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) as tablas_sin_rls,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any(c.reloptions), false)) as vistas_sin_proteger,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
       and has_table_privilege('anon', c.oid, 'select,insert,update,delete')) as anon_con_permisos,
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'lobo\_%') as politicas;
