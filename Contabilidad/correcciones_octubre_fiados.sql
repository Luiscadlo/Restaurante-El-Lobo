-- ════════════════════════════════════════════════════════════════════
-- El Lobo — Correcciones de fiados de OCTUBRE 2026 (auditoría 16-oct-2026)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Va en UNA transacción y verifica cada registro antes de tocarlo: si algo
-- no está como lo dejó la auditoría (o ya se corrigió), aborta SIN cambiar
-- nada y dice por qué.
--
-- ⚠ ANTES DE CORRERLO: respalda las tablas afectadas (Table Editor →
--   Export to CSV, o Datos → Exportar desde la app): movimientos_caja,
--   abonos_fiado, pedidos, cierres_dia.
--
-- REQUISITO: haber corrido antes migracion_supabase_abonos_turno.sql y
-- desplegado el HTML nuevo.
--
-- Qué corrige:
--  1. Santiago — el aporte #41 de Caja (+10.000 en transf_almuerzos, 15-oct)
--     está duplicado: esos 10.000 ya entraron en el cierre de almuerzo del
--     16-oct como pago de los pedidos 3682 y 3754. Se borra el aporte.
--  2. Cristian — el abono #15 (12.000 por transferencia, 16-oct a las 12:22)
--     sí llegó, pero el pedido 3644 se revirtió a pendiente y la plata no
--     quedó en ningún cierre ni en Caja. Se le pone turno al abono (almuerzo
--     del 16-oct, así entra a ese cierre) y se salda el pedido 3644 con la
--     regla nueva: conserva su fecha/turno de consumo (14-oct almuerzo) y
--     queda cobrado el 16-oct almuerzo vía abonos, sin sumar plata otra vez.
--
-- DESPUÉS de correrlo, en la app (falta 1 paso que no se hace por SQL porque
-- el cierre es una foto que la app recalcula):
--   Cierre → Historial completo de cierres (contraseña) → 16-oct Almuerzo →
--   "Ver" → Guardar cierre. Debe pasar de 201.000 a 213.000 en
--   transferencia, con "Abonos de fiado — transferencia: 12.000".
--   Caja (transf_almuerzos) sube 12.000 y baja 10.000 por el aporte borrado:
--   neto +2.000 frente a hoy.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ANTES: cómo están hoy -----------------------------------------------------
select 'ANTES movimiento 41' as que, id, fecha, tipo, cuenta, monto, descripcion
from movimientos_caja where id = 41;
select 'ANTES abono 15' as que, id, cliente_fiado_id, fecha, turno, monto, cuenta
from abonos_fiado where id = 15;
select 'ANTES pedido 3644' as que, id, cliente_fiado_id, fecha, turno, estado, metodo,
       pagado_via_abono, fecha_pago, turno_pago, monto_total
from pedidos where id = 3644;

-- Verificación: todo debe estar exactamente como lo dejó la auditoría --------
do $$
begin
  if not exists (select 1 from movimientos_caja
                 where id = 41 and tipo = 'aporte' and monto = 10000
                   and cuenta = 'transf_almuerzos' and descripcion like 'Abono fiado%Santiago') then
    raise exception 'El movimiento de Caja #41 no es el aporte duplicado de Santiago (o ya se borró). No se cambió nada.';
  end if;
  if not exists (select 1 from abonos_fiado
                 where id = 15 and cliente_fiado_id = 5 and monto = 12000
                   and fecha = '2026-10-16' and cuenta = 'transferencia' and turno is null) then
    raise exception 'El abono #15 de Cristian no está como se esperaba (o ya tiene turno). No se cambió nada.';
  end if;
  if not exists (select 1 from pedidos
                 where id = 3644 and cliente_fiado_id = 5 and estado = 'pendiente'
                   and es_fiar = true and monto_total = 12000) then
    raise exception 'El pedido 3644 de Cristian no está pendiente como se esperaba. No se cambió nada.';
  end if;
end $$;

-- 1. Santiago: borrar el aporte duplicado -----------------------------------
delete from movimientos_caja where id = 41;

-- 2. Cristian: turno real del abono #15 y saldar el pedido 3644 -------------
update abonos_fiado set turno = 'almuerzo' where id = 15;

update pedidos
set estado = 'pagado', metodo = 'transferencia',
    monto_efectivo = 0, monto_transferencia = 0,
    pagado_via_abono = true, fecha_pago = '2026-10-16', turno_pago = 'almuerzo'
where id = 3644;

-- DESPUÉS: debe verse corregido ---------------------------------------------
select 'DESPUÉS movimiento 41 (debe dar 0)' as que, count(*) from movimientos_caja where id = 41;
select 'DESPUÉS abono 15' as que, id, fecha, turno, monto, cuenta from abonos_fiado where id = 15;
select 'DESPUÉS pedido 3644' as que, id, fecha, turno, estado, pagado_via_abono, fecha_pago, turno_pago
from pedidos where id = 3644;

-- Saldo de Cristian con la fórmula de calcularSaldoFiado() (debe dar 0):
-- pendiente − (abonos − pagado vía abono)
select 'DESPUÉS saldo Cristian (debe dar 0)' as que,
  coalesce((select sum(monto_total) from pedidos where cliente_fiado_id = 5 and es_fiar and estado = 'pendiente'), 0)
  - ( coalesce((select sum(monto) from abonos_fiado where cliente_fiado_id = 5), 0)
    - coalesce((select sum(monto_total) from pedidos where cliente_fiado_id = 5 and pagado_via_abono and estado = 'pagado'), 0) )
  as saldo;

commit;
