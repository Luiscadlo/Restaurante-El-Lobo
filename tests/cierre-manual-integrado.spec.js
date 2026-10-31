// CIERRE MANUAL INTEGRADO. El caso real: un sábado se abre el turno normal, se registran pedidos y gastos, el dueño se
// va a mitad del turno y después hace el cierre manual. Antes el cierre manual no sabía nada de lo ya registrado:
//   · los gastos del inicio no aparecían y, si se volvían a escribir, quedaban DUPLICADOS (cierre.gastos ≠ suma real);
//   · no mostraba las ventas, los abonos ni los fiados que el sistema ya tenía;
//   · los lápices ✏️ de Ingresos y Egresos llevaban a la pantalla Cierre normal, que recalcula desde los pedidos y
//     ofrece guardar encima de los totales escritos a mano;
//   · eliminar un cierre manual borraba TODOS los gastos del turno sin preguntar.
// Ahora el cierre manual muestra lo que el sistema ya tiene, comparte los gastos del turno (sin duplicar) y es la única
// puerta para corregir un cierre manual.
//
// Datos de ejemplo (FECHA_HOY = 2026-10-20, almuerzo): pedidos pagados efectivo 15.000 + 12.000 + 13.000 = 40.000 y
// transferencia 16.000 + 8.000 = 24.000; desayuno 30.000 ef + 10.000 tr; abonos 7.000 ef + 4.000 tr
// → el sistema suma 77.000 de efectivo y 38.000 de transferencia. Caja inicial 50.000. Pedido 203 (mesa 3, 15.000) sin cobrar.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const VENTANA = '#modal-sistema';
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const escritura = (reg, metodo, tabla) => reg.escrituras.filter(e => e.metodo === metodo && e.tabla === tabla);
const cierreDe = (page, fecha = FECHA_HOY, turno = 'almuerzo') => page.evaluate(([f, t]) => ST.cierresDia.find(c => c.fecha === f && c.turno === t) || null, [fecha, turno]);
const gastosDe = (page, fecha = FECHA_HOY, turno = 'almuerzo') => page.evaluate(([f, t]) => ST.gastosDia.filter(g => g.fecha === f && g.turno === t).map(g => ({ id: g.id, nombre: g.nombre, monto: g.monto, categoria: g.categoria })), [fecha, turno]);

