-- ═════════════════════════════════════════════════════════════════
-- El Lobo — CONFIGURACIÓN, ETAPA 4: categorías de egresos y nombres de las cuentas (con historial)
-- ═════════════════════════════════════════════════════════════════
-- Guía de uso: docs/CONFIGURACION.md  ·  Para deshacer: sql/rollback_configuracion_etapa_4.sql
-- Pruebas: tests/python/test_configuracion_etapa_4.py
--
-- QUÉ HACE (una sola transacción; seguro de volver a correr; NO toca ningún dato ni la tabla):
--   Enseña a la base de datos dos claves nuevas de la tabla `configuracion` (etapas 1 y 2). Cada una guarda la lista COMPLETA,
--   y cada guardado es una versión nueva (la anterior queda para siempre):
--     · categorias_egresos  las categorías de gastos/egresos (código, nombre, grupo, dónde se usa, activa).
--         - grupo: nomina · proveedor · operativo (arriendo y servicios) · desechable · otro · excluido (no cuenta como egreso,
--           como los préstamos). El grupo decide en qué casilla de los reportes y del modelo financiero se suma, y NO se puede
--           cambiar una vez creada la categoría (así lo que ya se registró nunca cambia de lugar).
--         - donde: egresos (pestaña Egresos) · cierre (gastos del cierre del día) · ambos. Un grupo «excluido» solo va al cierre.
--     · nombres_cuentas     el nombre y el símbolo de las 3 cuentas fijas (efectivo, transf_almuerzos, transf_rapidas).
--   Reglas que la base exige aunque alguien se salte la pantalla:
--     · las categorías NUNCA se borran, se RETIRAN (activa = false): cada versión debe traer todos los códigos de la anterior
--       (y los 7 de El Lobo, cada uno con su grupo de siempre), así los gastos viejos siempre se pueden mostrar;
--     · nombre de 1 a 40 caracteres (cuentas: 1 a 30), sin < > & " ' ` \ ni espacios en los bordes, sin repetirse;
--     · siempre debe quedar al menos una categoría activa para Egresos y una para el cierre;
--     · las cuentas son siempre exactamente las 3 de El Lobo: solo cambia cómo se llaman.
--   Un cambio rige desde que se guarda: cada gasto y cada cierre ya guardan su monto, nada del pasado se recalcula.
--
-- Requisito: haber corrido antes sql/configuracion.sql (etapa 1) y sql/configuracion_etapa_2.sql (etapa 2).
begin;

do $$
begin
  if to_regclass('public.configuracion') is null or to_regprocedure('seguridad.validar_configuracion(text,jsonb)') is null then
    raise exception 'Primero corre sql/configuracion.sql (etapa 1 de la configuración).';
  end if;
  if to_regprocedure('seguridad.validar_catalogo_historia(text,jsonb)') is null then
    raise exception 'Primero corre sql/configuracion_etapa_2.sql (etapa 2 de la configuración).';
  end if;
end $$;

-- 1. Las categorías de El Lobo desde el principio: no se pueden quitar ni cambiarles el grupo.
create or replace function seguridad.categorias_egresos_base() returns jsonb
language sql immutable as $$
  select '[{"codigo":"nomina","grupo":"nomina"},{"codigo":"proveedor","grupo":"proveedor"},{"codigo":"arriendo","grupo":"operativo"},{"codigo":"servicios","grupo":"operativo"},{"codigo":"desechables","grupo":"desechable"},{"codigo":"otro","grupo":"otro"},{"codigo":"prestamo","grupo":"excluido"}]'::jsonb
$$;

-- 2. Forma y rangos de la lista de categorías.
create or replace function seguridad.validar_categorias_egresos(p_valor jsonb) returns void
language plpgsql immutable as $$
declare
  v_item jsonb;
  v_claves text[];
  v_codigos text[] := '{}';
  v_nombres text[] := '{}';
  v_cod text;
  v_nom text;
  v_grupo text;
  v_donde text;
  v_base text;
  v_n int;
