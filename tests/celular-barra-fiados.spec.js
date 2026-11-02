// Celular (390 px): la barra de secciones queda fija arriba al bajar, las tarjetas de Fiados se ven completas
// (sin recortar el total) y la página no se puede ampliar con zoom.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

test.use({ viewport: { width: 390, height: 844 } });
const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

function datosFiadoGrande() {
  const d = copia(BASE);
  d.pedidos = [{ ...copia(BASE.pedidos[0]), id: 900, fecha: '2026-09-01', estado: 'pendiente', metodo: 'fiado', es_fiar: true,
    cliente_fiado_id: 7, monto_total: 2200000, monto_unit: 2200000, monto_almuerzo: 2200000, grupo_pedido: 'g-grande' }];
  d.abonos_fiado = []; d.cierres_dia = [];
  d.clientes_fiado = [{ id: 7, nombre: 'Adriana con un nombre bastante largo', created_at: '2026-08-01T10:00:00-05:00' }];
  return d;
}

test('la barra de secciones queda fija arriba al bajar, y el encabezado se va', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await page.evaluate(() => { const s = document.createElement('div'); s.style.height = '4000px'; document.body.appendChild(s); window.scrollTo(0, 1500); });
  await page.waitForTimeout(150);
  const nav = await page.locator('nav').boundingBox();
  expect(Math.round(nav.y)).toBe(0);
  const header = await page.locator('header').boundingBox();
  expect(header.y + header.height).toBeLessThanOrEqual(0);
});

test('Fiados: el total de cada tarjeta queda dentro de la tarjeta, sin recortarse', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin', datos: datosFiadoGrande() });
  await irA(page, 'fiados');
  const r = await page.evaluate(() => {
    const g = document.querySelector('#fiados-clientes-zone .pending-group');
    const caja = g.getBoundingClientRect();
    const t = g.querySelector('.pending-group-total').getBoundingClientRect();
    const chip = g.querySelector('.pending-group-der > :first-child').getBoundingClientRect();
    return { gDer: caja.right, tDer: t.right, tIzq: t.left, cDer: chip.right, ancho: window.innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(r.tDer).toBeLessThanOrEqual(r.gDer);
  expect(r.tIzq).toBeGreaterThanOrEqual(0);
  expect(r.cDer).toBeLessThanOrEqual(r.gDer);
  expect(r.scroll).toBeLessThanOrEqual(r.ancho);
});

test('sin zoom: la página lo prohíbe y los campos no provocan zoom al tocarlos', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('user-scalable=no');
  expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).toBe('manipulation');
  const tam = await page.locator('#ing-fecha').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(tam).toBeGreaterThanOrEqual(16);
  const impedido = await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; });
  expect(impedido).toBe(true);
});
