// ⚙️ CONFIGURACIÓN → «Categorías de egresos» y «Nombres de las cuentas» (etapa 4).
// Todo contra el backend falso (que imita sql/configuracion_etapa_4.sql: valida las listas, no deja borrar categorías ni cambiarles
// el grupo): nada toca tu Supabase real. Se comprueba, desde la pantalla, que:
//   · SIN nada guardado el sistema se ve y suma EXACTAMENTE como antes (foto de referencia en fixtures/egresos-anterior.json);
//   · con categorías guardadas, las listas de los formularios, las etiquetas, los colores y las sumas por casilla las usan;
//   · una categoría nueva se suma en la casilla de su GRUPO; «no cuenta como egreso» nunca entra a los egresos;
//   · lo retirado deja de ofrecerse pero los gastos viejos lo siguen mostrando (y se puede conservar al editarlos);
//   · el nombre y el símbolo de las 3 cuentas se ven en todas partes; las cuentas y sus saldos no cambian;
//   · solo el administrador ve y guarda; cada guardado pide confirmación, se valida antes de enviar y manda UNA fila nueva;
//   · si otro administrador cambió lo mismo mientras tanto, no se pisa su cambio;
//   · lo que el servidor rechaza se avisa con su mensaje; nada queda a medias; lo escrito nunca se interpreta como código;
//   · las reglas de la pantalla, del servidor falso y de la base real dan el mismo veredicto y el mismo mensaje (casos compartidos).
const fs = require('fs');
const { fileURLToPath } = require('url');
const { test, expect } = require('@playwright/test');
const { abrirSistema, CATEGORIAS_BASE, URL_HTML } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const { foto, datosParaFoto } = require('./helpers/foto-egresos');
const ANTERIOR = require('./fixtures/egresos-anterior.json');
const CASOS = require('./fixtures/casos-egresos.json').casos;

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const fila = (id, clave, valor, desde = '2026-10-01T10:00:00-05:00', por = 'luis') => ({ id, clave, valor, vigente_desde: desde, creado_por: por, creado_en: desde });
const datosCon = (filas, base = DATOS_BASE) => { const d = copia(base); d.configuracion = filas; return d; };
const escrituras = (reg, tabla = 'configuracion') => reg.escrituras.filter(e => e.tabla === tabla);

// Las listas base viven en la página como JSON: se leen de ahí (así las pruebas usan las mismas que el sistema).
const TEXTO_HTML = fs.readFileSync(fileURLToPath(URL_HTML), 'utf8');
const leerBase = n => JSON.parse(TEXTO_HTML.match(new RegExp(`const ${n}_BASE = Object\\.freeze\\((\\[[\\s\\S]*?\\n\\])\\.map\\(Object\\.freeze\\)\\)`))[1]);
const BASE = { categorias: leerBase('CATEGORIAS_EGRESOS'), cuentas: leerBase('NOMBRES_CUENTAS') };
const CLAVE = { categorias: 'categorias_egresos', cuentas: 'nombres_cuentas' };
const cambiarCat = (lista, codigo, cambios) => lista.map(x => (x.codigo === codigo ? { ...x, ...cambios } : x));
const nueva = (codigo, nombre, grupo = 'otro', donde = 'ambos', activo = true) => ({ codigo, nombre, grupo, donde, activo });

async function abrirAdmin(page, opciones = {}) {
  const nativos = aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  await irA(page, 'config');
  await expect(page.locator('#config-contenido')).toBeVisible();
  return { reg, nativos };
}
const textoLista = (page, id) => page.evaluate(i => [...document.getElementById(i).querySelectorAll('option')].map(o => `${o.value}|${o.textContent.trim()}`), id);

// ── 1. Sin nada guardado: todo como antes ─────────────────────────────────────────
test.describe('sin categorías ni nombres guardados: valores de siempre', () => {
  test('listas, etiquetas, tablas y sumas idénticas a la versión anterior (foto de referencia)', async ({ page }) => {
    aceptarAvisos(page);
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosParaFoto() });
    const ahora = await foto(page, irA);
    expect(Object.keys(ahora)).toEqual(Object.keys(ANTERIOR));
    for (const k of Object.keys(ANTERIOR)) expect(ahora[k], k).toEqual(ANTERIOR[k]);
    expect(reg.errores).toEqual([]);
  });

  test('las listas base del sistema son las 7 categorías y las 3 cuentas de siempre', async () => {
    expect(BASE.categorias.map(c => [c.codigo, c.nombre, c.grupo, c.donde, c.activo])).toEqual([
      ['nomina', 'Nómina', 'nomina', 'ambos', true], ['proveedor', 'Proveedores', 'proveedor', 'ambos', true],
      ['arriendo', 'Arriendo', 'operativo', 'egresos', true], ['servicios', 'Servicios', 'operativo', 'egresos', true],
      ['desechables', 'Desechables', 'desechable', 'ambos', true], ['otro', 'Otro', 'otro', 'ambos', true],
      ['prestamo', 'Préstamo', 'excluido', 'cierre', true]]);
    expect(BASE.cuentas.map(c => [c.codigo, c.emoji, c.nombre])).toEqual([
      ['efectivo', '💵', 'Efectivo'], ['transf_almuerzos', '☀️', 'Transf. Almuerzos'], ['transf_rapidas', '🌙', 'Transf. Comidas rápidas']]);
  });

  test('los códigos y grupos que exige el servidor falso son los mismos de la página', async () => {
    expect(CATEGORIAS_BASE).toEqual(BASE.categorias.map(c => [c.codigo, c.grupo]));
  });

  test('las listas base las acepta el servidor y la revisión de la pantalla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const r = await page.evaluate(async b => {
      const veredictos = [cfgValidar('categorias_egresos', b.categorias), cfgValidar('nombres_cuentas', b.cuentas)];
      const guardadas = [(await sbInsert('configuracion', { clave: 'categorias_egresos', valor: b.categorias })).length, (await sbInsert('configuracion', { clave: 'nombres_cuentas', valor: b.cuentas })).length];
      return { veredictos, guardadas };
    }, BASE);
    expect(r).toEqual({ veredictos: [null, null], guardadas: [1, 1] });
    expect(reg.denegadas).toEqual([]);
  });

  test('si la tabla todavía no existe en Supabase: valores de siempre, sin errores, y los botones quedan apagados', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { tablasFaltantes: ['configuracion'] });
    expect(await textoLista(page, 'egr-cat')).toEqual(ANTERIOR.egresos.listas['tab-egresos#egr-cat'].map(t => t.split('|').slice(0, 2).join('|')));
    await expect(page.locator('#cfgegr-agregar')).toBeDisabled();
    await expect(page.locator('#cfgegr-guardar')).toBeDisabled();
    await expect(page.locator('#cfgcta-guardar')).toBeDisabled();
    await expect(page.locator('#cfgegr-cuerpo input').first()).toBeDisabled();
    expect(await page.evaluate(async () => [await cfgEgrGuardar(), await cfgCtaGuardar()])).toEqual([undefined, undefined]);
    expect(escrituras(reg)).toEqual([]);
  });
});

// ── 2. Con categorías guardadas: todo lo que estaba fijo las usa ──────────────────
const opciones = (page, id) => page.evaluate(i => [...document.getElementById(i).querySelectorAll('option')].map(o => `${o.value}|${o.textContent.trim()}`), id);
const opcionesFiltro = (page, selector) => page.evaluate(s => [...document.querySelector(s).querySelectorAll('option')].map(o => `${o.value}|${o.textContent.trim()}`), selector);
const texto = (page, id) => page.locator(`#${id}`).innerText();
const verTodo = async page => { await irA(page, 'egresos'); await page.locator('#tab-egresos .filter-btn[data-periodo="todo"]').first().click(); };

