// Foto de las pantallas que muestran categorías de egresos y nombres de cuentas (listas de los formularios, tarjetas de Caja,
// tablas, sumas por casilla). Sirve para probar que SIN configuración guardada el sistema se ve y suma exactamente igual que
// antes de la etapa 4 (tests/fixtures/egresos-anterior.json es la foto sacada con el código de la etapa 2).
const { datos: DATOS_BASE, FECHA_HOY } = require('../fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
// Datos con una fila de cada categoría y de cada cuenta, para que todas las pantallas tengan algo que mostrar.
function datosParaFoto() {
  const d = copia(DATOS_BASE);
  const f = '2026-10-19';
  d.egresos = [
    ['nomina', 'efectivo', 300000], ['proveedor', 'efectivo', 120000], ['arriendo', 'transf_almuerzos', 900000], ['servicios', 'transf_rapidas', 80000],
    ['desechables', 'efectivo', 45000], ['otro', 'transf_almuerzos', 15000],
  ].map(([cat, cuenta, monto], i) => ({ id: i + 1, fecha: f, cat, cuenta, monto, description: `Egreso ${cat}`, turno: i % 2 ? 'cena' : null, created_at: `${f}T09:00:00-05:00` }));
  d.gastos_dia = [
    ['nomina', 70000], ['proveedor', 33000], ['desechables', 12000], ['otro', 6000], ['prestamo', 50000],
  ].map(([categoria, monto], i) => ({ id: i + 1, fecha: f, turno: 'almuerzo', nombre: `Gasto ${categoria}`, monto, categoria }));
  d.movimientos_caja = [
    { id: 1, fecha: f, tipo: 'gasto', cuenta: 'efectivo', cuenta_destino: null, monto: 20000, descripcion: 'Mercado' },
    { id: 2, fecha: f, tipo: 'aporte', cuenta: 'transf_almuerzos', cuenta_destino: null, monto: 500000, descripcion: 'Aporte' },
    { id: 3, fecha: f, tipo: 'traspaso', cuenta: 'transf_rapidas', cuenta_destino: 'efectivo', monto: 100000, descripcion: 'Retiro' },
  ];
  d.ingresos_extra = [
    { id: 1, fecha: f, monto: 40000, descripcion: 'Venta de canecas', cuenta: 'efectivo' },
    { id: 2, fecha: f, monto: 60000, descripcion: 'Evento', cuenta: 'transf_rapidas' },
  ];
  return d;
}

const CODIGOS = ['nomina', 'proveedor', 'arriendo', 'servicios', 'desechables', 'otro', 'prestamo', 'efectivo', 'transf_almuerzos', 'transf_rapidas'];

async function foto(page, irA) {
  const sacar = () => page.evaluate(codigos => {
    const norm = t => t.replace(/\s+/g, ' ').trim();
    const listas = {};
    document.querySelectorAll('select').forEach((s, i) => {
      const o = [...s.querySelectorAll('option')].map(x => `${x.value}|${x.textContent.trim()}${x.selected ? '|*' : ''}`);
      if (o.some(t => codigos.includes(t.split('|')[0]))) listas[`${(s.closest('section') || {}).id || '?'}#${s.id || 'sin-id-' + i}`] = o;
    });
    const textos = {};
    // El texto se toma sin las listas desplegables (esas ya van aparte, opción por opción): así no importa si sus opciones vienen
    // escritas en la página o las arma el sistema, ni los espacios que haya entre ellas.
    for (const id of ['tab-egresos', 'tab-caja', 'tab-ingfin', 'tab-diaadia', 'tab-dashboard']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const c = el.cloneNode(true);
      c.querySelectorAll('select, script, style').forEach(x => x.remove());
      textos[id] = norm(c.textContent);
    }
    const botones = {};
    document.querySelectorAll('#ingresoshist-filtros-cuenta button').forEach((b, i) => { botones[`${b.id || b.className}#${i}`] = norm(b.textContent); });
    return { listas, textos, botones };
  }, CODIGOS);
  const out = {};
  const ver = async (nombre, accion) => { if (accion) await page.evaluate(accion); out[nombre] = await sacar(); };
  for (const tab of ['egresos', 'caja', 'ingfin', 'diaadia']) await irA(page, tab).then(() => ver(tab));
  // filas en edición
  await page.evaluate(() => { showTab('egresos', document.querySelector('.tab[onclick*="showTab(\'egresos\'"]')); editarEgreso(1); });
  out.editar_egreso = await sacar();
  await page.evaluate(() => { cancelarEdicionEgreso(); showTab('caja', document.querySelector('.tab[onclick*="showTab(\'caja\'"]')); });
  const idsMov = await page.evaluate(() => (ST.movimientosCaja || []).map(m => m.id));
  if (idsMov.length) { await page.evaluate(id => editarMovimientoCaja(id), idsMov[idsMov.length - 1]); out.editar_movimiento = await sacar(); await page.evaluate(() => cancelarEdicionMovimientoCaja()); }
  // el cierre del día 19 (con gastos de todas las categorías) y un gasto en edición
  await page.evaluate(() => irADiaADia('2026-10-19', 'almuerzo'));
  out.cierre_dia_19 = await sacar();
  await page.evaluate(() => editarGastoDia(1));
  out.editar_gasto = await sacar();
  await page.evaluate(() => { cancelarEdicionGastoDia(); showTab('ingfin', document.querySelector('.tab[onclick*="showTab(\'ingfin\'"]')); editarIngresoExtra(1); });
  out.editar_ingreso_extra = await sacar();
  return out;
}
module.exports = { foto, datosParaFoto, FECHA_HOY };
