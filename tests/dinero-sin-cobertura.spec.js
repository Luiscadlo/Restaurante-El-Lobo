// Funciones que mueven plata y no tenían prueba propia (revisión final, anexo B): cobrar «gratis», mover un pedido de mesa o a «sin mesa»,
// ingreso adicional (crear y editar) y editar un gasto del día (que ahora también ajusta el cierre de un turno ya cerrado).
// Todo contra el backend falso: nada toca tu Supabase real.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

const copia = x => JSON.parse(JSON.stringify(x));
const esc = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const toast = (page, texto) => page.locator('.toast', { hasText: texto });
const estaEn = (page, lista, id) => page.evaluate(([l, i]) => ST[l].some(p => p.id === i), [lista, id]);
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const abrir = (page, opciones = {}) => { aceptarAvisos(page); return abrirSistema(page, { usuario: 'admin', ...opciones }); };

test.describe('marcarGrupoGratisPagado — entregar un pedido gratis', () => {
  test('pasa a pagado con método «gratis», sin plata en efectivo ni transferencia, y se puede deshacer', async ({ page }) => {
    const reg = await abrir(page);
    await page.evaluate(() => marcarGrupoGratisPagado([203]));
    const [patch] = esc(reg, 'PATCH', 'pedidos');
    expect(patch.cuerpo).toMatchObject({ estado: 'pagado', metodo: 'gratis', monto_efectivo: 0, monto_transferencia: 0 });
    expect(await estaEn(page, 'ingresos', 203)).toBe(true);
    expect(await estaEn(page, 'pendientes', 203)).toBe(false);
    expect(await page.evaluate(() => { const p = ST.ingresos.find(x => x.id === 203); return [efectivoDe(p), transferenciaDe(p)]; })).toEqual([0, 0]);
    await expect(toast(page, 'Pedido gratis marcado como entregado')).toBeVisible();
  });

  test('si el servidor falla: el pedido SIGUE pendiente y se avisa', async ({ page }) => {
    const reg = await abrir(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'servidor' });
    await page.evaluate(() => marcarGrupoGratisPagado([203]));
    await expect(toast(page, 'Error al confirmar la entrega')).toBeVisible();
    expect(await estaEn(page, 'pendientes', 203)).toBe(true);
    expect(await estaEn(page, 'ingresos', 203)).toBe(false);
  });
});

test.describe('moverPedidoAMesa / moverPedidoASinMesa — cambiar un pedido pendiente de lugar', () => {
  test('a otra mesa: el pedido cambia de mesa, la anterior se libera, la nueva se ocupa y el monto no cambia', async ({ page }) => {
    const reg = await abrir(page);
    const monto = await page.evaluate(() => ST.pendientes.find(p => p.id === 203).monto_total);
    await page.evaluate(() => { cambioMesaIds = [203]; return moverPedidoAMesa(5); });
    expect(esc(reg, 'PATCH', 'pedidos')[0].cuerpo).toMatchObject({ mesa: 5, es_sin_mesa: false, es_domicilio: false, es_fiar: false });
    expect(esc(reg, 'PATCH', 'mesas').map(e => [e.consulta, e.cuerpo.estado])).toEqual([['?numero=eq.3', 'libre'], ['?numero=eq.5', 'ocupada']]);
    const p = await page.evaluate(() => ST.pendientes.find(x => x.id === 203));
    expect(p.mesa).toBe(5);
    expect(p.monto_total).toBe(monto);
  });

  test('a la misma mesa: no se escribe nada', async ({ page }) => {
    const reg = await abrir(page);
    await page.evaluate(() => { cambioMesaIds = [203]; return moverPedidoAMesa(3); });
    expect(reg.escrituras).toHaveLength(0);
  });

  test('a otra mesa con el servidor caído: el pedido se queda donde estaba y se avisa', async ({ page }) => {
    const reg = await abrir(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'servidor' });
    await page.evaluate(() => { cambioMesaIds = [203]; return moverPedidoAMesa(5); });
    await expect(toast(page, 'Error al cambiar de mesa')).toBeVisible();
    expect(await page.evaluate(() => ST.pendientes.find(x => x.id === 203).mesa)).toBe(3);
    expect(esc(reg, 'PATCH', 'mesas')).toHaveLength(0);
  });

  test('a «Sin mesa»: el pedido deja la mesa (queda libre) y no cambia su monto', async ({ page }) => {
    const reg = await abrir(page);
    const monto = await page.evaluate(() => ST.pendientes.find(p => p.id === 203).monto_total);
    await page.evaluate(() => { cambioMesaIds = [203]; return moverPedidoASinMesa(); });
    expect(esc(reg, 'PATCH', 'pedidos')[0].cuerpo).toMatchObject({ mesa: null, es_sin_mesa: true, es_domicilio: false, es_fiar: false });
    expect(esc(reg, 'PATCH', 'mesas').map(e => [e.consulta, e.cuerpo.estado])).toEqual([['?numero=eq.3', 'libre']]);
    const p = await page.evaluate(() => ST.pendientes.find(x => x.id === 203));
    expect([p.mesa, p.es_sin_mesa, p.monto_total]).toEqual([null, true, monto]);
  });

  test('a «Sin mesa» cuando ya estaba sin mesa: no se escribe nada', async ({ page }) => {
    const reg = await abrir(page);
    await page.evaluate(() => { const p = ST.pendientes.find(x => x.id === 203); p.mesa = null; p.es_sin_mesa = true; cambioMesaIds = [203]; return moverPedidoASinMesa(); });
    expect(reg.escrituras).toHaveLength(0);
  });

  test('a «Sin mesa» con el servidor caído: el pedido SIGUE en su mesa', async ({ page }) => {
    const reg = await abrir(page);
    reg.control.fallasEscritura.push({ tabla: 'pedidos', metodo: 'PATCH', tipo: 'servidor' });
    await page.evaluate(() => { cambioMesaIds = [203]; return moverPedidoASinMesa(); });
    await expect(toast(page, 'Error al cambiar de mesa')).toBeVisible();
    expect(await page.evaluate(() => ST.pendientes.find(x => x.id === 203).mesa)).toBe(3);
  });
});