// Una configuración de ejemplo: nómina renombrada, una categoría nueva de cada tipo y sus gastos.
const CAT_A = [
  ...cambiarCat(BASE.categorias, 'nomina', { nombre: 'Sueldos' }),
  nueva('cat1', 'Mantenimiento', 'otro', 'ambos'),
  nueva('cat2', 'Retiro del dueño', 'excluido', 'cierre'),
  nueva('cat3', 'Internet', 'operativo', 'egresos'),
  nueva('cat4', 'Compras del día', 'proveedor', 'cierre'),
];
function datosA(extra = {}) {
  const d = datosParaFoto();
  d.configuracion = [fila(1, CLAVE.categorias, CAT_A)];
  d.egresos.push({ id: 7, fecha: '2026-10-19', cat: 'cat1', cuenta: 'efectivo', monto: 40000, description: 'Arreglo del fogón', turno: null, created_at: '2026-10-19T09:00:00-05:00' },
                 { id: 8, fecha: '2026-10-19', cat: 'cat3', cuenta: 'efectivo', monto: 25000, description: 'Plan de internet', turno: null, created_at: '2026-10-19T09:00:00-05:00' });
  d.gastos_dia.push({ id: 6, fecha: '2026-10-19', turno: 'almuerzo', nombre: 'Gasto cat1', monto: 10000, categoria: 'cat1' },
                    { id: 7, fecha: '2026-10-19', turno: 'almuerzo', nombre: 'Gasto cat2', monto: 77000, categoria: 'cat2' },
                    { id: 8, fecha: '2026-10-19', turno: 'almuerzo', nombre: 'Gasto cat4', monto: 5000, categoria: 'cat4' });
  return Object.assign(d, extra);
}

test.describe('con categorías guardadas', () => {
  test('cada lista ofrece solo lo que corresponde: activas, en su lugar de uso, con el nombre de hoy', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosA() });
    // Egresos (arriendo, servicios… y las que se usan «en Egresos»): sin las de «solo cierre» ni las que no cuentan como egreso
    expect(await opciones(page, 'egr-cat')).toEqual([
      'nomina|Sueldos', 'proveedor|Proveedores', 'arriendo|Arriendo', 'servicios|Servicios públicos', 'desechables|Desechables', 'otro|Otro', 'cat1|Mantenimiento', 'cat3|Internet']);
    // Cierre del día: las de «cierre» y «ambos», incluida la que no cuenta como egreso (con su aviso)
    const cierre = ['nomina|Sueldos', 'proveedor|Proveedores', 'desechables|Desechables', 'otro|Otro', 'prestamo|Préstamos (no cuenta como egreso)', 'cat1|Mantenimiento', 'cat2|Retiro del dueño (no cuenta como egreso)', 'cat4|Compras del día'];
    expect(await opciones(page, 'dd-gasto-cat')).toEqual(cierre);
    expect(await opciones(page, 'cm-gasto-cat')).toEqual(cierre);
    // Filtro del historial de Egresos: todas las que cuentan como egreso
    expect(await opcionesFiltro(page, '#tab-egresos select[data-categorias^="filtro"]')).toEqual([
      'todas|Todas', 'nomina|Sueldos', 'proveedor|Proveedores', 'arriendo|Arriendo', 'servicios|Servicios', 'desechables|Desechables', 'otro|Otro', 'cat1|Mantenimiento', 'cat3|Internet', 'cat4|Compras del día']);
  });

  test('las sumas por casilla usan el GRUPO: una categoría nueva se suma donde le toca y «no cuenta como egreso» no entra', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosA() });
    await verTodo(page);
    // nómina 300.000+70.000 · proveedores 120.000+33.000+5.000(cat4) · arriendo+servicios 900.000+80.000+25.000(cat3) · desechables 45.000+12.000 · otros 15.000+6.000+40.000(cat1)+10.000(cat1)
    expect(await Promise.all(['egr-nom', 'egr-prov', 'egr-arr', 'egr-desech', 'egr-otros', 'egr-total-periodo'].map(i => texto(page, i))))
      .toEqual(['$370.000', '$158.000', '$1.005.000', '$57.000', '$71.000', '$1.661.000']);     // los $77.000 de «Retiro del dueño» y los $50.000 del préstamo no están
    await irA(page, 'ingfin');
    await page.locator('#tab-ingfin .filter-btn[data-periodo="todo"]').first().click();
    expect(await Promise.all(['ingfin-nomina', 'ingfin-proveedores', 'ingfin-operativos', 'ingfin-desechables', 'ingfin-otros'].map(i => texto(page, i))))
      .toEqual(['$370.000', '$158.000', '$1.005.000', '$57.000', '$71.000']);
    await irA(page, 'dashboard');
    await page.locator('#tab-dashboard .filter-btn', { hasText: 'Todo el historial' }).click();
    expect(await Promise.all(['rp-nom', 'rp-prov', 'rp-arr', 'rp-desech', 'rp-otros', 'rp-tegr'].map(i => texto(page, i))))
      .toEqual(['$370.000', '$158.000', '$1.005.000', '$57.000', '$71.000', '$1.661.000']);
  });

  test('la tabla de egresos muestra el nombre de hoy y el color del grupo, también en los gastos del cierre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosA() });
    await verTodo(page);
    const insignia = async nombre => page.evaluate(n => { const b = [...document.querySelectorAll('#egresos-body .badge')].find(x => x.textContent.trim() === n); return b ? b.className.replace('badge', '').trim() : null; }, nombre);
    expect(await insignia('Sueldos')).toBe('badge-blue');            // nómina
    expect(await insignia('Mantenimiento')).toBe('badge-accent');    // otros
    expect(await insignia('Internet')).toBe('badge-gray');           // arriendo y servicios
    expect(await insignia('Compras del día')).toBe('badge-red');     // proveedores
    expect(await insignia('Desechables')).toBe('badge-green');
    expect(await insignia('Retiro del dueño')).toBeNull();           // no cuenta como egreso: no está en la tabla
    expect(await insignia('Nómina')).toBeNull();                     // el nombre viejo ya no aparece
    // el cierre del día 19 lista todos sus gastos, también el que no cuenta como egreso
    await page.evaluate(() => irADiaADia('2026-10-19', 'almuerzo'));
    const filas = (await page.locator('#dd-gastos-body').textContent());
    expect(filas).toContain('Retiro del dueño');
    expect(filas).toContain('Sueldos');
    expect(filas).not.toContain('Nómina');
  });

  test('«Retiro del dueño» (no cuenta como egreso) resta de la caja del día igual que los préstamos', async ({ page }) => {
    const sin = datosParaFoto(); sin.gastos_dia = sin.gastos_dia.filter(g => g.categoria !== 'prestamo');
    const con = datosParaFoto(); con.configuracion = [fila(1, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Retiro del dueño', 'excluido', 'cierre')])];
    con.gastos_dia = con.gastos_dia.map(g => (g.categoria === 'prestamo' ? { ...g, categoria: 'cat1' } : g));
    const leer = async d => {
      await abrirSistema(page, { usuario: 'admin', datos: d });
      await page.evaluate(() => irADiaADia('2026-10-19', 'almuerzo'));
      return { egresos: await page.evaluate(() => egresosCombinados().reduce((a, e) => a + e.monto, 0)), gastosDelTurno: await page.evaluate(() => calcularGastosTurno('2026-10-19', 'almuerzo')), cajaEsperada: await texto(page, 'dd-caja-esperada'), utilidad: await texto(page, 'dd-resultado') };
    };
    const base = await leer(datosParaFoto());
    const nuevo = await leer(con);
    expect(nuevo).toEqual(base);                                   // renombrar el préstamo / usar otra categoría «excluida» da lo mismo
    expect((await leer(sin)).egresos).toBe(base.egresos);          // y no cuenta como egreso
  });

  test('una categoría retirada deja de ofrecerse pero los gastos viejos la siguen mostrando (y se puede conservar al editarlos)', async ({ page }) => {
    const d = datosParaFoto();
    d.configuracion = [fila(1, CLAVE.categorias, cambiarCat(BASE.categorias, 'servicios', { activo: false }))];
    await abrirSistema(page, { usuario: 'admin', datos: d });
    expect((await opciones(page, 'egr-cat')).map(o => o.split('|')[0])).toEqual(['nomina', 'proveedor', 'arriendo', 'desechables', 'otro']);
    expect(await opcionesFiltro(page, '#tab-egresos select[data-categorias^="filtro"]')).toContain('servicios|Servicios (retirada)');   // el filtro sí: hay gastos viejos
    await verTodo(page);
    await expect(page.locator('#egresos-body tr', { hasText: 'Egreso servicios' })).toContainText('Servicios');
    await expect(page.locator('#egr-arr')).toHaveText('$980.000');                                          // y siguen sumando donde siempre
    await page.evaluate(() => editarEgreso(4));                                                                 // el egreso de servicios
    expect(await opciones(page, 'egr-edit-cat-4')).toContain('servicios|Servicios (retirada)');
    expect(await page.locator('#egr-edit-cat-4').inputValue()).toBe('servicios');
  });

  test('una categoría que ya no está en la lista (no debería pasar) se muestra con su código, en rojo y sin sumarse a ninguna casilla', async ({ page }) => {
    const d = datosParaFoto();
    d.egresos.push({ id: 9, fecha: '2026-10-19', cat: 'zzz', cuenta: 'efectivo', monto: 1000, description: 'Rara', turno: null, created_at: '2026-10-19T09:00:00-05:00' });
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await verTodo(page);
    const fila = page.locator('#egresos-body tr', { hasText: 'Rara' });
    await expect(fila.locator('.badge').first()).toHaveText('zzz');
    await expect(fila.locator('.badge').first()).toHaveClass(/badge-red/);
    expect(await Promise.all(['egr-nom', 'egr-prov', 'egr-arr', 'egr-desech', 'egr-otros'].map(i => texto(page, i)))).toEqual(['$370.000', '$153.000', '$980.000', '$57.000', '$21.000']);
  });

  test('una versión guardada que no cumple las reglas (escrita por fuera de la pantalla) se ignora: rigen las categorías de siempre', async ({ page }) => {
    const d = datosParaFoto();
    d.configuracion = [fila(1, CLAVE.categorias, cambiarCat(BASE.categorias, 'otro', { nombre: '<img src=x onerror=window.__y=1>' }))];
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await verTodo(page);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ y: window.__y || 0, img: document.querySelectorAll('img[src="x"]').length }))).toEqual({ y: 0, img: 0 });
    expect(await opciones(page, 'egr-cat')).toContain('otro|Otro');
  });

  test('el nombre de una categoría nunca se interpreta como código (aunque se colara uno)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosParaFoto() });
    await page.evaluate(() => {
      CAT_MAPA.set('otro', { ...CAT_MAPA.get('otro'), nombre: '<img src=x onerror=window.__y=1>' });
      CTA_MAPA.set('efectivo', { codigo: 'efectivo', emoji: '<b>', nombre: '<img src=x onerror=window.__y=1>' });
      poblarCategoriasEnDOM(); aplicarCuentasEnDOM(); renderEgresos();
    });
    await verTodo(page);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ y: window.__y || 0, img: document.querySelectorAll('img[src="x"]').length, b: document.querySelectorAll('#egresos-body b').length }))).toEqual({ y: 0, img: 0, b: 0 });
    expect(await opciones(page, 'egr-cat')).toContain('otro|<img src=x onerror=window.__y=1>');
  });
});

