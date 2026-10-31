// ⚙️ CONFIGURACIÓN → «Cierre del día» → ¿se piden las «comidas de la familia» al cerrar el almuerzo? (etapa 5).
// Todo contra el backend falso (que imita sql/configuracion_etapa_5.sql: la clave cierre_comidas_familia solo acepta verdadero o
// falso): nada toca tu Supabase real. Se comprueba, desde la pantalla, que:
//   · SIN nada guardado todo sigue como siempre: el cierre del almuerzo pide la cantidad (obligatoria) y el historial muestra «Familia»;
//   · guardar «No» (solo administrador, con confirmación, UNA fila nueva) hace que el campo desaparezca del cierre normal y del manual
//     y que el historial deje de mostrar la columna — al instante, sin recargar;
//   · apagada, se puede cerrar el almuerzo sin escribir la cantidad (queda NULL = «no registrado») y corregir un cierre que ya traía
//     el dato NO lo borra: se conserva tal cual (lo guardado nunca se toca);
//   · caja (que cierra el turno) también ve el efecto; encenderla otra vez lo devuelve todo;
//   · las reglas de la pantalla, del servidor falso y de la base real dan el mismo veredicto y el mismo mensaje (casos compartidos).
const { test, expect } = require('@playwright/test');
const { abrirSistema, validarConfiguracion, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const CASOS = require('./fixtures/casos-familia.json').casos;

const K = 'cierre_comidas_familia';
const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const escrituras = (reg, tabla, metodo) => reg.escrituras.filter(e => e.tabla === tabla && (!metodo || e.metodo === metodo));
const fila = (id, valor, desde = '2026-10-10T10:00:00-05:00') => ({ id, clave: K, valor, vigente_desde: desde, creado_por: 'luis', creado_en: desde });
const datosCon = (valor, extra = {}) => { const d = copia(DATOS_BASE); d.configuracion = valor === undefined ? [] : [fila(1, valor)]; return Object.assign(d, extra); };
const toasts = page => page.locator('.toast');

async function abrir(page, opciones = {}) {
  const nativos = aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  return { reg, nativos };
}
const campoCierre = page => page.locator('#dd-platos-familia-wrap');
const campoManual = page => page.locator('#cm-platos-familia-wrap');
const verHistorialCompleto = page => page.evaluate(() => { fDD = 'todo'; renderHistorialCierres(); });
const cierreConFamilia = { id: 92, fecha: '2026-10-14', turno: 'almuerzo', efectivo: 60000, transferencia: 0, gastos: 0, resultado: 60000, manual: false, platos_familia: 2 };
const abrirManual = async page => { await page.evaluate(() => abrirModalCierreManual()); await expect(page.locator('#cierremanual-contenido')).toBeVisible(); };

test.describe('las reglas dicen lo mismo en la pantalla, el servidor falso y la base (casos compartidos)', () => {
  for (const caso of CASOS) {
    test(caso.id, async ({ page }) => {
      await abrir(page, { datos: datosCon(undefined) });
      const pantalla = await page.evaluate(([clave, valor]) => cfgValidar(clave, valor), [caso.clave, caso.valor]);
      expect(pantalla).toBe(caso.mensaje);
      const servidor = validarConfiguracion(caso.clave, caso.valor);
      expect(servidor ? servidor.message : null).toBe(caso.mensaje);
    });
  }
});

test.describe('sin nada guardado: como siempre', () => {
  test('el cierre del almuerzo pide la cantidad (obligatoria) y el historial muestra «Familia»', async ({ page }) => {
    await abrir(page, { datos: datosCon(undefined) });
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeVisible();
    await expect(page.locator('#dd-platos-familia-req')).toBeVisible();
    await expect(page.locator('#dd-th-familia')).toBeVisible();
    expect(await page.evaluate(() => pedirComidasFamilia())).toBe(true);
    await abrirManual(page);
    await expect(campoManual(page)).toBeVisible();
  });

  test('en Configuración se ve «Sí» y que es el valor de siempre', async ({ page }) => {
    await abrir(page, { datos: datosCon(undefined) });
    await irA(page, 'config');
    await expect(page.locator('#cfg-cierre_comidas_familia')).toHaveValue('true');
    await expect(page.locator('#cfg-hoy-cierre_comidas_familia')).toContainText('Hoy: Sí');
    await expect(page.locator('#cfg-hoy-cierre_comidas_familia')).toContainText('el valor de siempre');
    await expect(page.locator('#cfg-guardar-cierre_comidas_familia')).toBeDisabled();           // nada que guardar todavía
  });

  test('sin guardar la cantidad el almuerzo no se cierra (como siempre)', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(undefined) });
    await irA(page, 'diaadia');
    await page.evaluate(async () => { document.getElementById('dd-fecha').value = today(); document.getElementById('dd-platos-familia').value = ''; await guardarCierre(); });
    expect(escrituras(reg, 'cierres_dia', 'POST')).toHaveLength(0);
    await expect(toasts(page).filter({ hasText: 'Escribe cuántos almuerzos comió la familia' })).toHaveCount(1);
  });
});

