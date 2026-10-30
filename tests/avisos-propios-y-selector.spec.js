// Avisos propios del sistema (nada de alert/confirm/prompt del navegador) y selector de cliente.
//
// Pedido del dueño (30-oct-2026): el sistema se abre desde distintos navegadores y los avisos del navegador cambian de
// aspecto y de comportamiento en cada uno; además, el cuadro «¿A nombre de quién queda este fiado?» dejaba un fiado SIN
// nombre al pulsar «Cancelar». Ahora:
//   · todo «¿Seguro?» sale en una ventana del sistema (#modal-sistema) con botones que dicen lo que hacen;
//   · al pasar un pendiente a fiado, el cliente se elige en una ventana (#modal-elegir-cliente) con TODOS los clientes en orden
//     alfabético, un buscador y «+ Crear cliente nuevo»; «Volver» no registra nada (nunca un fiado sin nombre);
//   · el autocompletado de Pedidos → «Fiar» muestra a todos los clientes (no solo 8) en orden alfabético.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const VENTANA = '#modal-sistema';
const SELECTOR = '#modal-elegir-cliente';

// Vigila que el navegador NO muestre ningún aviso propio (si saliera alguno, se anota y se cierra).
function vigilarNativos(page) {
  const nativos = [];
  page.on('dialog', async d => { nativos.push({ tipo: d.type(), mensaje: d.message() }); await d.dismiss(); });
  return nativos;
}

