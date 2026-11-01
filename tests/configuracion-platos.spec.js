// ⚙️ CONFIGURACIÓN → «Platos del menú» (etapa 3).
// Todo contra el backend falso (que imita sql/configuracion_etapa_3.sql: valida la lista, no deja borrar platos): nada toca tu
// Supabase real. Se comprueba, desde la pantalla, que:
//   · SIN nada guardado el autocompletado de Pedidos ofrece EXACTAMENTE los platos de siempre (foto de referencia en
//     fixtures/platos-anterior.json) y el generador del Menú ofrece los mismos;
//   · con platos guardados, el autocompletado usa el nombre de hoy y solo ofrece lo activo; lo retirado deja de ofrecerse;
//   · cambiar el NOMBRE de un plato avisa (banner en la fila y en la confirmación) y, en los reportes, los pedidos con el nombre
//     anterior suman junto con el nombre nuevo — sin tocar ningún pedido guardado, y sin confundir dos platos que en distintas
//     fechas se llamaron igual;
//   · solo el administrador ve y guarda; cada guardado pide confirmación, se valida antes de enviar y manda UNA fila nueva;
//   · si otro administrador cambió lo mismo mientras tanto, no se pisa su cambio; lo que el servidor rechaza se avisa;
//   · el generador del Menú recibe la lista del sistema (también si ya está abierto) y nunca interpreta un nombre como código;
//   · las reglas de la pantalla, del servidor falso y de la base real dan el mismo veredicto y el mismo mensaje (casos compartidos).
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { test, expect } = require('@playwright/test');
const { abrirSistema, validarConfiguracion, PLATOS_BASE_FALSO, URL_HTML } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const ANTERIOR = require('./fixtures/platos-anterior.json').PL;
const CASOS = require('./fixtures/casos-platos.json').casos;

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const fila = (id, valor, desde = '2026-10-10T10:00:00-05:00', por = 'luis', clave = 'menu_platos') => ({ id, clave, valor, vigente_desde: desde, creado_por: por, creado_en: desde });
const escrituras = (reg, tabla = 'configuracion') => reg.escrituras.filter(e => e.tabla === tabla);
const URL_MENU = 'file://' + path.join(__dirname, '..', 'Menu', 'Menú diario-El Lobo.html');

// La lista base vive en la página como JSON: se lee de ahí (así las pruebas usan la misma que el sistema).
const TEXTO_HTML = fs.readFileSync(fileURLToPath(URL_HTML), 'utf8');
const BASE = JSON.parse(TEXTO_HTML.match(/const PLATOS_BASE = Object\.freeze\((\[[\s\S]*?\n\])\.map\(Object\.freeze\)\)/)[1]);
const NOMBRES_LISTA = { sopa: 'Sopas', arroz: 'Arroces', proteina: 'Proteínas', acomp: 'Acompañamientos', asado: 'Asados' };
const IDX = codigo => BASE.findIndex(b => b.codigo === codigo);
const cambiar = (lista, codigo, cambios) => lista.map(x => (x.codigo === codigo ? { ...x, ...cambios } : x));
const nuevo = (codigo, lista, nombre, activo = true) => ({ codigo, lista, nombre, activo });
const nombresActivos = (valor, l) => valor.filter(p => p.lista === l && p.activo).map(p => p.nombre);

// El valor completo de un caso compartido (mismo algoritmo que las pruebas de Python).
function armar(caso) {
  if ('valor' in caso) return caso.valor;
  const v = copia(BASE);
  for (const [i, c] of Object.entries(caso.mod || {})) Object.assign(v[+i], c);
  for (const [i, campos] of Object.entries(caso.sin || {})) for (const campo of campos) delete v[+i][campo];
  for (const i of [...(caso.quitar || [])].sort((a, b) => b - a)) v.splice(i, 1);
  v.push(...copia(caso.agregar || []));
  for (let i = 0; i < (caso.relleno || 0); i++) v.push({ codigo: `PT${28 + i}`, lista: 'proteina', nombre: `Relleno ${i + 1}`, activo: true });
  return v;
}

async function abrirAdmin(page, opciones = {}) {
  const nativos = aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  await irA(page, 'config');
  await expect(page.locator('#config-contenido')).toBeVisible();
  return { reg, nativos };
}
const datosCon = (filas, extra = {}) => { const d = copia(DATOS_BASE); d.configuracion = filas; return Object.assign(d, extra); };
const escribir = (loc, t) => loc.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, t);
const confirmar = (page, si = true) => page.click(`#sis-opciones button[data-eleccion="${si ? 'si' : 'no'}"]`);
const noAceptarAvisos = page => page.evaluate(() => { window.__noAceptarAvisos = true; });
const FILA = i => `#cfgpla-fila-${i}`;
const nombre = (page, i) => page.locator(`${FILA(i)} input`);
const nombresPL = (page, l) => page.evaluate(x => PL[x].map(p => p.n), l);

// ── 1. Sin nada guardado: todo como antes ─────────────────────────────────────────
test.describe('sin platos guardados: los de siempre', () => {
  test('el autocompletado ofrece los mismos platos, en el mismo orden, que la versión anterior (foto de referencia)', async ({ page }) => {
    aceptarAvisos(page);
    const reg = await abrirSistema(page, { usuario: 'admin' });
    const ahora = await page.evaluate(() => JSON.parse(JSON.stringify({ sopa: PL.sopa, arroz: PL.arroz, asado: PL.asado, acomp: PL.acomp, proteina: PL.proteina })));
    for (const l of Object.keys(ANTERIOR)) expect(ahora[l].slice(0, ANTERIOR[l].length), l).toEqual(ANTERIOR[l]);
    expect(ahora.proteina.slice(ANTERIOR.proteina.length)).toEqual([{ c: 'PT26', n: 'Pollo Frito/BBQ' }, { c: 'PT27', n: 'Pechuga en salsa' }]);   // lo único nuevo
    for (const l of ['sopa', 'arroz', 'asado', 'acomp']) expect(ahora[l].length, l).toBe(ANTERIOR[l].length);
    expect(reg.errores).toEqual([]);
  });

  test('la lista base son 47 platos activos con código por lista, y el servidor falso exige los mismos', async () => {
    expect(BASE.length).toBe(47);
    expect(BASE.every(b => b.activo === true)).toBe(true);
    expect(BASE.map(b => [b.codigo, b.lista])).toEqual(PLATOS_BASE_FALSO);
    expect(Object.fromEntries(Object.keys(NOMBRES_LISTA).map(l => [l, BASE.filter(b => b.lista === l).length]))).toEqual({ sopa: 9, arroz: 5, proteina: 27, acomp: 3, asado: 3 });
  });

  test('la lista base la acepta el servidor y la revisión de la pantalla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const r = await page.evaluate(async b => ({ veredicto: cfgValidar('menu_platos', b), guardadas: (await sbInsert('configuracion', { clave: 'menu_platos', valor: b })).length }), BASE);
    expect(r).toEqual({ veredicto: null, guardadas: 1 });
    expect(reg.denegadas).toEqual([]);
  });

  test('si la tabla todavía no existe en Supabase: los de siempre, sin errores, y los botones quedan apagados', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { tablasFaltantes: ['configuracion'] });
    expect((await nombresPL(page, 'sopa')).length).toBe(9);
    await expect(page.locator('#cfgpla-agregar-sopa')).toBeDisabled();
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    await expect(nombre(page, 0)).toBeDisabled();
    expect(await page.evaluate(() => cfgPlaGuardar())).toBeUndefined();
    expect(escrituras(reg)).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('elLobo_menu_platos'))).toBeNull();      // sin datos del servidor no se publica nada
  });
});

