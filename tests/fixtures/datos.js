// Datos de ejemplo 100 % FICTICIOS para las pruebas. Nada de aquí viene del negocio real.
// "Hoy" en las pruebas es el martes 2026-10-20 (ver FECHA_HOY en helpers/backend-falso.js).
//
// Las cuentas a mano que usan las pruebas (tests/reglas.spec.js) están explicadas junto
// a cada bloque: si cambias un dato, vuelve a calcularlas.

const FECHA_HOY = '2026-10-20';

// Fila base de la tabla "pedidos" (todas las columnas que arma el sistema al guardar).
let _id = 100;
function pedido(extra) {
  _id += 1;
  return Object.assign({
    id: _id, created_at: `${FECHA_HOY}T12:00:00-05:00`,
    fecha: FECHA_HOY, hora: '12:30', turno: 'almuerzo',
    pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '',
    metodo: 'efectivo', cantidad: 1,
    monto_unit: 15000, monto_almuerzo: 15000, monto_domicilio: 0, monto_total: 15000,
    monto_efectivo: 0, monto_transferencia: 0,
    estado: 'pagado', es_domicilio: false, mesa: null, para_llevar: false,
    es_fiar: false, es_sin_mesa: false, es_gratis: false, cliente_fiado_id: null,
    direccion: '', grupo_pedido: `g-${_id}`,
    descuento: 0, motivo_descuento: null,
    pagado_via_abono: false, fecha_pago: null, turno_pago: null,
  }, extra);
}

const pedidos = [
  // ── Pagados del almuerzo de hoy ────────────────────────────────────
  pedido({ id: 101, metodo: 'efectivo', monto_total: 15000 }),                       // efectivo 15.000
  pedido({ id: 102, metodo: 'transferencia', monto_unit: 16000, monto_almuerzo: 16000, monto_total: 16000 }), // transferencia 16.000
  pedido({ id: 103, metodo: 'dividido', monto_unit: 20000, monto_almuerzo: 20000, monto_total: 20000,
           monto_efectivo: 12000, monto_transferencia: 8000 }),                       // dividido: 12.000 efectivo + 8.000 transferencia
  pedido({ id: 104, metodo: 'efectivo', monto_almuerzo: 13000, monto_total: 13000,
           descuento: 2000, motivo_descuento: 'Cortesía (prueba)' }),                 // lista 15.000 − descuento 2.000 = 13.000 efectivo
  pedido({ id: 107, metodo: 'gratis', es_gratis: true, monto_almuerzo: 0, monto_total: 0 }), // gratis: no ingresa
  // ── Pagado de la noche de hoy ──────────────────────────────────────
  pedido({ id: 105, turno: 'cena', hora: '19:30', pedido: 'Hamburguesa', metodo: 'efectivo',
           monto_unit: 18000, monto_almuerzo: 18000, monto_total: 18000 }),          // efectivo 18.000
  // ── Fiado del cliente 2, ya saldado con abonos NUEVOS ──────────────
  pedido({ id: 106, fecha: '2026-10-12', hora: '13:00', es_fiar: true, cliente_fiado_id: 2,
           metodo: 'efectivo', pagado_via_abono: true, fecha_pago: '2026-10-18', turno_pago: 'almuerzo',
           created_at: '2026-10-12T13:00:00-05:00' }),                                 // vale 15.000, pero su plata entró con los abonos

  // ── Pendientes ─────────────────────────────────────────────────────
  pedido({ id: 201, fecha: '2026-10-10', hora: '13:00', estado: 'pendiente', es_fiar: true, cliente_fiado_id: 1,
           monto_almuerzo: 20000, monto_unit: 20000, monto_total: 20000, created_at: '2026-10-10T13:00:00-05:00' }), // fiado cliente 1: 20.000
  pedido({ id: 202, fecha: '2026-10-14', hora: '13:10', estado: 'pendiente', es_fiar: true, cliente_fiado_id: 1,
           created_at: '2026-10-14T13:10:00-05:00' }),                                 // fiado cliente 1: 15.000
  pedido({ id: 203, estado: 'pendiente', mesa: 3, hora: '12:40' }),                    // mesa 3, hoy
  pedido({ id: 204, fecha: '2026-10-19', hora: '13:20', estado: 'pendiente', es_domicilio: true,
           monto_domicilio: 3000, monto_total: 18000, direccion: 'Calle de prueba 1',
           created_at: '2026-10-19T13:20:00-05:00' }),                                 // domicilio de AYER sin cerrar
];

