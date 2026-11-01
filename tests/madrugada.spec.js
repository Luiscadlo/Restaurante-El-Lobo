// REVISIÓN FINAL — arreglo B: «hoy» entre las 00:00 y las 8:59.
//
// La base cuenta el día por el DÍA DE NEGOCIO (cambia a las 9:00 a. m.): la cena que pasa de medianoche sigue siendo del día en que
// empezó. Pero varias pantallas usaban el día del CALENDARIO: a las 00:30 la cena abierta aparecía «de ayer» en Pendientes, la lista
// «Pedidos de hoy» salía vacía, el formulario de pedidos nacía con la fecha del día nuevo, «Abrir turno» abría el día nuevo...
//
// La regla es POR TURNO (no cambiar todo a «día de negocio»): la cena que se trabaja ahora es del día de negocio; el almuerzo es
// siempre del día del calendario (abrirlo a las 8:30 a. m. no puede quedar con la fecha de ayer: pisaría la apertura de ayer).
//
// Relojes (hora de Bogotá): 00:30 del 21-oct (día de negocio 20-oct) · 08:30 del 21-oct · 09:00 del 21-oct · 14:00 del 20-oct (normal).
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const A_LAS_00_30 = new Date('2026-10-21T00:30:00-05:00');
const A_LAS_08_30 = new Date('2026-10-21T08:30:00-05:00');
const A_LAS_09_00 = new Date('2026-10-21T09:00:00-05:00');
const UN_MINUTO_DESPUES_DE_MEDIANOCHE_DEL_MES = new Date('2026-11-01T00:30:00-05:00');

const copia = x => JSON.parse(JSON.stringify(x));
function datosConCenaAbierta() {
  const datos = copia(DATOS_BASE);
  datos.aperturas_turno = [...datos.aperturas_turno, { id: 91, fecha: FECHA_HOY, turno: 'cena', caja_inicial: 50000, venta_desayuno: 0 }];
  return datos;
}
const valor = (page, id) => page.evaluate(i => document.getElementById(i).value, id);
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