// ── 0) El código: ni un solo alert/confirm/prompt del navegador ──────────────────────────────────────────────────────────
test.describe('0) El código no usa avisos del navegador', () => {
  const quitarComentarios = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  for (const [nombre, ruta] of [
    ['el sistema contable', 'Contabilidad/ElLobo-Sistema Contable.html'],
    ['el generador del menú', 'Menu/Menú diario-El Lobo.html'],
  ]) {
    test(`${nombre}: no llama a alert(), confirm() ni prompt()`, async () => {
      const codigo = quitarComentarios(fs.readFileSync(path.join(__dirname, '..', ruta), 'utf-8'));
      const usos = [...codigo.matchAll(/(?<![\w$.])(?:window\.)?(alert|confirm|prompt)\s*\(/g)].map(m => m[0]);
      expect(usos).toEqual([]);
    });
  }
});

// ── 1) Selector de cliente ──────────────────────────────────────────────────────────────────────────────────────────────
const NOMBRES_EN_DESORDEN = ['zulema', 'Ángela', 'beatriz', 'Carlos', 'david', 'Éder', 'Fabio', 'gloria', 'Hernán', 'Iván', 'julia', 'Karen', 'Luis'];
function datosConClientes(nombres = NOMBRES_EN_DESORDEN) {
  const d = copia(BASE);
  d.cierres_dia = [];
  d.clientes_fiado = nombres.map((nombre, i) => ({ id: 100 + i, nombre, created_at: '2026-10-01T10:00:00-05:00' }));
  d.abonos_fiado = [];
  d.pedidos = d.pedidos.filter(p => !p.es_fiar);
  return d;
}
// Abre el selector como lo hace «📒 Fiar» y deja el resultado en window.__r (null = «Volver»).
const abrirSelector = page => page.evaluate(() => {
  window.__r = 'esperando';
  elegirClienteFiado({ titulo: '¿A nombre de quién queda este fiado?', detalle: 'Mesa 3 · $9.000' }).then(r => { window.__r = r; });
});
const resultado = page => page.evaluate(() => window.__r);
const filasSelector = page => page.locator(`${SELECTOR} #ecl-lista .autocomplete-item`);
const nombresSelector = async page => (await filasSelector(page).allInnerTexts()).map(s => s.split('\n')[0]);
const ordenEs = nombres => [...nombres].sort(new Intl.Collator('es', { sensitivity: 'base' }).compare);

test.describe('1) Selector de cliente (Pendientes → «📒 Fiar»)', () => {
  test('muestra TODOS los clientes (no solo 8), en orden alfabético sin importar tildes ni mayúsculas', async ({ page }) => {
    const nativos = vigilarNativos(page);
    await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await expect(page.locator(SELECTOR)).toBeVisible();
    const nombres = await nombresSelector(page);
    expect(nombres).toHaveLength(NOMBRES_EN_DESORDEN.length);                            // 13 > 8
    expect(nombres).toEqual(ordenEs(NOMBRES_EN_DESORDEN));
    expect(nombres.slice(0, 3)).toEqual(['Ángela', 'beatriz', 'Carlos']);                // la Á va con la A, la b minúscula con la B
    expect(nombres[nombres.length - 1]).toBe('zulema');
    await expect(page.locator('#ecl-titulo')).toHaveText('¿A nombre de quién queda este fiado?');
    await expect(page.locator('#ecl-detalle')).toHaveText('Mesa 3 · $9.000');
    expect(nativos).toEqual([]);
  });

  test('el buscador filtra sin importar tildes ni mayúsculas, y ofrece crear uno nuevo solo si el nombre no existe', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await page.fill('#ecl-buscar', 'ANGEL');
    expect(await nombresSelector(page)).toEqual(['Ángela', '+ Crear cliente nuevo: "ANGEL"']);
    await page.fill('#ecl-buscar', 'angela');                                            // ya existe (sin tilde ni mayúscula): no se ofrece duplicar
    expect(await nombresSelector(page)).toEqual(['Ángela']);
    await page.fill('#ecl-buscar', 'xyz');
    expect(await nombresSelector(page)).toEqual(['+ Crear cliente nuevo: "xyz"']);
    await page.fill('#ecl-buscar', '');                                                  // vacío → vuelven todos
    expect(await filasSelector(page).count()).toBe(NOMBRES_EN_DESORDEN.length);
  });

  test('elegir un cliente de la lista devuelve ese cliente y cierra la ventana', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await filasSelector(page).filter({ hasText: 'Hernán' }).click();
    await expect(page.locator(SELECTOR)).toBeHidden();
    expect(await resultado(page)).toEqual({ id: 108, nombre: 'Hernán' });
    expect(reg.escrituras).toEqual([]);                                                  // elegir no escribe nada
  });

  test('«+ Crear cliente nuevo» lo crea (sin duplicar) y lo devuelve', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await page.fill('#ecl-buscar', '  Cliente   Nuevo ');
    await filasSelector(page).filter({ hasText: '+ Crear cliente nuevo' }).click();
    await expect(page.locator(SELECTOR)).toBeHidden();
    const nuevo = await resultado(page);
    expect(nuevo.nombre).toBe('Cliente Nuevo');                                          // espacios limpios
    expect(escritura(reg, 'POST', 'clientes_fiado').map(e => e.cuerpo.nombre)).toEqual(['Cliente Nuevo']);
    await expect(page.locator('.toast').last()).toContainText('Cliente "Cliente Nuevo" creado');
    expect(await page.evaluate(() => ST.clientesFiado.some(c => c.nombre === 'Cliente Nuevo'))).toBe(true);
  });

  test('«Volver» y Esc devuelven null (no se registra nada); un clic fuera de la ventana no la cierra', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await page.locator(SELECTOR).click({ position: { x: 4, y: 4 } });                   // clic fuera de la caja (sobre el fondo)
    await expect(page.locator(SELECTOR)).toBeVisible();
    expect(await resultado(page)).toBe('esperando');
    await page.locator('#ecl-volver').click();
    await expect(page.locator(SELECTOR)).toBeHidden();
    expect(await resultado(page)).toBeNull();
    await abrirSelector(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(SELECTOR)).toBeHidden();
    expect(await resultado(page)).toBeNull();
    expect(reg.escrituras).toEqual([]);
  });

  test('con el teclado: flechas + Enter eligen; Enter con una sola coincidencia la elige; Enter sin coincidencia clara no hace nada', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes() });
    await abrirSelector(page);
    await page.keyboard.press('Enter');                                                  // 13 clientes y ninguno resaltado: nada
    expect(await resultado(page)).toBe('esperando');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');                                              // el segundo: beatriz
    await page.keyboard.press('Enter');
    expect(await resultado(page)).toEqual({ id: 102, nombre: 'beatriz' });
    await abrirSelector(page);
    await page.fill('#ecl-buscar', 'karen');                                             // una sola coincidencia
    await page.keyboard.press('Enter');
    expect(await resultado(page)).toEqual({ id: 111, nombre: 'Karen' });
  });

  test('nombres con comillas y símbolos se ven tal cual (no se interpretan como código) y se pueden elegir', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes(['Pepe "El Rápido"', "O'Brien", '<b>Raro</b> & Co']) });
    await abrirSelector(page);
    expect(await nombresSelector(page)).toEqual(['<b>Raro</b> & Co', "O'Brien", 'Pepe "El Rápido"']);
    expect(await page.locator(`${SELECTOR} #ecl-lista b`).count()).toBe(0);
    await filasSelector(page).filter({ hasText: 'Pepe' }).click();
    expect(await resultado(page)).toEqual({ id: 100, nombre: 'Pepe "El Rápido"' });
    await abrirSelector(page);
    await filasSelector(page).filter({ hasText: "O'Brien" }).click();
    expect(await resultado(page)).toEqual({ id: 101, nombre: "O'Brien" });
  });

  test('sin clientes todavía: lo dice, y escribir un nombre permite crear el primero', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes([]) });
    await abrirSelector(page);
    await expect(page.locator('#ecl-lista')).toContainText('Todavía no hay clientes');
    await page.fill('#ecl-buscar', 'Primera');
    expect(await nombresSelector(page)).toEqual(['+ Crear cliente nuevo: "Primera"']);
  });

  test('si falla la creación del cliente: avisa, la ventana sigue abierta y no se devuelve nada', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConClientes() });
    await page.route('**/rest/v1/clientes_fiado*', ruta => ruta.request().method() === 'POST'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fallo de prueba"}' }) : ruta.fallback());
    await abrirSelector(page);
    await page.fill('#ecl-buscar', 'Cliente Nuevo');
    await filasSelector(page).filter({ hasText: '+ Crear cliente nuevo' }).click();
    await expect(page.locator('.toast').last()).toContainText('No se pudo crear el cliente');
    await expect(page.locator(SELECTOR)).toBeVisible();
    expect(await resultado(page)).toBe('esperando');
    await page.locator('#ecl-volver').click();
    expect(await resultado(page)).toBeNull();
    expect(await page.evaluate(() => ST.clientesFiado.some(c => c.nombre === 'Cliente Nuevo'))).toBe(false);
  });

  test('de punta a punta: «📒 Fiar» desde Pendientes abre el selector con la lista completa; «Volver» deja el pedido como estaba', async ({ page }) => {
    const nativos = vigilarNativos(page);
    const datos = datosConClientes();
    datos.pedidos.push({ ...copia(BASE.pedidos[0]), id: 903, estado: 'pendiente', metodo: 'pendiente', mesa: 3, monto_total: 9000, monto_unit: 9000, monto_almuerzo: 9000, grupo_pedido: 'g-mesa3' });
    datos.mesas = datos.mesas.map(m => m.numero === 3 ? { ...m, estado: 'ocupada' } : m);
    const reg = await abrirSistema(page, { datos });
    const mover = page.evaluate(async () => { cambioMesaIds = [903]; await moverPedidoAFiado(); });
    await expect(page.locator(SELECTOR)).toBeVisible();
    expect(await filasSelector(page).count()).toBe(NOMBRES_EN_DESORDEN.length);
    await expect(page.locator('#ecl-detalle')).toContainText('$9.000');
    await page.locator('#ecl-volver').click();
    await mover;
    expect(reg.escrituras).toEqual([]);                                                  // ni el pedido pasó a fiado, ni se liberó la mesa
    expect(await page.evaluate(() => ST.pendientes.find(p => p.id === 903))).toMatchObject({ mesa: 3, es_fiar: false });
    expect(nativos).toEqual([]);
  });
});

