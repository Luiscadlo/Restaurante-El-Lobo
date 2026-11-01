// REVISIÓN FINAL — M1 y M2.
//
// M2: «sin rastro en Auditoría, no se borra nada». Antes, si el rastro no se podía guardar, el pedido se borraba igual y el aviso
//     era un cartelito que decía (a veces sin ser cierto) «falta crear la tabla». Ahora el rastro va ANTES de borrar, en una sola
//     petición con todas las filas del pedido, y si falla no se borra nada: sale una ventana que hay que cerrar.
// M1: borrar, devolver a pendiente o cambiar el método de pago de un pedido PAGADO cuyo turno YA tiene cierre guardado dejaba el
//     cierre (y con él el Tablero y la Caja) con plata de más o en la columna equivocada. Ahora el sistema pregunta y corrige el
//     cierre con la misma cuenta del pedido; si algo falla, deja el cierre como estaba.
//
// Cuentas a mano (turno de almuerzo de hoy, 20-oct-2026), ver tests/fixtures/datos.js:
//   101 efectivo 15.000 · 102 transferencia 16.000 · 103 dividido 12.000 ef + 8.000 tr · 104 efectivo 13.000 · 107 gratis (no ingresa)
//   efectivo = 15.000 + 12.000 + 13.000 + desayuno 30.000 = 70.000;  transferencia = 16.000 + 8.000 + desayuno 10.000 = 34.000
//   resultado del cierre de prueba = 70.000 + 34.000 − 0 = 104.000
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
const CIERRE_HOY = { id: 50, fecha: FECHA_HOY, turno: 'almuerzo', efectivo: 70000, transferencia: 34000, gastos: 0, resultado: 104000, ajuste_efectivo: 0, ajuste_transferencia: 0, manual: false, platos_familia: 0 };
const INTACTO = { efectivo: 70000, transferencia: 34000, resultado: 104000 };
const conCierre = (extra = {}) => { const d = copia(DATOS_BASE); d.cierres_dia.push({ ...CIERRE_HOY, ...extra }); return d; };

const ventana = page => page.locator('#modal-sistema');
const elegir = (page, valor) => page.locator(`#sis-opciones button[data-eleccion="${valor}"]`).click();
const opciones = page => page.locator('#sis-opciones button').evaluateAll(bs => bs.map(b => b.dataset.eleccion));
const escrituras = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const posicion = (reg, metodo, tabla, n = 0) => { const idx = reg.escrituras.map((e, i) => (e.metodo === metodo && e.tabla === tabla ? i : -1)).filter(i => i >= 0); return idx[n] ?? -1; };
const cierreHoy = page => page.evaluate(f => { const c = ST.cierresDia.find(x => x.fecha === f && x.turno === 'almuerzo'); return c ? { efectivo: c.efectivo, transferencia: c.transferencia, resultado: c.resultado } : null; }, FECHA_HOY);
const estaEn = (page, lista, id) => page.evaluate(([l, i]) => ST[l].some(p => p.id === i), [lista, id]);
const textoVentana = async page => (await page.locator('#sis-titulo').innerText()) + '\n' + (await page.locator('#sis-cuerpo').innerText());
// Solo las LECTURAS de «pedidos» con id=in (las que usa el sistema para comprobar qué quedó en la base).
const lecturaDePedidos = (page, responder) => page.route('**/rest/v1/pedidos?id=in.*', route => (route.request().method() === 'GET' ? responder(route) : route.fallback()));