test.describe('guardar «No» desde Configuración', () => {
  test('pide confirmación, manda UNA fila nueva y la pantalla cambia al instante', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(undefined) });
    await page.evaluate(() => { window.__noAceptarAvisos = true; });                            // la confirmación la contesta esta prueba
    await irA(page, 'config');
    await page.locator('#cfg-cierre_comidas_familia').selectOption('false');
    await expect(page.locator('#cfg-guardar-cierre_comidas_familia')).toBeEnabled();
    await page.click('#cfg-guardar-cierre_comidas_familia');
    await expect(page.locator('#sis-cuerpo')).toContainText('Comidas de la familia al cerrar el almuerzo');
    await expect(page.locator('#sis-cuerpo')).toContainText('Hoy: Sí  →  Nuevo: No');
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);                          // todavía no se guardó
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'Guardado: Comidas de la familia al cerrar el almuerzo = No' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(1);
    expect(escrituras(reg, 'configuracion', 'POST')[0].cuerpo).toEqual({ clave: K, valor: false });
    await expect(page.locator('#cfg-hoy-cierre_comidas_familia')).toContainText('Hoy: No');
    // el cierre normal, el manual y el historial ya no lo muestran
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeHidden();
    await expect(page.locator('#dd-th-familia')).toBeHidden();
    await abrirManual(page);
    await expect(campoManual(page)).toBeHidden();
  });

  test('«Volver» en la confirmación no guarda nada', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(undefined) });
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await irA(page, 'config');
    await page.locator('#cfg-cierre_comidas_familia').selectOption('false');
    await page.click('#cfg-guardar-cierre_comidas_familia');
    await page.click('#sis-opciones button[data-eleccion="no"]');
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeVisible();
  });

  test('el cambio queda en el historial de Configuración, con quién y cuándo', async ({ page }) => {
    await abrir(page, { datos: datosCon(false) });
    await irA(page, 'config');
    const hist = page.locator('#config-historial');
    await expect(hist).toContainText('Comidas de la familia al cerrar el almuerzo');
    await expect(hist.locator('tbody tr').first()).toContainText('No');
    await expect(hist.locator('tbody tr').first()).toContainText('luis');
  });

  test('solo el administrador cambia la opción: caja no ve los ajustes de Configuración', async ({ page }) => {
    await abrir(page, { usuario: 'caja', datos: datosCon(undefined) });
    await irA(page, 'config');
    await expect(page.locator('#config-contenido')).toBeHidden();
    await expect(page.locator('#config-login')).toBeVisible();
  });
});

