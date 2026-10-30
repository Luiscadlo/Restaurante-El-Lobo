// Abonos de fiado: eliminar un abono (por error o de prueba) y qué pasa con el saldo del cliente.
//
// Nació de un caso real (24-oct-2026): un fiado de 12.000 saldado con un abono de 12.000 → "deshacer" (↩) desde
// Ingresos → cancelar el pedido que volvió a Fiados. El pedido desaparecía, pero el ABONO seguía: el cierre del día
// aún mostraba "Luisca $12.000", el cliente quedaba con saldo a favor invisible, y no existía ningún botón para
// quitar el abono. Ahora un administrador puede eliminarlo desde Fiados, con la regla de siempre: lo abonado tiene
// que seguir cubriendo los pedidos ya saldados con abonos.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { entrarComoAdmin } = require('./helpers/sesion');
const { datos: BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

const copia = x => JSON.parse(JSON.stringify(x));
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);

test.beforeEach(async ({ page }) => { aceptarAvisos(page); });

const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

// Un solo cliente (Luisca) con un fiado pendiente de 12.000 y nada más (sin cierres guardados).
function datosLuisca() {
  const d = copia(BASE);
  d.pedidos = [{ ...copia(BASE.pedidos[0]), id: 900, estado: 'pendiente', metodo: 'fiado', es_fiar: true,
    cliente_fiado_id: 7, monto_total: 12000, monto_unit: 12000, monto_almuerzo: 12000, grupo_pedido: 'g-luisca' }];
  d.abonos_fiado = []; d.cierres_dia = [];
  d.clientes_fiado = [{ id: 7, nombre: 'Luisca', created_at: '2026-10-01T10:00:00-05:00' }];
  return d;
}
const zonaFiados = page => page.evaluate(() => document.getElementById('fiados-clientes-zone').innerText.replace(/\s+/g, ' '));
async function abonarTodo(page) {
  await irA(page, 'fiados');
  await page.evaluate(async () => { document.getElementById('abono-monto-7').value = '12.000'; await registrarAbonoFiado(7); });
}

