// Pruebas de ACCESO y ROLES: pantalla de entrada, sesión (Supabase Auth), caja vs. admin y
// autorización de un administrador sobre una sesión de caja.
//
// Todo con un Auth y una base FALSOS (tests/helpers/backend-falso.js): nada sale a internet,
// los usuarios y claves son ficticios y no toca tu Supabase.
// La matriz de permisos que hace cumplir el backend falso está en tests/helpers/permisos.js.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { abrirSistema, TABLAS_CAJA, TABLAS_LOADSTATE, TABLAS_SOLO_ADMIN, URL_HTML } = require('./helpers/backend-falso');
const { entrarComoAdmin } = require('./helpers/sesion');

const CLAVE_GUARDADA = 'ellobo.sesion.caja.v1';
const HTML_TEXTO = fs.readFileSync(path.resolve(__dirname, '../Contabilidad/ElLobo-Sistema Contable.html'), 'utf-8');

async function loginVisible(page) {
  return page.evaluate(() => getComputedStyle(document.getElementById('loginOverlay')).display !== 'none');
}
async function guardado(page) {
  return page.evaluate(k => localStorage.getItem(k), CLAVE_GUARDADA);
}
async function escribirLogin(page, correo, clave) {
  await page.fill('#login-email', correo);
  await page.fill('#login-password', clave);
  await page.click('#login-btn');
}
// Espera a que la entrada y la pantalla de carga estén ocultas (el sistema ya cargó).
async function esperarCarga(page) {
  await page.waitForFunction(() => ['loginOverlay', 'loadingOverlay'].every(id => getComputedStyle(document.getElementById(id)).display === 'none'));
}
async function esperarEntrada(page) {
  // Si la página se está recargando justo en este instante el elemento aún no existe: se sigue esperando (antes daba error con el equipo cargado).
  await page.waitForFunction(() => { const el = document.getElementById('loginOverlay'); return !!el && getComputedStyle(el).display !== 'none'; });
}
async function irA(page, id) {
  await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
}