// Un sábado a medias: gas ya registrado al abrir el turno (20.000), un préstamo (no cuenta como gasto) y un fiado de hoy.
function datosSabado({ conPrestamo = true, conFiado = true } = {}) {
  const d = JSON.parse(JSON.stringify(DATOS_BASE));
  d.gastos_dia.push({ id: 50, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Gas (inicio del turno)', monto: 20000, categoria: 'proveedor' });
  if (conPrestamo) d.gastos_dia.push({ id: 51, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Préstamo devuelto', monto: 10000, categoria: 'prestamo' });
  if (conFiado) {
    const base = JSON.parse(JSON.stringify(d.pedidos.find(p => p.id === 201)));
    d.pedidos.push({ ...base, id: 300, fecha: FECHA_HOY, hora: '13:00', created_at: `${FECHA_HOY}T13:00:00-05:00`, monto_total: 25000, monto_almuerzo: 25000, monto_unit: 25000, grupo_pedido: 'g-300', cliente_fiado_id: 1 });
  }
  // Un pedido «gratis» que sigue pendiente: ni plata ni deuda, no debe contarse como «sin cobrar».
  const pend = JSON.parse(JSON.stringify(d.pedidos.find(p => p.id === 203)));
  d.pedidos.push({ ...pend, id: 301, grupo_pedido: 'g-301', es_gratis: true, metodo: 'gratis', monto_total: 0, monto_almuerzo: 0, monto_unit: 0, mesa: 5 });
  // Un pedido sin cobrar y un fiado de la CENA de hoy: no son del almuerzo y no deben aparecer en su panel.
  d.pedidos.push({ ...pend, id: 302, grupo_pedido: 'g-302', turno: 'cena', hora: '19:10', mesa: 6, monto_total: 12000, monto_almuerzo: 12000, monto_unit: 12000 });
  d.pedidos.push({ ...pend, id: 303, grupo_pedido: 'g-303', turno: 'cena', hora: '19:20', mesa: null, es_fiar: true, cliente_fiado_id: 2, monto_total: 9000, monto_almuerzo: 9000, monto_unit: 9000 });
  return d;
}

const abrirManual = async page => {
  await page.evaluate(() => abrirModalCierreManual());
  await expect(page.locator('#cierremanual-contenido')).toBeVisible();
};
const panel = page => page.locator('#cm-sistema');
const guardar = async page => { await page.evaluate(() => guardarCierreManual()); await page.waitForFunction(() => document.getElementById('modal-cierre-manual').style.display === 'none'); };

test.describe('el cierre manual muestra lo que el sistema ya tiene', () => {
  test('panel de solo lectura: caja inicial, pedidos, desayuno, abonos, total, fiados, sin cobrar y gastos', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    const t = await panel(page).innerText();
    expect(t).toContain('solo lectura');
    expect(t).toMatch(/Caja inicial\s*\$50\.000/);
    expect(t).toMatch(/Ventas de pedidos pagados\s*💵 \$40\.000 · 📲 \$24\.000/);
    expect(t).toMatch(/Venta de desayuno\s*💵 \$30\.000 · 📲 \$10\.000/);
    expect(t).toMatch(/Abonos de fiado recibidos\s*💵 \$7\.000 · 📲 \$4\.000/);
    expect(t).toContain('Cliente Uno (prueba)');
    expect(t).toMatch(/Total que el sistema suma\s*💵 \$77\.000 · 📲 \$38\.000/);
    expect(t).toContain('1 pedido(s) por $25.000');            // el fiado de hoy…
    expect(t).toContain('sin cobrar todavía');                  // …es deuda, no plata recibida
    expect(t).toMatch(/Pedidos sin cobrar[^\n]*\s*1 por \$15\.000/);
    expect(t).toMatch(/Gastos ya registrados[^\n]*\s*2 por \$20\.000/);   // el préstamo (10.000) no cuenta como gasto
  });

  test('fiados del turno: uno sin cobrar (10-oct) y uno que ya se cobró con abonos (12-oct) se muestran aparte de la plata recibida', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-10'; cambioFechaTurnoCierreManual(); });
    await expect(panel(page)).toContainText('1 pedido(s) por $20.000 sin cobrar todavía');
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-12'; cambioFechaTurnoCierreManual(); });
    await expect(panel(page)).toContainText('1 pedido(s) por $15.000 ya cobrados con abonos');
    await expect(panel(page)).not.toContainText('sin cobrar todavía');
    await expect(page.locator('#cm-efectivo')).toHaveValue('');                       // un fiado no es plata recibida: no se precarga
  });

  test('turno sin nada registrado: lo dice claro y no inventa números', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-08'; cambioFechaTurnoCierreManual(); });
    await expect(panel(page)).toContainText('El sistema no tiene nada registrado de este turno');
    await expect(page.locator('#cm-efectivo')).toHaveValue('');
    await expect(page.locator('#cm-comparativo')).toHaveText('');
  });

  test('cambiar de turno vuelve a leer el sistema: la cena trae solo sus pedidos (sin desayuno ni abonos del almuerzo)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-btn-cena').click();
    const t = await panel(page).innerText();
    expect(t).toMatch(/Ventas de pedidos pagados\s*💵 \$18\.000 · 📲 \$0/);
    expect(t).not.toContain('Venta de desayuno');
    expect(t).toMatch(/Pedidos sin cobrar[^\n]*\s*1 por \$12\.000/);                  // los de la cena, no los del almuerzo
    expect(t).toContain('1 pedido(s) por $9.000');
    await expect(page.locator('#cm-gastos-lista')).not.toContainText('Gas (inicio del turno)');   // los gastos son los del turno elegido
    await expect(page.locator('#cm-gastos-total')).toHaveText('$0');
    await expect(page.locator('#cm-efectivo')).toHaveValue('18.000');
    await expect(page.locator('#cm-transferencia')).toHaveValue('');
  });

  test('avisa si ya hay un cierre guardado ese día (normal o manual) en vez de dejar que se pise sin querer', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-18'; cambioFechaTurnoCierreManual(); });
    await expect(page.locator('#cm-aviso-existente')).toContainText('cierre normal');
    await expect(page.locator('#cm-aviso-existente')).toContainText('lo reemplazas');
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-19'; cambioFechaTurnoCierreManual(); });
    await expect(page.locator('#cm-aviso-existente')).toBeHidden();
  });
});