// ── 3. Con nombres de cuentas guardados ─────────────────────────────────────────
const CTA_A = [{ codigo: 'efectivo', emoji: '💰', nombre: 'Caja menor' }, { codigo: 'transf_almuerzos', emoji: '🏦', nombre: 'Banco' }, { codigo: 'transf_rapidas', emoji: '📱', nombre: 'Nequi' }];
const datosCuentas = (cuentas = CTA_A) => { const d = datosParaFoto(); d.configuracion = [fila(1, CLAVE.cuentas, cuentas)]; return d; };

test.describe('con nombres de cuentas guardados', () => {
  test('todos los selectores, botones, tarjetas y encabezados usan el nombre y el símbolo de hoy', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCuentas() });
    const cuentas = ['efectivo|💰 Caja menor', 'transf_almuerzos|🏦 Banco', 'transf_rapidas|📱 Nequi'];
    for (const id of ['egr-cuenta', 'ingext-cuenta', 'caja-mov-cuenta']) expect(await opciones(page, id), id).toEqual(cuentas);
    expect(await opciones(page, 'caja-mov-cuenta-destino')).toEqual(cuentas);
    expect(await opcionesFiltro(page, '#tab-egresos select[data-cuentas="todas"]')).toEqual(['todas|Todas', ...cuentas]);
    await irA(page, 'caja');
    await expect(page.locator('[data-cta="efectivo"][data-cta-f="kpi"]')).toHaveText('💰 Caja menor');
    await expect(page.locator('[data-cta="transf_almuerzos"][data-cta-f="kpi"]')).toHaveText('🏦 Banco');
    await expect(page.locator('[data-cta="transf_rapidas"][data-cta-f="kpi"]')).toHaveText('📱 Nequi');
    expect(await page.locator('#caja-historial-body').locator('xpath=ancestor::table/thead/tr/th').allTextContents()).toEqual(['Fecha', 'Caja menor', 'Banco', 'Nequi', 'Total']);
    const fila = page.locator('#caja-movimientos-body tr', { hasText: 'Retiro' });
    await expect(fila).toContainText('📱 Nequi → 💰 Caja menor');
    await irA(page, 'ingfin');
    expect(await page.locator('#ingresoshist-filtros-cuenta button').allTextContents()).toEqual(['Todas', '💰 Caja menor', '🏦 Banco', '📱 Nequi']);
    await expect(page.locator('#ingfin-body tr', { hasText: 'Venta de canecas' })).toContainText('💰 Caja menor');
  });

  test('lo que conserva su nombre de siempre conserva también su rótulo largo de siempre (tarjetas de Caja)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCuentas([CTA_A[0], { codigo: 'transf_almuerzos', emoji: '☀️', nombre: 'Transf. Almuerzos' }, { codigo: 'transf_rapidas', emoji: '🌙', nombre: 'Transf. Comidas rápidas' }]) });
    await irA(page, 'caja');
    await expect(page.locator('[data-cta="efectivo"][data-cta-f="kpi"]')).toHaveText('💰 Caja menor');
    await expect(page.locator('[data-cta="transf_almuerzos"][data-cta-f="kpi"]')).toHaveText('☀️ Transferencia — Almuerzos');
    await expect(page.locator('[data-cta="transf_rapidas"][data-cta-f="kpi"]')).toHaveText('🌙 Transferencia — Comidas rápidas');
  });

  test('cambiar SOLO el símbolo de una cuenta también cuenta como cambiar su nombre de siempre (el rótulo largo ya no aplica)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCuentas([BASE.cuentas[0], { codigo: 'transf_almuerzos', emoji: '🏦', nombre: 'Transf. Almuerzos' }, BASE.cuentas[2]]) });
    await irA(page, 'caja');
    await expect(page.locator('[data-cta="transf_almuerzos"][data-cta-f="kpi"]')).toHaveText('🏦 Transf. Almuerzos');
    await expect(page.locator('[data-cta="transf_rapidas"][data-cta-f="kpi"]')).toHaveText('🌙 Transferencia — Comidas rápidas');
  });

  test('cambiar nombres no mueve ni un peso: los saldos son los mismos con y sin nombres guardados', async ({ page }) => {
    const leer = async d => {
      await abrirSistema(page, { usuario: 'admin', datos: d });
      await irA(page, 'caja');
      return Promise.all(['caja-efectivo', 'caja-transf-almuerzos', 'caja-transf-rapidas', 'caja-disponible'].map(i => texto(page, i)));
    };
    const antes = await leer(datosParaFoto());
    expect(await leer(datosCuentas())).toEqual(antes);
  });

  test('un símbolo vacío deja solo el nombre (sin espacio de más)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosCuentas([{ ...CTA_A[0], emoji: '' }, CTA_A[1], CTA_A[2]]) });
    expect(await opciones(page, 'egr-cuenta')).toEqual(['efectivo|Caja menor', 'transf_almuerzos|🏦 Banco', 'transf_rapidas|📱 Nequi']);
    expect(await page.evaluate(() => document.querySelector('#egr-cuenta option').textContent)).toBe('Caja menor');      // sin espacio de más al principio
    await irA(page, 'caja');
    expect(await page.evaluate(() => document.querySelector('[data-cta="efectivo"][data-cta-f="kpi"]').textContent)).toBe('Caja menor');
  });

  test('los gastos y movimientos viejos muestran el nombre de hoy de su cuenta (el código guardado no cambia)', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { datos: datosCuentas() });
    await verTodo(page);
    await expect(page.locator('#egresos-body tr', { hasText: 'Egreso arriendo' })).toContainText('🏦 Banco');
    expect(reg.datos.egresos.find(e => e.cat === 'arriendo').cuenta).toBe('transf_almuerzos');
    expect(escrituras(reg, 'egresos')).toEqual([]);
  });
});

