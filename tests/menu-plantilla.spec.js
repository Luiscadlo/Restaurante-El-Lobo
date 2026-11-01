// La IMAGEN PUBLICITARIA del Menú (la plantilla JPEG que el generador usa de fondo) trae los precios dibujados adentro.
// Desde el 1-nov-2026 dice «Porción Sopa: $6.000» (antes $7.000, un error: el sistema siempre cobró $6.000; «+1.000 para llevar»
// no cambió). Estas pruebas generan un menú de verdad y comparan, píxel a píxel, la zona de los precios contra una foto de
// referencia sacada del mismo navegador: si alguien cambia la plantilla (o el precio vuelve a ser otro) la prueba falla.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const URL_MENU = 'file://' + path.join(__dirname, '..', 'Menu', 'Menú diario-El Lobo.html');
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', f)).toString('base64');

async function generar(page) {
  await page.goto(URL_MENU, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof generarMenu === 'function' && !!document.getElementById('sopas_0') && !!document.getElementById('proteinas_0'));
  await page.evaluate(() => { document.getElementById('sopas_0').checked = true; document.getElementById('proteinas_0').checked = true; });
  await page.evaluate(() => generarMenu());
  await page.waitForFunction(() => document.getElementById('menu-canvas').classList.contains('visible'));
}
// Diferencia media (0–255) entre una zona del lienzo y la foto de referencia.
const diferencia = (page, referencia, x, y, w, h) => page.evaluate(async ([ref, x, y, w, h]) => {
  const img = new Image(); img.src = ref; await img.decode();
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  const c = o.getContext('2d', { willReadFrequently: true });
  c.drawImage(document.getElementById('menu-canvas'), x, y, w, h, 0, 0, w, h);
  const a = c.getImageData(0, 0, w, h).data;
  c.clearRect(0, 0, w, h); c.drawImage(img, 0, 0);
  const b = c.getImageData(0, 0, w, h).data;
  let suma = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) { suma += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return suma / n;
}, [referencia, x, y, w, h]);

test.describe('imagen publicitaria del Menú: precios de la plantilla', () => {
  test('mide lo mismo que siempre (1341 × 2000) y se genera sin errores', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await generar(page);
    expect(await page.evaluate(() => [document.getElementById('menu-canvas').width, document.getElementById('menu-canvas').height])).toEqual([1341, 2000]);
    expect(errores).toEqual([]);
  });

  test('«Porción Sopa» dice $6.000 (la fila coincide con la foto de referencia)', async ({ page }) => {
    await generar(page);
    expect(await diferencia(page, dataUrl('menu-precio-sopa-6000.png'), 420, 1425, 200, 60)).toBeLessThan(2);
  });

  test('toda la columna de precios (Completo, Seco, Sopa, Arroz, Asados) sigue como en la referencia', async ({ page }) => {
    await generar(page);
    expect(await diferencia(page, dataUrl('menu-precios-columna.png'), 400, 1315, 260, 340)).toBeLessThan(0.5);
  });
});
