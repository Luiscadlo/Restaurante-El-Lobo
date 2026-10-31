-- ═════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la etapa 2 de la configuración (sql/configuracion_etapa_2.sql)
-- ═════════════════════════════════════════════════════════════════
-- Deja la base como estaba al terminar la etapa 1: la validación y el disparador vuelven a ser los de sql/configuracion.sql
-- y se quitan las tres funciones de los catálogos de productos.
-- NO borra nada de la tabla: los catálogos que ya se guardaron quedan en el historial (la base ya no deja agregar nuevos, y
-- el sistema de la etapa 1 ignora esas filas: vuelve a los precios y productos de siempre). Para volver a usarlos, corre otra
-- vez sql/configuracion_etapa_2.sql. Lo que ya se vendió no cambia: cada pedido guarda su monto.
-- OJO: si el sistema (el HTML) ya es el de la etapa 2, la pantalla «Productos y precios» dejará de poder guardar hasta que
-- vuelvas a instalar la etapa 2.
-- Seguro de correr dos veces.
begin;

-- 1. Las dos funciones vuelven a ser exactamente las de la etapa 1.
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

-- 2. Se quitan las funciones de los catálogos (ya nadie las llama).
drop function if exists seguridad.validar_catalogo_historia(text, jsonb);
drop function if exists seguridad.validar_catalogo(text, jsonb);
drop function if exists seguridad.codigos_catalogo_base(text);

commit;

-- Verificación. Lo esperado: catalogos_instalados = false · disparador = 1
select
  (to_regprocedure('seguridad.validar_catalogo(text,jsonb)') is not null
     or to_regprocedure('seguridad.validar_catalogo_historia(text,jsonb)') is not null
     or to_regprocedure('seguridad.codigos_catalogo_base(text)') is not null) as catalogos_instalados,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador;
