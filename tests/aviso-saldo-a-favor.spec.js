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

// Atiende las ventanas del sistema (el navegador ya NO muestra avisos propios: si saliera alguno, queda en `vistos` con su
// tipo —'confirm', 'prompt'…— y se cierra, y las pruebas que comparan `vistos` fallarían):
//   · la ventana #modal-sistema (preguntas de saldo a favor y los «¿Seguro?», p. ej. el botón «✔ Aplicar saldo a favor» de la
//     tarjeta): se pulsa el botón de cfg.eleccion ('usar' | 'no' | 'volver'; por defecto 'usar', o 'no' si cfg.confirmar === false;
//     'no' = «Cobrar normal» en «Pagado inmediatamente» y «Volver» en los «¿Seguro?»; 'usar' vale también para «Aceptar» de un
//     «¿Seguro?»); si la ventana no tiene ese botón se pulsa «Volver». cfg.elecciones (lista) da una respuesta distinta a cada
//     ventana, en orden;
//   · el selector de cliente (#modal-elegir-cliente, al pasar un pendiente a fiado): cfg.cliente → se pulsa ese cliente de la
//     lista; cfg.clienteNuevo → se escribe ese nombre y se pulsa «+ Crear cliente nuevo»; si no hay ninguno de los dos, «Volver»;
//   · cfg.ignorarVentana: no toca #modal-sistema (la prueba lo contesta a mano).
// Cada ventana queda en `vistos` como { tipo: 'modal' | 'selector', mensaje: <todo su texto, botones incluidos> }.
// Hay que llamarla ANTES de abrir el sistema.
function armarDialogos(page, cfg = {}) {
  const vistos = [];
  page.on('dialog', async d => { vistos.push({ tipo: d.type(), mensaje: d.message() }); await d.dismiss(); });
  page.exposeFunction('__loboModalVisto', (texto, tipo) => { vistos.push({ tipo: tipo || 'modal', mensaje: texto }); });
  page.addInitScript(c => {
    let n = 0, atendiendo = false;
    const visible = el => el && getComputedStyle(el).display !== 'none';
    setInterval(async () => {
      if (atendiendo) return;
      const sel = document.getElementById('modal-elegir-cliente');
      const m = document.getElementById('modal-sistema');
      if (visible(sel)) {
        atendiendo = true;
        try {
          if (!sel.querySelector('#ecl-lista').children.length) return;
          await window.__loboModalVisto(sel.innerText, 'selector');
          if (c.cliente) {
            const fila = [...sel.querySelectorAll('#ecl-lista [data-id]')].find(e => e.firstChild.textContent === c.cliente);
            (fila || sel.querySelector('#ecl-volver')).click();
          } else if (c.clienteNuevo) {
            const caja = sel.querySelector('#ecl-buscar');
            caja.value = c.clienteNuevo; caja.dispatchEvent(new Event('input'));
            (sel.querySelector('#ecl-lista [data-nuevo]') || sel.querySelector('#ecl-volver')).click();
          } else sel.querySelector('#ecl-volver').click();
          await new Promise(r => setTimeout(r, 60));
        } finally { atendiendo = false; }
        return;
      }
      if (c.ignorarVentana || !visible(m)) return;                  // ignorarVentana: la prueba contesta ella misma la ventana #modal-sistema
      atendiendo = true;
      try {
        const botones = [...m.querySelectorAll('#sis-opciones button')];
        if (!botones.length) return;
        await window.__loboModalVisto(m.innerText);
        const quiere = (c.elecciones && c.elecciones[n]) || c.eleccion;
        n += 1;
        const por = v => botones.find(b => b.dataset.eleccion === v);
        (por(quiere) || (quiere === 'usar' && por('si')) || por('volver') || botones[0]).click();
      } finally { atendiendo = false; }
    }, 15);
  }, { eleccion: cfg.eleccion || (cfg.confirmar === false ? 'no' : 'usar'), elecciones: cfg.elecciones || null,
       cliente: cfg.cliente || null, clienteNuevo: cfg.clienteNuevo || null, ignorarVentana: !!cfg.ignorarVentana });
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
const registrarFiado = (page, clienteId, monto, estado = 'pendiente') => page.evaluate(async ([cid, m, e]) => {
  selectedUbicacion = 'fiar';
  clienteFiadoSeleccionadoId = cid;
  almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1,
                       monto_unit: m, monto_almuerzo: m, para_llevar: false }];
  await agregarIngreso(e);
}, [clienteId, monto, estado]);
const pasarPendienteAFiado = (page, ids) => page.evaluate(async i => { cambioMesaIds = i; await moverPedidoAFiado(); }, ids);
const toastsTexto = page => page.locator('.toast').allInnerTexts();
const saldo = (page, id) => page.evaluate(i => { const s = calcularSaldoFiado(i); return { pendiente: s.totalPendiente, sobrante: s.sobrante, saldo: s.saldo }; }, id);