begin
  if jsonb_typeof(p_valor) is distinct from 'array' then
    raise exception 'La lista de categorías de egresos debe ser una lista.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  v_n := jsonb_array_length(p_valor);
  if v_n < 7 or v_n > 40 then
    raise exception 'La lista de categorías de egresos trae % categorías y esa cantidad no es válida.', v_n using errcode = '22023', detail = 'configuracion_invalida';
  end if;

  for v_item in select e from jsonb_array_elements(p_valor) as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'La lista de categorías de egresos trae una categoría mal formada.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_claves from jsonb_object_keys(v_item) as k;
    if v_claves is distinct from array['activo','codigo','donde','grupo','nombre'] then
      raise exception 'La lista de categorías de egresos trae una categoría con campos que no corresponden.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if jsonb_typeof(v_item -> 'nombre') is distinct from 'string' then
      raise exception 'El nombre de cada categoría debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nom := v_item ->> 'nombre';
    if char_length(v_nom) < 1 or char_length(v_nom) > 40 or v_nom <> btrim(v_nom) then
      raise exception 'El nombre de cada categoría debe tener entre 1 y 40 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_nom ~ '[<>&"''`]' or position(chr(92) in v_nom) > 0 or v_nom ~ '[[:cntrl:]]' then
      raise exception 'Los nombres no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if lower(v_nom) = any (v_nombres) then
      raise exception 'El nombre de categoría "%" está repetido.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nombres := v_nombres || lower(v_nom);

    if jsonb_typeof(v_item -> 'codigo') is distinct from 'string' then
      raise exception 'El código de "%" debe ser un texto.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_cod := v_item ->> 'codigo';
    if v_cod !~ '^[a-z][a-z0-9_]{1,15}$' then
      raise exception 'El código "%" no sirve: una letra minúscula seguida de 1 a 15 letras minúsculas, números o guion bajo.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_cod = any (v_codigos) then
      raise exception 'El código "%" está repetido.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_codigos := v_codigos || v_cod;

    v_grupo := case when jsonb_typeof(v_item -> 'grupo') = 'string' then v_item ->> 'grupo' end;
    if v_grupo is null or v_grupo not in ('nomina','proveedor','operativo','desechable','otro','excluido') then
      raise exception 'El grupo de "%" no es válido.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_donde := case when jsonb_typeof(v_item -> 'donde') = 'string' then v_item ->> 'donde' end;
    if v_donde is null or v_donde not in ('egresos','cierre','ambos') then
      raise exception 'El lugar de uso de "%" no es válido (egresos, cierre o ambos).', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_grupo = 'excluido' and v_donde <> 'cierre' then
      raise exception '"%" no cuenta como egreso, así que solo puede usarse en el cierre.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    select b ->> 'grupo' into v_base from jsonb_array_elements(seguridad.categorias_egresos_base()) as b where b ->> 'codigo' = v_cod;
    if v_base is not null and v_base <> v_grupo then
      raise exception 'La categoría "%" es de El Lobo y no puede cambiar de grupo.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if jsonb_typeof(v_item -> 'activo') is distinct from 'boolean' then
      raise exception '"%" debe estar activa o retirada (verdadero o falso).', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(seguridad.categorias_egresos_base()) as b where not (b ->> 'codigo' = any (v_codigos))) then
    raise exception 'La lista de categorías de egresos no puede quitar categorías de El Lobo: se retiran, no se borran.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_valor) as e where (e ->> 'activo')::boolean and e ->> 'donde' in ('egresos', 'ambos')) then
    raise exception 'Debe quedar al menos una categoría activa para registrar egresos.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_valor) as e where (e ->> 'activo')::boolean and e ->> 'donde' in ('cierre', 'ambos')) then
    raise exception 'Debe quedar al menos una categoría activa para el cierre del día.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
end $$;

-- 3. Forma de los nombres de las cuentas: siempre las 3 de El Lobo.
create or replace function seguridad.validar_nombres_cuentas(p_valor jsonb) returns void
language plpgsql immutable as $$
declare
  v_item jsonb;
  v_claves text[];
  v_codigos text[] := '{}';
  v_nombres text[] := '{}';
  v_cod text;
  v_nom text;
  v_emo text;
  v_n int;
