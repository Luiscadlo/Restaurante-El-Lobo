// COPIA DE PRUEBAS (réplica): la que fabrica herramientas/generar_copia_pruebas.py. Se genera una copia de verdad y se abre
// con el Supabase falso (no sale a internet). Se comprueba que:
//   · se ve el cartel rojo y el título de PRUEBAS (y el sistema real NO los tiene);
//   · SOLO habla con el proyecto de pruebas: ni una petición a la dirección de producción;
//   · la sesión que recuerda el navegador no se mezcla con la de producción (mismo dominio en GitHub Pages);
//   · todo lo demás funciona igual (entrar como caja y como administrador, cargar los datos).
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { abrirSistema, USUARIOS } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const REF_PRUEBAS = 'abcdefghijklmnopqrst';
const HOST_PRUEBAS = `${REF_PRUEBAS}.supabase.co`;
const HOST_PRODUCCION = 'arxyfcquvsmfoxmbifne.supabase.co';
const CLAVE_PRODUCCION = 'ellobo.sesion.caja.v1';
const CLAVE_PRUEBAS = 'ellobo.pruebas.sesion.caja.v1';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const LLAVE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', ref: REF_PRUEBAS, exp: 4102444800 })}.firma-de-prueba`;

let carpeta, URL_COPIA, descargas, URL_SUELTO;
test.beforeAll(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lobo-copia-pruebas-'));
  execFileSync('python3', [path.resolve(__dirname, '../herramientas/generar_copia_pruebas.py'),
    '--url', `https://${HOST_PRUEBAS}`, '--llave-publica', LLAVE, '-o', carpeta], { stdio: 'pipe' });
  URL_COPIA = pathToFileURL(path.join(carpeta, 'Contabilidad', 'ElLobo-Sistema Contable.html')).href;
  // El archivo que se le entrega al dueño: UNO solo, en una carpeta donde no hay ninguna carpeta Menu/ (como Descargas).
  descargas = fs.mkdtempSync(path.join(os.tmpdir(), 'lobo-descargas-'));
  execFileSync('python3', [path.resolve(__dirname, '../herramientas/generar_copia_pruebas.py'),
    '--url', `https://${HOST_PRUEBAS}`, '--llave-publica', LLAVE, '--archivo-unico', path.join(descargas, 'ElLobo_PRUEBAS.html')], { stdio: 'pipe' });
  URL_SUELTO = pathToFileURL(path.join(descargas, 'ElLobo_PRUEBAS.html')).href;
});
test.afterAll(() => {
  for (const d of [carpeta, descargas]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});

const entrar = (page, usuario, clave) => page.evaluate(([u, c]) => { document.getElementById('login-email').value = u; document.getElementById('login-password').value = c; }, [usuario, clave])
  .then(() => page.click('#login-btn'));

test.describe('la copia de pruebas', () => {
  test('se ve el cartel rojo y el título de PRUEBAS; el sistema real no los tiene', async ({ page }) => {
    await abrirSistema(page, { url: URL_COPIA, usuario: null, esperarLogin: true });
    await expect(page.locator('#aviso-pruebas')).toBeVisible();
    await expect(page.locator('#aviso-pruebas')).toContainText('ENTORNO DE PRUEBAS');
    await expect(page.locator('#franja-pruebas')).toBeVisible();
    expect(await page.title()).toContain('PRUEBAS');
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

    const real = await page.context().newPage();
    await abrirSistema(real, { usuario: null, esperarLogin: true });
    await expect(real.locator('#aviso-pruebas')).toHaveCount(0);
    expect(await real.title()).not.toContain('PRUEBAS');
  });

  test('si el administrador cambia el nombre del negocio, el título conserva el aviso de PRUEBAS', async ({ page }) => {
    const d = JSON.parse(JSON.stringify(DATOS_BASE));
    d.configuracion = [{ id: 1, clave: 'negocio_nombre', valor: 'Café Lobo', vigente_desde: '2026-10-01T10:00:00-05:00', creado_por: 'luis', creado_en: '2026-10-01T10:00:00-05:00' }];
    const reg = await abrirSistema(page, { url: URL_COPIA, claveSesion: CLAVE_PRUEBAS, datos: d });
    expect(await page.title()).toBe('🧪 PRUEBAS — Café Lobo — Sistema Contable');          // cambia el nombre, no la marca de que es la copia
    expect(reg.errores).toEqual([]);
  });

  test('habla SOLO con el proyecto de pruebas (ni una petición a producción)', async ({ page }) => {
    const reg = await abrirSistema(page, { url: URL_COPIA, claveSesion: CLAVE_PRUEBAS });
    expect([...reg.hosts]).toEqual([HOST_PRUEBAS]);
    expect(reg.hosts.has(HOST_PRODUCCION)).toBe(false);
    expect(await page.evaluate(() => SB_URL)).toBe(`https://${HOST_PRUEBAS}`);
    expect(await page.evaluate(() => SB_KEY)).toBe(LLAVE);
    expect(reg.errores).toEqual([]);
  });

  test('la sesión de producción guardada en el navegador NO se usa en la copia ni se borra', async ({ page }) => {
    // Sesión de caja guardada con el nombre de PRODUCCIÓN (como la deja el mostrador): la copia no debe usarla.
    const reg = await abrirSistema(page, { url: URL_COPIA, esperarLogin: true });
    const antes = await page.evaluate(k => localStorage.getItem(k), CLAVE_PRODUCCION);
    expect(antes).toBeTruthy();                                                   // sí estaba sembrada
    expect(reg.hosts.size).toBe(0);                                               // la copia no la usó para hablar con nadie
    await expect(page.locator('#loginOverlay')).toBeVisible();                    // pide entrar
    expect(await page.evaluate(k => localStorage.getItem(k), CLAVE_PRODUCCION)).toBe(antes);   // y no la tocó
  });

  test('entrar como caja en la copia guarda la sesión con otro nombre y no toca el de producción', async ({ page }) => {
    const reg = await abrirSistema(page, { url: URL_COPIA, usuario: null, esperarLogin: true });
    await entrar(page, 'caja', USUARIOS['caja@elobo.test'].password);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loadingOverlay')).display === 'none'
      && getComputedStyle(document.getElementById('loginOverlay')).display === 'none', null, { timeout: 15000 });
    const claves = await page.evaluate(() => Object.keys(localStorage));
    expect(claves).toContain(CLAVE_PRUEBAS);
    expect(claves).not.toContain(CLAVE_PRODUCCION);
    expect([...reg.hosts]).toEqual([HOST_PRUEBAS]);
    // «Salir» borra la de pruebas y sigue sin existir la de producción.
    await Promise.all([page.waitForNavigation(), page.evaluate(() => { salirDelSistema(); })]);
    await page.waitForFunction(() => { const o = document.getElementById('loginOverlay'); return o && getComputedStyle(o).display !== 'none'; });
    const despues = await page.evaluate(() => Object.keys(localStorage));
    expect(despues).not.toContain(CLAVE_PRUEBAS);
    expect(despues).not.toContain(CLAVE_PRODUCCION);
  });

  test('administrador y caja funcionan igual: pestañas, datos cargados, sin errores', async ({ page }) => {
    const reg = await abrirSistema(page, { url: URL_COPIA, usuario: 'admin' });
    await expect(page.locator('#tab-nav-datos')).toBeVisible();
    await expect(page.locator('#rolBadge')).toContainText('Admin');
    expect(await page.evaluate(() => ST.ingresos.length)).toBeGreaterThan(0);
    expect([...reg.hosts]).toEqual([HOST_PRUEBAS]);
    expect(reg.errores).toEqual([]);
    expect(reg.noManejadas).toEqual([]);
  });

  test('el cartel no estorba: la franja de abajo deja pasar los clics', async ({ page }) => {
    await abrirSistema(page, { url: URL_COPIA, usuario: null, esperarLogin: true });
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('franja-pruebas')).pointerEvents)).toBe('none');
  });
});