// ── El aviso EN el formulario de Pedidos (antes de pulsar el botón de registrar) ───────────────────────────────────────
// Lo que el dueño esperaba ver al probar (30-oct): al elegir el cliente de un fiado, el formulario ya le dice si tiene
// saldo a favor y si alcanzaría para ESTE pedido. Es solo informativo: la pregunta de verdad sale al registrar.
const AVISO = '#cliente-fiado-saldo-aviso';
async function elegirFiarConCliente(page, texto, nombreCompleto) {
  await page.locator('#btn-fiar').click();
  await page.locator('#ing-cliente-fiado').fill(texto);
  await page.locator('#ac-cliente-fiado .autocomplete-item', { hasText: nombreCompleto || texto }).first().dispatchEvent('mousedown');
}
const textoAviso = page => page.locator(AVISO).innerText();

test.describe('0) El aviso dentro del formulario de Pedidos → «Fiar»', () => {
  test('no se ve mientras no haya un cliente elegido, ni al abrir «Fiar»', async ({ page }) => {
    await abrir(page);
    await expect(page.locator(AVISO)).toBeHidden();
    await page.locator('#btn-fiar').click();
    await expect(page.locator(AVISO)).toBeHidden();
  });

  test('cliente con saldo a favor: aparece al elegirlo, se actualiza con el pedido y la cantidad, y es solo informativo', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await expect(page.locator(AVISO)).toBeVisible();
    expect(await textoAviso(page)).toContain('Luisca tiene $20.000 a favor');
    expect(await textoAviso(page)).toContain('te preguntaré');                         // todavía sin pedido elegido

    await page.locator('#ing-pedido').selectOption('completo');                         // 14.000 ≤ 20.000
    expect(await textoAviso(page)).toContain('Con este pedido ($14.000) le alcanza');
    expect(await textoAviso(page)).toContain('te preguntaré si lo paga con su saldo o se cobra normal');
    expect(await textoAviso(page)).not.toContain('caja');                                // la explicación completa está en la ventana, no aquí

    await page.locator('#ing-cantidad').fill('2');                                      // 28.000 > 20.000
    expect(await textoAviso(page)).toContain('No alcanza para pagar este pedido completo ($28.000)');
    expect(await textoAviso(page)).toContain('Si lo dejas fiado, el saldo se le descuenta en Fiados');

    await page.locator('#ing-cantidad').fill('1');                                      // vuelve a alcanzar
    expect(await textoAviso(page)).toContain('Con este pedido ($14.000) le alcanza');

    await page.locator('#ing-pedido').selectOption('asado200');                         // 20.000 = 20.000: justo alcanza
    expect(await textoAviso(page)).toContain('Con este pedido ($20.000) le alcanza');

    // Solo informa: nada preguntó, nada escribió, nada denegado.
    expect(dialogos).toEqual([]);
    expect(reg.escrituras).toEqual([]);
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('el descuento del pedido cuenta en lo que se compara con el saldo', async ({ page }) => {
    await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await page.locator('#ing-pedido').selectOption('asado200');                         // 20.000
    await page.locator('#ing-cantidad').fill('2');                                      // 40.000 → no alcanza
    expect(await textoAviso(page)).toContain('No alcanza para pagar este pedido completo ($40.000)');
    await page.locator('#ing-descuento').fill('20000');                                 // descuento de 20.000 → 20.000: alcanza
    expect(await textoAviso(page)).toContain('Con este pedido ($20.000) le alcanza');
  });

  test('cliente SIN saldo a favor (Marta debe 12.000): no aparece nada, ni con un pedido elegido', async ({ page }) => {
    await abrir(page);
    await elegirFiarConCliente(page, 'Marta', 'Marta Pérez');
    await expect(page.locator('#cliente-fiado-seleccionado')).toBeVisible();
    await expect(page.locator(AVISO)).toBeHidden();
    await page.locator('#ing-pedido').selectOption('completo');
    await expect(page.locator(AVISO)).toBeHidden();
  });

  test('un fiado viejo del mismo cliente se paga primero: el aviso lo cuenta igual que lo hará «Aplicar saldo»', async ({ page }) => {
    const extra = { pedidos: [fiadoDe(910, 7, 6000, 'g-luisca-viejo', { fecha: '2026-10-10' })] };
    await abrir(page, { extra });
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await page.locator('#ing-pedido').selectOption('completo');                         // 20.000 − 6.000 viejo = 14.000 → alcanza justo
    expect(await textoAviso(page)).toContain('Le alcanza para 1 fiado(s) más viejo(s) y para este pedido ($14.000)');
    await page.locator('#ing-pedido').selectOption('asado200');                         // 20.000 − 6.000 = 14.000 < 20.000
    expect(await textoAviso(page)).toContain('Se usaría primero en sus fiados más viejos (1); este pedido ($20.000) no alcanzaría');
  });

  test('si el saldo no alcanza ni para el fiado viejo (Pedro: 5.000 a favor y 12.000 viejos), dice que no alcanza', async ({ page }) => {
    await abrir(page);
    await elegirFiarConCliente(page, 'Pedro', 'Pedro Gómez');
    expect(await textoAviso(page)).toContain('Pedro Gómez tiene $5.000 a favor');
    await page.locator('#ing-pedido').selectOption('completo');
    expect(await textoAviso(page)).toContain('No alcanza para pagar este pedido completo ($14.000)');
  });

  test('«✕ quitar», cambiar de cliente o de tipo de pedido lo hacen desaparecer (o cambiar) sin dejar restos', async ({ page }) => {
    await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await expect(page.locator(AVISO)).toBeVisible();
    await page.locator('#cliente-fiado-seleccionado button', { hasText: 'quitar' }).click();
    await expect(page.locator(AVISO)).toBeHidden();
    expect(await page.locator(AVISO).textContent()).toBe('');

    await page.locator('#ing-cliente-fiado').fill('Ana');                               // otro cliente con saldo: 5.000
    await page.locator('#ac-cliente-fiado .autocomplete-item', { hasText: 'Ana Ríos' }).first().dispatchEvent('mousedown');
    expect(await textoAviso(page)).toContain('Ana Ríos tiene $5.000 a favor');
    expect(await textoAviso(page)).not.toContain('Luisca');

    await page.locator('#cliente-fiado-seleccionado button', { hasText: 'quitar' }).click();
    await page.locator('#ing-cliente-fiado').fill('Marta');                             // y ahora uno sin saldo
    await page.locator('#ac-cliente-fiado .autocomplete-item', { hasText: 'Marta Pérez' }).first().dispatchEvent('mousedown');
    await expect(page.locator(AVISO)).toBeHidden();

    await page.locator('#cliente-fiado-seleccionado button', { hasText: 'quitar' }).click();
    await elegirFiarConCliente(page, 'Luis', 'Luisca');                                 // al cambiar de tipo de pedido se va con el cliente
    await expect(page.locator(AVISO)).toBeVisible();
    await page.evaluate(() => seleccionarUbicacion('sinmesa'));                        // (el botón «Gratis» solo existe en comidas rápidas)
    await expect(page.locator(AVISO)).toBeHidden();
    await page.locator('#btn-fiar').click();
    await expect(page.locator(AVISO)).toBeHidden();                                     // el cliente no vuelve solo
  });

  test('seguro extra: aunque por error quedara un cliente elegido, fuera de «Fiar» el aviso no aparece', async ({ page }) => {
    await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await expect(page.locator(AVISO)).toBeVisible();
    await page.evaluate(() => { selectedUbicacion = 'sinmesa'; actualizarAvisoSaldoFavorFormulario(); });   // estado que la pantalla no produce sola
    await expect(page.locator(AVISO)).toBeHidden();
    expect(await page.locator(AVISO).textContent()).toBe('');
  });

  test('con la sesión de administrador se ve igual', async ({ page }) => {
    await abrir(page, { usuario: 'admin' });
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await page.locator('#ing-pedido').selectOption('completo');
    expect(await textoAviso(page)).toContain('Luisca tiene $20.000 a favor');
    expect(await textoAviso(page)).toContain('Con este pedido ($14.000) le alcanza');
  });

  test('de punta a punta con la pantalla: se ve el aviso, se pulsa «Registrar pedido como pendiente», sale la pregunta y al aceptar queda saldado; el formulario queda limpio', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await page.locator('#ing-pedido').selectOption('completo');
    expect(await textoAviso(page)).toContain('Con este pedido ($14.000) le alcanza');
    await page.locator('#btn-reg').click();
    await expect.poll(() => dialogos.length).toBe(1);
    expect(dialogos[0].mensaje).toContain('Luisca tiene $20.000 a favor y este pedido cuesta $14.000');
    expect(dialogos[0].mensaje).toContain('Usar saldo a favor');
    await expect.poll(() => escritura(reg, 'PATCH', 'pedidos').length).toBe(1);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 6000 });
    await expect(page.locator(AVISO)).toBeHidden();                                     // formulario limpio: sin cliente ni aviso
    expect(await page.evaluate(() => clienteFiadoSeleccionadoId)).toBeNull();
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('un nombre con símbolos no se interpreta como código en el aviso', async ({ page }) => {
    const datos = datosAviso();
    datos.clientes_fiado.push({ id: 11, nombre: '<i>Raro</i> & Co', created_at: '2026-10-01T10:20:00-05:00' });
    datos.abonos_fiado.push(abonoDe(4, 11, 3000));
    await abrirSistema(page, { datos });
    await elegirFiarConCliente(page, 'Raro', 'Raro');
    expect(await textoAviso(page)).toContain('<i>Raro</i> & Co tiene $3.000 a favor');
    expect(await page.locator(`${AVISO} i`).count()).toBe(0);
  });
});

