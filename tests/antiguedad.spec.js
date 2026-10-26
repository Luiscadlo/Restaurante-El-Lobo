// Indicadores de antigüedad en la pantalla (Prompt B): chips en Fiados y Pendientes, borde rojo
// en el mapa de mesas y la alerta del Tablero. "Hoy" = martes 2026-10-20, las 14:00 (Bogotá).
// Las funciones puras (días, colores, textos) se prueban en reglas.spec.js.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');
const { entrarComoAdmin } = require('./helpers/sesion');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
let reg;
test.afterEach(() => {
  expect(reg.errores).toEqual([]);
  expect(reg.escrituras).toEqual([]);   // mirar nunca escribe en la base
});

async function irA(page, id) {
  await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
}

// Una fila de "pedidos" copiada de un fiado de ejemplo (id 201) con lo que cambie.
function conPedidos(extra) {
  const d = copia(DATOS_BASE);
  const molde = d.pedidos.find(p => p.id === 201);
  extra.forEach(e => d.pedidos.push(Object.assign(copia(molde), { grupo_pedido: `g-${e.id}` }, e)));
  return d;
}
const fiado = (id, cliente, fecha, monto = 10000) => ({
  id, cliente_fiado_id: cliente, fecha, created_at: `${fecha}T13:00:00-05:00`,
  monto_total: monto, monto_almuerzo: monto, monto_unit: monto, es_fiar: true, estado: 'pendiente',
});
const pendiente = (id, fecha, hora, extra = {}) => Object.assign({
  id, fecha, hora, created_at: `${fecha}T${hora}:00-05:00`, estado: 'pendiente', es_fiar: false, cliente_fiado_id: null,
  mesa: null, es_domicilio: false, es_sin_mesa: false, es_gratis: false,
}, extra);

// La tarjeta de un cliente en la pestaña Fiados → su chip de antigüedad (o null).
async function chipDeCliente(page, nombre) {
  const tarjeta = page.locator('#fiados-clientes-zone .pending-group', { hasText: nombre }).first();
  const chip = tarjeta.locator('.pending-group-hdr [data-antiguedad]');
  if (await chip.count() === 0) return null;
  return { nivel: await chip.getAttribute('data-antiguedad'), texto: (await chip.textContent()).trim() };
}

test.describe('Fiados', () => {
  test('con los datos de ejemplo: Cliente Uno → su fiado más viejo es del 10-oct (10 días) → amarillo', async ({ page }) => {
    reg = await abrirSistema(page);
    await irA(page, 'fiados');
    expect(await chipDeCliente(page, 'Cliente Uno (prueba)')).toEqual({ nivel: 'amarillo', texto: '⏱ hace 10 días' });
  });

  test('un chip por color: reciente, amarillo, naranja, y rojo si es de un mes anterior', async ({ page }) => {
    const d = conPedidos([
      fiado(301, 3, '2026-10-19'),   // 1 día   → reciente
      fiado(302, 4, '2026-10-05'),   // 15 días → naranja
      fiado(303, 5, '2026-09-29'),   // 21 días y de otro mes → rojo
    ]);
    d.clientes_fiado.push(
      { id: 3, nombre: 'Cliente Tres (prueba)' }, { id: 4, nombre: 'Cliente Cuatro (prueba)' }, { id: 5, nombre: 'Cliente Cinco (prueba)' });
    reg = await abrirSistema(page, { datos: d });
    await irA(page, 'fiados');
    expect(await chipDeCliente(page, 'Cliente Uno (prueba)')).toEqual({ nivel: 'amarillo', texto: '⏱ hace 10 días' });
    expect(await chipDeCliente(page, 'Cliente Tres (prueba)')).toEqual({ nivel: 'reciente', texto: '⏱ de ayer' });
    expect(await chipDeCliente(page, 'Cliente Cuatro (prueba)')).toEqual({ nivel: 'naranja', texto: '⏱ hace 15 días' });
    expect(await chipDeCliente(page, 'Cliente Cinco (prueba)')).toEqual({ nivel: 'rojo', texto: '⏱ hace 21 días · mes anterior' });
  });

  test('el chip usa el pedido pendiente MÁS VIEJO del cliente, no el último', async ({ page }) => {
    // Cliente Uno ya tiene fiados del 10-oct y del 14-oct; se agrega uno de ayer: sigue mandando el del 10-oct.
    reg = await abrirSistema(page, { datos: conPedidos([fiado(304, 1, '2026-10-19')]) });
    await irA(page, 'fiados');
    expect(await chipDeCliente(page, 'Cliente Uno (prueba)')).toEqual({ nivel: 'amarillo', texto: '⏱ hace 10 días' });
  });

  test('NO cambia el orden de la lista: sigue de mayor a menor saldo, sin importar la antigüedad', async ({ page }) => {
    const d = conPedidos([
      fiado(305, 3, '2026-10-19', 500000),   // saldo enorme pero de ayer
      fiado(306, 4, '2026-09-20', 1000),     // saldo mínimo pero muy viejo
    ]);
    d.clientes_fiado.push({ id: 3, nombre: 'Cliente Tres (prueba)' }, { id: 4, nombre: 'Cliente Cuatro (prueba)' });
    reg = await abrirSistema(page, { datos: d });
    await irA(page, 'fiados');
    const nombres = await page.locator('#fiados-clientes-zone .pending-group-title').allTextContents();
    expect(nombres.map(n => n.replace('📒', '').trim())).toEqual(['Cliente Tres (prueba)', 'Cliente Uno (prueba)', 'Cliente Cuatro (prueba)']);
    // saldos: Tres 500.000 > Uno 9.000 (pendientes 35.000 − abonos 26.000) > Cuatro 1.000
  });

  test('los fiados sin cliente (huérfanos) también muestran su antigüedad', async ({ page }) => {
    reg = await abrirSistema(page, { datos: conPedidos([fiado(307, null, '2026-10-02')]) });   // 18 días → naranja
    await irA(page, 'fiados');
    const chip = page.locator('#fiados-clientes-zone .alert [data-antiguedad]');
    await expect(chip).toHaveAttribute('data-antiguedad', 'naranja');
    await expect(chip).toContainText('hace 18 días');
  });
});

