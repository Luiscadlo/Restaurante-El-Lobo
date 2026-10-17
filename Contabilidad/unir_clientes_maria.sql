-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Unir clientes fiados duplicados: "maria" (id 9) → "María" (id 8)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Va en UNA transacción y verifica antes de tocar nada: si los ids ya no
-- son esas clientas (o ya se unieron), aborta SIN cambiar nada.
--
-- ⚠ ANTES DE CORRERLO: respalda las tablas afectadas (Table Editor →
--   Export to CSV, o Datos → Exportar desde la app): clientes_fiado,
--   pedidos, abonos_fiado.
--
-- Tablas que referencian cliente_fiado_id (revisado en el HTML y con
-- consultas de solo lectura el 16-oct-2026): pedidos y abonos_fiado.
-- pedidos_eliminados NO tiene esa columna. Si en el futuro otra tabla la
-- tiene, agrégala al paso 2 antes de correr esto.
--
-- Esperado (16-oct-2026):
--   id 8 "María": pedidos 2907, 2908 (pagados vía abono), 3745 (pendiente
--                 2.000), abono #9 (8.000)
--   id 9 "maria": pedido 3054 (pagado vía abono), abono #10 (2.000)
--   Saldo de María después de unir = 2.000 (2.000 pendiente − (10.000
--   abonado − 10.000 pagado vía abono)).
--
-- Independiente de los otros archivos: se puede correr antes o después.
-- ════════════════════════════════════════════════════════════════════

begin;

-- Verificación: los ids siguen siendo esas dos clientas --------------------
do $$
begin
  if not exists (select 1 from clientes_fiado where id = 8 and lower(nombre) in ('maría', 'maria')) then
    raise exception 'El cliente id 8 no es "María". No se cambió nada.';
  end if;
  if not exists (select 1 from clientes_fiado where id = 9 and lower(nombre) in ('maría', 'maria')) then
    raise exception 'El cliente id 9 no es "maria" (¿ya se unió?). No se cambió nada.';
  end if;
end $$;

-- 1. ANTES: registros y saldo de cada id -------------------------------------
select 'ANTES cliente' as que, id, nombre, telefono from clientes_fiado where id in (8, 9) order by id;
select 'ANTES pedidos' as que, id, cliente_fiado_id, fecha, turno, estado, pagado_via_abono, monto_total
from pedidos where cliente_fiado_id in (8, 9) order by cliente_fiado_id, fecha, id;
select 'ANTES abonos' as que, id, cliente_fiado_id, fecha, monto, cuenta
from abonos_fiado where cliente_fiado_id in (8, 9) order by cliente_fiado_id, fecha, id;

-- Saldo con la fórmula de calcularSaldoFiado():
--   pendiente − (abonos − pagado vía abono)
select 'ANTES saldo' as que, c.id, c.nombre,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.es_fiar and p.estado = 'pendiente'), 0) as pendiente,
  coalesce((select sum(monto) from abonos_fiado a where a.cliente_fiado_id = c.id), 0) as abonos,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.pagado_via_abono and p.estado = 'pagado'), 0) as pagado_via_abono,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.es_fiar and p.estado = 'pendiente'), 0)
  - ( coalesce((select sum(monto) from abonos_fiado a where a.cliente_fiado_id = c.id), 0)
    - coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.pagado_via_abono and p.estado = 'pagado'), 0) ) as saldo
from clientes_fiado c where c.id in (8, 9) order by c.id;

-- 2. Pasar a id 8 todos los registros de id 9 ---------------------------------
update pedidos      set cliente_fiado_id = 8 where cliente_fiado_id = 9;
update abonos_fiado set cliente_fiado_id = 8 where cliente_fiado_id = 9;

-- 3. Borrar el cliente id 9 (ya no le queda ningún registro) ------------------
delete from clientes_fiado where id = 9;

-- 4. DESPUÉS: saldo de María (debe dar 2.000) y que no quede nada en id 9 -----
select 'DESPUÉS registros con id 9 (debe dar 0)' as que,
  (select count(*) from pedidos where cliente_fiado_id = 9)
  + (select count(*) from abonos_fiado where cliente_fiado_id = 9)
  + (select count(*) from clientes_fiado where id = 9) as quedan;

select 'DESPUÉS saldo María (debe dar 2000)' as que, c.id, c.nombre,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.es_fiar and p.estado = 'pendiente'), 0) as pendiente,
  coalesce((select sum(monto) from abonos_fiado a where a.cliente_fiado_id = c.id), 0) as abonos,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.pagado_via_abono and p.estado = 'pagado'), 0) as pagado_via_abono,
  coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.es_fiar and p.estado = 'pendiente'), 0)
  - ( coalesce((select sum(monto) from abonos_fiado a where a.cliente_fiado_id = c.id), 0)
    - coalesce((select sum(monto_total) from pedidos p where p.cliente_fiado_id = c.id and p.pagado_via_abono and p.estado = 'pagado'), 0) ) as saldo
from clientes_fiado c where c.id = 8;

commit;
