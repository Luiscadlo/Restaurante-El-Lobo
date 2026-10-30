// El sistema COMPLETO funciona con los permisos MÍNIMOS de caja.
//
// Se ejecutan, con una sesión de caja, los flujos reales del mostrador (las mismas funciones que
// llaman los botones) contra el backend falso que hace cumplir la matriz de permisos
// (tests/helpers/permisos.js). En cada flujo:
//   · `reg.denegadas` debe quedar VACÍO → el sistema no intentó nada que caja no pueda hacer;
//   · las escrituras salen con el token de caja;
//   · las tablas de auditoría se escriben "a ciegas" (return=minimal): caja agrega, pero no lee.
// Si algún día se cambia un flujo para que toque una tabla nueva, estas pruebas avisan que hay que
// ampliar la matriz y las reglas de Supabase a conciencia (no por accidente).
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

const copia = x => JSON.parse(JSON.stringify(x));
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);

test.beforeEach(async ({ page }) => {
  aceptarAvisos(page);   // los "¿Seguro?" (ventana del sistema) se aceptan
});

async function irA(page, id) {
  await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
}

test.describe('flujos del mostrador con rol caja', () => {
  test('tomar un pedido en una mesa: crea el pedido y ocupa la mesa', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(async () => {
      selectedUbicacion = 'mesa_4';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1,
                           monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false }];
      await agregarIngreso('pendiente');
    });
    expect(escritura(reg, 'POST', 'pedidos')).toHaveLength(1);
    expect(escritura(reg, 'POST', 'pedidos')[0].rol).toBe('caja');
    expect(escritura(reg, 'PATCH', 'mesas')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('cobrar una mesa pendiente (y liberarla)', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => marcarGrupoMesaPagado([203], 3, 'k-prueba'));
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'mesas')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('cancelar un pendiente: borra, deja rastro en Auditoría "a ciegas" y libera la mesa', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => cancelarPendiente(203));
    expect(escritura(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    const rastro = escritura(reg, 'POST', 'pedidos_eliminados');
    expect(rastro).toHaveLength(1);
    expect(rastro[0].prefer).toBe('return=minimal');   // caja agrega, no lee
    expect(reg.denegadas).toEqual([]);
    expect(await page.evaluate(() => ST.pendientes.some(p => p.id === 203))).toBe(false);
    await expect(page.locator('.toast.warning')).toHaveCount(0);   // sin avisos de error
  });

  test('eliminar un pedido ya pagado: queda en Auditoría y se borra', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => eliminarGrupoIngreso([101]));
    expect(escritura(reg, 'DELETE', 'pedidos')).toHaveLength(1);
    expect(escritura(reg, 'POST', 'pedidos_eliminados')[0].prefer).toBe('return=minimal');
    expect(reg.denegadas).toEqual([]);
    expect(await page.evaluate(() => ST.ingresos.some(p => p.id === 101))).toBe(false);
    await expect(page.locator('.toast.warning')).toHaveCount(0);
  });

  test('aplicar un descuento a un pedido de hoy: ajusta, borra el gasto "Otro" marcado y deja rastro', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.gastos_dia.push({ id: 50, fecha: '2026-10-20', turno: 'almuerzo', nombre: 'Descuento anotado a mano (prueba)', monto: 1000, categoria: 'otro' });
    const reg = await abrirSistema(page, { datos });
    await page.evaluate(() => abrirModalDescuento([101]));
    // el gasto "Otro" ya anotado aparece como candidato a borrar
    const chk = page.locator('.descuento-modal-gasto-chk');
    await expect(chk).toHaveCount(1);
    await chk.check();
    await page.evaluate(() => {
      document.getElementById('descuento-modal-valor').value = '1.000';
      document.getElementById('descuento-modal-motivo').value = 'Cortesía (prueba)';
    });
    await page.evaluate(() => aplicarDescuentoGrupo());
    expect(escritura(reg, 'PATCH', 'pedidos').length).toBeGreaterThan(0);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(1);
    const rastro = escritura(reg, 'POST', 'pedidos_descuentos');
    expect(rastro).toHaveLength(1);
    expect(rastro[0].prefer).toBe('return=minimal');
    expect(reg.denegadas).toEqual([]);
    await expect(page.locator('.toast.warning')).toHaveCount(0);
  });

  test('la opción de descuentos sigue disponible para caja (aunque no pueda leer su auditoría)', async ({ page }) => {
    await abrirSistema(page);
    expect(await page.evaluate(() => descuentosDisponibles())).toBe(true);
  });

  test('gastos del turno: agregar y borrar', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'diaadia');
    await page.evaluate(async () => {
      document.getElementById('dd-gasto-nombre').value = 'Hielo (prueba)';
      document.getElementById('dd-gasto-monto').value = '5.000';
      document.getElementById('dd-gasto-cat').value = 'otro';
      await agregarGastoDia();
      await eliminarGastoDia(ST.gastosDia[ST.gastosDia.length - 1].id);
    });
    expect(escritura(reg, 'POST', 'gastos_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('abrir el turno, cerrarlo y reabrirlo', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'diaadia');
    await page.evaluate(async () => {
      document.getElementById('dd-fecha').value = today();
      document.getElementById('dd-platos-familia').value = '2';
      await guardarCierre();                        // cierra el almuerzo de hoy
      aperturaTurnoSel = 'almuerzo';
      document.getElementById('apertura-caja-inicial').value = '50.000';
      await guardarAperturaTurno();                 // lo reabre: borra el cierre y actualiza la apertura
    });
    expect(escritura(reg, 'POST', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'aperturas_turno')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('notas del día: agregar y borrar', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(async () => {
      document.getElementById('nota-nueva-texto').value = 'Comprar limones (prueba)';
      await agregarNotaDia();
      await eliminarNotaDia(ST.notasDia[0].id);
    });
    expect(escritura(reg, 'POST', 'notas_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'notas_dia')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('inventario: producto nuevo, consumo y borrado', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'inventario');
    await page.evaluate(async () => {
      document.getElementById('inv-nombre').value = 'Sal (prueba)';
      document.getElementById('inv-stock').value = '5';
      document.getElementById('inv-minimo').value = '1';
      await agregarProducto();
      const nuevo = ST.inventario.find(p => p.nombre === 'Sal (prueba)');
      const sel = document.getElementById('venta-producto');
      sel.value = String(ST.inventario[0].id);
      document.getElementById('venta-cantidad').value = '1';
      document.getElementById('venta-fecha').value = today();
      await registrarVenta();
      await eliminarProducto(nuevo.id);
    });
    expect(escritura(reg, 'POST', 'inventario')).toHaveLength(1);
    expect(escritura(reg, 'POST', 'consumos')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'inventario')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'inventario')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('fiados: registrar un abono de un cliente', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'fiados');
    await page.evaluate(async () => {
      document.getElementById('abono-monto-1').value = '3.000';
      await registrarAbonoFiado(1);
    });
    const abono = escritura(reg, 'POST', 'abonos_fiado');
    expect(abono).toHaveLength(1);
    expect(abono[0].rol).toBe('caja');
    expect(reg.denegadas).toEqual([]);
  });

  test('cambiar el método de pago de un ingreso ya cobrado', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => sbPatch('pedidos', 'id=eq.101', { metodo: 'transferencia' }));
    expect(escritura(reg, 'PATCH', 'pedidos')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('crear un cliente de fiado', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => sbInsert('clientes_fiado', { nombre: 'Cliente Tres (prueba)' }));
    expect(escritura(reg, 'POST', 'clientes_fiado')).toHaveLength(1);
    expect(reg.denegadas).toEqual([]);
  });

  test('caja puede abrir cada pestaña operativa sin errores y sin intentar nada prohibido', async ({ page }) => {
    const reg = await abrirSistema(page);
    for (const id of ['ingresos', 'pendientes', 'fiados', 'diaadia', 'inventario', 'menu']) {
      await irA(page, id);
    }
    expect(reg.errores).toEqual([]);
    expect(reg.denegadas).toEqual([]);
  });
});

test.describe('lo que caja NO ve ni puede hacer (cambios de comportamiento a conciencia)', () => {
  const datosConEgreso = () => {
    const datos = copia(DATOS_BASE);
    datos.egresos.push({ id: 77, fecha: '2026-10-20', cat: 'otro', monto: 1000, description: 'Egreso Otro de hoy (prueba)', created_at: '2026-10-20T12:00:00-05:00' });
    return datos;
  };

  test('caja: en el flujo de descuento ya no aparecen los gastos de la tabla Egresos como candidatos (son de finanzas)', async ({ page }) => {
    await abrirSistema(page, { datos: datosConEgreso() });     // caja: no carga egresos
    await page.evaluate(() => abrirModalDescuento([101]));
    await expect(page.locator('.descuento-modal-gasto-chk')).toHaveCount(0);
  });

  test('admin: sí los ve (así el descuento no queda contado dos veces)', async ({ page }) => {
    await abrirSistema(page, { datos: datosConEgreso(), usuario: 'admin' });
    await page.evaluate(() => abrirModalDescuento([101]));
    await expect(page.locator('.descuento-modal-gasto-chk')).toHaveCount(1);
  });
});
