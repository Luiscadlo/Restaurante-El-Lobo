// EXPORTAR A EXCEL con la librería de verdad (SheetJS «xlsx»), que ahora viaja DENTRO del sistema (Contabilidad/librerias/).
// Las demás pruebas cambian `XLSX` por un doble; aquí NO: se pulsa el botón, se baja el archivo y se abre con la misma librería.
//   · el archivo de la librería es EXACTAMENTE el paquete oficial xlsx@0.18.5 (huella fija) y trae su licencia;
//   · la página no carga ningún script de un sitio ajeno (ni jsDelivr ni ningún otro): solo el de la carpeta librerias/;
//   · con el botón baja un .xlsx de verdad, con todas las hojas que lee el modelo financiero y los datos adentro.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { abrirSistema, URL_HTML } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const RAIZ = path.resolve(__dirname, '..');
const LIB = path.join(RAIZ, 'Contabilidad', 'librerias', 'xlsx.full.min.js');
const SHA256_PAQUETE_OFICIAL = 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';   // xlsx@0.18.5/dist/xlsx.full.min.js (npm)
const HTML = fs.readFileSync(decodeURIComponent(new URL(URL_HTML).pathname), 'utf-8');
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

test.describe('la librería de Excel viaja dentro del sistema', () => {
  test('el archivo es exactamente el del paquete oficial xlsx@0.18.5 y trae su licencia', () => {
    const huella = crypto.createHash('sha256').update(fs.readFileSync(LIB)).digest('hex');
    expect(huella).toBe(SHA256_PAQUETE_OFICIAL);
    expect(fs.readFileSync(path.join(path.dirname(LIB), 'xlsx-LICENCIA.txt'), 'utf-8')).toContain('Apache License');
    const leeme = fs.readFileSync(path.join(path.dirname(LIB), 'LEEME.md'), 'utf-8');
    expect(leeme).toContain(SHA256_PAQUETE_OFICIAL);
    expect(leeme).toContain('0.18.5');
  });

  test('la página no carga ningún script de un sitio ajeno: solo el de la carpeta librerias/', () => {
    const scripts = [...HTML.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
    expect(scripts).toEqual(['librerias/xlsx.full.min.js']);
    expect(HTML).not.toMatch(/jsdelivr|unpkg|cdnjs|cdn\./i);
  });

  test('la página la encuentra: XLSX existe y es la 0.18.5', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    expect(await page.evaluate(() => [typeof XLSX, XLSX.version])).toEqual(['object', '0.18.5']);
  });
});

test.describe('el botón «Exportar datos a Excel» baja un .xlsx de verdad', () => {
  test('con datos: baja el archivo con todas las hojas y la información adentro', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: JSON.parse(JSON.stringify(DATOS_BASE)) });
    await irA(page, 'datos');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar datos a Excel/ }).click()]);
    expect(descarga.suggestedFilename()).toMatch(/^ElLobo_datos_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const XLSX = require(LIB);
    const libro = XLSX.read(fs.readFileSync(await descarga.path()));
    const hojas = libro.SheetNames;
    for (const h of ['Pedidos_Pagados', 'Pedidos_Pendientes', 'Egresos', 'Gastos_Cierre', 'Categorias_Egresos', 'Nombres_Cuentas', 'Menu_Platos',
                     'Cierres_Dia', 'Aperturas_Turno', 'Movimientos_Caja', 'Ingresos_Extra', 'Inventario', 'Consumos', 'Notas_Dia', 'Pedidos_Eliminados', 'Info_Exportacion']) {
      expect(hojas, `falta la hoja ${h}`).toContain(h);
    }
    const filas = nombre => XLSX.utils.sheet_to_json(libro.Sheets[nombre]);
    expect(filas('Pedidos_Pagados').length).toBeGreaterThan(0);
    expect(filas('Cierres_Dia').length).toBe(DATOS_BASE.cierres_dia.length);
    expect(filas('Menu_Platos').length).toBeGreaterThanOrEqual(47);                                // los 47 platos de El Lobo
    expect(Object.keys(filas('Cierres_Dia')[0])).toContain('platos_familia');                      // la columna que el modelo espera, aunque venga vacía
    expect(filas('Info_Exportacion').map(f => f.dato)).toEqual(expect.arrayContaining(['Exportado el', 'Período desde', 'Período hasta']));
    await expect(page.locator('.toast').filter({ hasText: 'Excel exportado' })).toHaveCount(1);
    expect(reg.errores).toEqual([]);
  });

  test('si la librería no cargara, el botón no se rompe: avisa con un mensaje claro', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await irA(page, 'datos');
    await page.evaluate(() => { window.XLSX = undefined; });
    await page.getByRole('button', { name: /Exportar datos a Excel/ }).click();
    await expect(page.locator('.toast').filter({ hasText: 'No se pudo cargar la librería de Excel' })).toHaveCount(1);
  });
});