// ── Pantalla de entrada ──────────────────────────────────────────────────────
test.describe('pantalla de entrada', () => {
  test('sin sesión: solo se ve la entrada; no se pide NI UNA tabla', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    expect(await loginVisible(page)).toBe(true);
    await expect(page.locator('#loadingOverlay')).toBeHidden();
    expect(reg.rest).toEqual([]);
    expect(reg.escrituras).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('clave incorrecta: avisa, sigue en la entrada y no carga nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'caja@elobo.test', 'clave-equivocada');
    await expect(page.locator('#login-error')).toContainText('Usuario o contraseña incorrectos');
    expect(await loginVisible(page)).toBe(true);
    expect(reg.rest).toEqual([]);
    expect(await guardado(page)).toBeNull();
    // el botón vuelve a estar disponible para reintentar
    await expect(page.locator('#login-btn')).toBeEnabled();
  });

  test('faltan datos: pide escribir correo y contraseña sin llamar al servidor', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await page.click('#login-btn');
    await expect(page.locator('#login-error')).toContainText('Escribe tu usuario y tu contraseña');
    expect(reg.auth).toEqual([]);
  });

  test('entrar con Enter funciona', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await page.fill('#login-email', 'caja@elobo.test');
    await page.fill('#login-password', 'clave-caja');
    await page.press('#login-password', 'Enter');
    await esperarCarga(page);
    expect(reg.auth).toContain('password:caja@elobo.test');
  });

  test('basta escribir el usuario corto («caja»): el sistema completa el correo por detrás', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'caja', 'clave-caja');
    await esperarCarga(page);
    expect(reg.auth).toEqual(['password:caja@elobo.test']);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
  });

  test('mayúsculas y espacios de más no importan («  Caja »)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, '  Caja ', 'clave-caja');
    await esperarCarga(page);
    expect(reg.auth).toEqual(['password:caja@elobo.test']);
  });

  test('un dueño entra escribiendo solo «dueno1» y ve su nombre corto', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'dueno1', 'clave-dueno1');
    await esperarCarga(page);
    expect(reg.auth).toEqual(['password:dueno1@elobo.test']);
    await expect(page.locator('#rolBadge')).toHaveText('👑 Admin · dueno1');
  });

  test('el usuario llamado «admin» muestra solo «👑 Admin» (sin «Admin · admin»); con otro nombre se agrega el nombre', async ({ page }) => {
    await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'admin', 'clave-admin');
    await esperarCarga(page);
    await expect(page.locator('#rolBadge')).toHaveText('👑 Admin');
    // con mayúsculas escritas a mano en el correo completo también
    const pagina2 = await page.context().newPage();
    await abrirSistema(pagina2, { usuario: null });
    await escribirLogin(pagina2, 'Admin@elobo.test', 'clave-admin');
    await esperarCarga(pagina2);
    await expect(pagina2.locator('#rolBadge')).toHaveText('👑 Admin');
  });

  test('la insignia no depende de mayúsculas: «Admin» y «ADMIN» también se muestran solo como «👑 Admin»', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const textos = await page.evaluate(() => ['Admin@elobo.test', 'ADMIN@ELOBO.TEST', 'luisca@elobo.test'].map(correo => {
      sesionBase.email = correo; sincronizarSesion(); return document.getElementById('rolBadge').textContent;
    }));
    expect(textos).toEqual(['👑 Admin', '👑 Admin', '👑 Admin · luisca']);
  });

  test('la clave de otro usuario con el nombre corto sigue siendo rechazada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'caja', 'clave-dueno1');
    await expect(page.locator('#login-error')).toContainText('Usuario o contraseña incorrectos');
    expect(await loginVisible(page)).toBe(true);
    expect(reg.rest).toEqual([]);
  });

  test('un correo completo de otro dominio se envía tal cual (no se le agrega nada)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'alguien@otro-dominio.com', 'x');
    await expect(page.locator('#login-error')).toContainText('Usuario o contraseña incorrectos');
    expect(reg.auth).toEqual(['password-fallido:alguien@otro-dominio.com']);
  });

  test('correoDeUsuario / nombreDeUsuario', async ({ page }) => {
    await abrirSistema(page, { usuario: null });
    const r = await page.evaluate(() => ({
      corto: correoDeUsuario('caja'), mayus: correoDeUsuario('  LuisCadlo '), completo: correoDeUsuario('a@b.com'),
      vacio: correoDeUsuario('   '), nulo: correoDeUsuario(null),
      nombre: nombreDeUsuario('luiscadlo@elobo.test'), ajeno: nombreDeUsuario('a@b.com'), dominio: DOMINIO_USUARIOS,
    }));
    expect(r).toEqual({ corto: 'caja@elobo.test', mayus: 'luiscadlo@elobo.test', completo: 'a@b.com', vacio: '', nulo: '',
                        nombre: 'luiscadlo', ajeno: 'a@b.com', dominio: 'elobo.test' });
  });

  test('caja: entra, carga SOLO las tablas operativas y todo lo hace con el token de caja', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'caja@elobo.test', 'clave-caja');
    await esperarCarga(page);
    expect(await loginVisible(page)).toBe(false);
    expect([...new Set(reg.peticiones)].sort()).toEqual([...TABLAS_CAJA].sort());
    expect(new Set(reg.rest.map(r => r.rol))).toEqual(new Set(['caja']));
    expect(reg.denegadas).toEqual([]);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
    await expect(page.locator('#tab-nav-datos')).toBeHidden();   // el respaldo y el Excel (pestaña Datos) son solo de admin
    expect(await page.evaluate(() => adminAutenticado)).toBe(false);
    expect(reg.errores).toEqual([]);
  });

  test('admin: entra directo y carga las 16 tablas', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    expect([...new Set(reg.peticiones)].sort()).toEqual([...TABLAS_LOADSTATE].sort());
    expect(new Set(reg.rest.map(r => r.rol))).toEqual(new Set(['admin']));
    expect(reg.denegadas).toEqual([]);
    await expect(page.locator('#rolBadge')).toHaveText('👑 Admin · dueno1');   // se muestra el nombre corto
    await expect(page.locator('#tab-nav-datos')).toBeVisible();
    expect(await page.evaluate(() => adminAutenticado)).toBe(true);
  });

  test('admin directo: las secciones de administración ya están abiertas (sin pedir nada más)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    for (const [id, pre] of [['dashboard', 'tablero'], ['egresos', 'egresos'], ['caja', 'caja'], ['auditoria', 'auditoria'], ['datos', 'datos']]) {
      await irA(page, id);
      await expect(page.locator(`#${pre}-contenido`)).toBeVisible();
      await expect(page.locator(`#${pre}-login`)).toBeHidden();
    }
    expect(reg.errores).toEqual([]);
  });

  test('un usuario de respaldo NO puede entrar a la pantalla (y se cierra su sesión)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'respaldo@elobo.test', 'clave-respaldo');
    await expect(page.locator('#login-error')).toContainText('solo para el respaldo automático');
    expect(await loginVisible(page)).toBe(true);
    expect(reg.rest).toEqual([]);
    await expect.poll(() => reg.auth.includes('logout')).toBe(true);
    expect(await guardado(page)).toBeNull();
  });

  test('un usuario sin rol asignado no entra y se le explica por qué', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'sinrol@elobo.test', 'clave-sinrol');
    await expect(page.locator('#login-error')).toContainText('todavía no tiene un rol asignado');
    expect(reg.rest).toEqual([]);
  });

  for (const [falla, texto] of [['red', 'No hay conexión'], ['500', 'no responde'], ['429', 'Demasiados intentos']]) {
    test(`el servicio de acceso falla (${falla}): mensaje claro y se puede reintentar`, async ({ page }) => {
      const reg = await abrirSistema(page, { usuario: null, authFalla: falla });
      await escribirLogin(page, 'caja@elobo.test', 'clave-caja');
      await expect(page.locator('#login-error')).toContainText(texto);
      expect(await loginVisible(page)).toBe(true);
      expect(reg.rest).toEqual([]);
      await expect(page.locator('#login-btn')).toBeEnabled();
    });
  }
});

