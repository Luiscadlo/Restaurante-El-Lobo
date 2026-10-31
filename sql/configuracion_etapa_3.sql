-- ═════════════════════════════════════════════════════════════════
-- El Lobo — CONFIGURACIÓN, ETAPA 3: platos del menú (con historial)
-- ═════════════════════════════════════════════════════════════════
-- Guía de uso: docs/CONFIGURACION.md  ·  Para deshacer: sql/rollback_configuracion_etapa_3.sql
-- Pruebas: tests/python/test_configuracion_etapa_3.py
--
-- QUÉ HACE (una sola transacción; seguro de volver a correr; NO toca ningún dato ni la tabla):
--   Enseña a la base de datos una clave nueva de la tabla `configuracion` (etapas 1, 2 y 4):
--     · menu_platos   la lista ÚNICA de platos del menú: sopas, arroces, proteínas, acompañamientos y asados. La usan el
--                     autocompletado de Pedidos y el generador de la imagen del Menú. Cada plato: código, lista, nombre, activo.
--   Cada guardado es la lista COMPLETA y es una versión nueva (la anterior queda para siempre).
--   Reglas que la base exige aunque alguien se salte la pantalla:
--     · los platos NUNCA se borran, se RETIRAN (activo = false): cada versión debe traer todos los códigos de la anterior y los
--       47 de El Lobo, así los pedidos viejos siempre se pueden contar;
--     · el código no cambia nunca y lleva el prefijo de su lista (SP sopa · AR arroz · PT proteína · AC acompañamiento · AS asado)
--       más 2 o 3 números; lo que sí se puede cambiar es el NOMBRE (los reportes cuentan juntos el nombre viejo y el nuevo);
--     · nombre de 1 a 50 caracteres, sin < > & " ' ` \ ni espacios en los bordes, sin repetirse dentro de su lista
--       (proteínas y asados cuentan como una sola lista, porque los pedidos las guardan en el mismo campo);
--     · de 47 a 300 platos.
--   Un cambio rige desde que se guarda: cada pedido ya guarda el nombre del plato que se tomó, nada del pasado se modifica.
--
-- Requisito: haber corrido antes sql/configuracion.sql (etapa 1), sql/configuracion_etapa_2.sql (etapa 2) y
-- sql/configuracion_etapa_4.sql (etapa 4: esta etapa se apoya en sus funciones).
begin;

do $$
begin
  if to_regclass('public.configuracion') is null or to_regprocedure('seguridad.validar_configuracion(text,jsonb)') is null then
    raise exception 'Primero corre sql/configuracion.sql (etapa 1 de la configuración).';
  end if;
  if to_regprocedure('seguridad.validar_catalogo_historia(text,jsonb)') is null then
    raise exception 'Primero corre sql/configuracion_etapa_2.sql (etapa 2 de la configuración).';
  end if;
  if to_regprocedure('seguridad.validar_categorias_egresos(jsonb)') is null then
    raise exception 'Primero corre sql/configuracion_etapa_4.sql (etapa 4 de la configuración).';
  end if;
end $$;

-- 1. Los platos de El Lobo desde el principio: no se pueden quitar.
create or replace function seguridad.menu_platos_base() returns jsonb
language sql immutable as $$
  select '[{"codigo":"SP01","lista":"sopa"},{"codigo":"SP02","lista":"sopa"},{"codigo":"SP03","lista":"sopa"},{"codigo":"SP04","lista":"sopa"},{"codigo":"SP05","lista":"sopa"},{"codigo":"SP06","lista":"sopa"},{"codigo":"SP07","lista":"sopa"},{"codigo":"SP08","lista":"sopa"},{"codigo":"SP09","lista":"sopa"},{"codigo":"AR01","lista":"arroz"},{"codigo":"AR02","lista":"arroz"},{"codigo":"AR03","lista":"arroz"},{"codigo":"AR04","lista":"arroz"},{"codigo":"AR05","lista":"arroz"},{"codigo":"AS01","lista":"asado"},{"codigo":"AS02","lista":"asado"},{"codigo":"AS03","lista":"asado"},{"codigo":"AC01","lista":"acomp"},{"codigo":"AC02","lista":"acomp"},{"codigo":"AC03","lista":"acomp"},{"codigo":"PT01","lista":"proteina"},{"codigo":"PT02","lista":"proteina"},{"codigo":"PT03","lista":"proteina"},{"codigo":"PT04","lista":"proteina"},{"codigo":"PT05","lista":"proteina"},{"codigo":"PT06","lista":"proteina"},{"codigo":"PT07","lista":"proteina"},{"codigo":"PT08","lista":"proteina"},{"codigo":"PT09","lista":"proteina"},{"codigo":"PT10","lista":"proteina"},{"codigo":"PT11","lista":"proteina"},{"codigo":"PT12","lista":"proteina"},{"codigo":"PT13","lista":"proteina"},{"codigo":"PT14","lista":"proteina"},{"codigo":"PT15","lista":"proteina"},{"codigo":"PT16","lista":"proteina"},{"codigo":"PT17","lista":"proteina"},{"codigo":"PT18","lista":"proteina"},{"codigo":"PT19","lista":"proteina"},{"codigo":"PT20","lista":"proteina"},{"codigo":"PT21","lista":"proteina"},{"codigo":"PT22","lista":"proteina"},{"codigo":"PT23","lista":"proteina"},{"codigo":"PT24","lista":"proteina"},{"codigo":"PT25","lista":"proteina"},{"codigo":"PT26","lista":"proteina"},{"codigo":"PT27","lista":"proteina"}]'::jsonb
