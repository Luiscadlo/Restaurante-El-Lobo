// AJUSTES DEL SÁBADO 31-OCT (antes de subir todo junto a producción):
//   1. Egresos → ✕ de un gasto del turno: ahora pregunta «¿Quitar este gasto?» y, al aceptar, la fila desaparece al
//      instante (antes parecía no pasar nada hasta cambiar de pestaña, porque solo se redibujaba Cierre).
//   2. Cierre manual: muestra, igual que el cierre normal, Total del turno, Utilidad del turno y Caja esperada en efectivo.
//   3. Tablero: recuadro «Resumen por día» — 5 días a la vista, barra de desplazamiento para ver más, solo lectura.
//
// Datos de ejemplo (FECHA_HOY = 2026-10-20): gas 20.000 (proveedor) y un préstamo de 10.000 ya registrados en el almuerzo de
// hoy; apertura con caja inicial 50.000; el sistema suma 77.000 de efectivo y 38.000 de transferencia.
// Fixture base: cierre 05-oct (400.000 ef + 150.000 tr + ajuste 5.000), cierre 18-oct (420.000 + 160.000, ajustes −3.000 y
// +2.000, de los cuales 25.000 son abonos de fiado), gasto del turno 18-oct 6.000, egresos manuales 19-oct 120.000 y 15-oct 80.000.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const VENTANA = '#modal-sistema';
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const copia = x => JSON.parse(JSON.stringify(x));

function datosHoy() {
  const d = copia(DATOS_BASE);
  d.gastos_dia.push({ id: 50, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Gas (inicio del turno)', monto: 20000, categoria: 'proveedor' });
  d.gastos_dia.push({ id: 51, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Préstamo devuelto', monto: 10000, categoria: 'prestamo' });
  return d;
}

// ───────────────────────────── 1. Egresos ✕ ─────────────────────────────
test.describe('Egresos: quitar un gasto del turno con la ✕', () => {
  const filaGas = page => page.locator('#egresos-body tr', { hasText: 'Gas (inicio del turno)' });

  test('pide confirmación y, al aceptar, la fila desaparece al instante (sin cambiar de pestaña)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await irA(page, 'egresos');
    await expect(filaGas(page)).toHaveCount(1);
    const totalAntes = await page.locator('#egr-total-periodo').innerText();

    await filaGas(page).locator('button.btn-danger').click();
    await expect(page.locator(VENTANA)).toBeVisible();
    await expect(page.locator('#sis-titulo')).toHaveText('¿Quitar este gasto?');
    await expect(page.locator('#sis-cuerpo')).toContainText('Gas (inicio del turno)');
    await expect(page.locator('#sis-cuerpo')).toContainText('$20.000');
    await expect(filaGas(page)).toHaveCount(1);                                    // todavía no se ha quitado nada
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);

    await page.locator(`${VENTANA} button[data-eleccion="si"]`).click();
    await expect(filaGas(page)).toHaveCount(0);                                    // desaparece sin tocar otra pestaña
    await expect(page.locator(VENTANA)).toBeHidden();
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'gastos_dia')[0].consulta).toContain('id=eq.50');
    expect(await page.locator('#egr-total-periodo').innerText()).not.toBe(totalAntes);   // el total de Egresos también baja
    await expect(page.locator('.toast').filter({ hasText: 'Gasto quitado' }).first()).toBeVisible();
  });

  test('«Volver» no borra nada y la fila sigue ahí', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await irA(page, 'egresos');
    await filaGas(page).locator('button.btn-danger').click();
    await page.locator(`${VENTANA} button[data-eleccion="no"]`).click();
    await expect(page.locator(VENTANA)).toBeHidden();
    await expect(filaGas(page)).toHaveCount(1);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
  });

  test('desde la pestaña Cierre también pregunta antes de quitar', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await irA(page, 'diaadia');
    const fila = page.locator('#dd-gastos-body tr', { hasText: 'Gas (inicio del turno)' });
    await expect(fila).toHaveCount(1);
    await fila.locator('button.btn-danger').click();
    await expect(page.locator('#sis-titulo')).toHaveText('¿Quitar este gasto?');
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);
    await page.locator(`${VENTANA} button[data-eleccion="si"]`).click();
    await expect(fila).toHaveCount(0);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(1);
  });

  test('un gasto de un turno ya cerrado: la fila se va y el cierre baja sus «gastos» en lo mismo', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await irA(page, 'egresos');
    await page.locator('#tab-egresos .filter-btn[data-periodo="todo"]').first().click();      // el filtro de Egresos arranca en «Hoy»
    await page.locator('#egresos-body tr', { hasText: 'Hielo (prueba)' }).locator('button.btn-danger').click();
    await page.locator(`${VENTANA} button[data-eleccion="si"]`).click();
    await expect(page.locator('#egresos-body tr', { hasText: 'Hielo (prueba)' })).toHaveCount(0);
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'cierres_dia')[0].cuerpo).toEqual({ gastos: 84000, resultado: 496000 });
  });
});