// ── 2. Los casos compartidos: pantalla, servidor falso y base real dicen lo mismo ─────
test.describe('reglas compartidas', () => {
  test('la revisión de la pantalla da el veredicto y el mensaje de cada caso', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const r = await page.evaluate(casos => casos.map(c => cfgValidar('menu_platos', c.valor)), CASOS.map(c => ({ valor: armar(c) })));
    expect(r.map((m, i) => [CASOS[i].id, m])).toEqual(CASOS.map(c => [c.id, c.mensaje]));
  });
  test('el servidor falso da el mismo veredicto y el mismo mensaje de cada caso', async () => {
    const r = CASOS.map(c => { const e = validarConfiguracion('menu_platos', armar(c)); return [c.id, e ? e.message : null, e ? e.code : null]; });
    expect(r.map(x => x.slice(0, 2))).toEqual(CASOS.map(c => [c.id, c.mensaje]));
    expect(r.filter(x => x[2]).every(x => x[2] === '22023')).toBe(true);
  });
  test('un código con salto de línea al final no pasa (en la pantalla ni en el servidor)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const v = copia(BASE); v[0].codigo = 'SP10\n';
    expect(await page.evaluate(x => cfgValidar('menu_platos', x), v)).toMatch(/^El código "SP10\n" no sirve para la lista sopa/);
    expect(validarConfiguracion('menu_platos', v).message).toMatch(/^El código "SP10\n" no sirve para la lista sopa/);
  });
  test('hay casos válidos e inválidos y cada carácter prohibido tiene su propio caso', async () => {
    expect(CASOS.filter(c => c.mensaje === null).length).toBeGreaterThanOrEqual(15);
    expect(CASOS.filter(c => c.mensaje !== null).length).toBeGreaterThanOrEqual(55);
    const nombres = CASOS.filter(c => c.mensaje && c.mensaje.startsWith('Los nombres no pueden')).map(c => c.mod['0'].nombre);
    for (const ch of ['<', '>', '&', '"', "'", '`', '\\', '\n', '\u007f', '\t']) expect(nombres.some(n => n.includes(ch)), JSON.stringify(ch)).toBe(true);
  });
  test('la regla de historia: una versión nueva no puede quitar platos de la anterior (servidor falso, por la pantalla)', async ({ page }) => {
    await abrirAdmin(page);
    const r = await page.evaluate(async b => {
      await sbInsert('configuracion', { clave: 'menu_platos', valor: b.concat([{ codigo: 'SP10', lista: 'sopa', nombre: 'Sopa de Mondongo', activo: true }]) });
      try { await sbInsert('configuracion', { clave: 'menu_platos', valor: b }); return 'sin error'; } catch (e) { return cfgMensajeError(e); }
    }, BASE);
    expect(r).toBe('No se pueden borrar platos (SP10): se retiran, para que los pedidos viejos se sigan contando.');
  });
});

// ── 3. Con platos guardados: todo lo que estaba fijo los usa ──────────────────────
test.describe('con platos guardados', () => {
  const V1 = [...cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }).map(x => (x.codigo === 'PT01' ? { ...x, activo: false } : x)), nuevo('SP10', 'sopa', 'Sopa de Mondongo'), nuevo('AC04', 'acomp', 'Ensalada')];

  test('el autocompletado ofrece el nombre de hoy, los nuevos, y deja de ofrecer lo retirado', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, V1)]) });
    expect(await nombresPL(page, 'sopa')).toEqual(['Sopa de Huesos', 'Sopa de Queso', 'Sopa de Frijol', 'Sopa de Lenteja', 'Sopa de Pescado', 'Sopa de Verduras', 'Sopa de Garbanzos', 'Sopa de Arvejas', 'Sopa de Pollo', 'Sopa de Mondongo']);
    expect(await nombresPL(page, 'acomp')).toEqual(['Patacones', 'Tajada madura', 'Yuca Cocida', 'Ensalada']);
    expect(await nombresPL(page, 'proteina')).not.toContain('Pollo en salsa BBQ');                 // PT01 retirado
    expect((await nombresPL(page, 'proteina')).length).toBe(26);
  });

  test('escribir en el formulario de Pedidos muestra solo lo activo, con el nombre de hoy y el código', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, V1)]) });
    await page.selectOption('#ing-pedido', 'completo');
    await page.evaluate(() => onPedidoChange());
    await page.locator('#ing-sopa').fill('hue');
    await expect(page.locator('#ac-sopa .autocomplete-item')).toHaveCount(1);                      // «Sopa de Hueso» ya no existe: es «Sopa de Huesos»
    await expect(page.locator('#ac-sopa .autocomplete-item').first()).toContainText('Sopa de Huesos');
    await expect(page.locator('#ac-sopa .autocomplete-item .item-code').first()).toHaveText('SP01');
    await page.locator('#ing-sopa').fill('mond');
    await expect(page.locator('#ac-sopa .autocomplete-item')).toHaveCount(1);
    await page.locator('#ing-proteina').fill('bbq');
    expect(await page.locator('#ac-proteina .autocomplete-item span:first-child').allTextContents()).toEqual(['Chuleta Frita/BBQ', 'Costillas BBQ', 'Pollo Frito/BBQ']);   // «Pollo en salsa BBQ» (PT01) está retirado
  });

  test('un asado se ofrece solo cuando el pedido es de asado (y con el nombre de hoy)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, cambiar(BASE, 'AS03', { nombre: 'Asado de Res premium' }))]) });
    await page.selectOption('#ing-pedido', 'asado130');
    await page.evaluate(() => onPedidoChange());
    expect(await page.evaluate(() => getItemsForTipo('proteina').map(p => p.n))).toEqual(['Asado de cerdo', 'Asado de pechuga', 'Asado de Res premium']);
    await page.selectOption('#ing-pedido', 'completo');
    await page.evaluate(() => onPedidoChange());
    expect((await page.evaluate(() => getItemsForTipo('proteina').map(p => p.n))).length).toBe(27);
  });

  test('un nombre guardado con caracteres raros nunca se interpreta como código en el autocompletado', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, cambiar(BASE, 'SP02', { nombre: 'Sopa & <b>queso</b> "x"' }))]) });
    expect(await nombresPL(page, 'sopa')).not.toContain('Sopa & <b>queso</b> "x"');               // la fila es inválida: se ignora y rigen los de siempre
    expect((await nombresPL(page, 'sopa'))[1]).toBe('Sopa de Queso');
  });

  test('una versión dañada no estorba: rige la anterior válida', async ({ page }) => {
    const mala = copia(BASE); mala[1].nombre = mala[0].nombre;                                    // nombre repetido
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, V1), fila(2, mala, '2026-10-12T10:00:00-05:00')]) });
    expect((await nombresPL(page, 'sopa'))[0]).toBe('Sopa de Huesos');
  });

  test('cambia sin recargar cuando llega la configuración nueva', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    expect((await nombresPL(page, 'sopa'))[0]).toBe('Sopa de Hueso');
    await page.evaluate(v => { ST.configuracion = ST.configuracion.concat([{ id: 50, clave: 'menu_platos', valor: v, vigente_desde: '2026-10-19T10:00:00-05:00', creado_por: 'otro', creado_en: '2026-10-19T10:00:00-05:00' }]); renderAll(); }, V1);
    expect((await nombresPL(page, 'sopa'))[0]).toBe('Sopa de Huesos');
  });
});

