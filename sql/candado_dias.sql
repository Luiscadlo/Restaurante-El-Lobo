-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — CANDADO DE DÍAS: caja no puede cambiar datos de días anteriores (lo exige el SERVIDOR)
-- ═══════════════════════════════════════════════════════════════════════════
-- Guía de uso: docs/DESPLIEGUE_SEGURIDAD.md (Paso 6b)  ·  Para deshacer: sql/rollback_candado.sql
-- Reglas explicadas para humanos: docs/MATRIZ_PERMISOS.md (sección «Candado de días»).
-- Pruebas: tests/python/test_candado_dias.py (contra un Postgres de verdad).
--
-- POR QUÉ: la pantalla ya le pide administrador a caja para corregir cierres o pedidos de otros días, pero
-- eso es solo de pantalla: quien sepa manipular la página con el usuario de caja podría tocar datos pasados.
-- Este SQL lo exige en la base de datos. Funciona como "disparadores" (triggers): antes de guardar un
-- cambio, si quien lo hace es el rol «caja» y el registro es de un día anterior, la base lo RECHAZA con un
-- mensaje claro (no lo ignora en silencio). Los administradores, el respaldo y las herramientas de
-- restauración (llave de servicio) NO se ven afectados.
--
-- QUÉ ES «HOY»: el día de negocio, en hora de Bogotá. El día cambia a las 9:00 a. m. (igual que la pantalla:
-- el turno de cena puede pasar de medianoche y se sigue cerrando con la fecha del día en que empezó).
-- Un registro con fecha igual o posterior al día de negocio es «de hoy»; uno anterior está cerrado para caja.
--
-- QUÉ BLOQUEA (solo para caja):
--   · cierres_dia, gastos_dia, aperturas_turno, notas_dia, abonos_fiado, consumos:
--       crear, cambiar o borrar un registro con fecha anterior al día de negocio.
--   · pedidos:
--       - un pedido ya COBRADO de un día anterior no se puede cambiar ni borrar;
--       - no se puede crear un pedido cobrado con fecha anterior;
--       - no se puede MOVER la fecha de un pedido hacia el pasado (salvo devolverle su fecha original al
--         deshacer un pago de fiado);
--       - un pedido PENDIENTE sí puede cobrarse, editarse o cancelarse aunque sea de días atrás (así se cobra
--         un fiado viejo), y se le pueden agregar productos (el nuevo ítem hereda la fecha del pedido).
--
-- Requiere haber corrido antes sql/rls_seguridad.sql (usa seguridad.rol_app()). Seguro de correr dos veces.
begin;

do $$
begin
  if to_regprocedure('seguridad.rol_app()') is null then
    raise exception 'Primero corre sql/rls_seguridad.sql: falta seguridad.rol_app()';
  end if;
end $$;

-- 1. Reloj y día de negocio. seguridad.ahora() existe aparte solo para que las pruebas puedan fijar la hora.
create or replace function seguridad.ahora() returns timestamptz
language sql stable as $$ select now() $$;

-- Día de negocio actual: hora de Bogotá menos 9 horas (de 00:00 a 08:59 todavía es el día anterior).
create or replace function seguridad.dia_negocio() returns date
language sql stable as $$
  select ((seguridad.ahora() at time zone 'America/Bogota') - interval '9 hours')::date
$$;

grant execute on function seguridad.ahora() to authenticated;
grant execute on function seguridad.dia_negocio() to authenticated;

-- La llave de servicio (service_role: la usa la restauración de respaldos) no pasa por las reglas de acceso, pero
-- los candados SÍ se ejecutan cuando escribe: necesita poder usar el esquema «seguridad» o sus escrituras fallarían.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema seguridad to service_role;
  end if;
end $$;

-- 2. El rechazo (un solo lugar para el mensaje). Código 42501 = «sin permiso»: el sistema lo recibe como un 403
--    (no como 401, que cerraría la sesión). El DETAIL «candado_dias» es lo que la pantalla usa para reconocerlo.
create or replace function seguridad.rechazar_dia_cerrado(dia date) returns void
language plpgsql as $$
begin
  raise exception using
    errcode = '42501',
    message = format('Caja solo puede cambiar lo de hoy. Este registro es del %s: pídele el cambio al administrador.', to_char(dia, 'DD/MM/YYYY')),
    detail = 'candado_dias',
    hint = 'El día cambia a las 9:00 a. m. (hora de Bogotá).';