begin
  if jsonb_typeof(p_valor) is distinct from 'array' then
    raise exception 'Los nombres de las cuentas deben ser una lista.' using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  v_n := jsonb_array_length(p_valor);
  if v_n <> 3 then
    raise exception 'Los nombres de las cuentas traen % cuentas y deben ser exactamente 3.', v_n using errcode = '22023', detail = 'configuracion_invalida';
  end if;

  for v_item in select e from jsonb_array_elements(p_valor) as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Los nombres de las cuentas traen una cuenta mal formada.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_claves from jsonb_object_keys(v_item) as k;
    if v_claves is distinct from array['codigo','emoji','nombre'] then
      raise exception 'Los nombres de las cuentas traen una cuenta con campos que no corresponden.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if jsonb_typeof(v_item -> 'codigo') is distinct from 'string' then
      raise exception 'El código de cada cuenta debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_cod := v_item ->> 'codigo';
    if v_cod not in ('efectivo', 'transf_almuerzos', 'transf_rapidas') then
      raise exception 'El código de cuenta "%" no existe.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_cod = any (v_codigos) then
      raise exception 'La cuenta "%" está repetida.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_codigos := v_codigos || v_cod;

    if jsonb_typeof(v_item -> 'nombre') is distinct from 'string' then
      raise exception 'El nombre de cada cuenta debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nom := v_item ->> 'nombre';
    if char_length(v_nom) < 1 or char_length(v_nom) > 30 or v_nom <> btrim(v_nom) then
      raise exception 'El nombre de cada cuenta debe tener entre 1 y 30 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_nom ~ '[<>&"''`]' or position(chr(92) in v_nom) > 0 or v_nom ~ '[[:cntrl:]]' then
      raise exception 'Los nombres no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if lower(v_nom) = any (v_nombres) then
      raise exception 'El nombre de cuenta "%" está repetido.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nombres := v_nombres || lower(v_nom);

    if jsonb_typeof(v_item -> 'emoji') is distinct from 'string' then
      raise exception 'El símbolo de cada cuenta debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_emo := v_item ->> 'emoji';
    if char_length(v_emo) > 8 or v_emo <> btrim(v_emo) then
      raise exception 'El símbolo de cada cuenta puede tener hasta 8 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_emo ~ '[<>&"''`]' or position(chr(92) in v_emo) > 0 or v_emo ~ '[[:cntrl:]]' then
      raise exception 'Los símbolos no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  end loop;
end $$;

-- 4. Lo que ya existía no se pierde: la versión nueva debe traer todos los códigos de la anterior (y las categorías, el mismo grupo).
--    (Los catálogos de productos se comportan exactamente igual que en la etapa 2.)
create or replace function seguridad.validar_catalogo_historia(p_clave text, p_valor jsonb) returns void
language plpgsql stable as $$
declare
  v_prev jsonb;
  v_faltan text;
  v_cambia text;
begin
  if p_clave not in ('catalogo_almuerzos', 'catalogo_rapidas', 'categorias_egresos') then return; end if;
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

grant execute on function seguridad.categorias_egresos_base() to authenticated;
grant execute on function seguridad.validar_categorias_egresos(jsonb) to authenticated;
grant execute on function seguridad.validar_nombres_cuentas(jsonb) to authenticated;
grant execute on function seguridad.validar_catalogo_historia(text, jsonb) to authenticated;

-- 5. La validación general (la de la etapa 2 + las dos claves nuevas). El disparador no cambia: ya llama a la validación y a la historia.
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
  else
    raise exception 'La configuración "%" no existe.', p_clave using errcode = '22023', detail = 'configuracion_clave_desconocida';
  end if;
end $$;
grant execute on function seguridad.validar_configuracion(text, jsonb) to authenticated;

commit;

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   categorias_instaladas = true · disparador = 1 · anon_con_permisos = false
select
  (pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure) like '%categorias_egresos%'
     and to_regprocedure('seguridad.validar_categorias_egresos(jsonb)') is not null
     and to_regprocedure('seguridad.validar_nombres_cuentas(jsonb)') is not null
     and to_regprocedure('seguridad.categorias_egresos_base()') is not null) as categorias_instaladas,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador,
  has_table_privilege('anon', 'public.configuracion', 'select,insert,update,delete') as anon_con_permisos;