// ── 3b. El Excel que lee el modelo financiero ────────────────────────────────────
test.describe('exportar a Excel', () => {
  const hojasExportadas = page => page.evaluate(() => {
    const hojas = {};
    window.XLSX = { utils: { book_new: () => ({}), json_to_sheet: filas => ({ filas }), book_append_sheet: (wb, ws, nombre) => { hojas[nombre] = ws.filas; } }, writeFile: () => {} };
    exportarExcelCompleto();
    return hojas;
  });
  test('trae las categorías y los nombres de las cuentas de hoy (código, nombre, grupo, dónde, activa) para el modelo financiero', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosA({ configuracion: [fila(1, CLAVE.categorias, CAT_A), fila(2, CLAVE.cuentas, CTA_A)] }) });
    const h = await hojasExportadas(page);
    expect(h.Categorias_Egresos).toEqual(CAT_A);
    expect(h.Nombres_Cuentas).toEqual(CTA_A);
    expect(Object.keys(h)).toEqual(expect.arrayContaining(['Egresos', 'Gastos_Cierre', 'Categorias_Egresos', 'Nombres_Cuentas']));
  });
  test('sin nada guardado trae las 7 de El Lobo y las 3 cuentas de siempre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    const h = await hojasExportadas(page);
    expect(h.Categorias_Egresos).toEqual(BASE.categorias);
    expect(h.Nombres_Cuentas).toEqual(BASE.cuentas);
  });
});

// ── 4. La pantalla «Categorías de egresos» y «Nombres de las cuentas» ──────────────
const FILA = i => `#cfgegr-fila-${i}`;
const nombreEgr = (page, i) => page.locator(`${FILA(i)} input[aria-label="Nombre"]`);
const nombreCta = (page, i) => page.locator(`#cfgcta-fila-${i} input[aria-label^="Nombre"]`);
const simboloCta = (page, i) => page.locator(`#cfgcta-fila-${i} input[aria-label^="Símbolo"]`);
const escribir = (loc, t) => loc.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, t);
const confirmar = (page, si = true) => page.click(`#sis-opciones button[data-eleccion="${si ? 'si' : 'no'}"]`);
const noAceptarAvisos = page => page.evaluate(() => { window.__noAceptarAvisos = true; });
const ultimoToast = page => page.locator('.toast').last();

