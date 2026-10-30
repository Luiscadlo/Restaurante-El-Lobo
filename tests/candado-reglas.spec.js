// CANDADO DE DÍAS en las pruebas de pantalla (ver sql/candado_dias.sql y docs/MATRIZ_PERMISOS.md).
//
//  1. REGLAS: los mismos casos que tests/python/test_candado_dias.py corre contra el SQL en un Postgres de verdad
//     (tests/fixtures/candado_casos.json) se corren aquí contra la copia en JS (helpers/candado.js) que hace cumplir el
//     Supabase falso. Si las dos copias se apartaran, una de las dos pruebas fallaría.
//  2. EL SISTEMA con el candado puesto: a las 12:30 a. m. la cena de anoche se sigue operando; ya pasadas las 9:00
//     a. m. lo de ayer queda cerrado para caja y el sistema lo avisa con un mensaje claro (no en silencio); un
//     administrador no tiene candado.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const CASOS = require('./fixtures/candado_casos.json');
const { evaluarCandado, diaNegocio } = require('./helpers/candado');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');

// ── 1. Los casos compartidos ───────────────────────────────────────────────
function filaCompleta(tabla, fila) { return { ...(CASOS.base[tabla] || {}), ...fila }; }

for (const c of CASOS.casos) {
  test(`regla — ${c.id}`, () => {
    const semilla = [...CASOS.siembra_comun, ...(c.semilla || [])].filter(s => s.tabla === 'pedidos').map(s => filaCompleta('pedidos', s.fila));
    const antes = c.op === 'I' ? null : filaCompleta(c.tabla, { id: 1000, ...(c.antes || {}) });
    const despues = c.op === 'I' ? filaCompleta(c.tabla, c.despues) : c.op === 'U' ? { ...antes, ...c.despues } : null;
    const veredicto = evaluarCandado({ rol: c.rol, tabla: c.tabla, op: c.op, antes, despues, pedidos: semilla, ahora: new Date(c.ahora || CASOS.ahora_por_defecto) });
    if (c.esperado === 'ok') {
      expect(veredicto, `${c.id}: debía poder hacerse`).toBeNull();
    } else {
      expect(veredicto, `${c.id}: debía rechazarse`).not.toBeNull();
      expect(veredicto.code).toBe('42501');
      expect(veredicto.details).toBe('candado_dias');
    }
  });
}

test('el día de negocio cambia a las 9:00 a. m. de Bogotá (igual que en Postgres)', () => {
  const dia = iso => diaNegocio(new Date(iso));
  expect(dia('2026-10-20T09:00:00-05:00')).toBe('2026-10-20');
  expect(dia('2026-10-21T00:00:00-05:00')).toBe('2026-10-20');
  expect(dia('2026-10-21T08:59:59-05:00')).toBe('2026-10-20');
  expect(dia('2026-10-21T09:00:00-05:00')).toBe('2026-10-21');
  expect(dia('2026-10-21T13:59:59Z')).toBe('2026-10-20');
  expect(dia('2026-10-21T14:00:00Z')).toBe('2026-10-21');
  expect(dia('2026-01-01T03:00:00-05:00')).toBe('2025-12-31');
  expect(dia('2028-03-01T05:00:00-05:00')).toBe('2028-02-29');
});

test('el mensaje de rechazo sale del SQL y trae la fecha y a quién pedírselo', () => {
  const r = evaluarCandado({ rol: 'caja', tabla: 'cierres_dia', op: 'D', antes: { fecha: '2026-10-19' }, ahora: new Date('2026-10-20T14:00:00-05:00') });
  const sql = fs.readFileSync(path.resolve(__dirname, '../sql/candado_dias.sql'), 'utf8');
  expect(sql).toContain(r.message.replace('19/10/2026', '%s'));
  expect(r.message).toContain('19/10/2026');
  expect(r.message).toContain('administrador');
});

