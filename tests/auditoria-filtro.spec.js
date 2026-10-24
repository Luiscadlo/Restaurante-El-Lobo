// Auditoría: filtro por día (pedido del dueño, 24-oct-2026: «poder filtrar por día específico»).
//
// Las tres tablas de Auditoría se filtran con el mismo filtro de fechas de Egresos/Ingresos:
//   · Ajustes manuales → por la fecha del CIERRE.
//   · Pedidos eliminados y descuentos → por el día (hora local, Colombia) en que se hicieron (created_at),
//     que es lo que dice su primera columna — NO por el día del pedido original.
// Los datos de ejemplo traen eventos en varios días a propósito, incluidos dos que cruzan la medianoche
// UTC (en Colombia siguen siendo del día anterior): ahí es donde un filtro mal hecho se equivocaría.
//
// «Hoy» de las pruebas = martes 2026-10-20 (14:00 Bogotá). La semana arranca el domingo 18-oct.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

// Eventos de ejemplo (además de los de tests/fixtures/datos.js):
//  eliminados:  E-17a  17-oct 20:00 (fixture, id 1) · E-17b  17-oct 21:30 Bogotá = 18-oct 02:30 UTC · E-20  20-oct 19:00
//  descuentos:  D-19a  19-oct 10:00 · D-19b  19-oct 23:30 Bogotá = 20-oct 04:30 UTC · D-20  20-oct 12:31 (fixture, id 1)
//  ajustes:     cierre 05-oct (ajuste_manual 5000) y cierre 18-oct (ajustes separados), ambos del fixture
function datosAuditoria() {
  const d = copia(BASE);
  d.pedidos_eliminados[0].detalle = 'E-17a';
  d.pedidos_eliminados.push(
    { id: 2, created_at: '2026-10-18T02:30:00Z', fecha: '2026-10-15', hora: '13:00', turno: 'almuerzo', pedido: 'Hamburguesa', detalle: 'E-17b', monto_total: 15000, metodo: 'efectivo', motivo: 'eliminado' },
    { id: 3, created_at: '2026-10-20T19:00:00-05:00', fecha: '2026-10-20', hora: '18:40', turno: 'cena', pedido: 'Hamburguesa', detalle: 'E-20', monto_total: 12000, metodo: 'efectivo', motivo: 'cancelado' },
  );
  d.pedidos_descuentos[0].motivo = 'D-20';
  d.pedidos_descuentos.push(
    { id: 2, created_at: '2026-10-19T10:00:00-05:00', pedido_id: 90, fecha: '2026-10-19', hora: '10:00', turno: 'almuerzo', descuento: 1000, motivo: 'D-19a' },
    { id: 3, created_at: '2026-10-19T23:30:00-05:00', pedido_id: 91, fecha: '2026-10-19', hora: '23:30', turno: 'cena', descuento: 1500, motivo: 'D-19b' },
  );
  return d;
}

// Filas "de verdad" de una de las tres tablas (sin el cartelito de «sin registros»), como texto.
const filas = (page, idCuerpo) => page.evaluate(id =>
  [...document.querySelectorAll(`#${id} tr`)].filter(tr => !tr.querySelector('.empty')).map(tr => tr.innerText.replace(/\s+/g, ' ').trim()), idCuerpo);
const vacio = (page, idCuerpo) => page.evaluate(id => (document.querySelector(`#${id} .empty-text`) || {}).innerText || '', idCuerpo);
const contar = async page => ({
  ajustes: (await filas(page, 'auditoria-body')).length,
  eliminados: (await filas(page, 'auditoria-eliminados-body')).length,
  descuentos: (await filas(page, 'auditoria-descuentos-body')).length,
});
const textoDe = async (page, idCuerpo) => (await filas(page, idCuerpo)).join(' || ');

async function abrir(page, opciones = {}) {
  const reg = await abrirSistema(page, { datos: datosAuditoria(), usuario: 'admin', ...opciones });
  await irA(page, 'auditoria');
  return reg;
}
const resumen = page => page.locator('#auditoria-filtro-resumen');