// ── Sesión guardada en el equipo (solo caja) ────────────────────────────────
test.describe('sesión guardada (caja)', () => {
  test('al entrar como caja se recuerda; la clave NO se guarda en ningún lado', async ({ page }) => {
    await abrirSistema(page, { usuario: null });
    await escribirLogin(page, 'caja@elobo.test', 'clave-caja');
    await esperarCarga(page);
    const g = await guardado(page);
    expect(g).not.toBeNull();
    expect(g).not.toContain('clave-caja');
    expect(Object.keys(JSON.parse(g)).sort()).toEqual(['access_token', 'email', 'expires_at', 'refresh_token', 'rol']);
    const todo = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(todo).not.toContain('clave-caja');
  });

  test('abrir de nuevo con sesión vigente: entra directo, sin volver a pedir clave', async ({ page }) => {
    const reg = await abrirSistema(page);   // sesión de caja guardada
    expect(reg.auth).toEqual([]);           // ni login ni renovación
    expect(await loginVisible(page)).toBe(false);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
  });

  test('sesión vencida: se renueva sola y se guarda la nueva', async ({ page }) => {
    const ahora = Math.floor(new Date('2026-10-20T14:00:00-05:00').getTime() / 1000);   // el reloj de las pruebas está fijo
    const reg = await abrirSistema(page, { usuario: null });
    const vencida = reg.emitirSesion('caja@elobo.test', { expires_at: ahora - 10 });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CLAVE_GUARDADA, JSON.stringify(vencida)]);
    await page.reload();
    await esperarCarga(page);
    expect(reg.auth).toContain('refresh:caja@elobo.test');
    const nueva = JSON.parse(await guardado(page));
    expect(nueva.refresh_token).not.toBe(vencida.refresh_token);   // Supabase rota el refresh_token: se guarda el nuevo
    expect(nueva.expires_at).toBeGreaterThan(ahora);
    expect(reg.denegadas).toEqual([]);
  });

  test('sesión vencida y revocada en el servidor: vuelve a la entrada y borra lo guardado', async ({ page }) => {
    const ahora = Math.floor(new Date('2026-10-20T14:00:00-05:00').getTime() / 1000);
    const reg = await abrirSistema(page, {
      usuario: null, rechazarRefresh: true, esperarLogin: true,
      sesionGuardada: { access_token: 'x.y.z', refresh_token: 'refresh-viejo', expires_at: ahora - 60, email: 'caja@elobo.test', rol: 'caja' },
    });
    expect(await loginVisible(page)).toBe(true);
    await expect(page.locator('#login-error')).toContainText('Tu sesión venció');
    expect(await guardado(page)).toBeNull();
    expect(reg.rest).toEqual([]);
  });

  test('varias peticiones con el token vencido comparten UNA sola renovación', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => { sesionBase.expires_at = Math.floor(Date.now() / 1000) - 5; });
    const antes = reg.auth.filter(a => a.startsWith('refresh')).length;
    await page.evaluate(() => Promise.all([sbGet('mesas'), sbGet('inventario'), sbGet('pedidos'), sbGet('config'), sbGet('notas_dia')]));
    expect(reg.auth.filter(a => a.startsWith('refresh')).length - antes).toBe(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('si otra pestaña ya renovó, se adopta su sesión en vez de gastar el refresh_token viejo', async ({ page }) => {
    const reg = await abrirSistema(page);
    const ahora = Math.floor(new Date('2026-10-20T14:00:00-05:00').getTime() / 1000);
    const deOtraPestana = reg.emitirSesion('caja@elobo.test');   // sesión más nueva, vigente
    await page.evaluate(([k, v]) => { localStorage.setItem(k, v); sesionBase.expires_at = Math.floor(Date.now() / 1000) - 5; }, [CLAVE_GUARDADA, JSON.stringify(deOtraPestana)]);
    const antes = reg.auth.filter(a => a.startsWith('refresh')).length;
    await page.evaluate(() => sbGet('mesas'));
    expect(reg.auth.filter(a => a.startsWith('refresh')).length - antes).toBe(0);
    expect(await page.evaluate(() => sesionBase.refresh_token)).toBe(deOtraPestana.refresh_token);
    expect(deOtraPestana.expires_at).toBeGreaterThan(ahora);
  });

  test('Salir: borra la sesión guardada, cierra en el servidor y vuelve a la entrada', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.getByRole('button', { name: /Salir/ }).click();
    await esperarEntrada(page);
    expect(await guardado(page)).toBeNull();
    await expect.poll(() => reg.auth.includes('logout')).toBe(true);   // la entrada aparece antes de que termine de avisarle al servidor
    expect(reg.logoutScopes).toEqual(['local']);   // solo ESTA sesión: no saca a otros equipos con el mismo usuario
    // y recargando tampoco entra solo
    await page.reload();
    await esperarEntrada(page);
    expect(await loginVisible(page)).toBe(true);
  });

  test('un admin que entra directo NO queda guardado: al recargar pide entrar de nuevo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const todo = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(todo).not.toContain('dueno1');
    expect(todo).not.toContain('refresh-');
    await page.reload();
    await esperarEntrada(page);
    expect(await loginVisible(page)).toBe(true);
  });
});

