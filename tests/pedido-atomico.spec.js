// REVISIÓN FINAL — arreglo D: «un pedido de varios ítems no se puede duplicar al reintentar».
//
// Antes: cada ítem se guardaba en su propia petición. Si la señal se cortaba a la mitad, los ítems ya guardados quedaban en la base
// y el formulario conservaba TODA la cola, así que al volver a pulsar «Registrar» se guardaban otra vez (pedido duplicado). Lo mismo
// pasaba con un doble toque con señal lenta, y con una respuesta perdida (se guardó, pero el celular nunca se enteró).
// Ahora: todas las filas del pedido viajan juntas en UNA petición (o se guarda todo o nada), un segundo toque mientras se guarda no
// hace nada, y si el intento anterior falló sin saberse si llegó a guardarse, el siguiente lo comprueba en la base antes de insertar.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');

const almuerzo = (extra = {}) => ({ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false, ...extra });
const extraProducto = (extra = {}) => ({ descripcion: 'Botella de agua', cantidad: 1, valorUnitario: 2000, ...extra });

// Deja el formulario como lo dejaría el cajero: ubicación elegida + cola armada.
async function armar(page, { items = [almuerzo(), almuerzo({ detalle: 'sin ensalada' }), almuerzo({ detalle: 'para llevar' })], extras = [], ubicacion = 'sinmesa', descuento = 0, motivo = '' } = {}) {
  await page.evaluate(({ items, extras, ubicacion, descuento, motivo }) => {
    turnoManual = 'almuerzo';
    document.getElementById('ing-fecha').value = '2026-10-20';
    document.getElementById('ing-hora').value = '13:15';
    seleccionarUbicacion(ubicacion);
    almuerzosEnCola = items;
    extrasIngresoPendientes = extras;
    if (descuento) {
      document.getElementById('ing-descuento').value = String(descuento);
      document.getElementById('ing-descuento-motivo').value = motivo;
    }
  }, { items, extras, ubicacion, descuento, motivo });
}
const registrar = (page, estado = 'pagado') => page.evaluate(e => agregarIngreso(e), estado);
const filasPost = reg => reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'POST');
const colas = page => page.evaluate(() => ({ almuerzos: almuerzosEnCola.length, extras: extrasIngresoPendientes.length }));
const avisos = page => page.locator('.toast');

