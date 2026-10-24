// Backend FALSO de Supabase para las pruebas. Nada sale a internet.
//
// - Toda petición http(s) de la página se atiende aquí, localmente: las de Supabase con
//   los datos de ejemplo, las de fuentes/librerías (CDN) con una respuesta vacía.
// - Supabase Auth falso (/auth/v1/token, /auth/v1/logout): usuarios de prueba con rol
//   (admin, caja, respaldo, sin rol) y tokens (JWT) con el rol dentro, igual que el real.
// - Cualquier otra ruta de supabase.co se registra en `noManejadas` y la prueba debe fallar.
// - Los permisos se hacen cumplir como lo hará Supabase con RLS (matriz en helpers/permisos.js):
//     · sin sesión (llave pública sola) → 401 en todo;
//     · lectura sin permiso → 200 con lista vacía;  · crear sin permiso → 403;
//     · modificar/borrar sin permiso → 200 sin tocar nada (0 filas).
//   Todo lo denegado queda en `denegadas`: un flujo normal de un rol NUNCA debe dejar nada ahí.
// - GET devuelve la tabla completa (respeta limit/offset y manda Content-Range como
//   PostgREST). NO aplica filtros (eq., in., ...): para esta red de pruebas basta.
// - POST/PATCH/DELETE responden con éxito y quedan registrados en `escrituras`.
const path = require('path');
const { pathToFileURL } = require('url');
const { datos: DATOS_BASE, FECHA_HOY } = require('../fixtures/datos');
const { OPERACION_HTTP, puede } = require('./permisos');

const HTML = path.resolve(__dirname, '../../Contabilidad/ElLobo-Sistema Contable.html');
const URL_HTML = pathToFileURL(HTML).href;

// Tablas que pide loadState() según el rol. Admin = las 16; caja = solo las operativas (12).
const TABLAS_LOADSTATE = [
  'pedidos', 'egresos', 'inventario', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia',
  'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados',
  'clientes_fiado', 'abonos_fiado', 'pedidos_descuentos', 'config',
];
const TABLAS_SOLO_ADMIN = ['egresos', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'pedidos_descuentos'];
const TABLAS_CAJA = TABLAS_LOADSTATE.filter(t => !TABLAS_SOLO_ADMIN.includes(t));

// Usuarios de prueba (ficticios). La clave NO es ninguna clave real.
const USUARIOS = {
  'caja@lobo.test':     { password: 'clave-caja',     rol: 'caja' },
  'dueno1@lobo.test':   { password: 'clave-dueno1',   rol: 'admin' },
  'dueno2@lobo.test':   { password: 'clave-dueno2',   rol: 'admin' },
  'respaldo@lobo.test': { password: 'clave-respaldo', rol: 'respaldo' },
  'sinrol@lobo.test':   { password: 'clave-sinrol',   rol: null },
};
const USUARIO_POR_ROL = { caja: 'caja@lobo.test', admin: 'dueno1@lobo.test' };

function copiaProfunda(x) { return JSON.parse(JSON.stringify(x)); }
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

/**
 * Abre el sistema con el backend falso.
 * @param page   página de Playwright
 * @param opciones.datos   datos por tabla (por defecto, los de ejemplo)
 * @param opciones.fecha   fecha "de hoy" fija (por defecto 2026-10-20, 14:00 Bogotá)
 * @param opciones.usuario  quién tiene sesión al abrir:
 *          'caja' (por defecto) → sesión de caja ya guardada en el equipo, como en el mostrador;
 *          'admin'              → entra tecleando el correo y la clave en la pantalla de entrada;
 *          null                 → sin sesión: se queda en la pantalla de entrada.
 * @param opciones.sesionGuardada  sesión de caja guardada a medida (p. ej. vencida) — pisa a `usuario`
 * @param opciones.vigenciaToken   segundos de vida de los tokens nuevos (por defecto 3600)
 * @param opciones.esperarLogin   true → no espera a que cargue: espera la pantalla de entrada (p. ej. sesión guardada vencida y rechazada)
 * @param opciones.authFalla       'red' | '500' | '429' → el servicio de acceso falla así
 * @param opciones.rechazarRefresh true → toda renovación de token es rechazada (sesión revocada)
 * @param opciones.tablasFaltantes  tablas que "no existen" en Supabase (responden 404), p. ej. ['config']
 * @param opciones.totalesFalsos    { tabla: n } → el header Content-Range de esa tabla dice n (para simular filas que faltan)
 * @returns { errores, peticiones, escrituras, noManejadas, avisos, auth, rest, denegadas, intentos401 }
 */
