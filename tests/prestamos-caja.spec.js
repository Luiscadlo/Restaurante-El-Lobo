// REVISIÓN FINAL — decisión del dueño (1-nov-2026): los PRÉSTAMOS NO se restan de la «Caja acumulada».
//
// Un préstamo es plata que alguien pone en la caja durante el turno para dar vueltos y que se le devuelve al final del turno:
// no es un gasto del negocio ni un ingreso. Por eso:
//   · en el cierre del turno SÍ se descuenta de la «caja esperada en efectivo» (la plata física que sale del cajón al devolverla);
//   · pero NO entra en los gastos del cierre, ni en la utilidad, ni en Egresos, ni en la «Caja acumulada» de la pestaña Caja.
// Esta prueba deja la regla escrita: un préstamo registrado en el turno no mueve la Caja acumulada; un gasto real sí.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

function datos({ conPrestamo }) {
  const d = copia(BASE);
  d.cierres_dia = [];                 // la Caja acumulada sale solo del cierre que se va a guardar
  d.gastos_dia = [{ id: 50, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Gas (prueba)', monto: 20000, categoria: 'proveedor' }];
  if (conPrestamo) d.gastos_dia.push({ id: 51, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Préstamo devuelto (prueba)', monto: 10000, categoria: 'prestamo' });
  return d;
}

async function cerrarAlmuerzoDeHoy(page) {
  await irA(page, 'diaadia');
  await page.evaluate(async () => {
    document.getElementById('dd-fecha').value = today();
    document.getElementById('dd-platos-familia').value = '0';
    await guardarCierre();
  });
}

test.beforeEach(async ({ page }) => { aceptarAvisos(page); });

test.describe('préstamos: no restan de la Caja acumulada', () => {
  test('el cierre guarda solo los gastos reales (20.000), sin el préstamo (10.000)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datos({ conPrestamo: true }) });
    await cerrarAlmuerzoDeHoy(page);
    const cierres = reg.escrituras.filter(e => e.metodo === 'POST' && e.tabla === 'cierres_dia');
    expect(cierres).toHaveLength(1);
    expect(cierres[0].cuerpo.gastos).toBe(20000);
  });

  test('la Caja acumulada es igual con o sin el préstamo registrado en el turno', async ({ page, context }) => {
    const sin = await abrirSistema(page, { datos: datos({ conPrestamo: false }) });
    await cerrarAlmuerzoDeHoy(page);
    const acumuladoSin = await page.evaluate(() => calcularAcumuladosCaja('todo'));
    const cierreSin = sin.escrituras.find(e => e.metodo === 'POST' && e.tabla === 'cierres_dia').cuerpo;

    const page2 = await context.newPage();
    aceptarAvisos(page2);
    const con = await abrirSistema(page2, { datos: datos({ conPrestamo: true }) });
    await cerrarAlmuerzoDeHoy(page2);
    const acumuladoCon = await page2.evaluate(() => calcularAcumuladosCaja('todo'));
    const cierreCon = con.escrituras.find(e => e.metodo === 'POST' && e.tabla === 'cierres_dia').cuerpo;

    expect(cierreCon.gastos).toBe(cierreSin.gastos);
    expect(acumuladoCon.efectivo).toBe(acumuladoSin.efectivo);
    expect(acumuladoCon.disponible).toBe(acumuladoSin.disponible);
    // y el efectivo acumulado es exactamente: efectivo del turno − gastos REALES
    expect(acumuladoCon.efectivo).toBe(cierreCon.efectivo - 20000);
  });

  test('un gasto real de 10.000 SÍ baja la Caja acumulada (para que la prueba anterior no sea vacía)', async ({ page }) => {
    const d = datos({ conPrestamo: false });
    d.gastos_dia.push({ id: 52, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Servilletas (prueba)', monto: 10000, categoria: 'desechables' });
    const reg = await abrirSistema(page, { datos: d });
    await cerrarAlmuerzoDeHoy(page);
    const cierre = reg.escrituras.find(e => e.metodo === 'POST' && e.tabla === 'cierres_dia').cuerpo;
    expect(cierre.gastos).toBe(30000);
    expect((await page.evaluate(() => calcularAcumuladosCaja('todo'))).efectivo).toBe(cierre.efectivo - 30000);
  });

  test('en el cierre, la «caja esperada» sí descuenta el préstamo (la plata sale del cajón al devolverla)', async ({ page }) => {
    await abrirSistema(page, { datos: datos({ conPrestamo: true }) });
    await irA(page, 'diaadia');
    const r = await page.evaluate(() => { document.getElementById('dd-fecha').value = today(); onFechaCierreChange(); return calcularGastosTurno(today(), 'almuerzo'); });
    expect(r.reales).toBe(20000);
    expect(r.conPrestamos).toBe(30000);
  });
});
