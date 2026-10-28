// Aviso de saldo a favor al dejar un fiado a nombre de un cliente.
//
// Pedido del dueño (27-oct-2026): si un cliente tiene saldo a favor y se le registra un fiado, el sistema lo avisa:
//   · si el saldo alcanza para pagar el pedido completo, se descuenta del saldo (sin sumar plata a ningún cierre,
//     porque esa plata ya entró cuando el cliente abonó);
//   · si no alcanza, solo avisa y el saldo de su tarjeta de Fiados queda con el descuento, como hasta hoy.
// Un pedido pendiente (mesa, domicilio…) o pagado al instante NO lleva cliente: ahí no pasa nada con el saldo.
// El aviso sale en los TRES lugares donde un pedido pasa a ser fiado de alguien:
//   1) Pedidos → «Fiar» con un cliente;  2) Pendientes → «📒 Fiar» (se pregunta el nombre);
//   3) Fiados → fiado sin cliente asignado → «Asignar».
// Si el cliente acepta, se usa el mismo «✔ Aplicar saldo a favor» de siempre: del pedido más viejo al más nuevo, completos.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

// Recoge todos los diálogos (confirmaciones y preguntas) y responde según `cfg`.
//   cfg.confirmar → true acepta, false cancela;   cfg.nombre → lo que se escribe cuando el sistema pregunta un nombre.
function armarDialogos(page, cfg = {}) {
  const vistos = [];
  page.on('dialog', async d => {
    vistos.push({ tipo: d.type(), mensaje: d.message() });
    if (d.type() === 'prompt') await d.accept(cfg.nombre || '');
    else if (cfg.confirmar === false) await d.dismiss();
    else await d.accept();
  });
  return vistos;
}

const pedidoBase = copia(BASE.pedidos[0]);
const fiadoDe = (id, clienteId, monto, grupo, extra = {}) => ({
  ...copia(pedidoBase), id, estado: 'pendiente', metodo: 'fiado', es_fiar: true, cliente_fiado_id: clienteId,
  monto_total: monto, monto_unit: monto, monto_almuerzo: monto, grupo_pedido: grupo, ...extra,
});
const abonoDe = (id, clienteId, monto) => ({ id, cliente_fiado_id: clienteId, monto, fecha: FECHA_HOY, turno: 'almuerzo', cuenta: 'efectivo',
  created_at: `${FECHA_HOY}T11:00:00-05:00` });

// Luisca (7): 20.000 a favor, sin deudas.   Marta (8): debe 12.000, sin saldo a favor.
// Pedro (9): 5.000 a favor, pero un fiado viejo de 12.000 sin pagar.   Ana (10): 5.000 a favor, sin deudas.
// 902: un fiado viejo SIN cliente (huérfano).   903: un pedido pendiente de la mesa 3 (no es fiado).
function datosAviso(extra = {}) {
  const d = copia(BASE);
  d.cierres_dia = [];
  d.clientes_fiado = [
    { id: 7, nombre: 'Luisca', created_at: '2026-10-01T10:00:00-05:00' },
    { id: 8, nombre: 'Marta Pérez', created_at: '2026-10-01T10:05:00-05:00' },
    { id: 9, nombre: 'Pedro Gómez', created_at: '2026-10-01T10:10:00-05:00' },
    { id: 10, nombre: 'Ana Ríos', created_at: '2026-10-01T10:15:00-05:00' },
  ];
  d.abonos_fiado = [abonoDe(1, 7, 20000), abonoDe(2, 9, 5000), abonoDe(3, 10, 5000)];
  d.pedidos = [
    fiadoDe(900, 8, 12000, 'g-marta'),
    fiadoDe(901, 9, 12000, 'g-pedro-viejo', { fecha: '2026-10-10' }),
    fiadoDe(902, null, 9000, 'g-huerfano', { fecha: '2026-10-12' }),
    { ...copia(pedidoBase), id: 904, estado: 'pagado', metodo: 'efectivo', monto_total: 15000, grupo_pedido: 'g-pagado-hoy' },   // 15.000 en efectivo de hoy
    { ...copia(pedidoBase), id: 903, estado: 'pendiente', metodo: 'pendiente', mesa: 3, monto_total: 9000, monto_unit: 9000, monto_almuerzo: 9000, grupo_pedido: 'g-mesa3' },
    ...(extra.pedidos || []),
  ];
  d.mesas = copia(BASE.mesas).map(m => m.numero === 3 ? { ...m, estado: 'ocupada' } : m);
  return d;
}