// ── 2) Pedidos → «Fiar»: el autocompletado muestra a todos, en orden alfabético ─────────────────────────────────────────────
test.describe('2) Pedidos → «Fiar»: lista completa en orden alfabético', () => {
  const listaPedidos = page => page.locator('#ac-cliente-fiado .autocomplete-item');
  const nombresPedidos = async page => (await listaPedidos(page).allInnerTexts()).map(s => s.split('\n')[0]);

  test('al hacer clic en el campo (vacío) salen TODOS los clientes, ordenados A–Z', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes() });
    await page.locator('#btn-fiar').click();
    await page.locator('#ing-cliente-fiado').click();
    await expect(page.locator('#ac-cliente-fiado')).toBeVisible();
    const nombres = await nombresPedidos(page);
    expect(nombres).toHaveLength(NOMBRES_EN_DESORDEN.length);                            // antes solo salían 8
    expect(nombres).toEqual(ordenEs(NOMBRES_EN_DESORDEN));
  });

  test('al escribir filtra (sin tildes ni mayúsculas) y sigue ofreciendo «+ Crear cliente nuevo» si no existe', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes() });
    await page.locator('#btn-fiar').click();
    await page.locator('#ing-cliente-fiado').fill('ivan');
    expect(await nombresPedidos(page)).toEqual(['Iván', '+ Crear cliente nuevo: "ivan"'].slice(0, 1));   // «ivan» ya existe como «Iván»
    await page.locator('#ing-cliente-fiado').fill('nuevo cli');
    expect(await nombresPedidos(page)).toEqual(['+ Crear cliente nuevo: "nuevo cli"']);
  });

  test('nombres con comillas dobles o símbolos se pueden elegir y se muestran como texto', async ({ page }) => {
    await abrirSistema(page, { datos: datosConClientes(['Pepe "El Rápido"', "O'Brien", '<b>Raro</b> & Co']) });
    await page.locator('#btn-fiar').click();
    await page.locator('#ing-cliente-fiado').click();
    expect(await nombresPedidos(page)).toEqual(['<b>Raro</b> & Co', "O'Brien", 'Pepe "El Rápido"']);
    expect(await page.locator('#ac-cliente-fiado b').count()).toBe(0);
    await listaPedidos(page).filter({ hasText: 'Pepe' }).dispatchEvent('mousedown');
    await expect(page.locator('#cliente-fiado-nombre')).toHaveText('Pepe "El Rápido"');
    expect(await page.evaluate(() => clienteFiadoSeleccionadoId)).toBe(100);
    await page.locator('#cliente-fiado-seleccionado button', { hasText: 'quitar' }).click();
    await page.locator('#ing-cliente-fiado').click();
    await listaPedidos(page).filter({ hasText: "O'Brien" }).dispatchEvent('mousedown');
    expect(await page.evaluate(() => clienteFiadoSeleccionadoId)).toBe(101);
  });

  test('crear un cliente nuevo desde el campo sigue funcionando (y con comillas en el nombre)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConClientes() });
    await page.locator('#btn-fiar').click();
    await page.locator('#ing-cliente-fiado').fill('Ana "La Nueva"');
    await listaPedidos(page).filter({ hasText: '+ Crear cliente nuevo' }).dispatchEvent('mousedown');
    await expect(page.locator('#cliente-fiado-nombre')).toHaveText('Ana "La Nueva"');
    expect(escritura(reg, 'POST', 'clientes_fiado').map(e => e.cuerpo.nombre)).toEqual(['Ana "La Nueva"']);
  });
});

