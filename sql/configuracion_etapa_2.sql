-- ═════════════════════════════════════════════════════════════════
-- El Lobo — CONFIGURACIÓN, ETAPA 2: productos y precios (catálogos editables, con historial)
-- ═════════════════════════════════════════════════════════════════
-- Guía de uso: docs/CONFIGURACION.md  ·  Para deshacer: sql/rollback_configuracion_etapa_2.sql
-- Pruebas: tests/python/test_configuracion_etapa_2.py
--
-- QUÉ HACE (una sola transacción; seguro de volver a correr; NO toca ningún dato ni la tabla):
--   Enseña a la base de datos tres claves nuevas de la tabla `configuracion` (etapa 1). Cada una guarda el catálogo
--   COMPLETO como una lista, y cada guardado es una versión nueva (la anterior queda para siempre):
--     · catalogo_almuerzos  los 8 tipos de almuerzo (código fijo, nombre, precio, activo). Siempre exactamente esos 8.
--     · catalogo_rapidas    comidas rápidas, bebidas y adicionales (código, nombre, precio, categoría, activo).
--     · catalogo_extras     productos adicionales de la ventana «Agregar producto» (nombre, precio, activo).
--   Reglas que la base exige aunque alguien se salte la pantalla:
--     · precio entero entre $100 y $500.000; nombre de 1 a 60 caracteres, sin < > & " ' ` \ ni espacios en los bordes;
--     · los productos NUNCA se borran, se RETIRAN (activo = false): cada versión debe traer todos los códigos de la
--       anterior (y los 49 de El Lobo), así los pedidos viejos siempre se pueden mostrar;
--     · el código de un producto nunca cambia; los nuevos son letra + letras/números (ej. X001).
--   Un cambio de precio rige desde que se guarda: cada pedido ya guarda su monto, nada del pasado se recalcula.
--
-- Requisito: haber corrido antes sql/configuracion.sql (etapa 1).
begin;

do $$
begin
  if to_regclass('public.configuracion') is null or to_regprocedure('seguridad.validar_configuracion(text,jsonb)') is null then
    raise exception 'Primero corre sql/configuracion.sql (etapa 1 de la configuración).';
  end if;
end $$;

-- 1. Códigos que no se pueden quitar nunca (los de El Lobo desde el principio).
create or replace function seguridad.codigos_catalogo_base(p_clave text) returns text[]
language sql immutable as $$
  select case p_clave
    when 'catalogo_almuerzos' then array['completo','seco','asado130','asado200','porcion-sopa','porcion-arroz','porcion-proteina','sopa-y-arroz']
    when 'catalogo_rapidas' then array['PE01','PE02','PE03','PE04','PE05','PE06','HB01','HB02','CRA01','CRA02','CRA03','PI01','PI02','PI03','PI04','PI05','SL01','SL02','SL03','SL04','CU01','CU02','CU03','CU04','ARP01','ARP02','ARP03','ARP04','ARP05','ARP06','ARP07','ARP08','ARP09','ARP10','ARP11','SZ01','SZ02','SZ03','SZ04','SZ05','ADI01','ADI02','ADI03','BEB01','BEB02','BEB03','BEB04','BEB05','BEB06']
    else array[]::text[]
  end
$$;

-- 2. Forma y rangos de cada catálogo.
create or replace function seguridad.validar_catalogo(p_clave text, p_valor jsonb) returns void
language plpgsql immutable as $$
declare
  v_item jsonb;
  v_claves text[];
  v_esperadas text[];
  v_codigos text[] := '{}';
  v_nombres text[] := '{}';
  v_cod text;
  v_nom text;
  v_cat text;
  v_precio numeric;
  v_n int;
  v_que text := case p_clave
    when 'catalogo_almuerzos' then 'El catálogo de almuerzos'
    when 'catalogo_rapidas' then 'El catálogo de comidas rápidas'
    else 'La lista de productos adicionales' end;