async function abrir(page, opciones = {}) {
  return abrirSistema(page, { datos: datosAviso(opciones.extra), ...opciones });   // por defecto: sesión de caja
}

// Registra un pedido como fiado de un cliente (lo mismo que hace el botón «Registrar pedido»).
const registrarFiado = (page, clienteId, monto) => page.evaluate(async ([cid, m]) => {
  selectedUbicacion = 'fiar';
  clienteFiadoSeleccionadoId = cid;
  almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1,
                       monto_unit: m, monto_almuerzo: m, para_llevar: false }];
  await agregarIngreso('pendiente');
}, [clienteId, monto]);
const pasarPendienteAFiado = (page, ids) => page.evaluate(async i => { cambioMesaIds = i; await moverPedidoAFiado(); }, ids);
const toastsTexto = page => page.locator('.toast').allInnerTexts();
const saldo = (page, id) => page.evaluate(i => { const s = calcularSaldoFiado(i); return { pendiente: s.totalPendiente, sobrante: s.sobrante, saldo: s.saldo }; }, id);

test.describe('1) Pedidos → «Fiar» con un cliente', () => {
  test('saldo que alcanza: pregunta, y al aceptar salda el pedido con el saldo sin sumar plata a ningún cierre (con caja)', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    const efectivoAntes = await page.evaluate(() => ST.ingresos.reduce((a, p) => a + efectivoDe(p), 0));
    await registrarFiado(page, 7, 15000);

    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].tipo).toBe('confirm');
    expect(dialogos[0].mensaje).toContain('Luisca tiene saldo a favor y ya quedó un fiado a su nombre');
    expect(dialogos[0].mensaje).toContain('Aplicar saldo a favor de Luisca: $20.000');
    expect(dialogos[0].mensaje).toContain('Se saldarán 1 pedido(s) completo(s) por $15.000');
    expect(dialogos[0].mensaje).toContain('No entra plata nueva a caja');

    // El pedido nuevo quedó pagado con el saldo: monto en 0 en efectivo y transferencia, marcado «vía abono».
    const patch = escritura(reg, 'PATCH', 'pedidos');
    expect(patch).toHaveLength(1);
    expect(patch[0].rol).toBe('caja');
    expect(patch[0].cuerpo).toMatchObject({ estado: 'pagado', monto_efectivo: 0, monto_transferencia: 0, pagado_via_abono: true, fecha_pago: FECHA_HOY });
    // Ninguna plata nueva: ni abonos, ni movimientos de caja, ni cierres; la caja de hoy sigue igual.
    expect(escritura(reg, 'POST', 'abonos_fiado')).toHaveLength(0);
    expect(escritura(reg, 'POST', 'movimientos_caja')).toHaveLength(0);
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia')).toHaveLength(0);
    expect(await page.evaluate(() => ST.ingresos.reduce((a, p) => a + efectivoDe(p), 0))).toBe(efectivoAntes);
    expect(efectivoAntes).toBe(15000);                                                    // y lo de siempre sigue contando
    // Estado: ya no está pendiente y a Luisca le quedan 5.000 a favor.
    expect(await page.evaluate(() => ST.pendientes.filter(p => p.cliente_fiado_id === 7).length)).toBe(0);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 5000 });
    const avisos = (await toastsTexto(page)).join(' | ');
    expect(avisos).toContain('saldado(s) con su saldo a favor');
    expect(avisos).not.toContain('ya se descuenta de su saldo');      // ese aviso es solo para cuando NO alcanza
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('el administrador también lo ve, igual', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page, { usuario: 'admin' });
    await registrarFiado(page, 7, 15000);
    expect(dialogos).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'pedidos')[0].rol).toBe('admin');
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 5000 });
  });

  test('si dice que no: el fiado queda pendiente, el saldo se descuenta en su tarjeta y el botón «Aplicar saldo» sigue ahí', async ({ page }) => {
    const dialogos = armarDialogos(page, { confirmar: false });
    const reg = await abrir(page);
    await registrarFiado(page, 7, 15000);
    expect(dialogos).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    const p = await page.evaluate(() => ST.pendientes.find(x => x.cliente_fiado_id === 7));
    expect(p).toMatchObject({ estado: 'pendiente', es_fiar: true, monto_total: 15000 });
    expect(p.pagado_via_abono).toBeFalsy();
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 15000, sobrante: 20000, saldo: -5000 });
    await irA(page, 'fiados');
    await expect(page.locator('#fiados-clientes-zone button', { hasText: 'Aplicar saldo a favor' })).toHaveCount(1);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('saldado(s)');
    expect(reg.errores).toEqual([]);
  });

  test('saldo que NO alcanza (Pedro: 5.000 a favor y un fiado viejo de 12.000): solo avisa, sin preguntar ni pagar nada', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await registrarFiado(page, 9, 8000);
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    const avisos = (await toastsTexto(page)).join(' | ');
    expect(avisos).toContain('Pedro Gómez tiene $5.000 a favor');
    expect(avisos).toContain('ya se descuenta de su saldo en Fiados');
    expect(await saldo(page, 9)).toMatchObject({ pendiente: 20000, sobrante: 5000, saldo: 15000 });   // el descuento ya está en el saldo
  });

  test('cliente sin saldo a favor (Marta debe 12.000): no pregunta ni avisa nada', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await registrarFiado(page, 8, 8000);
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
    expect(await saldo(page, 8)).toMatchObject({ pendiente: 20000, sobrante: 0, saldo: 20000 });
  });

  test('el saldo se aplica del pedido más viejo al más nuevo, completos: si hay un fiado viejo, se salda ese primero', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const extra = { pedidos: [fiadoDe(910, 7, 6000, 'g-luisca-viejo', { fecha: '2026-10-10' })] };
    const reg = await abrir(page, { extra });
    await registrarFiado(page, 7, 15000);         // 20.000 a favor: paga el viejo de 6.000 y los 14.000 que quedan no alcanzan para los 15.000
    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].mensaje).toContain('Se saldarán 1 pedido(s) completo(s) por $6.000');
    const patch = escritura(reg, 'PATCH', 'pedidos');
    expect(patch).toHaveLength(1);
    expect(decodeURIComponent(patch[0].consulta)).toContain('id=eq.910');
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 15000, sobrante: 14000 });
  });

  test('un pedido de mesa, sin mesa o pagado al instante no lleva cliente: no pasa nada y el saldo queda intacto', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await page.evaluate(async () => {
      clienteFiadoSeleccionadoId = 7;                          // un cliente que quedó elegido de antes… pero el pedido no es fiado
      selectedUbicacion = 'mesa_4';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false }];
      await agregarIngreso('pendiente');                       // pendiente de una mesa
      selectedUbicacion = 'sinmesa';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false }];
      await agregarIngreso('pagado');                          // pagado inmediatamente
    });
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'POST', 'pedidos')).toHaveLength(2);
    expect(escritura(reg, 'POST', 'pedidos').every(e => e.cuerpo.cliente_fiado_id === null)).toBe(true);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 20000 });
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
  });
});

