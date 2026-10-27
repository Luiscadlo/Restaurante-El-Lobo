-- ═════════════════════════════════════════════════════════════════
-- El Lobo — RESTAURAR UN RESPALDO desde el sistema  +  EMPEZAR DE CERO
-- ═════════════════════════════════════════════════════════════════
-- Qué instala (todo en una sola transacción: si algo falla, no queda nada a medias):
--   · public.lobo_restaurar_respaldo(respaldo, confirmacion)  → la usa el botón «♻️ Restaurar desde un respaldo»
--       de la pestaña Datos. REEMPLAZA todos los datos por los del archivo .json de «Respaldo completo».
--       Es TODO-O-NADA: si cualquier cosa falla (archivo dañado, conteos que no cuadran…), la base queda
--       exactamente como estaba.
--   · public.lobo_empezar_de_cero(confirmacion, borrar_inventario)  → la usa el botón «🧹 Empezar de cero».
--       Borra los datos de trabajo (ventas, cierres, gastos, caja, fiados…). Las MESAS se conservan (vuelven a
--       «libre»: el sistema no tiene cómo crearlas) y el inventario también, salvo que se pida borrarlo.
--   · seguridad.restauraciones → bitácora de cada restauración / borrado (quién, cuándo, cuántas filas había
--       antes y después). Nadie la ve desde el sistema: se consulta en Supabase → SQL Editor.
--
-- Quién puede usarlas: SOLO el rol «admin» (se comprueba DENTRO de la función con el token firmado; la llave
-- pública y el usuario de caja reciben «permission denied»). La palabra de confirmación también se exige aquí
-- (RESTAURAR / BORRAR TODO), no solo en la pantalla.
--
-- Requisitos: haber corrido antes sql/rls_seguridad.sql (crea seguridad.rol_app()).
-- Seguro de volver a correr (idempotente).  Para quitarlo: sql/rollback_restaurar.sql
-- Guía de uso: docs/RESTAURAR.md
begin;

create schema if not exists seguridad;

do $$
begin
  if to_regprocedure('seguridad.rol_app()') is null then
    raise exception 'Primero corre sql/rls_seguridad.sql (falta seguridad.rol_app())';
  end if;
end $$;

-- ── Bitácora ───────────────────────────────────────────────────────────────────────
create table if not exists seguridad.restauraciones (
  id bigint generated always as identity primary key,
  cuando timestamptz not null default now(),
  quien text,
  accion text not null,
  conteos_antes jsonb not null,
  conteos_despues jsonb not null,
  respaldo_generado_en text
);
alter table seguridad.restauraciones enable row level security;   -- sin políticas: nadie la toca desde la API
revoke all on seguridad.restauraciones from public, anon, authenticated;