// Lanza una acción que espera una respuesta del usuario, contesta con `eleccion` y espera a que termine.
async function accion(page, fn, arg, eleccion) {
  const fin = page.evaluate(fn, arg);
  await expect(ventana(page)).toBeVisible();
  await elegir(page, eleccion);
  await fin;
}
const confirmar = (page, fn, arg) => accion(page, fn, arg, 'si');         // el «¿Eliminar?» de siempre (valor 'si')
const cerrarAviso = async page => { await elegir(page, 'entendido'); await expect(ventana(page)).toBeHidden(); };
async function esperarAviso(page, titulo) {
  await expect(ventana(page)).toBeVisible();
  expect(await opciones(page)).toEqual(['entendido']);                    // un aviso: un único botón
  const txt = await textoVentana(page);
  if (titulo) expect(txt).toContain(titulo);
  return txt;
}

// ═══════════════════════════════ M2 — sin rastro no se borra ═══════════════════════════════
test.describe('M2 — el rastro en Auditoría va primero; si falla, no se borra nada', () => {
  test('eliminar un pagado: el rastro se guarda ANTES de borrar y en una sola petición', async ({ page }) => {
    const reg = await abrirSistema(page);
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')).toHaveLength(1);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(posicion(reg, 'POST', 'pedidos_eliminados')).toBeLessThan(posicion(reg, 'DELETE', 'pedidos'));
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
    expect(reg.denegadas).toEqual([]);
    await expect(ventana(page)).toBeHidden();
  });

  test('eliminar con el rastro caído: NO se borra, el pedido sigue y sale una ventana; al reintentar se borra y el rastro queda una sola vez', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos_eliminados', metodo: 'POST', tipo: 'red' });
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    const txt = await esperarAviso(page, 'No se eliminó nada');
    expect(txt).toContain('Auditoría');
    expect(txt).not.toContain('falta crear la tabla');          // el mensaje viejo era engañoso
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    await cerrarAviso(page);
    await confirmar(page, () => eliminarGrupoIngreso([101]));  // reintento
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')).toHaveLength(1);
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
  });

  test('un pedido de varios ítems: el rastro de TODOS viaja en UNA petición (o todos o ninguno)', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.pedidos.push(
      { ...datos.pedidos.find(p => p.id === 101), id: 301, grupo_pedido: 'g-301' },
      { ...datos.pedidos.find(p => p.id === 101), id: 302, grupo_pedido: 'g-301', pedido: 'extra', detalle: 'Gaseosa', monto_total: 3000, monto_almuerzo: 3000 });
    const reg = await abrirSistema(page, { datos });
    await confirmar(page, () => eliminarGrupoIngreso([301, 302]));
    expect(reg.lotes.filter(l => l.tabla === 'pedidos_eliminados')).toEqual([{ tabla: 'pedidos_eliminados', filas: 2, rol: 'caja' }]);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(escrituras(reg, 'DELETE', 'pedidos')[0].consulta).toContain('301');
    expect(escrituras(reg, 'DELETE', 'pedidos')[0].consulta).toContain('302');
  });

  test('el rastro sale bien y el BORRADO falla: el pedido sigue, se avisa, y al reintentar el rastro NO se duplica', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    await esperarAviso(page, 'No se pudo eliminar el pedido');
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    await cerrarAviso(page);
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')).toHaveLength(1);   // el rastro del primer intento sirve; no se repite
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
  });

  test('RESPUESTA PERDIDA al borrar (el servidor sí borró): se comprueba en la base y NO se dice que falló', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'perdida' });
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    await expect(ventana(page)).toBeHidden();
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
    await expect(page.locator('.toast', { hasText: 'Ingreso eliminado' })).toBeVisible();
  });

  test('no se puede ni comprobar si el borrado llegó: «Revisa antes de repetir», y el cierre NO se restaura a ciegas', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await lecturaDePedidos(page, route => route.abort('failed'));
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    await esperarAviso(page, 'Revisa antes de repetir');
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });   // no se sabe si el pedido se borró: no se toca más
  });

  test('cancelar un pendiente con el rastro caído: NO se cancela, la mesa sigue ocupada, sale la ventana', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos_eliminados', metodo: 'POST', tipo: 'servidor' });
    await confirmar(page, () => cancelarPendiente(203));
    const txt = await esperarAviso(page, 'No se canceló nada');
    expect(txt).not.toContain('falta la columna motivo');
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(escrituras(reg, 'PATCH', 'mesas')).toHaveLength(0);
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    await cerrarAviso(page);
    await confirmar(page, () => cancelarPendiente(203));       // reintento
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(escrituras(reg, 'PATCH', 'mesas')).toHaveLength(1);
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')[0].cuerpo[0].motivo).toBe('cancelado');
    expect(await estaEn(page, 'pendientes', 203)).toBe(false);
  });

  test('cancelar un pedido completo (2 ítems) con el rastro caído: no se cancela ninguno; al reintentar, UNA petición de rastro con los 2', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    const base = datos.pedidos.find(p => p.id === 203);
    datos.pedidos.push({ ...base, id: 303, pedido: 'extra', detalle: 'Jugo' });
    const reg = await abrirSistema(page, { datos });
    reg.control.fallasEscritura.push({ tabla: 'pedidos_eliminados', metodo: 'POST', tipo: 'red' });
    await confirmar(page, () => cancelarGrupoPendiente([203, 303], 3));
    await esperarAviso(page, 'No se canceló nada');
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    expect(await estaEn(page, 'pendientes', 303)).toBe(true);
    await cerrarAviso(page);
    await confirmar(page, () => cancelarGrupoPendiente([203, 303], 3));
    expect(reg.lotes.filter(l => l.tabla === 'pedidos_eliminados')).toEqual([{ tabla: 'pedidos_eliminados', filas: 2, rol: 'caja' }]);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(await estaEn(page, 'pendientes', 203)).toBe(false);
    expect(await estaEn(page, 'pendientes', 303)).toBe(false);
  });

  test('cancelar: el pedido se cancela pero la mesa no se pudo liberar → se avisa (el pedido ya no existe), sin decir «error al cancelar»', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'mesas', metodo: 'PATCH', tipo: 'red' });
    await confirmar(page, () => cancelarPendiente(203));
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(await estaEn(page, 'pendientes', 203)).toBe(false);
    await expect(page.locator('.toast', { hasText: 'no se pudo marcar como libre' })).toBeVisible();
    await expect(page.locator('.toast', { hasText: 'Error al cancelar' })).toHaveCount(0);
  });

  test('cancelar y el BORRADO falla: el pedido SIGUE en Pendientes, la mesa SIGUE ocupada y se avisa (sin liberar nada)', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await confirmar(page, () => cancelarPendiente(203));
    await esperarAviso(page, 'No se pudo cancelar el pedido');
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    expect(escrituras(reg, 'PATCH', 'mesas')).toHaveLength(0);
    expect(await page.evaluate(() => ST.mesas.find(m => m.numero === 3).estado)).toBe('ocupada');
    await expect(page.locator('.toast', { hasText: 'Pedido cancelado' })).toHaveCount(0);
  });

  test('cancelar un pedido completo y el BORRADO falla: ningún ítem sale de Pendientes y la mesa SIGUE ocupada', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    const base = datos.pedidos.find(p => p.id === 203);
    datos.pedidos.push({ ...base, id: 303, pedido: 'extra', detalle: 'Jugo' });
    const reg = await abrirSistema(page, { datos });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await confirmar(page, () => cancelarGrupoPendiente([203, 303], 3));
    await esperarAviso(page, 'No se pudo cancelar el pedido');
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    expect(await estaEn(page, 'pendientes', 303)).toBe(true);
    expect(escrituras(reg, 'PATCH', 'mesas')).toHaveLength(0);
    expect(await page.evaluate(() => ST.mesas.find(m => m.numero === 3).estado)).toBe('ocupada');
  });

  test('cancelar sin poder ni comprobar si el borrado llegó: «Revisa antes de repetir» y la mesa NO se libera a ciegas', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await lecturaDePedidos(page, route => route.abort('failed'));
    await confirmar(page, () => cancelarPendiente(203));
    await esperarAviso(page, 'Revisa antes de repetir');
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    expect(escrituras(reg, 'PATCH', 'mesas')).toHaveLength(0);
    expect(await page.evaluate(() => ST.mesas.find(m => m.numero === 3).estado)).toBe('ocupada');
  });

  test('administrador: el rastro que devuelve la base se ve enseguida en Auditoría (una fila por pedido)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    const antes = await page.evaluate(() => ST.pedidosEliminados.length);
    await confirmar(page, () => eliminarGrupoIngreso([101]));
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')[0].prefer).toBe('return=representation');
    expect(await page.evaluate(() => ST.pedidosEliminados.length)).toBe(antes + 1);
    expect(await page.evaluate(() => ST.pedidosEliminados[0].motivo)).toBe('eliminado');
  });

  test('descuento aplicado pero sin poder anotarlo en Auditoría: ventana clara con los datos para anotarlo, no un aviso que se va solo', async ({ page }) => {
    const reg = await abrirSistema(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos_descuentos', metodo: 'POST', tipo: 'red' });
    await page.evaluate(() => abrirModalDescuento([101]));
    await page.evaluate(() => {
      document.getElementById('descuento-modal-valor').value = '1.000';
      document.getElementById('descuento-modal-motivo').value = 'Cortesía (prueba)';
    });
    await page.evaluate(() => aplicarDescuentoGrupo());
    const txt = await esperarAviso(page, 'El descuento se aplicó, pero falta anotarlo');
    expect(txt).toContain('Cortesía (prueba)');
    expect(txt).not.toContain('falta crear la tabla');
    expect(escrituras(reg, 'PATCH', 'pedidos').length).toBeGreaterThan(0);   // el descuento SÍ quedó aplicado
  });
});