// ── La pestaña Menú ───────────────────────────────────────────────────────────────────────────────────────────────
// El Menú es una app aparte que el sistema carga en un iframe desde ../Menu/. Abierta como archivo suelto (Descargas) esa
// carpeta no existe y la pestaña salía con «No se ha podido acceder al archivo»: el archivo único lleva el Menú adentro.
const irAlMenu = async page => {
  await page.locator('.tab', { hasText: /^Menú$/ }).click();
  await expect(page.locator('#tab-menu')).toBeVisible();
};
const fallosDeArchivos = page => {
  const fallos = [];
  page.on('requestfailed', r => { if (r.url().startsWith('file:') && !/ERR_ABORTED/.test(r.failure().errorText)) fallos.push(`${r.url()} ${r.failure().errorText}`); });
  return fallos;
};

test.describe('la pestaña Menú de la copia de pruebas', () => {
  test('como archivo suelto (sin carpeta Menu/ al lado) la pestaña Menú carga: el Menú va adentro', async ({ page }) => {
    expect(fs.readdirSync(descargas)).toEqual(['ElLobo_PRUEBAS.html']);          // no hay nada más junto al archivo
    const fallos = fallosDeArchivos(page);
    const reg = await abrirSistema(page, { url: URL_SUELTO, usuario: 'admin' });
    await irAlMenu(page);
    const menu = page.frameLocator('#menuFrame');
    await expect(menu.getByText('Generador de Menú del Día')).toBeVisible();
    await expect(menu.getByText('Restaurante El Lobo')).toBeVisible();
    expect(page.frames().map(f => f.url())).not.toContainEqual(expect.stringMatching(/^chrome-error:/));
    expect(await page.evaluate(() => document.getElementById('menuFrame').hasAttribute('src'))).toBe(false);
    expect(fallos).toEqual([]);                                                  // ningún archivo local que no se encuentre
    expect([...reg.hosts]).toEqual([HOST_PRUEBAS]);                              // y el Menú no habla con nadie más
    expect(reg.errores).toEqual([]);
  });

  test('el Menú de adentro funciona: guarda su catálogo en el navegador y ofrece las categorías', async ({ page }) => {
    await abrirSistema(page, { url: URL_SUELTO, usuario: 'admin' });
    await irAlMenu(page);
    const marco = page.frames().find(f => f.url() === 'about:srcdoc');
    expect(marco, 'no se encontró el marco del Menú').toBeTruthy();
    await expect(marco.locator('#lista-sopas')).toBeAttached();
    const guardado = await marco.evaluate(() => { guardarCatalogo(catalogo); return Object.keys(JSON.parse(localStorage.getItem('elLobo_catalogo'))); });
    expect(guardado).toEqual(expect.arrayContaining(['sopas', 'arroces', 'proteinas', 'acomp']));
  });

  test('«Abrir en pestaña aparte» abre el Menú completo en otra pestaña (aunque no haya carpeta Menu/)', async ({ page, context }) => {
    await abrirSistema(page, { url: URL_SUELTO, usuario: 'admin' });
    await irAlMenu(page);
    // (Solo de la prueba: mientras la página tiene interceptada la red, el navegador de pruebas no termina de cargar una ventana
    // escrita desde ella; en un navegador normal no pasa. Ya no se necesita el servidor falso: el Menú no habla con nadie.)
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const [aparte] = await Promise.all([context.waitForEvent('page'), page.getByText('Abrir en pestaña aparte').click()]);
    await expect(aparte).toHaveTitle(/Menú del Día/);
    await aparte.waitForFunction(() => document.readyState === 'complete' && typeof guardarCatalogo === 'function', null, { timeout: 20000 });
    await expect(aparte.getByText('Generador de Menú del Día')).toBeVisible();
    expect(await aparte.evaluate(() => { guardarCatalogo(catalogo); return localStorage.getItem('elLobo_catalogo') !== null; })).toBe(true);
    expect(page.url()).toBe(URL_SUELTO);                                         // y la pestaña del sistema se quedó donde estaba (no navegó a «#»)
  });

  test('la copia en carpeta (con Menu/ al lado) sigue cargando el Menú por su ruta de siempre', async ({ page }) => {
    const fallos = fallosDeArchivos(page);
    await abrirSistema(page, { url: URL_COPIA, usuario: 'admin' });
    await irAlMenu(page);
    await expect(page.frameLocator('#menuFrame').getByText('Generador de Menú del Día')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('menuFrame').getAttribute('src'))).toMatch(/Men%C3%BA%20diario-El%20Lobo\.html\?v=\d+$/);
    expect(fallos).toEqual([]);
  });

  test('el archivo suelto es la misma copia: cartel rojo, título y solo habla con el proyecto de pruebas', async ({ page }) => {
    const reg = await abrirSistema(page, { url: URL_SUELTO, claveSesion: CLAVE_PRUEBAS });
    await expect(page.locator('#aviso-pruebas')).toContainText('ENTORNO DE PRUEBAS');
    expect(await page.title()).toContain('PRUEBAS');
    expect([...reg.hosts]).toEqual([HOST_PRUEBAS]);
    expect(await page.evaluate(() => SB_URL)).toBe(`https://${HOST_PRUEBAS}`);
    expect(reg.errores).toEqual([]);
  });
});