test('si son dos fechas pasadas, el mensaje nombra la más vieja; si el pedido es de hoy pero su cobro es de ayer, nombra el día del cobro', () => {
  const ahora = new Date('2026-10-20T14:00:00-05:00');
  const dosDias = evaluarCandado({ rol: 'caja', tabla: 'cierres_dia', op: 'U', antes: { fecha: '2026-10-18' }, despues: { fecha: '2026-10-19' }, ahora });
  expect(dosDias.message).toContain('18/10/2026');
  expect(dosDias.message).not.toContain('19/10/2026');
  const cobro = evaluarCandado({ rol: 'caja', tabla: 'pedidos', op: 'I', despues: { estado: 'pagado', fecha: '2026-10-20', fecha_pago: '2026-10-19' }, pedidos: [], ahora });
  expect(cobro.message).toContain('19/10/2026');
  expect(cobro.message).not.toContain('20/10/2026');
});

// ── 2. El sistema, con el candado puesto ───────────────────────────────────
const copia = x => JSON.parse(JSON.stringify(x));
const hasta = (reg, tabla, metodo) => reg.escrituras.filter(e => e.tabla === tabla && e.metodo === metodo);

// Un cierre y una apertura de ayer, y un gasto de ayer: lo que caja NO debe poder tocar.
function datosConAyer() {
  const datos = copia(DATOS_BASE);
  datos.cierres_dia = [...datos.cierres_dia.filter(c => c.fecha !== '2026-10-19'), { id: 41, fecha: '2026-10-19', turno: 'almuerzo', efectivo: 100000, transferencia: 50000, gastos: 0, resultado: 150000 }];
  datos.gastos_dia = [...datos.gastos_dia, { id: 42, fecha: '2026-10-19', turno: 'almuerzo', nombre: 'Gasto de ayer (prueba)', monto: 5000, categoria: 'otro' }];
  return datos;
}