// ── «Pagado inmediatamente» con un cliente de «Fiar» (pedido del dueño, 30-oct) ───────────────────────────────────────
// Antes este botón no preguntaba nada ni usaba el saldo. Ahora, si el saldo alcanza para el pedido completo, pregunta ANTES
// de guardar: Aceptar = se paga con el saldo (sin plata nueva en caja); Cancelar = se cobra normal con el método elegido.
const ingresoEfectivo = page => page.evaluate(() => ST.ingresos.reduce((a, p) => a + efectivoDe(p), 0));
test.describe('1b) Pedidos → «Fiar» → «Pagado inmediatamente»', () => {
  test('saldo que alcanza + ACEPTAR: se paga con el saldo, sin sumar plata a ningún cierre, y una sola pregunta', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    const efectivoAntes = await ingresoEfectivo(page);
    await registrarFiado(page, 7, 15000, 'pagado');

    expect(dialogos).toHaveLength(1);                                                    // no vuelve a preguntar al aplicar
    expect(dialogos[0].tipo).toBe('modal');
    expect(dialogos[0].mensaje).toContain('Luisca tiene $20.000 a favor y este pedido cuesta $15.000');
    expect(dialogos[0].mensaje).toContain('Pagar con saldo a favor');
    expect(dialogos[0].mensaje).toContain('le quedarían $5.000 a favor');
    expect(dialogos[0].mensaje).toContain('No entra plata nueva a caja');
    expect(dialogos[0].mensaje).toContain('Cobrar normal (efectivo)');
    expect(dialogos[0].mensaje).toContain('Volver');

    // Se guardó una sola vez, como fiado de Luisca, y quedó saldado con su saldo (monto en 0, «vía abono»).
    const guardado = escritura(reg, 'POST', 'pedidos');
    expect(guardado).toHaveLength(1);
    expect(guardado[0].cuerpo).toMatchObject({ es_fiar: true, cliente_fiado_id: 7, monto_total: 15000, estado: 'pendiente' });
    const patch = escritura(reg, 'PATCH', 'pedidos');
    expect(patch).toHaveLength(1);
    expect(patch[0].cuerpo).toMatchObject({ estado: 'pagado', monto_efectivo: 0, monto_transferencia: 0, pagado_via_abono: true, fecha_pago: FECHA_HOY });
    expect(escritura(reg, 'POST', 'abonos_fiado')).toHaveLength(0);
    expect(escritura(reg, 'POST', 'movimientos_caja')).toHaveLength(0);
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia')).toHaveLength(0);
    expect(await ingresoEfectivo(page)).toBe(efectivoAntes);                             // la caja de hoy no cambia
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 5000 });
    expect(await page.evaluate(() => ST.pendientes.filter(p => p.cliente_fiado_id === 7).length)).toBe(0);
    expect((await toastsTexto(page)).join(' | ')).toContain('saldado(s) con su saldo a favor');
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('saldo que alcanza + CANCELAR: se cobra normal con el método elegido, entra a la caja y el saldo no se toca', async ({ page }) => {
    const dialogos = armarDialogos(page, { confirmar: false });
    const reg = await abrir(page);
    const efectivoAntes = await ingresoEfectivo(page);
    await registrarFiado(page, 7, 15000, 'pagado');

    expect(dialogos).toHaveLength(1);
    const guardado = escritura(reg, 'POST', 'pedidos');
    expect(guardado).toHaveLength(1);                                                    // el pedido SÍ se registra
    expect(guardado[0].cuerpo).toMatchObject({ estado: 'pagado', metodo: 'efectivo', monto_total: 15000 });
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect(await ingresoEfectivo(page)).toBe(efectivoAntes + 15000);                     // plata normal de hoy
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 20000 });       // su saldo queda intacto
    const avisos = (await toastsTexto(page)).join(' | ');
    expect(avisos).toContain('Venta registrada');
    expect(avisos).not.toContain('saldado(s)');
    expect(avisos).not.toContain('ya se descuenta');
    expect(reg.errores).toEqual([]);
  });

  test('saldo que NO alcanza (Pedro: 5.000 a favor): no pregunta, se cobra normal y solo avisa cuánto tiene a favor', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    const efectivoAntes = await ingresoEfectivo(page);
    await registrarFiado(page, 9, 8000, 'pagado');
    expect(dialogos).toEqual([]);
    const guardado = escritura(reg, 'POST', 'pedidos');
    expect(guardado).toHaveLength(1);
    expect(guardado[0].cuerpo).toMatchObject({ estado: 'pagado', metodo: 'efectivo', monto_total: 8000 });
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect(await ingresoEfectivo(page)).toBe(efectivoAntes + 8000);
    const avisos = (await toastsTexto(page)).join(' | ');
    expect(avisos).toContain('Pedro Gómez tiene $5.000 a favor');
    expect(avisos).toContain('no alcanza para pagar este pedido completo ($8.000)');
    expect(avisos).not.toContain('ya se descuenta de su saldo en Fiados');                // ese aviso es de cuando queda fiado, no de pago al instante
    expect(await saldo(page, 9)).toMatchObject({ pendiente: 12000, sobrante: 5000 });    // nada cambió en su cuenta
  });

  test('cliente sin saldo a favor (Marta): «Pagado inmediatamente» sigue igual que siempre, sin preguntas ni avisos', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await registrarFiado(page, 8, 8000, 'pagado');
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'POST', 'pedidos')[0].cuerpo).toMatchObject({ estado: 'pagado', metodo: 'efectivo' });
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
  });

  test('con un fiado viejo que el saldo cubre primero: la pregunta lo dice, y al aceptar se saldan ambos (el viejo primero)', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const extra = { pedidos: [fiadoDe(910, 7, 6000, 'g-luisca-viejo', { fecha: '2026-10-10' })] };
    const reg = await abrir(page, { extra });
    await registrarFiado(page, 7, 14000, 'pagado');                                      // 6.000 + 14.000 = 20.000 justo
    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].mensaje).toContain('Antes se saldarían 1 fiado(s) más viejo(s) por $6.000');
    expect(dialogos[0].mensaje).toContain('le quedarían $0 a favor');
    const patch = escritura(reg, 'PATCH', 'pedidos');
    expect(patch).toHaveLength(2);
    expect(decodeURIComponent(patch[0].consulta)).toContain('id=eq.910');                // el viejo primero
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 0 });
  });

  test('el viejo no alcanza a quedar pagado junto con el nuevo → no pregunta, se cobra normal (misma regla del más viejo al más nuevo)', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const extra = { pedidos: [fiadoDe(910, 7, 6000, 'g-luisca-viejo', { fecha: '2026-10-10' })] };
    const reg = await abrir(page, { extra });
    await registrarFiado(page, 7, 15000, 'pagado');                                      // 6.000 + 15.000 = 21.000 > 20.000
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'POST', 'pedidos')[0].cuerpo).toMatchObject({ estado: 'pagado', metodo: 'efectivo' });
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
    expect((await toastsTexto(page)).join(' | ')).toContain('no alcanza para pagar este pedido completo ($15.000)');
  });

  test('un pago al instante SIN «Fiar» (mesa, sin mesa) no pregunta nada aunque el sistema tenga clientes con saldo', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await page.evaluate(async () => {
      selectedUbicacion = 'sinmesa';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 14000, monto_almuerzo: 14000, para_llevar: false }];
      await agregarIngreso('pagado');
    });
    expect(dialogos).toEqual([]);
    expect(escritura(reg, 'POST', 'pedidos')[0].cuerpo).toMatchObject({ estado: 'pagado', es_fiar: false, cliente_fiado_id: null });
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);
  });

  test('«↩ Deshacer» de un pago hecho con saldo: vuelve a ser fiado del cliente y su saldo a favor se recupera', async ({ page }) => {
    armarDialogos(page);
    await abrir(page);
    await registrarFiado(page, 7, 15000, 'pagado');
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 5000 });
    const ids = await page.evaluate(() => ST.ingresos.filter(p => p.cliente_fiado_id === 7).map(p => p.id));
    await page.evaluate(i => revertirPago(i), ids);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 15000, sobrante: 20000 });
  });

  test('de punta a punta con la pantalla: el botón «Pagado inmediatamente» muestra la pregunta; al aceptar queda pagado con el saldo', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    await elegirFiarConCliente(page, 'Luis', 'Luisca');
    await page.locator('#ing-pedido').selectOption('completo');
    await page.locator('#btn-reg-pagado').click();
    await expect.poll(() => dialogos.length).toBe(1);
    expect(dialogos[0].mensaje).toContain('Pagar con saldo a favor');
    await expect.poll(() => escritura(reg, 'PATCH', 'pedidos').length).toBe(1);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 6000 });
    await expect(page.locator(AVISO)).toBeHidden();
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });
});

