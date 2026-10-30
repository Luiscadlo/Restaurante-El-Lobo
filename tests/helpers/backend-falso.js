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
// - CANDADO DE DÍAS (helpers/candado.js, copia en JS de sql/candado_dias.sql): caja no puede cambiar datos de días
//   anteriores. El servidor falso lo hace cumplir (403 con el mismo mensaje) sobre una «sombra» de las tablas con
//   candado que se va actualizando con las escrituras; también queda en `denegadas`. El reloj del candado es
//   `reg.control.ahora` (por defecto la fecha de la prueba); `reg.fijarReloj(fecha)` mueve el del candado y el del navegador.
// - GET devuelve la tabla completa (respeta limit/offset y manda Content-Range como
//   PostgREST). NO aplica filtros (eq., in., ...): para esta red de pruebas basta.
// - POST/PATCH/DELETE responden con éxito y quedan registrados en `escrituras`.
// - RPC (/rest/v1/rpc/...): solo las dos funciones de sql/restaurar_respaldo.sql (lobo_restaurar_respaldo y
//   lobo_empezar_de_cero), con el mismo permiso (solo admin) y la misma palabra de confirmación que la base de verdad;
//   reemplazan/vacían los datos del servidor falso (reg.datos) para que la pantalla los vuelva a leer. Cada llamada
//   queda en `reg.rpc`. `opciones.rpcFalla` ('red' | 'no-instalada' | 'servidor' | {status, cuerpo}) las hace fallar.
const path = require('path');
const { pathToFileURL } = require('url');
const { datos: DATOS_BASE, FECHA_HOY } = require('../fixtures/datos');
const { OPERACION_HTTP, puede } = require('./permisos');
const { evaluarCandado, TABLAS_CON_CANDADO } = require('./candado');

const HTML = path.resolve(__dirname, '../../Contabilidad/ElLobo-Sistema Contable.html');
const URL_HTML = pathToFileURL(HTML).href;

// Tablas que pide loadState() según el rol. Admin = las 17; caja = solo las operativas (12; entre ellas la configuración, que sí puede leer).
const TABLAS_LOADSTATE = [
  'pedidos', 'egresos', 'inventario', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia',
  'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados',
  'clientes_fiado', 'abonos_fiado', 'pedidos_descuentos', 'config', 'configuracion',
];
const TABLAS_SOLO_ADMIN = ['egresos', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'pedidos_descuentos'];
const TABLAS_CAJA = TABLAS_LOADSTATE.filter(t => !TABLAS_SOLO_ADMIN.includes(t));

// Usuarios de prueba (ficticios). La clave NO es ninguna clave real.
const USUARIOS = {
  'caja@elobo.test':     { password: 'clave-caja',     rol: 'caja' },
  'dueno1@elobo.test':   { password: 'clave-dueno1',   rol: 'admin' },
  'dueno2@elobo.test':   { password: 'clave-dueno2',   rol: 'admin' },
  'admin@elobo.test':    { password: 'clave-admin',    rol: 'admin' },   // el usuario genérico «admin» (la insignia dice solo «👑 Admin»)
  'respaldo@elobo.test': { password: 'clave-respaldo', rol: 'respaldo' },
  'sinrol@elobo.test':   { password: 'clave-sinrol',   rol: null },
};
const USUARIO_POR_ROL = { caja: 'caja@elobo.test', admin: 'dueno1@elobo.test' };

function copiaProfunda(x) { return JSON.parse(JSON.stringify(x)); }