// ── Caja: sin acceso a finanzas; autorización de un administrador en el sitio ──
test.describe('caja y autorización de administrador', () => {
  test('como caja no se pide ninguna tabla de finanzas/auditoría y las secciones quedan con candado', async ({ page }) => {
    const reg = await abrirSistema(page);
    expect(reg.peticiones.filter(t => TABLAS_SOLO_ADMIN.includes(t))).toEqual([]);
    for (const [id, pre] of [['dashboard', 'tablero'], ['ingfin', 'ingfin'], ['egresos', 'egresos'], ['caja', 'caja'], ['auditoria', 'auditoria'], ['datos', 'datos']]) {
      await irA(page, id);
      await expect(page.locator(`#${pre}-login`)).toBeVisible();
      await expect(page.locator(`#${pre}-email`)).toBeVisible();      // se pide usuario + contraseña
      await expect(page.locator(`#${pre}-password`)).toBeVisible();
      await expect(page.locator(`#${pre}-contenido`)).toBeHidden();
    }
    expect(reg.errores).toEqual([]);
  });

  test('en el candado basta escribir «dueno1» (usuario corto) y la contraseña', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'egresos');
    await page.fill('#egresos-email', 'dueno1');
    await page.fill('#egresos-password', 'clave-dueno1');
    await page.click('#egresos-login button');
    await expect(page.locator('#egresos-contenido')).toBeVisible();
    expect(reg.auth).toContain('password:dueno1@elobo.test');
  });

  test('autorizar con clave equivocada o con un usuario que no es admin NO abre nada', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'egresos');
    await page.fill('#egresos-email', 'dueno1@elobo.test');
    await page.fill('#egresos-password', 'mala');
    await page.click('#egresos-login button');
    await expect(page.locator('.toast.warning', { hasText: 'Usuario o contraseña incorrectos' })).toBeVisible();
    await expect(page.locator('#egresos-contenido')).toBeHidden();

    // la clave de caja no sirve para abrir secciones de administrador
    await page.fill('#egresos-email', 'caja@elobo.test');
    await page.fill('#egresos-password', 'clave-caja');
    await page.click('#egresos-login button');
    await expect(page.locator('.toast.warning', { hasText: 'Ese usuario no es administrador' })).toBeVisible();
    await expect(page.locator('#egresos-contenido')).toBeHidden();
    expect(reg.peticiones.filter(t => TABLAS_SOLO_ADMIN.includes(t))).toEqual([]);
    expect(await page.evaluate(() => adminAutenticado)).toBe(false);
    // sin correo o sin clave: ni siquiera llama al servidor
    const llamadas = reg.auth.length;
    await page.fill('#egresos-email', '');
    await page.fill('#egresos-password', 'algo');
    await page.click('#egresos-login button');
    expect(reg.auth.length).toBe(llamadas);
  });

  const TABS_CAJA = ['Pedidos', 'Pendientes', 'Fiados', 'Cierre', 'Inventario', 'Menú'];
  const TABS_DUENO = ['Tablero', 'Ingresos', 'Egresos', 'Caja', 'Auditoría', 'Datos', '⚙️ Configuración'];
  const tabsVisibles = page => page.evaluate(() => [...document.querySelectorAll('nav .tab')]
    .filter(t => getComputedStyle(t).display !== 'none').map(t => t.textContent.replace(/\s+\d+\s*$/, '').trim()));

  test('con caja la barra solo trae las 6 secciones del mostrador; las de dueño ni aparecen', async ({ page }) => {
    await abrirSistema(page);
    expect(await tabsVisibles(page)).toEqual(TABS_CAJA);
    for (const id of ['dashboard', 'ingfin', 'egresos', 'caja', 'auditoria', 'datos']) {
      await expect(page.locator(`#tab-nav-${id}`)).toBeHidden();
    }
  });

  test('un dueño que entra directo ve las 13 secciones, sin candados', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    expect(await tabsVisibles(page)).toEqual([...TABS_CAJA, ...TABS_DUENO]);
    expect(await tabsVisibles(page)).not.toContainEqual(expect.stringContaining('🔒'));
  });

  test('si el dueño se autoriza en el sitio aparecen las 7 secciones, y al cerrar vuelven a ocultarse y se regresa a Pedidos', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'egresos');
    await page.fill('#egresos-email', 'dueno1');
    await page.fill('#egresos-password', 'clave-dueno1');
    await page.click('#egresos-login button');
    await expect(page.locator('#egresos-contenido')).toBeVisible();
    expect(await tabsVisibles(page)).toEqual([...TABS_CAJA, ...TABS_DUENO]);
    await page.locator('#egresos-contenido').getByRole('button', { name: /Cerrar sesión/ }).click();
    expect(await tabsVisibles(page)).toEqual(TABS_CAJA);
    await expect(page.locator('#tab-ingresos')).toHaveClass(/active/);      // volvió a Pedidos
    await expect(page.locator('#tab-egresos')).not.toHaveClass(/active/);
  });

  test('la pantalla de carga arranca con las secciones de dueño ocultas (nunca asoman antes de saber quién entró)', async ({ page }) => {
    await abrirSistema(page, { usuario: null });
    for (const id of ['dashboard', 'ingfin', 'egresos', 'caja', 'auditoria', 'datos']) {
      await expect(page.locator(`#tab-nav-${id}`)).toBeHidden();
    }
  });

  test('un dueño se autoriza en el sitio: se abren TODAS las secciones y se cargan las tablas de admin', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'egresos');
    await page.fill('#egresos-email', 'dueno2@elobo.test');         // cualquier dueño, cada uno con su usuario
    await page.fill('#egresos-password', 'clave-dueno2');
    await page.click('#egresos-login button');
    await expect(page.locator('#egresos-contenido')).toBeVisible();
    await expect(page.locator('#rolBadge')).toContainText('Caja');
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja · 🔓 dueno2');
    // se pidieron las tablas de admin con el token de admin
    expect(reg.rest.filter(r => TABLAS_SOLO_ADMIN.includes(r.tabla)).every(r => r.rol === 'admin')).toBe(true);
    expect([...new Set(reg.peticiones)].sort()).toEqual([...TABLAS_LOADSTATE].sort());
    // y las demás secciones también quedaron abiertas
    for (const [id, pre] of [['dashboard', 'tablero'], ['caja', 'caja'], ['auditoria', 'auditoria'], ['datos', 'datos'], ['ingfin', 'ingfin']]) {
      await irA(page, id);
      await expect(page.locator(`#${pre}-contenido`)).toBeVisible();
    }
    await expect(page.locator('#tab-nav-datos')).toBeVisible();
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
    // los campos de acceso quedan limpios
    expect(await page.inputValue('#egresos-password')).toBe('');
    expect(await page.inputValue('#egresos-email')).toBe('');
  });

  test('la autorización NO se guarda: al recargar vuelve a caja con candados', async ({ page }) => {
    await abrirSistema(page);
    await entrarComoAdmin(page);
    const todo = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(todo).not.toContain('dueno1');
    await page.reload();
    await esperarCarga(page);
    expect(await page.evaluate(() => adminAutenticado)).toBe(false);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
    await irA(page, 'egresos');
    await expect(page.locator('#egresos-login')).toBeVisible();
  });

  test('"Cerrar sesión" del candado: vuelve a caja, se bloquea todo y se borra lo de admin de la memoria', async ({ page }) => {
    const reg = await abrirSistema(page);
    await entrarComoAdmin(page);
    expect(await page.evaluate(() => ST.egresos.length)).toBeGreaterThan(0);
    await irA(page, 'egresos');
    await page.locator('#egresos-contenido').getByRole('button', { name: /Cerrar sesión/ }).click();
    await expect(page.locator('#tab-ingresos')).toHaveClass(/active/);       // vuelve a Pedidos
    await expect(page.locator('#egresos-contenido')).toBeHidden();
    await expect(page.locator('#tab-nav-egresos')).toBeHidden();
    expect(await page.evaluate(() => ({ e: ST.egresos.length, m: ST.movimientosCaja.length, i: ST.ingresosExtra.length, x: ST.pedidosEliminados.length }))).toEqual({ e: 0, m: 0, i: 0, x: 0 });
    await expect.poll(() => reg.auth.includes('logout')).toBe(true);
    // las siguientes peticiones vuelven a usar el token de caja
    const antes = reg.rest.length;
    await page.evaluate(() => sbGet('mesas'));
    expect(reg.rest.slice(antes).map(r => r.rol)).toEqual(['caja']);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
    await expect(page.locator('#tab-nav-datos')).toBeHidden();
  });

  test('admin que entró directo: "Cerrar sesión" del candado lo saca del sistema', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    await irA(page, 'egresos');
    await page.locator('#egresos-contenido').getByRole('button', { name: /Cerrar sesión/ }).click();
    await esperarEntrada(page);
    expect(reg.auth).toContain('logout');
  });

  test('si la autorización de admin deja de valer en pleno trabajo, vuelve a caja y avisa', async ({ page }) => {
    const reg = await abrirSistema(page);
    await entrarComoAdmin(page);
    await page.evaluate(() => { sesionAdmin.expires_at = Math.floor(Date.now() / 1000) - 5; });
    reg.control.rechazarRefresh = true;                       // el servidor ya no renueva esa sesión
    await page.evaluate(() => sbGet('egresos').catch(() => null));
    await expect(page.locator('.toast.warning', { hasText: 'autorización de administrador venció' })).toBeVisible();
    expect(await page.evaluate(() => adminAutenticado)).toBe(false);
    expect(await page.evaluate(() => ST.egresos.length)).toBe(0);
    await expect(page.locator('#rolBadge')).toHaveText('👤 Caja');
    expect(await loginVisible(page)).toBe(false);             // la sesión de caja sigue viva
  });

  test('si la sesión de caja deja de valer en pleno trabajo, vuelve a la entrada', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => { sesionBase.expires_at = Math.floor(Date.now() / 1000) - 5; });
    reg.control.rechazarRefresh = true;
    await page.evaluate(() => sbGet('mesas').catch(() => null));
    await esperarEntrada(page);
    await expect(page.locator('#login-error')).toContainText('Tu sesión venció');
    expect(await guardado(page)).toBeNull();
  });
});

