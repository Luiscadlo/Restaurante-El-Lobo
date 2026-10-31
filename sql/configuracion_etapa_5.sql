-- ═════════════════════════════════════════════════════════════════
-- El Lobo — CONFIGURACIÓN, ETAPA 5: ¿se piden las «comidas de la familia» al cerrar el almuerzo? (sí / no, con historial)
-- ═════════════════════════════════════════════════════════════════
-- Guía de uso: docs/CONFIGURACION.md  ·  Para deshacer: sql/rollback_configuracion_etapa_5.sql
-- Pruebas: tests/python/test_configuracion_etapa_5.py
--
-- QUÉ HACE (una sola transacción; seguro de volver a correr; NO toca ningún dato ni la tabla):
--   Enseña a la base de datos una clave nueva de la tabla `configuracion` (etapas 1, 2, 4 y 3):
--     · cierre_comidas_familia   verdadero = el cierre del almuerzo pide cuántas comidas comió la familia sin pagar (como siempre
--                                en El Lobo); falso = ese campo y la columna «Familia» del historial no se muestran y los cierres
--                                nuevos quedan sin ese dato (NULL = «no registrado»). Sin nada guardado rige verdadero.
--   Reglas que la base exige aunque alguien se salte la pantalla: el valor debe ser verdadero o falso (nada de texto ni números).
--   Un cambio rige desde que se guarda y NO toca el pasado: lo que ya está en cierres_dia.platos_familia no se borra ni se cambia.
--   Cada guardado es una fila nueva (la anterior queda para siempre), igual que el resto de la configuración.
--
-- Requisito: haber corrido antes, en este orden, sql/configuracion.sql (etapa 1), sql/configuracion_etapa_2.sql (etapa 2),
-- sql/configuracion_etapa_4.sql (etapa 4) y sql/configuracion_etapa_3.sql (etapa 3): esta etapa vuelve a escribir la validación
-- general con TODAS las claves y por eso debe correr de última.
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
  if to_regprocedure('seguridad.validar_menu_platos(jsonb)') is null then
    raise exception 'Primero corre sql/configuracion_etapa_3.sql (etapa 3 de la configuración).';
  end if;
end $$;

-- La validación general: la de la etapa 3 + la clave nueva. El disparador y la regla de historia no cambian.
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

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   familia_instalada = true · disparador = 1 · anon_con_permisos = false
select
  (pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure) like '%cierre_comidas_familia%') as familia_instalada,
  (select count(*) from pg_trigger where tgrelid = 'public.configuracion'::regclass and tgname = 'configuracion_antes') as disparador,
  has_table_privilege('anon', 'public.configuracion', 'select,insert,update,delete') as anon_con_permisos;
