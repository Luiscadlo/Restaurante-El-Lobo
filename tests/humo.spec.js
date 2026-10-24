// Prueba de humo: el sistema abre, carga las tablas esperadas y NINGUNA pestaña lanza errores.
// Todo con datos ficticios y un backend falso (nada sale a internet ni toca tu Supabase).
const { test, expect } = require('@playwright/test');
const { abrirSistema, TABLAS_LOADSTATE, TABLAS_CAJA } = require('./helpers/backend-falso');
const { entrarComoAdmin } = require('./helpers/sesion');

const PESTANAS = ['ingresos', 'pendientes', 'fiados', 'diaadia', 'inventario', 'menu',
                  'dashboard', 'ingfin', 'egresos', 'caja', 'auditoria', 'datos'];
// Pestañas con candado → prefijo de su par "{prefijo}-login" / "{prefijo}-contenido".
const CON_CANDADO = { dashboard: 'tablero', ingfin: 'ingfin', egresos: 'egresos',
                      caja: 'caja', auditoria: 'auditoria', datos: 'datos' };

async function irA(page, id) {
  await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
}

test('como caja: pide solo las 12 tablas operativas (nada de finanzas ni auditoría)', async ({ page }) => {
  const reg = await abrirSistema(page);   // por defecto: sesión de caja
  expect(reg.errores).toEqual([]);
  expect([...new Set(reg.peticiones)].sort()).toEqual([...TABLAS_CAJA].sort());
  expect(reg.noManejadas).toEqual([]);   // nada fuera de /rest/v1/ y /auth/v1/ de Supabase
  expect(reg.avisos).toEqual([]);        // todas las tablas tienen datos de ejemplo
  expect(reg.escrituras).toEqual([]);    // abrir el sistema no escribe nada
  expect(reg.denegadas).toEqual([]);     // y no intenta nada que caja no pueda
});

test('como admin: pide las 16 tablas completas de loadState', async ({ page }) => {
  const reg = await abrirSistema(page, { usuario: 'admin' });
  expect(reg.errores).toEqual([]);
  expect([...new Set(reg.peticiones)].sort()).toEqual([...TABLAS_LOADSTATE].sort());
  expect(reg.noManejadas).toEqual([]);
  expect(reg.avisos).toEqual([]);
  expect(reg.escrituras).toEqual([]);
  expect(reg.denegadas).toEqual([]);
});

test('las 12 pestañas existen', async ({ page }) => {
  await abrirSistema(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.tab')].map(t => (t.getAttribute('onclick') || '').match(/showTab\('([^']+)'/)?.[1]).filter(Boolean));
  expect(ids).toEqual(PESTANAS);
});

test('sin sesión: cada pestaña abre sin errores y las de candado muestran su login', async ({ page }) => {
  const reg = await abrirSistema(page);
  for (const id of PESTANAS) {
    await irA(page, id);
    expect(reg.errores, `errores al abrir "${id}"`).toEqual([]);
    const prefijo = CON_CANDADO[id];
    if (prefijo) {
      await expect(page.locator(`#${prefijo}-login`), `login visible en "${id}"`).toBeVisible();
      await expect(page.locator(`#${prefijo}-contenido`), `contenido oculto en "${id}"`).toBeHidden();
    }
  }
  expect(reg.escrituras).toEqual([]);
});

test('con sesión de admin: las de candado dibujan su contenido, sin errores', async ({ page }) => {
  const reg = await abrirSistema(page);
  await entrarComoAdmin(page);
  for (const [id, prefijo] of Object.entries(CON_CANDADO)) {
    await irA(page, id);
    expect(reg.errores, `errores al abrir "${id}" como admin`).toEqual([]);
    await expect(page.locator(`#${prefijo}-login`)).toBeHidden();
    await expect(page.locator(`#${prefijo}-contenido`)).toBeVisible();
    const texto = (await page.locator(`#${prefijo}-contenido`).innerText()).trim();
    expect(texto.length, `"${id}" quedó vacía`).toBeGreaterThan(20);
  }
  expect(reg.escrituras).toEqual([]);
});

test('con datos de ejemplo se ven los datos en Fiados y Pendientes', async ({ page }) => {
  const reg = await abrirSistema(page);
  await irA(page, 'fiados');
  const fiados = await page.locator('#tab-fiados').innerText();
  expect(fiados).toContain('Cliente Uno (prueba)');
  await irA(page, 'pendientes');
  expect(reg.errores).toEqual([]);
  const pend = await page.locator('#tab-pendientes').innerText();
  expect(pend.length).toBeGreaterThan(20);
});

test('la fecha de las pruebas está fija en el martes 2026-10-20', async ({ page }) => {
  await abrirSistema(page);
  expect(await page.evaluate(() => today())).toBe('2026-10-20');
});