// ═══════════════════════════════ M1 — el cierre guardado del turno ═══════════════════════════════
test.describe('M1 — eliminar un pagado de un turno ya cerrado', () => {
  test('pregunta, y con «corregir el cierre» le quita el pedido al cierre (efectivo −15.000), en este orden: cierre → rastro → borrado', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    const fin = page.evaluate(() => eliminarGrupoIngreso([101]));
    await expect(ventana(page)).toBeVisible();
    expect(await opciones(page)).toEqual(['no', 'si', 'sin']);
    const txt = await textoVentana(page);
    expect(txt).toContain('Su turno ya está cerrado');
    expect(txt).toContain('efectivo $70.000 → $55.000');
    expect(txt).toContain('resultado $104.000 → $89.000');
    await elegir(page, 'si');
    await fin;
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    const patchCierre = escrituras(reg, 'PATCH', 'cierres_dia');
    expect(patchCierre).toHaveLength(1);
    expect(patchCierre[0].cuerpo).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    expect(patchCierre[0].consulta).toContain(`fecha=eq.${FECHA_HOY}`);
    expect(patchCierre[0].consulta).toContain('turno=eq.almuerzo');
    expect(posicion(reg, 'PATCH', 'cierres_dia')).toBeLessThan(posicion(reg, 'POST', 'pedidos_eliminados'));
    expect(posicion(reg, 'POST', 'pedidos_eliminados')).toBeLessThan(posicion(reg, 'DELETE', 'pedidos'));
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
    expect(reg.denegadas).toEqual([]);
    await expect(page.locator('.toast', { hasText: 'el cierre del turno se corrigió' })).toBeVisible();
  });

  test('una transferencia sale de la columna de transferencia; un pago dividido, de las dos', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await accion(page, () => eliminarGrupoIngreso([102]), null, 'si');
    expect(await cierreHoy(page)).toEqual({ efectivo: 70000, transferencia: 18000, resultado: 88000 });
    await accion(page, () => eliminarGrupoIngreso([103]), null, 'si');
    expect(await cierreHoy(page)).toEqual({ efectivo: 58000, transferencia: 10000, resultado: 68000 });
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(2);
  });

  test('varios ítems del mismo pedido: UN solo ajuste con la suma', async ({ page }) => {
    const datos = conCierre();
    datos.pedidos.push(
      { ...datos.pedidos.find(p => p.id === 101), id: 301, grupo_pedido: 'g-301' },
      { ...datos.pedidos.find(p => p.id === 101), id: 302, grupo_pedido: 'g-301', pedido: 'extra', monto_total: 3000, monto_almuerzo: 3000 });
    const reg = await abrirSistema(page, { datos });
    await accion(page, () => eliminarGrupoIngreso([301, 302]), null, 'si');
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
    expect(await cierreHoy(page)).toEqual({ efectivo: 52000, transferencia: 34000, resultado: 86000 });
  });

  test('«Eliminar sin tocar el cierre»: borra el pedido y deja el cierre exactamente como estaba', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'sin');
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await cierreHoy(page)).toEqual(INTACTO);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
  });

  test('«Volver»: no se escribe NADA (ni cierre, ni rastro, ni borrado) y el pedido sigue', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'no');
    expect(reg.escrituras).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('Esc equivale a «Volver»', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    const fin = page.evaluate(() => eliminarGrupoIngreso([101]));
    await expect(ventana(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await fin;
    expect(reg.escrituras).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
  });

  test('un pedido «Gratis» (no ingresa) o de un turno SIN cierre guardado: solo el «¿Eliminar?» de siempre, sin tocar ningún cierre', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await confirmar(page, () => eliminarGrupoIngreso([107]));         // gratis del turno cerrado
    await confirmar(page, () => eliminarGrupoIngreso([105]));         // cena: ese turno no tiene cierre
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(2);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('cierre cargado a mano: se avisa que lo es y, si se acepta, también se corrige', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre({ manual: true }) });
    const fin = page.evaluate(() => eliminarGrupoIngreso([101]));
    await expect(ventana(page)).toBeVisible();
    expect(await textoVentana(page)).toContain('cierre cargado a mano');
    await elegir(page, 'si');
    await fin;
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
  });

  test('no se pudo corregir el cierre: NO se borra nada, ni siquiera se anota el rastro; sale la ventana', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'cierres_dia', metodo: 'PATCH', tipo: 'servidor' });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    await esperarAviso(page, 'No se eliminó nada');
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')).toHaveLength(0);
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('el cierre se corrigió pero el rastro falló: el cierre VUELVE a como estaba y no se borra nada', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos_eliminados', metodo: 'POST', tipo: 'red' });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    await esperarAviso(page, 'No se eliminó nada');
    expect(escrituras(reg, 'PATCH', 'cierres_dia').map(e => e.cuerpo.efectivo)).toEqual([55000, 70000]);   // lo corrige y lo devuelve
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('el cierre y el rastro salieron bien pero el borrado falló: el cierre VUELVE a como estaba y el pedido sigue', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    await esperarAviso(page, 'No se pudo eliminar el pedido');
    expect(escrituras(reg, 'PATCH', 'cierres_dia').map(e => e.cuerpo.efectivo)).toEqual([55000, 70000]);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('el borrado llegó aunque la respuesta se perdió: el cierre se QUEDA corregido (no se restaura)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'perdida' });
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    await expect(ventana(page)).toBeHidden();
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
  });

  test('doble fallo (el borrado falla Y no se puede restaurar el cierre): la ventana dice con cifras cómo debe quedar el cierre', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'DELETE', tipo: 'red' });
    reg.control.fallasEscritura.push({ tabla: 'cierres_dia', metodo: 'PATCH', tipo: 'red', saltar: 1 });   // el 1.º PATCH (corregir) pasa; el 2.º (restaurar) falla
    await accion(page, () => eliminarGrupoIngreso([101]), null, 'si');
    const txt = await esperarAviso(page, 'No se pudo eliminar el pedido');
    expect(txt).toContain('debe decir efectivo $70.000, transferencia $34.000 y resultado $104.000');
    expect(txt).toContain('⚠ OJO: el cierre de almuerzo del');                       // la advertencia empieza claro, no solo con las cifras
    expect(txt).toContain('Avisa al administrador para corregirlo');
  });

  test('CANDADO del servidor: caja no puede tocar el cierre de un día anterior → no se borra nada y se explica', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.pedidos.push({ ...datos.pedidos.find(p => p.id === 101), id: 310, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00', grupo_pedido: 'g-310' });
    const reg = await abrirSistema(page, { datos });                      // el cierre 2 de la fixture es del 18-oct, almuerzo
    await accion(page, () => eliminarGrupoIngreso([310]), null, 'si');
    await esperarAviso(page, 'No se eliminó nada');
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(0);
    expect(escrituras(reg, 'POST', 'pedidos_eliminados')).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 310)).toBe(true);
    expect(reg.denegadas.some(d => d.includes('candado'))).toBe(true);
  });

  test('administrador: sí puede corregir el cierre de un día anterior', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.pedidos.push({ ...datos.pedidos.find(p => p.id === 101), id: 310, fecha: '2026-10-18', created_at: '2026-10-18T12:00:00-05:00', grupo_pedido: 'g-310' });
    const reg = await abrirSistema(page, { datos, usuario: 'admin' });
    await accion(page, () => eliminarGrupoIngreso([310]), null, 'si');
    const c = await page.evaluate(() => { const x = ST.cierresDia.find(k => k.fecha === '2026-10-18'); return { efectivo: x.efectivo, resultado: x.resultado }; });
    expect(c).toEqual({ efectivo: 405000, resultado: 475000 });
    expect(escrituras(reg, 'DELETE', 'pedidos')).toHaveLength(1);
  });
});

