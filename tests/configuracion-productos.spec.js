// ⚙️ CONFIGURACIÓN → «Productos y precios» (etapa 2): precios, nombres y productos editables por el administrador.
// Todo contra el backend falso (que imita sql/configuracion_etapa_2.sql: valida el catálogo y no deja borrar productos):
// nada toca tu Supabase real. Se comprueba, desde la pantalla, que:
//   · SIN catálogo guardado el sistema se ve y cobra EXACTAMENTE como antes (foto de referencia en fixtures/catalogo-anterior.json);
//   · con catálogo guardado, los desplegables, los precios, los nombres y la lista de productos adicionales lo usan;
//   · un cambio de precio rige para lo NUEVO: un pedido pendiente viejo que se edita usa los precios de cuando se tomó;
//   · lo retirado deja de ofrecerse pero los pedidos viejos lo siguen mostrando (y se puede conservar al editarlos);
//   · un producto o una categoría nueva se vende y aparece en el Tablero;
//   · solo el administrador ve y guarda; cada guardado pide confirmación, se valida antes de enviar y manda UNA fila nueva;
//   · si otro administrador cambió el mismo catálogo mientras tanto, no se pisa su cambio;
//   · lo que el servidor rechaza se avisa con su mensaje; nada queda a medias; lo escrito nunca se interpreta como código.
const fs = require('fs');
const { fileURLToPath } = require('url');
const { test, expect } = require('@playwright/test');
const { abrirSistema, CODIGOS_BASE, URL_HTML } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const ANTERIOR = require('./fixtures/catalogo-anterior.json');

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const fila = (id, clave, valor, desde = '2026-10-01T10:00:00-05:00', por = 'luis') => ({ id, clave, valor, vigente_desde: desde, creado_por: por, creado_en: desde });
const datosCon = filas => { const d = copia(DATOS_BASE); d.configuracion = filas; return d; };
const escrituras = (reg, tabla = 'configuracion') => reg.escrituras.filter(e => e.tabla === tabla);

// Los catálogos base viven en la página como JSON: se leen de ahí (así las pruebas usan los mismos que el sistema).
const TEXTO_HTML = fs.readFileSync(fileURLToPath(URL_HTML), 'utf8');
const leerBase = n => JSON.parse(TEXTO_HTML.match(new RegExp(`const CATALOGO_${n}_BASE = Object\\.freeze\\((\\[[\\s\\S]*?\\n\\])\\.map\\(Object\\.freeze\\)\\)`))[1]);
const BASE = { almuerzos: leerBase('ALMUERZOS'), rapidas: leerBase('RAPIDAS'), extras: leerBase('EXTRAS') };
const CLAVE = { almuerzos: 'catalogo_almuerzos', rapidas: 'catalogo_rapidas', extras: 'catalogo_extras' };
const cambiar = (lista, codigo, cambios) => lista.map(x => (x.codigo === codigo ? { ...x, ...cambios } : x));
const cambiarExtra = (lista, nombre, cambios) => lista.map(x => (x.nombre === nombre ? { ...x, ...cambios } : x));

async function abrirAdmin(page, opciones = {}) {
  const nativos = aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  await irA(page, 'config');
  await expect(page.locator('#config-contenido')).toBeVisible();
  return { reg, nativos };
}
// Se escribe como una persona: el campo n (0 = nombre, 1 = categoría o precio, 2 = precio) de la fila i de la tabla k.
const campo = (page, k, i, nombre) => page.locator(`#cfgcat-fila-${k}-${i} input[aria-label^="${nombre}"]`);
const guardar = (page, k) => page.click(`#cfgcat-guardar-${k}`);
const filaDe = (page, k, nombre) => page.locator(`#cfgcat-cuerpo-${k} tr`).filter({ has: page.locator(`input[value="${nombre}"]`) });
const turno = (page, t) => page.evaluate(x => { turnoManual = x; rebuildPedidoSelect(); }, t);
const opcionesDe = (page, id) => page.evaluate(i => [...document.getElementById(i).querySelectorAll('option')].map(o => ({ valor: o.value, texto: o.textContent.trim(), monto: o.dataset.monto })), id);

// ── 1. Sin catálogo guardado: todo como antes ────────────────────────────────────
test.describe('sin catálogo guardado: valores de siempre', () => {
  test('desplegables, precios, nombres y productos adicionales idénticos a la versión anterior', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    const ahora = await page.evaluate(() => {
      const out = {};
      const opts = id => [...document.getElementById(id).querySelectorAll('option, optgroup')].map(o => o.tagName + '|' + (o.value ?? '') + '|' + (o.label || o.textContent.trim()) + '|' + (o.dataset ? o.dataset.monto : ''));
      for (const t of ['almuerzo', 'cena']) {
        turnoManual = t; rebuildPedidoSelect();
        out['pedido_' + t] = opts('ing-pedido');
        if (t === 'cena') out.bebida = opts('ing-bebida');
      }
      out.precios = PRECIOS; out.labels = LABELS;
      out.cr = PL.comidaRapida.map(p => [p.c, p.n, p.precio ?? null, p.cat]);
      out.extra = PRODUCTOS_EXTRA;
      return out;
    });
    for (const k of Object.keys(ANTERIOR)) expect(ahora[k], k).toEqual(ANTERIOR[k]);
    expect(reg.errores).toEqual([]);
  });

  test('los catálogos base del sistema son exactamente los 8 almuerzos, 49 comidas rápidas y 14 productos adicionales de siempre', async () => {
    expect(BASE.almuerzos.length).toBe(8);
    expect(BASE.rapidas.length).toBe(49);
    expect(BASE.extras.length).toBe(14);
    expect(BASE.almuerzos.find(a => a.codigo === 'porcion-sopa').precio).toBe(6000);     // la porción de sopa vale $6.000
    expect(BASE.almuerzos.concat(BASE.rapidas, BASE.extras).every(x => x.activo === true)).toBe(true);
  });

  test('el generador del menú diario muestra los mismos precios que el sistema', async () => {
    const menu = fs.readFileSync(require('path').resolve(__dirname, '../Menu/Menú diario-El Lobo.html'), 'utf8');
    const lista = JSON.parse(menu.match(/const PRECIOS = (\[.*?\]);/)[1]);
    const codigo = { 'Completo': 'completo', 'Seco': 'seco', 'Porción Sopa': 'porcion-sopa', 'Porción Arroz': 'porcion-arroz', 'Asado 130gr': 'asado130', 'Asado 200gr': 'asado200' };
    const esperado = Object.entries(codigo).map(([nombre, c]) => `${nombre}: $${BASE.almuerzos.find(a => a.codigo === c).precio.toLocaleString('es-CO')}`);
    expect(lista).toEqual(esperado);
  });

  test('la lista de códigos que exige el servidor falso es la misma que los catálogos de la página', async () => {
    expect(CODIGOS_BASE.catalogo_almuerzos).toEqual(BASE.almuerzos.map(a => a.codigo));
    expect(CODIGOS_BASE.catalogo_rapidas).toEqual(BASE.rapidas.map(a => a.codigo));
  });

  test('los catálogos base los acepta el servidor y la revisión de la pantalla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const r = await page.evaluate(async b => {
      const veredictos = Object.keys(b).map(k => cfgValidar('catalogo_' + k, b[k]));
      const guardadas = [];
      for (const k of Object.keys(b)) guardadas.push((await sbInsert('configuracion', { clave: 'catalogo_' + k, valor: b[k] })).length);
      return { veredictos, guardadas };
    }, BASE);
    expect(r).toEqual({ veredictos: [null, null, null], guardadas: [1, 1, 1] });
    expect(reg.denegadas).toEqual([]);
  });

  test('si la tabla todavía no existe en Supabase: valores de siempre, sin errores, y los botones quedan apagados', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { tablasFaltantes: ['configuracion'] });
    expect(await page.evaluate(() => PRECIOS.completo)).toBe(14000);
    expect(await page.evaluate(() => PL.comidaRapida.length)).toBe(49);
    for (const k of ['almuerzos', 'rapidas', 'extras']) {
      await expect(page.locator(`#cfgcat-guardar-${k}`)).toBeDisabled();
      await expect(page.locator(`#cfgcat-cuerpo-${k} input`).first()).toBeDisabled();
    }
    await expect(page.locator('#cfgcat-agregar-rapidas')).toBeDisabled();
    expect(await page.evaluate(() => cfgCatGuardar('almuerzos'))).toBeUndefined();
    expect(escrituras(reg)).toEqual([]);
  });
});