// ── 3) Los «¿Seguro?»: ventana del sistema, nunca la del navegador ──────────────────────────────────────────────────────────
// Cada caso: se llama a la acción, sale la ventana con su título, «Volver» no escribe nada y «Sí…» sí.
const hoyIso = `${FECHA_HOY}T10:00:00-05:00`;
function datosSeguro() {
  const d = copia(BASE);
  d.clientes_fiado = [{ id: 1, nombre: 'Luisca', created_at: hoyIso }];
  d.abonos_fiado = [{ id: 90, cliente_fiado_id: 1, monto: 20000, fecha: FECHA_HOY, turno: 'almuerzo', cuenta: 'efectivo', created_at: hoyIso }];
  d.notas_dia = [{ id: 1, fecha: FECHA_HOY, texto: 'una nota', created_at: hoyIso }];
  d.ingresos_extra = [{ id: 1, fecha: FECHA_HOY, descripcion: 'extra', monto: 5000, cuenta: 'efectivo', created_at: hoyIso }];
  d.movimientos_caja = [{ id: 1, fecha: FECHA_HOY, tipo: 'gasto', cuenta: 'efectivo', descripcion: 'mov', monto: 1000, created_at: hoyIso }];
  d.pedidos.push({ ...copia(BASE.pedidos[0]), id: 950, estado: 'pendiente', metodo: 'fiado', es_fiar: true, cliente_fiado_id: 1, monto_total: 9000, monto_unit: 9000, monto_almuerzo: 9000, grupo_pedido: 'g-fiado-luisca' });
  return d;
}
const CASOS = [
  { nombre: 'eliminar un ingreso', llamada: 'eliminarGrupoIngreso([101])', titulo: '¿Eliminar este ingreso?', boton: 'Sí, eliminar', escribe: ['DELETE', 'pedidos'] },
  { nombre: 'cancelar un pedido pendiente', llamada: 'cancelarPendiente(203)', titulo: '¿Cancelar este pedido pendiente?', boton: 'Sí, cancelar el pedido', escribe: ['DELETE', 'pedidos'] },
  { nombre: 'cancelar un pedido completo', llamada: 'cancelarGrupoPendiente([203], 3)', titulo: '¿Cancelar este pedido completo (1 ítem)?', boton: 'Sí, cancelar el pedido', escribe: ['DELETE', 'pedidos'] },
  { nombre: 'eliminar un abono', llamada: 'eliminarAbonoFiado(90)', titulo: '¿Eliminar el abono de Luisca por $20.000', boton: 'Sí, eliminar el abono', escribe: ['DELETE', 'abonos_fiado'] },
  { nombre: 'aplicar el saldo a favor', llamada: 'aplicarSaldoAFavor(1)', titulo: 'Aplicar saldo a favor de Luisca: $20.000', boton: '✔ Aplicar saldo a favor', escribe: ['PATCH', 'pedidos'] },
  { nombre: 'eliminar una nota', llamada: 'eliminarNotaDia(1)', titulo: '¿Eliminar esta nota?', boton: 'Sí, eliminar', escribe: ['DELETE', 'notas_dia'] },
  { nombre: 'eliminar un egreso', llamada: 'eliminarEgreso(1)', titulo: '¿Eliminar este egreso?', boton: 'Sí, eliminar', escribe: ['DELETE', 'egresos'] },
  { nombre: 'eliminar un producto del inventario', llamada: 'eliminarProducto(1)', titulo: '¿Eliminar este producto?', boton: 'Sí, eliminar', escribe: ['DELETE', 'inventario'] },
  { nombre: 'eliminar un ingreso adicional', llamada: 'eliminarIngresoExtra(1)', titulo: '¿Eliminar este ingreso?', boton: 'Sí, eliminar', escribe: ['DELETE', 'ingresos_extra'] },
  { nombre: 'eliminar un cierre', llamada: `eliminarCierre('2026-10-05', 'almuerzo')`, titulo: '¿Eliminar el cierre del 2026-10-05 (almuerzo)?', boton: 'Sí, eliminar el cierre', escribe: ['DELETE', 'cierres_dia'] },
  { nombre: 'eliminar un movimiento de caja', llamada: 'eliminarMovimientoCaja(1)', titulo: '¿Eliminar este movimiento de caja?', boton: 'Sí, eliminar', escribe: ['DELETE', 'movimientos_caja'] },
];