test.describe('pantalla «Categorías de egresos»', () => {
  test('sin cambios guardados muestra las 7 de El Lobo, «de siempre», con todo apagado', async ({ page }) => {
    await abrirAdmin(page);
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(7);
    await expect(page.locator('#cfgegr-hoy')).toContainText('7 activas de 7');
    await expect(page.locator('#cfgegr-hoy')).toContainText('las categorías de siempre');
    await expect(page.locator('#cfgegr-guardar')).toBeDisabled();
    await expect(page.locator('#cfgegr-descartar')).toBeDisabled();
    await expect(page.locator('#cfgegr-agregar')).toBeEnabled();
    expect(await page.locator('#cfgegr-cuerpo .cfgcat-cod').allTextContents()).toEqual(BASE.categorias.map(c => c.codigo));
    await expect(nombreEgr(page, 0)).toHaveValue('Nómina');
    await expect(page.locator(`${FILA(0)} .badge`).first()).toHaveText('Nómina');                          // el grupo, como etiqueta (no se cambia)
    await expect(page.locator(`${FILA(2)} .badge`).first()).toHaveText('Arriendo y servicios');
    await expect(page.locator(`${FILA(6)} .badge`).first()).toHaveText('No cuenta como egreso');
    await expect(page.locator('#cfgegr-cuerpo select[aria-label^="Grupo"]')).toHaveCount(0);               // el grupo solo se escoge al crear
    await expect(page.locator(`${FILA(6)} select[aria-label^="Dónde"]`)).toBeDisabled();                  // lo que no cuenta como egreso solo va al cierre
    await expect(page.locator(`${FILA(2)} select[aria-label^="Dónde"]`)).toHaveValue('egresos');
    await expect(page.locator(`${FILA(0)} select[aria-label^="Dónde"]`)).toHaveValue('ambos');
    await expect(page.locator('#cfgcta-cuerpo tr')).toHaveCount(3);
    await expect(page.locator('#cfgcta-hoy')).toContainText('los nombres de siempre');
    await expect(page.locator('#cfgcta-guardar')).toBeDisabled();
    await expect(simboloCta(page, 1)).toHaveValue('☀️');
    await expect(nombreCta(page, 2)).toHaveValue('Transf. Comidas rápidas');
  });

  test('cambiar un nombre marca la fila, cuenta el cambio y «Descartar» lo deshace', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await expect(page.locator(FILA(0))).toHaveClass(/cfgcat-cambio/);
    await expect(page.locator('#cfgegr-contador')).toHaveText('1 cambio sin guardar');
    await expect(page.locator('#cfgegr-guardar')).toBeEnabled();
    await expect(page.locator('#cfgcta-guardar')).toBeDisabled();                                       // el otro panel no cambia
    await page.click('#cfgegr-descartar');
    await expect(nombreEgr(page, 0)).toHaveValue('Nómina');
    await expect(page.locator('#cfgegr-contador')).toHaveText('');
    await expect(page.locator('#cfgegr-guardar')).toBeDisabled();
    await escribir(nombreEgr(page, 0), 'Sueldos'); await escribir(nombreEgr(page, 0), 'Nómina');         // volver al valor de antes no es un cambio
    await expect(page.locator('#cfgegr-guardar')).toBeDisabled();
    expect(escrituras(reg)).toEqual([]);
  });

  test('guardar un nombre: pide confirmación con lo que cambia, manda UNA fila con la lista completa y todo lo usa sin recargar', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombreEgr(page, 0), '  Sueldos   del  personal ');
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const t = await page.locator('#modal-sistema').innerText();
    expect(t).toContain('Categorías de egresos');
    expect(t).toContain('Nombre: «Nómina» → «Sueldos del personal»');
    expect(t).toContain('Rigen desde ahora');
    expect(t).toContain('conservan sus montos y sus códigos');
    expect(escrituras(reg)).toEqual([]);                                                                 // todavía no se mandó nada
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    const filas = escrituras(reg);
    expect(filas.length).toBe(1);
    expect(filas[0].cuerpo).toEqual({ clave: 'categorias_egresos', valor: cambiarCat(BASE.categorias, 'nomina', { nombre: 'Sueldos del personal' }) });   // nombre limpio, sin marcas internas
    await expect(page.locator('#cfgegr-contador')).toHaveText('');
    await expect(page.locator('#cfgegr-guardar')).toBeDisabled();
    expect(await opciones(page, 'egr-cat')).toContain('nomina|Sueldos del personal');                    // las listas ya lo tienen
    expect(await opciones(page, 'dd-gasto-cat')).toContain('nomina|Sueldos del personal');
    await expect(page.locator('#cfgegr-hoy')).toContainText('7 activas de 7');
    const histo = page.locator('#config-historial tbody tr').first();
    await expect(histo).toContainText('Categorías de egresos');
    await expect(histo).toContainText('Nombre: «Nómina» → «Sueldos del personal»');
    await expect(histo).toContainText('rige hoy');
    expect(reg.errores).toEqual([]);
  });

  test('una categoría nueva: código cat1, grupo a escoger, se cuenta en palabras, se guarda y se suma donde le toca', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { datos: (() => { const d = datosParaFoto(); d.egresos.push({ id: 7, fecha: '2026-10-19', cat: 'cat1', cuenta: 'efectivo', monto: 25000, description: 'Wifi', turno: null, created_at: '2026-10-19T09:00:00-05:00' }); return d; })() });
    await noAceptarAvisos(page);
    await page.click('#cfgegr-agregar');
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(8);
    await expect(page.locator(`${FILA(7)} .cfgcat-cod`)).toHaveText('cat1');
    await expect(page.locator(FILA(7))).toHaveClass(/cfgcat-nuevo/);
    await expect(nombreEgr(page, 7)).toBeFocused();
    const grupo = page.locator(`${FILA(7)} select[aria-label^="Grupo"]`);
    expect(await grupo.locator('option').allTextContents()).toEqual(['Nómina', 'Proveedores (insumos)', 'Arriendo y servicios', 'Desechables', 'Otros gastos', 'No cuenta como egreso']);
    await expect(grupo).toHaveValue('otro');
    await expect(page.locator(`${FILA(7)} select[aria-label^="Dónde"]`)).toHaveValue('ambos');
    await expect(page.locator('#cfgegr-contador')).toHaveText('1 cambio sin guardar');
    await nombreEgr(page, 7).fill('Internet y teléfono');
    await grupo.selectOption('operativo');
    await page.locator(`${FILA(7)} select[aria-label^="Dónde"]`).selectOption('egresos');
    await expect(nombreEgr(page, 7)).toHaveValue('Internet y teléfono');                                 // volver a dibujar al cambiar el grupo no borra lo escrito
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('➕ Nueva categoría: Internet y teléfono · Arriendo y servicios · solo en Egresos');
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('8 activas de 8');
    expect(escrituras(reg).length).toBe(1);
    expect(escrituras(reg)[0].cuerpo.valor.slice(7)).toEqual([nueva('cat1', 'Internet y teléfono', 'operativo', 'egresos')]);
    await expect(page.locator(`${FILA(7)} .badge`).first()).toHaveText('Arriendo y servicios');           // ya guardada: el grupo no se cambia más
    await expect(page.locator(`${FILA(7)} select[aria-label^="Grupo"]`)).toHaveCount(0);
    expect(await opciones(page, 'egr-cat')).toContain('cat1|Internet y teléfono');
    expect(await opciones(page, 'dd-gasto-cat')).not.toContain('cat1|Internet y teléfono');               // «solo en Egresos»
    await verTodo(page);
    await expect(page.locator('#egr-arr')).toHaveText('$1.005.000');                                      // el egreso viejo con código cat1 suma en «Arriendo + Servicios»
  });

  test('«No cuenta como egreso» obliga a usarla solo en el cierre', async ({ page }) => {
    await abrirAdmin(page);
    await page.click('#cfgegr-agregar');
    await nombreEgr(page, 7).fill('Retiro del dueño');
    await page.locator(`${FILA(7)} select[aria-label^="Grupo"]`).selectOption('excluido');
    const donde = page.locator(`${FILA(7)} select[aria-label^="Dónde"]`);
    await expect(donde).toBeDisabled();
    await expect(donde).toHaveValue('cierre');
    expect(await donde.locator('option').allTextContents()).toEqual(['solo en el cierre del día']);
    await page.locator(`${FILA(7)} select[aria-label^="Grupo"]`).selectOption('otro');                    // si se arrepiente, vuelve a poder escoger
    await expect(page.locator(`${FILA(7)} select[aria-label^="Dónde"]`)).toBeEnabled();
  });

  test('una categoría «no cuenta como egreso» se guarda con «solo en el cierre» aunque antes tuviera «ambos» (lo que ve es lo que se guarda)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await page.click('#cfgegr-agregar');
    await nombreEgr(page, 7).fill('Retiro del dueño');
    await page.locator(`${FILA(7)} select[aria-label^="Grupo"]`).selectOption('excluido');
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('8 activas de 8');
    expect(escrituras(reg).length).toBe(1);                                                                // la base/pantalla no la rechazaron
    expect(escrituras(reg)[0].cuerpo.valor.slice(7)).toEqual([nueva('cat1', 'Retiro del dueño', 'excluido', 'cierre')]);
    expect((await opciones(page, 'egr-cat')).map(o => o.split('|')[0])).not.toContain('cat1');            // no aparece en Egresos
    expect((await opciones(page, 'dd-gasto-cat')).map(o => o.split('|')[0])).toContain('cat1');           // sí en el cierre del día
  });

  test('retirar y reactivar: la fila se marca, se cuenta con palabras y las listas dejan de ofrecerla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await page.locator(`${FILA(5)} button`, { hasText: 'Retirar' }).click();                             // «Otro»
    await expect(page.locator(FILA(5))).toHaveClass(/cfgcat-retirado/);
    await expect(page.locator(`${FILA(5)} .badge`).last()).toHaveText('retirada');
    await expect(page.locator(`${FILA(5)} button`)).toHaveText('Reactivar');
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('🚫 Se retira: Otro');
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('6 activas de 7');
    expect(escrituras(reg)[0].cuerpo.valor[5]).toEqual({ codigo: 'otro', nombre: 'Otro', grupo: 'otro', donde: 'ambos', activo: false });
    expect((await opciones(page, 'egr-cat')).map(o => o.split('|')[0])).not.toContain('otro');
    expect((await opciones(page, 'dd-gasto-cat')).map(o => o.split('|')[0])).not.toContain('otro');
    await page.locator(`${FILA(5)} button`, { hasText: 'Reactivar' }).click();
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('✅ Se reactiva: Otro');
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('7 activas de 7');
    expect(escrituras(reg).length).toBe(2);
    expect((await opciones(page, 'egr-cat')).map(o => o.split('|')[0])).toContain('otro');
  });

  test('cambiar dónde se usa una categoría cambia en qué listas aparece', async ({ page }) => {
    await abrirAdmin(page);
    await noAceptarAvisos(page);
    await page.locator(`${FILA(0)} select[aria-label^="Dónde"]`).selectOption('cierre');                  // nómina: solo en el cierre
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('Nómina: se usa en Egresos y en el cierre → solo en el cierre del día');
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    expect((await opciones(page, 'egr-cat')).map(o => o.split('|')[0])).not.toContain('nomina');
    expect((await opciones(page, 'dd-gasto-cat')).map(o => o.split('|')[0])).toContain('nomina');
  });

  test('una categoría nueva sin guardar se puede quitar; una ya guardada, no', async ({ page }) => {
    await abrirAdmin(page);
    await page.click('#cfgegr-agregar'); await page.click('#cfgegr-agregar');
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(9);
    await expect(page.locator(`${FILA(8)} .cfgcat-cod`)).toHaveText('cat2');
    await page.locator(`${FILA(7)} button`, { hasText: 'Quitar' }).click();
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(8);
    await expect(page.locator(`${FILA(7)} .cfgcat-cod`)).toHaveText('cat2');
    await expect(page.locator(`${FILA(0)} button`, { hasText: 'Quitar' })).toHaveCount(0);               // las guardadas solo se retiran
    await page.evaluate(() => cfgEgrQuitar(0));                                                           // aunque se intente por código
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(8);
    await expect(page.locator(`${FILA(0)} .cfgcat-cod`)).toHaveText('nomina');
    await page.click('#cfgegr-descartar');
    await expect(page.locator('#cfgegr-cuerpo tr')).toHaveCount(7);
  });

  test('«Volver» en la confirmación no guarda nada y conserva lo escrito', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombreEgr(page, 1), 'Insumos');
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await confirmar(page, false);
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg)).toEqual([]);
    await expect(nombreEgr(page, 1)).toHaveValue('Insumos');
    await expect(page.locator('#cfgegr-contador')).toHaveText('1 cambio sin guardar');
  });

  test('doble clic en «Guardar cambios»: una sola fila', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await page.evaluate(() => { cfgEgrGuardar(); cfgEgrGuardar(); });
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await confirmar(page);
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    await page.waitForTimeout(150);
    expect(escrituras(reg).length).toBe(1);
  });

  test('un segundo «Guardar» mientras el primero se está guardando no abre otra confirmación ni escribe otra vez', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await escribir(nombreCta(page, 0), 'Caja menor');
    await page.evaluate(async () => {
      const primero = cfgEgrGuardar();
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('#sis-opciones button[data-eleccion="si"]').click();
      await new Promise(r => setTimeout(r, 0));
      const segundo = cfgEgrGuardar();                                                                   // vuelve a pulsar mientras guarda
      const tercero = cfgCtaGuardar();                                                                   // y el otro panel tampoco puede guardar a la vez
      await Promise.all([primero, segundo, tercero]);
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#modal-sistema')).toBeHidden();
    expect(escrituras(reg).length).toBe(1);
  });

  test('un nombre escrito a medias con comillas o signos de código no rompe ni inyecta nada al volver a dibujar la tabla', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const malo = '"onfocus=__x=1 <img src=x onerror=__y=1>';                       // 40 caracteres: pasa el largo y lo frena la regla de los signos
    await escribir(nombreEgr(page, 0), malo);
    await page.locator(`${FILA(5)} button`, { hasText: 'Retirar' }).click();                             // vuelve a dibujar la tabla con lo escrito
    await expect(nombreEgr(page, 0)).toHaveValue(malo);
    await nombreEgr(page, 0).focus();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({ x: window.__x || 0, y: window.__y || 0, img: document.querySelectorAll('img[src="x"]').length }))).toEqual({ x: 0, y: 0, img: 0 });
    await noAceptarAvisos(page);
    await page.click('#cfgegr-guardar');
    await expect(ultimoToast(page)).toContainText('no pueden llevar los caracteres');
    expect(escrituras(reg)).toEqual([]);
  });

  test('si otro administrador cambió las categorías mientras tanto, no se pisa su cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    reg.datos.configuracion.push(fila(99, CLAVE.categorias, cambiarCat(BASE.categorias, 'proveedor', { nombre: 'Insumos' }), '2026-10-20T13:00:00-05:00', 'otro'));
    await page.click('#cfgegr-guardar');
    await expect(ultimoToast(page)).toContainText('Alguien más acaba de cambiar esto');
    expect(escrituras(reg)).toEqual([]);
    await expect(nombreEgr(page, 1)).toHaveValue('Insumos');                                              // la pantalla ya muestra lo de la otra persona
    await expect(nombreEgr(page, 0)).toHaveValue('Nómina');                                               // y lo escrito se descartó
    await expect(page.locator('#cfgegr-hoy')).toContainText('por otro');
  });

  test('un cambio en OTRA clave (los nombres de las cuentas) no estorba el guardado de las categorías', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    reg.datos.configuracion.push(fila(99, CLAVE.cuentas, CTA_A, '2026-10-20T13:00:00-05:00', 'otro'));
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
  });

  test('mientras se escribe un cambio, si llega otro de afuera la tabla no se vuelve a dibujar (no se pierde el cursor)', async ({ page }) => {
    await abrirAdmin(page);
    const campoNombre = nombreEgr(page, 0);
    await campoNombre.fill('Sueldos');
    await campoNombre.focus();
    await page.evaluate(() => {                                                                           // otro administrador guardó las categorías mientras tanto
      const nuevo = CATEGORIAS_EGRESOS_BASE.map(c => ({ ...c, nombre: c.codigo === 'proveedor' ? 'Insumos' : c.nombre }));
      ST.configuracion = (ST.configuracion || []).concat([{ id: 999, clave: 'categorias_egresos', valor: nuevo, vigente_desde: new Date().toISOString(), creado_por: 'otro' }]);
      renderAll();
    });
    await expect(page.locator('#cfgegr-hoy')).toContainText('por otro');                                  // lo de arriba sí se actualiza
    expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))).toBe('Nombre');   // y el cursor sigue en el campo
    await expect(campoNombre).toHaveValue('Sueldos');
  });

  test('las listas de los formularios conservan lo que la persona ya había escogido cuando cambian las categorías', async ({ page }) => {
    await abrirAdmin(page, { datos: datosA() });
    await irA(page, 'egresos');
    await page.selectOption('#egr-cat', 'cat1');
    await page.selectOption('#egr-cuenta', 'transf_rapidas');
    await page.evaluate(() => {                                                                           // llega una versión nueva de las dos listas
      const cats = CFG.v('categorias_egresos').map(c => (c.codigo === 'cat1' ? { ...c, nombre: 'Mantenimiento 2' } : c));
      const ctas = CFG.v('nombres_cuentas').map(c => (c.codigo === 'efectivo' ? { ...c, nombre: 'Caja menor' } : c));
      ST.configuracion = ST.configuracion.concat([{ id: 50, clave: 'categorias_egresos', valor: cats, vigente_desde: new Date().toISOString(), creado_por: 'otro' },
                                                  { id: 51, clave: 'nombres_cuentas', valor: ctas, vigente_desde: new Date().toISOString(), creado_por: 'otro' }]);
      renderAll();
    });
    expect(await opciones(page, 'egr-cat')).toContain('cat1|Mantenimiento 2');
    expect(await page.locator('#egr-cat').inputValue()).toBe('cat1');
    expect(await page.locator('#egr-cuenta').inputValue()).toBe('transf_rapidas');
    expect(await opciones(page, 'egr-cuenta')).toContain('efectivo|💵 Caja menor');
  });

  test('si se agrega una categoría mientras otra persona edita, lo que está escrito no se pisa al volver a dibujar', async ({ page }) => {
    await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await page.evaluate(() => renderAll());                                                               // cualquier actualización de la pantalla
    await expect(nombreEgr(page, 0)).toHaveValue('Sueldos');
    await expect(page.locator('#cfgegr-contador')).toHaveText('1 cambio sin guardar');
  });

  test('tras guardar no queda borrador: «Descartar» queda apagado', async ({ page }) => {
    await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await expect(page.locator('#cfgegr-descartar')).toBeEnabled();
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    await expect(page.locator('#cfgegr-descartar')).toBeDisabled();
    await expect(page.locator('#cfgegr-contador')).toHaveText('');
  });
});