// ── 2. Con catálogos guardados: todo lo que estaba fijo los usa ───────────────────
test.describe('con catálogos guardados', () => {
  test('un precio de almuerzo nuevo se ve en el formulario, en los precios y en el texto del desplegable', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 15000 }))]) });
    expect(await page.evaluate(() => PRECIOS.completo)).toBe(15000);
    await turno(page, 'almuerzo');
    const op = (await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'completo');
    expect(op).toEqual({ valor: 'completo', texto: 'Almuerzo Completo (con sopa) · $15.000', monto: '15000' });
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'seco').monto).toBe('12000');     // lo demás no cambia
  });

  test('un nombre nuevo se ve en el desplegable y en las etiquetas; el sufijo «(con sopa)» sigue siendo del almuerzo completo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([
      fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { nombre: 'Corrientazo' })),
      fila(2, CLAVE.rapidas, cambiar(BASE.rapidas, 'PE01', { nombre: 'Perro Clásico', precio: 5500 })),
    ]) });
    await turno(page, 'almuerzo');
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'completo').texto).toBe('Corrientazo (con sopa) · $14.000');
    await turno(page, 'cena');
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'PE01')).toEqual({ valor: 'PE01', texto: 'Perro Clásico · $5.500', monto: '5500' });
    expect(await page.evaluate(() => [LABELS.completo, LABELS.PE01])).toEqual(['Corrientazo', 'Perro Clásico']);
  });

  test('lo retirado no se ofrece para vender, pero los pedidos viejos lo siguen mostrando', async ({ page }) => {
    const d = datosCon([
      fila(1, CLAVE.rapidas, cambiar(cambiar(BASE.rapidas, 'PE02', { activo: false }), 'BEB04', { activo: false })),
      fila(2, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'seco', { activo: false })),
    ]);
    d.pedidos.push({ ...d.pedidos.find(p => p.id === 203), id: 301, turno: 'cena', pedido: 'PE02', monto_unit: 7000, monto_almuerzo: 7000, monto_total: 7000, mesa: 4 });
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await turno(page, 'cena');
    expect((await opcionesDe(page, 'ing-pedido')).map(o => o.valor)).not.toContain('PE02');
    expect((await opcionesDe(page, 'ing-pedido')).map(o => o.valor)).toContain('PE01');
    expect((await opcionesDe(page, 'ing-bebida')).map(o => o.valor)).not.toContain('BEB04');
    expect((await opcionesDe(page, 'ing-bebida')).map(o => o.valor)).toContain('BEB01');
    await turno(page, 'almuerzo');
    expect((await opcionesDe(page, 'ing-pedido')).map(o => o.valor)).not.toContain('seco');
    // …pero siguen existiendo para mostrar lo ya vendido:
    expect(await page.evaluate(() => [LABELS.PE02, LABELS.BEB04, LABELS.seco, PRECIOS.seco])).toEqual(['Perro Doble', 'Agua en botella', 'Almuerzo Seco', 12000]);
    // …y al editar un pedido viejo que lo tiene, ese producto sigue en la lista (marcado «retirado») para no cambiarlo sin querer.
    await page.evaluate(() => abrirModalEditarPedido(301));
    const ops = await opcionesDe(page, 'editar-ped-tipo');
    expect(ops.find(o => o.valor === 'PE02').texto).toBe('Perro Doble · $7.000 (retirado)');
    expect(await page.locator('#editar-ped-tipo').inputValue()).toBe('PE02');
  });

  test('una categoría y un producto nuevos se ofrecen, se venden y aparecen en el Tablero', async ({ page }) => {
    const rapidas = [...BASE.rapidas, { codigo: 'X001', nombre: 'Flan de la casa', precio: 6000, categoria: 'POSTRES', activo: true }];
    const d = datosCon([fila(1, CLAVE.rapidas, rapidas)]);
    d.pedidos.push({ ...d.pedidos.find(p => p.id === 105), id: 302, pedido: 'X001', monto_unit: 6000, monto_almuerzo: 6000, monto_total: 6000, detalle: 'Flan de la casa' });
    d.cierres_dia.push({ id: 90, fecha: '2026-10-20', turno: 'cena', efectivo: 24000, transferencia: 0, gastos: 0, resultado: 24000, manual: false, platos_familia: 0 });   // la noche de hoy ya está cerrada: el Tablero cuenta sus pedidos
    const reg = await abrirSistema(page, { usuario: 'admin', datos: d });
    await turno(page, 'cena');
    expect(await page.locator('#ing-pedido optgroup').evaluateAll(g => g.map(x => x.label))).toContain('🌙 POSTRES');
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'X001')).toEqual({ valor: 'X001', texto: 'Flan de la casa · $6.000', monto: '6000' });
    await irA(page, 'dashboard');
    await expect(page.locator('#rp-cr-categorias')).toContainText('POSTRES');
    await expect(page.locator('#rp-cr-categorias')).toContainText('Flan de la casa');
    expect(reg.errores).toEqual([]);
  });

  test('los productos adicionales salen de su catálogo (los retirados no)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([fila(1, CLAVE.extras, [...cambiarExtra(BASE.extras, 'Avena', { activo: false }), { nombre: 'Brownie', precio: 3500, activo: true }])]) });
    const nombres = await page.evaluate(() => PRODUCTOS_EXTRA.map(p => p.n));
    expect(nombres).toContain('Brownie');
    expect(nombres).not.toContain('Avena');
    expect(nombres).toContain('Papa Francesa');
    expect(await page.evaluate(() => PRODUCTOS_EXTRA.find(p => p.n === 'Brownie').precio)).toBe(3500);
    const lista = await page.evaluate(() => [...document.querySelectorAll('#extra-producto-catalogo option')].map(o => o.textContent));
    expect(lista).toContain('Brownie · $3.500');
  });

  test('qué precio regía en cada fecha: antes del primer cambio, el de siempre; después, el de cada versión', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([
      fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 15000 }), '2026-10-10T10:00:00-05:00'),
      fila(2, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 16000 }), '2026-10-18T10:00:00-05:00'),
    ]) });
    const r = await page.evaluate(() => ({
      antes: precioProducto('completo', '2026-10-05T12:00:00-05:00'), uno: precioProducto('completo', '2026-10-12T12:00:00-05:00'),
      dos: precioProducto('completo', '2026-10-19T12:00:00-05:00'), justo: precioProducto('completo', '2026-10-10T10:00:00-05:00'),
      hoy: precioProducto('completo'), ilegible: precioProducto('completo', 'no es fecha'), vacio: precioProducto('completo', null),
      inexistente: precioProducto('NOEXISTE'),
    }));
    expect(r).toEqual({ antes: 14000, uno: 15000, dos: 16000, justo: 15000, hoy: 16000, ilegible: 16000, vacio: 16000, inexistente: 0 });
  });

  test('rige el último cambio por «vigente desde» (no por el orden de las filas) y una versión dañada se ignora', async ({ page }) => {
    const sinPE01 = BASE.rapidas.filter(p => p.codigo !== 'PE01');                               // le falta un código de El Lobo: no sirve
    const conTexto = cambiar(BASE.rapidas, 'PE03', { nombre: '<img src=x onerror=window.__hackeado=1>' });   // trae código: no sirve
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([
      fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 17000 }), '2026-10-15T10:00:00-05:00'),     // la más NUEVA, aunque tenga el id más bajo
      fila(2, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 15000 }), '2026-10-05T10:00:00-05:00'),
      fila(3, CLAVE.rapidas, cambiar(BASE.rapidas, 'PE01', { precio: 5500 }), '2026-10-05T10:00:00-05:00'),
      fila(4, CLAVE.rapidas, sinPE01, '2026-10-10T10:00:00-05:00'),
      fila(5, CLAVE.rapidas, conTexto, '2026-10-12T10:00:00-05:00'),
      fila(6, CLAVE.extras, 'esto no es una lista', '2026-10-12T10:00:00-05:00'),
      fila(7, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'seco', { precio: 99 }), '2026-10-16T10:00:00-05:00'),            // precio fuera de rango
    ]) });
    const r = await page.evaluate(() => ({ completo: PRECIOS.completo, seco: PRECIOS.seco, pe01: PL.comidaRapida.find(p => p.c === 'PE01').precio, pe03: LABELS.PE03, n: PL.comidaRapida.length, extras: PRODUCTOS_EXTRA.length }));
    expect(r).toEqual({ completo: 17000, seco: 12000, pe01: 5500, pe03: 'Perro Doble con Chorizo', n: 49, extras: 14 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ img: document.querySelectorAll('img[src="x"]').length, hack: window.__hackeado || 0 }))).toEqual({ img: 0, hack: 0 });
  });

  test('editar un pedido pendiente viejo usa los precios de cuando se tomó, no los de hoy (almuerzos y comidas rápidas)', async ({ page }) => {
    const d = datosCon([
      fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 15000 }), '2026-10-18T10:00:00-05:00'),
      fila(2, CLAVE.rapidas, cambiar(cambiar(BASE.rapidas, 'PE06', { precio: 16000 }), 'BEB01', { precio: 4500 }), '2026-10-18T10:00:00-05:00'),
    ]);
    const base203 = d.pedidos.find(p => p.id === 203);
    d.pedidos.push({ ...base203, id: 301, pedido: 'completo', mesa: 4, monto_unit: 14000, monto_almuerzo: 14000, monto_total: 14000, created_at: '2026-10-12T12:00:00-05:00', fecha: '2026-10-12' });   // se hizo a $14.000
    d.pedidos.push({ ...base203, id: 302, pedido: 'completo', mesa: 5, monto_unit: 15000, monto_almuerzo: 15000, monto_total: 15000, created_at: '2026-10-19T12:00:00-05:00', fecha: '2026-10-19' }); // se hizo a $15.000
    d.pedidos.push({ ...base203, id: 303, turno: 'cena', pedido: 'PE06', mesa: 6, monto_unit: 15000, monto_almuerzo: 15000, monto_total: 15000, created_at: '2026-10-12T19:00:00-05:00', fecha: '2026-10-12' });
    const { reg } = await abrirAdmin(page, { datos: d });
    const ver = (id, cantidad) => page.evaluate(([i, c]) => {
      abrirModalEditarPedido(i);
      document.getElementById('editar-ped-cantidad').value = String(c);
      recalcularEditarPedidoMonto();
      const sel = document.getElementById('editar-ped-tipo');
      return { monto: document.getElementById('editar-ped-monto-display').textContent, opcion: sel.selectedOptions[0].dataset.monto, hoy: PRECIOS.completo };
    }, [id, cantidad]);
    const viejo = await ver(301, 2), nuevo = await ver(302, 2);
    expect(viejo).toEqual({ monto: await page.evaluate(() => fmt(28000)), opcion: '14000', hoy: 15000 });     // 2 × $14.000
    expect(nuevo).toEqual({ monto: await page.evaluate(() => fmt(30000)), opcion: '15000', hoy: 15000 });     // 2 × $15.000
    const cena = await ver(303, 1);
    expect(cena.opcion).toBe('15000');                                                                          // la comida rápida también: $15.000, no los $16.000 de hoy
    // Al guardar la edición del viejo, lo que se manda a la base usa los $14.000 de entonces.
    await page.evaluate(() => { abrirModalEditarPedido(301); document.getElementById('editar-ped-cantidad').value = '2'; return guardarEdicionPedido(); });
    await expect.poll(() => escrituras(reg, 'pedidos').filter(e => e.metodo === 'PATCH').length).toBe(1);
    const parche = escrituras(reg, 'pedidos').find(e => e.metodo === 'PATCH').cuerpo;
    expect(parche).toMatchObject({ monto_unit: 14000, monto_almuerzo: 28000, monto_total: 28000, cantidad: 2 });
    // Lo mismo con una comida rápida + bebida: PE06 a $15.000 y BEB01 a $4.000 (lo de entonces), no $16.000 + $4.500 (lo de hoy).
    await page.evaluate(() => { abrirModalEditarPedido(303); document.getElementById('editar-ped-bebida').value = 'BEB01'; return guardarEdicionPedido(); });
    await expect.poll(() => escrituras(reg, 'pedidos').filter(e => e.metodo === 'PATCH').length).toBe(2);
    const parcheRapida = escrituras(reg, 'pedidos').filter(e => e.metodo === 'PATCH')[1].cuerpo;
    expect(parcheRapida).toMatchObject({ pedido: 'PE06', monto_unit: 19000, monto_almuerzo: 19000, monto_total: 19000 });
    expect(reg.errores).toEqual([]);
  });

  test('un pedido nuevo (formulario de Pedidos) cobra el precio de hoy', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { datos: datosCon([fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'asado130', { precio: 18500 }))]) });
    await irA(page, 'ingresos');
    await turno(page, 'almuerzo');
    await page.selectOption('#ing-pedido', 'asado130');
    expect(await page.evaluate(() => { const s = document.getElementById('ing-pedido'); return s.selectedOptions[0].dataset.monto; })).toBe('18500');
    expect(await page.evaluate(() => PRECIOS[document.getElementById('ing-pedido').value])).toBe(18500);
    expect(reg.errores).toEqual([]);
  });
});