test.describe('a las 00:30 (la cena sigue abierta)', () => {
  test('el formulario de pedidos nace como CENA del día de negocio (20-oct), no del día nuevo', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    expect(await page.evaluate(() => turnoManual)).toBe('cena');
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-20');
  });

  test('cambiar el turno cambia la fecha por defecto: almuerzo = hoy del calendario (21), cena = día de negocio (20)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await page.evaluate(() => seleccionarTurnoManual('almuerzo'));
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-21');
    await page.evaluate(() => seleccionarTurnoManual('cena'));
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-20');
  });

  test('una fecha escogida a mano (otro día) NO se pisa al cambiar de turno', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await page.evaluate(() => { document.getElementById('ing-fecha').value = '2026-10-12'; seleccionarTurnoManual('almuerzo'); });
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-12');
  });

  test('«Pedidos de hoy» muestra lo del día de negocio (antes salía vacío porque buscaba el 21)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await irA(page, 'ingresos');
    const filas = await page.locator('#ingresos-body tr').count();
    expect(filas).toBeGreaterThan(0);
    await expect(page.locator('#ingresos-body')).toContainText('Hamburguesa');        // la cena del 20-oct
  });

  test('esHoy(): a las 00:30 son «de hoy» el 20 (cena abierta) y el 21 (lo ya registrado del día nuevo), no el 19', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    expect(await page.evaluate(() => [esHoy('2026-10-20'), esHoy('2026-10-21'), esHoy('2026-10-19'), esHoy('2026-10-22')])).toEqual([true, true, false, false]);
  });

  test('un pendiente de la cena (23:50 del 20-oct) NO sale «de ayer» en rojo: sale con el tiempo abierto, bien contado (40 min)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    const chip = await page.evaluate(() => chipPendienteHTML([{ fecha: '2026-10-20', hora: '23:50' }]));
    expect(chip).toContain('data-antiguedad="hoy"');
    expect(chip).toContain('40 min');
    expect(chip).not.toContain('de ayer');
  });

  test('un pendiente de verdad viejo (19-oct) sigue saliendo «de ayer»/en rojo', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    const chip = await page.evaluate(() => chipPendienteHTML([{ fecha: '2026-10-19', hora: '20:00' }]));
    expect(chip).toContain('data-antiguedad="vieja"');
    expect(chip).toContain('de ayer');
  });

  test('un fiado del 20-oct tiene 0 días de antigüedad (no 1)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    expect(await page.evaluate(() => antiguedadDias('2026-10-20'))).toBe(0);
  });

  test('«Abrir turno» de la CENA a las 00:30 abre el 20-oct (no el 21) y no toca otras aperturas', async ({ page }) => {
    const reg = await abrirSistema(page, { fecha: A_LAS_00_30 });
    await page.evaluate(() => { aperturaTurnoSel = 'cena'; document.getElementById('apertura-caja-inicial').value = '40.000'; return guardarAperturaTurno(); });
    const posts = reg.escrituras.filter(e => e.tabla === 'aperturas_turno' && e.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo).toMatchObject({ fecha: '2026-10-20', turno: 'cena', caja_inicial: 40000 });
    expect(reg.escrituras.filter(e => e.tabla === 'aperturas_turno' && e.metodo === 'PATCH')).toHaveLength(0);
    expect(reg.denegadas).toEqual([]);
  });

  test('con la cena ya abierta: el botón del encabezado dice «Turno abierto» y se puede registrar un pedido que queda en el 20-oct, cena', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConCenaAbierta(), fecha: A_LAS_00_30 });
    await expect(page.locator('#btn-abrir-turno-header')).toContainText('Turno abierto');
    await page.evaluate(() => {
      selectedUbicacion = 'sinmesa';
      document.getElementById('ing-hora').value = '00:20';
      almuerzosEnCola = [{ pedido: 'Hamburguesa', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 18000, monto_almuerzo: 18000, para_llevar: false }];
      return agregarIngreso('pagado');
    });
    const posts = reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo).toMatchObject({ fecha: '2026-10-20', turno: 'cena', estado: 'pagado' });
    expect(reg.denegadas).toEqual([]);
    await irA(page, 'ingresos');
    expect(await page.locator('#ingresos-body tr').count()).toBeGreaterThan(0);
  });

  test('Cierre: al elegir la CENA la fecha pasa al 20-oct; al volver al almuerzo, al 21; una fecha a mano no se toca', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', fecha: A_LAS_00_30 });
    await irA(page, 'diaadia');
    await page.evaluate(() => setDDTurno('cena', document.getElementById('dd-btn-cena')));
    expect(await valor(page, 'dd-fecha')).toBe('2026-10-20');
    await page.evaluate(() => setDDTurno('almuerzo', document.getElementById('dd-btn-almuerzo')));
    expect(await valor(page, 'dd-fecha')).toBe('2026-10-21');
    await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-05'; setDDTurno('cena', document.getElementById('dd-btn-cena')); });
    expect(await valor(page, 'dd-fecha')).toBe('2026-10-05');
  });

  test('una nota escrita a las 00:30 queda en la jornada de la cena (20-oct) y se ve en la lista y en el contador', async ({ page }) => {
    const reg = await abrirSistema(page, { fecha: A_LAS_00_30 });
    await page.evaluate(() => { document.getElementById('nota-nueva-texto').value = 'Se acabó el aceite'; return agregarNotaDia(); });
    const posts = reg.escrituras.filter(e => e.tabla === 'notas_dia' && e.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo).toMatchObject({ fecha: '2026-10-20', texto: 'Se acabó el aceite' });
    await expect(page.locator('#notas-lista')).toContainText('Se acabó el aceite');
    await expect(page.locator('#notas-badge')).toHaveText('1');
  });
});

