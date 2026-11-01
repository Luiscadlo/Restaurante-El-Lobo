// La entrada del sitio: el enlace permanente (la raíz) lleva AL INSTANTE al sistema, sin ninguna pantalla en medio: quien lo abre ve
// directo la entrada con usuario y contraseña. La carpeta vieja "Contabildad" (con "d", nacida de un error de escritura) se eliminó el
// 1-nov-2026 a pedido del dueño; quien todavía tenga guardado ese enlace ve la página 404.html, que le explica y le da un botón al
// enlace correcto (no redirige sola).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const SISTEMA = 'Contabilidad/ElLobo-Sistema%20Contable.html';
const ENLACE = 'https://luiscadlo.github.io/Restaurante-El-Lobo/';

test('enlace permanente — raíz: va directo al sistema, sin pantalla de aviso y conservando ? y #', async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.abort());              // sin salir a internet
  await page.clock.install();                                           // reloj falso: si hubiera cuenta regresiva, no avanzaría
  await page.goto(pathToFileURL(path.join(RAIZ, 'index.html')).href + '?x=1#seccion');
  await page.waitForURL(u => u.pathname.endsWith('/Contabilidad/ElLobo-Sistema%20Contable.html') || u.pathname.endsWith('/Contabilidad/ElLobo-Sistema Contable.html'), { timeout: 5000 });
  expect(page.url()).toMatch(/\?x=1#seccion$/);
  expect(await page.locator('text=Este enlace cambió').count()).toBe(0);
  // y el respaldo sin JavaScript también es inmediato (0 segundos)
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${SISTEMA}">`);
  expect(html).not.toMatch(/setInterval|setTimeout|Este enlace cambió/);
});

test('el sistema al que lleva existe', () => {
  expect(fs.existsSync(path.join(RAIZ, 'Contabilidad', 'ElLobo-Sistema Contable.html'))).toBe(true);
});

test('la carpeta vieja «Contabildad» ya no existe y ningún archivo del sitio la usa como enlace', () => {
  expect(fs.existsSync(path.join(RAIZ, 'Contabildad'))).toBe(false);
  for (const f of ['index.html', '404.html', path.join('Contabilidad', 'index.html'), path.join('Contabilidad', 'ElLobo-Sistema Contable.html')]) {
    expect(fs.readFileSync(path.join(RAIZ, f), 'utf8'), f).not.toMatch(/\/Contabildad|Contabildad\//);
  }
});

test('404.html: explica que el enlace cambió, tiene el botón al enlace correcto y NO redirige sola', async ({ page }) => {
  const archivo = path.join(RAIZ, '404.html');
  const html = fs.readFileSync(archivo, 'utf8');
  expect(html).not.toMatch(/http-equiv="refresh"|location\.(replace|href|assign)|setTimeout|setInterval|<script/i);
  expect(html).toContain('<meta name="robots" content="noindex">');
  await page.route(/^https?:\/\//, route => route.abort());
  await page.goto(pathToFileURL(archivo).href);
  await expect(page.locator('h1')).toContainText('Este enlace cambió');
  const boton = page.locator('a.boton');
  await expect(boton).toHaveAttribute('href', ENLACE);                  // dirección completa: la página se sirve desde cualquier ruta
  await expect(boton).toBeVisible();
  await expect(page.locator('code')).toHaveText(ENLACE);
  // se ve bien en el celular: sin barra horizontal
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