// ── 4. Los reportes: renombrar un plato NO parte la estadística en dos ────────────
let idPedido = 900;
// Un pedido pagado del almuerzo (los turnos con cierre guardado son 2026-10-05 y 2026-10-18).
const pedidoPlato = extra => {
  idPedido += 1;
  return Object.assign({
    id: idPedido, created_at: '2026-10-05T12:00:00-05:00', fecha: '2026-10-05', hora: '12:30', turno: 'almuerzo',
    pedido: 'completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', metodo: 'efectivo', cantidad: 1,
    monto_unit: 14000, monto_almuerzo: 14000, monto_domicilio: 0, monto_total: 14000, monto_efectivo: 0, monto_transferencia: 0,
    estado: 'pagado', es_domicilio: false, mesa: null, para_llevar: false, es_fiar: false, es_sin_mesa: false, es_gratis: false,
    cliente_fiado_id: null, direccion: '', grupo_pedido: `gp-${idPedido}`, descuento: 0, motivo_descuento: null,
    pagado_via_abono: false, fecha_pago: null, turno_pago: null,
  }, extra);
};
const datosReporte = (filas, pedidos) => { const d = datosCon(filas); d.pedidos = d.pedidos.concat(pedidos); return d; };
// Lee lo que dice cada bloque «más pedidos» del tablero (están ocultos por ahora, pero se calculan): [nombre, cantidad][]
async function top(page, id) {
  await irA(page, 'dashboard');
  await page.locator('#tab-dashboard .filter-btn', { hasText: 'Todo el historial' }).click();
  return page.evaluate(i => [...document.querySelectorAll(`#${i} .report-line`)].map(l => [l.querySelector('span').textContent.replace(/^\d+\. /, ''), parseInt(l.querySelector('strong').textContent, 10)]), id);
}

test.describe('reportes «más pedidos»', () => {
  const RENOMBRADA = cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' });

  test('sin renombres cuenta como siempre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([], [pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 2 }), pedidoPlato({ sopa: 'Sopa de Queso', fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' }), pedidoPlato({ sopa: 'Sopa de Hueso', fecha: '2026-10-18', created_at: '2026-10-18T12:05:00-05:00' })]) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Hueso', 3], ['Sopa de Queso', 1]]);
  });

  test('al renombrar, los pedidos con el nombre anterior suman junto con el nuevo (también los de antes del cambio)', async ({ page }) => {
    const pedidos = [
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 2 }),                                                                           // antes del cambio (5-oct)
      pedidoPlato({ sopa: 'Sopa de Huesos', cantidad: 3, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' }),          // después
      pedidoPlato({ sopa: 'Sopa de Queso', fecha: '2026-10-18', created_at: '2026-10-18T12:01:00-05:00' }),
    ];
    const { reg } = await abrirAdmin(page, { datos: datosReporte([fila(1, RENOMBRADA)], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Huesos', 5], ['Sopa de Queso', 1]]);
    expect(escrituras(reg, 'pedidos')).toEqual([]);                                                                                // y ningún pedido se modificó
    expect(reg.datos.pedidos.filter(p => p.sopa === 'Sopa de Hueso').length).toBe(1);
  });

  test('renombrar varias veces: todos los nombres de un plato suman con el de hoy', async ({ page }) => {
    const v2 = cambiar(RENOMBRADA, 'SP01', { nombre: 'Sopa de Pata' });
    const pedidos = [
      pedidoPlato({ sopa: 'Sopa de Hueso' }),
      pedidoPlato({ sopa: 'Sopa de Huesos', fecha: '2026-10-18', created_at: '2026-10-12T12:00:00-05:00', cantidad: 2 }),
      pedidoPlato({ sopa: 'Sopa de Pata', fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00', cantidad: 4 }),
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, RENOMBRADA, '2026-10-10T10:00:00-05:00'), fila(2, v2, '2026-10-15T10:00:00-05:00')], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Pata', 7]]);
  });

  test('un nombre viejo que otro plato volvió a usar se cuenta según la fecha del pedido', async ({ page }) => {
    const v2 = [...RENOMBRADA, nuevo('SP10', 'sopa', 'Sopa de Hueso')];                                                                // el nombre viejo ahora es de OTRO plato
    const pedidos = [
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 1 }),                                                                           // 5-oct: era la SP01 → hoy «Sopa de Huesos»
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 4, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' }),            // 18-oct: ya es la SP10
      pedidoPlato({ sopa: 'Sopa de Huesos', cantidad: 2, fecha: '2026-10-18', created_at: '2026-10-18T12:02:00-05:00' }),
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, RENOMBRADA, '2026-10-10T10:00:00-05:00'), fila(2, v2, '2026-10-15T10:00:00-05:00')], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Hueso', 4], ['Sopa de Huesos', 3]]);
  });

  test('un pedido sin hora guardada se ubica por su fecha; un texto escrito a mano (que no está en la lista) queda como está', async ({ page }) => {
    const pedidos = [
      pedidoPlato({ sopa: 'Sopa de Hueso', created_at: null }),                                                                     // 5-oct, sin hora → antes del cambio
      pedidoPlato({ sopa: 'Sopa especial del chef', cantidad: 2 }),
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, RENOMBRADA)], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa especial del chef', 2], ['Sopa de Huesos', 1]]);
  });

  test('un texto de un pedido que nombra un plato de OTRA fecha y solo uno en toda la historia se une a él', async ({ page }) => {
    // «Sopa de Mondongo» se creó el 15-oct; este pedido (5-oct) la nombra: la historia solo conoce un plato con ese nombre.
    const v = [...BASE, nuevo('SP10', 'sopa', 'Sopa de Mondongo')];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, v, '2026-10-15T10:00:00-05:00'), fila(2, cambiar(v, 'SP10', { nombre: 'Mondongo' }), '2026-10-16T10:00:00-05:00')], [pedidoPlato({ sopa: 'Sopa de Mondongo' })]) });
    expect(await top(page, 'rp-sopas')).toEqual([['Mondongo', 1]]);
  });

  test('una versión dañada en la historia no rompe los reportes ni cuenta', async ({ page }) => {
    const pedidos = [pedidoPlato({ sopa: 'Sopa de Hueso' }), pedidoPlato({ sopa: 'Sopa de Huesos', fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' })];
    const filas = [fila(1, RENOMBRADA, '2026-10-10T10:00:00-05:00'), fila(2, 'no es una lista', '2026-10-11T10:00:00-05:00'), fila(3, [{ codigo: 'SP01' }], '2026-10-12T10:00:00-05:00'), fila(4, null, '2026-10-13T10:00:00-05:00')];
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosReporte(filas, pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Huesos', 2]]);
    expect(reg.errores).toEqual([]);
  });

  test('un cambio y un nombre reutilizado el mismo día: cada pedido se cuenta con la hora que tiene (sin hora, con el final de su día)', async ({ page }) => {
    const v2 = [...RENOMBRADA, nuevo('SP10', 'sopa', 'Sopa de Hueso')];                                  // a las 3 p. m. del 18-oct: SP01 pasa a «Huesos» y la SP10 toma el nombre viejo
    const pedidos = [
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 1, fecha: '2026-10-18', created_at: '2026-10-18T10:00:00-05:00' }),    // antes del cambio: era la SP01 → hoy «Sopa de Huesos»
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 2, fecha: '2026-10-18', created_at: '2026-10-18T16:00:00-05:00' }),    // después: ya es la SP10
      pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 4, fecha: '2026-10-18', created_at: null }),                            // sin hora: se toma el final de ese día → SP10
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, v2, '2026-10-18T15:00:00-05:00')], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Hueso', 6], ['Sopa de Huesos', 1]]);
  });

  test('sin fecha ni hora, un nombre reutilizado se entiende como el plato de hoy', async ({ page }) => {
    const v2 = [...RENOMBRADA, nuevo('SP10', 'sopa', 'Sopa de Hueso')];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, v2)], []) });
    const leer = instante => page.evaluate(i => crearResolvedorPlatos()('sopa', 'Sopa de Hueso', i), instante);
    expect(await leer(undefined)).toBe('Sopa de Hueso');
    expect(await leer(null)).toBe('Sopa de Hueso');
    expect(await leer('no es una fecha')).toBe('Sopa de Hueso');
    expect(await leer('2026-10-05T12:00:00-05:00')).toBe('Sopa de Huesos');                              // con fecha anterior al cambio, era la SP01
  });

  test('un texto que ese día no estaba en la lista y que en la historia nombra a dos platos distintos queda como está', async ({ page }) => {
    const v3 = [...RENOMBRADA, nuevo('SP10', 'sopa', 'Sopa de Hueso')];                                  // 17-oct: otro plato toma el nombre viejo
    const pedidos = [pedidoPlato({ sopa: 'Sopa de Hueso', cantidad: 3 })];                               // 5-oct: ese día nadie se llamaba así (la SP01 ya era «Huesos»)
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, RENOMBRADA, '2026-10-04T10:00:00-05:00'), fila(2, v3, '2026-10-17T10:00:00-05:00')], pedidos) });
    expect(await top(page, 'rp-sopas')).toEqual([['Sopa de Hueso', 3]]);
  });

  test('arroces, proteínas y asados también suman por plato; un asado retirado sigue contando como asado', async ({ page }) => {
    const v = cambiar(cambiar(cambiar(BASE, 'AR02', { nombre: 'Arroz con Coco' }), 'AS01', { activo: false }), 'PT04', { nombre: 'Pollo Crocante' });
    const pedidos = [
      pedidoPlato({ arroz: 'Arroz de Coco', cantidad: 2 }), pedidoPlato({ arroz: 'Arroz con Coco', cantidad: 1, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' }),
      pedidoPlato({ proteina: 'Pollo Frito', cantidad: 3 }), pedidoPlato({ proteina: 'Pollo Crocante', cantidad: 2, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' }),
      pedidoPlato({ proteina: 'Asado de cerdo', cantidad: 9 }),                                                                     // asado retirado
      pedidoPlato({ proteina: 'Carne Guisada', cantidad: 1 }),
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, v, '2026-10-10T10:00:00-05:00')], pedidos) });
    expect(await top(page, 'rp-arroces')).toEqual([['Arroz con Coco', 3]]);
    expect(await top(page, 'rp-proteinas')).toEqual([['Pollo Crocante', 5], ['Carne Guisada', 1]]);                              // sin el asado (aunque esté retirado)
    expect(await top(page, 'rp-asados')).toEqual([['Asado de cerdo', 9]]);
  });

  test('M3 · con asados que se piden MÁS que las proteínas, las «proteínas más pedidas» siguen mostrando sus 5 (se filtra antes de cortar)', async ({ page }) => {
    const proteinas = [['Pollo en salsa BBQ', 6], ['Pollo Frito', 5], ['Carne Guisada', 4], ['Chuleta Frita', 3], ['Costillas BBQ', 2], ['Pollo Crocante', 1]];
    const pedidos = [
      pedidoPlato({ proteina: 'Asado de cerdo', cantidad: 20 }), pedidoPlato({ proteina: 'Asado de pechuga', cantidad: 15 }), pedidoPlato({ proteina: 'Asado de Res', cantidad: 12 }),
      ...proteinas.map(([nombre, cantidad]) => pedidoPlato({ proteina: nombre, cantidad })),
    ];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([], pedidos) });
    expect(await top(page, 'rp-proteinas')).toEqual(proteinas.slice(0, 5));                       // antes salían solo 2: los 3 asados ocupaban el corte
    expect(await top(page, 'rp-asados')).toEqual([['Asado de cerdo', 20], ['Asado de pechuga', 15], ['Asado de Res', 12]]);
  });

  test('un asado renombrado suma con su nombre de hoy', async ({ page }) => {
    const v = cambiar(BASE, 'AS02', { nombre: 'Asado de pechuga a la plancha' });
    const pedidos = [pedidoPlato({ proteina: 'Asado de pechuga', cantidad: 2 }), pedidoPlato({ proteina: 'Asado de pechuga a la plancha', cantidad: 1, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' })];
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([fila(1, v)], pedidos) });
    expect(await top(page, 'rp-asados')).toEqual([['Asado de pechuga a la plancha', 3]]);
  });

  test('lo que trae un pedido nunca se interpreta como código al pintar el reporte', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosReporte([], [pedidoPlato({ sopa: '<img src=x onerror="window.__xss=1">' })]) });
    await top(page, 'rp-sopas');
    expect(await page.evaluate(() => document.getElementById('rp-sopas').innerHTML)).toContain('&lt;img src=x onerror="window.__xss=1"&gt;');
    expect(await page.evaluate(() => document.querySelectorAll('#rp-sopas img').length)).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('el reporte no modifica ni uno de los pedidos (ni en pantalla ni en el servidor)', async ({ page }) => {
    const pedidos = [pedidoPlato({ sopa: 'Sopa de Hueso' }), pedidoPlato({ sopa: 'Sopa de Huesos', fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00' })];
    const { reg } = await abrirAdmin(page, { datos: datosReporte([fila(1, RENOMBRADA)], pedidos) });
    const antes = await page.evaluate(() => JSON.stringify(ST.ingresos));
    await top(page, 'rp-sopas');
    expect(await page.evaluate(() => JSON.stringify(ST.ingresos))).toBe(antes);
    expect(reg.escrituras).toEqual([]);
  });
});

// ── 5. El Excel que lee el modelo financiero ──────────────────────────────────────
test.describe('exportar a Excel', () => {
  const hojasExportadas = page => page.evaluate(() => {
    const hojas = {};
    window.XLSX = { utils: { book_new: () => ({}), json_to_sheet: filas => ({ filas }), book_append_sheet: (wb, ws, nombre) => { hojas[nombre] = ws.filas; } }, writeFile: () => {} };
    exportarExcelCompleto();
    return hojas;
  });
  test('trae la hoja «Menu_Platos» con los platos de hoy (código, lista, nombre, activo)', async ({ page }) => {
    const v = [...cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }), nuevo('SP10', 'sopa', 'Sopa de Mondongo', false)];
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, v)]) });
    expect((await hojasExportadas(page)).Menu_Platos).toEqual(v);
  });
  test('sin nada guardado trae los 47 de El Lobo y las demás hojas siguen', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const h = await hojasExportadas(page);
    expect(h.Menu_Platos).toEqual(BASE);
    expect(Object.keys(h)).toEqual(expect.arrayContaining(['Pedidos_Pagados', 'Cierres_Dia', 'Categorias_Egresos', 'Nombres_Cuentas', 'Menu_Platos']));
  });
});