// ── 3. La pantalla del administrador ─────────────────────────────────────────────
test.describe('pantalla «Productos y precios»', () => {
  test('sin cambios guardados muestra los 8 almuerzos, las 49 comidas rápidas y los 14 adicionales «de siempre»', async ({ page }) => {
    await abrirAdmin(page);
    await expect(page.locator('#cfgcat-cuerpo-almuerzos tr')).toHaveCount(8);
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(49);
    await expect(page.locator('#cfgcat-cuerpo-extras tr')).toHaveCount(14);
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('8 activos de 8');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('el catálogo de siempre');
    for (const k of ['almuerzos', 'rapidas', 'extras']) { await expect(page.locator(`#cfgcat-guardar-${k}`)).toBeDisabled(); await expect(page.locator(`#cfgcat-descartar-${k}`)).toBeDisabled(); }
    await expect(campo(page, 'almuerzos', 0, 'Precio')).toHaveValue('14.000');
    await expect(page.locator('#cfgcat-fila-almuerzos-0 .cfgcat-cod')).toHaveText('completo');
    await expect(page.locator('#cfgcat-agregar-almuerzos')).toHaveCount(0);                    // los 8 tipos de almuerzo no se crean
  });

  test('cambiar un precio marca la fila, cuenta el cambio y «Descartar» lo deshace', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Precio').fill('15500');
    await expect(campo(page, 'almuerzos', 0, 'Precio')).toHaveValue('15.500');                // se escribe con puntos de miles
    await expect(page.locator('#cfgcat-fila-almuerzos-0')).toHaveClass(/cfgcat-cambio/);
    await expect(page.locator('#cfgcat-contador-almuerzos')).toHaveText('1 cambio sin guardar');
    await expect(page.locator('#cfgcat-guardar-almuerzos')).toBeEnabled();
    await expect(page.locator('#cfgcat-guardar-rapidas')).toBeDisabled();                      // las otras tablas no cambian
    await page.click('#cfgcat-descartar-almuerzos');
    await expect(campo(page, 'almuerzos', 0, 'Precio')).toHaveValue('14.000');
    await expect(page.locator('#cfgcat-contador-almuerzos')).toHaveText('');
    await expect(page.locator('#cfgcat-guardar-almuerzos')).toBeDisabled();
    // volver a escribir el valor de antes tampoco cuenta como cambio
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    await campo(page, 'almuerzos', 0, 'Precio').fill('14000');
    await expect(page.locator('#cfgcat-guardar-almuerzos')).toBeDisabled();
    expect(escrituras(reg)).toEqual([]);
  });

  test('guardar un precio: pide confirmación con lo que cambia, manda UNA fila con el catálogo completo y todo lo usa', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await campo(page, 'almuerzos', 0, 'Precio').fill('15500');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const texto = await page.locator('#modal-sistema').innerText();
    expect(texto).toContain('Almuerzos');
    expect(texto).toContain('$14.000 → $15.500');
    expect(texto).toContain('Rigen desde ahora');
    expect(texto).toContain('conserva los precios de cuando se tomó');
    expect(escrituras(reg)).toEqual([]);                                                       // todavía no se mandó nada
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    const filas = escrituras(reg);
    expect(filas.length).toBe(1);
    expect(filas[0].cuerpo).toEqual({ clave: 'catalogo_almuerzos', valor: cambiar(BASE.almuerzos, 'completo', { precio: 15500 }) });
    await expect(page.locator('#cfgcat-contador-almuerzos')).toHaveText('');
    await expect(page.locator('#cfgcat-guardar-almuerzos')).toBeDisabled();
    expect(await page.evaluate(() => PRECIOS.completo)).toBe(15500);
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'completo').monto).toBe('15500');   // el formulario de Pedidos ya lo tiene, sin recargar ni cambiar de turno
    // el historial lo cuenta con palabras
    const histo = page.locator('#config-historial tbody tr').first();
    await expect(histo).toContainText('Productos: Almuerzos');
    await expect(histo).toContainText('Almuerzo Completo: $14.000 → $15.500');
    await expect(histo).toContainText('rige hoy');
    expect(reg.errores).toEqual([]);
  });

  test('la confirmación lo cuenta en palabras: nombre, categoría, retirado, reactivado y nuevo', async ({ page }) => {
    await abrirAdmin(page, { datos: datosCon([fila(1, CLAVE.rapidas, cambiar(BASE.rapidas, 'PE02', { activo: false }))]) });
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await campo(page, 'rapidas', 0, 'Nombre').fill('Perro Clásico');
    await campo(page, 'rapidas', 0, 'Categor').fill('PERRITOS');
    await page.locator('#cfgcat-fila-rapidas-1 button', { hasText: 'Reactivar' }).click();
    await page.locator('#cfgcat-fila-rapidas-2 button', { hasText: 'Retirar' }).click();
    await page.click('#cfgcat-agregar-rapidas');
    await campo(page, 'rapidas', 49, 'Nombre').fill('Flan');
    await campo(page, 'rapidas', 49, 'Categor').fill('postres');
    await campo(page, 'rapidas', 49, 'Precio').fill('6000');
    await guardar(page, 'rapidas');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const texto = await page.locator('#modal-sistema').innerText();
    expect(texto).toContain('Nombre: «Perro Sencillo» → «Perro Clásico»');
    expect(texto).toContain('Perro Clásico: categoría PERROS → PERRITOS');
    expect(texto).toContain('✅ Se reactiva: Perro Doble');
    expect(texto).toContain('🚫 Se retira: Perro Doble con Chorizo');
    expect(texto).toContain('➕ Nuevo: Flan · $6.000 · POSTRES');
    await page.click('#sis-opciones button[data-eleccion="no"]');
  });

  test('el historial resume cada cambio contra la versión anterior, no contra los valores de siempre', async ({ page }) => {
    await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#config-historial tbody tr')).toHaveCount(3);                   // las 2 filas de ejemplo + esta
    await campo(page, 'almuerzos', 0, 'Precio').fill('16000');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#config-historial tbody tr')).toHaveCount(4);
    await expect(page.locator('#config-historial tbody tr').first()).toContainText('$15.000 → $16.000');
    await expect(page.locator('#config-historial tbody tr').first()).toContainText('rige hoy');
    await expect(page.locator('#config-historial tbody tr').nth(1)).toContainText('$14.000 → $15.000');
    await expect(page.locator('#config-historial tbody tr').nth(1)).not.toContainText('rige hoy');
  });

  test('lo que se manda a la base va limpio: sin espacios dobles, categoría en mayúsculas y sin marcas internas', async ({ page }) => {
    await abrirAdmin(page);
    const r = await page.evaluate(() => cfgCatPayload('rapidas', [{ codigo: 'X001', nombre: '  Flan   de  casa ', precio: 6000, categoria: ' postres ', activo: true, _nuevo: true }]));
    expect(r).toEqual([{ codigo: 'X001', nombre: 'Flan de casa', precio: 6000, categoria: 'POSTRES', activo: true }]);
  });

  test('un producto ya guardado no se puede quitar de la tabla: solo retirar', async ({ page }) => {
    await abrirAdmin(page);
    await page.evaluate(() => cfgCatQuitar('rapidas', 0));
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(49);
    await expect(page.locator('#cfgcat-contador-rapidas')).toHaveText('');
  });

  test('un nombre escrito a medias con comillas o signos de código no rompe ni inyecta nada al volver a dibujar la tabla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const malo = '" onfocus="window.__x=1" x="<img src=x onerror=window.__y=1>';
    await campo(page, 'almuerzos', 0, 'Nombre').evaluate((e, t) => { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, malo);
    await page.locator('#cfgcat-fila-almuerzos-1 button', { hasText: 'Retirar' }).click();        // vuelve a dibujar la tabla con lo escrito
    await expect(campo(page, 'almuerzos', 0, 'Nombre')).toHaveValue(malo);
    await campo(page, 'almuerzos', 0, 'Nombre').focus();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ x: window.__x || 0, y: window.__y || 0, img: document.querySelectorAll('img[src="x"]').length }))).toEqual({ x: 0, y: 0, img: 0 });
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await guardar(page, 'almuerzos');                                                           // la revisión lo rechaza: no manda nada
    await expect(page.locator('.toast').last()).toContainText('no pueden llevar los caracteres');
    expect(escrituras(reg)).toEqual([]);
  });

  test('«Volver» en la confirmación no guarda nada y conserva lo escrito', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await campo(page, 'almuerzos', 1, 'Precio').fill('13000');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await page.click('#sis-opciones button[data-eleccion="no"]');
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg)).toEqual([]);
    await expect(campo(page, 'almuerzos', 1, 'Precio')).toHaveValue('13.000');
    await expect(page.locator('#cfgcat-contador-almuerzos')).toHaveText('1 cambio sin guardar');
  });

  test('lo escrito sin guardar sobrevive a que la pantalla se vuelva a dibujar', async ({ page }) => {
    await abrirAdmin(page);
    await campo(page, 'rapidas', 0, 'Nombre').fill('Perro Nuevo');
    await page.evaluate(() => renderAll());
    await expect(campo(page, 'rapidas', 0, 'Nombre')).toHaveValue('Perro Nuevo');
    await expect(page.locator('#cfgcat-contador-rapidas')).toHaveText('1 cambio sin guardar');
  });

  test('retirar y reactivar: se ve el estado, se guarda activo = false y deja de ofrecerse', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.locator('#cfgcat-fila-rapidas-1 button', { hasText: 'Retirar' }).click();
    await expect(page.locator('#cfgcat-fila-rapidas-1')).toHaveClass(/cfgcat-retirado/);
    await expect(page.locator('#cfgcat-fila-rapidas-1')).toContainText('retirado');
    await expect(page.locator('#cfgcat-fila-rapidas-1 button')).toHaveText('Reactivar');
    await guardar(page, 'rapidas');
    await expect(page.locator('#cfgcat-hoy-rapidas')).toContainText('48 activos de 49');
    expect(escrituras(reg)[0].cuerpo.valor.find(p => p.codigo === 'PE02').activo).toBe(false);
    await turno(page, 'cena');
    expect((await opcionesDe(page, 'ing-pedido')).map(o => o.valor)).not.toContain('PE02');
    expect(await page.evaluate(() => LABELS.PE02)).toBe('Perro Doble');
    // reactivar
    await page.locator('#cfgcat-fila-rapidas-1 button', { hasText: 'Reactivar' }).click();
    await guardar(page, 'rapidas');
    await expect(page.locator('#cfgcat-hoy-rapidas')).toContainText('49 activos de 49');
    await turno(page, 'cena');
    expect((await opcionesDe(page, 'ing-pedido')).map(o => o.valor)).toContain('PE02');
    expect(escrituras(reg).length).toBe(2);
  });

  test('agregar un producto nuevo: código X001, categoría nueva en mayúsculas, precio con puntos; el segundo es X002', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.click('#cfgcat-agregar-rapidas');
    const n = 49;
    await expect(page.locator(`#cfgcat-fila-rapidas-${n} .cfgcat-cod`)).toHaveText('X001');
    await expect(page.locator(`#cfgcat-fila-rapidas-${n}`)).toHaveClass(/cfgcat-nuevo/);
    await expect(page.locator(`#cfgcat-fila-rapidas-${n} input`).first()).toBeFocused();       // listo para escribir el nombre
    await campo(page, 'rapidas', n, 'Nombre').fill('Flan de la casa');
    await campo(page, 'rapidas', n, 'Categor').fill('postres');
    await expect(campo(page, 'rapidas', n, 'Categor')).toHaveValue('POSTRES');
    await campo(page, 'rapidas', n, 'Precio').fill('6500');
    await expect(campo(page, 'rapidas', n, 'Precio')).toHaveValue('6.500');
    await page.click('#cfgcat-agregar-rapidas');
    await expect(page.locator(`#cfgcat-fila-rapidas-${n + 1} .cfgcat-cod`)).toHaveText('X002');
    await page.locator(`#cfgcat-fila-rapidas-${n + 1} button`, { hasText: 'Quitar' }).click();    // lo no guardado se puede quitar
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(50);
    await expect(page.locator('#cfgcat-contador-rapidas')).toHaveText('1 cambio sin guardar');
    await guardar(page, 'rapidas');
    await expect(page.locator('#cfgcat-hoy-rapidas')).toContainText('50 activos de 50');
    expect(escrituras(reg)[0].cuerpo.valor[49]).toEqual({ codigo: 'X001', nombre: 'Flan de la casa', precio: 6500, categoria: 'POSTRES', activo: true });
    // ya guardado: se ofrece, tiene su categoría, y el código no se puede cambiar ni quitar
    await turno(page, 'cena');
    expect(await page.locator('#ing-pedido optgroup').evaluateAll(g => g.map(x => x.label))).toContain('🌙 POSTRES');
    await expect(page.locator(`#cfgcat-fila-rapidas-${n}`)).not.toHaveClass(/cfgcat-nuevo/);
    await expect(page.locator(`#cfgcat-fila-rapidas-${n} button`)).toHaveText('Retirar');
    await expect(page.locator('#cfgcat-categorias option[value="POSTRES"]')).toHaveCount(1);
    // el siguiente producto nuevo es X002 (X001 ya está usado)
    await page.click('#cfgcat-agregar-rapidas');
    await expect(page.locator('#cfgcat-fila-rapidas-50 .cfgcat-cod')).toHaveText('X002');
    expect(reg.errores).toEqual([]);
  });

  test('agregar un producto adicional; el nombre repetido (sin importar mayúsculas) se rechaza', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.click('#cfgcat-agregar-extras');
    await campo(page, 'extras', 14, 'Nombre').fill('AVENA');
    await campo(page, 'extras', 14, 'Precio').fill('4500');
    await guardar(page, 'extras');
    await expect(page.locator('.toast').last()).toContainText('repetido');
    expect(escrituras(reg)).toEqual([]);
    await campo(page, 'extras', 14, 'Nombre').fill('Brownie');
    await guardar(page, 'extras');
    await expect(page.locator('#cfgcat-hoy-extras')).toContainText('15 activos de 15');
    expect(escrituras(reg)[0].cuerpo.valor[14]).toEqual({ nombre: 'Brownie', precio: 4500, activo: true });
    expect(await page.evaluate(() => PRODUCTOS_EXTRA.map(p => p.n))).toContain('Brownie');
  });

  test('buscar en comidas rápidas filtra por nombre, código o categoría y no pierde lo editado', async ({ page }) => {
    await abrirAdmin(page);
    await page.fill('#cfgcat-buscar-rapidas', 'arepa');
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(11);
    await page.fill('#cfgcat-buscar-rapidas', 'SZ0');
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(5);
    await page.fill('#cfgcat-buscar-rapidas', 'bebidas');
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(6);
    await campo(page, 'rapidas', 43, 'Precio').fill('4500');                                    // BEB01 (índice 43), editado dentro del filtro
    await page.fill('#cfgcat-buscar-rapidas', 'zzzz');
    await expect(page.locator('#cfgcat-cuerpo-rapidas')).toContainText('Nada coincide');
    await page.fill('#cfgcat-buscar-rapidas', '');
    await expect(page.locator('#cfgcat-cuerpo-rapidas tr')).toHaveCount(49);
    await expect(campo(page, 'rapidas', 43, 'Precio')).toHaveValue('4.500');
    await expect(page.locator('#cfgcat-contador-rapidas')).toHaveText('1 cambio sin guardar');
  });

  test('un nombre con tildes, paréntesis y números se guarda tal cual', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Nombre').fill('Menú del día (1,5 L) — ñ');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    expect(escrituras(reg)[0].cuerpo.valor[0].nombre).toBe('Menú del día (1,5 L) — ñ');
    await turno(page, 'almuerzo');
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'completo').texto).toBe('Menú del día (1,5 L) — ñ (con sopa) · $14.000');
  });

  test('el nombre se guarda sin espacios sobrantes ni dobles', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Nombre').fill('   Almuerzo    Casero  ');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    expect(escrituras(reg)[0].cuerpo.valor[0].nombre).toBe('Almuerzo Casero');
  });

  test('si el administrador no ha cambiado nada, «Guardar» ni siquiera pregunta', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await page.evaluate(() => { cfgCatBorrador('almuerzos'); return cfgCatGuardar('almuerzos'); });
    await expect(page.locator('.toast').last()).toContainText('no hay nada que guardar');
    expect(await page.locator('#modal-sistema').isVisible()).toBe(false);
    expect(escrituras(reg)).toEqual([]);
  });

  test('doble clic: una sola fila', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    await page.evaluate(() => { cfgCatGuardar('almuerzos'); cfgCatGuardar('almuerzos'); });
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
  });

  test('un segundo «Guardar» mientras el primero todavía se está guardando no abre otra confirmación ni escribe otra vez', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    await page.evaluate(async () => {
      const primero = cfgCatGuardar('almuerzos');
      await new Promise(r => setTimeout(r, 400));                                          // ya hizo la revisión y mostró la confirmación
      document.querySelector('#sis-opciones button[data-eleccion="si"]').click();            // la persona confirma…
      await new Promise(r => setTimeout(r, 0));                                            // …y el guardado queda en marcha
      const segundo = cfgCatGuardar('almuerzos');                                          // …y vuelve a pulsar «Guardar cambios»
      await Promise.all([primero, segundo]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg).length).toBe(1);
  });

  test('mientras se escribe un cambio, si llega otro de afuera la tabla no se vuelve a dibujar (no se pierde el cursor)', async ({ page }) => {
    await abrirAdmin(page);
    const precio = campo(page, 'almuerzos', 0, 'Precio');
    await precio.fill('15000');
    await precio.focus();
    await page.evaluate(() => {                                                              // otro administrador guardó el mismo catálogo mientras tanto
      const nuevo = CATALOGO_ALMUERZOS_BASE.map(a => ({ ...a, precio: a.codigo === 'seco' ? 13000 : a.precio }));
      ST.configuracion = (ST.configuracion || []).concat([{ id: 999, clave: 'catalogo_almuerzos', valor: nuevo, vigente_desde: new Date().toISOString(), creado_por: 'otro' }]);
      renderAll();
    });
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por otro');          // lo de arriba sí se actualiza
    expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))).toBe('Precio');   // y el cursor sigue en el campo
    await expect(precio).toHaveValue('15.000');
  });
});