test.describe('los totales arrancan con lo del sistema y se comparan con lo que escribes', () => {
  test('el efectivo y la transferencia llegan precargados con lo que el sistema suma', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await expect(page.locator('#cm-efectivo')).toHaveValue('77.000');
    await expect(page.locator('#cm-transferencia')).toHaveValue('38.000');
    await expect(page.locator('#cm-comparativo')).toContainText('igual a lo que tiene el sistema');
  });

  test('lo escrito a mano NO se pisa al cambiar de fecha o turno; «Usar lo del sistema» sí lo reemplaza', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await page.locator('#cm-btn-cena').click();
    await expect(page.locator('#cm-efectivo')).toHaveValue('500.000');               // lo tecleado se respeta
    await expect(page.locator('#cm-transferencia')).toHaveValue('');                 // lo no tocado sí sigue al turno
    await page.locator('#cm-btn-almuerzo').click();
    await expect(page.locator('#cm-transferencia')).toHaveValue('38.000');
    await page.locator('#cm-sistema button', { hasText: 'Usar lo del sistema' }).click();
    await expect(page.locator('#cm-efectivo')).toHaveValue('77.000');
  });

  test('más que el sistema: lo dice en gris; menos que el sistema: lo dice en rojo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await page.locator('#cm-transferencia').fill('30.000');
    const c = page.locator('#cm-comparativo');
    await expect(c).toContainText('Efectivo: $423.000 más de lo que tiene el sistema');
    await expect(c).toContainText('Transferencia: $8.000 MENOS de lo que el sistema ya tiene registrado');
    expect(await c.locator('div').nth(1).evaluate(el => getComputedStyle(el).color)).toBe('rgb(224, 92, 92)');
  });
});

test.describe('fecha y turno de partida', () => {
  test('a las 00:30 (antes de las 9:00) ofrece el día de negocio de ayer y el turno de comidas rápidas, no el día del calendario', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado(), fecha: new Date('2026-10-21T00:30:00-05:00') });
    await abrirManual(page);
    await expect(page.locator('#cm-fecha')).toHaveValue('2026-10-20');
    await expect(page.locator('#cm-btn-cena')).toHaveClass(/active/);
    await expect(panel(page)).toContainText('💵 $18.000');                           // la cena de ayer, con su pedido
  });

  test('a mediodía ofrece hoy y el almuerzo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await expect(page.locator('#cm-fecha')).toHaveValue('2026-10-20');
    await expect(page.locator('#cm-btn-almuerzo')).toHaveClass(/active/);
  });
});

test.describe('nombres con signos raros no rompen la pantalla', () => {
  test('el detalle del gasto, el cliente y la nota del abono se muestran como texto (no como código)', async ({ page }) => {
    const d = datosSabado();
    d.gastos_dia.find(g => g.id === 50).nombre = 'Gas <b id="x">fuerte</b> & más';
    d.clientes_fiado[0].nombre = 'Ana <i id="y">X</i>';
    d.abonos_fiado.find(a => a.id === 4).nota = 'nota <u id="z">rara</u>';
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await abrirManual(page);
    await expect(page.locator('#cm-gastos-lista')).toContainText('Gas <b id="x">fuerte</b> & más');
    await expect(panel(page)).toContainText('Ana <i id="y">X</i>');
    await expect(panel(page)).toContainText('nota <u id="z">rara</u>');
    expect(await page.locator('#cm-gastos-lista b, #cm-sistema i, #cm-sistema u').count()).toBe(0);
  });
});