test.describe('2) Pendientes → «📒 Fiar» (se pregunta el nombre)', () => {
  test('a un cliente con saldo que alcanza: pregunta el nombre y luego ofrece el saldo; al aceptar queda saldado y la mesa libre', async ({ page }) => {
    const dialogos = armarDialogos(page, { nombre: 'Luisca' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['prompt', 'confirm']);
    expect(dialogos[1].mensaje).toContain('Luisca tiene saldo a favor y ya quedó un fiado a su nombre');
    expect(dialogos[1].mensaje).toContain('Se saldarán 1 pedido(s) completo(s) por $9.000');
    const patch = escritura(reg, 'PATCH', 'pedidos');
    expect(patch.map(e => e.cuerpo)).toEqual([
      expect.objectContaining({ es_fiar: true, cliente_fiado_id: 7 }),
      expect.objectContaining({ estado: 'pagado', pagado_via_abono: true, monto_efectivo: 0, monto_transferencia: 0 }),
    ]);
    expect(escritura(reg, 'PATCH', 'mesas').some(e => e.cuerpo.estado === 'libre')).toBe(true);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 11000 });
    expect(reg.escrituras.filter(e => ['cierres_dia', 'movimientos_caja'].includes(e.tabla) || (e.tabla === 'abonos_fiado'))).toHaveLength(0);
    expect(reg.denegadas).toEqual([]);
  });

  test('a un cliente sin saldo (Marta): solo pregunta el nombre', async ({ page }) => {
    const dialogos = armarDialogos(page, { nombre: 'marta perez' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['prompt']);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);       // solo el cambio a fiado
    expect(await saldo(page, 8)).toMatchObject({ pendiente: 21000, sobrante: 0 });
  });

  test('a un cliente nuevo (sin historial): se crea y no hay aviso', async ({ page }) => {
    const dialogos = armarDialogos(page, { nombre: 'Cliente Nuevo' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['prompt']);
    expect(escritura(reg, 'POST', 'clientes_fiado')).toHaveLength(1);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
  });

  test('a un cliente con saldo que no alcanza (Pedro): avisa sin preguntar', async ({ page }) => {
    const dialogos = armarDialogos(page, { nombre: 'Pedro Gómez' });
    await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['prompt']);
    expect((await toastsTexto(page)).join(' | ')).toContain('Pedro Gómez tiene $5.000 a favor');
  });

  test('si se cancela el nombre, el pedido no pasa a fiado y no hay aviso', async ({ page }) => {
    const dialogos = armarDialogos(page, { nombre: '' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['prompt']);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
    expect(reg.errores).toEqual([]);
  });
});