// ── 6. La pantalla «Platos del menú» ───────────────────────────────────────────────
test.describe('pantalla «Platos del menú»', () => {
  test('sin cambios guardados muestra las 5 listas con los platos de siempre y todo apagado', async ({ page }) => {
    await abrirAdmin(page);
    await expect(page.locator('#cfgpla-listas .cfgpla-lista')).toHaveCount(5);
    expect(await page.locator('#cfgpla-listas .cfgpla-titulo').allTextContents()).toEqual([
      '🍲 Sopas 9 activos de 9', '🍚 Arroces 5 activos de 5', '🥩 Proteínas 27 activos de 27', '🍟 Acompañamientos 3 activos de 3', '🔥 Asados 3 activos de 3'].map(s => s.replace(/^(\S+) (\S+) /, '$1 $2 ')));
    await expect(page.locator('#cfgpla-hoy')).toContainText('47 platos activos de 47');
    await expect(page.locator('#cfgpla-hoy')).toContainText('los platos de siempre');
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    await expect(page.locator('#cfgpla-descartar')).toBeDisabled();
    for (const l of Object.keys(NOMBRES_LISTA)) await expect(page.locator(`#cfgpla-agregar-${l}`)).toBeEnabled();
    expect(await page.locator('#cfgpla-lista-sopa .cfgcat-cod').allTextContents()).toEqual(BASE.filter(b => b.lista === 'sopa').map(b => b.codigo));
    await expect(nombre(page, IDX('SP01'))).toHaveValue('Sopa de Hueso');
    await expect(nombre(page, IDX('PT26'))).toHaveValue('Pollo Frito/BBQ');
    await expect(page.locator('#cfgpla-aviso-0')).toBeHidden();
  });

  test('cambiar un nombre muestra el aviso en la fila, marca el cambio y «Descartar» lo deshace', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const i = IDX('SP01');
    await escribir(nombre(page, i), '  Sopa   de Huesos ');
    await expect(page.locator(`#cfgpla-aviso-${i}`)).toBeVisible();
    const aviso = await page.locator(`#cfgpla-aviso-${i}`).innerText();
    expect(aviso).toContain('Vas a cambiar el nombre «Sopa de Hueso» por «Sopa de Huesos»');
    expect(aviso).toContain('los pedidos anteriores con «Sopa de Hueso» se contarán junto con «Sopa de Huesos» en los reportes');
    await expect(page.locator(FILA(i))).toHaveClass(/cfgcat-cambio/);
    await expect(page.locator('#cfgpla-contador')).toHaveText('1 cambio sin guardar');
    await expect(page.locator('#cfgpla-guardar')).toBeEnabled();
    await page.click('#cfgpla-descartar');
    await expect(nombre(page, i)).toHaveValue('Sopa de Hueso');
    await expect(page.locator(`#cfgpla-aviso-${i}`)).toBeHidden();
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    await escribir(nombre(page, i), 'Otra'); await expect(page.locator(`#cfgpla-aviso-${i}`)).toBeVisible();
    await escribir(nombre(page, i), 'Sopa de Hueso');                                                       // volver al nombre de antes no es un cambio
    await expect(page.locator(`#cfgpla-aviso-${i}`)).toBeHidden();
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    expect(escrituras(reg)).toEqual([]);
  });

  test('el aviso nunca interpreta lo escrito como código', async ({ page }) => {
    await abrirAdmin(page);
    const i = IDX('SP01');
    await escribir(nombre(page, i), '<img src=x onerror="window.__xss=1">');
    expect(await page.locator(`#cfgpla-aviso-${i}`).innerHTML()).toContain('&lt;img src=x onerror="window.__xss=1"&gt;');
    expect(await page.locator(`#cfgpla-aviso-${i} img`).count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('guardar un renombre: la confirmación lo explica, manda UNA fila con la lista completa y el autocompletado ya lo usa', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    const i = IDX('SP01');
    await escribir(nombre(page, i), 'Sopa de Huesos');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const t = await page.locator('#modal-sistema').innerText();
    expect(t).toContain('Platos del menú');
    expect(t).toContain('✏️ Cambia el nombre «Sopa de Hueso» por «Sopa de Huesos»: los pedidos anteriores con «Sopa de Hueso» se contarán junto con «Sopa de Huesos».');
    expect(t).toContain('Rigen desde ahora. No se modifica ningún pedido guardado.');
    expect(t).toContain('los pedidos con el nombre anterior se suman al nombre nuevo, también los de meses pasados');
    expect(escrituras(reg)).toEqual([]);                                                                    // todavía no se mandó nada
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
    expect(escrituras(reg)[0].cuerpo).toEqual({ clave: 'menu_platos', valor: cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }) });   // nombre limpio, sin marcas internas
    await expect(page.locator('#cfgpla-contador')).toHaveText('');
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    expect((await nombresPL(page, 'sopa'))[0]).toBe('Sopa de Huesos');
    const histo = page.locator('#config-historial tbody tr').first();
    await expect(histo).toContainText('Platos del menú');
    await expect(histo).toContainText('Nombre: «Sopa de Hueso» → «Sopa de Huesos»');
    await expect(histo).toContainText('rige hoy');
    expect(escrituras(reg, 'pedidos')).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('«Volver» en la confirmación no guarda nada y conserva lo escrito', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombre(page, 0), 'Sopa de Huesos');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await confirmar(page, false);
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg)).toEqual([]);
    await expect(nombre(page, 0)).toHaveValue('Sopa de Huesos');
    await expect(page.locator('#cfgpla-contador')).toHaveText('1 cambio sin guardar');
  });

  for (const [lista, codigo] of [['sopa', 'SP10'], ['arroz', 'AR06'], ['proteina', 'PT28'], ['acomp', 'AC04'], ['asado', 'AS04']]) {
    test(`un plato nuevo en ${NOMBRES_LISTA[lista].toLowerCase()}: código ${codigo}, se cuenta en palabras, se guarda al final y ya se ofrece`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await noAceptarAvisos(page);
      await page.click(`#cfgpla-agregar-${lista}`);
      const i = BASE.length;
      await expect(page.locator(`${FILA(i)} .cfgcat-cod`)).toHaveText(codigo);
      await expect(page.locator(FILA(i))).toHaveClass(/cfgcat-nuevo/);
      await expect(page.locator(`#cfgpla-lista-${lista} ${FILA(i)}`)).toHaveCount(1);                     // quedó dentro de SU lista
      await expect(nombre(page, i)).toBeFocused();
      await expect(page.locator('#cfgpla-contador')).toHaveText('1 cambio sin guardar');
      await expect(page.locator(`${FILA(i)} .badge`).first()).toHaveText('nuevo');
      await expect(page.locator(`#cfgpla-aviso-${i}`)).toBeHidden();                                         // un plato nuevo no tiene «nombre anterior»
      await nombre(page, i).fill('Plato de prueba nuevo');
      await page.click('#cfgpla-guardar');
      await expect(page.locator('#modal-sistema')).toBeVisible();
      const t = await page.locator('#modal-sistema').innerText();
      expect(t).toContain(`➕ Plato nuevo (${NOMBRES_LISTA[lista].toLowerCase()}): Plato de prueba nuevo`);
      expect(t).toContain('Los pedidos ya tomados conservan el nombre que tenían.');
      expect(t).not.toContain('se suman al nombre nuevo');                                                    // sin renombres no se habla de sumar
      await confirmar(page);
      await expect(page.locator('#cfgpla-hoy')).toContainText('48 platos activos de 48');
      expect(escrituras(reg).length).toBe(1);
      expect(escrituras(reg)[0].cuerpo.valor.slice(BASE.length)).toEqual([nuevo(codigo, lista, 'Plato de prueba nuevo')]);
      expect(await nombresPL(page, lista)).toContain('Plato de prueba nuevo');
      await expect(page.locator(`${FILA(i)} .badge`).first()).toHaveText('activo');
    });
  }

  test('el código de un plato nuevo no repite uno que ya existe, ni siquiera de uno retirado', async ({ page }) => {
    const v = [...cambiar(BASE, 'SP05', { activo: false }), nuevo('SP10', 'sopa', 'Sopa A', false), nuevo('SP12', 'sopa', 'Sopa B')];
    await abrirAdmin(page, { datos: datosCon([fila(1, v)]) });
    await page.click('#cfgpla-agregar-sopa');
    await expect(page.locator(`${FILA(v.length)} .cfgcat-cod`)).toHaveText('SP11');
    await page.click('#cfgpla-agregar-sopa');
    await expect(page.locator(`${FILA(v.length + 1)} .cfgcat-cod`)).toHaveText('SP13');
  });

  test('«Quitar» solo existe en lo que todavía no se ha guardado', async ({ page }) => {
    await abrirAdmin(page);
    await page.click('#cfgpla-agregar-arroz');
    await expect(page.locator('#cfgpla-contador')).toHaveText('1 cambio sin guardar');
    await page.locator(`${FILA(BASE.length)} button`, { hasText: 'Quitar' }).click();
    await expect(page.locator(FILA(BASE.length))).toHaveCount(0);
    await expect(page.locator('#cfgpla-contador')).toHaveText('');
    await expect(page.locator('#cfgpla-guardar')).toBeDisabled();
    await expect(page.locator(`${FILA(0)} button`, { hasText: 'Quitar' })).toHaveCount(0);                 // los guardados solo se retiran
  });

  test('aunque se llame a «Quitar» sobre un plato ya guardado, no se quita', async ({ page }) => {
    await abrirAdmin(page);
    await page.evaluate(() => cfgPlaQuitar(0));
    await expect(page.locator(FILA(0))).toHaveCount(1);
    await expect(page.locator('#cfgpla-contador')).toHaveText('');
    expect(await page.evaluate(() => cfgPlaFilas().length)).toBe(47);
  });

  test('los espacios de más al escribir un nombre se limpian antes de guardar', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombre(page, 0), '  Sopa   de  Huesos  ');
    await page.click('#cfgpla-guardar');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
    expect(escrituras(reg)[0].cuerpo.valor[0].nombre).toBe('Sopa de Huesos');
  });

  test('un nombre escrito a medias con comillas o signos de código no rompe ni inyecta nada al volver a dibujar la tabla', async ({ page }) => {
    await abrirAdmin(page);
    const malo = '"onfocus=__x=1 <img src=x onerror=__y=1>';
    await escribir(nombre(page, 0), malo);
    await page.locator(`${FILA(1)} button`, { hasText: 'Retirar' }).click();                             // vuelve a dibujar la tabla con lo escrito
    await expect(nombre(page, 0)).toHaveValue(malo);
    await nombre(page, 0).focus();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ x: window.__x || 0, y: window.__y || 0, img: document.querySelectorAll('img[src="x"]').length }))).toEqual({ x: 0, y: 0, img: 0 });
  });

  test('un segundo «Guardar» mientras el primero se está guardando no abre otra confirmación ni escribe otra vez', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombre(page, 0), 'Sopa de Huesos');
    await page.evaluate(() => { const original = window.sbInsert; window.sbInsert = async (...a) => { await new Promise(r => setTimeout(r, 600)); return original(...a); }; });   // el guardado tarda: así el segundo «Guardar» cae a mitad
    await page.evaluate(async () => {
      const primero = cfgPlaGuardar();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('#sis-opciones button[data-eleccion="si"]').click();
      await new Promise(r => setTimeout(r, 0));
      const segundo = cfgPlaGuardar();                                                                   // vuelve a pulsar mientras guarda
      await Promise.all([primero, segundo]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg).length).toBe(1);
  });

  test('retirar y reactivar: la fila se marca, se cuenta con palabras y el autocompletado deja de ofrecerlo', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    const i = IDX('AR05');
    await page.locator(`${FILA(i)} button`, { hasText: 'Retirar' }).click();
    await expect(page.locator(FILA(i))).toHaveClass(/cfgcat-retirado/);
    await expect(page.locator(`${FILA(i)} .badge`).last()).toHaveText('retirado');
    await expect(page.locator(`${FILA(i)} button`)).toHaveText('Reactivar');
    await expect(page.locator('#cfgpla-lista-arroz .cfgpla-titulo')).toContainText('4 activos de 5');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('🚫 Se retira: Arroz de Pimenton');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('46 platos activos de 47');
    expect(escrituras(reg)[0].cuerpo.valor.find(x => x.codigo === 'AR05').activo).toBe(false);
    expect(await nombresPL(page, 'arroz')).not.toContain('Arroz de Pimenton');
    await page.locator(`${FILA(i)} button`, { hasText: 'Reactivar' }).click();
    await page.click('#cfgpla-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('✅ Se reactiva: Arroz de Pimenton');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('47 platos activos de 47');
    expect(await nombresPL(page, 'arroz')).toContain('Arroz de Pimenton');
    expect(escrituras(reg).length).toBe(2);
  });

  test('renombrar y retirar a la vez cuenta dos cambios y la confirmación nombra los dos', async ({ page }) => {
    await abrirAdmin(page);
    await noAceptarAvisos(page);
    const i = IDX('AC02');
    await escribir(nombre(page, i), 'Tajadas');
    await page.locator(`${FILA(i)} button`, { hasText: 'Retirar' }).click();
    await expect(nombre(page, i)).toHaveValue('Tajadas');                                                  // volver a dibujar la fila no borra lo escrito
    await page.click('#cfgpla-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const t = await page.locator('#modal-sistema').innerText();
    expect(t).toContain('Cambia el nombre «Tajada madura» por «Tajadas»');
    expect(t).toContain('🚫 Se retira: Tajadas');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('46 platos activos de 47');
  });

  test('no se guarda con un nombre vacío ni repetido: avisa con el mismo mensaje del servidor y no manda nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await page.click('#cfgpla-agregar-sopa');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('.toast').last()).toContainText('Falta el nombre de un plato nuevo');
    await nombre(page, BASE.length).fill('sopa de queso');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('.toast').last()).toContainText('El plato "sopa de queso" está repetido en su lista.');
    await nombre(page, BASE.length).fill('Sopa <b>');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('.toast').last()).toContainText('Los nombres no pueden llevar los caracteres');
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg)).toEqual([]);
    expect(await page.evaluate(() => cfgPla.length)).toBe(BASE.length + 1);                                // y lo escrito sigue ahí
  });

  test('una proteína y un asado no pueden llamarse igual (los pedidos los guardan en el mismo campo)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.click('#cfgpla-agregar-asado');
    await nombre(page, BASE.length).fill('pollo frito');
    await page.click('#cfgpla-guardar');
    await expect(page.locator('.toast').last()).toContainText('El plato "pollo frito" está repetido en su lista.');
    expect(escrituras(reg)).toEqual([]);
  });

  test('el máximo son 300 platos', async ({ page }) => {
    await abrirAdmin(page, { datos: datosCon([fila(1, [...BASE, ...Array.from({ length: 253 }, (_, k) => nuevo(`PT${28 + k}`, 'proteina', `Relleno ${k + 1}`))])]) });
    await page.click('#cfgpla-agregar-sopa');
    await expect(page.locator('.toast').last()).toContainText('Ya hay 300 platos: es el máximo');
    expect(await page.evaluate(() => cfgPlaFilas().length)).toBe(300);
  });

  test('si otro administrador cambió lo mismo mientras tanto, no se pisa su cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombre(page, 0), 'Sopa de Huesos');
    reg.datos.configuracion.push(fila(77, cambiar(BASE, 'SP02', { nombre: 'Sopa de Queso fresco' }), '2026-10-20T13:59:00-05:00', 'otro'));   // el otro guardó antes
    await page.click('#cfgpla-guardar');
    await expect(page.locator('.toast').last()).toContainText('Alguien más acaba de cambiar esto');
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg)).toEqual([]);                                                                    // no se mandó nada
    await expect(nombre(page, IDX('SP02'))).toHaveValue('Sopa de Queso fresco');                           // y la pantalla ya muestra lo del otro
    await expect(nombre(page, 0)).toHaveValue('Sopa de Hueso');                                             // lo tuyo se descartó para que lo rehagas
  });

  test('mientras se escribe, un cambio ajeno que llega no pisa lo escrito', async ({ page }) => {
    await abrirAdmin(page);
    await escribir(nombre(page, 0), 'Sopa de Hu');
    await nombre(page, 0).focus();
    await page.evaluate(v => { ST.configuracion = ST.configuracion.concat([{ id: 60, clave: 'menu_platos', valor: v, vigente_desde: '2026-10-20T13:00:00-05:00', creado_por: 'otro', creado_en: '2026-10-20T13:00:00-05:00' }]); renderAll(); }, cambiar(BASE, 'SP02', { nombre: 'Sopa de Queso fresco' }));
    await expect(nombre(page, 0)).toHaveValue('Sopa de Hu');
    await expect(nombre(page, 0)).toBeFocused();                                                         // y no se pierde el cursor mientras se escribe
    await expect(page.locator('#cfgpla-hoy')).toContainText('por otro');
  });

  test('si el servidor rechaza la lista se avisa con su mensaje y nada queda a medias', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await page.evaluate(() => { window.cfgValidar = () => null; });                                         // la pantalla "se equivoca": el servidor la ataja
    await page.click('#cfgpla-agregar-sopa');
    await nombre(page, BASE.length).fill('Sopa de Queso');
    await page.click('#cfgpla-guardar');
    await confirmar(page);
    await expect(page.locator('.toast').last()).toContainText('No se pudo guardar: El plato "Sopa de Queso" está repetido en su lista.');
    expect(reg.datos.configuracion.filter(f => f.clave === 'menu_platos')).toEqual([]);
    await expect(page.locator('#cfgpla-contador')).toHaveText('1 cambio sin guardar');                       // lo escrito sigue ahí para corregirlo
    await expect(page.locator('#cfgpla-guardar')).toBeEnabled();
  });

  test('solo el administrador guarda: caja no puede', async ({ page }) => {
    aceptarAvisos(page);
    const reg = await abrirSistema(page, { usuario: 'caja' });
    await page.evaluate(() => { cfgPlaBorrador()[0].nombre = 'Sopa de Huesos'; return cfgPlaGuardar(); });
    await expect(page.locator('.toast').last()).toContainText('Solo el administrador puede cambiar la configuración');
    expect(escrituras(reg)).toEqual([]);
    expect((await nombresPL(page, 'sopa'))[0]).toBe('Sopa de Hueso');                                       // y caja sí ve la lista (la lee para Pedidos)
  });

  test('el historial cuenta cada versión contra la anterior', async ({ page }) => {
    const v1 = cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' });
    const v2 = [...cambiar(cambiar(v1, 'AR01', { activo: false }), 'PT03', { nombre: 'Pollo en salsa roja' }), nuevo('SP10', 'sopa', 'Sopa de Mondongo')];
    await abrirAdmin(page, { datos: datosCon([fila(1, v1, '2026-10-10T10:00:00-05:00'), fila(2, v2, '2026-10-15T10:00:00-05:00')]) });
    const filas = page.locator('#config-historial tbody tr', { hasText: 'Platos del menú' });
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText('3 cambios');
    await expect(filas.nth(0)).toContainText('Nombre: «Pollo en salsa de tomate» → «Pollo en salsa roja»');
    await expect(filas.nth(0)).toContainText('rige hoy');
    await expect(filas.nth(1)).toContainText('1 cambio: Nombre: «Sopa de Hueso» → «Sopa de Huesos»');
  });
});