-- ── Restaurar un respaldo ──────────────────────────────────────────────────────────
create or replace function public.lobo_restaurar_respaldo(p_respaldo jsonb, p_confirmacion text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  -- Las 16 tablas del «Respaldo completo» (las mismas que TABLAS_RESPALDO en el sistema), en el ORDEN DE CARGA:
  -- primero las que otras tablas referencian por llave foránea (pedidos y abonos_fiado → clientes_fiado;
  -- consumos → inventario), para que cada fila encuentre a su «padre».
  c_tablas constant text[] := array[
    'inventario', 'clientes_fiado', 'pedidos', 'egresos', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia',
    'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'abonos_fiado',
    'pedidos_descuentos', 'config'];
  -- Pueden faltar en respaldos viejos: si no vienen, esa tabla se deja como está.
  c_opcionales constant text[] := array['config', 'pedidos_descuentos'];
  t text;
  v_filas jsonb;
  v_n bigint;
  v_cols text;
  v_lista text;
  v_secuencia text;
  v_max bigint;
  v_antes jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
  v_hechas text[] := '{}';
  v_omitidas text[] := '{}';
begin
  -- 1. Quién y con qué palabra
  if seguridad.rol_app() is distinct from 'admin' then
    raise exception 'Solo el administrador puede restaurar un respaldo.'
      using errcode = '42501', detail = 'restaurar_solo_admin';
  end if;
  if p_confirmacion is distinct from 'RESTAURAR' then
    raise exception 'Falta la palabra de confirmación (RESTAURAR).'
      using errcode = '22023', detail = 'restaurar_sin_confirmacion';
  end if;

  -- 2. El archivo: forma, tablas conocidas, tablas obligatorias y conteos declarados = filas reales
  if jsonb_typeof(p_respaldo) is distinct from 'object'
     or jsonb_typeof(p_respaldo -> 'tablas') is distinct from 'object'
     or jsonb_typeof(p_respaldo -> 'conteos') is distinct from 'object'
     or (p_respaldo ->> 'version') is distinct from '1' then
    raise exception 'El archivo no es un respaldo completo de El Lobo (versión 1). No se cambió nada.'
      using errcode = '22023', detail = 'respaldo_invalido';
  end if;
  for t in select jsonb_object_keys(p_respaldo -> 'tablas') loop
    if not (t = any (c_tablas)) then
      raise exception 'El respaldo trae una tabla que no es de El Lobo: "%". No se cambió nada.', t
        using errcode = '22023', detail = 'respaldo_tabla_desconocida';
    end if;
  end loop;
  foreach t in array c_tablas loop
    if p_respaldo -> 'tablas' ? t then
      v_filas := p_respaldo -> 'tablas' -> t;
      if jsonb_typeof(v_filas) is distinct from 'array' then
        raise exception 'En el respaldo, "%" no es una lista de filas. No se cambió nada.', t
          using errcode = '22023', detail = 'respaldo_invalido';
      end if;
      if exists (select 1 from jsonb_array_elements(v_filas) e where jsonb_typeof(e) is distinct from 'object') then
        raise exception 'En el respaldo, "%" tiene filas que no son válidas. No se cambió nada.', t
          using errcode = '22023', detail = 'respaldo_invalido';
      end if;
      v_n := jsonb_array_length(v_filas);
      if (p_respaldo -> 'conteos' ->> t) is distinct from v_n::text then
        raise exception 'El respaldo está incompleto o dañado: "%" declara % filas pero trae %. No se cambió nada.',
          t, coalesce(p_respaldo -> 'conteos' ->> t, 'ninguna'), v_n
          using errcode = '22023', detail = 'respaldo_conteo';
      end if;
    elsif not (t = any (c_opcionales)) then
      raise exception 'Al respaldo le falta la tabla "%". No se cambió nada.', t
        using errcode = '22023', detail = 'respaldo_tabla_faltante';
    else
      v_omitidas := v_omitidas || t;
    end if;
  end loop;

  -- 3. Cómo estaba todo antes (para la bitácora y para que la pantalla lo muestre)
  foreach t in array c_tablas loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_antes := v_antes || jsonb_build_object(t, v_n);
  end loop;

  -- 4. Vaciar las tablas que el respaldo reemplaza (todas juntas, por si algún día hay llaves foráneas)
  select string_agg(format('public.%I', x), ', ') into v_lista
  from unnest(c_tablas) x where p_respaldo -> 'tablas' ? x;
  execute 'truncate table ' || v_lista || ' restart identity';

  -- 5. Cargar. Solo las columnas que vienen en el archivo Y existen en la tabla (el resto toma su valor por
  --    defecto); con «overriding system value» para conservar los mismos id aunque la tabla los genere sola.
  foreach t in array c_tablas loop
    continue when not (p_respaldo -> 'tablas' ? t);
    v_filas := p_respaldo -> 'tablas' -> t;
    v_n := jsonb_array_length(v_filas);
    if v_n > 0 then
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
      where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
        and a.attgenerated = ''
        and exists (select 1 from jsonb_array_elements(v_filas) e where e ? a.attname::text);
      if v_cols is null then
        raise exception 'Ninguna columna del respaldo de "%" existe en la base. No se cambió nada.', t
          using errcode = '22023', detail = 'respaldo_invalido';
      end if;
      execute format(
        'insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)',
        t, v_cols) using v_filas;
    end if;
    v_hechas := v_hechas || t;
  end loop;

  -- 6. Verificar: lo que quedó en cada tabla = lo que traía el archivo; y dejar los contadores de id al día
  foreach t in array v_hechas loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n is distinct from jsonb_array_length(p_respaldo -> 'tablas' -> t)::bigint then
      raise exception 'Verificación fallida en "%": quedaron % filas y el respaldo traía %. No se cambió nada.',
        t, v_n, jsonb_array_length(p_respaldo -> 'tablas' -> t)
        using errcode = 'XX000', detail = 'restaurar_verificacion';
    end if;
    -- (mesas y config no tienen columna id: pg_get_serial_sequence fallaría)
    v_secuencia := null;
    if exists (select 1 from pg_attribute a where a.attrelid = format('public.%I', t)::regclass
                 and a.attname = 'id' and a.attnum > 0 and not a.attisdropped) then
      v_secuencia := pg_get_serial_sequence(format('public.%I', t), 'id');
    end if;
    if v_secuencia is not null then
      execute format('select coalesce(max(id), 0) from public.%I', t) into v_max;
      perform setval(v_secuencia, greatest(v_max, 1), v_max > 0);
    end if;
  end loop;
  foreach t in array c_tablas loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_despues := v_despues || jsonb_build_object(t, v_n);
  end loop;

  -- 7. Bitácora
  insert into seguridad.restauraciones (quien, accion, conteos_antes, conteos_despues, respaldo_generado_en)
  values (coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'sub'), 'restaurar', v_antes, v_despues, p_respaldo ->> 'generado_en');

  return jsonb_build_object('ok', true, 'accion', 'restaurar', 'antes', v_antes, 'despues', v_despues,
                            'restauradas', to_jsonb(v_hechas), 'sin_cambios', to_jsonb(v_omitidas));