// ───────────────────────────── 2. Cierre manual: resumen ─────────────────────────────
test.describe('cierre manual: muestra total, utilidad y caja esperada como el cierre normal', () => {
  const abrirManual = async page => {
    await page.evaluate(() => abrirModalCierreManual());
    await expect(page.locator('#cierremanual-contenido')).toBeVisible();
  };
  const t = (page, id) => page.locator('#' + id).innerText();

  test('con lo que el sistema ya sabe: total 115.000, utilidad 95.000 (el préstamo no cuenta) y caja 97.000', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await abrirManual(page);
    expect(await t(page, 'cm-total-turno')).toBe('$115.000');
    expect(await t(page, 'cm-resultado')).toBe('$95.000');                         // 115.000 − 20.000 de gas (el préstamo no es gasto)
    expect(await t(page, 'cm-caja-esperada')).toBe('$97.000');                     // 50.000 + 77.000 − 30.000 (el préstamo sí sale de la caja)
    expect(await t(page, 'cm-caja-detalle')).toBe('Caja inicial $50.000 + efectivo $77.000 − gastos $30.000');
  });

  test('se recalcula al escribir efectivo y transferencia, y al agregar o quitar gastos', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('100000');
    await page.locator('#cm-transferencia').fill('40000');
    expect(await t(page, 'cm-total-turno')).toBe('$140.000');
    expect(await t(page, 'cm-resultado')).toBe('$120.000');
    expect(await t(page, 'cm-caja-esperada')).toBe('$120.000');                    // 50.000 + 100.000 − 30.000
    // Un gasto nuevo (en cola) baja utilidad y caja
    await page.locator('#cm-gasto-monto').fill('15000');
    await page.evaluate(() => agregarGastoCierreManual());
    expect(await t(page, 'cm-resultado')).toBe('$105.000');
    expect(await t(page, 'cm-caja-esperada')).toBe('$105.000');
    // Quitar el gas que ya estaba registrado (todavía sin guardar) los vuelve a subir
    await page.evaluate(() => { const g = gastosRegistradosCierreManual().find(x => x.id === 50); quitarGastoRegistradoCierreManual(g.id); });
    expect(await t(page, 'cm-resultado')).toBe('$125.000');
    expect(await t(page, 'cm-caja-esperada')).toBe('$125.000');
  });

  test('un turno sin apertura cuenta la caja inicial como 0 y lo dice; utilidad negativa en rojo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-08'; cambioFechaTurnoCierreManual(); });
    await page.locator('#cm-efectivo').fill('0');
    await page.locator('#cm-transferencia').fill('0');
    await page.locator('#cm-gasto-monto').fill('9000');
    await page.evaluate(() => agregarGastoCierreManual());
    expect(await t(page, 'cm-total-turno')).toBe('$0');
    expect(await t(page, 'cm-resultado')).toBe('$9.000');                          // fmt() muestra el valor absoluto…
    expect(await page.locator('#cm-resultado').evaluate(e => e.style.color)).toBe('var(--red)');   // …y el rojo avisa que es negativo
    expect(await t(page, 'cm-caja-detalle')).toBe('Caja inicial $0 (sin abrir turno) + efectivo $0 − gastos $9.000');
  });
});

