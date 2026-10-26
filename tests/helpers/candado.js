// CANDADO DE DÍAS — la copia en JS que hace cumplir el Supabase falso de las pruebas de pantalla.
//
// El candado de verdad es sql/candado_dias.sql (lo exige la base de datos). Esta es la MISMA regla escrita en
// JavaScript para que las pruebas de pantalla (Playwright) vean lo que vería el sistema real: si un flujo del
// mostrador intenta cambiar algo de un día cerrado, el servidor falso lo rechaza igual que Postgres.
//
// No se confía en que las dos copias coincidan «a ojo»: los MISMOS casos (tests/fixtures/candado_casos.json) se corren
// contra el SQL en un Postgres de verdad (tests/python/test_candado_dias.py) y contra esta copia
// (tests/candado-reglas.spec.js). El texto del mensaje se lee del propio SQL.
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.resolve(__dirname, '../../sql/candado_dias.sql'), 'utf8');
const MENSAJE = SQL.match(/message = format\('([^']+)', to_char\(dia/)[1];     // «… del %s: pídele …»
const PISTA = SQL.match(/hint = '([^']+)'/)[1];
const DETALLE = SQL.match(/detail = '([^']+)'/)[1];                            // «candado_dias»

const TABLAS_SIMPLES = ['cierres_dia', 'gastos_dia', 'aperturas_turno', 'notas_dia', 'abonos_fiado', 'consumos'];
const TABLAS_CON_CANDADO = [...TABLAS_SIMPLES, 'pedidos'];

// Día de negocio: hora de Bogotá (UTC−5, sin horario de verano) menos 9 horas. «ahora» es un Date.
function diaNegocio(ahora) {
  return new Date(ahora.getTime() - (5 + 9) * 3600 * 1000).toISOString().slice(0, 10);
}

const distinto = (a, b) => (a ?? null) !== (b ?? null);
const antes_de = (fecha, dia) => fecha != null && fecha < dia;      // «null < dia» no es verdadero (como en SQL)

function rechazo(fecha) {
  const [a, m, d] = fecha.split('-');
  return {
    code: '42501',
    message: MENSAJE.replace('%s', `${d}/${m}/${a}`),
    details: DETALLE,
    hint: PISTA,
  };
}

/**
 * ¿Rechaza el candado esta escritura?  Devuelve null (se permite) o { code, message, details, hint } como el error del servidor.
 * @param rol      'caja' | 'admin' | … (solo caja tiene candado)
 * @param tabla    nombre de la tabla
 * @param op       'I' crear · 'U' cambiar · 'D' borrar
 * @param antes    la fila como está guardada (U y D)
 * @param despues  la fila como quedaría (I y U)
 * @param pedidos  todos los pedidos existentes (para «agregar producto» a un pendiente)
 * @param ahora    Date
 */
function evaluarCandado({ rol, tabla, op, antes, despues, pedidos = [], ahora }) {
  if (rol !== 'caja' || !TABLAS_CON_CANDADO.includes(tabla)) return null;
  const dia = diaNegocio(ahora);

  if (tabla !== 'pedidos') {
    const pasadas = [op !== 'I' ? antes.fecha : null, op !== 'D' ? despues.fecha : null].filter(f => antes_de(f, dia));
    return pasadas.length ? rechazo(pasadas.sort()[0]) : null;
  }

  const contable = p => p.fecha_pago ?? p.fecha;                     // fecha contable de un pedido cobrado
  if (op === 'I') {
    if (despues.estado === 'pagado' && antes_de(contable(despues), dia)) return rechazo(contable(despues));
    const esProductoAgregado = pedidos.some(p => p.estado === 'pendiente' && p.fecha === despues.fecha &&
      p.grupo_pedido != null && p.grupo_pedido === despues.grupo_pedido);
    if (antes_de(despues.fecha, dia) && !esProductoAgregado) return rechazo(despues.fecha);
    return null;
  }
  if (op === 'D') {
    if (antes.estado === 'pagado' && antes_de(contable(antes), dia)) return rechazo(contable(antes));
    return null;
  }
  // U
  if (antes.estado === 'pagado' && antes_de(contable(antes), dia)) return rechazo(contable(antes));
  if (distinto(despues.fecha, antes.fecha) && antes_de(despues.fecha, dia) && distinto(despues.fecha, antes.fecha_original)) return rechazo(despues.fecha);
  if (distinto(despues.fecha_pago, antes.fecha_pago) && antes_de(despues.fecha_pago, dia)) return rechazo(despues.fecha_pago);
  return null;
}

module.exports = { evaluarCandado, diaNegocio, TABLAS_CON_CANDADO, TABLAS_SIMPLES };