test.describe('Auditoría: filtro por día', () => {
  test('al abrir se ve TODO (como antes) y el resumen cuenta cuánto hay', async ({ page }) => {
    const reg = await abrir(page);
    expect(await contar(page)).toEqual({ ajustes: 2, eliminados: 3, descuentos: 3 });
    await expect(resumen(page)).toHaveText('Mostrando todo: ajustes 2 · eliminados 3 · descuentos 3');
    await expect(page.locator('#auditoria-periodo .filter-btn.active')).toHaveText('Todo');
    expect(reg.errores).toEqual([]);
  });

  test('un día específico: basta elegir «Desde» (el otro extremo se pone igual) y salen solo los de ese día', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-17');
    expect(await page.inputValue('#auditoria-hasta')).toBe('2026-10-17');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 2, descuentos: 0 });
    const elim = await textoDe(page, 'auditoria-eliminados-body');
    expect(elim).toContain('E-17a');
    expect(elim).toContain('E-17b');      // 21:30 en Colombia = 02:30 UTC del 18: sigue siendo del 17
    expect(elim).not.toContain('E-20');
    await expect(resumen(page)).toHaveText('Mostrando el 2026-10-17: ajustes 0 de 2 · eliminados 2 de 3 · descuentos 0 de 3');
    // sin resultados en ese día → el cartelito lo dice con el período, no «sin registros»
    expect(await vacio(page, 'auditoria-body')).toBe('Sin ajustes manuales en el 2026-10-17');
    expect(await vacio(page, 'auditoria-descuentos-body')).toBe('Sin descuentos en el 2026-10-17');
    // ningún botón de período queda resaltado mientras manda el rango
    await expect(page.locator('#auditoria-periodo .filter-btn.active')).toHaveCount(0);
  });

  test('también basta elegir solo «Hasta»', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-hasta', '2026-10-19');
    expect(await page.inputValue('#auditoria-desde')).toBe('2026-10-19');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 0, descuentos: 2 });
  });

  test('descuentos: se ubican por el día LOCAL en que se hicieron (23:30 del 19 no pasa al 20)', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-19');
    const d19 = await textoDe(page, 'auditoria-descuentos-body');
    expect(d19).toContain('D-19a');
    expect(d19).toContain('D-19b');       // 04:30 UTC del 20, pero 23:30 del 19 en Colombia
    expect(d19).not.toContain('D-20');
    await page.fill('#auditoria-desde', '2026-10-20');
    await page.fill('#auditoria-hasta', '2026-10-20');
    const d20 = await textoDe(page, 'auditoria-descuentos-body');
    expect(d20).toContain('D-20');
    expect(d20).not.toContain('D-19');
  });

  test('ajustes: se ubican por la fecha del CIERRE', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-18');
    expect(await contar(page)).toEqual({ ajustes: 1, eliminados: 0, descuentos: 0 });   // eliminado a las 02:30 UTC del 18 NO es del 18
    expect(await textoDe(page, 'auditoria-body')).toContain('2026-10-18');
    await page.fill('#auditoria-desde', '2026-10-05');
    await page.fill('#auditoria-hasta', '2026-10-05');
    expect(await contar(page)).toEqual({ ajustes: 1, eliminados: 0, descuentos: 0 });
    expect(await textoDe(page, 'auditoria-body')).toContain('2026-10-05');
  });

  test('«Hoy» muestra solo lo de hoy (20-oct)', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 1, descuentos: 1 });
    expect(await textoDe(page, 'auditoria-eliminados-body')).toContain('E-20');
    expect(await textoDe(page, 'auditoria-descuentos-body')).toContain('D-20');
    await expect(resumen(page)).toHaveText('Mostrando hoy: ajustes 0 de 2 · eliminados 1 de 3 · descuentos 1 de 3');
    await expect(page.locator('#auditoria-periodo .filter-btn.active')).toHaveText('Hoy');
  });

  test('«Ayer» llena el día 19-oct y muestra solo lo de ese día', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Ayer', exact: true }).click();
    expect(await page.inputValue('#auditoria-desde')).toBe('2026-10-19');
    expect(await page.inputValue('#auditoria-hasta')).toBe('2026-10-19');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 0, descuentos: 2 });
    await expect(resumen(page)).toHaveText('Mostrando el 2026-10-19: ajustes 0 de 2 · eliminados 0 de 3 · descuentos 2 de 3');
  });

  test('«Semana» (desde el domingo 18) y «Mes»', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Semana', exact: true }).click();
    expect(await contar(page)).toEqual({ ajustes: 1, eliminados: 1, descuentos: 3 });   // el cierre del 18, E-20 y los 3 descuentos
    await page.getByRole('button', { name: 'Mes', exact: true }).click();
    expect(await contar(page)).toEqual({ ajustes: 2, eliminados: 3, descuentos: 3 });   // todo octubre
  });

  test('rango «desde – hasta»: incluye los dos extremos y, si quedan al revés, se acomodan', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-17');
    await page.fill('#auditoria-hasta', '2026-10-19');
    expect(await contar(page)).toEqual({ ajustes: 1, eliminados: 2, descuentos: 2 });   // cierre del 18, E-17a/b, D-19a/b
    await expect(resumen(page)).toContainText('Mostrando del 2026-10-17 al 2026-10-19');
    // «desde» posterior a «hasta»: manda el que se acaba de editar y el otro se alinea
    await page.fill('#auditoria-desde', '2026-10-20');
    expect(await page.inputValue('#auditoria-hasta')).toBe('2026-10-20');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 1, descuentos: 1 });
  });

  test('borrar «Hasta» deja «desde ese día en adelante»', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-19');
    await page.fill('#auditoria-hasta', '');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 1, descuentos: 3 });
    await expect(resumen(page)).toContainText('Mostrando desde el 2026-10-19');
  });

  test('«Todo» y la ✕ quitan el filtro y vacían las fechas', async ({ page }) => {
    await abrir(page);
    await page.fill('#auditoria-desde', '2026-10-17');
    expect((await contar(page)).eliminados).toBe(2);
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
    expect(await contar(page)).toEqual({ ajustes: 2, eliminados: 3, descuentos: 3 });
    expect(await page.inputValue('#auditoria-desde')).toBe('');
    expect(await page.inputValue('#auditoria-hasta')).toBe('');
    await page.fill('#auditoria-desde', '2026-10-17');
    await page.getByTitle('Quitar el filtro y ver todo').click();
    expect(await contar(page)).toEqual({ ajustes: 2, eliminados: 3, descuentos: 3 });
    await expect(page.locator('#auditoria-periodo .filter-btn.active')).toHaveText('Todo');
    expect(await page.inputValue('#auditoria-hasta')).toBe('');
  });

  test('vaciar las dos fechas a mano vuelve al período de antes (no deja un filtro fantasma)', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Mes', exact: true }).click();
    await page.fill('#auditoria-desde', '2026-10-17');
    expect((await contar(page)).eliminados).toBe(2);
    await page.fill('#auditoria-desde', '');
    await page.fill('#auditoria-hasta', '');
    expect(await contar(page)).toEqual({ ajustes: 2, eliminados: 3, descuentos: 3 });
    await expect(page.locator('#auditoria-periodo .filter-btn.active')).toHaveText('Mes');
  });

  test('día sin nada: avisa «sin … en ese día» y los datos no se tocan (mirar nunca escribe)', async ({ page }) => {
    const reg = await abrir(page);
    await page.fill('#auditoria-desde', '2026-09-01');
    expect(await contar(page)).toEqual({ ajustes: 0, eliminados: 0, descuentos: 0 });
    expect(await vacio(page, 'auditoria-eliminados-body')).toBe('Sin pedidos eliminados en el 2026-09-01');
    expect(await page.evaluate(() => ({ e: ST.pedidosEliminados.length, d: ST.pedidosDescuentos.length, c: ST.cierresDia.length }))).toEqual({ e: 3, d: 3, c: 2 });
    expect(reg.escrituras).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('sin ningún registro en la base y sin filtro, los cartelitos de siempre', async ({ page }) => {
    const d = datosAuditoria();
    d.pedidos_eliminados = []; d.pedidos_descuentos = []; d.cierres_dia = [];
    await abrirSistema(page, { datos: d, usuario: 'admin' });
    await irA(page, 'auditoria');
    expect(await vacio(page, 'auditoria-body')).toBe('Sin ajustes manuales registrados');
    expect(await vacio(page, 'auditoria-eliminados-body')).toBe('Sin pedidos eliminados registrados');
    expect(await vacio(page, 'auditoria-descuentos-body')).toBe('Sin descuentos aplicados todavía');
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    // con filtro pero sin NINGÚN registro en la base: sigue diciendo «registrados», no «en hoy»
    expect(await vacio(page, 'auditoria-eliminados-body')).toBe('Sin pedidos eliminados registrados');
  });

  test('el día de un registro: usa la hora local de created_at; sin created_at (o roto) usa su fecha', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => ({
      cruce: diaDeEventoAuditoria({ created_at: '2026-10-18T02:30:00Z', fecha: '2026-10-15' }),
      normal: diaDeEventoAuditoria({ created_at: '2026-10-20T12:00:00-05:00' }),
      sinCreated: diaDeEventoAuditoria({ fecha: '2026-10-03' }),
      roto: diaDeEventoAuditoria({ created_at: 'no-es-fecha', fecha: '2026-10-04' }),
      nada: diaDeEventoAuditoria({}),
    }));
    expect(r).toEqual({ cruce: '2026-10-17', normal: '2026-10-20', sinCreated: '2026-10-03', roto: '2026-10-04', nada: '' });
  });
});