test.describe('ingreso adicional — crear y editar', () => {
  const llenar = (page, { fecha = FECHA_HOY, desc = 'Venta de empaques', monto = '12.500' } = {}) => page.evaluate(([f, d, m]) => {
    document.getElementById('ingext-fecha').value = f;
    document.getElementById('ingext-desc').value = d;
    document.getElementById('ingext-monto').value = m;
  }, [fecha, desc, monto]);

  test('crear: guarda fecha, descripción, monto y cuenta; aparece en la lista y limpia el formulario', async ({ page }) => {
    const reg = await abrir(page);
    await irA(page, 'ingfin');
    await llenar(page);
    await page.evaluate(() => agregarIngresoExtra());
    const [fila] = esc(reg, 'POST', 'ingresos_extra');
    expect(fila.cuerpo).toMatchObject({ fecha: FECHA_HOY, descripcion: 'Venta de empaques', monto: 12500 });
    expect(await page.evaluate(() => ST.ingresosExtra.length)).toBe(1);
    expect(await page.inputValue('#ingext-desc')).toBe('');
    await expect(toast(page, 'Ingreso adicional registrado')).toBeVisible();
  });

  test('sin descripción, sin monto o con monto cero: no se escribe nada', async ({ page }) => {
    const reg = await abrir(page);
    await irA(page, 'ingfin');
    await llenar(page, { desc: '' });
    await page.evaluate(() => agregarIngresoExtra());
    await llenar(page, { monto: '' });
    await page.evaluate(() => agregarIngresoExtra());
    await llenar(page, { monto: '0' });
    await page.evaluate(() => agregarIngresoExtra());
    expect(esc(reg, 'POST', 'ingresos_extra')).toHaveLength(0);
  });

  test('el servidor falla: no queda en la lista y se avisa', async ({ page }) => {
    const reg = await abrir(page);
    reg.control.fallasEscritura.push({ tabla: 'ingresos_extra', metodo: 'POST', tipo: 'servidor' });
    await irA(page, 'ingfin');
    await llenar(page);
    await page.evaluate(() => agregarIngresoExtra());
    await expect(toast(page, 'Error al registrar ingreso')).toBeVisible();
    expect(await page.evaluate(() => ST.ingresosExtra.length)).toBe(0);
  });

  async function conUnIngreso(page) {
    const datos = copia(DATOS_BASE);
    datos.ingresos_extra = [{ id: 77, fecha: FECHA_HOY, descripcion: 'Evento', monto: 40000, cuenta: 'efectivo' }];
    const reg = await abrir(page, { datos });
    await irA(page, 'ingfin');
    await page.evaluate(() => editarIngresoExtra(77));
    return reg;
  }

  test('editar: cambia el monto y la descripción y manda el cambio', async ({ page }) => {
    const reg = await conUnIngreso(page);
    await page.fill('#ingext-edit-monto-77', '55.000');
    await page.fill('#ingext-edit-desc-77', 'Evento privado');
    await page.evaluate(() => guardarEdicionIngresoExtra(77));
    expect(esc(reg, 'PATCH', 'ingresos_extra')[0].cuerpo).toMatchObject({ monto: 55000, descripcion: 'Evento privado', fecha: FECHA_HOY });
    expect(await page.evaluate(() => ST.ingresosExtra.find(i => i.id === 77).monto)).toBe(55000);
    await expect(toast(page, 'Ingreso actualizado')).toBeVisible();
  });

  test('editar con monto vacío o sin descripción: no se escribe nada', async ({ page }) => {
    const reg = await conUnIngreso(page);
    await page.fill('#ingext-edit-monto-77', '');
    await page.evaluate(() => guardarEdicionIngresoExtra(77));
    await page.fill('#ingext-edit-monto-77', '40.000');
    await page.fill('#ingext-edit-desc-77', '  ');
    await page.evaluate(() => guardarEdicionIngresoExtra(77));
    expect(esc(reg, 'PATCH', 'ingresos_extra')).toHaveLength(0);
  });

  test('editar con el servidor caído: el monto de la lista NO cambia', async ({ page }) => {
    const reg = await conUnIngreso(page);
    reg.control.fallasEscritura.push({ tabla: 'ingresos_extra', metodo: 'PATCH', tipo: 'servidor' });
    await page.fill('#ingext-edit-monto-77', '55.000');
    await page.evaluate(() => guardarEdicionIngresoExtra(77));
    await expect(toast(page, 'Error al actualizar')).toBeVisible();
    expect(await page.evaluate(() => ST.ingresosExtra.find(i => i.id === 77).monto)).toBe(40000);
  });
});