test.describe('los gastos son los mismos del turno: se ven, no se duplican y el total del cierre siempre cuadra', () => {
  test('los gastos ya registrados aparecen en la lista del cierre manual (con su etiqueta) y suman en el total', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    const lista = page.locator('#cm-gastos-lista');
    await expect(lista).toContainText('Gas (inicio del turno)');
    await expect(lista).toContainText('Préstamo devuelto');
    await expect(lista).toContainText('registrado');
    await expect(page.locator('#cm-gastos-total')).toHaveText('$20.000');            // sin el préstamo
  });

  test('guardar SIN volver a escribir los gastos: no se inserta ni se borra nada y cierre.gastos = suma real', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await page.locator('#cm-transferencia').fill('100.000');
    await guardar(page);
    expect(escritura(reg, 'POST', 'gastos_dia')).toHaveLength(0);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);
    expect(await gastosDe(page)).toHaveLength(2);
    const c = await cierreDe(page);
    expect(c).toMatchObject({ manual: true, efectivo: 500000, transferencia: 100000, gastos: 20000, resultado: 580000 });
    expect(c.gastos).toBe((await gastosDe(page)).filter(g => g.categoria !== 'prestamo').reduce((a, g) => a + g.monto, 0));
    expect(reg.errores).toEqual([]);
  });

  test('un gasto nuevo se agrega UNA vez y suma al cierre', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-gasto-monto').fill('5.000');
    await page.locator('#cm-gasto-nombre').fill('Servilletas');
    await page.evaluate(() => agregarGastoCierreManual());
    await expect(page.locator('#cm-gastos-lista')).toContainText('nuevo');
    await expect(page.locator('#cm-gastos-total')).toHaveText('$25.000');
    await guardar(page);
    expect(escritura(reg, 'POST', 'gastos_dia')).toHaveLength(1);
    expect((await gastosDe(page)).map(g => g.nombre)).toEqual(['Gas (inicio del turno)', 'Préstamo devuelto', 'Servilletas']);
    expect((await cierreDe(page)).gastos).toBe(25000);
  });

  test('quitar un gasto ya registrado: no se borra hasta guardar, «Dejar» lo recupera, y al guardar el cierre se recalcula', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-gastos-lista button[onclick^="quitarGastoRegistradoCierreManual(50)"]').click();
    await expect(page.locator('#cm-gastos-lista')).toContainText('se quitará al guardar');
    await expect(page.locator('#cm-gastos-total')).toHaveText('$0');
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);                 // todavía nada se borró
    await page.locator('#cm-gastos-lista button', { hasText: 'Dejar' }).click();
    await expect(page.locator('#cm-gastos-total')).toHaveText('$20.000');
    await page.locator('#cm-gastos-lista button[onclick^="quitarGastoRegistradoCierreManual(50)"]').click();
    await guardar(page);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(1);
    expect((await gastosDe(page)).map(g => g.id)).toEqual([51]);
    expect((await cierreDe(page)).gastos).toBe(0);
  });

  test('cambiar de turno no arrastra las marcas de «quitar» del turno anterior', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-gastos-lista button[onclick^="quitarGastoRegistradoCierreManual(50)"]').click();
    await page.locator('#cm-btn-cena').click();
    await page.locator('#cm-btn-almuerzo').click();
    await expect(page.locator('#cm-gastos-lista')).not.toContainText('se quitará al guardar');
    await expect(page.locator('#cm-gastos-total')).toHaveText('$20.000');
  });

  test('si un gasto nuevo no se alcanza a guardar, el cierre NO se guarda y el reintento no duplica lo ya insertado', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    for (const [monto, nombre] of [['5.000', 'Uno'], ['6.000', 'Dos']]) {
      await page.locator('#cm-gasto-monto').fill(monto);
      await page.locator('#cm-gasto-nombre').fill(nombre);
      await page.evaluate(() => agregarGastoCierreManual());
    }
    // el segundo insert falla (se cae la red a mitad de camino)
    await page.evaluate(() => {
      const original = window.sbInsert; let n = 0;
      window.__sbInsertOriginal = original;
      window.sbInsert = async (tabla, ...r) => { if (tabla === 'gastos_dia' && ++n === 2) throw new Error('sin red'); return original(tabla, ...r); };
    });
    await page.evaluate(() => guardarCierreManual());
    await expect(page.locator('.toast.warning').last()).toContainText('el cierre NO se guardó');
    expect(escritura(reg, 'POST', 'cierres_dia')).toHaveLength(0);
    expect(await cierreDe(page)).toBeNull();
    expect(await page.evaluate(() => cierreManualGastos.map(g => g.nombre))).toEqual(['Dos']);   // «Uno» ya quedó guardado
    // vuelve la red y se guarda de nuevo
    await page.evaluate(() => { window.sbInsert = window.__sbInsertOriginal; });
    await guardar(page);
    expect((await gastosDe(page)).map(g => g.nombre).sort()).toEqual(['Dos', 'Gas (inicio del turno)', 'Préstamo devuelto', 'Uno']);
    expect((await cierreDe(page)).gastos).toBe(31000);
  });

  test('si no se alcanza a quitar un gasto marcado, el cierre NO se guarda y la marca sigue para reintentar', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-gastos-lista button[onclick^="quitarGastoRegistradoCierreManual(50)"]').click();
    await page.evaluate(() => { window.__sbDeleteOriginal = window.sbDelete; window.sbDelete = async () => { throw new Error('sin red'); }; });
    await page.evaluate(() => guardarCierreManual());
    await expect(page.locator('.toast.warning').last()).toContainText('el cierre NO se guardó');
    expect(escritura(reg, 'POST', 'cierres_dia')).toHaveLength(0);
    expect(await cierreDe(page)).toBeNull();
    expect(await gastosDe(page)).toHaveLength(2);                                     // el gasto sigue ahí
    expect(await page.evaluate(() => [...cierreManualGastosQuitar])).toEqual([50]);    // y sigue marcado
    await expect(page.locator('#cm-btn-guardar')).toBeEnabled();
    await page.evaluate(() => { window.sbDelete = window.__sbDeleteOriginal; });
    await guardar(page);
    expect((await gastosDe(page)).map(g => g.id)).toEqual([51]);
    expect((await cierreDe(page)).gastos).toBe(0);
  });

  test('doble clic en guardar no guarda dos veces', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-gasto-monto').fill('5.000');
    await page.evaluate(() => agregarGastoCierreManual());
    await page.evaluate(() => { const o = window.sbInsert; window.sbInsert = async (...a) => { await new Promise(r => setTimeout(r, 400)); return o(...a); }; });
    await page.evaluate(() => { guardarCierreManual(); guardarCierreManual(); });
    await page.waitForFunction(() => document.getElementById('modal-cierre-manual').style.display === 'none');
    expect(escritura(reg, 'POST', 'gastos_dia')).toHaveLength(1);
    expect(escritura(reg, 'POST', 'cierres_dia')).toHaveLength(1);
  });
});