// ── La ventana de saldo a favor: botones con nombre propio, «Volver» y Esc no dejan rastro ──────────────────────────────
// Pedido del dueño (30-oct): el «Cancelar» de una ventana del navegador confundía (parecía que se descontaba el saldo).
const MODAL = '#modal-sistema';
const estadoFormulario = page => page.evaluate(() => ({ ubicacion: selectedUbicacion, cliente: clienteFiadoSeleccionadoId, cola: almuerzosEnCola.length }));
test.describe('1c) Ventana de saldo a favor: Volver, Esc y botones', () => {
  for (const [boton, estado] of [['«Registrar pedido como pendiente»', 'pendiente'], ['«Pagado inmediatamente»', 'pagado']]) {
    test(`${boton} → «Volver»: no se registra nada y el formulario queda como estaba`, async ({ page }) => {
      const dialogos = armarDialogos(page, { eleccion: 'volver' });
      const reg = await abrir(page);
      const antes = await page.evaluate(() => ST.ingresos.length + ST.pendientes.length);
      await registrarFiado(page, 7, 15000, estado);
      expect(dialogos).toHaveLength(1);
      expect(reg.escrituras).toEqual([]);                                                // ni pedido, ni cambio, ni cierre
      expect(await estadoFormulario(page)).toEqual({ ubicacion: 'fiar', cliente: 7, cola: 1 });
      expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 20000 });
      expect(await page.evaluate(() => ST.ingresos.length + ST.pendientes.length)).toBe(antes);
      await expect(page.locator(MODAL)).toBeHidden();
      expect((await toastsTexto(page)).join(' | ')).not.toContain('registrado');
      expect(reg.errores).toEqual([]);
    });
  }

  test('Esc equivale a «Volver»; un clic fuera de la ventana NO la cierra; luego se puede elegir normalmente', async ({ page }) => {
    const reg = await abrir(page);                                                       // sin respondedor automático: lo manejo a mano
    const antes = await page.evaluate(() => ST.ingresos.length + ST.pendientes.length);
    let terminado = false;
    const lanzado = registrarFiado(page, 7, 15000).then(() => { terminado = true; });
    await expect(page.locator(MODAL)).toBeVisible();
    // «Registrar pedido como pendiente» con saldo que alcanza: SOLO dos botones —usar el saldo o volver—, con nombre propio.
    const botones = await page.locator(`${MODAL} #sis-opciones button`).allInnerTexts();
    expect(botones).toHaveLength(2);
    expect(botones[0]).toContain('✔ Usar saldo a favor');
    expect(botones[1]).toContain('Volver');
    expect(botones[1]).toContain('Pagado inmediatamente');                               // y le dice qué hacer si no quiere usar su saldo
    expect(botones.join(' ')).not.toMatch(/Aceptar|Cancelar|Dejarlo fiado/);

    await page.locator(MODAL).click({ position: { x: 4, y: 4 } });                      // clic en el fondo oscuro
    await expect(page.locator(MODAL)).toBeVisible();
    expect(terminado).toBe(false);

    await page.keyboard.press('Escape');                                                 // Esc = Volver
    await lanzado;
    await expect(page.locator(MODAL)).toBeHidden();
    expect(reg.escrituras).toEqual([]);
    expect(await page.evaluate(() => ST.ingresos.length + ST.pendientes.length)).toBe(antes);
    expect(await estadoFormulario(page)).toEqual({ ubicacion: 'fiar', cliente: 7, cola: 1 });

    // Y el mismo formulario se puede volver a registrar: ahora se elige «Usar saldo a favor».
    const segundo = page.evaluate(() => agregarIngreso('pendiente'));
    await page.locator(`${MODAL} button[data-eleccion="usar"]`).click();
    await segundo;
    expect(escritura(reg, 'POST', 'pedidos')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 5000 });
  });

  test('«Pagado inmediatamente» con saldo que alcanza tiene TRES botones: pagar con saldo, cobrar normal y volver', async ({ page }) => {
    await abrir(page);
    const lanzado = registrarFiado(page, 7, 15000, 'pagado');
    await expect(page.locator(MODAL)).toBeVisible();
    const botones = await page.locator(`${MODAL} #sis-opciones button`).allInnerTexts();
    expect(botones).toHaveLength(3);
    expect(botones[0]).toContain('✔ Pagar con saldo a favor');
    expect(botones[1]).toContain('💵 Cobrar normal (efectivo)');
    expect(botones[2]).toContain('Volver');
    await page.keyboard.press('Escape');
    await lanzado;
    await expect(page.locator(MODAL)).toBeHidden();
  });

  test('Pendientes→Fiar y Fiados→Asignar: la pregunta sale ANTES de mover; Esc/«Volver» no cambian nada', async ({ page }) => {
    armarDialogos(page, { cliente: 'Luisca', ignorarVentana: true });                    // el selector de cliente se contesta solo; la pregunta de saldo, a mano
    const reg = await abrir(page);
    const mover = page.evaluate(async () => { cambioMesaIds = [903]; await moverPedidoAFiado(); });
    await expect(page.locator(MODAL)).toBeVisible();
    const botones = await page.locator(`${MODAL} #sis-opciones button`).allInnerTexts();
    expect(botones).toHaveLength(2);
    expect(botones[0]).toContain('✔ Usar saldo a favor');
    expect(botones[1]).toContain('Volver');
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);                          // todavía no se movió nada
    await page.keyboard.press('Escape');
    await mover;
    expect(reg.escrituras).toEqual([]);                                                  // ni el pedido, ni la mesa
    expect(await page.evaluate(() => ST.pendientes.find(p => p.id === 903))).toMatchObject({ mesa: 3, es_fiar: false });
    expect(await saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 20000 });

    await irA(page, 'fiados');
    await page.selectOption('#huerfano-cliente-g-huerfano', '7');
    const asignar = page.evaluate(() => asignarClienteAHuerfano([902], 'g-huerfano'));   // lo mismo que hace el botón «Asignar»; así se espera hasta el final
    await expect(page.locator(MODAL)).toBeVisible();
    await page.keyboard.press('Escape');
    await asignar;
    expect(reg.escrituras).toEqual([]);
    expect(await page.evaluate(() => ST.pendientes.find(p => p.id === 902).cliente_fiado_id)).toBeNull();
  });

  test('tarjeta de Fiados: si hay pedidos pendientes y saldo a favor, bajo el neto se ve la cuenta; si no hay ambos, no', async ({ page }) => {
    const extra = { pedidos: [fiadoDe(910, 7, 14000, 'g-luisca-viejo', { fecha: '2026-10-10' })] };   // un fiado pendiente de Luisca (por ejemplo tras «↩ Deshacer»)
    await abrir(page, { extra });
    await irA(page, 'fiados');
    const tarjetaLuisca = page.locator('#fiados-clientes-zone .pending-group', { hasText: 'Luisca' });
    await expect(tarjetaLuisca.locator('.pending-group-total')).toContainText('a favor $6.000');             // el neto de siempre
    await expect(tarjetaLuisca.locator('.cuenta-saldo-favor')).toHaveText('$14.000 en pedidos − $20.000 a favor');
    // Marta debe 12.000 y no tiene saldo; Ana tiene saldo y ninguna deuda: ninguna lleva la línea.
    await expect(page.locator('#fiados-clientes-zone .pending-group', { hasText: 'Marta' }).locator('.cuenta-saldo-favor')).toHaveCount(0);
    await expect(page.locator('#fiados-clientes-zone .pending-group', { hasText: 'Ana' }).locator('.cuenta-saldo-favor')).toHaveCount(0);
  });
});