test.describe('con la opción apagada', () => {
  test('se puede cerrar el almuerzo sin escribir la cantidad: queda NULL («no registrado»)', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(false) });
    await irA(page, 'diaadia');
    await page.evaluate(async () => { document.getElementById('dd-fecha').value = today(); await guardarCierre(); });
    expect(escrituras(reg, 'cierres_dia', 'POST')).toHaveLength(1);
    expect(escrituras(reg, 'cierres_dia', 'POST')[0].cuerpo.platos_familia).toBeNull();
    await expect(toasts(page).filter({ hasText: 'Escribe cuántos almuerzos' })).toHaveCount(0);
  });

  test('aunque el campo tenga algo escrito de antes, no se guarda (la opción manda)', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(false) });
    await irA(page, 'diaadia');
    await page.evaluate(async () => { document.getElementById('dd-fecha').value = today(); document.getElementById('dd-platos-familia').value = '7'; await guardarCierre(); });
    expect(escrituras(reg, 'cierres_dia', 'POST')[0].cuerpo.platos_familia).toBeNull();
  });

  test('corregir un cierre que ya traía la cantidad la CONSERVA (nada de lo guardado se borra)', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(false, { cierres_dia: [...DATOS_BASE.cierres_dia, cierreConFamilia] }) });
    await page.evaluate(() => { abrirCorreccionCierre('2026-10-14', 'almuerzo'); });
    await page.evaluate(async () => { await guardarCierre(); });
    const cambios = [...escrituras(reg, 'cierres_dia', 'PATCH'), ...escrituras(reg, 'cierres_dia', 'POST')];
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cuerpo.platos_familia).toBe(2);
    expect(await page.evaluate(() => ST.cierresDia.find(c => c.fecha === '2026-10-14' && c.turno === 'almuerzo').platos_familia)).toBe(2);
  });

  test('un cierre MANUAL nuevo de almuerzo se guarda sin la cantidad (NULL)', async ({ page }) => {
    const { reg } = await abrir(page, { datos: datosCon(false) });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-08'; cambioFechaTurnoCierreManual(); });
    await page.locator('#cm-efectivo').fill('50000');
    await page.locator('#cm-transferencia').fill('10000');
    await page.evaluate(() => guardarCierreManual());
    await page.waitForFunction(() => document.getElementById('modal-cierre-manual').style.display === 'none');
    const subidas = escrituras(reg, 'cierres_dia', 'POST');
    expect(subidas).toHaveLength(1);
    expect(subidas[0].cuerpo).toMatchObject({ fecha: '2026-10-08', turno: 'almuerzo', manual: true, platos_familia: null });
  });

  test('corregir un cierre MANUAL que ya traía la cantidad la conserva', async ({ page }) => {
    const d = datosCon(false);
    d.cierres_dia.push({ id: 90, fecha: '2026-10-17', turno: 'almuerzo', efectivo: 80000, transferencia: 20000, gastos: 0, resultado: 100000, manual: true, platos_familia: 3 });
    const { reg } = await abrir(page, { datos: d });
    await page.evaluate(() => editarCierreManual('2026-10-17', 'almuerzo'));
    await expect(page.locator('#cierremanual-contenido')).toBeVisible();
    await page.evaluate(() => guardarCierreManual());
    await page.waitForFunction(() => document.getElementById('modal-cierre-manual').style.display === 'none');
    const cambios = [...escrituras(reg, 'cierres_dia', 'PATCH'), ...escrituras(reg, 'cierres_dia', 'POST')];
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cuerpo.platos_familia).toBe(3);
  });

  test('el historial del cierre no muestra la columna «Familia» (ni la celda de cada fila), pero el dato sigue guardado', async ({ page }) => {
    await abrir(page, { datos: datosCon(false, { cierres_dia: [...DATOS_BASE.cierres_dia, cierreConFamilia] }) });
    await irA(page, 'diaadia');
    await verHistorialCompleto(page);
    const columnas = await page.locator('#dd-historial-body tr').first().locator('td').count();
    const cabeceras = await page.locator('#dd-th-familia').locator('xpath=ancestor::tr[1]/th').evaluateAll(t => t.filter(x => getComputedStyle(x).display !== 'none').length);
    expect(columnas).toBe(cabeceras);                                                          // cada columna visible tiene su cabecera
    await expect(page.locator('#dd-th-familia')).toBeHidden();
    expect(await page.evaluate(() => ST.cierresDia.some(c => c.platos_familia === 2))).toBe(true);
  });

  test('caja (quien cierra el turno) también deja de ver el campo', async ({ page }) => {
    await abrir(page, { usuario: 'caja', datos: datosCon(false) });
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeHidden();
  });

  test('el consumo «Gratis» de comidas rápidas no cambia: la opción es solo del almuerzo', async ({ page }) => {
    await abrir(page, { datos: datosCon(false) });
    await irA(page, 'diaadia');
    await page.evaluate(() => { ddTurno = 'cena'; renderAll(); });
    await expect(page.locator('#dd-gratis-info')).toBeVisible();
  });
});

test.describe('volver a encenderla', () => {
  test('el campo y la columna reaparecen (la última versión guardada manda)', async ({ page }) => {
    const d = datosCon(false, { cierres_dia: [...DATOS_BASE.cierres_dia, cierreConFamilia] });
    d.configuracion.push(fila(2, true, '2026-10-12T10:00:00-05:00'));
    await abrir(page, { datos: d });
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeVisible();
    await expect(page.locator('#dd-th-familia')).toBeVisible();
    await verHistorialCompleto(page);
    const celdas = await page.locator('#dd-historial-body tr', { hasText: '2026-10-14' }).first().locator('td').allInnerTexts();
    expect(celdas.map(x => x.trim())).toContain('2');                                            // la cantidad que se guardó vuelve a verse
  });

  test('un valor guardado que no sirve se ignora y rige el de siempre (sí)', async ({ page }) => {
    const d = datosCon('no');                                                                    // el servidor real nunca lo dejaría guardar; si llegara, no estorba
    await abrir(page, { datos: d });
    await irA(page, 'diaadia');
    await expect(campoCierre(page)).toBeVisible();
  });

  test('al encenderla, un cierre hecho mientras estaba apagada (sin dato) se corrige sin obligar a poner la cantidad', async ({ page }) => {
    const d = datosCon(true);
    d.cierres_dia.push({ id: 91, fecha: '2026-10-16', turno: 'almuerzo', efectivo: 50000, transferencia: 0, gastos: 0, resultado: 50000, manual: false, platos_familia: null });
    await abrir(page, { datos: d });
    expect(await page.evaluate(() => platosFamiliaObligatorio(ST.cierresDia.find(c => c.id === 91)))).toBe(false);
  });
});
