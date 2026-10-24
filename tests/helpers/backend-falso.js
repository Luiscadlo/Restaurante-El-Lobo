// Backend FALSO de Supabase para las pruebas. Nada sale a internet.
//
// - Toda petición http(s) de la página se atiende aquí, localmente: las de Supabase con
//   los datos de ejemplo, las de fuentes/librerías (CDN) con una respuesta vacía.
// - Si el sistema llama a algo de supabase.co que no sea /rest/v1/ (por ejemplo /auth/v1/
//   cuando exista el login), se registra en `noManejadas` y la prueba debe fallar o
//   manejarlo explícitamente (ver el Prompt D).
// - GET devuelve la tabla completa (respeta limit/offset y manda Content-Range como
//   PostgREST). NO aplica filtros (eq., in., ...): para esta primera red de pruebas basta.
// - POST/PATCH/DELETE responden con éxito y quedan registrados en `escrituras`.
const path = require('path');
const { pathToFileURL } = require('url');
const { datos: DATOS_BASE, FECHA_HOY } = require('../fixtures/datos');

const HTML = path.resolve(__dirname, '../../Contabilidad/ElLobo-Sistema Contable.html');
const URL_HTML = pathToFileURL(HTML).href;

// Las 16 tablas que pide loadState() hoy (15 + config del aviso de respaldo). Si el sistema pide otra, la prueba de humo lo avisa.
const TABLAS_LOADSTATE = [
  'pedidos', 'egresos', 'inventario', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia',
  'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados',
  'clientes_fiado', 'abonos_fiado', 'pedidos_descuentos', 'config',
];

function copiaProfunda(x) { return JSON.parse(JSON.stringify(x)); }

/**
 * Abre el sistema con el backend falso.
 * @param page   página de Playwright
 * @param opciones.datos   datos por tabla (por defecto, los de ejemplo)
 * @param opciones.fecha   fecha "de hoy" fija (por defecto 2026-10-20, 14:00 Bogotá)
 * @param opciones.tablasFaltantes  tablas que "no existen" en Supabase (responden 404), p. ej. ['config']
 * @param opciones.totalesFalsos    { tabla: n } → el header Content-Range de esa tabla dice n (para simular filas que faltan)
 * @returns { errores, peticiones, escrituras, noManejadas, avisos }
 */
async function abrirSistema(page, opciones = {}) {
  const datos = opciones.datos || copiaProfunda(DATOS_BASE);
  const fecha = opciones.fecha || new Date(`${FECHA_HOY}T14:00:00-05:00`);
  const reg = { errores: [], peticiones: [], escrituras: [], noManejadas: [], avisos: [] };

  page.on('pageerror', e => reg.errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') reg.errores.push('console.error: ' + m.text()); });

  await page.clock.setFixedTime(fecha);

  await page.route(/^https?:\/\//, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname.endsWith('supabase.co')) {
      const m = url.pathname.match(/^\/rest\/v1\/([^/]+)/);
      if (!m) {
        reg.noManejadas.push(`${req.method()} ${url.pathname}`);
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no manejada en las pruebas"}' });
      }
      const tabla = m[1];
      const metodo = req.method();
      if ((opciones.tablasFaltantes || []).includes(tabla)) {
        reg.peticiones.push(tabla);
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: '42P01', message: `relation "public.${tabla}" does not exist` }) });
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
          headers: { 'content-range': rango, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range' },
          body: JSON.stringify(lote) });
      }
      let cuerpo = null;
      try { cuerpo = req.postDataJSON(); } catch (e) { /* sin cuerpo */ }
      reg.escrituras.push({ metodo, tabla, consulta: url.search, cuerpo });
      if (metodo === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      const devolver = Array.isArray(cuerpo) ? cuerpo : [cuerpo || {}];
      const conId = devolver.map((f, i) => Object.assign({ id: 9000 + reg.escrituras.length * 10 + i }, f));
      return route.fulfill({ status: metodo === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(conId) });
    }
    // Fuentes de Google, librería xlsx (CDN), etc.: respuesta vacía, sin salir a internet.
    const tipo = /\.css|fonts\.googleapis/.test(req.url()) ? 'text/css' : 'application/javascript';
    return route.fulfill({ status: 200, contentType: tipo, body: '' });
  });

  await page.goto(URL_HTML);
  // loadState() oculta el overlay de carga al terminar.
  await page.waitForFunction(() => {
    const o = document.getElementById('loadingOverlay');
    return o && getComputedStyle(o).display === 'none';
  }, null, { timeout: 15000 });
  return reg;
}

module.exports = { abrirSistema, TABLAS_LOADSTATE, URL_HTML, FECHA_HOY };