async function abrirSistema(page, opciones = {}) {
  const datos = opciones.datos || copiaProfunda(DATOS_BASE);
  const fecha = opciones.fecha || new Date(`${FECHA_HOY}T14:00:00-05:00`);
  const ahoraSeg = Math.floor(fecha.getTime() / 1000);
  const vigencia = opciones.vigenciaToken ?? 3600;
  const usuario = opciones.usuario === undefined ? 'caja' : opciones.usuario;
  const reg = {
    errores: [], peticiones: [], escrituras: [], noManejadas: [], avisos: [],
    auth: [],        // 'password:correo' | 'refresh:correo' | 'logout'
    rest: [],        // { rol, metodo, tabla } de cada llamada a /rest/v1
    denegadas: [],   // 'rol OP tabla' que la matriz de permisos no deja hacer
    logoutScopes: [], // 'local' = cierra solo esta sesión (no saca a otros equipos)
    tokens: {},      // lo último emitido por correo (para inspeccionar)
    // Interruptores que una prueba puede mover EN MEDIO de la prueba:
    control: { rechazarRefresh: !!opciones.rechazarRefresh, authFalla: opciones.authFalla || null },
  };

  // ── Auth falso ────────────────────────────────────────────────────────
  const refrescos = new Map();   // refresh_token → correo
  let n = 0;
  function emitir(correo) {
    n += 1;
    const u = USUARIOS[correo];
    const exp = ahoraSeg + vigencia;
    const app_metadata = u.rol ? { rol: u.rol } : {};
    const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: `uid-${correo}`, email: correo, role: 'authenticated', app_metadata, exp, iat: ahoraSeg })}.firma-falsa-${n}`;
    const refresh_token = `refresh-${n}-${correo}`;
    refrescos.set(refresh_token, correo);
    reg.tokens[correo] = { access_token, refresh_token };
    return { access_token, token_type: 'bearer', expires_in: vigencia, expires_at: exp, refresh_token,
             user: { id: `uid-${correo}`, email: correo, app_metadata } };
  }
  // Sesión como la guarda el sistema en el equipo (solo caja se guarda).
  function sesionGuardable(correo, extra = {}) {
    const r = emitir(correo);
    return Object.assign({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at, email: correo, rol: USUARIOS[correo].rol }, extra);
  }
  reg.emitirSesion = sesionGuardable;   // para que una prueba arme sesiones a medida

  const rolDelToken = bearer => {
    try {
      const p = JSON.parse(Buffer.from((bearer || '').split('.')[1], 'base64url').toString());
      return p.app_metadata && p.app_metadata.rol ? p.app_metadata.rol : (p.role === 'authenticated' ? 'sin-rol' : null);
    } catch (e) { return null; }
  };

  page.on('pageerror', e => reg.errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') reg.errores.push('console.error: ' + m.text()); });

  await page.clock.setFixedTime(fecha);

  // Sesión de caja ya guardada en el equipo (como en el mostrador).
  let guardada = opciones.sesionGuardada || null;
  if (!guardada && usuario === 'caja') guardada = sesionGuardable(USUARIO_POR_ROL.caja);
  if (guardada) {
    // Se siembra UNA vez por pestaña (no en cada recarga): así "Salir" y "recargar" se comportan como en la vida real.
    await page.addInitScript(([clave, valor]) => {
      try {
        if (!sessionStorage.getItem('__prueba_sembrada')) { localStorage.setItem(clave, valor); sessionStorage.setItem('__prueba_sembrada', '1'); }
      } catch (e) {}
    }, ['ellobo.sesion.caja.v1', JSON.stringify(guardada)]);
  }

  await page.route(/^https?:\/\//, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname.endsWith('supabase.co')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range' };

      // ── /auth/v1/... ──
      const ma = url.pathname.match(/^\/auth\/v1\/(token|logout)$/);
      if (ma) {
        if (reg.control.authFalla === 'red') return route.abort('failed');
        if (reg.control.authFalla === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"msg":"error"}' });
        if (reg.control.authFalla === '429') return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error_code":"over_request_rate_limit"}' });
        if (ma[1] === 'logout') {
          reg.auth.push('logout');
          reg.logoutScopes.push(url.searchParams.get('scope'));
          return route.fulfill({ status: 204, headers: cors, body: '' });
        }
        let cuerpo = {};
        try { cuerpo = req.postDataJSON() || {}; } catch (e) { /* sin cuerpo */ }
        const tipo = url.searchParams.get('grant_type');
        if (tipo === 'password') {
          const u = USUARIOS[cuerpo.email];
          if (!u || u.password !== cuerpo.password) {
            reg.auth.push(`password-fallido:${cuerpo.email}`);
            return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
          }
          reg.auth.push(`password:${cuerpo.email}`);
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(emitir(cuerpo.email)) });
        }
        if (tipo === 'refresh_token') {
          const correo = refrescos.get(cuerpo.refresh_token);
          if (reg.control.rechazarRefresh || !correo) {
            reg.auth.push('refresh-rechazado');
            return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }) });
          }
          reg.auth.push(`refresh:${correo}`);
          refrescos.delete(cuerpo.refresh_token);   // Supabase rota el refresh_token: el viejo ya no sirve
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(emitir(correo)) });
        }
      }

      // ── /rest/v1/... ──
      const m = url.pathname.match(/^\/rest\/v1\/([^/]+)/);
      if (!m) {
        reg.noManejadas.push(`${req.method()} ${url.pathname}`);
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no manejada en las pruebas"}' });
      }
      const tabla = m[1];
      const metodo = req.method();
      const cabeceras = await req.allHeaders();
      const bearer = (cabeceras['authorization'] || '').replace(/^Bearer\s+/i, '');
      const rol = rolDelToken(bearer);          // null = llave pública sola / token inválido
      reg.rest.push({ rol, metodo, tabla });

      if ((opciones.tablasFaltantes || []).includes(tabla)) {
        reg.peticiones.push(tabla);
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: '42P01', message: `relation "public.${tabla}" does not exist` }) });
      }

      // Permisos (como RLS).
      const op = OPERACION_HTTP[metodo];
      if (rol === null) {
        reg.denegadas.push(`anon ${op} ${tabla}`);
        return route.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '42501', message: `permission denied for table ${tabla}` }) });
      }
      if (!puede(rol, tabla, op)) {
        reg.denegadas.push(`${rol} ${op} ${tabla}`);
        if (op === 'I') return route.fulfill({ status: 403, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '42501', message: `new row violates row-level security policy for table "${tabla}"` }) });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': '*/0' }, body: '[]' });
      }
      // PostgREST: insertar y pedir la fila de vuelta exige poder LEER esa tabla.
      const pideFila = /return=representation/.test(cabeceras['prefer'] || '');
      if (op === 'I' && pideFila && !puede(rol, tabla, 'S')) {
        reg.denegadas.push(`${rol} I+retorno ${tabla}`);
        return route.fulfill({ status: 403, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '42501', message: `new row violates row-level security policy for table "${tabla}"` }) });
      }

      if (metodo === 'GET') {
        reg.peticiones.push(tabla);
        if (!(tabla in datos)) { reg.avisos.push(`tabla sin datos de ejemplo: ${tabla}`); }
        const filas = datos[tabla] || [];
        const limit = parseInt(url.searchParams.get('limit') || filas.length, 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const lote = filas.slice(offset, offset + limit);
        const totalDicho = (opciones.totalesFalsos || {})[tabla] ?? filas.length;
        const rango = lote.length ? `${offset}-${offset + lote.length - 1}/${totalDicho}` : `*/${totalDicho}`;
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'content-range': rango, ...cors },
          body: JSON.stringify(lote) });
      }
      let cuerpo = null;
      try { cuerpo = req.postDataJSON(); } catch (e) { /* sin cuerpo */ }
      reg.escrituras.push({ metodo, tabla, consulta: url.search, cuerpo, rol, prefer: cabeceras['prefer'] || '' });
      if (metodo === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (metodo === 'POST' && !pideFila) return route.fulfill({ status: 201, contentType: 'application/json', body: '' });
      const devolver = Array.isArray(cuerpo) ? cuerpo : [cuerpo || {}];
      const conId = devolver.map((f, i) => Object.assign({ id: 9000 + reg.escrituras.length * 10 + i }, f));
      return route.fulfill({ status: metodo === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(conId) });
    }
    // Fuentes de Google, librería xlsx (CDN), etc.: respuesta vacía, sin salir a internet.
    const tipo = /\.css|fonts\.googleapis/.test(req.url()) ? 'text/css' : 'application/javascript';
    return route.fulfill({ status: 200, contentType: tipo, body: '' });
  });

  await page.goto(URL_HTML);

  if (usuario === 'admin' || (typeof usuario === 'string' && usuario.includes('@'))) {
    // Entra tecleando en la pantalla de entrada, como lo haría un dueño.
    const correo = usuario === 'admin' ? USUARIO_POR_ROL.admin : usuario;
    await page.waitForFunction(() => { const o = document.getElementById('loginOverlay'); return o && getComputedStyle(o).display !== 'none'; }, null, { timeout: 15000 });
    await page.fill('#login-email', correo);
    await page.fill('#login-password', USUARIOS[correo].password);
    await page.click('#login-btn');
  }

  if (opciones.esperarLogin || (usuario === null && !guardada)) {
    // Sin sesión: se queda en la pantalla de entrada.
    await page.waitForFunction(() => { const o = document.getElementById('loginOverlay'); return o && getComputedStyle(o).display !== 'none'; }, null, { timeout: 15000 });
    return reg;
  }
  // loadState() oculta el overlay de carga al terminar.
  await page.waitForFunction(() => {
    const o = document.getElementById('loadingOverlay');
    const l = document.getElementById('loginOverlay');
    return o && getComputedStyle(o).display === 'none' && l && getComputedStyle(l).display === 'none';
  }, null, { timeout: 15000 });
  return reg;
}

module.exports = { abrirSistema, TABLAS_LOADSTATE, TABLAS_CAJA, TABLAS_SOLO_ADMIN, USUARIOS, USUARIO_POR_ROL, URL_HTML, FECHA_HOY };