// ── 4. Lo que no se puede guardar ────────────────────────────────────────────────
test.describe('valores inválidos', () => {
  const CASOS = [
    ['almuerzos', 0, 'Precio', '50', 'entre 100 y 500000'],
    ['almuerzos', 0, 'Precio', '500001', 'entre 100 y 500000'],
    ['almuerzos', 0, 'Precio', '', 'Falta el precio'],
    ['almuerzos', 0, 'Nombre', '', 'Falta el nombre'],
    ['almuerzos', 0, 'Nombre', '<b>Almuerzo</b>', 'no pueden llevar los caracteres'],
    ['almuerzos', 0, 'Nombre', 'Almuerzo "grande"', 'no pueden llevar los caracteres'],
    ['almuerzos', 0, 'Nombre', "Almuerzo d'oro", 'no pueden llevar los caracteres'],
    ['almuerzos', 0, 'Nombre', 'Arroz & frijol', 'no pueden llevar los caracteres'],
    ['almuerzos', 0, 'Nombre', 'Almuerzo \\ casa', 'no pueden llevar los caracteres'],
    ['rapidas', 0, 'Categor', '', 'Falta la categoría'],
    ['rapidas', 0, 'Categor', 'PERROS <3', 'no pueden llevar los caracteres'],
    ['rapidas', 0, 'Categor', 'C'.repeat(31), 'entre 1 y 30 caracteres'],
    ['extras', 0, 'Nombre', 'N'.repeat(61), 'entre 1 y 60 caracteres'],
  ];
  for (const [k, i, que, texto, mensaje] of CASOS) {
    test(`${k}: ${que} = «${texto.length > 14 ? texto.slice(0, 14) + '…' : texto}» se rechaza antes de mandar nada`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await page.evaluate(() => { window.__noAceptarAvisos = true; });
      const el = campo(page, k, i, que);
      await el.evaluate((e, t) => { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, texto);
      if (que === 'Precio' && texto === '') await expect(el).toHaveValue('');
      await page.evaluate(x => cfgCatGuardar(x), k);                                           // sin pasar por el botón
      await expect(page.locator('.toast').last()).toContainText(mensaje);
      await page.waitForTimeout(80);
      expect(await page.locator('#modal-sistema').isVisible()).toBe(false);                    // ni siquiera pregunta
      expect(escrituras(reg)).toEqual([]);
    });
  }

  test('no se puede dejar sin almuerzos activos ni sin comidas rápidas activas', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await page.evaluate(() => { cfgCatBorrador('almuerzos').forEach(f => { f.activo = false; }); cfgCatBorrador('rapidas').forEach(f => { f.activo = !CAT_ESPECIALES.includes(f.categoria) ? false : true; }); });
    await page.evaluate(() => cfgCatGuardar('almuerzos'));
    await expect(page.locator('.toast').last()).toContainText('al menos un tipo de almuerzo activo');
    await page.evaluate(() => cfgCatGuardar('rapidas'));
    await expect(page.locator('.toast').last()).toContainText('al menos una comida rápida activa');
    expect(escrituras(reg)).toEqual([]);
  });

  test('si el servidor lo rechaza igual (otra versión del sistema, otro equipo), avisa con su mensaje y no cambia nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.cfgValidar = () => null; });                            // se salta la revisión de la pantalla
    const el = campo(page, 'almuerzos', 0, 'Precio');
    await el.evaluate(e => { e.value = '50'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await guardar(page, 'almuerzos');
    await expect(page.locator('.toast').last()).toContainText('El precio de "Almuerzo Completo" debe ser un número entero entre 100 y 500000.');
    expect(escrituras(reg)).toEqual([]);
    expect(await page.evaluate(() => PRECIOS.completo)).toBe(14000);
    expect(await page.evaluate(() => ST.configuracion.length)).toBe(2);
    await expect(page.locator('#cfgcat-contador-almuerzos')).toHaveText('1 cambio sin guardar');   // lo escrito sigue ahí para corregirlo
  });

  test('el servidor no deja borrar un producto que ya existía: se retira, no se borra', async ({ page }) => {
    const rapidas = [...BASE.rapidas, { codigo: 'X001', nombre: 'Flan de la casa', precio: 6000, categoria: 'POSTRES', activo: true }];
    await abrirAdmin(page, { datos: datosCon([fila(1, CLAVE.rapidas, rapidas)]) });
    const r = await page.evaluate(async b => {
      try { await sbInsert('configuracion', { clave: 'catalogo_rapidas', valor: b }); return 'se guardó'; } catch (e) { return String(e.message || e); }
    }, BASE.rapidas);                                                                           // trae los 49 de El Lobo pero le falta X001
    expect(r).toContain('No se pueden borrar productos (X001)');
  });

  test('el servidor tampoco deja quitar uno de los 49 de El Lobo, ni cambiar un código, ni repetirlo', async ({ page }) => {
    await abrirAdmin(page);
    const probar = valor => page.evaluate(async v => {
      try { await sbInsert('configuracion', { clave: 'catalogo_rapidas', valor: v }); return 'se guardó'; } catch (e) { return String(e.message || e); }
    }, valor);
    expect(await probar(BASE.rapidas.slice(1))).toContain('no puede quitar productos de El Lobo');
    expect(await probar([...BASE.rapidas, { ...BASE.rapidas[0] }])).toContain('está repetido');
    expect(await probar([...BASE.rapidas, { codigo: 'x1', nombre: 'Malo', precio: 1000, categoria: 'OTRA', activo: true }])).toContain('no sirve');
    expect(await probar([...BASE.rapidas, { codigo: 'X001', nombre: 'Malo', precio: 1000, categoria: 'otra', activo: true }])).toContain('en MAYÚSCULAS');
    expect(await probar([...BASE.rapidas, { codigo: 'X001', nombre: 'Malo', precio: 1000.5, categoria: 'OTRA', activo: true }])).toContain('número entero');
    expect(await probar([...BASE.rapidas, { codigo: 'X001', nombre: 'Malo', precio: 1000, categoria: 'OTRA', activo: 'si' }])).toContain('activo o retirado');
    expect(await probar([...BASE.rapidas, { codigo: 'X001', nombre: 'Malo', precio: 1000, categoria: 'OTRA', activo: true, extra: 1 }])).toContain('campos que no corresponden');
    expect(await probar('no es lista')).toContain('debe ser una lista');
  });

  test('los almuerzos siempre son exactamente los 8 tipos: ni uno más ni uno menos ni un código nuevo', async ({ page }) => {
    await abrirAdmin(page);
    const probar = valor => page.evaluate(async v => {
      try { await sbInsert('configuracion', { clave: 'catalogo_almuerzos', valor: v }); return 'se guardó'; } catch (e) { return String(e.message || e); }
    }, valor);
    expect(await probar(BASE.almuerzos.slice(1))).toContain('trae 7 productos');
    expect(await probar([...BASE.almuerzos, { codigo: 'nuevo', nombre: 'Otro', precio: 5000, activo: true }])).toContain('trae 9 productos');
    expect(await probar(BASE.almuerzos.map((a, i) => (i === 0 ? { ...a, codigo: 'nuevo' } : a)))).toContain('no es un tipo de almuerzo de El Lobo');
  });

  test('si otro administrador cambió el mismo catálogo mientras tanto, no se pisa su cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    // «otro equipo» guarda un cambio en el mismo catálogo
    reg.datos.configuracion.push(fila(99, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'seco', { precio: 12500 }), '2026-10-20T13:00:00-05:00', 'otro'));
    await guardar(page, 'almuerzos');
    await expect(page.locator('.toast').last()).toContainText('Alguien más acaba de cambiar este catálogo');
    expect(escrituras(reg)).toEqual([]);                                                       // no mandó nada
    await expect(campo(page, 'almuerzos', 1, 'Precio')).toHaveValue('12.500');                 // la pantalla ya muestra lo de la otra persona
    await expect(campo(page, 'almuerzos', 0, 'Precio')).toHaveValue('14.000');                 // y lo escrito se descartó (hay que repetirlo sobre lo nuevo)
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por otro');
  });

  test('un cambio en OTRO catálogo no estorba el guardado de este', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    reg.datos.configuracion.push(fila(99, CLAVE.extras, cambiarExtra(BASE.extras, 'Avena', { precio: 4500 }), '2026-10-20T13:00:00-05:00', 'otro'));
    await guardar(page, 'almuerzos');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
  });
});