// Réplica de seguridad.validar_configuracion (sql/configuracion.sql): mismas claves, mismos rangos, mismos textos de error.
// Devuelve null si el valor es válido, o { code, message, details } como lo devolvería PostgREST.
const RANGOS_CONFIG = {
  mesas: [1, 60, 'El número de mesas'], recargo_para_llevar: [0, 50000, 'El recargo de «para llevar»'],
  empaque_domicilio: [0, 50000, 'El empaque de domicilio'], respaldo_dia_semana: [0, 6, 'El día del respaldo semanal'],
  respaldo_rojo_dias: [7, 60, 'Los días para el aviso rojo del respaldo'],
};
function validarConfiguracion(clave, valor) {
  const mal = message => ({ code: '22023', message, details: 'configuracion_invalida', hint: null });
  if (RANGOS_CONFIG[clave]) {
    const [min, max, nombre] = RANGOS_CONFIG[clave];
    if (typeof valor !== 'number') return mal(`${nombre} debe ser un número.`);
    if (!Number.isInteger(valor) || valor < min || valor > max) return mal(`${nombre} debe ser un número entero entre ${min} y ${max}.`);
    return null;
  }
  if (clave === 'negocio_nombre' || clave === 'negocio_emoji') {
    if (typeof valor !== 'string') return mal(`El valor de ${clave} debe ser un texto.`);
    const largo = [...valor].length;
    if (clave === 'negocio_nombre' && (valor.trim().length < 1 || largo > 40 || valor !== valor.trim())) return mal('El nombre del negocio debe tener entre 1 y 40 caracteres, sin espacios al principio ni al final.');
    if (clave === 'negocio_emoji' && largo > 8) return mal('El símbolo del negocio puede tener hasta 8 caracteres.');
    return null;
  }
  return { code: '22023', message: `La configuración "${clave}" no existe.`, details: 'configuracion_clave_desconocida', hint: null };
}
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
 * @param opciones.url            página a abrir (por defecto el sistema real); p. ej. la copia de pruebas generada
 * @param opciones.claveSesion    nombre con que la página guarda la sesión de caja (por defecto el de producción)
 * @param opciones.authFalla       'red' | '500' | '429' → el servicio de acceso falla así
 * @param opciones.rechazarRefresh true → toda renovación de token es rechazada (sesión revocada)
 * @param opciones.tablasFaltantes  tablas que "no existen" en Supabase (responden 404), p. ej. ['config']
 * @param opciones.totalesFalsos    { tabla: n } → el header Content-Range de esa tabla dice n (para simular filas que faltan)
 * @param opciones.rpcFalla         'red' | 'no-instalada' | 'servidor' | { status, cuerpo } → las funciones de restaurar fallan así
 * @param opciones.rpcRetraso       ms que tardan en responder las funciones de restaurar (para probar «en pleno proceso»)
 * @param opciones.rpcDespuesFalso  { tabla: n } → la función dice que quedaron n filas en esa tabla (para probar el aviso de diferencias)
 * (`reg.control.tablasFaltantes` se puede cambiar en plena prueba: las tablas listadas responden 404)
 * @returns { errores, peticiones, escrituras, noManejadas, avisos, auth, rest, denegadas, intentos401, control, fijarReloj }
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
    hosts: new Set(), // direcciones de supabase.co con las que habló la página
    rpc: [],         // { fn, rol, cuerpo } de cada llamada a /rest/v1/rpc/...
    datos,           // los datos del servidor falso (las funciones de restaurar los cambian)
    tokens: {},      // lo último emitido por correo (para inspeccionar)
    // Interruptores que una prueba puede mover EN MEDIO de la prueba:
    control: { rechazarRefresh: !!opciones.rechazarRefresh, authFalla: opciones.authFalla || null, ahora: fecha, rpcFalla: opciones.rpcFalla || null, rpcRetraso: opciones.rpcRetraso || 0, rpcDespuesFalso: opciones.rpcDespuesFalso || null, tablasFaltantes: opciones.tablasFaltantes || [] },
  };
  // Estado de las tablas con candado tal como lo dejan las escrituras (el GET sigue devolviendo los datos de la prueba).
  const sombra = {};
  for (const t of TABLAS_CON_CANDADO) sombra[t] = copiaProfunda(datos[t] || []);
  const filasDe = (tabla, search) => {
    const condiciones = [...new URLSearchParams(search).entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'columns'].includes(k));
    return sombra[tabla].filter(f => condiciones.every(([col, expr]) => {
      const v = String(f[col]);
      if (expr.startsWith('eq.')) return v === expr.slice(3);
      if (expr.startsWith('in.(')) return expr.slice(4, -1).split(',').includes(v);
      return false;
    }));
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

  reg.fijarReloj = async nueva => { reg.control.ahora = nueva; await page.clock.setFixedTime(nueva); };

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
    }, [opciones.claveSesion || 'ellobo.sesion.caja.v1', JSON.stringify(guardada)]);
  }

  await page.route(/^https?:\/\//, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname.endsWith('supabase.co')) {
      reg.hosts.add(url.hostname);
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

      // ── /rest/v1/rpc/... (restaurar / empezar de cero) ──
      const mr = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (mr) {
        const fn = mr[1];
        const cab = await req.allHeaders();
        const rolRpc = rolDelToken((cab['authorization'] || '').replace(/^Bearer\s+/i, ''));
        let cuerpoRpc = null;
        try { cuerpoRpc = req.postDataJSON(); } catch (e) { /* sin cuerpo */ }
        reg.rpc.push({ fn, rol: rolRpc, cuerpo: cuerpoRpc });
        reg.rest.push({ rol: rolRpc, metodo: 'POST', tabla: `rpc/${fn}` });   // para comparar el ORDEN con las demás peticiones
        const json = (status, o) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(o) });
        const err = (status, code, message, details) => json(status, { code, message, details: details || null, hint: null });
        if (reg.control.rpcRetraso) await new Promise(r => setTimeout(r, reg.control.rpcRetraso));
        const falla = reg.control.rpcFalla;
        if (falla === 'red') return route.abort('failed');
        if (falla === 'no-instalada') return err(404, 'PGRST202', `Could not find the function public.${fn} in the schema cache`);
        if (falla === 'servidor') return route.fulfill({ status: 502, contentType: 'text/html', headers: cors, body: '<html>Bad gateway</html>' });
        if (falla && typeof falla === 'object') return json(falla.status, falla.cuerpo);
        if (!['lobo_restaurar_respaldo', 'lobo_empezar_de_cero'].includes(fn)) {
          reg.noManejadas.push(`${req.method()} ${url.pathname}`);
          return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no manejada en las pruebas"}' });
        }
        if (rolRpc === null) return err(401, '42501', `permission denied for function ${fn}`);
        const contar = () => Object.fromEntries(TABLAS_LOADSTATE.map(t => [t, (datos[t] || []).length]));
        const reponerSombra = t => { if (TABLAS_CON_CANDADO.includes(t)) sombra[t] = copiaProfunda(datos[t] || []); };
        if (fn === 'lobo_restaurar_respaldo') {
          if (rolRpc !== 'admin') return err(403, '42501', 'Solo el administrador puede restaurar un respaldo.', 'restaurar_solo_admin');
          if (!cuerpoRpc || cuerpoRpc.p_confirmacion !== 'RESTAURAR') return err(400, '22023', 'Falta la palabra de confirmación (RESTAURAR).', 'restaurar_sin_confirmacion');
          const rp = cuerpoRpc.p_respaldo;
          const malo = !rp || rp.version !== 1 || typeof rp.tablas !== 'object' || typeof rp.conteos !== 'object'
            || Object.keys(rp.tablas).some(t => !TABLAS_LOADSTATE.includes(t))
            || Object.entries(rp.tablas).some(([t, f]) => !Array.isArray(f) || rp.conteos[t] !== f.length)
            || TABLAS_LOADSTATE.some(t => !(t in rp.tablas) && !['config', 'pedidos_descuentos', 'configuracion'].includes(t));
          if (malo) return err(400, '22023', 'El archivo no es un respaldo completo de El Lobo (versión 1). No se cambió nada.', 'respaldo_invalido');
          const antes = contar();
          for (const [t, filas] of Object.entries(rp.tablas)) { datos[t] = copiaProfunda(filas); reponerSombra(t); }
          return json(200, { ok: true, accion: 'restaurar', antes, despues: { ...contar(), ...(reg.control.rpcDespuesFalso || {}) }, restauradas: Object.keys(rp.tablas),
                             sin_cambios: TABLAS_LOADSTATE.filter(t => !(t in rp.tablas)) });
        }
        if (rolRpc !== 'admin') return err(403, '42501', 'Solo el administrador puede empezar de cero.', 'cero_solo_admin');
        if (!cuerpoRpc || cuerpoRpc.p_confirmacion !== 'BORRAR TODO') return err(400, '22023', 'Falta la palabra de confirmación (BORRAR TODO).', 'cero_sin_confirmacion');
        const antes = contar();
        for (const t of TABLAS_LOADSTATE) {
          if (t === 'mesas') { datos.mesas = (datos.mesas || []).map(m => ({ ...m, estado: 'libre' })); continue; }
          if (t === 'configuracion') continue;          // la configuración del negocio no es un dato de trabajo: se conserva
          if (t === 'inventario' && !cuerpoRpc.p_borrar_inventario) continue;
          datos[t] = []; reponerSombra(t);
        }
        return json(200, { ok: true, accion: 'empezar_de_cero', antes, despues: contar() });
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

      if (reg.control.tablasFaltantes.includes(tabla)) {
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
      // Configuración: el disparador de la base valida, y pone él mismo vigente_desde / creado_en / creado_por.
      if (tabla === 'configuracion' && metodo === 'POST') {
        const nuevas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo || {}]);
        const malo = nuevas.map(f => validarConfiguracion(f.clave, f.valor)).find(Boolean);
        if (malo) { reg.denegadas.push(`${rol} I configuracion (valor inválido)`); return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify(malo) }); }
        const correo = (() => { try { return JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).email || ''; } catch (e) { return ''; } })();
        const sello = reg.control.ahora.toISOString();
        const guardadas = nuevas.map(f => {
          const maxId = (datos.configuracion || []).reduce((m, x) => Math.max(m, x.id || 0), 0);
          const fila = { id: maxId + 1, clave: f.clave, valor: f.valor, vigente_desde: sello, creado_por: (correo.split('@')[0] || 'desconocido').slice(0, 60), creado_en: sello };
          (datos.configuracion = datos.configuracion || []).push(fila);
          return fila;
        });
        reg.escrituras.push({ metodo, tabla, consulta: url.search, cuerpo, rol, prefer: cabeceras['prefer'] || '' });
        if (!pideFila) return route.fulfill({ status: 201, contentType: 'application/json', body: '' });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(guardadas) });
      }
      // Candado de días (solo caja, solo las tablas con candado): se evalúa contra la sombra, como el disparador de Postgres.
      const conCandado = TABLAS_CON_CANDADO.includes(tabla);
      if (conCandado) {
        const ahoraCandado = reg.control.ahora;
        const objetivos = metodo === 'POST' ? [null] : filasDe(tabla, url.search);
        const nuevas = metodo === 'POST' ? (Array.isArray(cuerpo) ? cuerpo : [cuerpo || {}]) : [];
        const veredictos = metodo === 'POST'
          ? nuevas.map(f => evaluarCandado({ rol, tabla, op: 'I', despues: f, pedidos: sombra.pedidos, ahora: ahoraCandado }))
          : objetivos.map(f => evaluarCandado({ rol, tabla, op, antes: f, despues: metodo === 'PATCH' ? { ...f, ...cuerpo } : null, pedidos: sombra.pedidos, ahora: ahoraCandado }));
        const rechazo = veredictos.find(Boolean);
        if (rechazo) {
          reg.denegadas.push(`${rol} ${op} ${tabla} (candado de días)`);
          return route.fulfill({ status: 403, contentType: 'application/json', headers: cors, body: JSON.stringify(rechazo) });
        }
      }
      reg.escrituras.push({ metodo, tabla, consulta: url.search, cuerpo, rol, prefer: cabeceras['prefer'] || '' });
      if (metodo === 'DELETE') {
        if (conCandado) { const borrar = new Set(filasDe(tabla, url.search)); sombra[tabla] = sombra[tabla].filter(f => !borrar.has(f)); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      const devolver = Array.isArray(cuerpo) ? cuerpo : [cuerpo || {}];
      const conId = devolver.map((f, i) => Object.assign({ id: 9000 + reg.escrituras.length * 10 + i }, f));
      if (conCandado) {
        if (metodo === 'POST') sombra[tabla].push(...conId.map(copiaProfunda));
        else for (const f of filasDe(tabla, url.search)) Object.assign(f, cuerpo);
      }
      if (metodo === 'POST' && !pideFila) return route.fulfill({ status: 201, contentType: 'application/json', body: '' });
      return route.fulfill({ status: metodo === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(conId) });
    }
    // Fuentes de Google, librería xlsx (CDN), etc.: respuesta vacía, sin salir a internet.
    const tipo = /\.css|fonts\.googleapis/.test(req.url()) ? 'text/css' : 'application/javascript';
    return route.fulfill({ status: 200, contentType: tipo, body: '' });
  });

  await page.goto(opciones.url || URL_HTML);

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