test.describe('3) Los «¿Seguro?» salen en una ventana del sistema', () => {
  for (const c of CASOS) {
    test(`${c.nombre}: ventana del sistema; «Volver» no escribe nada y «${c.boton}» sí`, async ({ page }) => {
      const nativos = vigilarNativos(page);
      const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
      const ventana = page.locator(VENTANA);

      const primera = page.evaluate(c.llamada);
      await expect(ventana).toBeVisible();
      await expect(page.locator('#sis-titulo')).toContainText(c.titulo);
      await expect(ventana.locator('button[data-eleccion="no"]')).toHaveText('Volver');
      await ventana.locator('button[data-eleccion="no"]').click();
      await primera;
      await expect(ventana).toBeHidden();
      expect(reg.escrituras).toEqual([]);                                                // «Volver»: no se tocó nada

      const segunda = page.evaluate(c.llamada);
      await expect(ventana).toBeVisible();
      await expect(ventana.locator('button[data-eleccion="si"]')).toHaveText(c.boton);
      await ventana.locator('button[data-eleccion="si"]').click();
      await segunda;
      expect(escritura(reg, c.escribe[0], c.escribe[1]).length).toBeGreaterThan(0);
      expect(nativos).toEqual([]);
    });
  }

  test('Esc equivale a «Volver» y un clic fuera de la ventana no decide nada', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    const ventana = page.locator(VENTANA);
    const p = page.evaluate('eliminarEgreso(1)');
    await expect(ventana).toBeVisible();
    await ventana.click({ position: { x: 4, y: 4 } });
    await expect(ventana).toBeVisible();
    await page.keyboard.press('Escape');
    await p;
    await expect(ventana).toBeHidden();
    expect(reg.escrituras).toEqual([]);
  });

  test('en lo que borra, el foco queda en «Volver» (un Enter distraído no borra nada)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    const p = page.evaluate('eliminarEgreso(1)');
    await expect(page.locator(VENTANA)).toBeVisible();
    expect(await page.evaluate(() => document.activeElement.dataset.eleccion)).toBe('no');
    await page.keyboard.press('Enter');                                                  // Enter sobre el botón enfocado = «Volver»
    await p;
    expect(reg.escrituras).toEqual([]);
  });

  test('el título de una acción que borra va en rojo; el de una confirmación normal, no', async ({ page }) => {
    await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    const p = page.evaluate('eliminarEgreso(1)');
    await expect(page.locator(VENTANA)).toBeVisible();
    const rojo = await page.evaluate(() => document.getElementById('sis-titulo').style.color);
    expect(rojo).toBe('var(--red)');
    await page.keyboard.press('Escape');
    await p;
    const q = page.evaluate('aplicarSaldoAFavor(1)');                                    // no borra: se ve dorado
    await expect(page.locator(VENTANA)).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('sis-titulo').style.color)).toBe('var(--accent)');
    await page.keyboard.press('Escape');
    await q;
  });

  // ── Cuenta que quedaría en negativo: los 4 lugares que lo avisan DEBEN esperar la respuesta ────────────────────────────
  test('advertirSiQuedaNegativo: devuelve false con «Volver» y true con «Continuar de todas formas»', async ({ page }) => {
    await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    const ventana = page.locator(VENTANA);
    const a = page.evaluate(() => advertirSiQuedaNegativo({ cuentaNueva: 'efectivo', efectoNuevo: -999999999 }));
    await expect(ventana).toBeVisible();
    await expect(page.locator('#sis-titulo')).toContainText('quedaría en negativo');
    await expect(page.locator('#sis-cuerpo')).toContainText('quedará en');
    await ventana.locator('button[data-eleccion="no"]').click();
    expect(await a).toBe(false);
    const b = page.evaluate(() => advertirSiQuedaNegativo({ cuentaNueva: 'efectivo', efectoNuevo: -999999999 }));
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="si"]').click();
    expect(await b).toBe(true);
    expect(await page.evaluate(() => advertirSiQuedaNegativo({ cuentaNueva: 'efectivo', efectoNuevo: 5 }))).toBe(true);   // sin negativo: no pregunta
    await expect(ventana).toBeHidden();
  });

  test('registrar un egreso que deja la cuenta en negativo: «Volver» no lo guarda; «Continuar» sí', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    const llenar = () => page.evaluate(() => {
      document.getElementById('egr-fecha').value = today();
      document.getElementById('egr-cat').selectedIndex = 0;
      document.getElementById('egr-cuenta').selectedIndex = 0;
      document.getElementById('egr-monto').value = '999999999';
      document.getElementById('egr-desc').value = 'compra enorme';
    });
    const ventana = page.locator(VENTANA);
    await llenar();
    const a = page.evaluate(() => agregarEgreso());
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="no"]').click();
    await a;
    expect(escritura(reg, 'POST', 'egresos')).toHaveLength(0);
    const b = page.evaluate(() => agregarEgreso());
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="si"]').click();
    await b;
    expect(escritura(reg, 'POST', 'egresos')).toHaveLength(1);
  });

  test('guardar un movimiento de caja que deja la cuenta en negativo: «Volver» no lo guarda; «Continuar» sí', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    await page.evaluate(() => {
      tipoMovimientoCaja = 'gasto';
      document.getElementById('caja-mov-descripcion').value = 'retiro enorme';
      document.getElementById('caja-mov-monto').value = '999999999';
      document.getElementById('caja-mov-cuenta').selectedIndex = 0;
    });
    const ventana = page.locator(VENTANA);
    const a = page.evaluate(() => agregarMovimientoCaja());
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="no"]').click();
    await a;
    expect(escritura(reg, 'POST', 'movimientos_caja')).toHaveLength(0);
    const b = page.evaluate(() => agregarMovimientoCaja());
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="si"]').click();
    await b;
    expect(escritura(reg, 'POST', 'movimientos_caja')).toHaveLength(1);
  });

  test('sobrescribir un cierre manual que ya existe: pregunta en una ventana del sistema', async ({ page }) => {
    const nativos = vigilarNativos(page);
    const reg = await abrirSistema(page, { datos: datosSeguro(), usuario: 'admin' });
    await page.evaluate(() => {
      document.getElementById('cm-fecha').value = '2026-10-05';
      cierreManualTurno = 'almuerzo';
      cierreManualEditando = null;
      document.getElementById('cm-efectivo').value = '100000';
    });
    const ventana = page.locator(VENTANA);
    const a = page.evaluate(() => guardarCierreManual());
    await expect(ventana).toBeVisible();
    await expect(page.locator('#sis-titulo')).toContainText('Ya existe un cierre guardado para esa fecha/turno');
    await expect(page.locator('#sis-cuerpo')).toContainText('¿Sobrescribirlo con estos datos manuales?');
    await ventana.locator('button[data-eleccion="no"]').click();
    await a;
    expect(reg.escrituras).toEqual([]);
    const b = page.evaluate(() => guardarCierreManual());
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="si"]').click();
    await b;
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia').length).toBeGreaterThan(0);
    expect(nativos).toEqual([]);
  });
});