test.describe('el sistema con el candado puesto', () => {
  test('caja intenta cambiar el cierre de ayer a la fuerza: el servidor lo rechaza y el sistema lo dice', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConAyer() });
    const resultado = await page.evaluate(async () => {
      try { await sbPatch('cierres_dia', 'fecha=eq.2026-10-19&turno=eq.almuerzo', { efectivo: 1 }); return 'se dejó'; } catch (e) { return e.message; }
    });
    expect(resultado).not.toBe('se dejó');
    expect(resultado).toContain('Caja solo puede cambiar lo de hoy');
    expect(resultado).toContain('19/10/2026');
    expect(resultado).not.toContain('"code"');                                // mensaje limpio, no el JSON del servidor
    await expect(page.locator('.toast', { hasText: 'Caja solo puede cambiar lo de hoy' })).toHaveCount(1);
    expect(reg.denegadas).toEqual(['caja U cierres_dia (candado de días)']);
    expect(hasta(reg, 'cierres_dia', 'PATCH')).toHaveLength(0);              // y nada se escribió
  });

  test('borrar un gasto de ayer o crear uno con fecha de ayer: rechazados, uno por uno', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConAyer() });
    const r = await page.evaluate(async () => {
      const intentos = [
        () => sbDelete('gastos_dia', 'id=eq.42'),
        () => sbInsert('gastos_dia', { fecha: '2026-10-19', turno: 'almuerzo', nombre: 'colado', monto: 1 }),
        () => sbInsert('notas_dia', { fecha: '2026-10-19', texto: 'colada' }),
        () => sbInsert('abonos_fiado', { cliente_fiado_id: 1, fecha: '2026-10-19', turno: 'almuerzo', monto: 1, cuenta: 'efectivo' }),
      ];
      const salidas = [];
      for (const f of intentos) { try { await f(); salidas.push('se dejó'); } catch (e) { salidas.push(e.candadoDias === true); } }
      return salidas;
    });
    expect(r).toEqual([true, true, true, true]);
    expect(reg.escrituras.filter(e => e.rol === 'caja')).toHaveLength(0);
  });

  test('un dueño (administrador) no tiene candado: puede corregir el cierre de ayer', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConAyer(), usuario: 'admin' });
    const resultado = await page.evaluate(async () => {
      try { await sbPatch('cierres_dia', 'fecha=eq.2026-10-19&turno=eq.almuerzo', { efectivo: 120000 }); return 'ok'; } catch (e) { return e.message; }
    });
    expect(resultado).toBe('ok');
    expect(reg.denegadas).toEqual([]);
    expect(hasta(reg, 'cierres_dia', 'PATCH')).toHaveLength(1);
  });

  test('hoy sigue todo igual: caja corrige el cierre de hoy y anota un gasto de hoy', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConAyer() });
    const resultado = await page.evaluate(async h => {
      try {
        await sbInsert('gastos_dia', { fecha: h, turno: 'almuerzo', nombre: 'de hoy', monto: 1 });
        await sbPatch('cierres_dia', `fecha=eq.${h}&turno=eq.almuerzo`, { efectivo: 1 });
        return 'ok';
      } catch (e) { return e.message; }
    }, FECHA_HOY);
    expect(resultado).toBe('ok');
    expect(reg.denegadas).toEqual([]);
  });

  test('a las 12:30 a. m. la cena de anoche sigue siendo «de hoy»; a las 9:00 a. m. ya no', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConAyer(), fecha: new Date('2026-10-21T00:30:00-05:00') });
    const cerrar = () => page.evaluate(async () => {
      try { await sbInsert('cierres_dia', { fecha: '2026-10-20', turno: 'cena', efectivo: 1, transferencia: 0, gastos: 0, resultado: 1 }); return 'ok'; } catch (e) { return e.message; }
    });
    expect(await cerrar()).toBe('ok');                                        // cierra la cena del 20 pasada la medianoche
    await reg.fijarReloj(new Date('2026-10-21T09:00:00-05:00'));
    const tarde = await page.evaluate(async () => {
      try { await sbPatch('cierres_dia', 'fecha=eq.2026-10-20&turno=eq.cena', { efectivo: 2 }); return 'ok'; } catch (e) { return e.message; }
    });
    expect(tarde).toContain('Caja solo puede cambiar lo de hoy');
    expect(tarde).toContain('20/10/2026');
  });

  test('avisos repetidos: el mismo rechazo no llena la pantalla de carteles', async ({ page }) => {
    await abrirSistema(page, { datos: datosConAyer() });
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) { try { await sbDelete('gastos_dia', 'id=eq.42'); } catch (e) { /* esperado */ } }
    });
    await expect(page.locator('.toast', { hasText: 'Caja solo puede cambiar lo de hoy' })).toHaveCount(1);
  });

  test('el mensaje del candado no contiene ningún nombre de columna que el sistema use para «reintentar sin esa columna»', async ({ page }) => {
    await abrirSistema(page, { datos: datosConAyer() });
    const mensaje = await page.evaluate(async () => {
      try { await sbDelete('gastos_dia', 'id=eq.42'); return ''; } catch (e) { return e.message; }
    });
    const html = fs.readFileSync(path.resolve(__dirname, '../Contabilidad/ElLobo-Sistema Contable.html'), 'utf8');
    const nombres = new Set([...html.matchAll(/(?:msg|e\.message|\(e\.message \|\| ''\))\.includes\('([a-z_]+)'\)/g)].map(m => m[1]));
    for (const lista of html.matchAll(/\[([^\]]*)\]\.(?:find|some)\(c => [^\n]*?msg\.includes\(c\)/g)) {
      for (const n of lista[1].matchAll(/'([a-z_]+)'/g)) nombres.add(n[1]);
    }
    expect(nombres.size).toBeGreaterThan(15);
    expect([...nombres].filter(n => mensaje.toLowerCase().includes(n))).toEqual([]);
  });
});