test.describe('un pedido se guarda completo o no se guarda', () => {
  test('tres almuerzos viajan en UNA sola petición, todos con el mismo grupo', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page);
    await registrar(page);
    expect(reg.lotes.filter(l => l.tabla === 'pedidos')).toEqual([{ tabla: 'pedidos', filas: 3, rol: 'caja' }]);
    const filas = filasPost(reg);
    expect(filas).toHaveLength(3);
    expect(new Set(filas.map(f => f.cuerpo.grupo_pedido)).size).toBe(1);
    expect(filas.every(f => f.cuerpo.estado === 'pagado' && f.cuerpo.metodo === 'efectivo')).toBe(true);
    expect(await colas(page)).toEqual({ almuerzos: 0, extras: 0 });          // formulario limpio
    expect(reg.denegadas).toEqual([]);
  });

  test('almuerzos + productos extra también viajan en una sola petición (el extra ya no puede quedar «a medias»)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], extras: [extraProducto(), extraProducto({ descripcion: 'Gaseosa', valorUnitario: 3000 })] });
    await registrar(page);
    expect(reg.lotes.filter(l => l.tabla === 'pedidos')).toEqual([{ tabla: 'pedidos', filas: 4, rol: 'caja' }]);
    const filas = filasPost(reg).map(f => f.cuerpo);
    expect(filas.map(f => f.pedido)).toEqual(['Completo', 'Completo', 'extra', 'extra']);
    expect(filas.slice(2).map(f => f.detalle)).toEqual(['Botella de agua', 'Gaseosa']);
    expect(new Set(filas.map(f => f.grupo_pedido)).size).toBe(1);
    // Las filas quedan en la pantalla (ingresos), una sola vez cada una.
    expect(await page.evaluate(g => ST.ingresos.filter(p => p.grupo_pedido === g).length, filas[0].grupo_pedido)).toBe(4);
  });

  test('la señal se corta: NO se guarda nada, la cola queda intacta, se avisa; al reintentar se guarda una sola vez', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { extras: [extraProducto()] });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'red' });
    await registrar(page);
    expect(filasPost(reg)).toHaveLength(0);                                    // nada quedó a medias
    expect(await colas(page)).toEqual({ almuerzos: 3, extras: 1 });            // el cajero no pierde lo que había armado
    await expect(avisos(page).filter({ hasText: 'No se pudo registrar el pedido' })).toBeVisible();
    await registrar(page);                                                     // reintento
    expect(filasPost(reg)).toHaveLength(4);                                    // 3 almuerzos + 1 extra, UNA vez
    expect(await colas(page)).toEqual({ almuerzos: 0, extras: 0 });
  });

  test('el servidor responde error 500: tampoco se guarda nada a medias', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { extras: [extraProducto()] });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'servidor' });
    await registrar(page);
    expect(filasPost(reg)).toHaveLength(0);
    expect(await colas(page)).toEqual({ almuerzos: 3, extras: 1 });
  });

  test('RESPUESTA PERDIDA (se guardó, pero el celular nunca se enteró): al reintentar NO se duplica', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'perdida' });
    const antes = await page.evaluate(() => ST.ingresos.length);
    await registrar(page);
    expect(filasPost(reg)).toHaveLength(3);                                    // el servidor SÍ las guardó
    expect(await colas(page)).toEqual({ almuerzos: 3, extras: 0 });            // la pantalla cree que falló
    expect(await page.evaluate(() => ST.ingresos.length)).toBe(antes);
    await registrar(page);                                                     // el cajero vuelve a pulsar
    expect(filasPost(reg)).toHaveLength(3);                                    // NO se mandó nada más
    expect(await colas(page)).toEqual({ almuerzos: 0, extras: 0 });
    await expect(avisos(page).filter({ hasText: 'ya estaba guardado' })).toBeVisible();
    const grupo = filasPost(reg)[0].cuerpo.grupo_pedido;
    expect(await page.evaluate(g => ST.ingresos.filter(p => p.grupo_pedido === g).length, grupo)).toBe(3);   // en pantalla, una vez cada una
  });

  test('respuesta perdida y el cajero registra OTRO pedido distinto: ese sí se guarda (no se confunde con el anterior)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo()] });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'perdida' });
    await registrar(page);
    const grupoViejo = await page.evaluate(() => intentoPedidoEnCurso.grupoPedido);
    await armar(page, { items: [almuerzo({ pedido: 'Seco', monto_unit: 12000, monto_almuerzo: 12000 })] });   // otro pedido
    await registrar(page);
    const filas = filasPost(reg);
    expect(filas).toHaveLength(2);
    expect(filas[1].cuerpo.pedido).toBe('Seco');
    expect(filas[1].cuerpo.grupo_pedido).not.toBe(grupoViejo);
  });

  test('un segundo toque mientras el primero sigue guardando no registra nada más', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page);
    await page.evaluate(async () => { const a = agregarIngreso('pagado'); const b = agregarIngreso('pagado'); const c = agregarIngreso('pendiente'); await Promise.all([a, b, c]); });
    expect(filasPost(reg)).toHaveLength(3);
    expect(reg.lotes.filter(l => l.tabla === 'pedidos')).toHaveLength(1);
  });

  test('después de un error, el guardián se libera: el siguiente toque sí funciona', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo()] });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'red' });
    await registrar(page);
    expect(await page.evaluate(() => registrandoPedido)).toBe(false);
    await registrar(page);
    expect(filasPost(reg)).toHaveLength(1);
  });

  test('con descuento: TODAS las filas llevan las columnas del descuento (0 / null en las que no tienen) y suma lo pedido', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], extras: [extraProducto()], descuento: 3000, motivo: 'Cortesía de la casa' });
    await registrar(page);
    const filas = filasPost(reg).map(f => f.cuerpo);
    expect(filas).toHaveLength(3);
    expect(filas.every(f => 'descuento' in f && 'motivo_descuento' in f)).toBe(true);
    expect(filas.reduce((a, f) => a + f.descuento, 0)).toBe(3000);
    expect(filas.filter(f => f.descuento === 0).every(f => f.motivo_descuento === null)).toBe(true);
    expect(filas.filter(f => f.descuento > 0).every(f => f.motivo_descuento === 'Cortesía de la casa')).toBe(true);
    // Todas las filas del lote traen exactamente las mismas columnas (PostgREST lo exige para insertar varias a la vez).
    const columnas = new Set(filas.map(f => Object.keys(f).sort().join(',')));
    expect(columnas.size).toBe(1);
  });

  test('sin descuento: ninguna fila manda las columnas del descuento (no depende de la migración)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { extras: [extraProducto()] });
    await registrar(page);
    expect(filasPost(reg).every(f => !('descuento' in f.cuerpo) && !('motivo_descuento' in f.cuerpo))).toBe(true);
  });

  test('pago dividido y domicilio: el reparto y el envío quedan UNA vez, en la primera fila', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], ubicacion: 'domicilio' });
    await page.evaluate(() => {
      document.getElementById('ing-direccion').value = 'Calle de prueba 2';
      document.getElementById('ing-domicilio-valor').value = '4000';
    });
    await registrar(page);
    const filas = filasPost(reg).map(f => f.cuerpo);
    expect(filas).toHaveLength(2);
    // Envío $4.000 solo en la primera + empaque $1.000 por cada almuerzo.
    expect(filas.map(f => f.monto_domicilio)).toEqual([5000, 1000]);
    expect(filas.every(f => f.es_domicilio === true && f.direccion === 'Calle de prueba 2')).toBe(true);
  });

  test('mesa: se registra el pedido pendiente y la mesa queda ocupada', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], ubicacion: 'mesa_5' });
    await registrar(page, 'pendiente');
    expect(filasPost(reg)).toHaveLength(2);
    expect(reg.escrituras.filter(e => e.tabla === 'mesas' && e.metodo === 'PATCH')).toHaveLength(1);
    expect(await page.evaluate(() => ST.mesas.find(m => m.numero === 5).estado)).toBe('ocupada');
  });

  test('si falla SOLO marcar la mesa como ocupada, el pedido ya guardado no se repite: se avisa y el formulario queda limpio', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], ubicacion: 'mesa_5' });
    reg.control.fallasEscritura.push({ tabla: 'mesas', metodo: 'PATCH', tipo: 'red' });
    await registrar(page, 'pendiente');
    expect(filasPost(reg)).toHaveLength(2);
    expect(await colas(page)).toEqual({ almuerzos: 0, extras: 0 });            // NO queda la cola: reintentar duplicaría el pedido
    await expect(avisos(page).filter({ hasText: 'El pedido se guardó, pero no se pudo marcar la mesa 5' })).toBeVisible();
    expect(await page.evaluate(() => ST.pendientes.filter(p => p.mesa === 5).length)).toBe(2);
  });

  test('base vieja sin una columna opcional: se reintenta TODO el pedido sin esas columnas, en una sola petición', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], extras: [extraProducto()] });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'columna' });
    await registrar(page);
    const filas = filasPost(reg).map(f => f.cuerpo);
    expect(filas).toHaveLength(3);
    expect(reg.lotes.filter(l => l.tabla === 'pedidos')).toEqual([{ tabla: 'pedidos', filas: 3, rol: 'caja' }]);
    expect(filas.every(f => !('es_gratis' in f) && !('grupo_pedido' in f) && !('es_fiar' in f))).toBe(true);
    // En pantalla las filas conservan lo que no se pudo guardar.
    const enPantalla = await page.evaluate(() => ST.ingresos.slice(0, 3).map(p => [p.es_gratis, p.es_fiar, typeof p.grupo_pedido]));
    expect(enPantalla.every(([g, f, t]) => g === false && f === false && t === 'string')).toBe(true);
  });

  test('con descuento y una base sin la columna del descuento: no se guarda NADA (no se cobra de más sin dejar rastro)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], descuento: 2000, motivo: 'Cortesía' });
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'POST', tipo: 'columna' });
    // El mensaje de «columna» de la base vieja menciona es_gratis; para este caso se simula el de la columna del descuento.
    await page.route('**/rest/v1/pedidos*', async (route, req) => {
      if (req.method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST204', message: "Could not find the 'descuento' column of 'pedidos' in the schema cache" }) });
    });
    await registrar(page);
    expect(filasPost(reg)).toHaveLength(0);
    await expect(avisos(page).filter({ hasText: 'NO se guardó' })).toBeVisible();
    expect(await colas(page)).toEqual({ almuerzos: 2, extras: 0 });
  });

  test('un fiado a nombre de un cliente viaja igual en una sola petición (el cliente de ejemplo tiene saldo a favor: se responde la pregunta)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await armar(page, { items: [almuerzo(), almuerzo()], ubicacion: 'fiar' });
    await page.evaluate(() => { clienteFiadoSeleccionadoId = 1; });
    const terminado = registrar(page, 'pendiente');                              // se queda esperando la pregunta del saldo a favor
    await page.getByRole('button', { name: /Usar saldo a favor/ }).click();
    await terminado;
    const filas = filasPost(reg).map(f => f.cuerpo);
    expect(filas).toHaveLength(2);
    expect(reg.lotes.filter(l => l.tabla === 'pedidos')).toHaveLength(1);
    expect(filas.every(f => f.es_fiar === true && f.cliente_fiado_id === 1 && f.estado === 'pendiente')).toBe(true);
    expect(await page.evaluate(() => registrandoPedido)).toBe(false);
  });
});