test.describe('lo que se guarda', () => {
  test('el cierre manual guarda también los abonos del turno (como el cierre normal) y queda marcado manual', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await page.locator('#cm-transferencia').fill('100.000');
    await guardar(page);
    expect(await cierreDe(page)).toMatchObject({ manual: true, abonos_efectivo: 7000, abonos_transferencia: 4000, platos_familia: null });
    // Ingresos lo muestra con la nota de abonos, igual que un cierre normal
    await irA(page, 'ingfin');
    await expect(page.locator('#ingfin-body')).toContainText('Incluye abonos de fiado: $11.000');
  });

  test('reemplazar un cierre NORMAL que traía ajuste limpia el ajuste (si no, se sumaría dos veces)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-18'; cambioFechaTurnoCierreManual(); });
    await page.locator('#cm-efectivo').fill('430.000');
    await page.locator('#cm-transferencia').fill('160.000');
    const p = page.evaluate(() => guardarCierreManual());
    await page.locator(VENTANA).locator('button[data-eleccion="si"]').click();
    await p;
    const c = await cierreDe(page, '2026-10-18');
    expect(c).toMatchObject({ manual: true, efectivo: 430000, transferencia: 160000, ajuste_efectivo: 0, ajuste_transferencia: 0 });
    expect(await page.evaluate(() => ajustesDeCierre(ST.cierresDia.find(c => c.fecha === '2026-10-18')).total)).toBe(0);
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
  });

  test('corregir un cierre manual ya guardado: ve sus gastos reales, y guardar sin cambios no toca los gastos', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await guardar(page);
    const antes = escritura(reg, 'POST', 'gastos_dia').length + escritura(reg, 'DELETE', 'gastos_dia').length;
    await page.evaluate(() => editarCierreManual('2026-10-20', 'almuerzo'));
    await expect(page.locator('#cierremanual-contenido')).toBeVisible();
    await expect(page.locator('#cm-efectivo')).toHaveValue('500.000');               // lo guardado manda, no lo del sistema
    await expect(page.locator('#cm-gastos-lista')).toContainText('Gas (inicio del turno)');
    await expect(page.locator('#cm-fecha')).toBeDisabled();
    await expect(page.locator('#cm-aviso-existente')).toBeHidden();                  // no se avisa «ya existe» del mismo cierre que se corrige
    await page.locator('#cm-efectivo').fill('520.000');
    await guardar(page);
    expect(escritura(reg, 'POST', 'gastos_dia').length + escritura(reg, 'DELETE', 'gastos_dia').length).toBe(antes);
    expect(await gastosDe(page)).toHaveLength(2);
    expect(await cierreDe(page)).toMatchObject({ efectivo: 520000, gastos: 20000 });
  });
});