// ── 3. Los casos delicados de días viejos, con la pantalla de verdad ───────
const pedidoPorId = (id) => page => page.evaluate(i => [...ST.pendientes, ...ST.ingresos].find(p => p.id === i), id);
const unaVenta = { pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 1, monto_unit: 15000, monto_almuerzo: 15000, para_llevar: false };
const toastsDeCandado = page => page.locator('.toast', { hasText: 'Caja solo puede cambiar lo de hoy' });

test.describe('lo viejo que SÍ puede hacer caja (con el candado puesto)', () => {
  test.beforeEach(async ({ page }) => { aceptarAvisos(page); });

  test('cobrar un fiado de hace días: pasa a hoy, y «↩ Deshacer» le devuelve su fecha', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => marcarGrupoFiadoPagado([201], 'k-fiado'));
    const cobrado = await pedidoPorId(201)(page);
    expect(cobrado).toMatchObject({ estado: 'pagado', fecha: FECHA_HOY, fecha_original: '2026-10-10' });
    await page.evaluate(() => revertirPago([201]));
    expect(await pedidoPorId(201)(page)).toMatchObject({ estado: 'pendiente', fecha: '2026-10-10' });
    expect(reg.denegadas).toEqual([]);
    expect(reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'PATCH')).toHaveLength(2);
    await expect(toastsDeCandado(page)).toHaveCount(0);
  });

  test('agregar un producto a un fiado viejo: el ítem nuevo hereda la fecha del pedido', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(async () => {
      const ref = ST.pendientes.find(p => p.id === 201);
      abrirModalAgregarProducto([201], ref.grupo_pedido);
      document.getElementById('extra-producto-desc').value = 'Gaseosa (prueba)';
      document.getElementById('extra-producto-valor').value = '3.000';
      await guardarProductoExtra();
    });
    const nuevo = reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'POST');
    expect(nuevo).toHaveLength(1);
    expect(nuevo[0].cuerpo).toMatchObject({ fecha: '2026-10-10', estado: 'pendiente', pedido: 'extra' });
    expect(reg.denegadas).toEqual([]);
  });

  test('cancelar un fiado viejo, o ponerle un descuento mientras sigue pendiente', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(async () => {
      await sbPatch('pedidos', 'id=eq.202', { monto_almuerzo: 14000, monto_total: 14000, descuento: 1000, motivo_descuento: 'Cortesía (prueba)' });
      await cancelarGrupoPendiente([201], null);
    });
    expect(reg.denegadas).toEqual([]);
    expect(reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'DELETE')).toHaveLength(1);
  });

  test('cobrar el domicilio de ayer: se puede; deshacerlo ya no (quedó cobrado en un día cerrado) y el sistema avisa por qué', async ({ page }) => {
    const reg = await abrirSistema(page);
    await page.evaluate(() => marcarGrupoDomicilioPagado([204], 'k-dom'));
    expect(await pedidoPorId(204)(page)).toMatchObject({ estado: 'pagado', fecha: '2026-10-19' });
    expect(reg.denegadas).toEqual([]);
    await page.evaluate(() => revertirPago([204]));
    expect(reg.denegadas).toEqual(['caja U pedidos (candado de días)']);
    await expect(toastsDeCandado(page)).toHaveCount(1);
    expect(await pedidoPorId(204)(page)).toMatchObject({ estado: 'pagado' });         // en pantalla nada cambió a medias
  });

  test('abonar a un fiado que se salda con ese abono: el pedido viejo pasa a «cobrado vía abonos» con fecha de pago de hoy', async ({ page }) => {
    const reg = await abrirSistema(page);
    await irA(page, 'fiados');
    await page.evaluate(async () => {
      document.getElementById('abono-monto-1').value = '20.000';       // el cliente 1 debe 35.000 y tiene 26.000 abonados antes: cubre el pedido de 20.000
      await registrarAbonoFiado(1);
    });
    expect(reg.denegadas).toEqual([]);
    const saldados = reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'PATCH');
    expect(saldados.length).toBeGreaterThan(0);
    for (const e of saldados) expect(e.cuerpo).toMatchObject({ estado: 'pagado', pagado_via_abono: true, fecha_pago: FECHA_HOY });
  });
});