// ── Numerito de Auditoría ────────────────────────────────────────────────────
// ── Funciones de administrador DENTRO de las pestañas que caja sí ve ──────────────────────
// Con caja: sin Respaldo/Excel (pestaña Datos), sin Cierre manual, sin Historial de cierres, sin aviso de
// respaldo y ninguna cajita de usuario/contraseña de administrador. Para todo eso: Salir e ingresar
// como administrador. (Ocultar es comodidad; la seguridad real son las reglas de la base.)
test.describe('funciones de administrador ocultas para caja', () => {
  const PESTANAS_CAJA = ['ingresos', 'pendientes', 'fiados', 'diaadia', 'inventario', 'menu'];
  const CIERRE_ADMIN = ['#btn-cierre-manual', '#dd-historial-panel'];       // dentro de la pestaña Cierre
  // Se comprueba en la pestaña donde viven (si no, "oculto" sería trivial: la pestaña misma está cerrada).
  async function controlesAdmin(page, visibles) {
    const chequear = visibles ? sel => expect(page.locator(sel), sel).toBeVisible() : sel => expect(page.locator(sel), sel).toBeHidden();
    await irA(page, 'diaadia');
    for (const sel of CIERRE_ADMIN) await chequear(sel);
  }

  test('caja: en ninguna de sus 6 pestañas aparece un control de administrador ni una cajita de contraseña', async ({ page }) => {
    const datos = JSON.parse(JSON.stringify(require('./fixtures/datos').datos));
    datos.config = [{ clave: 'ultimo_respaldo', valor: { fecha: '2026-09-01' } }];   // respaldo viejo: al admin le saldría el aviso rojo
    await abrirSistema(page, { datos });
    await controlesAdmin(page, false);
    for (const id of PESTANAS_CAJA) {
      await irA(page, id);
      const visible = await page.evaluate(() => {
        const vis = el => { for (let n = el; n; n = n.parentElement) { if (getComputedStyle(n).display === 'none') return false; } return true; };
        const textoVisible = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.children.length === 0).map(e => e.textContent).join(' | ');
        return {
          claves: [...document.querySelectorAll('input[type=password]')].filter(vis).map(e => e.id),
          texto: /administrador|Historial completo|Cierre manual|Exportar|Importar|respaldo/i.test(textoVisible)
            ? (textoVisible.match(/[^|]*(administrador|Historial completo|Cierre manual|Exportar|Importar|respaldo)[^|]*/i) || [''])[0].trim() : '',
        };
      });
      expect(visible.claves, `cajitas de contraseña visibles en ${id}`).toEqual([]);
      expect(visible.texto, `texto de administrador visible en ${id}`).toBe('');
    }
    await expect(page.locator('#aviso-respaldo')).toBeHidden();
  });

  test('arrancan ocultos: antes de saber quién entró (pantalla de entrada) no asoma ningún control de administrador', async ({ page }) => {
    await abrirSistema(page, { usuario: null });
    const estilos = await page.evaluate(sels => sels.map(s => [s, getComputedStyle(document.querySelector(s)).display]), CIERRE_ADMIN);
    for (const [sel, display] of estilos) expect(display, sel).toBe('none');
  });

  test('admin: los ve todos y el Historial de cierres muestra su contenido (sin candado)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await controlesAdmin(page, true);
    await expect(page.locator('#dd-historial-contenido')).toBeVisible();
    await expect(page.locator('#dd-historial-login')).toBeHidden();
  });

  test('un administrador autorizado en el sitio los ve; al volver a caja desaparecen', async ({ page }) => {
    await abrirSistema(page);
    await entrarComoAdmin(page);
    await controlesAdmin(page, true);
    await page.evaluate(() => cerrarSesionAdmin());
    await controlesAdmin(page, false);
  });

  test('si caja llama a mano el cierre manual (abrir o corregir), se niega: no abre ventana ni pide contraseña', async ({ page }) => {
    await abrirSistema(page);
    await page.evaluate(() => abrirModalCierreManual());
    await expect(page.locator('.toast.warning').last()).toContainText('solo para administradores');
    await expect(page.locator('#modal-cierre-manual')).toBeHidden();
    await page.evaluate(() => editarCierreManual('2026-10-05', 'almuerzo'));
    await expect(page.locator('#modal-cierre-manual')).toBeHidden();
  });

  test('un cierre de otro día ya guardado: caja ve el aviso de "ingresar como administrador", sin botón de corregir', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-18'; ddTurno = 'almuerzo'; onFechaCierreChange(); });
    await expect(page.locator('#dd-cerrado-mensaje')).toContainText('ingresa como administrador');
    await expect(page.locator('#dd-cerrado-mensaje')).not.toContainText('Historial');
    await expect(page.locator('#btn-corregir-cierre')).toBeHidden();
    await page.evaluate(() => corregirCierreActual());
    await expect(page.locator('.toast.warning').last()).toContainText('ingresa como administrador');
  });
});