// ── 7. El sistema le deja la lista al generador del Menú ───────────────────────────
const CLAVE_LS = 'elLobo_menu_platos';
const publicado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), CLAVE_LS);
const esperado = v => ({ v: 1, sopas: nombresActivos(v, 'sopa'), arroces: nombresActivos(v, 'arroz'), proteinas: nombresActivos(v, 'proteina'), acomp: nombresActivos(v, 'acomp') });

test.describe('el sistema le deja la lista al generador', () => {
  test('sin nada guardado deja los platos de siempre (sin los asados, que el generador no usa)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    expect(await publicado(page)).toEqual(esperado(BASE));
    expect((await publicado(page)).proteinas).not.toContain('Asado de cerdo');
  });
  test('deja el nombre de hoy y solo lo activo', async ({ page }) => {
    const v = [...cambiar(cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }), 'AR02', { activo: false }), nuevo('PT28', 'proteina', 'Cerdo Agridulce'), nuevo('AC04', 'acomp', 'Ensalada', false)];
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, v)]) });
    expect(await publicado(page)).toEqual(esperado(v));
    const p = await publicado(page);
    expect(p.sopas[0]).toBe('Sopa de Huesos');
    expect(p.arroces).not.toContain('Arroz de Coco');
    expect(p.acomp).not.toContain('Ensalada');
  });
  test('al guardar un cambio en Configuración se actualiza en el acto', async ({ page }) => {
    await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombre(page, IDX('PT04')), 'Pollo Crocante');
    await page.click('#cfgpla-guardar');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('por dueno1');
    expect((await publicado(page)).proteinas).toContain('Pollo Crocante');
    expect((await publicado(page)).proteinas).not.toContain('Pollo Frito');
  });
  test('antes de entrar (sin datos) no pisa lo que ya había', async ({ page }) => {
    await abrirSistema(page, { usuario: null, esperarLogin: true });
    expect(await publicado(page)).toBeNull();
  });
  test('un navegador sin almacenamiento no rompe el sistema', async ({ page }) => {
    await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('sin almacenamiento'); }; });
    aceptarAvisos(page);
    const reg = await abrirSistema(page, { usuario: 'admin' }).catch(e => { throw e; });
    expect((await nombresPL(page, 'sopa')).length).toBe(9);
    expect(reg.errores).toEqual([]);
  });
});

