-- ═════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la etapa 4 de la configuración (sql/configuracion_etapa_4.sql)
-- ═════════════════════════════════════════════════════════════════
-- Deja la base como estaba al terminar la etapa 2: la validación y la regla de historia vuelven a ser las de
-- sql/configuracion_etapa_2.sql y se quitan las tres funciones de las categorías de egresos y de los nombres de cuentas.
-- NO borra nada de la tabla: las categorías y nombres de cuentas que ya se guardaron quedan en el historial (la base ya no
-- deja agregar nuevos, y el sistema de la etapa 2 ignora esas filas: vuelve a las categorías y nombres de siempre). Para volver
-- a usarlos, corre otra vez sql/configuracion_etapa_4.sql. Lo que ya se registró no cambia: cada gasto guarda su monto.
-- OJO: si el sistema (el HTML) ya es el de la etapa 4, las pantallas «Categorías de egresos» y «Nombres de las cuentas» dejarán
-- de poder guardar hasta que vuelvas a instalar la etapa 4.
-- Seguro de correr dos veces.
begin;

-- 1. Las dos funciones vuelven a ser exactamente las de la etapa 2.
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
grant execute on function seguridad.validar_catalogo_historia(text, jsonb) to authenticated;
grant execute on function seguridad.validar_configuracion(text, jsonb) to authenticated;

-- 2. Se quitan las funciones propias de la etapa 4.
drop function if exists seguridad.validar_nombres_cuentas(jsonb);
drop function if exists seguridad.validar_categorias_egresos(jsonb);
drop function if exists seguridad.categorias_egresos_base();

commit;

-- Verificación. Lo esperado: categorias_instaladas = false · disparador = 1
select
  (to_regprocedure('seguridad.validar_categorias_egresos(jsonb)') is not null
     or to_regprocedure('seguridad.validar_nombres_cuentas(jsonb)') is not null
     or to_regprocedure('seguridad.categorias_egresos_base()') is not null) as categorias_instaladas,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador;