test.describe('Pendientes', () => {
  test('datos de ejemplo: la mesa 3 de hoy muestra el tiempo abierto y el domicilio de ayer sale en rojo', async ({ page }) => {
    reg = await abrirSistema(page);
    await irA(page, 'pendientes');
    const mesa = page.locator('#mesa-group-3-1 [data-antiguedad]');
    await expect(mesa).toHaveAttribute('data-antiguedad', 'hoy');
    await expect(mesa).toContainText('1 h 20 min');                       // 12:40 → 14:00
    const dom = page.locator('#pendientes-domicilios-zone [data-antiguedad]');
    await expect(dom).toHaveAttribute('data-antiguedad', 'vieja');
    await expect(dom).toContainText('de ayer');
  });

  test('sin mesa y gratis tienen su chip (de otro día / de hoy)', async ({ page }) => {
    const d = conPedidos([
      pendiente(401, '2026-10-14', '13:00', { es_sin_mesa: true }),
      pendiente(402, '2026-10-20', '13:50', { es_gratis: true }),
    ]);
    reg = await abrirSistema(page, { datos: d });
    await irA(page, 'pendientes');
    const sinMesa = page.locator('#pendientes-sinmesa-zone [data-antiguedad]');
    await expect(sinMesa).toHaveAttribute('data-antiguedad', 'vieja');
    await expect(sinMesa).toContainText('de 14-10');
    const gratis = page.locator('#pendientes-gratis-zone [data-antiguedad]');
    await expect(gratis).toHaveAttribute('data-antiguedad', 'hoy');
    await expect(gratis).toContainText('10 min');
  });

  test('los fiados no aparecen en Pendientes (siguen viviendo en su pestaña)', async ({ page }) => {
    reg = await abrirSistema(page);
    await irA(page, 'pendientes');
    const chips = await page.locator('#tab-pendientes [data-antiguedad]').count();
    expect(chips).toBe(2);   // solo la mesa 3 y el domicilio de ayer
  });
});

test.describe('Mapa de mesas', () => {
  test('borde rojo solo en las mesas con pedidos de días anteriores', async ({ page }) => {
    const d = conPedidos([pendiente(403, '2026-10-19', '20:00', { mesa: 5 })]);
    reg = await abrirSistema(page, { datos: d });
    await irA(page, 'pendientes');
    const viejas = page.locator('#pend-salon-grid .mesa-btn.vieja');
    await expect(viejas).toHaveCount(1);
    await expect(viejas).toContainText('Mesa 5');
    await expect(page.locator('#pend-salon-grid .mesa-btn.pendiente').filter({ hasText: 'Mesa 3' })).not.toHaveClass(/vieja/);
  });

  test('con los datos de ejemplo (mesa 3 de hoy) ninguna mesa sale en rojo', async ({ page }) => {
    reg = await abrirSistema(page);
    await irA(page, 'pendientes');
    await expect(page.locator('#pend-salon-grid .mesa-btn.vieja')).toHaveCount(0);
  });
});

test.describe('Tablero', () => {
  const alertas = page => page.locator('#alertZone').textContent();

  test('sin fiados de 15 días o más: la alerta NO aparece', async ({ page }) => {
    reg = await abrirSistema(page);            // el más viejo tiene 10 días
    await entrarComoAdmin(page);
    await irA(page, 'dashboard');
    const texto = await alertas(page);
    expect(texto).toContain('en fiados por cobrar');
    expect(texto).not.toContain('días o más sin pagar');
  });

  test('con fiados de 15 días o más: "N fiado(s) … $X" (cuenta también los de otro mes y los huérfanos)', async ({ page }) => {
    const d = conPedidos([
      fiado(501, 3, '2026-10-05', 20000),    // 15 días → entra (justo en el umbral)
      fiado(502, 3, '2026-10-12', 99000),    // 8 días  → no entra
      fiado(503, null, '2026-09-29', 12000), // 21 días, huérfano → entra
    ]);
    d.clientes_fiado.push({ id: 3, nombre: 'Cliente Tres (prueba)' });
    reg = await abrirSistema(page, { datos: d });
    await entrarComoAdmin(page);
    await irA(page, 'dashboard');
    expect(await alertas(page)).toContain('2 fiado(s) con 15 días o más sin pagar · $32.000');
  });
});
