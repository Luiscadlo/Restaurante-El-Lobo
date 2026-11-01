// REVISIÓN FINAL — arreglo C: «carga parcial silenciosa».
//
// Antes, si una tabla opcional (cierres, abonos de fiado, notas, configuración...) fallaba al cargar por mala señal o por un
// error del servidor, el sistema seguía como si esa tabla estuviera VACÍA y la insignia decía «Sincronizado». Ahora:
//   · una tabla que NO EXISTE en esa base (404 «relation does not exist») se sigue tolerando, como siempre;
//   · cualquier otra falla se avisa con un banner rojo + botón «Reintentar» + insignia «Carga incompleta»;
//   · mientras falte una tabla que un cierre necesita, no se deja guardar el cierre (los totales saldrían mal).
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');

const banner = page => page.locator('#aviso-carga');
const insignia = page => page.locator('#syncBadge');
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

test.describe('carga incompleta: se avisa, no se disimula', () => {
  test('con todo bien: sin banner y la insignia dice «Sincronizado»', async ({ page }) => {
    await abrirSistema(page);
    await expect(banner(page)).toBeHidden();
    await expect(insignia(page)).toContainText('Sincronizado');
  });

  test('una tabla que falla con error del servidor: banner rojo con su nombre, insignia «Carga incompleta»', async ({ page }) => {
    await abrirSistema(page, { tablasConFalla: { abonos_fiado: 'servidor' } });
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('abonos de fiado');
    await expect(banner(page)).toContainText('Reintentar');
    await expect(insignia(page)).toContainText('Carga incompleta');
    await expect(insignia(page)).not.toContainText('Sincronizado');
  });

  test('una tabla que se queda sin señal también se avisa (y se nombran todas las que fallaron)', async ({ page }) => {
    await abrirSistema(page, { tablasConFalla: { notas_dia: 'red', clientes_fiado: 'red' } });
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('notas del día');
    await expect(banner(page)).toContainText('clientes de fiado');
  });

  test('una tabla que NO existe en esa base (404) no es una falla: sigue como siempre, sin banner', async ({ page }) => {
    await abrirSistema(page, { tablasFaltantes: ['config'] });
    await expect(banner(page)).toBeHidden();
    await expect(insignia(page)).toContainText('Sincronizado');
  });

  test('las tablas del administrador también avisan', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', tablasConFalla: { pedidos_eliminados: 'servidor' } });
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('auditoría de eliminados');
  });

  test('«Reintentar» vuelve a leer: si ya responde, el banner desaparece y la insignia vuelve a «Sincronizado»', async ({ page }) => {
    const reg = await abrirSistema(page, { tablasConFalla: { abonos_fiado: 'servidor' } });
    await expect(banner(page)).toBeVisible();
    reg.control.tablasConFalla = {};                       // se arregló la señal
    await page.click('#aviso-carga-reintentar');
    await expect(banner(page)).toBeHidden();
    await expect(insignia(page)).toContainText('Sincronizado');
  });

  test('«Reintentar» con la falla todavía presente: el banner sigue', async ({ page }) => {
    await abrirSistema(page, { tablasConFalla: { abonos_fiado: 'red' } });
    await page.click('#aviso-carga-reintentar');
    await expect(banner(page)).toBeVisible();
    await expect(insignia(page)).toContainText('Carga incompleta');
  });

  test('guardar o registrar algo NO devuelve la insignia a «Sincronizado» mientras falte una tabla', async ({ page }) => {
    await abrirSistema(page, { tablasConFalla: { cierres_dia: 'servidor' } });
    await page.evaluate(() => setSyncBadge('ok'));
    await expect(insignia(page)).toContainText('Carga incompleta');
  });

  test('no deja guardar el cierre del día con datos incompletos: avisa y no escribe nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', tablasConFalla: { abonos_fiado: 'servidor' } });
    await irA(page, 'diaadia').catch(() => {});
    await page.evaluate(() => guardarCierre());
    await expect(page.locator('.toast').filter({ hasText: 'No se puede guardar el cierre' })).toBeVisible();
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia')).toEqual([]);
  });

  test('no deja guardar el cierre manual con datos incompletos', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', tablasConFalla: { aperturas_turno: 'servidor' } });
    await page.evaluate(() => guardarCierreManual());
    await expect(page.locator('.toast').filter({ hasText: 'No se puede guardar el cierre' })).toBeVisible();
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia')).toEqual([]);
  });

  test('una tabla que no es crítica para cerrar (p. ej. las notas) avisa pero NO bloquea el cierre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', tablasConFalla: { notas_dia: 'servidor' } });
    await expect(banner(page)).toBeVisible();
    expect(await page.evaluate(() => cargaCompletaParaCerrar())).toBe(true);
  });

  test('si el servidor vuelve, un cierre ya se puede guardar', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', tablasConFalla: { abonos_fiado: 'servidor' } });
    expect(await page.evaluate(() => cargaCompletaParaCerrar())).toBe(false);
    reg.control.tablasConFalla = {};
    await page.click('#aviso-carga-reintentar');
    await expect(banner(page)).toBeHidden();
    expect(await page.evaluate(() => cargaCompletaParaCerrar())).toBe(true);
  });
});
