// Saldo a favor: el formulario «Registrar saldo a favor» de la pestaña Fiados.
//
// Pregunta del dueño (24-oct-2026): si un cliente me debe 15.000 y paga con un billete de 20.000 y no tengo para
// devolverle 5.000, ¿cómo creo esos 5.000 de saldo a favor para descontárselos en un próximo pedido? Hasta ahora
// solo se creaba si el cliente YA tenía un fiado pendiente (abonaba de más); con un cliente sin deuda no había forma.
// El formulario registra un abono para cualquier cliente (de la lista o nuevo): la plata entra a la caja del
// turno como cualquier abono y el cliente queda con saldo a favor.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); });

// Luisca (id 7): sin deuda ni abonos. Marta Pérez (id 8): debe 12.000. Sin cierres guardados.
function datosSaldo() {
  const d = copia(BASE);
  d.abonos_fiado = []; d.cierres_dia = [];
  d.clientes_fiado = [
    { id: 7, nombre: 'Luisca', created_at: '2026-10-01T10:00:00-05:00' },
    { id: 8, nombre: 'Marta Pérez', created_at: '2026-10-01T10:05:00-05:00' },
  ];
  d.pedidos = [{ ...copia(BASE.pedidos[0]), id: 900, estado: 'pendiente', metodo: 'fiado', es_fiar: true,
    cliente_fiado_id: 8, monto_total: 12000, monto_unit: 12000, monto_almuerzo: 12000, grupo_pedido: 'g-marta' }];
  return d;
}

async function abrir(page, opciones = {}) {
  const reg = await abrirSistema(page, { datos: datosSaldo(), ...opciones });   // por defecto: sesión de caja
  await irA(page, 'fiados');
  return reg;
}
// Llena el formulario; cada campo es opcional.
async function llenar(page, { cliente, nuevo, monto, cuenta, nota }) {
  if (cliente !== undefined) await page.selectOption('#saf-cliente', String(cliente));
  if (nuevo !== undefined) await page.fill('#saf-nuevo', nuevo);
  if (monto !== undefined) await page.fill('#saf-monto', monto);
  if (cuenta !== undefined) await page.selectOption('#saf-cuenta', cuenta);
  if (nota !== undefined) await page.fill('#saf-nota', nota);
}
const registrar = page => page.locator('#btn-saf').click();
const zona = page => page.evaluate(() => document.getElementById('fiados-clientes-zone').innerText.replace(/\s+/g, ' '));
const ultimoToast = page => page.locator('.toast').last();