test.describe('M1 — devolver un pago a pendiente (↩) en un turno ya cerrado', () => {
  test('pregunta; con «corregir el cierre» le quita el pedido al cierre y lo devuelve a pendiente', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    const fin = page.evaluate(() => revertirPago([101]));
    await expect(ventana(page)).toBeVisible();
    expect(await textoVentana(page)).toContain('¿Devolver este pago a pendiente?');
    await elegir(page, 'si');
    await fin;
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    expect(posicion(reg, 'PATCH', 'cierres_dia')).toBeLessThan(posicion(reg, 'PATCH', 'pedidos'));
    expect(await estaEn(page, 'pendientes', 101)).toBe(true);
    expect(await estaEn(page, 'ingresos', 101)).toBe(false);
  });

  test('«Volver» no hace nada; «Devolver sin tocar el cierre» devuelve el pago y deja el cierre igual', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await accion(page, () => revertirPago([102]), null, 'no');
    expect(reg.escrituras).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 102)).toBe(true);
    await accion(page, () => revertirPago([102]), null, 'sin');
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await estaEn(page, 'pendientes', 102)).toBe(true);
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('turno abierto (sin cierre): el ↩ «Deshacer» sigue siendo inmediato, sin preguntas', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => revertirPago([101]));
    await expect(ventana(page)).toBeHidden();
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await estaEn(page, 'pendientes', 101)).toBe(true);
  });

  test('un fiado saldado con abonos aporta $0 al cierre de su día: no se pregunta nada', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.cierres_dia.push({ ...CIERRE_HOY, id: 51, fecha: '2026-10-12' });
    const reg = await abrirSistema(page, { datos, usuario: 'admin' });
    await page.evaluate(() => revertirPago([106]));
    await expect(ventana(page)).toBeHidden();
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await estaEn(page, 'pendientes', 106)).toBe(true);
  });

  test('no se pudo corregir el cierre: el pago NO se devuelve y la ventana lo dice', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'cierres_dia', metodo: 'PATCH', tipo: 'red' });
    await accion(page, () => revertirPago([101]), null, 'si');
    await esperarAviso(page, 'No se devolvió el pago');
    expect(escrituras(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
  });

  test('el cierre se corrigió pero la devolución falló: el cierre VUELVE a como estaba', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'red' });
    await accion(page, () => revertirPago([101]), null, 'si');
    await esperarAviso(page, 'No se devolvió el pago');
    expect(escrituras(reg, 'PATCH', 'cierres_dia').map(e => e.cuerpo.efectivo)).toEqual([55000, 70000]);
    expect(await cierreHoy(page)).toEqual(INTACTO);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
  });

  test('dos pedidos: se devuelve el 1.º y falla el 2.º → el cierre queda restado SOLO del 1.º y se avisa que fue «en parte»', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'red', saltar: 1 });   // el PATCH del 101 pasa; el del 102 falla
    // La comprobación en la base ve al 101 ya devuelto y al 102 todavía pagado.
    await lecturaDePedidos(page, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ id: 101, estado: 'pendiente' }, { id: 102, estado: 'pagado' }]) }));
    await accion(page, () => revertirPago([101, 102]), null, 'si');
    await esperarAviso(page, 'solo en parte');
    // Al corregir quitó 15.000 (efectivo) + 16.000 (transferencia); al fallar el 102 le devolvió sus 16.000.
    expect(escrituras(reg, 'PATCH', 'cierres_dia').map(e => [e.cuerpo.efectivo, e.cuerpo.transferencia])).toEqual([[55000, 18000], [55000, 34000]]);
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
  });
});

