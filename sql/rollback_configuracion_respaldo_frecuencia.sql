-- ═════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la frecuencia del respaldo (sql/configuracion_respaldo_frecuencia.sql)
-- ═════════════════════════════════════════════════════════════════
-- Deja la base como estaba al instalar sql/configuracion_cierre_familia.sql: la validación general vuelve a ser exactamente la de
-- ese archivo (sin la clave respaldo_frecuencia).
-- NO borra nada de la tabla: lo que ya se guardó queda en el historial (la base ya no deja agregar cambios nuevos de esta opción, y el
-- sistema ignora una frecuencia que no puede validar: el aviso vuelve a ser semanal, como siempre).
-- OJO: si el sistema (el HTML) ya trae esta opción, la pantalla de Configuración → Respaldo dejará de poder guardarla hasta que vuelvas a
-- instalarla. Para volver a usarla, corre otra vez sql/configuracion_respaldo_frecuencia.sql.
-- Seguro de correr dos veces.
begin;

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
  elsif p_clave = 'cierre_comidas_familia' then
    if v_tipo is distinct from 'boolean' then
      raise exception 'La opción «comidas de la familia en el cierre» debe ser sí o no (verdadero o falso).' using errcode = '22023', detail = 'configuracion_invalida';
    end if;
  else
    raise exception 'La configuración "%" no existe.', p_clave using errcode = '22023', detail = 'configuracion_clave_desconocida';
  end if;
end $$;
grant execute on function seguridad.validar_configuracion(text, jsonb) to authenticated;

commit;

-- Verificación. Lo esperado: frecuencia_quitada = true
select (pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure) not like '%respaldo_frecuencia%') as frecuencia_quitada;