test.describe('formulario «Registrar saldo a favor»', () => {
  test('cliente que no debe nada: queda con saldo a favor y la plata entra al cierre del turno (con caja)', async ({ page }) => {
    const reg = await abrir(page);
    await expect(page.locator('#saf-panel')).toBeVisible();
    await llenar(page, { cliente: 7, monto: '5000', nota: 'Cambio que no tenía' });
    await registrar(page);

    await expect(ultimoToast(page)).toContainText('Saldo a favor registrado: Luisca tiene $5.000 a favor');
    const post = escritura(reg, 'POST', 'abonos_fiado');
    expect(post).toHaveLength(1);
    expect(post[0].rol).toBe('caja');
    expect(post[0].cuerpo).toMatchObject({ cliente_fiado_id: 7, monto: 5000, cuenta: 'efectivo', fecha: FECHA_HOY, turno: 'almuerzo', nota: 'Cambio que no tenía' });
    expect(escritura(reg, 'POST', 'clientes_fiado')).toHaveLength(0);   // el cliente ya existía

    const v = await page.evaluate(() => ({ s: calcularSaldoFiado(7), enCierre: abonosDeTurno(today(), 'almuerzo').map(a => a.monto) }));
    expect(v.s.sobrante).toBe(5000);
    expect(v.s.saldo).toBe(-5000);
    expect(v.enCierre).toEqual([5000]);                                  // la plata entra al cierre de hoy (almuerzo)
    expect(await zona(page)).toContain('saldo a favor $5.000');
    // el formulario queda limpio
    expect(await page.inputValue('#saf-monto')).toBe('');
    expect(await page.inputValue('#saf-nota')).toBe('');
    expect(await page.inputValue('#saf-cliente')).toBe('');
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('transferencia: el abono se guarda con esa cuenta', async ({ page }) => {
    const reg = await abrir(page, { usuario: 'admin' });
    await llenar(page, { cliente: 7, monto: '8000', cuenta: 'transferencia' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Saldo a favor registrado');
    const post = escritura(reg, 'POST', 'abonos_fiado');
    expect(post).toHaveLength(1);
    expect(post[0].cuerpo.cuenta).toBe('transferencia');
    expect(post[0].cuerpo.monto).toBe(8000);
    expect((await page.evaluate(() => abonosDeTurno(today(), 'almuerzo').map(a => a.cuenta)))).toEqual(['transferencia']);
  });

  test('cliente nuevo: se crea y queda con el saldo a favor; aparece en la lista del formulario', async ({ page }) => {
    const reg = await abrir(page);
    await llenar(page, { nuevo: '  Pedro   Gómez ', monto: '3000' });
    await registrar(page);
    await expect.poll(() => escritura(reg, 'POST', 'abonos_fiado').length).toBe(1);
    const creados = escritura(reg, 'POST', 'clientes_fiado');
    expect(creados).toHaveLength(1);
    expect(creados[0].cuerpo.nombre).toBe('Pedro Gómez');                // espacios sobrantes limpiados
    const abono = escritura(reg, 'POST', 'abonos_fiado');
    expect(abono).toHaveLength(1);
    expect(abono[0].cuerpo.monto).toBe(3000);
    const nuevoId = await page.evaluate(() => ST.clientesFiado.find(c => c.nombre === 'Pedro Gómez').id);
    expect(abono[0].cuerpo.cliente_fiado_id).toBe(nuevoId);
    expect(await zona(page)).toContain('Pedro Gómez');
    expect(await page.locator('#saf-cliente option').allTextContents()).toContain('Pedro Gómez');
    expect(await page.inputValue('#saf-nuevo')).toBe('');
  });

  test('si escribes un nombre que ya existe (otras tildes o mayúsculas) usa ese cliente y NO crea otro', async ({ page }) => {
    const reg = await abrir(page);
    await llenar(page, { nuevo: 'marta perez', monto: '2000' });
    await registrar(page);
    expect(escritura(reg, 'POST', 'clientes_fiado')).toHaveLength(0);
    const abono = escritura(reg, 'POST', 'abonos_fiado');
    expect(abono).toHaveLength(1);
    expect(abono[0].cuerpo.cliente_fiado_id).toBe(8);
    expect(await page.evaluate(() => ST.clientesFiado.length)).toBe(2);
  });

  test('validaciones: sin cliente, con los dos a la vez, o sin monto → no escribe nada (ni crea el cliente)', async ({ page }) => {
    const reg = await abrir(page);
    await llenar(page, { monto: '5000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Elige un cliente de la lista o escribe el nombre');

    await llenar(page, { cliente: 7, nuevo: 'Otro Cliente', monto: '5000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('no los dos');

    await llenar(page, { cliente: '', nuevo: 'Cliente Sin Monto', monto: '' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('monto válido');

    await llenar(page, { cliente: 7, nuevo: '', monto: '0' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('monto válido');

    expect(reg.escrituras).toEqual([]);                                  // ni abonos ni clientes nuevos
  });

  test('con un cliente que SÍ debe, funciona como un abono normal (descuenta, y si alcanza salda el pedido)', async ({ page }) => {
    const reg = await abrir(page);
    await llenar(page, { cliente: 8, monto: '5000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Marta Pérez debe $7.000');       // no dice «saldo a favor»: tenía deuda
    expect(await page.evaluate(() => calcularSaldoFiado(8).saldo)).toBe(7000);
    await llenar(page, { cliente: 8, monto: '7000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Fiado de Marta Pérez saldado por completo');
    const v = await page.evaluate(() => ({ s: calcularSaldoFiado(8), pagado: ST.ingresos.some(p => p.id === 900 && p.pagado_via_abono === true), pend: ST.pendientes.length }));
    expect(v.s.saldo).toBe(0);
    expect(v.pagado).toBe(true);
    expect(escritura(reg, 'POST', 'abonos_fiado')).toHaveLength(2);
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);                     // el pedido se salda con el segundo abono
  });

  test('el saldo a favor se gasta en el próximo fiado: «Aplicar saldo a favor» salda el pedido sin meter plata nueva', async ({ page }) => {
    const reg = await abrir(page);
    await llenar(page, { cliente: 7, monto: '5000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Saldo a favor registrado');
    // próximo pedido de Luisca, a fiado por 4.000
    await page.evaluate(() => {
      ST.pendientes.push({ ...ST.pendientes[0], id: 901, cliente_fiado_id: 7, monto_total: 4000, monto_unit: 4000, monto_almuerzo: 4000, grupo_pedido: 'g-luisca-2' });
      renderAll();
    });
    expect(await page.evaluate(() => calcularSaldoFiado(7).saldo)).toBe(-1000);     // 4.000 de deuda − 5.000 a favor
    await expect(page.locator('#fiados-clientes-zone button', { hasText: 'Aplicar saldo a favor' })).toHaveCount(1);
    await page.evaluate(() => aplicarSaldoAFavor(7));
    const v = await page.evaluate(() => ({
      pagado: ST.ingresos.some(p => p.id === 901 && p.pagado_via_abono === true),
      s: calcularSaldoFiado(7), enCierre: abonosDeTurno(today(), 'almuerzo').map(a => a.monto),
    }));
    expect(v.pagado).toBe(true);
    expect(v.s.sobrante).toBe(1000);                                                 // queda 1.000 a favor
    expect(v.enCierre).toEqual([5000]);                                              // no entró plata nueva al cierre
    expect(escritura(reg, 'POST', 'abonos_fiado')).toHaveLength(1);
  });

  test('si el cierre de este turno ya está guardado: pide confirmar; al cancelar no se guarda nada', async ({ page }) => {
    const reg = await abrir(page);
    await page.evaluate(h => { ST.cierresDia = [{ id: 1, fecha: h, turno: 'almuerzo', efectivo: 0, transferencia: 0 }]; }, FECHA_HOY);
    page.removeAllListeners('dialog');
    let mensaje = '';
    page.once('dialog', d => { mensaje = d.message(); d.dismiss(); });
    await llenar(page, { cliente: 7, monto: '5000' });
    await registrar(page);
    await expect.poll(() => mensaje).toContain('ya está guardado');
    expect(escritura(reg, 'POST', 'abonos_fiado')).toHaveLength(0);
    expect(await page.evaluate(() => ST.abonosFiado.length)).toBe(0);
    expect(await page.inputValue('#saf-monto')).toBe('5.000');                       // el formulario NO se limpia: se puede reintentar
  });

  test('si el cierre ya está guardado y se confirma: guarda el abono y abre «Corregir cierre»', async ({ page }) => {
    const reg = await abrir(page, { usuario: 'admin' });
    await page.evaluate(h => { ST.cierresDia = [{ id: 1, fecha: h, turno: 'almuerzo', efectivo: 0, transferencia: 0 }]; }, FECHA_HOY);
    await llenar(page, { cliente: 7, monto: '5000' });
    await registrar(page);
    await expect.poll(() => escritura(reg, 'POST', 'abonos_fiado').length).toBe(1);
    await expect(page.locator('#tab-diaadia')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.getElementById('dd-fecha').value)).toBe(FECHA_HOY);
  });

  test('la lista del formulario trae a TODOS los clientes (también los que no deben) y conserva lo elegido al redibujar', async ({ page }) => {
    await abrir(page);
    expect(await page.locator('#saf-cliente option').allTextContents()).toEqual(['— Elegir cliente —', 'Luisca', 'Marta Pérez']);
    await page.selectOption('#saf-cliente', '8');
    await page.evaluate(() => renderAll());
    expect(await page.inputValue('#saf-cliente')).toBe('8');
  });

  test('el administrador puede quitar el abono (🗑); caja no ve ese botón', async ({ page }) => {
    const reg = await abrir(page, { usuario: 'admin' });
    await llenar(page, { cliente: 7, monto: '5000' });
    await registrar(page);
    await expect(ultimoToast(page)).toContainText('Saldo a favor registrado');
    await page.evaluate(() => { fiadosExpandido.add(7); renderFiados(); });
    await expect(page.locator('#fiados-clientes-zone button[title^="Eliminar este abono"]')).toHaveCount(1);
    await page.evaluate(() => eliminarAbonoFiado(ST.abonosFiado[0].id));
    expect(escritura(reg, 'DELETE', 'abonos_fiado')).toHaveLength(1);
    expect(await zona(page)).not.toContain('Luisca');

    const pagina2 = await page.context().newPage();
    pagina2.on('dialog', d => d.accept());
    await abrirSistema(pagina2, { datos: datosSaldo() });                            // caja
    await irA(pagina2, 'fiados');
    await pagina2.selectOption('#saf-cliente', '7');
    await pagina2.fill('#saf-monto', '5000');
    await pagina2.locator('#btn-saf').click();
    await expect(pagina2.locator('.toast').last()).toContainText('Saldo a favor registrado');
    await pagina2.evaluate(() => { fiadosExpandido.add(7); renderFiados(); });
    await expect(pagina2.locator('#fiados-clientes-zone button[title^="Eliminar este abono"]')).toHaveCount(0);
  });
});