// ── 5. Quién puede ──────────────────────────────────────────────────────────────
test.describe('permisos', () => {
  test('con caja la pestaña no aparece y guardar no escribe nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    await expect(page.locator('#tab-nav-config')).toBeHidden();
    await page.evaluate(() => { cfgCatBorrador('almuerzos')[0].precio = 15000; return cfgCatGuardar('almuerzos'); });
    await expect(page.locator('.toast').last()).toContainText('Solo el administrador');
    expect(escrituras(reg)).toEqual([]);
    expect(await page.evaluate(() => PRECIOS.completo)).toBe(14000);
  });

  test('la caja sí ve los precios nuevos que guardó el administrador (los lee igual que todos)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja', datos: datosCon([fila(1, CLAVE.almuerzos, cambiar(BASE.almuerzos, 'completo', { precio: 15000 }))]) });
    await turno(page, 'almuerzo');
    expect((await opcionesDe(page, 'ing-pedido')).find(o => o.valor === 'completo').monto).toBe('15000');
    expect(reg.errores).toEqual([]);
  });

  test('lo guardado se ve al abrir de nuevo el sistema (otro equipo, otra sesión)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await campo(page, 'almuerzos', 0, 'Precio').fill('15000');
    await guardar(page, 'almuerzos');
    await expect(page.locator('#cfgcat-hoy-almuerzos')).toContainText('por dueno1');
    const nuevo = await page.context().newPage();
    await abrirSistema(nuevo, { usuario: 'caja', datos: reg.datos });
    expect(await nuevo.evaluate(() => PRECIOS.completo)).toBe(15000);
  });
});