test.describe('pantalla «Nombres de las cuentas»', () => {
  test('guardar nombres y símbolos: confirmación en palabras, UNA fila, y todo se ve con el nombre nuevo', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(simboloCta(page, 0), '💰');
    await escribir(nombreCta(page, 0), '  Caja   menor ');
    await expect(page.locator('#cfgcta-fila-0')).toHaveClass(/cfgcat-cambio/);
    await expect(page.locator('#cfgcta-contador')).toHaveText('1 cambio sin guardar');
    await page.click('#cfgcta-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    const t = await page.locator('#modal-sistema').innerText();
    expect(t).toContain('Nombres de las cuentas');
    expect(t).toContain('Cuenta «💵 Efectivo» → «💰 Caja menor»');
    await confirmar(page);
    await expect(page.locator('#cfgcta-hoy')).toContainText('por dueno1');
    expect(escrituras(reg).length).toBe(1);
    expect(escrituras(reg)[0].cuerpo).toEqual({ clave: 'nombres_cuentas', valor: [{ codigo: 'efectivo', emoji: '💰', nombre: 'Caja menor' }, BASE.cuentas[1], BASE.cuentas[2]] });
    expect(await opciones(page, 'egr-cuenta')).toContain('efectivo|💰 Caja menor');
    await expect(page.locator('#cfgcta-hoy')).toContainText('💰 Caja menor');
    const histo = page.locator('#config-historial tbody tr').first();
    await expect(histo).toContainText('Nombres de las cuentas');
    await expect(histo).toContainText('Cuenta «💵 Efectivo» → «💰 Caja menor»');
    await irA(page, 'caja');
    await expect(page.locator('[data-cta="efectivo"][data-cta-f="kpi"]')).toHaveText('💰 Caja menor');
    expect(reg.errores).toEqual([]);
  });

  test('cambiar solo el símbolo también se cuenta, se guarda y deja «Descartar» apagado', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    await escribir(simboloCta(page, 2), '📱');
    await expect(page.locator('#cfgcta-contador')).toHaveText('1 cambio sin guardar');
    await page.click('#cfgcta-guardar');
    await expect(page.locator('#modal-sistema')).toBeVisible();
    expect(await page.locator('#modal-sistema').innerText()).toContain('Cuenta «🌙 Transf. Comidas rápidas» → «📱 Transf. Comidas rápidas»');
    await confirmar(page);
    await expect(page.locator('#cfgcta-hoy')).toContainText('por dueno1');
    expect(escrituras(reg)[0].cuerpo.valor[2]).toEqual({ codigo: 'transf_rapidas', emoji: '📱', nombre: 'Transf. Comidas rápidas' });
    await expect(page.locator('#cfgcta-descartar')).toBeDisabled();                                    // lo escrito quedó guardado: no queda borrador
    await expect(page.locator('#cfgcta-contador')).toHaveText('');
  });

  test('«Descartar» y volver al valor de antes no cuentan como cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreCta(page, 1), 'Banco');
    await expect(page.locator('#cfgcta-guardar')).toBeEnabled();
    await page.click('#cfgcta-descartar');
    await expect(nombreCta(page, 1)).toHaveValue('Transf. Almuerzos');
    await escribir(nombreCta(page, 1), 'Banco'); await escribir(nombreCta(page, 1), 'Transf. Almuerzos');
    await expect(page.locator('#cfgcta-guardar')).toBeDisabled();
    expect(escrituras(reg)).toEqual([]);
  });

  const INVALIDOS = [
    ['nombre vacío', 0, 'nombre', '', 'Falta el nombre de una cuenta'],
    ['nombre con «<»', 0, 'nombre', 'Caja <b>', 'no pueden llevar los caracteres'],
    ['nombre con comillas', 0, 'nombre', 'Caja "x"', 'no pueden llevar los caracteres'],
    ['nombre repetido', 0, 'nombre', 'transf. almuerzos', 'está repetido'],
    ['nombre de 31 caracteres', 0, 'nombre', 'N'.repeat(31), 'entre 1 y 30 caracteres'],
    ['símbolo de 9 caracteres', 0, 'emoji', '😀😀😀😀😀😀😀😀😀', 'hasta 8 caracteres'],
    ['símbolo con «&»', 0, 'emoji', '&', 'Los símbolos no pueden llevar'],
  ];
  for (const [que, i, campoCta, valor, mensaje] of INVALIDOS) {
    test(`${que}: se rechaza antes de mandar nada`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await noAceptarAvisos(page);
      await escribir(campoCta === 'nombre' ? nombreCta(page, i) : simboloCta(page, i), valor);
      await page.evaluate(() => cfgCtaGuardar());
      await expect(ultimoToast(page)).toContainText(mensaje);
      await page.waitForTimeout(80);
      expect(await page.locator('#modal-sistema').isVisible()).toBe(false);
      expect(escrituras(reg)).toEqual([]);
    });
  }

  test('si otra persona cambió los nombres mientras tanto, no se pisa su cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreCta(page, 0), 'Caja menor');
    reg.datos.configuracion.push(fila(99, CLAVE.cuentas, CTA_A, '2026-10-20T13:00:00-05:00', 'otro'));
    await page.click('#cfgcta-guardar');
    await expect(ultimoToast(page)).toContainText('Alguien más acaba de cambiar esto');
    expect(escrituras(reg)).toEqual([]);
    await expect(nombreCta(page, 2)).toHaveValue('Nequi');
    await expect(page.locator('#cfgcta-hoy')).toContainText('por otro');
  });
});