test.describe('M1 — cambiar el método de pago de un pagado en un turno ya cerrado', () => {
  // Abre la edición del método desde la pantalla de Ingresos, elige el nuevo y guarda (contestando la pregunta si sale).
  async function cambiarMetodo(page, id, metodo, eleccion) {
    await page.evaluate(i => { showTab('ingresos', document.querySelector(`.tab[onclick*="showTab('ingresos'"]`)); editarMetodoIngreso([i]); }, id);
    await expect(page.locator(`#metodo-edit-${id}`)).toBeVisible();
    await page.locator(`#metodo-edit-${id}`).selectOption(metodo);
    const fin = page.evaluate(i => guardarMetodoIngreso([i]), id);
    if (eleccion) { await expect(ventana(page)).toBeVisible(); await elegir(page, eleccion); }
    await fin;
  }

  test('efectivo → transferencia: el pedido pasa de columna dentro del cierre (el resultado no cambia)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await cambiarMetodo(page, 101, 'transferencia', 'si');
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 49000, resultado: 104000 });
    expect(posicion(reg, 'PATCH', 'cierres_dia')).toBeLessThan(posicion(reg, 'PATCH', 'pedidos'));
    expect(escrituras(reg, 'PATCH', 'pedidos')[0].cuerpo).toEqual({ metodo: 'transferencia' });
    expect(await page.evaluate(() => ST.ingresos.find(p => p.id === 101).metodo)).toBe('transferencia');
  });

  test('«Volver» no cambia nada; «Cambiar sin tocar el cierre» cambia el método y deja el cierre igual', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await cambiarMetodo(page, 101, 'transferencia', 'no');
    expect(reg.escrituras).toHaveLength(0);
    expect(await page.evaluate(() => ST.ingresos.find(p => p.id === 101).metodo)).toBe('efectivo');
    await cambiarMetodo(page, 101, 'transferencia', 'sin');
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await page.evaluate(() => ST.ingresos.find(p => p.id === 101).metodo)).toBe('transferencia');
    expect(await cierreHoy(page)).toEqual(INTACTO);
  });

  test('turno sin cierre guardado: se guarda directo, sin preguntas', async ({ page }) => {
    const reg = await abrirSistema(page);
    await cambiarMetodo(page, 101, 'transferencia', null);
    await expect(ventana(page)).toBeHidden();
    expect(escrituras(reg, 'PATCH', 'pedidos')).toHaveLength(1);
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
  });

  test('el cambio no se pudo guardar: el cierre VUELVE a como estaba y el método no cambia', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'red' });
    await cambiarMetodo(page, 101, 'transferencia', 'si');
    await esperarAviso(page, 'No se cambió el método de pago');
    expect(escrituras(reg, 'PATCH', 'cierres_dia').map(e => [e.cuerpo.efectivo, e.cuerpo.transferencia])).toEqual([[55000, 49000], [70000, 34000]]);
    expect(await cierreHoy(page)).toEqual(INTACTO);
    expect(await page.evaluate(() => ST.ingresos.find(p => p.id === 101).metodo)).toBe('efectivo');
  });
});