// ── El numerito de la pestaña no se traga lo que el filtro esconde ──────────────────────
test.describe('Auditoría: filtro y numerito de novedades', () => {
  const VISTOS = 'elLobo_auditoria_vistos';

  test('sin filtro, entrar marca todo como visto (igual que antes)', async ({ page }) => {
    await abrirSistema(page, { datos: datosAuditoria(), usuario: 'admin' });
    await expect(page.locator('#audit-badge')).toHaveText('7');       // 1 ajuste + 3 eliminados + 3 descuentos
    await irA(page, 'auditoria');
    await expect(page.locator('#audit-badge')).toBeHidden();
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, VISTOS)).toBe(7);
  });

  test('con un filtro de día puesto, entrar solo marca como visto lo que se ve; el resto sigue contando', async ({ page }) => {
    await abrirSistema(page, { datos: datosAuditoria(), usuario: 'admin' });
    await expect(page.locator('#audit-badge')).toHaveText('7');
    await page.evaluate(() => setFAuditoria('hoy'));                  // el filtro queda puesto de una visita anterior
    await irA(page, 'auditoria');
    await expect(page.locator('#audit-badge')).toHaveText('5');       // se vieron E-20 y D-20; faltan 5
    const guardados = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).sort(), VISTOS);
    expect(guardados).toEqual(['desc:1', 'elim:3']);
    // al quitar el filtro y volver a entrar, ahora sí se ven y se marcan todos
    await page.evaluate(() => setFAuditoria('todo'));
    await irA(page, 'ingresos');
    await irA(page, 'auditoria');
    await expect(page.locator('#audit-badge')).toBeHidden();
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, VISTOS)).toBe(7);
  });

  test('lo que ya estaba visto sigue visto aunque el filtro de hoy no lo muestre', async ({ page }) => {
    await abrirSistema(page, { datos: datosAuditoria(), usuario: 'admin' });
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['elim:1', 'desc:2', 'ajuste:2026-10-05:almuerzo', 'elim:999'])), VISTOS);   // visto en visitas anteriores (el 999 ya no existe)
    await page.evaluate(() => { actualizarBadgeAuditoria(); setFAuditoria('hoy'); });
    await expect(page.locator('#audit-badge')).toHaveText('4');       // sin ver: E-17b, E-20, D-19b y D-20
    await irA(page, 'auditoria');
    const guardados = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).sort(), VISTOS);
    expect(guardados).toEqual(['ajuste:2026-10-05:almuerzo', 'desc:1', 'desc:2', 'elim:1', 'elim:3']);   // lo anterior se conserva, se suma lo de hoy y se descarta el que ya no existe
    await expect(page.locator('#audit-badge')).toHaveText('2');       // al entrar se vieron E-20 y D-20; quedan sin ver E-17b y D-19b
  });

  test('cambiar el filtro dentro de la pestaña no cambia el numerito ni lo guardado', async ({ page }) => {
    await abrirSistema(page, { datos: datosAuditoria(), usuario: 'admin' });
    await irA(page, 'auditoria');
    const antes = await page.evaluate(k => localStorage.getItem(k), VISTOS);
    await page.fill('#auditoria-desde', '2026-10-17');
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    await expect(page.locator('#audit-badge')).toBeHidden();
    expect(await page.evaluate(k => localStorage.getItem(k), VISTOS)).toBe(antes);
  });
});
