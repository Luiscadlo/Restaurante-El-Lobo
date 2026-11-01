// Celular (390 px): el botón «Incluir "gratis"» del Tablero no se pega a la tarjeta de Ingresos; el botón ↻ Actualizar cabe en el
// encabezado sin salirse de la pantalla; cada lista de Auditoría vive en su propio recuadro de altura limitada con desplazamiento.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { aceptarAvisos } = require('./helpers/ventanas');

test.use({ viewport: { width: 390, height: 844 } });
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

test('encabezado: el botón Actualizar cabe y no provoca desplazamiento horizontal', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  const caja = await page.locator('#btn-actualizar').boundingBox();
  expect(caja.x).toBeGreaterThanOrEqual(0);
  expect(caja.x + caja.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Tablero: hay aire entre «Incluir gratis» y las tarjetas', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await irA(page, 'dashboard');
  const boton = await page.locator('#btn-toggle-gratis-tablero').boundingBox();
  const tarjeta = await page.locator('#kpi-ingresos').locator('xpath=ancestor::div[contains(@class,"kpi-card")]').boundingBox();
  expect(tarjeta.y - (boton.y + boton.height)).toBeGreaterThanOrEqual(12);
});

test('Auditoría: las tres listas tienen recuadro de altura limitada y encabezado fijo', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await irA(page, 'auditoria');
  for (const id of ['auditoria-body', 'auditoria-eliminados-body', 'auditoria-descuentos-body']) {
    const info = await page.locator(`#${id}`).evaluate(el => {
      const caja = el.closest('.aud-scroll');
      const th = caja && caja.querySelector('thead th');
      return caja && { max: getComputedStyle(caja).maxHeight, overflowY: getComputedStyle(caja).overflowY, pos: getComputedStyle(th).position };
    });
    expect(info).toEqual({ max: '330px', overflowY: 'auto', pos: 'sticky' });
  }
});