test.describe('categorías: valores inválidos', () => {
  const CASOS_UI = [
    ['nombre vacío en una nueva', async (page) => { await page.click('#cfgegr-agregar'); }, 'Falta el nombre de una categoría nueva'],
    ['nombre con «<»', async (page) => { await escribir(nombreEgr(page, 0), 'Nómina <b>'); }, 'no pueden llevar los caracteres'],
    ['nombre con comilla simple', async (page) => { await escribir(nombreEgr(page, 0), "Nómina d'oro"); }, 'no pueden llevar los caracteres'],
    ['nombre con «&»', async (page) => { await escribir(nombreEgr(page, 0), 'Arroz & frijol'); }, 'no pueden llevar los caracteres'],
    ['nombre repetido (sin importar mayúsculas)', async (page) => { await escribir(nombreEgr(page, 0), 'proveedores'); }, 'está repetido'],
    ['nombre de 41 caracteres', async (page) => { await escribir(nombreEgr(page, 0), 'N'.repeat(41)); }, 'entre 1 y 40 caracteres'],
    ['nombre solo con espacios', async (page) => { await escribir(nombreEgr(page, 0), '    '); }, 'Falta el nombre de una categoría'],
  ];
  for (const [que, accion, mensaje] of CASOS_UI) {
    test(`${que}: se rechaza antes de mandar nada`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await noAceptarAvisos(page);
      await accion(page);
      await page.evaluate(() => cfgEgrGuardar());
      await expect(ultimoToast(page)).toContainText(mensaje);
      await page.waitForTimeout(80);
      expect(await page.locator('#modal-sistema').isVisible()).toBe(false);
      expect(escrituras(reg)).toEqual([]);
    });
  }

  test('no se puede dejar sin ninguna categoría activa para Egresos ni para el cierre', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await noAceptarAvisos(page);
    for (const i of [0, 1, 4, 5]) await page.locator(`${FILA(i)} button`, { hasText: 'Retirar' }).click();     // nómina, proveedores, desechables, otro
    await page.locator(`${FILA(6)} button`, { hasText: 'Retirar' }).click();                                   // préstamo: ya no queda ninguna para el cierre
    await page.click('#cfgegr-guardar');
    await expect(ultimoToast(page)).toContainText('Debe quedar al menos una categoría activa para el cierre del día');
    await page.click('#cfgegr-descartar');
    for (const i of [0, 1, 2, 3, 4, 5]) await page.locator(`${FILA(i)} button`, { hasText: 'Retirar' }).click();
    await page.click('#cfgegr-guardar');
    await expect(ultimoToast(page)).toContainText('Debe quedar al menos una categoría activa para registrar egresos');
    expect(escrituras(reg)).toEqual([]);
  });
});