test.describe('guardarEdicionGastoDia — editar un gasto del turno', () => {
  // El gasto de ejemplo (id 1, 18-oct, almuerzo, $6.000, «otro»). Los datos de ejemplo ya traen el cierre de ese turno: gastos $90.000 y
  // resultado $490.000.
  async function abrirConCierre(page, conCierre = true) {
    const datos = copia(DATOS_BASE);
    if (!conCierre) datos.cierres_dia = datos.cierres_dia.filter(c => !(c.fecha === '2026-10-18' && c.turno === 'almuerzo'));
    const reg = await abrir(page, { datos });
    await irA(page, 'diaadia');
    await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-18'; ddTurno = 'almuerzo'; viendoHistorialCierre = true; editarGastoDia(1); });   // «Corregir cierre»: aquí se ven y se editan los gastos de un turno ya cerrado
    await expect(page.locator('#dd-edit-monto-1')).toBeVisible();
    return reg;
  }
  const cierre = page => page.evaluate(() => { const c = ST.cierresDia.find(x => x.fecha === '2026-10-18' && x.turno === 'almuerzo'); return c && [c.gastos, c.resultado]; });

  test('sin cierre guardado: solo cambia el gasto', async ({ page }) => {
    const reg = await abrirConCierre(page, false);
    await page.fill('#dd-edit-monto-1', '9.000');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    expect(esc(reg, 'PATCH', 'gastos_dia')[0].cuerpo).toMatchObject({ monto: 9000 });
    expect(esc(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await page.evaluate(() => ST.gastosDia.find(g => g.id === 1).monto)).toBe(9000);
  });

  test('con cierre guardado: el cierre cambia en la diferencia (gastos +3.000, resultado −3.000)', async ({ page }) => {
    const reg = await abrirConCierre(page);
    await page.fill('#dd-edit-monto-1', '9.000');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    expect(esc(reg, 'PATCH', 'cierres_dia')[0].cuerpo).toEqual({ gastos: 93000, resultado: 487000 });
    expect(await cierre(page)).toEqual([93000, 487000]);
    await expect(toast(page, 'Gasto actualizado')).toBeVisible();
  });

  test('un gasto que pasa a «Préstamo» (no cuenta como gasto) baja los gastos del cierre', async ({ page }) => {
    const reg = await abrirConCierre(page);
    const hayPrestamo = await page.evaluate(() => !!document.querySelector('#dd-edit-cat-1 option[value="prestamo"]'));
    test.skip(!hayPrestamo, 'esta lista de categorías no ofrece «prestamo»');
    await page.selectOption('#dd-edit-cat-1', 'prestamo');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    expect(esc(reg, 'PATCH', 'cierres_dia')[0].cuerpo).toEqual({ gastos: 84000, resultado: 496000 });
  });

  test('monto vacío: no se escribe nada', async ({ page }) => {
    const reg = await abrirConCierre(page);
    await page.fill('#dd-edit-monto-1', '');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    expect(reg.escrituras.filter(e => e.metodo === 'PATCH')).toHaveLength(0);
  });

  test('el servidor rechaza el cambio del gasto: el gasto y el cierre quedan como estaban', async ({ page }) => {
    const reg = await abrirConCierre(page);
    reg.control.fallasEscritura.push({ tabla: 'gastos_dia', metodo: 'PATCH', tipo: 'servidor' });
    await page.fill('#dd-edit-monto-1', '9.000');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    await expect(toast(page, 'Error al actualizar')).toBeVisible();
    expect(await page.evaluate(() => ST.gastosDia.find(g => g.id === 1).monto)).toBe(6000);
    expect(await cierre(page)).toEqual([90000, 490000]);
  });

  test('el gasto se cambió pero el cierre no se pudo actualizar: avisa que hay que corregir el cierre', async ({ page }) => {
    const reg = await abrirConCierre(page);
    reg.control.fallasEscritura.push({ tabla: 'cierres_dia', metodo: 'PATCH', tipo: 'servidor' });
    await page.fill('#dd-edit-monto-1', '9.000');
    await page.evaluate(() => guardarEdicionGastoDia(1));
    await expect(toast(page, 'no se pudo actualizar el cierre de ese turno')).toBeVisible();
    expect(await cierre(page)).toEqual([90000, 490000]);
  });
});