async function irA(page, id) {
  await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
}

function datosConCenaAbierta() {
  const datos = copia(DATOS_BASE);
  datos.aperturas_turno = [...datos.aperturas_turno, { id: 91, fecha: '2026-10-20', turno: 'cena', caja_inicial: 50000, venta_desayuno: 0 }];
  return datos;
}

test.describe('la cena que pasa de medianoche', () => {
  test.beforeEach(async ({ page }) => { aceptarAvisos(page); });

  test('a las 12:30 a. m. caja registra un pedido, cobra un abono y cierra la cena del día anterior', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConCenaAbierta(), fecha: new Date('2026-10-21T00:30:00-05:00') });
    await page.evaluate(async venta => {
      turnoManual = 'cena';
      document.getElementById('ing-fecha').value = '2026-10-20';      // la pantalla recargada después de medianoche trae el 21: se elige el 20
      document.getElementById('ing-hora').value = '00:20';
      selectedUbicacion = 'sinmesa';
      almuerzosEnCola = [venta];
      await agregarIngreso('pagado');
      document.getElementById('abono-monto-1').value = '4.000';
      await registrarAbonoFiado(1);                                   // el abono entra a la cena del 20 (antes de las 9:00 a. m.)
      document.getElementById('dd-fecha').value = '2026-10-20';
      ddTurno = 'cena';
      await guardarCierre();
    }, unaVenta);
    expect(reg.denegadas).toEqual([]);
    expect(reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'POST')[0].cuerpo).toMatchObject({ fecha: '2026-10-20', turno: 'cena', estado: 'pagado' });
    expect(reg.escrituras.filter(e => e.tabla === 'abonos_fiado' && e.metodo === 'POST')[0].cuerpo).toMatchObject({ fecha: '2026-10-20', turno: 'cena' });
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia' && e.metodo === 'POST')[0].cuerpo).toMatchObject({ fecha: '2026-10-20', turno: 'cena' });
    await expect(toastsDeCandado(page)).toHaveCount(0);
  });

  test('a las 9:30 a. m. una cena que se quedó sin cerrar ya es de ayer: caja no puede seguir y el sistema lo dice (lo cierra un administrador)', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConCenaAbierta(), fecha: new Date('2026-10-21T09:30:00-05:00') });
    await page.evaluate(async venta => {
      turnoManual = 'cena';
      document.getElementById('ing-fecha').value = '2026-10-20';
      document.getElementById('ing-hora').value = '09:25';
      selectedUbicacion = 'sinmesa';
      almuerzosEnCola = [venta];
      await agregarIngreso('pagado');
    }, unaVenta);
    expect(reg.denegadas).toEqual(['caja I pedidos (candado de días)']);
    await expect(toastsDeCandado(page)).toHaveCount(1);
    expect(reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'POST')).toHaveLength(0);
  });

  test('el administrador sí puede cerrar esa cena olvidada', async ({ page }) => {
    const reg = await abrirSistema(page, { datos: datosConCenaAbierta(), fecha: new Date('2026-10-21T09:30:00-05:00'), usuario: 'admin' });
    await page.evaluate(async () => {
      document.getElementById('dd-fecha').value = '2026-10-20';
      ddTurno = 'cena';
      await guardarCierre();
    });
    expect(reg.denegadas).toEqual([]);
    expect(reg.escrituras.filter(e => e.tabla === 'cierres_dia' && e.metodo === 'POST')).toHaveLength(1);
  });
});