// ── 6. Tres reglas, un solo veredicto ────────────────────────────────────────────
// Los mismos casos que prueba Postgres de verdad (tests/python/test_configuracion_etapa_2.py): la revisión de la pantalla
// (cfgValidar) y el servidor falso de las pruebas deben dar el MISMO veredicto y el MISMO mensaje que la base.
const CASOS = require('./fixtures/casos-catalogo.json').casos;
function armar(caso) {
  if ('valor' in caso) return caso.valor;
  const v = copia(BASE[{ catalogo_almuerzos: 'almuerzos', catalogo_rapidas: 'rapidas', catalogo_extras: 'extras' }[caso.clave]]);
  for (const [i, cambios] of Object.entries(caso.mod || {})) Object.assign(v[+i], cambios);
  for (const [i, campos] of Object.entries(caso.sin || {})) for (const c of campos) delete v[+i][c];
  for (const i of [...(caso.quitar || [])].sort((a, b) => b - a)) v.splice(i, 1);
  v.push(...copia(caso.agregar || []));
  for (let i = 0; i < (caso.relleno || 0); i++) {
    v.push(caso.clave === 'catalogo_extras' ? { nombre: `Relleno ${i + 1}`, precio: 1000, activo: true }
      : { codigo: 'Z' + String(i + 1).padStart(3, '0'), nombre: `Relleno ${i + 1}`, precio: 1000, categoria: 'RELLENO', activo: true });
  }
  return v;
}