test.describe('1) Pedidos → «Fiar» con un cliente', () => {
  test('saldo que alcanza: pregunta, y al aceptar salda el pedido con el saldo sin sumar plata a ningún cierre (con caja)', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    const efectivoAntes = await page.evaluate(() => ST.ingresos.reduce((a, p) => a + efectivoDe(p), 0));
    await registrarFiado(page, 7, 15000);

    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].tipo).toBe('modal');
    expect(dialogos[0].mensaje).toContain('Luisca tiene $20.000 a favor y este pedido cuesta $15.000');
    expect(dialogos[0].mensaje).toContain('✔ Usar saldo a favor');
    expect(dialogos[0].mensaje).toContain('Volver');
    expect(dialogos[0].mensaje).not.toContain('Dejarlo fiado');                          // con saldo que alcanza, un fiado no puede quedar «sin usar el saldo»
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
    expect(dialogos[0].tipo).toBe('modal');
    expect(dialogos[0].mensaje).toContain('Se saldarían 1 fiado(s) más viejo(s) por $6.000');
    expect(dialogos[0].mensaje).toContain('este pedido ($15.000) no alcanza a quedar pagado');
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

test.describe('2) Pendientes → «📒 Fiar» (se pregunta el cliente en una ventana del sistema)', () => {
  test('a un cliente con saldo que alcanza: pregunta el nombre y luego (antes de mover) ofrece el saldo; al aceptar queda saldado y la mesa libre', async ({ page }) => {
    const dialogos = armarDialogos(page, { cliente: 'Luisca' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['selector', 'modal']);
    expect(dialogos[1].mensaje).toContain('Luisca tiene $20.000 a favor y este pedido pasa a ser fiado suyo ($9.000)');
    expect(dialogos[1].mensaje).toContain('Se saldarían 1 pedido(s) completo(s) por $9.000');
    expect(dialogos[1].mensaje).toContain('Volver');
    expect(dialogos[1].mensaje).not.toContain('No usar por ahora');
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

  test('a un cliente sin saldo (Marta): solo pregunta el cliente', async ({ page }) => {
    const dialogos = armarDialogos(page, { cliente: 'Marta Pérez' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['selector']);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);       // solo el cambio a fiado
    expect(await saldo(page, 8)).toMatchObject({ pendiente: 21000, sobrante: 0 });
  });

  test('a un cliente nuevo (sin historial): se crea y no hay aviso', async ({ page }) => {
    const dialogos = armarDialogos(page, { clienteNuevo: 'Cliente Nuevo' });
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['selector']);
    expect(escritura(reg, 'POST', 'clientes_fiado')).toHaveLength(1);
    expect((await toastsTexto(page)).join(' | ')).not.toContain('a favor');
  });

  test('a un cliente con saldo que no alcanza (Pedro): avisa sin preguntar', async ({ page }) => {
    const dialogos = armarDialogos(page, { cliente: 'Pedro Gómez' });
    await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['selector']);
    expect((await toastsTexto(page)).join(' | ')).toContain('Pedro Gómez tiene $5.000 a favor');
  });

  test('si se pulsa «Volver» en el selector, el pedido no pasa a fiado (nunca queda un fiado sin nombre) y no hay aviso', async ({ page }) => {
    const dialogos = armarDialogos(page);                                                // sin cliente → «Volver»
    const reg = await abrir(page);
    await pasarPendienteAFiado(page, [903]);
    expect(dialogos.map(d => d.tipo)).toEqual(['selector']);
    expect(reg.escrituras).toEqual([]);                                                  // ni el pedido, ni la mesa, ni un cliente
    expect(await page.evaluate(() => ST.pendientes.find(p => p.id === 903))).toMatchObject({ mesa: 3, es_fiar: false });
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
    expect(dialogos[0].mensaje).toContain('Luisca tiene $20.000 a favor y este fiado pasa a ser suyo ($9.000)');
    expect(dialogos[0].mensaje).toContain('por $9.000');
    expect(escritura(reg, 'PATCH', 'pedidos')[1].cuerpo).toMatchObject({ estado: 'pagado', pagado_via_abono: true });
    await expect.poll(() => saldo(page, 7)).toMatchObject({ pendiente: 0, sobrante: 11000 });      // (con el equipo cargado, la pantalla tarda un instante en rehacer el saldo)
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
    expect(dialogos[1].mensaje).toContain('Luisca tiene $5.000 a favor y este pedido cuesta $4.000');
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

// ── Cómo se reparte el saldo: orden, cortes y centavos ─────────────────────────────────────────────────────────────────
// Lo que el aviso y la pregunta calculan por adelantado tiene que ser EXACTAMENTE lo que luego hará «✔ Aplicar saldo a
// favor»: del más viejo al más nuevo, pedidos completos, y se corta en el primero que no alcanza.
test.describe('4) El reparto del saldo que se calcula por adelantado', () => {
  test('va por fecha, no por orden de llegada: un pedido con fecha anterior a un fiado ya registrado se paga primero', async ({ page }) => {
    armarDialogos(page);
    const extra = { pedidos: [fiadoDe(950, 10, 5000, 'g-ana-fiado', { fecha: '2026-10-20', hora: '12:00' })] };   // Ana: 5.000 a favor y 5.000 de fiado
    await abrir(page, { extra });
    const r = await page.evaluate(() => ({
      anterior: proyectarSaldoAFavor(10, 5000, '2026-10-19', '10:00'),     // el nuevo es MÁS VIEJO que el fiado registrado
      posterior: proyectarSaldoAFavor(10, 5000, '2026-10-21', '10:00'),    // el nuevo es más nuevo
    }));
    expect(r.anterior).toMatchObject({ esteSePaga: true, nuevosPagados: 1, viejosPagados: 0, quedaria: 0 });
    expect(r.posterior).toMatchObject({ esteSePaga: false, nuevosPagados: 0, viejosPagados: 1, quedaria: 0 });
  });

  test('se corta en el primero que no alcanza: no se salta un fiado viejo grande para pagar uno nuevo pequeño', async ({ page }) => {
    const dialogos = armarDialogos(page);
    const reg = await abrir(page);
    // Pedro: 5.000 a favor y un fiado viejo de 12.000. El saldo NO cubre el viejo, así que tampoco puede ir al nuevo de 4.000.
    expect(await page.evaluate(() => proyectarSaldoAFavor(9, 4000, '2026-10-20', '15:00'))).toMatchObject({ esteSePaga: false, nuevosPagados: 0, viejosPagados: 0 });
    await registrarFiado(page, 9, 4000);
    expect(dialogos).toEqual([]);                                                        // no hay nada que preguntar
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(0);                          // y no se salda ningún pedido
    expect((await saldo(page, 9)).sobrante).toBe(5000);
  });

  test('la comparación aguanta los centavos de las sumas con decimales (10.000,3 + 0,3 alcanza para 10.000,6)', async ({ page }) => {
    armarDialogos(page);
    const d = datosAviso();
    d.abonos_fiado = d.abonos_fiado.filter(a => a.cliente_fiado_id !== 10).concat([abonoDe(20, 10, 10000.3), abonoDe(21, 10, 0.3)]);
    await abrir(page, { datos: d });
    const sobrante = (await saldo(page, 10)).sobrante;
    expect(sobrante).toBeLessThan(10000.6);                                              // la suma en decimales binarios se queda unas billonésimas corta…
    expect(await page.evaluate(() => proyectarSaldoAFavor(10, 10000.6, '2026-10-20', '15:00'))).toMatchObject({ esteSePaga: true, nuevosPagados: 1 });   // …y aun así alcanza
  });

  test('un cliente SIN saldo no recibe nunca la pregunta, ni siquiera con un pedido de $0', async ({ page }) => {
    const dialogos = armarDialogos(page);
    await abrir(page);
    // Marta (8) no tiene saldo a favor. Un pedido de $0 (p. ej. un obsequio) con fecha anterior a su fiado "cabría" en $0.
    const respuesta = await page.evaluate(() => preguntarSaldoAntesDeFiar(8,
      [{ id: 905, fecha: '2026-10-01', hora: '10:00', monto_total: 0, grupo_pedido: 'g-obsequio' }], 'pasar'));
    expect(respuesta).toBe('nada');
    expect(dialogos).toEqual([]);
  });

  test('la ventana también muestra un nombre con símbolos como texto, sin interpretarlo como código', async ({ page }) => {
    const dialogos = armarDialogos(page, { eleccion: 'volver' });
    const datos = datosAviso();
    datos.clientes_fiado.push({ id: 11, nombre: '<i>Raro</i> & Co', created_at: '2026-10-01T10:20:00-05:00' });
    datos.abonos_fiado.push(abonoDe(4, 11, 20000));
    await abrir(page, { datos });
    await registrarFiado(page, 11, 14000);
    expect(dialogos).toHaveLength(1);
    expect(dialogos[0].mensaje).toContain('💰 <i>Raro</i> & Co tiene saldo a favor');     // título tal cual
    expect(dialogos[0].mensaje).toContain('<i>Raro</i> & Co tiene $20.000 a favor y este pedido cuesta $14.000');   // y el cuerpo
  });
});
