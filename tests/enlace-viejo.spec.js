// Los enlaces de entrada (el permanente de la raíz y el viejo de la carpeta "Contabildad", con "d") llevan al
// sistema AL INSTANTE, sin ninguna pantalla en medio: quien los abre ve directo la entrada con usuario y contraseña.
// (Antes el enlace viejo mostraba «Este enlace cambió» 8 segundos; el dueño pidió quitarlo, 25-oct-2026.)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const SISTEMA = 'Contabilidad/ElLobo-Sistema%20Contable.html';
const ENTRADAS = [
  { nombre: 'enlace viejo — Contabildad/index.html', archivo: ['Contabildad', 'index.html'], hacia: '../' + SISTEMA },
  { nombre: 'enlace viejo — Contabildad/ElLobo-Sistema Contable.html', archivo: ['Contabildad', 'ElLobo-Sistema Contable.html'], hacia: '../' + SISTEMA },
  { nombre: 'enlace permanente — raíz', archivo: ['index.html'], hacia: SISTEMA },
];

for (const e of ENTRADAS) {
  test(`${e.nombre}: va directo al sistema, sin pantalla de aviso y conservando ? y #`, async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.abort());              // sin salir a internet
    await page.clock.install();                                           // reloj falso: si hubiera cuenta regresiva, no avanzaría
    const url = pathToFileURL(path.join(RAIZ, ...e.archivo)).href + '?x=1#seccion';
    await page.goto(url);
    await page.waitForURL(u => u.pathname.endsWith('/Contabilidad/ElLobo-Sistema%20Contable.html') || u.pathname.endsWith('/Contabilidad/ElLobo-Sistema Contable.html'), { timeout: 5000 });
    expect(page.url()).toMatch(/\?x=1#seccion$/);
    // nunca se mostró el aviso viejo
    expect(await page.locator('text=Este enlace cambió').count()).toBe(0);
    // y el respaldo sin JavaScript también es inmediato (0 segundos)
    const html = fs.readFileSync(path.join(RAIZ, ...e.archivo), 'utf8');
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${e.hacia}">`);
    expect(html).not.toMatch(/setInterval|setTimeout|Este enlace cambió/);
  });
}

test('las dos páginas del enlace viejo son idénticas (si se edita una, hay que editar la otra)', () => {
  const a = fs.readFileSync(path.join(RAIZ, 'Contabildad', 'index.html'), 'utf8');
  const b = fs.readFileSync(path.join(RAIZ, 'Contabildad', 'ElLobo-Sistema Contable.html'), 'utf8');
  expect(a).toBe(b);
});

test('el sistema al que llevan existe', () => {
  expect(fs.existsSync(path.join(RAIZ, 'Contabilidad', 'ElLobo-Sistema Contable.html'))).toBe(true);
});