// ── 4) El generador del menú (pestaña Menú) también usa ventanas propias ───────────────────────────────────────────────────
test.describe('4) Generador del menú', () => {
  const URL_MENU = 'file://' + path.join(__dirname, '..', 'Menu', 'Menú diario-El Lobo.html');
  const abrirMenu = async page => { await page.goto(URL_MENU, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof avisoMenu === 'function' && !!document.getElementById('lista-sopas')); };

  test('«Generar» sin elegir nada avisa en una ventana propia (no la del navegador)', async ({ page }) => {
    const nativos = vigilarNativos(page);
    await abrirMenu(page);
    const p = page.evaluate(() => generarMenu());
    await expect(page.locator('#aviso-menu')).toBeVisible();
    await expect(page.locator('#aviso-menu-titulo')).toHaveText('Falta elegir algo');
    await expect(page.locator('#aviso-menu-cuerpo')).toHaveText('Selecciona al menos una sopa o proteína.');
    await expect(page.locator('#aviso-menu-botones button')).toHaveCount(1);             // solo un aviso: un botón
    await page.locator('#aviso-menu-botones button').click();
    await p;
    await expect(page.locator('#aviso-menu')).toBeHidden();
    expect(nativos).toEqual([]);
  });

  test('eliminar un plato: «Volver» y Esc no lo borran; «Sí, eliminar» sí', async ({ page }) => {
    const nativos = vigilarNativos(page);
    await abrirMenu(page);
    await page.evaluate(() => buildAdmin());                                             // la lista de administración se arma al abrir esa pestaña
    const total = () => page.evaluate(() => catalogo.sopas.length);
    const antes = await total();
    const nombre = await page.evaluate(() => catalogo.sopas[0]);
    const ventana = page.locator('#aviso-menu');

    const a = page.evaluate(() => eliminarPlato('sopas', 0));
    await expect(ventana).toBeVisible();
    await expect(page.locator('#aviso-menu-titulo')).toHaveText(`¿Eliminar "${nombre}"?`);
    await ventana.locator('button[data-eleccion="no"]').click();
    await a;
    expect(await total()).toBe(antes);

    const b = page.evaluate(() => eliminarPlato('sopas', 0));
    await expect(ventana).toBeVisible();
    await ventana.click({ position: { x: 4, y: 4 } });                                   // clic fuera: no decide nada
    await expect(ventana).toBeVisible();
    await page.keyboard.press('Escape');
    await b;
    expect(await total()).toBe(antes);

    const c = page.evaluate(() => eliminarPlato('sopas', 0));
    await expect(ventana).toBeVisible();
    await ventana.locator('button[data-eleccion="si"]').click();
    await c;
    expect(await total()).toBe(antes - 1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('elLobo_catalogo')).sopas.length)).toBe(antes - 1);   // y queda guardado
    expect(nativos).toEqual([]);
  });
});