// ── 5. El servidor (Postgres de verdad en tests/python; aquí su imitación) ────────────
test.describe('el servidor rechaza lo que no debe', () => {
  const probar = (page, clave, valor) => page.evaluate(async ([c, v]) => {
    try { await sbInsert('configuracion', { clave: c, valor: v }); return 'se guardó'; } catch (e) { const t = String(e.message || e); try { return JSON.parse(t).message || t; } catch (_) { return t; } }
  }, [clave, valor]);

  test('una categoría ya guardada no se borra: se retira', async ({ page }) => {
    await abrirAdmin(page, { datos: datosCon([fila(1, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Mantenimiento')])]) });
    expect(await probar(page, CLAVE.categorias, BASE.categorias)).toBe('No se pueden borrar categorías (cat1): se retiran, para que los gastos viejos se sigan mostrando.');
  });

  test('el grupo de una categoría ya guardada no cambia, aunque se haya retirado entre medias', async ({ page }) => {
    await abrirAdmin(page, { datos: datosCon([fila(1, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Mantenimiento', 'otro')]), fila(2, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Mantenimiento', 'otro', 'ambos', false)])]) });
    expect(await probar(page, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Mantenimiento', 'operativo', 'egresos')])).toBe('No se puede cambiar el grupo de una categoría ya creada (cat1): lo que ya se registró seguiría contándose distinto.');
    expect(await probar(page, CLAVE.categorias, [...BASE.categorias, nueva('cat1', 'Mantenimiento 2', 'otro', 'egresos', true)])).toBe('se guardó');   // renombrar, reactivar y cambiar «dónde» sí
  });

  test('las 7 de El Lobo no se pueden quitar ni cambiar de grupo, y tampoco quitar las 3 cuentas ni inventar otra', async ({ page }) => {
    await abrirAdmin(page);
    expect(await probar(page, CLAVE.categorias, BASE.categorias.map(c => (c.codigo === 'nomina' ? { ...c, codigo: 'sueldos' } : c)))).toContain('no puede quitar categorías de El Lobo');
    expect(await probar(page, CLAVE.categorias, BASE.categorias.map(c => (c.codigo === 'nomina' ? { ...c, grupo: 'otro' } : c)))).toContain('no puede cambiar de grupo');
    expect(await probar(page, CLAVE.cuentas, BASE.cuentas.slice(1))).toContain('exactamente 3');
    expect(await probar(page, CLAVE.cuentas, BASE.cuentas.map((c, i) => (i === 0 ? { ...c, codigo: 'banco' } : c)))).toContain('no existe');
  });

  test('un administrador y solo un administrador puede guardar; lo guardado queda con quién y cuándo', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    expect(await probar(page, CLAVE.cuentas, CTA_A)).toBe('se guardó');
    const f = reg.datos.configuracion.at(-1);
    expect(f.clave).toBe('nombres_cuentas');
    expect(f.creado_por).toBe('dueno1');
  });
});

// ── 6. Quién puede ──────────────────────────────────────────────────────────────
test.describe('permisos (categorías y cuentas)', () => {
  test('con caja la pestaña no aparece y guardar no escribe nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    await expect(page.locator('#tab-nav-config')).toBeHidden();
    await page.evaluate(() => { cfgEgrBorrador()[0].nombre = 'Sueldos'; cfgCtaBorrador()[0].nombre = 'Caja menor'; });
    await page.evaluate(() => cfgEgrGuardar());
    await expect(ultimoToast(page)).toContainText('Solo el administrador');
    await page.evaluate(() => cfgCtaGuardar());
    await expect(ultimoToast(page)).toContainText('Solo el administrador');
    expect(escrituras(reg)).toEqual([]);
    expect(await opciones(page, 'dd-gasto-cat')).toContain('nomina|Nómina de empleados');
  });

  test('la caja sí ve los nombres nuevos que guardó el administrador (los lee igual que todos)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja', datos: datosA({ configuracion: [fila(1, CLAVE.categorias, CAT_A), fila(2, CLAVE.cuentas, CTA_A)] }) });
    expect(await opciones(page, 'dd-gasto-cat')).toContain('nomina|Sueldos');
    expect(await opciones(page, 'dd-gasto-cat')).toContain('cat1|Mantenimiento');
    expect(await opciones(page, 'caja-mov-cuenta')).toContain('efectivo|💰 Caja menor');
    expect(reg.errores).toEqual([]);
  });

  test('lo guardado se ve al abrir de nuevo el sistema (otro equipo, otra sesión)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(nombreEgr(page, 0), 'Sueldos');
    await page.click('#cfgegr-guardar');
    await expect(page.locator('#cfgegr-hoy')).toContainText('por dueno1');
    const nuevo = await page.context().newPage();
    await abrirSistema(nuevo, { usuario: 'caja', datos: reg.datos });
    expect(await opciones(nuevo, 'dd-gasto-cat')).toContain('nomina|Sueldos');
  });
});

// ── 7. Tres reglas, un solo veredicto ────────────────────────────────────────────
// Los mismos casos que prueba Postgres de verdad (tests/python/test_configuracion_etapa_4.py): la revisión de la pantalla
// (cfgValidar) y el servidor falso de las pruebas deben dar el MISMO veredicto y el MISMO mensaje que la base.
function armar(caso) {
  if ('valor' in caso) return caso.valor;
  const v = copia(BASE[caso.clave === CLAVE.categorias ? 'categorias' : 'cuentas']);
  for (const [i, cambios] of Object.entries(caso.mod || {})) Object.assign(v[+i], cambios);
  for (const [i, campos] of Object.entries(caso.sin || {})) for (const c of campos) delete v[+i][c];
  for (const i of [...(caso.quitar || [])].sort((a, b) => b - a)) v.splice(i, 1);
  v.push(...copia(caso.agregar || []));
  for (let i = 0; i < (caso.relleno || 0); i++) v.push(nueva('z' + (i + 1), `Relleno ${i + 1}`));
  return v;
}

test.describe('la pantalla, el servidor falso y la base dicen lo mismo (categorías y cuentas)', () => {
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
});