test.describe('si a la base le falta una columna opcional, el cierre se guarda igual', () => {
  const sinColumna = page => page.evaluate(() => {
    const original = window.sbInsert;
    window.sbInsert = async (tabla, fila, ...r) => {
      if (tabla === 'cierres_dia' && 'abonos_efectivo' in fila) throw new Error('column "abonos_efectivo" of relation "cierres_dia" does not exist');
      return original(tabla, fila, ...r);
    };
  });

  test('con abonos en el turno avisa qué columna falta, pero guarda el cierre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await sinColumna(page);
    await page.locator('#cm-efectivo').fill('500.000');
    await guardar(page);
    await expect(page.locator('.toast.warning').last()).toContainText('"abonos_efectivo" no se guardó');
    const c = await cierreDe(page);
    expect(c).toMatchObject({ manual: true, efectivo: 500000, abonos_transferencia: 4000 });
    expect('abonos_efectivo' in c).toBe(false);
  });

  test('sin abonos en el turno no hay nada que perder: guarda sin alarmar', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await abrirManual(page);
    await page.evaluate(() => { document.getElementById('cm-fecha').value = '2026-10-08'; cambioFechaTurnoCierreManual(); });
    await sinColumna(page);
    await page.locator('#cm-efectivo').fill('300.000');
    await guardar(page);
    await expect(page.locator('.toast.warning')).toHaveCount(0);
    expect(await cierreDe(page, '2026-10-08')).toMatchObject({ manual: true, efectivo: 300000 });
  });
});

test.describe('un cierre manual solo se corrige en su propio formulario', () => {
  const conManual = () => {
    const d = datosSabado();
    d.cierres_dia.push({ id: 90, fecha: FECHA_HOY, turno: 'almuerzo', efectivo: 500000, transferencia: 100000, gastos: 20000, resultado: 580000, manual: true, platos_familia: null });
    return d;
  };

  test('el lápiz ✏️ de Ingresos abre el cierre manual (no la pantalla Cierre)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await irA(page, 'ingfin');
    await page.locator('#ingfin-body button[onclick*="irADiaADia(\'2026-10-20\',\'almuerzo\')"]').click();
    await expect(page.locator('#modal-cierre-manual')).toBeVisible();
    await expect(page.locator('#cm-efectivo')).toHaveValue('500.000');
    await expect(page.locator('#cm-modo-edicion')).toBeVisible();
    await expect(page.locator('#tab-ingfin')).toBeVisible();                          // se queda donde estaba
  });

  test('el lápiz ✏️ de Egresos (un gasto de un turno con cierre manual) también abre el cierre manual', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await irA(page, 'egresos');
    await page.locator('#egresos-body button[onclick*="irADiaADia(\'2026-10-20\',\'almuerzo\')"]').first().click();
    await expect(page.locator('#modal-cierre-manual')).toBeVisible();
    await expect(page.locator('#cm-gastos-lista')).toContainText('Gas (inicio del turno)');
  });

  test('un cierre normal sigue yendo a la pantalla Cierre como siempre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await irA(page, 'ingfin');
    await page.locator('#ingfin-body button[onclick*="irADiaADia(\'2026-10-18\',\'almuerzo\')"]').click();
    await expect(page.locator('#tab-diaadia')).toBeVisible();
    await expect(page.locator('#modal-cierre-manual')).toBeHidden();
    await expect(page.locator('#dd-form-activo')).toBeVisible();
  });

  test('aunque se fuerce irADiaADia, la pantalla Cierre muestra el manual como cerrado y SIN formulario para guardar encima', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await irA(page, 'diaadia');
    await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-20'; ddTurno = 'almuerzo'; viendoHistorialCierre = true; renderDiaADia(); });
    await expect(page.locator('#dd-cerrado-banner')).toBeVisible();
    await expect(page.locator('#dd-form-activo')).toBeHidden();
  });

  test('«Corregir cierre» de un cierre manual abre el formulario manual', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await irA(page, 'diaadia');
    await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-20'; ddTurno = 'almuerzo'; onFechaCierreChange(); });
    await page.locator('#btn-corregir-cierre').click();
    await expect(page.locator('#modal-cierre-manual')).toBeVisible();
  });

  test('quitar un gasto desde Egresos (✕) deja el cierre manual cuadrado: gastos y resultado se recalculan', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await page.evaluate(() => eliminarGastoDia(50));
    await page.waitForFunction(() => !ST.gastosDia.some(g => g.id === 50));
    const c = await cierreDe(page);
    expect(c).toMatchObject({ gastos: 0, resultado: 600000 });
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'PATCH', 'cierres_dia')[0].cuerpo).toEqual({ gastos: 0, resultado: 600000 });
  });

  test('el resultado recalculado resta los gastos que quedan (no solo los pone en cero)', async ({ page }) => {
    const d = conManual();
    d.gastos_dia.push({ id: 52, fecha: FECHA_HOY, turno: 'almuerzo', nombre: 'Hielo', monto: 4000, categoria: 'otro' });
    d.cierres_dia.find(c => c.id === 90).gastos = 24000;
    d.cierres_dia.find(c => c.id === 90).resultado = 576000;
    await abrirSistema(page, { usuario: 'admin', datos: d });
    await page.evaluate(() => eliminarGastoDia(50));
    await page.waitForFunction(() => !ST.gastosDia.some(g => g.id === 50));
    expect(await cierreDe(page)).toMatchObject({ gastos: 4000, resultado: 596000 });
  });

  test('quitar el préstamo (no cuenta como gasto) no cambia ni toca el cierre manual', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    await page.evaluate(() => eliminarGastoDia(51));
    await page.waitForFunction(() => !ST.gastosDia.some(g => g.id === 51));
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
    expect(await cierreDe(page)).toMatchObject({ gastos: 20000, resultado: 580000 });
  });

  test('quitar un gasto de un turno cuyo cierre es NORMAL no toca el cierre (comportamiento de siempre)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    await page.evaluate(() => eliminarGastoDia(1));      // gasto del 18-oct, cuyo cierre es normal
    await page.waitForFunction(() => !ST.gastosDia.some(g => g.id === 1));
    expect(escritura(reg, 'PATCH', 'cierres_dia')).toHaveLength(0);
  });
});