// ── 8. El generador del Menú ───────────────────────────────────────────────────────
const MENU_LISTAS = { sopas: 'lista-sopas', arroces: 'lista-arroces', proteinas: 'lista-proteinas', acomp: 'lista-acomp' };
const etiquetas = (pg, id) => pg.evaluate(i => [...document.querySelectorAll(`#${i} label`)].map(l => l.textContent), id);
async function abrirMenu(page, almacen) {
  if (almacen !== undefined) await page.addInitScript(([k, v]) => { try { if (v === null) localStorage.removeItem(k); else if (!sessionStorage.getItem('__sembrado')) { localStorage.setItem(k, v); sessionStorage.setItem('__sembrado', '1'); } } catch (e) {} }, [CLAVE_LS, almacen === null ? null : (typeof almacen === 'string' ? almacen : JSON.stringify(almacen))]);
  await page.goto(URL_MENU, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof buildMenuLists === 'function' && !!document.getElementById('lista-sopas'));
}
const listasDelMenu = async pg => Object.fromEntries(await Promise.all(Object.entries(MENU_LISTAS).map(async ([k, id]) => [k, await etiquetas(pg, id)])));

test.describe('generador del Menú', () => {
  test('sin la lista del sistema ofrece los platos de siempre, que son los mismos de Pedidos', async ({ page }) => {
    await abrirMenu(page, null);
    const l = await listasDelMenu(page);
    expect(l.sopas).toEqual(nombresActivos(BASE, 'sopa'));
    expect(l.arroces).toEqual(nombresActivos(BASE, 'arroz'));
    expect([...l.proteinas].sort()).toEqual(nombresActivos(BASE, 'proteina').sort());           // mismos platos (el orden de siempre del generador se conserva)
    expect(l.acomp).toEqual(nombresActivos(BASE, 'acomp'));
    expect(await page.evaluate(() => origenPlatos)).toBe('siempre');
  });

  test('con la lista del sistema ofrece exactamente esa', async ({ page }) => {
    const v = [...cambiar(cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }), 'AR02', { activo: false }), nuevo('PT28', 'proteina', 'Cerdo Agridulce')];
    await abrirMenu(page, esperado(v));
    expect(await listasDelMenu(page)).toEqual({ sopas: nombresActivos(v, 'sopa'), arroces: nombresActivos(v, 'arroz'), proteinas: nombresActivos(v, 'proteina'), acomp: nombresActivos(v, 'acomp') });
    expect(await page.evaluate(() => origenPlatos)).toBe('sistema');
  });

  for (const [id, contenido] of [
    ['no es JSON', '{no es json'], ['versión desconocida', JSON.stringify({ ...esperado(BASE), v: 2 })], ['falta una lista', JSON.stringify({ v: 1, sopas: [], arroces: [], proteinas: [] })],
    ['una lista no es lista', JSON.stringify({ ...esperado(BASE), sopas: 'Sopa' })], ['un nombre no es texto', JSON.stringify({ ...esperado(BASE), sopas: [5] })],
    ['un nombre vacío', JSON.stringify({ ...esperado(BASE), sopas: [''] })], ['un nombre de 51 caracteres', JSON.stringify({ ...esperado(BASE), sopas: ['S'.repeat(51)] })],
    ['un nombre que parece texto pero no lo es', JSON.stringify({ ...esperado(BASE), sopas: [{ length: 3 }] })],
    ['más de 300 platos', JSON.stringify({ ...esperado(BASE), sopas: Array.from({ length: 301 }, (_, k) => `Sopa ${k}`) })], ['es nulo', 'null'],
  ]) {
    test(`si lo guardado está dañado (${id}) usa los platos de siempre`, async ({ page }) => {
      await abrirMenu(page, contenido);
      expect((await listasDelMenu(page)).sopas).toEqual(nombresActivos(BASE, 'sopa'));
      expect(await page.evaluate(() => origenPlatos)).toBe('siempre');
    });
  }

  test('un nombre nunca se interpreta como código (ni en las casillas ni en la vista de platos)', async ({ page }) => {
    const raro = '<img src=x onerror="window.__xss=1"> & "comillas"';
    await abrirMenu(page, { ...esperado(BASE), sopas: [raro, 'Sopa normal'] });
    expect(await etiquetas(page, 'lista-sopas')).toEqual([raro, 'Sopa normal']);
    expect(await page.locator('#lista-sopas img').count()).toBe(0);
    await page.evaluate(() => switchTab('admin'));
    expect(await page.locator('#admin-lista-sopas img').count()).toBe(0);
    expect(await page.locator('#admin-lista-sopas li').first().textContent()).toBe(raro);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('la pestaña de platos es solo para ver: no hay dónde escribir ni botones de borrar, y dice dónde se cambian', async ({ page }) => {
    await abrirMenu(page, esperado(BASE));
    await page.evaluate(() => switchTab('admin'));
    await expect(page.locator('#vista-admin')).toBeVisible();
    expect(await page.locator('#vista-admin input, #vista-admin button, #vista-admin textarea').count()).toBe(0);
    expect(await page.locator('#admin-lista-sopas li').allTextContents()).toEqual(nombresActivos(BASE, 'sopa'));
    await expect(page.locator('#badge-proteinas')).toHaveText('27');
    await expect(page.locator('#admin-origen')).toContainText('Configuración → Platos del menú');
    expect(await page.evaluate(() => ['agregarPlato', 'eliminarPlato', 'guardarCatalogo'].map(f => typeof window[f]))).toEqual(['undefined', 'undefined', 'undefined']);
  });

  test('con la pestaña de platos abierta, una lista nueva la actualiza sin recargar', async ({ page }) => {
    await abrirMenu(page, esperado(BASE));
    await page.evaluate(() => switchTab('admin'));
    await expect(page.locator('#admin-lista-sopas li').first()).toHaveText('Sopa de Hueso');
    const v = cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' });
    await page.evaluate(([k, x]) => { localStorage.setItem(k, x); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, [CLAVE_LS, JSON.stringify(esperado(v))]);
    await expect(page.locator('#admin-lista-sopas li').first()).toHaveText('Sopa de Huesos');
    await expect(page.locator('#admin-origen')).toContainText('lista de platos del sistema');
  });

  test('sin la lista del sistema la pestaña de platos avisa que hay que abrir el sistema', async ({ page }) => {
    await abrirMenu(page, null);
    await page.evaluate(() => switchTab('admin'));
    await expect(page.locator('#admin-origen')).toContainText('todavía no recibió la lista del sistema');
  });

  test('lo que se marcó para el menú se conserva cuando llega una lista nueva (y se desmarca lo que ya no está)', async ({ page }) => {
    await abrirMenu(page, esperado(BASE));
    await page.locator('#lista-sopas label', { hasText: 'Sopa de Queso' }).click();
    await page.locator('#lista-sopas label', { hasText: 'Sopa de Hueso' }).click();
    await page.locator('#lista-proteinas label', { hasText: 'Carne Guisada' }).click();
    expect(await page.evaluate(() => [getSel('sopas'), getSel('proteinas')])).toEqual([['Sopa de Hueso', 'Sopa de Queso'], ['Carne Guisada']]);
    const v = cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' });
    await page.evaluate(([k, x]) => { localStorage.setItem(k, x); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, [CLAVE_LS, JSON.stringify(esperado(v))]);
    expect(await page.evaluate(() => [getSel('sopas'), getSel('proteinas')])).toEqual([['Sopa de Queso'], ['Carne Guisada']]);          // «Sopa de Hueso» ya no existe
    await expect(page.locator('#cnt-sopas')).toHaveText('1');
    await expect(page.locator('#cnt-proteinas')).toHaveText('1');
    expect((await listasDelMenu(page)).sopas[0]).toBe('Sopa de Huesos');
  });

  test('el menú generado usa los platos marcados con el nombre de hoy', async ({ page }) => {
    await abrirMenu(page, esperado(cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' })));
    await page.locator('#lista-sopas label', { hasText: 'Sopa de Huesos' }).click();
    await page.evaluate(() => { window.__textos = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { window.__textos.push(t); return f.call(this, t, ...r); }; });
    await page.evaluate(() => generarMenu());
    await page.waitForFunction(() => window.__textos.some(t => t.includes('Sopa de Huesos')));
    expect(await page.evaluate(() => window.__textos.filter(t => t.startsWith('• ')))).toContain('• Sopa de Huesos');
  });
});

// ── 9. Sistema y generador abiertos a la vez (como en la pestaña «Menú» y en la pestaña aparte) ─────────
test.describe('sistema y generador abiertos a la vez', () => {
  test('lo que el administrador guarda llega al generador ya abierto, sin recargar', async ({ page, context }) => {
    const { reg } = await abrirAdmin(page);
    const menu = await context.newPage();
    await menu.goto(URL_MENU, { waitUntil: 'domcontentloaded' });
    await menu.waitForFunction(() => typeof buildMenuLists === 'function' && !!document.getElementById('lista-sopas'));
    expect((await listasDelMenu(menu)).sopas[0]).toBe('Sopa de Hueso');
    expect(await menu.evaluate(() => origenPlatos)).toBe('sistema');                              // el sistema ya la había dejado al abrirse
    await noAceptarAvisos(page);
    await escribir(nombre(page, IDX('SP01')), 'Sopa de Huesos');
    await page.click('#cfgpla-guardar');
    await confirmar(page);
    await expect(page.locator('#cfgpla-hoy')).toContainText('por dueno1');
    await menu.waitForFunction(() => document.querySelector('#lista-sopas label').textContent === 'Sopa de Huesos');
    expect((await listasDelMenu(menu)).sopas).toEqual(nombresActivos(cambiar(BASE, 'SP01', { nombre: 'Sopa de Huesos' }), 'sopa'));
    expect(escrituras(reg).length).toBe(1);
  });

  test('la pestaña «Menú» del sistema (en el marco) recibe la lista del sistema', async ({ page }) => {
    const v = cambiar(BASE, 'SP02', { nombre: 'Sopa de Queso fresco' });
    aceptarAvisos(page);
    await abrirSistema(page, { usuario: 'admin', datos: datosCon([fila(1, v)]) });
    await irA(page, 'menu');
    const marco = page.frameLocator('#menuFrame');
    await expect(marco.locator('#lista-sopas label').nth(1)).toHaveText('Sopa de Queso fresco');
  });
});