// ───────────────────────────── 3. Tablero: Resumen por día ─────────────────────────────
test.describe('Tablero: recuadro «Resumen por día»', () => {
  const filas = page => page.locator('#resumen-dias-body tr');
  const celdas = async (page, fecha) => (await page.locator(`#resumen-dias-body tr[data-fecha="${fecha}"] td`).allInnerTexts()).map(x => x.trim());
  const verTablero = async page => irA(page, 'dashboard');

  test('una línea por día, del más reciente al más antiguo: pedidos, abonos, egresos del turno, manuales y resultado', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await verTablero(page);
    await expect(filas(page)).toHaveCount(6);
    expect(await page.locator('#resumen-dias-body tr').evaluateAll(r => r.map(x => x.dataset.fecha)))
      .toEqual(['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-15', '2026-10-12', '2026-10-05']);
    // 18-oct: 420.000+160.000 −3.000+2.000 = 579.000, de los cuales 25.000 son abonos → pedidos 554.000; gasto del turno 6.000
    expect(await celdas(page, '2026-10-18')).toEqual(['Dom 18/10', '554.000', '25.000', '6.000', '–', '573.000']);
    // 05-oct: cierre antiguo con ajuste_manual 5.000 → 555.000 y sin egresos
    expect(await celdas(page, '2026-10-05')).toEqual(['Lun 05/10', '555.000', '–', '–', '–', '555.000']);
    // 19-oct: solo un egreso manual de 120.000 (resultado negativo con signo)
    expect(await celdas(page, '2026-10-19')).toEqual(['Lun 19/10', '–', '–', '–', '120.000', '−120.000']);
    // hoy: el gas de 20.000 cuenta; el préstamo de 10.000 no es egreso
    expect(await celdas(page, '2026-10-20')).toEqual(['Mar 20/10', '–', '–', '20.000', '–', '−20.000']);
  });

  test('los días con ventas sin cerrar se marcan en naranja; los cerrados no', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await verTablero(page);
    const marcados = await page.locator('#resumen-dias-body tr.rd-sin-cerrar').evaluateAll(r => r.map(x => x.dataset.fecha));
    expect(marcados.sort()).toEqual(['2026-10-12', '2026-10-20']);
  });

  test('solo se ven 5 días; los demás se alcanzan con la barra de desplazamiento y la página no crece', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await verTablero(page);
    const caja = page.locator('#resumen-dias-scroll');
    const m = await caja.evaluate(e => {
      const r = e.getBoundingClientRect(), cab = e.querySelector('thead').getBoundingClientRect();
      const visibles = [...e.querySelectorAll('tbody tr')].filter(f => { const b = f.getBoundingClientRect(); return b.top >= cab.bottom - 1 && b.bottom <= r.bottom + 1; }).length;
      return { alto: r.height, contenido: e.scrollHeight, visibles, overflowY: getComputedStyle(e).overflowY };
    });
    expect(m.visibles).toBe(5);
    expect(m.contenido).toBeGreaterThan(m.alto);                                   // hay más para desplazar
    expect(['auto', 'scroll']).toContain(m.overflowY);
    // al bajar, el sexto día (el más antiguo) queda a la vista
    await caja.evaluate(e => { e.scrollTop = e.scrollHeight; });
    const ultimo = await page.locator('#resumen-dias-body tr').last().evaluate(f => { const c = f.closest('#resumen-dias-scroll').getBoundingClientRect(), b = f.getBoundingClientRect(); return b.bottom <= c.bottom + 1 && b.top >= c.top; });
    expect(ultimo).toBe(true);
  });

  test('con muchos días (70) el recuadro mide lo mismo y muestra solo los últimos 60', async ({ page }) => {
    const d = datosHoy();
    const base = new Date('2026-08-01T12:00:00Z');
    for (let i = 0; i < 70; i++) {
      const f = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
      d.cierres_dia.push({ id: 100 + i, fecha: f, turno: 'almuerzo', efectivo: 100000 + i, transferencia: 0, gastos: 0, resultado: 100000 + i, manual: false });
    }
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await verTablero(page);
    await expect(filas(page)).toHaveCount(60);
    const alto = await page.locator('#resumen-dias-scroll').evaluate(e => e.getBoundingClientRect().height);
    expect(alto).toBeLessThan(260);                                                // 5 filas + cabecera, nunca la lista completa
    // el más reciente va arriba
    expect(await filas(page).first().getAttribute('data-fecha')).toBe('2026-10-20');
  });

  test('es solo lectura: sin campos ni botones, y no depende del rango de fechas del Tablero', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await verTablero(page);
    expect(await page.locator('#resumen-dias-caja input, #resumen-dias-caja button, #resumen-dias-caja select, #resumen-dias-caja a').count()).toBe(0);
    expect(await page.locator('#resumen-dias-caja [onclick]').count()).toBe(0);
    const antes = await filas(page).count();
    await page.locator('#tab-dashboard .filter-btn', { hasText: 'Hoy' }).first().click();
    await expect(filas(page)).toHaveCount(antes);                                  // «Hoy» no recorta el recuadro
    await page.locator('#tab-dashboard .filter-btn', { hasText: 'Esta semana' }).click();
    await expect(filas(page)).toHaveCount(antes);
  });

  test('se actualiza solo al quitar un gasto (sin recargar ni cambiar de pestaña)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await verTablero(page);
    expect((await celdas(page, '2026-10-20'))[3]).toBe('20.000');
    await page.evaluate(() => { const p = eliminarGastoDia(50); window.__p = p; });
    await page.locator(`${VENTANA} button[data-eleccion="si"]`).click();
    await page.evaluate(() => window.__p);
    expect((await celdas(page, '2026-10-20'))[3]).toBe('–');
  });

  test('un cierre manual con abonos separa pedidos de abonos', async ({ page }) => {
    const d = datosHoy();
    d.cierres_dia.push({ id: 300, fecha: '2026-10-17', turno: 'almuerzo', efectivo: 90000, transferencia: 30000, gastos: 10000, resultado: 110000,
      abonos_efectivo: 20000, abonos_transferencia: 5000, manual: true });
    d.gastos_dia.push({ id: 70, fecha: '2026-10-17', turno: 'almuerzo', nombre: 'Verduras', monto: 10000, categoria: 'proveedor' });
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await verTablero(page);
    expect(await celdas(page, '2026-10-17')).toEqual(['Sáb 17/10', '95.000', '25.000', '10.000', '–', '110.000']);
  });
});

test.describe('Tablero: Resumen por día en el celular', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('a 360 px cabe en una línea por día, sin barra horizontal ni cifras partidas', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosHoy() });
    await irA(page, 'dashboard');
    const m = await page.locator('#resumen-dias-scroll').evaluate(e => ({ ancho: e.clientWidth, contenido: e.scrollWidth, fila: e.querySelector('tbody tr').getBoundingClientRect().height }));
    expect(m.contenido).toBeLessThanOrEqual(m.ancho + 1);
    expect(m.fila).toBeLessThanOrEqual(36);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