end $$;

-- 3. Tablas con fecha simple: cierres_dia, gastos_dia, aperturas_turno, notas_dia, abonos_fiado, consumos.
create or replace function seguridad.candado_dias() returns trigger
language plpgsql as $$
declare
  dia date := seguridad.dia_negocio();
  vieja date;
  nueva date;
begin
  if seguridad.rol_app() <> 'caja' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then vieja := old.fecha; end if;
  if tg_op <> 'DELETE' then nueva := new.fecha; end if;
  if vieja < dia or nueva < dia then
    perform seguridad.rechazar_dia_cerrado(least(vieja, nueva));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- 4. pedidos: más fino, porque un pedido PENDIENTE de días atrás sigue "vivo" (se cobra, se edita, se cancela)
--    y lo cobrado de un día anterior queda sellado. «Fecha contable» de un pedido cobrado = fecha_pago si la
--    tiene (fiado saldado con abonos), si no su fecha.
create or replace function seguridad.candado_dias_pedidos() returns trigger
language plpgsql as $$
declare
  dia date := seguridad.dia_negocio();
begin
  if seguridad.rol_app() <> 'caja' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Un pedido nuevo cobrado en el acto: debe ser de hoy.
    if new.estado = 'pagado' and coalesce(new.fecha_pago, new.fecha) < dia then
      perform seguridad.rechazar_dia_cerrado(coalesce(new.fecha_pago, new.fecha));
    end if;
    -- Uno pendiente con fecha anterior solo se acepta como producto agregado a un pedido pendiente que ya
    -- existe (mismo grupo y misma fecha): es lo que hace «Agregar producto» en Pendientes.
    if new.fecha < dia and not exists (
      select 1 from public.pedidos p
      where p.estado = 'pendiente' and p.fecha = new.fecha
        and p.grupo_pedido is not null and p.grupo_pedido = new.grupo_pedido
    ) then
      perform seguridad.rechazar_dia_cerrado(new.fecha);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.estado = 'pagado' and coalesce(old.fecha_pago, old.fecha) < dia then
      perform seguridad.rechazar_dia_cerrado(coalesce(old.fecha_pago, old.fecha));
    end if;
    return old;

  else
    -- Lo cobrado de un día anterior está sellado.
    if old.estado = 'pagado' and coalesce(old.fecha_pago, old.fecha) < dia then
      perform seguridad.rechazar_dia_cerrado(coalesce(old.fecha_pago, old.fecha));
    end if;
    -- La fecha no se puede llevar al pasado (salvo restaurar fecha_original al deshacer el pago de un fiado).
    if new.fecha is distinct from old.fecha and new.fecha < dia and new.fecha is distinct from old.fecha_original then
      perform seguridad.rechazar_dia_cerrado(new.fecha);
    end if;
    -- Tampoco la fecha de cobro.
    if new.fecha_pago is distinct from old.fecha_pago and new.fecha_pago < dia then
      perform seguridad.rechazar_dia_cerrado(new.fecha_pago);
    end if;
    return new;
  end if;
end $$;

-- 5. Los candados (un disparador por tabla, antes de guardar).
do $$
declare t text;
begin
  foreach t in array array['cierres_dia', 'gastos_dia', 'aperturas_turno', 'notas_dia', 'abonos_fiado', 'consumos'] loop
    execute format('drop trigger if exists lobo_candado_dias on public.%I', t);
    execute format('create trigger lobo_candado_dias before insert or update or delete on public.%I '
                   'for each row execute function seguridad.candado_dias()', t);
  end loop;
end $$;

drop trigger if exists lobo_candado_dias on public.pedidos;
create trigger lobo_candado_dias before insert or update or delete on public.pedidos
  for each row execute function seguridad.candado_dias_pedidos();

commit;

-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:
--   candados = 7 · dia_de_negocio = la fecha de HOY en Bogotá (antes de las 9:00 a. m. sale la de ayer)
select
  (select count(*) from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal) as candados,
  seguridad.dia_negocio() as dia_de_negocio;
