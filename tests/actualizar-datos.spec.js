// ↻ Botón «Actualizar» del encabezado (M4): vuelve a leer todo de la base SIN recargar la página.
// Se comprueba que: (1) lo que otro equipo registró aparece al pulsarlo; (2) la página NO se recarga (la sesión de administrador
// y lo escrito en un formulario se quedan); (3) si la lectura falla avisa y no dice «actualizado»; (4) no se puede pulsar dos veces seguidas.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { aceptarAvisos } = require('./helpers/ventanas');

const boton = page => page.locator('#btn-actualizar');

test('el botón está en el encabezado, visible', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await expect(boton(page)).toBeVisible();
  await expect(boton(page)).toContainText('Actualizar');
});

test('trae lo que otro equipo registró, sin recargar la página y sin cerrar la sesión', async ({ page }) => {
  aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin' });
  await page.evaluate(() => { window.__marca = 'sigo-aqui'; });
  const antes = await page.evaluate(() => (ST.ingresos.length + ST.pendientes.length));
  const nuevo = { ...reg.datos.pedidos[0], id: 'ped-otro-equipo', estado: 'pendiente', nombre_cliente: 'Cliente de otro equipo' };
  reg.datos.pedidos = [...reg.datos.pedidos, nuevo];
  await boton(page).click();
  await expect.poll(() => page.evaluate(() => (ST.ingresos.length + ST.pendientes.length))).toBe(antes + 1);
  expect(await page.evaluate(() => window.__marca)).toBe('sigo-aqui');            // la página no se recargó
  await expect(page.locator('#rolBadge')).toBeVisible();                           // sigue la sesión de administrador
  await expect(page.locator('.toast', { hasText: 'Datos actualizados' })).toBeVisible();
  await expect(boton(page)).toBeEnabled();
});

test('lo que se está escribiendo en un formulario no se pierde', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'prueba-escribiendo'; document.body.appendChild(i); i.value = 'a medias'; });
  await boton(page).click();
  await expect(page.locator('.toast', { hasText: 'Datos actualizados' })).toBeVisible();
  expect(await page.inputValue('#prueba-escribiendo')).toBe('a medias');
});

test('dos pulsaciones seguidas hacen una sola lectura', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  const n = await page.evaluate(async () => {
    let lecturas = 0; const orig = window.loadState;
    window.loadState = async () => { lecturas++; return orig(); };
    const a = actualizarDatos(); const b = actualizarDatos(); await Promise.all([a, b]);
    window.loadState = orig; return lecturas;
  });
  expect(n).toBe(1);
});

test('si la lectura falla, NO dice «Datos actualizados»', async ({ page }) => {
  aceptarAvisos(page);
  await abrirSistema(page, { usuario: 'admin' });
  await page.evaluate(() => { window.loadState = async () => false; });
  await boton(page).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.toast', { hasText: 'Datos actualizados' })).toHaveCount(0);
  await expect(boton(page)).toBeEnabled();
});
