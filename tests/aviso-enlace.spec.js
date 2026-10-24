// El enlace viejo (carpeta "Contabildad", con "d") ya no redirige en silencio: avisa que el enlace
// cambió, muestra el nuevo, tiene un botón y a los 8 segundos lleva allá.
// Todo con un reloj falso y sin salir a internet.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const NUEVO = 'https://luiscadlo.github.io/Restaurante-El-Lobo/';
const PAGINAS = ['index.html', 'ElLobo-Sistema Contable.html'];

for (const nombre of PAGINAS) {
  test(`aviso de enlace nuevo — Contabildad/${nombre}`, async ({ page }) => {
    const destinos = [];
    await page.route(/^https?:\/\//, route => { destinos.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>nuevo</body></html>' }); });
    await page.clock.install();
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'Contabildad', nombre)).href);

    // Dice que el enlace cambió y enseña el nuevo, con un botón que lo abre
    await expect(page.locator('h1')).toContainText('Este enlace cambió');
    await expect(page.locator('#url-nuevo')).toHaveText(NUEVO);
    await expect(page.locator('#ir')).toHaveAttribute('href', NUEVO);
    // Respaldo sin JavaScript: refresco a los 8 s
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute('content', `8; url=${NUEVO}`);

    // Antes de los 8 s sigue ahí (la gente alcanza a leer)
    await page.clock.runFor(7000);   // runFor dispara TODOS los temporizadores (fastForward solo uno)
    await expect(page.locator('h1')).toContainText('Este enlace cambió');
    expect(destinos).toEqual([]);

    // A los 8 s lleva al enlace nuevo
    await page.clock.runFor(1000);
    await page.waitForURL(url => url.href.startsWith(NUEVO), { timeout: 2000 });   // ya a los 8 s, no más tarde
    expect(destinos[0]).toBe(NUEVO);
  });
}

test('las dos páginas del aviso son idénticas (si se edita una, hay que editar la otra)', async () => {
  const fs = require('fs');
  const a = fs.readFileSync(path.join(__dirname, '..', 'Contabildad', 'index.html'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'Contabildad', 'ElLobo-Sistema Contable.html'), 'utf8');
  expect(a).toBe(b);
});

test('el enlace permanente (raíz) y la carpeta Contabilidad siguen llevando al sistema', async () => {
  const fs = require('fs');
  const raiz = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  expect(raiz).toContain('Contabilidad/ElLobo-Sistema%20Contable.html');
  expect(fs.existsSync(path.join(__dirname, '..', 'Contabilidad', 'ElLobo-Sistema Contable.html'))).toBe(true);
});