test.describe('a las 08:30 (antes de que cambie el día de negocio)', () => {
  test('«Abrir turno» del ALMUERZO abre el 21-oct (hoy del calendario): no pisa la apertura de ayer', async ({ page }) => {
    const reg = await abrirSistema(page, { fecha: A_LAS_08_30 });
    await page.evaluate(() => { aperturaTurnoSel = 'almuerzo'; document.getElementById('apertura-caja-inicial').value = '60.000'; return guardarAperturaTurno(); });
    expect(reg.escrituras.filter(e => e.tabla === 'aperturas_turno' && e.metodo === 'PATCH')).toHaveLength(0);       // la del 20-oct intacta
    const posts = reg.escrituras.filter(e => e.tabla === 'aperturas_turno' && e.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].cuerpo).toMatchObject({ fecha: '2026-10-21', turno: 'almuerzo', caja_inicial: 60000 });
    expect(reg.denegadas).toEqual([]);
  });

  test('un pedido de almuerzo del 21-oct registrado a las 8:30 aparece en «Pedidos de hoy» junto a lo del 20-oct', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_08_30, datos: (() => { const d = copia(DATOS_BASE); d.aperturas_turno.push({ id: 92, fecha: '2026-10-21', turno: 'almuerzo', caja_inicial: 60000, venta_desayuno: 0 }); return d; })() });
    await page.evaluate(() => seleccionarTurnoManual('almuerzo'));
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-21');
    await page.evaluate(() => {
      selectedUbicacion = 'sinmesa';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: 'madrugador', cantidad: 1, monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false }];
      return agregarIngreso('pagado');
    });
    await irA(page, 'ingresos');
    await expect(page.locator('#ingresos-body')).toContainText('madrugador');         // lo nuevo NO desaparece
    await expect(page.locator('#ingresos-body')).toContainText('Hamburguesa');        // y la cena de ayer sigue a la vista
  });
});

test.describe('desde las 9:00 y de día (sin cambios)', () => {
  test('a las 9:00 «hoy» es solo el 21-oct y el formulario nace como almuerzo del 21', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_00 });
    expect(await page.evaluate(() => [esHoy('2026-10-20'), esHoy('2026-10-21')])).toEqual([false, true]);
    expect(await page.evaluate(() => turnoManual)).toBe('almuerzo');
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-21');
  });

  test('a las 14:00 todo igual que siempre: fecha del día, esHoy solo hoy, antigüedad por días del calendario', async ({ page }) => {
    await abrirSistema(page);
    expect(await valor(page, 'ing-fecha')).toBe(FECHA_HOY);
    expect(await page.evaluate(() => [esHoy('2026-10-19'), esHoy('2026-10-20'), esHoy('2026-10-21')])).toEqual([false, true, false]);
    expect(await page.evaluate(() => antiguedadDias('2026-10-19'))).toBe(1);
    expect(await page.evaluate(() => chipPendienteHTML([{ fecha: '2026-10-20', hora: '13:00' }]))).toContain('1 h');
  });

  test('la cena de la noche (21:00) nace del día en curso', async ({ page }) => {
    await abrirSistema(page, { fecha: new Date('2026-10-20T21:00:00-05:00') });
    expect(await page.evaluate(() => turnoManual)).toBe('cena');
    expect(await valor(page, 'ing-fecha')).toBe('2026-10-20');
  });
});

test.describe('cambio de mes de madrugada', () => {
  test('a las 00:30 del 1-nov «el mes» y «la semana» siguen siendo los del día de negocio (31-oct); a las 9:00 ya cambia', async ({ page }) => {
    await abrirSistema(page, { fecha: UN_MINUTO_DESPUES_DE_MEDIANOCHE_DEL_MES });
    expect(await page.evaluate(() => monthStart())).toBe('2026-10-01');
    expect(await page.evaluate(() => inP('2026-10-31', 'mes'))).toBe(true);
    expect(await page.evaluate(() => esDeMesAnterior('2026-10-31'))).toBe(false);       // un fiado de la cena del 31 no es «mes anterior» a las 00:30 del 1
  });

  test('a las 9:00 del 1-nov el mes ya es noviembre', async ({ page }) => {
    await abrirSistema(page, { fecha: new Date('2026-11-01T09:00:00-05:00') });
    expect(await page.evaluate(() => monthStart())).toBe('2026-11-01');
    expect(await page.evaluate(() => esDeMesAnterior('2026-10-31'))).toBe(true);
  });
});
