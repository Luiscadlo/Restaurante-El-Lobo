-- Marca los cierres cargados manualmente (cuando el sistema no se pudo usar
-- ese día y las cuentas se llevaron aparte en papel/otro medio), para poder
-- distinguirlos en el historial de los cierres calculados automáticamente
-- a partir de pedidos y gastos.
alter table cierres_dia add column if not exists manual boolean default false;