test.describe('eliminar un cierre manual ya no borra los gastos a escondidas', () => {
  const conManual = () => {
    const d = datosSabado();
    d.cierres_dia.push({ id: 90, fecha: FECHA_HOY, turno: 'almuerzo', efectivo: 500000, transferencia: 100000, gastos: 20000, resultado: 580000, manual: true, platos_familia: null });
    return d;
  };

  test('pregunta qué hacer con los gastos del turno; «solo el cierre» los deja', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    const p = page.evaluate(() => eliminarCierre('2026-10-20', 'almuerzo'));
    await expect(page.locator(VENTANA)).toBeVisible();
    await expect(page.locator('#sis-cuerpo')).toContainText('2 gasto(s) registrado(s) por $30.000');
    await page.locator(VENTANA).locator('button[data-eleccion="solo"]').click();
    await p;
    expect(escritura(reg, 'DELETE', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);
    expect(await cierreDe(page)).toBeNull();
    expect(await gastosDe(page)).toHaveLength(2);
  });

  test('«el cierre y sus gastos» sí los borra', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    const p = page.evaluate(() => eliminarCierre('2026-10-20', 'almuerzo'));
    await page.locator(VENTANA).locator('button[data-eleccion="todo"]').click();
    await p;
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(2);
    expect(await gastosDe(page)).toHaveLength(0);
  });

  test('«Volver» (o Esc) no borra nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: conManual() });
    const p = page.evaluate(() => eliminarCierre('2026-10-20', 'almuerzo'));
    await page.locator(VENTANA).locator('button[data-eleccion="no"]').click();
    await p;
    expect(reg.escrituras).toEqual([]);
    expect(await cierreDe(page)).not.toBeNull();
  });

  test('un cierre manual SIN gastos, o un cierre normal, se eliminan con la pregunta de siempre (sí/no)', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin', datos: datosSabado() });
    const p = page.evaluate(() => eliminarCierre('2026-10-18', 'almuerzo'));      // normal, con 1 gasto
    await expect(page.locator('#sis-titulo')).toContainText('¿Eliminar el cierre del 2026-10-18');
    await page.locator(VENTANA).locator('button[data-eleccion="si"]').click();
    await p;
    expect(escritura(reg, 'DELETE', 'cierres_dia')).toHaveLength(1);
    expect(escritura(reg, 'DELETE', 'gastos_dia')).toHaveLength(0);              // el cierre normal deja sus gastos
  });
});