end
$fn$;

-- ── Empezar de cero ───────────────────────────────────────────────────────────────
create or replace function public.lobo_empezar_de_cero(p_confirmacion text, p_borrar_inventario boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_tablas constant text[] := array[
    'inventario', 'clientes_fiado', 'pedidos', 'egresos', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia',
    'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'abonos_fiado',
    'pedidos_descuentos', 'config'];
  t text;
  v_n bigint;
  v_lista text;
  v_antes jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
begin
  if seguridad.rol_app() is distinct from 'admin' then
    raise exception 'Solo el administrador puede empezar de cero.'
      using errcode = '42501', detail = 'cero_solo_admin';
  end if;
  if p_confirmacion is distinct from 'BORRAR TODO' then
    raise exception 'Falta la palabra de confirmación (BORRAR TODO).'
      using errcode = '22023', detail = 'cero_sin_confirmacion';
  end if;

  foreach t in array c_tablas loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_antes := v_antes || jsonb_build_object(t, v_n);
  end loop;

  -- Se conservan las mesas (el sistema no puede crearlas) y, salvo que se pida lo contrario, el inventario.
  select string_agg(format('public.%I', x), ', ') into v_lista
  from unnest(c_tablas) x
  where x <> 'mesas' and (x <> 'inventario' or coalesce(p_borrar_inventario, false));
  execute 'truncate table ' || v_lista || ' restart identity';
  -- «where true»: Supabase rechaza desde la app un UPDATE sin WHERE (seguro anti-accidentes); aquí sí se quieren todas las mesas.
  update public.mesas set estado = 'libre', updated_at = now() where true;

  foreach t in array c_tablas loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_despues := v_despues || jsonb_build_object(t, v_n);
  end loop;

  insert into seguridad.restauraciones (quien, accion, conteos_antes, conteos_despues)
  values (coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'sub'),
          case when coalesce(p_borrar_inventario, false) then 'empezar_de_cero_con_inventario' else 'empezar_de_cero' end,
          v_antes, v_despues);

  return jsonb_build_object('ok', true, 'accion', 'empezar_de_cero', 'antes', v_antes, 'despues', v_despues);
end
$fn$;

-- ── Permisos: solo con sesión iniciada (la función además exige rol «admin») ──────────
revoke all on function public.lobo_restaurar_respaldo(jsonb, text) from public, anon;
revoke all on function public.lobo_empezar_de_cero(text, boolean) from public, anon;
grant execute on function public.lobo_restaurar_respaldo(jsonb, text) to authenticated;
grant execute on function public.lobo_empezar_de_cero(text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   funciones = 2 · anon_puede_ejecutar = 0 · bitacora = 1
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('lobo_restaurar_respaldo', 'lobo_empezar_de_cero')) as funciones,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('lobo_restaurar_respaldo', 'lobo_empezar_de_cero')
       and has_function_privilege('anon', p.oid, 'execute')) as anon_puede_ejecutar,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'seguridad' and c.relname = 'restauraciones') as bitacora;
