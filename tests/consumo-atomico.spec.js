// M8: «Registrar consumo» hace dos escrituras (el consumo y el nuevo stock). Nunca debe quedar el stock bajo sin un consumo que lo explique.
// También: el «Ingreso adicional» nace con la fecha del día de trabajo (antes quedaba vacía).
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');

const esc = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
async function registrar(page) {
  await page.evaluate(async () => {
    document.getElementById('venta-producto').value = String(ST.inventario[0].id);
    document.getElementById('venta-cantidad').value = '1';
    document.getElementById('venta-fecha').value = today();
    window.__stock0 = ST.inventario[0].stock;
    await registrarVenta();
  });
}
const stockEnPantalla = page => page.evaluate(() => ST.inventario[0].stock);

test('camino feliz: primero el stock, después el consumo', async ({ page }) => {
  const reg = await abrirSistema(page);
  await registrar(page);
  const i = reg.escrituras.findIndex(e => e.metodo === 'PATCH' && e.tabla === 'inventario');
  const j = reg.escrituras.findIndex(e => e.metodo === 'POST' && e.tabla === 'consumos');
  expect(i).toBeGreaterThanOrEqual(0);
  expect(i).toBeLessThan(j);
  expect(await stockEnPantalla(page)).toBe(await page.evaluate(() => window.__stock0) - 1);
});

test('no se pudo bajar el stock: no se guarda ningún consumo', async ({ page }) => {
  const reg = await abrirSistema(page);
  reg.control.fallasEscritura.push({ tabla: 'inventario', metodo: 'PATCH', tipo: 'servidor' });
  await registrar(page);
  expect(esc(reg, 'POST', 'consumos')).toHaveLength(0);
  expect(await stockEnPantalla(page)).toBe(await page.evaluate(() => window.__stock0));
});

test('el stock bajó pero el consumo no se guardó: el stock vuelve a lo que era (sin borrar nada)', async ({ page }) => {
  const reg = await abrirSistema(page);
  reg.control.fallasEscritura.push({ tabla: 'consumos', metodo: 'POST', tipo: 'servidor' });
  await registrar(page);
  const stock0 = await page.evaluate(() => window.__stock0);
  expect(esc(reg, 'PATCH', 'inventario').map(e => e.cuerpo.stock)).toEqual([stock0 - 1, stock0]);
  expect(esc(reg, 'DELETE', 'consumos')).toHaveLength(0);
  expect(await stockEnPantalla(page)).toBe(stock0);
  expect(await page.evaluate(() => ST.consumos.length)).toBe(0);
});

test('no se guardó el consumo Y el stock no se pudo devolver: ventana clara', async ({ page }) => {
  const reg = await abrirSistema(page);
  reg.control.fallasEscritura.push({ tabla: 'consumos', metodo: 'POST', tipo: 'servidor' });
  reg.control.fallasEscritura.push({ tabla: 'inventario', metodo: 'PATCH', tipo: 'servidor', saltar: 1 });
  await registrar(page);
  await expect(page.locator('#modal-sistema')).toBeVisible();
  await expect(page.locator('#sis-titulo')).toContainText('Revisa el stock');
});

test('el ingreso adicional nace con la fecha del día de trabajo', async ({ page }) => {
  await abrirSistema(page);
  expect(await page.inputValue('#ingext-fecha')).toBe(await page.evaluate(() => today()));
});