test.describe('eliminar un abono de fiado', () => {
  test('la secuencia real: abono → ↩ → cancelar el pedido deja el abono visible, y el admin puede quitarlo', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosLuisca(), usuario: 'admin' });
    await abonarTodo(page);
    await page.evaluate(() => revertirPago([900]));          // ↩ en el historial de Ingresos
    await irA(page, 'fiados');
    // El pedido vuelve a Fiados, pero el abono lo cubre: el cliente figura en $0 con saldo a favor.
    expect(await zonaFiados(page)).toContain('saldo a favor $12.000');
    await page.evaluate(() => cancelarGrupoPendiente([900], null));   // ✕ en Fiados

    // El pedido se fue; el abono NO (la plata se recibió): sigue en el cierre y el cliente no desaparece.
    const v = await page.evaluate(() => ({
      saldo: calcularSaldoFiado(7).saldo, enCierre: abonosDeTurno(today(), 'almuerzo').map(a => a.monto),
    }));
    expect(v.saldo).toBe(-12000);
    expect(v.enCierre).toEqual([12000]);
    const vista = await zonaFiados(page);
    expect(vista).toContain('Luisca');
    expect(vista).toContain('a favor $12.000');
    expect(vista).not.toContain('Sin fiados pendientes');
    // y la insignia de "fiados por cobrar" NO cuenta a un cliente que solo tiene saldo a favor
    await expect(page.locator('#fiados-badge')).toBeHidden();

    // El administrador lo elimina con el botón 🗑.
    await expect(page.locator('#fiados-clientes-zone button[title^="Eliminar este abono"]')).toHaveCount(1);
    await page.evaluate(() => eliminarAbonoFiado(ST.abonosFiado[0].id));
    const del = escritura(reg, 'DELETE', 'abonos_fiado');
    expect(del).toHaveLength(1);
    expect(del[0].rol).toBe('admin');
    expect(reg.denegadas).toEqual([]);
    const despues = await page.evaluate(() => ({
      abonos: ST.abonosFiado.length, enCierre: abonosDeTurno(today(), 'almuerzo').length, saldo: calcularSaldoFiado(7).saldo,
    }));
    expect(despues).toEqual({ abonos: 0, enCierre: 0, saldo: 0 });
    expect(await zonaFiados(page)).toContain('Sin fiados pendientes');
  });

  test('NO se puede eliminar un abono con el que se saldó un pedido: avisa que primero se devuelva con ↩', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosLuisca(), usuario: 'admin' });
    await abonarTodo(page);                                   // pedido 900 queda saldado vía abono
    await page.evaluate(() => eliminarAbonoFiado(ST.abonosFiado[0].id));
    await expect(page.locator('.toast.warning').last()).toContainText('descuadrado');
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(0);
    expect(await page.evaluate(() => ST.abonosFiado.length)).toBe(1);

    // Tras ↩ (el pedido vuelve a pendiente), ya se puede.
    await page.evaluate(() => revertirPago([900]));
    await page.evaluate(() => eliminarAbonoFiado(ST.abonosFiado[0].id));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(1);
    // El fiado sigue debiendo los 12.000, ahora sin abono.
    expect(await page.evaluate(() => calcularSaldoFiado(7).saldo)).toBe(12000);
  });

  test('con varios abonos, solo se bloquea el que dejaría sin cubrir lo ya saldado', async ({ page }) => {
    const d = datosLuisca();
    const reg = await abrirSistema(page, { datos: d, usuario: 'admin' });
    await page.evaluate(() => {
      // abonó 20.000 en dos veces; ya se saldaron 12.000 con ellos
      ST.abonosFiado = [{ id: 1, cliente_fiado_id: 7, monto: 8000, fecha: today(), turno: 'almuerzo', cuenta: 'efectivo' },
                        { id: 2, cliente_fiado_id: 7, monto: 12000, fecha: today(), turno: 'almuerzo', cuenta: 'efectivo' }];
      const p = ST.pendientes.shift();
      Object.assign(p, { estado: 'pagado', pagado_via_abono: true, fecha_pago: today(), turno_pago: 'almuerzo' });
      ST.ingresos.unshift(p);
    });
    // Quitar el de 12.000 deja 8.000 < 12.000 saldados → bloqueado.
    await page.evaluate(() => eliminarAbonoFiado(2));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(0);
    // Quitar el de 8.000 deja 12.000 ≥ 12.000 saldados → permitido.
    await page.evaluate(() => eliminarAbonoFiado(1));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(1);
  });

  test('si el abono está en un cierre ya guardado, tras eliminarlo se abre "Corregir cierre"', async ({ page }) => {
    const d = datosLuisca();
    const reg = await abrirSistema(page, { datos: d, usuario: 'admin' });
    const hoy = await page.evaluate(() => today());
    await page.evaluate(h => {
      ST.abonosFiado = [{ id: 1, cliente_fiado_id: 7, monto: 5000, fecha: h, turno: 'almuerzo', cuenta: 'efectivo' }];
      ST.cierresDia = [{ id: 1, fecha: h, turno: 'almuerzo', efectivo: 5000, transferencia: 0, abonos_efectivo: 5000, abonos_transferencia: 0 }];
    }, hoy);
    await page.evaluate(() => eliminarAbonoFiado(1));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(1);
    await expect(page.locator('#tab-diaadia')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.getElementById('dd-fecha').value)).toBe(hoy);
  });

  test('caja no ve el botón 🗑 y, aunque llame la función a mano, no se elimina nada', async ({ page }) => {
    const d = datosLuisca();
    const reg = await abrirSistema(page, { datos: d });        // sesión de caja
    await page.evaluate(() => {
      ST.abonosFiado = [{ id: 1, cliente_fiado_id: 7, monto: 5000, fecha: today(), turno: 'almuerzo', cuenta: 'efectivo' }];
      renderAll();
    });
    await irA(page, 'fiados');
    await page.locator('#fiados-clientes-zone .pending-group-hdr').first().click();
    await expect(page.locator('#fiados-clientes-zone')).toContainText('5.000');
    await expect(page.locator('#fiados-clientes-zone button[title^="Eliminar este abono"]')).toHaveCount(0);
    await page.evaluate(() => eliminarAbonoFiado(1));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(0);
    await expect(page.locator('.toast.warning').last()).toContainText('administrador');
  });

  test('un administrador autorizado en el sitio sí ve el botón 🗑 en el abono', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosLuisca() });   // empieza como caja
    await page.evaluate(() => {
      ST.abonosFiado = [{ id: 1, cliente_fiado_id: 7, monto: 5000, fecha: today(), turno: 'almuerzo', cuenta: 'efectivo' }];
    });
    await entrarComoAdmin(page);
    await irA(page, 'fiados');
    await expect(page.locator('#fiados-clientes-zone button[title^="Eliminar este abono"]')).toHaveCount(1);
    expect(reg.errores).toEqual([]);
  });
});