test.describe('numerito de novedades en Auditoría', () => {
  const VISTOS = 'elLobo_auditoria_vistos';

  test('caja no lo ve y abrir el candado no pisa lo que ya vio un administrador', async ({ page }) => {
    await abrirSistema(page);
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['elim:1', 'desc:1'])), VISTOS);
    await expect(page.locator('#audit-badge')).toBeHidden();   // en los datos de ejemplo SÍ hay un ajuste manual
    await irA(page, 'auditoria');
    await expect(page.locator('#audit-badge')).toBeHidden();
    expect(await page.evaluate(k => localStorage.getItem(k), VISTOS)).toBe(JSON.stringify(['elim:1', 'desc:1']));
  });

  test('admin: ve cuántas novedades hay (ajuste + eliminado + descuento) y se apaga al abrir Auditoría', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await expect(page.locator('#audit-badge')).toHaveText('3');
    await irA(page, 'auditoria');
    await expect(page.locator('#audit-badge')).toBeHidden();
  });
});

// ── La pantalla NO es la barrera: el servidor lo es ───────────────────────────
test.describe('el candado de pantalla no es la seguridad', () => {
  test('caja que fuerza la bandera de admin por consola: el servidor no le da nada de finanzas', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => { adminAutenticado = true; renderAll(); });   // trampa
    // en pantalla se abre el contenido…
    await irA(page, 'egresos');
    // …pero está vacío, porque nunca se pidieron esas tablas y, si se piden, el servidor las niega
    expect(await page.evaluate(() => ST.egresos.length)).toBe(0);
    const filas = await page.evaluate(async () => (await sbGetAll('egresos')).length + (await sbGetAll('movimientos_caja')).length + (await sbGetAll('ingresos_extra')).length);
    expect(filas).toBe(0);
    expect(reg.denegadas).toEqual(expect.arrayContaining(['caja S egresos', 'caja S movimientos_caja', 'caja S ingresos_extra']));
    // y tampoco puede escribir en ellas
    await page.evaluate(async () => { try { await sbInsert('egresos', { fecha: '2026-10-20', cat: 'otro', monto: 1, description: 'trampa' }); } catch (e) {} });
    expect(reg.denegadas).toContain('caja I egresos');
  });

  test('caja no puede leer ni cambiar el rastro de auditoría', async ({ page }) => {
    const reg = await abrirSistema(page);
    const leidas = await page.evaluate(async () => (await sbGetAll('pedidos_eliminados')).length + (await sbGetAll('pedidos_descuentos')).length);
    expect(leidas).toBe(0);
    await page.evaluate(async () => {
      await sbPatch('pedidos_eliminados', 'id=eq.1', { motivo: 'borrado' }).catch(() => {});
      await sbDelete('pedidos_eliminados', 'id=eq.1').catch(() => {});
    });
    expect(reg.denegadas).toEqual(expect.arrayContaining(['caja S pedidos_eliminados', 'caja S pedidos_descuentos', 'caja U pedidos_eliminados', 'caja D pedidos_eliminados']));
  });

  test('sin sesión, la llave pública sola no da acceso a nada (el servidor responde 401)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: null });
    const r = await page.evaluate(async () => {
      const x = await fetch(`${SB_URL}/rest/v1/pedidos`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
      return x.status;
    });
    expect(r).toBe(401);
    expect(reg.denegadas).toContain('anon S pedidos');
  });
});

// ── Lo que hay (y lo que no) dentro del archivo del sistema ─────────────────
test.describe('contenido del archivo', () => {
  test('ya no hay ninguna contraseña escrita en el código ni comparación de clave en pantalla', () => {
    expect(HTML_TEXTO).not.toContain('ADMIN_PASSWORD');
    expect(HTML_TEXTO).not.toMatch(/input\.value\s*===/);
  });

  test('la única llave dentro del archivo es la PÚBLICA (anon); nunca una de servicio', () => {
    const jwts = HTML_TEXTO.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
    expect(jwts.length).toBe(1);
    const payload = JSON.parse(Buffer.from(jwts[0].split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('anon');
    expect(HTML_TEXTO).not.toMatch(/service_role/);
  });

  test('el archivo no guarda claves de usuarios (nada de "password" asignado a literales)', () => {
    expect(HTML_TEXTO).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
  });
});