test.describe('la pantalla, el servidor falso y la base dicen lo mismo', () => {
  test.describe.configure({ mode: 'serial' });
  let page, reg;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    aceptarAvisos(page);
    reg = await abrirSistema(page, { usuario: 'admin' });
  });
  test.afterAll(async () => { await page.close(); });

  for (const caso of CASOS) {
    test(caso.id, async () => {
      const valor = armar(caso);
      const r = await page.evaluate(async ([clave, v]) => {
        const pantalla = cfgValidar(clave, v);
        let servidor = null;
        try { await sbInsert('configuracion', { clave, valor: v }); } catch (e) { servidor = String(e.message || e); try { servidor = JSON.parse(servidor).message || servidor; } catch (_) { /* ya era texto */ } }
        return { pantalla, servidor };
      }, [caso.clave, valor]);
      reg.datos.configuracion.length = 0;                                                 // cada caso parte sin historial (la regla de «no borrar» tiene sus propias pruebas)
      if (caso.mensaje === null) {
        expect(r.pantalla, 'pantalla').toBeNull();
        expect(r.servidor, 'servidor falso').toBeNull();
      } else {
        expect(r.pantalla, 'pantalla').toBe(caso.mensaje);
        expect(r.servidor, 'servidor falso').toBe(caso.mensaje);
      }
    });
  }

  test('la regla «los productos se retiran, no se borran» da el mismo mensaje que la base', async () => {
    const rapidas = [...BASE.rapidas, { codigo: 'X001', nombre: 'Flan', precio: 6000, categoria: 'POSTRES', activo: true }, { codigo: 'X002', nombre: 'Otro', precio: 6000, categoria: 'POSTRES', activo: true }];
    reg.datos.configuracion.length = 0;
    reg.datos.configuracion.push(fila(1, 'catalogo_rapidas', rapidas));
    const r = await page.evaluate(async v => { try { await sbInsert('configuracion', { clave: 'catalogo_rapidas', valor: v }); return null; } catch (e) { const t = String(e.message || e); try { return JSON.parse(t).message || t; } catch (_) { return t; } } }, BASE.rapidas);
    expect(r).toContain('No se pueden borrar productos (X001, X002): se retiran, para que los pedidos viejos se sigan mostrando.');
    reg.datos.configuracion.length = 0;
  });
});

test.describe('el código interno no se muestra en Configuración', () => {
  test('ninguna tabla de productos, egresos o platos enseña la columna Código, pero cada fila sigue teniéndolo', async ({ page }) => {
    aceptarAvisos(page);
    await abrirSistema(page, { usuario: 'admin' });
    await page.evaluate(() => showTab('config', document.querySelector(`.tab[onclick*="showTab('config'"]`)));
    const r = await page.evaluate(() => {
      const visibles = [...document.querySelectorAll('.cfgcat-sin-cod .cfgcat-cod, .cfgcat-sin-cod .cfgcat-cod-th')].filter(e => e.offsetParent !== null).length;
      const total = document.querySelectorAll('.cfgcat-sin-cod .cfgcat-cod').length;
      return { visibles, total };
    });
    expect(r.total).toBeGreaterThan(0);
    expect(r.visibles).toBe(0);
  });
});