begin
  if jsonb_typeof(p_valor) is distinct from 'array' then
    raise exception '% debe ser una lista.', v_que using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  v_n := jsonb_array_length(p_valor);
  if (p_clave = 'catalogo_almuerzos' and v_n <> 8)
     or (p_clave = 'catalogo_rapidas' and (v_n < 1 or v_n > 300))
     or (p_clave = 'catalogo_extras' and v_n > 100) then
    raise exception '% trae % productos y esa cantidad no es válida.', v_que, v_n using errcode = '22023', detail = 'configuracion_invalida';
  end if;
  v_esperadas := case p_clave
    when 'catalogo_rapidas' then array['activo','categoria','codigo','nombre','precio']
    when 'catalogo_almuerzos' then array['activo','codigo','nombre','precio']
    else array['activo','nombre','precio'] end;

  for v_item in select e from jsonb_array_elements(p_valor) as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception '% trae un producto mal formado.', v_que using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_claves from jsonb_object_keys(v_item) as k;
    if v_claves is distinct from v_esperadas then
      raise exception '% trae un producto con campos que no corresponden.', v_que using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if jsonb_typeof(v_item -> 'nombre') is distinct from 'string' then
      raise exception 'El nombre de cada producto debe ser un texto.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_nom := v_item ->> 'nombre';
    if char_length(v_nom) < 1 or char_length(v_nom) > 60 or v_nom <> btrim(v_nom) then
      raise exception 'El nombre de cada producto debe tener entre 1 y 60 caracteres, sin espacios al principio ni al final.' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if v_nom ~ '[<>&"''`]' or position(chr(92) in v_nom) > 0 or v_nom ~ '[[:cntrl:]]' then
      raise exception 'Los nombres no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if jsonb_typeof(v_item -> 'precio') is distinct from 'number' then
      raise exception 'El precio de "%" debe ser un número.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    v_precio := (v_item ->> 'precio')::numeric;
    if v_precio <> trunc(v_precio) or v_precio < 100 or v_precio > 500000 then
      raise exception 'El precio de "%" debe ser un número entero entre 100 y 500000.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;
    if jsonb_typeof(v_item -> 'activo') is distinct from 'boolean' then
      raise exception '"%" debe estar activo o retirado (verdadero o falso).', v_nom using errcode = '22023', detail = 'configuracion_invalida';
    end if;

    if p_clave = 'catalogo_extras' then
      if lower(v_nom) = any (v_nombres) then
        raise exception 'El producto adicional "%" está repetido.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      v_nombres := v_nombres || lower(v_nom);
    else
      if jsonb_typeof(v_item -> 'codigo') is distinct from 'string' then
        raise exception 'El código de "%" debe ser un texto.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      v_cod := v_item ->> 'codigo';
      if p_clave = 'catalogo_almuerzos' then
        if not (v_cod = any (seguridad.codigos_catalogo_base(p_clave))) then
          raise exception 'El código "%" no es un tipo de almuerzo de El Lobo.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
        end if;
      elsif v_cod !~ '^[A-Z][A-Z0-9]{1,7}$' then
        raise exception 'El código "%" no sirve: una letra mayúscula seguida de 1 a 7 letras mayúsculas o números.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      if v_cod = any (v_codigos) then
        raise exception 'El código "%" está repetido.', v_cod using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      v_codigos := v_codigos || v_cod;
    end if;

    if p_clave = 'catalogo_rapidas' then
      if jsonb_typeof(v_item -> 'categoria') is distinct from 'string' then
        raise exception 'La categoría de "%" debe ser un texto.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      v_cat := v_item ->> 'categoria';
      if char_length(v_cat) < 1 or char_length(v_cat) > 30 or v_cat <> btrim(v_cat) or v_cat <> upper(v_cat) then
        raise exception 'La categoría de "%" debe tener entre 1 y 30 caracteres, en MAYÚSCULAS y sin espacios al principio ni al final.', v_nom using errcode = '22023', detail = 'configuracion_invalida';
      end if;
      if v_cat ~ '[<>&"''`]' or position(chr(92) in v_cat) > 0 or v_cat ~ '[[:cntrl:]]' then
        raise exception 'Las categorías no pueden llevar los caracteres < > & " '' ` \ (ni caracteres de control).' using errcode = '22023', detail = 'configuracion_invalida';
      end if;
    end if;
  end loop;

  if p_clave in ('catalogo_almuerzos', 'catalogo_rapidas') then
    if exists (select 1 from unnest(seguridad.codigos_catalogo_base(p_clave)) as b where not (b = any (v_codigos))) then
      raise exception '% no puede quitar productos de El Lobo: se retiran, no se borran.', v_que using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  end if;
end $$;

-- 3. Lo que ya existía no se pierde: la versión nueva debe traer todos los códigos de la anterior.
create or replace function seguridad.validar_catalogo_historia(p_clave text, p_valor jsonb) returns void
language plpgsql stable as $$
declare
  v_prev jsonb;
  v_faltan text;
begin
  if p_clave not in ('catalogo_almuerzos', 'catalogo_rapidas') then return; end if;
  select c.valor into v_prev from public.configuracion c where c.clave = p_clave order by c.vigente_desde desc, c.id desc limit 1;
  if v_prev is null or jsonb_typeof(v_prev) is distinct from 'array' then return; end if;
  select string_agg(x.v ->> 'codigo', ', ' order by x.ord) into v_faltan
  from jsonb_array_elements(v_prev) with ordinality as x(v, ord)
  where x.v ? 'codigo'
    and not exists (select 1 from jsonb_array_elements(p_valor) as y where y ->> 'codigo' = x.v ->> 'codigo');
  if v_faltan is not null then
    raise exception 'No se pueden borrar productos (%): se retiran, para que los pedidos viejos se sigan mostrando.', v_faltan using errcode = '22023', detail = 'configuracion_invalida';
  end if;
end $$;
grant execute on function seguridad.codigos_catalogo_base(text) to authenticated;
grant execute on function seguridad.validar_catalogo(text, jsonb) to authenticated;
grant execute on function seguridad.validar_catalogo_historia(text, jsonb) to authenticated;

-- 4. La validación general y el disparador (los mismos de la etapa 1 + las claves nuevas).
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
  else
    raise exception 'La configuración "%" no existe.', p_clave using errcode = '22023', detail = 'configuracion_clave_desconocida';
  end if;
end $$;
grant execute on function seguridad.validar_configuracion(text, jsonb) to authenticated;

create or replace function seguridad.configuracion_antes() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op <> 'INSERT' then
      raise exception 'La configuración solo se agrega: lo anterior no se edita ni se borra.'
        using errcode = '42501', detail = 'configuracion_solo_agregar';
    end if;
    perform seguridad.validar_configuracion(new.clave, new.valor);
    perform seguridad.validar_catalogo_historia(new.clave, new.valor);
    new.vigente_desde := now();
    new.creado_en := now();
    new.creado_por := left(coalesce(nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''), 'desconocido'), 60);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists configuracion_antes on public.configuracion;
create trigger configuracion_antes before insert or update or delete on public.configuracion
  for each row execute function seguridad.configuracion_antes();

commit;

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   catalogos_instalados = true · disparador = 1 · anon_con_permisos = false
select
  (pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure) like '%catalogo_extras%'
     and to_regprocedure('seguridad.validar_catalogo(text,jsonb)') is not null
     and to_regprocedure('seguridad.validar_catalogo_historia(text,jsonb)') is not null) as catalogos_instalados,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador,
  has_table_privilege('anon', 'public.configuracion', 'select,insert,update,delete') as anon_con_permisos;