$$;

-- 2. Forma y rangos de la lista de platos.
create or replace function seguridad.validar_menu_platos(p_valor jsonb) returns void
language plpgsql immutable as $$
declare
  v_item jsonb;
  v_claves text[];
  v_codigos text[] := '{}';
  v_nombres text[] := '{}';
  v_cod text;
  v_nom text;
  v_lista text;
  v_pref text;
  v_campo text;
  v_n int;
begin
  if jsonb_typeof(p_valor) is distinct from 'array' then
    raise exception 'La lista de platos del menú debe ser una lista.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  v_n := jsonb_array_length(p_valor);
  if v_n < 47 or v_n > 300 then
    raise exception 'La lista de platos del menú trae % platos y esa cantidad no es válida.', v_n using errcode = '22023', detail = 'configuracion_invalida';
  end if;

  for v_item in select e from jsonb_array_elements(p_valor) as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'La lista de platos del menú trae un plato mal formado.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_claves from jsonb_object_keys(v_item) as k;
    if v_claves is distinct from array['activo','codigo','lista','nombre'] then
      raise exception 'La lista de platos del menú trae un plato con campos que no corresponden.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if jsonb_typeof(v_item -> 'nombre') is distinct from 'string' then
      raise exception 'El nombre de cada plato debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nom := v_item ->> 'nombre';
    if char_length(v_nom) < 1 or char_length(v_nom) > 50 or v_nom <> btrim(v_nom) then
      raise exception 'El nombre de cada plato debe tener entre 1 y 50 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_nom ~ '[<>&"''`]' or position(chr(92) in v_nom) > 0 or v_nom ~ '[[:cntrl:]]' then
      raise exception 'Los nombres no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    v_lista := case when jsonb_typeof(v_item -> 'lista') = 'string' then v_item ->> 'lista' end;
    if v_lista is null or v_lista not in ('sopa','arroz','proteina','acomp','asado') then
      raise exception 'La lista de "%" no es válida (sopa, arroz, proteina, acomp o asado).', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_pref := case v_lista when 'sopa' then 'SP' when 'arroz' then 'AR' when 'proteina' then 'PT' when 'acomp' then 'AC' else 'AS' end;

    if jsonb_typeof(v_item -> 'codigo') is distinct from 'string' then
      raise exception 'El código de "%" debe ser un texto.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_cod := v_item ->> 'codigo';
    if v_cod !~ ('^' || v_pref || '[0-9]{2,3}$') then
      raise exception 'El código "%" no sirve para la lista %: debe ser % seguido de 2 o 3 números.', v_cod, v_lista, v_pref using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_cod = any (v_codigos) then
      raise exception 'El código "%" está repetido.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_codigos := v_codigos || v_cod;

    v_campo := case when v_lista in ('proteina','asado') then 'proteina' else v_lista end;
    if (v_campo || ':' || lower(v_nom)) = any (v_nombres) then
      raise exception 'El plato "%" está repetido en su lista.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nombres := v_nombres || (v_campo || ':' || lower(v_nom));

    if jsonb_typeof(v_item -> 'activo') is distinct from 'boolean' then
      raise exception '"%" debe estar activo o retirado (verdadero o falso).', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(seguridad.menu_platos_base()) as b where not (b ->> 'codigo' = any (v_codigos))) then
    raise exception 'La lista de platos del menú no puede quitar platos de El Lobo: se retiran, no se borran.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
end $$;

-- 3. Lo que ya existía no se pierde: la versión nueva debe traer todos los códigos de la anterior.
--    (Los catálogos de productos y las categorías de egresos se comportan exactamente igual que en las etapas 2 y 4.)
create or replace function seguridad.validar_catalogo_historia(p_clave text, p_valor jsonb) returns void
language plpgsql stable as $$
declare
  v_prev jsonb;
  v_faltan text;
  v_cambia text;