// ═══════════ M1 (seguimiento) — devolver a pendiente y VOLVER A COBRAR en un turno ya cerrado ═══════════
// El cierre se corrigió al devolver el pedido a pendiente; al cobrarlo otra vez, el cierre debe poder sumarlo de nuevo (antes
// quedaba fuera para siempre salvo que se reabriera el cierre a mano).
test.describe('M1 — volver a cobrar un pedido cuyo turno ya tiene cierre guardado', () => {
  async function devolver101(page) {
    await accion(page, () => revertirPago([101]), null, 'si');
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
    expect(await estaEn(page, 'pendientes', 101)).toBe(true);
  }
  const cobrar = (page, eleccion) => accion(page, () => marcarPedidoIndividualPagado(101, 'k101'), null, eleccion);

  test('al devolver, la ventana avisa que el cierre queda cerrado y que al cobrar de nuevo se preguntará', async ({ page }) => {
    await abrirSistema(page, { datos: conCierre() });
    const fin = page.evaluate(() => revertirPago([101]));
    await expect(ventana(page)).toBeVisible();
    expect(await textoVentana(page)).toContain('Cuando vuelvas a cobrar el pedido, el sistema te preguntará si lo sumas otra vez al cierre');
    await elegir(page, 'no');
    await fin;
  });

  test('cobrar de nuevo → pregunta → «Sí, sumarlo al cierre» deja el cierre otra vez en 70.000 / 104.000', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await devolver101(page);
    const fin = page.evaluate(() => marcarPedidoIndividualPagado(101, 'k101'));
    await expect(ventana(page)).toBeVisible();
    expect(await textoVentana(page)).toContain('Este pago no está en el cierre del turno');
    expect(await opciones(page)).toEqual(['si', 'no']);
    await elegir(page, 'si');
    await fin;
    expect(await cierreHoy(page)).toEqual(INTACTO);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(2);       // una al devolver, otra al volver a cobrar
  });

  test('«No tocar el cierre»: el pedido queda pagado y el cierre no se escribe', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await devolver101(page);
    await cobrar(page, 'no');
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
  });

  test('si el cierre no se puede actualizar: el pedido SIGUE pagado, el cierre queda como estaba y sale un aviso', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: conCierre() });
    await devolver101(page);
    reg.control.fallasEscritura.push({ tabla: 'cierres_dia', metodo: 'PATCH', tipo: 'servidor' });
    await cobrar(page, 'si');
    await esperarAviso(page, 'El cierre no se actualizó');
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
    expect(await cierreHoy(page)).toEqual({ efectivo: 55000, transferencia: 34000, resultado: 89000 });
  });

  test('turno SIN cierre guardado: cobrar es inmediato, sin preguntas ni cierres tocados', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => revertirPago([101]));
    await page.evaluate(() => marcarPedidoIndividualPagado(101, 'k101'));
    await expect(ventana(page)).toBeHidden();
    expect(escrituras(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await estaEn(page, 'ingresos', 101)).toBe(true);
  });
});