test.describe('3) Fiados → fiado sin cliente → «Asignar»', () => {
  const asignarA = async (page, clienteId) => {
    await irA(page, 'fiados');
    await page.selectOption('#huerfano-cliente-g-huerfano', String(clienteId));
    await page.locator('button', { hasText: /^Asignar$/ }).click();
  };

  test('a un cliente con saldo que alcanza: ofrece el saldo y, al aceptar, queda saldado', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await asignarA(page, 7);
    await expect.poll(() => escritura(reg, 'PATCH', 'pedidos').length).toBe(2);
    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].mensaje).toContain('Luisca tiene saldo a favor y ya quedó un fiado a su nombre');
    expect(dialogos[0].mensaje).toContain('por $9.000');
    expect(escritura(reg, 'PATCH', 'pedidos')[1].cuerpo).toMatchObject({ estado: 'pagado', pagado_via_abono: true });
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 11000 });
    expect(reg.denegadas).toEqual([]);
  });

  test('a un cliente sin saldo (Marta): asigna sin avisar nada', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await asignarA(page, 8);
    await expect.poll(() => escritura(reg, 'PATCH', 'pedidos').length).toBe(1);
    expect(dialogos).toEqual([]);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
  });

  test('«Crear y asignar» (cliente nuevo): no tiene saldo, no hay aviso', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await irA(page, 'fiados');
    await page.fill('#huerfano-nuevo-g-huerfano', 'Cliente Nuevo');
    await page.locator('button', { hasText: 'Crear y asignar' }).click();
    await expect.poll(() => escritura(reg, 'POST', 'clientes_fiado').length).toBe(1);
    expect(dialogos).toEqual([]);
  });
});

test.describe('lo que el aviso nunca debe hacer', () => {
  test('si el saldo ya se aplicó, un fiado más pequeño al mismo cliente vuelve a ofrecer solo lo que queda', async ({ page }) => {
    const dialogos = armarDialogos(page);
    await abrir(page);
    await registrarFiado(page, 7, 15000);       // 20.000 → paga 15.000, quedan 5.000
    await registrarFiado(page, 7, 4000);        // 5.000 alcanza para 4.000
    expect(dialogos).toHaveLength(2);
    expect(dialogos[1].mensaje).toContain('Aplicar saldo a favor de Luisca: $5.000');
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 1000 });
    await registrarFiado(page, 7, 4000);        // quedan 1.000: ya no alcanza → solo avisa
    expect(dialogos).toHaveLength(2);
    expect((await toastsTexto(page)).join(' | ')).toContain('Luisca tiene $1.000 a favor');
  });

  test('un error al aplicar el saldo no estropea el fiado que ya quedó registrado', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    // Desde aquí, guardar el cambio de un pedido falla (la ruta más nueva manda; lo demás sigue al backend de siempre).
    await page.route('**/rest/v1/pedidos*', ruta => ruta.request().method() === 'PATCH'
      ? ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fallo de prueba"}' }) : ruta.fallback());
    await registrarFiado(page, 7, 15000);
    expect(dialogos).toHaveLength(1);
    const guardado = escritura(reg, 'POST', 'pedidos');
    expect(guardado).toHaveLength(1);                                                    // el fiado sí se guardó
    expect(await page.evaluate(() => ST.pendientes.some(p => p.cliente_fiado_id === 7 && p.monto_total === 15000))).toBe(true);
    expect((await toastsTexto(page)).join(' | ')).toContain('Error al aplicar el saldo a favor');
    expect((await toastsTexto(page)).join(' | ')).not.toContain('Error al registrar pedido');   // el registro en sí no se marca como fallido
  });
});