begin
  if p_clave not in ('catalogo_almuerzos', 'catalogo_rapidas', 'categorias_egresos', 'menu_platos') then return; end if;
  select c.valor into v_prev from public.configuracion c where c.clave = p_clave order by c.vigente_desde desc, c.id desc limit 1;
  if v_prev is null or jsonb_typeof(v_prev) is distinct from 'array' then return; end if;
  select string_agg(x.v ->> 'codigo', ', ' order by x.ord) into v_faltan
  from jsonb_array_elements(v_prev) with ordinality as x(v, ord)
  where x.v ? 'codigo'
    and not exists (select 1 from jsonb_array_elements(p_valor) as y where y ->> 'codigo' = x.v ->> 'codigo');
  if v_faltan is not null then
    if p_clave = 'categorias_egresos' then
      raise exception 'No se pueden borrar categorías (%): se retiran, para que los gastos viejos se sigan mostrando.', v_faltan using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if p_clave = 'menu_platos' then
      raise exception 'No se pueden borrar platos (%): se retiran, para que los pedidos viejos se sigan contando.', v_faltan using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    raise exception 'No se pueden borrar productos (%): se retiran, para que los pedidos viejos se sigan mostrando.', v_faltan using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  if p_clave = 'categorias_egresos' then
    select string_agg(x.v ->> 'codigo', ', ' order by x.ord) into v_cambia
    from jsonb_array_elements(v_prev) with ordinality as x(v, ord)
    where exists (select 1 from jsonb_array_elements(p_valor) as y
                  where y ->> 'codigo' = x.v ->> 'codigo' and y ->> 'grupo' is distinct from x.v ->> 'grupo');
    if v_cambia is not null then
      raise exception 'No se puede cambiar el grupo de una categoría ya creada (%): lo que ya se registró seguiría contándose distinto.', v_cambia using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  end if;
end $$;

grant execute on function seguridad.menu_platos_base() to authenticated;
grant execute on function seguridad.validar_menu_platos(jsonb) to authenticated;
grant execute on function seguridad.validar_catalogo_historia(text, jsonb) to authenticated;

-- 5. La validación general (la de la etapa 4 + la clave nueva). El disparador no cambia: ya llama a la validación y a la historia.
create or replace function seguridad.validar_configuracion(p_clave text, p_valor jsonb) returns void
language plpgsql immutable as $$
declare
  v_tipo text := jsonb_typeof(p_valor);
  v_num numeric;
  v_txt text;
  v_min numeric;
  v_max numeric;
  v_nombre text;
begin
  if p_clave in ('mesas', 'recargo_para_llevar', 'empaque_domicilio', 'respaldo_dia_semana', 'respaldo_rojo_dias') then
    select m.minimo, m.maximo, m.nombre into v_min, v_max, v_nombre
    from (values
      ('mesas', 1, 60, 'El número de mesas'),
      ('recargo_para_llevar', 0, 50000, 'El recargo de «para llevar»'),
      ('empaque_domicilio', 0, 50000, 'El empaque de domicilio'),
      ('respaldo_dia_semana', 0, 6, 'El día del respaldo semanal'),
      ('respaldo_rojo_dias', 7, 60, 'Los días para el aviso rojo del respaldo')
    ) as m(clave, minimo, maximo, nombre) where m.clave = p_clave;
    if v_tipo is distinct from 'number' then
      raise exception '% debe ser un número.', v_nombre using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_num := (p_valor #>> '{}')::numeric;
    if v_num <> trunc(v_num) or v_num < v_min or v_num > v_max then
      raise exception '% debe ser un número entero entre % y %.', v_nombre, v_min, v_max using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  elsif p_clave in ('negocio_nombre', 'negocio_emoji') then
    if v_tipo is distinct from 'string' then
      raise exception 'El valor de % debe ser un texto.', p_clave using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_txt := p_valor #>> '{}';
    if p_clave = 'negocio_nombre' and (char_length(btrim(v_txt)) < 1 or char_length(v_txt) > 40 or v_txt <> btrim(v_txt)) then
      raise exception 'El nombre del negocio debe tener entre 1 y 40 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if p_clave = 'negocio_emoji' and char_length(v_txt) > 8 then
      raise exception 'El símbolo del negocio puede tener hasta 8 caracteres.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  elsif p_clave in ('catalogo_almuerzos', 'catalogo_rapidas', 'catalogo_extras') then
    perform seguridad.validar_catalogo(p_clave, p_valor);
  elsif p_clave = 'categorias_egresos' then
    perform seguridad.validar_categorias_egresos(p_valor);
  elsif p_clave = 'nombres_cuentas' then
    perform seguridad.validar_nombres_cuentas(p_valor);
  elsif p_clave = 'menu_platos' then
    perform seguridad.validar_menu_platos(p_valor);
  else
    raise exception 'La configuración "%" no existe.', p_clave using errcode = '22023', detail = 'configuracion_clave_desconocida';
  end if;
end $$;
grant execute on function seguridad.validar_configuracion(text, jsonb) to authenticated;

commit;

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   platos_instalados = true · disparador = 1 · anon_con_permisos = false
select
  (pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure) like '%menu_platos%'
     and to_regprocedure('seguridad.validar_menu_platos(jsonb)') is not null
     and to_regprocedure('seguridad.menu_platos_base()') is not null) as platos_instalados,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador,
  has_table_privilege('anon', 'public.configuracion', 'select,insert,update,delete') as anon_con_permisos;