const clientes_fiado = [
  { id: 1, nombre: 'Cliente Uno (prueba)', created_at: '2026-10-01T10:00:00-05:00' },
  { id: 2, nombre: 'Cliente Dos (prueba)', created_at: '2026-10-01T10:05:00-05:00' },
];

// Abonos. "turno" nulo = abono VIEJO (anterior al cambio del 16-oct): no suma al cierre.
//   Cliente 1: 10.000 + 5.000 + 7.000 + 4.000 = 26.000   Cliente 2: 15.000
const abonos_fiado = [
  { id: 1, cliente_fiado_id: 1, monto: 10000, fecha: '2026-10-18', turno: 'almuerzo', cuenta: 'efectivo',        created_at: '2026-10-18T13:00:00-05:00' },
  { id: 2, cliente_fiado_id: 2, monto: 15000, fecha: '2026-10-18', turno: 'almuerzo', cuenta: 'efectivo',        created_at: '2026-10-18T13:05:00-05:00' },
  { id: 3, cliente_fiado_id: 1, monto: 5000,  fecha: '2026-10-19', turno: null,       cuenta: 'transf_almuerzos', created_at: '2026-10-19T13:00:00-05:00' },
  { id: 4, cliente_fiado_id: 1, monto: 7000,  fecha: '2026-10-20', turno: 'almuerzo', cuenta: 'efectivo',        created_at: '2026-10-20T13:00:00-05:00' },
  { id: 5, cliente_fiado_id: 1, monto: 4000,  fecha: '2026-10-20', turno: 'almuerzo', cuenta: 'transf_almuerzos', created_at: '2026-10-20T13:10:00-05:00' },
];

const aperturas_turno = [
  { id: 1, fecha: FECHA_HOY, turno: 'almuerzo', caja_inicial: 50000, venta_desayuno: 30000, venta_desayuno_transferencia: 10000,
    created_at: `${FECHA_HOY}T07:00:00-05:00` },
];

const cierres_dia = [
  // Cierre ANTIGUO: solo trae ajuste_manual.
  { id: 1, fecha: '2026-10-05', turno: 'almuerzo', efectivo: 400000, transferencia: 150000, gastos: 120000, resultado: 430000,
    ajuste_manual: 5000, manual: false, platos_familia: 3 },
  // Cierre NUEVO: ajustes separados y abonos de fiado dentro de efectivo/transferencia.
  { id: 2, fecha: '2026-10-18', turno: 'almuerzo', efectivo: 420000, transferencia: 160000, gastos: 90000, resultado: 490000,
    ajuste_efectivo: -3000, ajuste_transferencia: 2000, abonos_efectivo: 25000, abonos_transferencia: 0,
    manual: false, platos_familia: 2 },
];

const egresos = [
  { id: 1, fecha: '2026-10-19', cat: 'proveedor', monto: 120000, description: 'Compra de prueba', created_at: '2026-10-19T09:00:00-05:00' },
  { id: 2, fecha: '2026-10-15', cat: 'servicios', monto: 80000,  description: 'Servicio de prueba', created_at: '2026-10-15T09:00:00-05:00' },
];

const inventario = [
  { id: 1, nombre: 'Arroz (prueba)', unidad: 'kg', stock: 10, minimo: 5, costo: 4000 },
  { id: 2, nombre: 'Aceite (prueba)', unidad: 'lt', stock: 1, minimo: 3, costo: 9000 },
];

const gastos_dia = [
  { id: 1, fecha: '2026-10-18', turno: 'almuerzo', nombre: 'Hielo (prueba)', monto: 6000, categoria: 'otro' },
];

const mesas = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, numero: i + 1, estado: i + 1 === 3 ? 'ocupada' : 'libre' }));

const pedidos_eliminados = [
  { id: 1, created_at: '2026-10-17T20:00:00-05:00', fecha: '2026-10-17', turno: 'cena', pedido: 'Hamburguesa', monto_total: 18000, metodo: 'efectivo', motivo: 'Error de digitación (prueba)' },
];

const pedidos_descuentos = [
  { id: 1, created_at: `${FECHA_HOY}T12:31:00-05:00`, pedido_id: 104, fecha: FECHA_HOY, descuento: 2000, motivo: 'Cortesía (prueba)' },
];

module.exports = {
  FECHA_HOY,
  datos: {
    pedidos, egresos, inventario, consumos: [], gastos_dia, mesas, cierres_dia, aperturas_turno,
    notas_dia: [], movimientos_caja: [], ingresos_extra: [], pedidos_eliminados, clientes_fiado,
    abonos_fiado, pedidos_descuentos,
  },
};
