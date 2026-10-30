// ⚙️ CONFIGURACIÓN del negocio (pestaña solo administrador) — etapa 1.
// Todo contra el backend falso (que imita sql/configuracion.sql: valida, sella fecha y autor, solo agrega): nada toca tu Supabase real.
// Se comprueba, desde la pantalla, que:
//   · SIN configuración guardada (o sin la tabla) el sistema se ve y cobra EXACTAMENTE como siempre: 8 mesas, +$1.000 de
//     «para llevar», $1.000 de empaque, «🐺 El Lobo», aviso de respaldo del domingo y rojo a los 10 días;
//   · con configuración guardada, TODO lo que antes estaba fijo la usa (mesas, recargo, empaque, nombre, símbolo, respaldo);
//   · rige el último cambio por «vigente desde» (no por el orden de las filas) y un valor dañado se ignora;
//   · lo que ya existe NO cambia: un pedido viejo que se edita usa el recargo que regía cuando se hizo;
//   · solo el administrador ve la pestaña y puede guardar; con caja ni aparece ni escribe;
//   · cada «Guardar» pide confirmación, valida antes de enviar, manda UNA fila nueva y deja el historial a la vista;
//   · subir las mesas crea las que falten ANTES de guardar; bajarlas se niega si hay pedidos pendientes en las que se quitan;
//   · si el servidor rechaza el valor, se avisa y no queda nada a medias;
//   · lo que escribe una persona (nombre del negocio) nunca se interpreta como código.
const { test, expect } = require('@playwright/test');
const { abrirSistema, USUARIO_POR_ROL } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const { entrarComoAdmin } = require('./helpers/sesion');

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const fila = (id, clave, valor, desde = '2026-10-01T10:00:00-05:00', por = 'luis') => ({ id, clave, valor, vigente_desde: desde, creado_por: por, creado_en: desde });
const datosCon = filas => { const d = copia(DATOS_BASE); d.configuracion = filas; return d; };
const marca = page => page.evaluate(() => document.querySelector('header .logo span').textContent.replace(/\s+/g, ' ').trim());
const hoy = page => page.evaluate(() => ({ mesas: numMesas(), recargo: recargoParaLlevar(), empaque: valorEmpaque(), nombre: nombreNegocio(), emoji: emojiNegocio(),
  dia: CFG.v('respaldo_dia_semana'), rojo: CFG.v('respaldo_rojo_dias') }));
const escrituras = (reg, tabla) => reg.escrituras.filter(e => e.tabla === tabla);

async function abrirAdmin(page, opciones = {}) {
  const nativos = aceptarAvisos(page);
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  await irA(page, 'config');
  await expect(page.locator('#config-contenido')).toBeVisible();
  return { reg, nativos };
}
async function escribir(page, clave, texto) {
  // Se teclea como una persona (respeta el largo máximo del campo); si no cabe, se pone directo: así se prueba también la revisión.
  const el = page.locator(`#cfg-${clave}`);
  await el.fill(texto);
  if ((await el.inputValue()) !== texto && !/^[\d.]+$/.test(texto)) {
    await el.evaluate((e, t) => { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, texto);
  }
}
async function guardar(page, clave) {
  await page.click(`#cfg-guardar-${clave}`);
}

// ── 1. Sin configuración: todo como siempre ──────────────────────────────────────
test.describe('sin configuración guardada: valores de siempre', () => {
  test('8 mesas, +$1.000, empaque $1.000, «🐺 El Lobo», respaldo del domingo y rojo a los 10 días', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    expect(await hoy(page)).toEqual({ mesas: 8, recargo: 1000, empaque: 1000, nombre: 'El Lobo', emoji: '🐺', dia: 0, rojo: 10 });
    expect(await marca(page)).toBe('🐺 El Lobo');
    expect(await page.title()).toBe('El Lobo — Sistema Contable');
    await expect(page.locator('#ing-mesas-grid .mesa-btn')).toHaveCount(8);
    await expect(page.locator('[data-cfg="recargo-llevar"]').first()).toHaveText('+$1.000');
    expect(await page.evaluate(() => [0, 1, 2, 7, 9, 10, 25].map(d => nivelAvisoRespaldo(d, 2)))).toEqual([null, null, null, 'ambar', 'ambar', 'rojo', 'rojo']);
    expect(reg.errores).toEqual([]);
  });

  test('la tabla configuracion con filas de El Lobo se ve igual que sin tabla (los datos de ejemplo traen mesas = 8 y «El Lobo»)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    expect(await page.evaluate(() => ST.configuracion.length)).toBe(2);
    expect(await hoy(page)).toMatchObject({ mesas: 8, recargo: 1000, nombre: 'El Lobo' });
  });

  test('si la tabla todavía no existe en Supabase: valores de siempre, sin errores, y la pestaña avisa que falta instalarla', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { tablasFaltantes: ['configuracion'] });
    expect(await page.evaluate(() => ST.configuracion)).toBeNull();
    expect(await hoy(page)).toMatchObject({ mesas: 8, recargo: 1000, empaque: 1000, nombre: 'El Lobo' });
    await expect(page.locator('#config-aviso')).toContainText('sql/configuracion.sql');
    await expect(page.locator('#cfg-guardar-mesas')).toBeDisabled();
    await expect(page.locator('#cfg-mesas')).toBeDisabled();
    await expect(page.locator('#config-historial')).toContainText('Todavía no se ha cambiado nada');
    expect(await page.evaluate(() => cfgGuardar('mesas'))).toBeUndefined();
    expect(escrituras(reg, 'configuracion')).toEqual([]);
  });
});

// ── 2. Con configuración: todo lo que estaba fijo la usa ─────────────────────────
test.describe('con configuración guardada', () => {
  const FILAS = [
    fila(1, 'mesas', 10), fila(2, 'recargo_para_llevar', 1500), fila(3, 'empaque_domicilio', 2000),
    fila(4, 'negocio_nombre', 'Mi Restaurante'), fila(5, 'negocio_emoji', '🍽️'), fila(6, 'respaldo_dia_semana', 3), fila(7, 'respaldo_rojo_dias', 14),
  ];

  test('caja ve las mesas, el rótulo, el nombre y el título de la pestaña nuevos', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja', datos: datosCon(FILAS) });
    expect(await hoy(page)).toEqual({ mesas: 10, recargo: 1500, empaque: 2000, nombre: 'Mi Restaurante', emoji: '🍽️', dia: 3, rojo: 14 });
    await expect(page.locator('#ing-mesas-grid .mesa-btn')).toHaveCount(10);
    await expect(page.locator('[data-cfg="recargo-llevar"]').first()).toHaveText('+$1.500');
    expect(await marca(page)).toBe('🍽️ Mi Restaurante');
    expect(await page.title()).toBe('Mi Restaurante — Sistema Contable');
    expect(reg.errores).toEqual([]);
  });

  test('el mapa del salón y «cambiar de mesa» dibujan las mesas configuradas', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([fila(1, 'mesas', 12)]) });
    await irA(page, 'pendientes');
    expect(await page.evaluate(() => { const c = document.createElement('div'); c.id = 'mapa-prueba'; document.body.appendChild(c); renderSalonMap('mapa-prueba'); return c.querySelectorAll('.mesa-btn').length; })).toBe(12);
    expect(await page.evaluate(() => { cambioMesaIds = [203]; renderOpcionesCambiarMesa(); return document.getElementById('cambiar-mesa-grid').querySelectorAll('.mesa-btn').length; })).toBe(12);
  });

  test('un pedido nuevo para llevar y el empaque de un domicilio cobran lo configurado', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon(FILAS) });
    const r = await page.evaluate(() => {
      seleccionarUbicacion('mesa_2');
      document.getElementById('ing-monto-alm').value = '14000';
      document.getElementById('ing-para-llevar').checked = true;
      const mesa = calcularTotalPedido().montoActual;
      seleccionarUbicacion('domicilio');
      turnoManual = 'almuerzo';
      document.getElementById('ing-monto-alm').value = '14000';
      const dom = calcularTotalPedido();
      return { mesa, empaque: dom.empaqueDomicilio, montoActual: dom.montoActual };
    });
    expect(r.mesa).toBe(14000 + 1500);              // el recargo de «para llevar» configurado
    expect(r.empaque).toBe(2000);                    // el empaque de domicilio configurado (un almuerzo)
    expect(r.montoActual).toBe(14000);               // y el domicilio no lleva el recargo de «para llevar»
  });

  test('el empaque de domicilio configurado se cobra al registrar el pedido, por cada almuerzo', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { datos: datosCon(FILAS) });                // FILAS: empaque_domicilio = 2000
    await page.evaluate(async () => {
      selectedUbicacion = 'domicilio'; turnoManual = 'almuerzo';
      almuerzosEnCola = [{ pedido: 'Completo', sopa: '', arroz: '', proteina: '', acomp: '', detalle: '', cantidad: 2,
                           monto_unit: 14000, monto_almuerzo: 28000, para_llevar: false }];
      document.getElementById('ing-domicilio-valor').value = '3.000';
      await agregarIngreso('pendiente');
    });
    await expect.poll(() => escrituras(reg, 'pedidos').filter(e => e.metodo === 'POST').length).toBe(1);
    const pedido = escrituras(reg, 'pedidos').find(e => e.metodo === 'POST').cuerpo;
    expect(pedido.monto_domicilio).toBe(3000 + 2000 * 2);        // el envío + el empaque configurado × 2 almuerzos
    expect(pedido.monto_total).toBe(28000 + 3000 + 2000 * 2);
    expect(reg.errores).toEqual([]);
  });

  test('rige el último cambio por «vigente desde», no por el orden de las filas; un valor dañado se ignora', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([
      fila(1, 'mesas', 12, '2026-10-15T10:00:00-05:00'),            // la más NUEVA, aunque tenga el id más bajo
      fila(2, 'mesas', 9, '2026-10-05T10:00:00-05:00'),
      fila(3, 'recargo_para_llevar', 2000, '2026-10-01T10:00:00-05:00'),
      fila(4, 'recargo_para_llevar', 'mucho', '2026-10-10T10:00:00-05:00'),   // dañado: no sirve
      fila(5, 'empaque_domicilio', -5, '2026-10-10T10:00:00-05:00'),           // fuera de rango: no sirve
      fila(6, 'cosa_que_no_existe', 7),
    ]) });
    expect(await hoy(page)).toMatchObject({ mesas: 12, recargo: 2000, empaque: 1000 });
  });

  test('qué regía en cada fecha: antes del primer cambio, el valor de siempre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon([fila(1, 'recargo_para_llevar', 1500, '2026-10-10T10:00:00-05:00'), fila(2, 'recargo_para_llevar', 2000, '2026-10-18T10:00:00-05:00')]) });
    const r = await page.evaluate(() => ({
      antes: recargoParaLlevar('2026-10-05T12:00:00-05:00'), uno: recargoParaLlevar('2026-10-12T12:00:00-05:00'), dos: recargoParaLlevar('2026-10-19T12:00:00-05:00'),
      justo: recargoParaLlevar('2026-10-10T10:00:00-05:00'), hoy: recargoParaLlevar(), ilegible: recargoParaLlevar('no es fecha'), vacio: recargoParaLlevar(null),
    }));
    expect(r).toEqual({ antes: 1000, uno: 1500, dos: 2000, justo: 1500, hoy: 2000, ilegible: 2000, vacio: 2000 });
  });

  test('editar un pedido que ya existía usa el recargo de cuando se hizo, no el de hoy', async ({ page }) => {
    const d = datosCon([fila(1, 'recargo_para_llevar', 2000, '2026-10-18T10:00:00-05:00')]);
    d.pedidos.push({ ...d.pedidos.find(p => p.id === 203), id: 301, pedido: 'completo', mesa: 4, para_llevar: true, monto_unit: 14000, monto_almuerzo: 15000, monto_total: 15000,
                     created_at: '2026-10-12T12:00:00-05:00', fecha: '2026-10-12' });         // se hizo con el recargo de $1.000
    d.pedidos.push({ ...d.pedidos.find(p => p.id === 203), id: 302, pedido: 'completo', mesa: 5, para_llevar: true, monto_unit: 14000, monto_almuerzo: 16000, monto_total: 16000,
                     created_at: '2026-10-19T12:00:00-05:00', fecha: '2026-10-19' });         // se hizo con $2.000
    const { reg } = await abrirAdmin(page, { datos: d });
    const r = await page.evaluate(() => ({ viejo: recargoParaLlevar(ST.pendientes.find(p => p.id === 301).created_at), nuevo: recargoParaLlevar(ST.pendientes.find(p => p.id === 302).created_at) }));
    expect(r).toEqual({ viejo: 1000, nuevo: 2000 });
    // Cambiar la cantidad del pedido viejo: lo recalcula con SU recargo ($1.000), no con el de hoy ($2.000)…
    const r2 = await page.evaluate(() => {
      const mostrar = id => {
        abrirModalEditarPedido(id);
        document.getElementById('editar-ped-cantidad').value = '2';
        recalcularEditarPedidoMonto();
        return { texto: document.getElementById('editar-ped-monto-display').textContent, base: PRECIOS[document.getElementById('editar-ped-tipo').value] };
      };
      const viejo = mostrar(301), nuevo = mostrar(302);
      return { viejo: viejo.texto, nuevo: nuevo.texto, esperadoViejo: fmt((viejo.base + 1000) * 2), esperadoNuevo: fmt((nuevo.base + 2000) * 2), base: viejo.base };
    });
    expect(r2.base).toBeGreaterThan(0);
    expect(r2.viejo).toBe(r2.esperadoViejo);
    expect(r2.nuevo).toBe(r2.esperadoNuevo);
    expect(r2.viejo).not.toBe(r2.nuevo);
    // …y al guardar la edición del viejo, lo que se manda a la base también usa los $1.000 de entonces.
    await page.evaluate(() => { abrirModalEditarPedido(301); document.getElementById('editar-ped-cantidad').value = '2'; return guardarEdicionPedido(); });
    await expect.poll(() => reg.escrituras.filter(e => e.tabla === 'pedidos' && e.metodo === 'PATCH').length).toBe(1);
    const parche = reg.escrituras.find(e => e.tabla === 'pedidos' && e.metodo === 'PATCH').cuerpo;
    expect(parche.monto_almuerzo).toBe((r2.base + 1000) * 2);
    expect(reg.errores).toEqual([]);
  });

  test('el aviso de respaldo usa el día y los días en rojo configurados', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja', datos: datosCon(FILAS) });       // respaldo los miércoles, rojo a los 14 días
    const r = await page.evaluate(() => ({
      // hoy jueves (4): el miércoles fue ayer → un respaldo de hace 1 día sirve; de hace 2, no.
      jueves: [0, 1, 2, 9, 13, 14].map(d => nivelAvisoRespaldo(d, 4)),
      // hoy miércoles (3): solo sirve el de hoy.
      miercoles: [0, 1].map(d => nivelAvisoRespaldo(d, 3)),
      // hoy martes (2): el miércoles anterior fue hace 6 días.
      martes: [0, 5, 6, 7].map(d => nivelAvisoRespaldo(d, 2)),
    }));
    expect(r.jueves).toEqual([null, null, 'ambar', 'ambar', 'ambar', 'rojo']);
    expect(r.miercoles).toEqual([null, 'ambar']);
    expect(r.martes).toEqual([null, null, null, 'ambar']);
  });
});

// ── 3. La pestaña ⚙️ Configuración ──────────────────────────────────────────────
test.describe('la pestaña', () => {
  test('con caja no se ve; con administrador sí, y muestra «Hoy» de cada valor', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    await expect(page.locator('#tab-nav-config')).toBeHidden();
    await entrarComoAdmin(page);
    await expect(page.locator('#tab-nav-config')).toBeVisible();
    await irA(page, 'config');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 8 mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('desde');             // trae mesas = 8 de los datos de ejemplo
    await expect(page.locator('#cfg-hoy-recargo_para_llevar')).toContainText('Hoy: $1.000 · el valor de siempre');
    await expect(page.locator('#cfg-hoy-respaldo_dia_semana')).toContainText('Domingo');
    await expect(page.locator('#cfg-recargo_para_llevar')).toHaveValue('1.000');
  });

  test('al volver a caja la pestaña desaparece y, si estaba abierta, se regresa a Pedidos', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    await entrarComoAdmin(page);
    await irA(page, 'config');
    await page.evaluate(() => quitarAdmin());
    await expect(page.locator('#tab-nav-config')).toBeHidden();
    await expect(page.locator('#tab-ingresos')).toHaveClass(/active/);
  });

  test('caja no puede guardar ni llamando a la función a mano: no sale ninguna petición', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    await page.evaluate(() => cfgGuardar('mesas'));
    expect(escrituras(reg, 'configuracion')).toEqual([]);
    expect(reg.denegadas).toEqual([]);
  });

  test('el botón Guardar se enciende solo cuando el valor cambia', async ({ page }) => {
    await abrirAdmin(page);
    const boton = page.locator('#cfg-guardar-recargo_para_llevar');
    await expect(boton).toBeDisabled();
    await escribir(page, 'recargo_para_llevar', '1500');
    await expect(boton).toBeEnabled();
    await expect(page.locator('#cfg-recargo_para_llevar')).toHaveValue('1.500');       // con puntos de miles, como los demás campos de dinero
    await escribir(page, 'recargo_para_llevar', '1000');
    await expect(boton).toBeDisabled();
  });

  test('lo que se está escribiendo no se pisa cuando la pantalla se redibuja', async ({ page }) => {
    await abrirAdmin(page);
    await escribir(page, 'recargo_para_llevar', '1750');
    await page.evaluate(() => renderAll());
    await page.evaluate(() => renderConfiguracion());
    await expect(page.locator('#cfg-recargo_para_llevar')).toHaveValue('1.750');
  });
});

// ── 4. Guardar un cambio ─────────────────────────────────────────────────────────
test.describe('guardar', () => {
  test('pide confirmación diciendo de cuánto a cuánto; al aceptar manda UNA fila nueva y todo se actualiza', async ({ page }) => {
    const { reg, nativos } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });                 // aquí se contesta a mano
    await escribir(page, 'recargo_para_llevar', '1500');
    await guardar(page, 'recargo_para_llevar');
    const ventana = page.locator('#modal-sistema');
    await expect(ventana).toBeVisible();
    await expect(page.locator('#sis-titulo')).toHaveText('¿Guardar este cambio?');
    await expect(page.locator('#sis-cuerpo')).toContainText('Hoy: $1.000  →  Nuevo: $1.500');
    await expect(page.locator('#sis-cuerpo')).toContainText('Rige desde ahora. Lo que ya se vendió o se cerró no cambia.');
    expect(escrituras(reg, 'configuracion')).toEqual([]);                             // todavía no se mandó nada
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(page.locator('#cfg-hoy-recargo_para_llevar')).toContainText('Hoy: $1.500');
    const mandadas = escrituras(reg, 'configuracion');
    expect(mandadas.length).toBe(1);
    expect(mandadas[0].cuerpo).toEqual({ clave: 'recargo_para_llevar', valor: 1500 });   // y nada más: la fecha y el autor los pone la base
    expect(await page.evaluate(() => recargoParaLlevar())).toBe(1500);
    await expect(page.locator('[data-cfg="recargo-llevar"]').first()).toHaveText('+$1.500');
    await expect(page.locator('#config-historial')).toContainText('Recargo «para llevar»');
    await expect(page.locator('#config-historial tbody tr').first()).toContainText('rige hoy');   // la fila nueva, arriba
    await expect(page.locator('#config-historial .badge-green')).toHaveCount(3);                    // rige hoy: este + los dos valores de ejemplo
    expect(nativos).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('un doble clic en «Guardar» no guarda dos veces', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.route(/\/rest\/v1\/configuracion/, async ruta => {                      // el servidor tarda en contestar
      if (ruta.request().method() === 'POST') await new Promise(r => setTimeout(r, 700));
      await ruta.fallback();
    });
    await escribir(page, 'empaque_domicilio', '1500');
    await guardar(page, 'empaque_domicilio');                                          // se acepta sola la confirmación…
    await page.waitForFunction(() => cfgGuardando === true);                           // …y el envío queda en camino
    await page.evaluate(() => cfgGuardar('empaque_domicilio'));                        // segundo clic mientras tanto
    await expect(page.locator('#cfg-hoy-empaque_domicilio')).toContainText('$1.500');
    expect(escrituras(reg, 'configuracion').length).toBe(1);
    expect(await page.evaluate(() => ST.configuracion.filter(f => f.clave === 'empaque_domicilio').length)).toBe(1);   // y una sola fila en la historia
    expect(reg.errores).toEqual([]);
  });

  test('caja no puede guardar configuración ni llamando a la función: avisa y no manda nada', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'caja' });
    await page.evaluate(() => cfgGuardar('mesas'));
    await expect(page.locator('.toast.warning')).toContainText('Solo el administrador puede cambiar la configuración');
    expect(escrituras(reg, 'configuracion')).toEqual([]);
    expect(reg.denegadas).toEqual([]);                                                // ni siquiera se intentó
  });

  test('«Volver» no guarda nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await escribir(page, 'empaque_domicilio', '3000');
    await guardar(page, 'empaque_domicilio');
    await page.click('#sis-opciones button[data-eleccion="no"]');
    await page.waitForTimeout(150);
    expect(escrituras(reg, 'configuracion')).toEqual([]);
    expect(await page.evaluate(() => valorEmpaque())).toBe(1000);
    await expect(page.locator('#cfg-empaque_domicilio')).toHaveValue('3.000');           // lo escrito se queda, por si lo quiere corregir
  });

  test('el historial queda completo: cada guardado es una fila, la más nueva arriba, con quién lo hizo', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'empaque_domicilio', '1500'); await guardar(page, 'empaque_domicilio');
    await expect(page.locator('#cfg-hoy-empaque_domicilio')).toContainText('$1.500');
    await escribir(page, 'empaque_domicilio', '1800'); await guardar(page, 'empaque_domicilio');
    await expect(page.locator('#cfg-hoy-empaque_domicilio')).toContainText('$1.800');
    expect(escrituras(reg, 'configuracion').length).toBe(2);
    const filasTabla = page.locator('#config-historial tbody tr');
    await expect(filasTabla).toHaveCount(4);                                          // 2 de ejemplo + 2 nuevas
    await expect(filasTabla.nth(0)).toContainText('$1.800');
    await expect(filasTabla.nth(0)).toContainText('rige hoy');
    await expect(filasTabla.nth(1)).toContainText('$1.500');
    await expect(filasTabla.nth(1)).not.toContainText('rige hoy');
    await expect(filasTabla.nth(0)).toContainText(USUARIO_POR_ROL.admin.split('@')[0]);          // quién lo hizo: lo que va antes de la @
    expect(await page.evaluate(() => ST.configuracion.filter(f => f.clave === 'empaque_domicilio').map(f => f.valor))).toEqual([1500, 1800]);
  });

  test('lo guardado se ve al abrir de nuevo el sistema (otro equipo, otra sesión)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'negocio_nombre', 'Café Lobo'); await guardar(page, 'negocio_nombre');
    await expect(page.locator('#cfg-hoy-negocio_nombre')).toContainText('Café Lobo');
    const nuevo = await page.context().newPage();
    const reg2 = await abrirSistema(nuevo, { usuario: 'caja', datos: reg.datos });      // los datos que quedaron en el servidor falso
    expect(await marca(nuevo)).toBe('🐺 Café Lobo');
    expect(await nuevo.title()).toBe('Café Lobo — Sistema Contable');
    expect(reg2.errores).toEqual([]);
  });

  test('doble clic o Enter repetido: una sola fila', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await escribir(page, 'respaldo_rojo_dias', '14');
    await page.evaluate(() => { cfgGuardar('respaldo_rojo_dias'); cfgGuardar('respaldo_rojo_dias'); });
    await expect(page.locator('#modal-sistema')).toBeVisible();
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(page.locator('#cfg-hoy-respaldo_rojo_dias')).toContainText('14 días');
    expect(escrituras(reg, 'configuracion').length).toBe(1);
  });

  test('día del respaldo: se elige en la lista y el aviso lo usa', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.selectOption('#cfg-respaldo_dia_semana', '3');
    await guardar(page, 'respaldo_dia_semana');
    await expect(page.locator('#cfg-hoy-respaldo_dia_semana')).toContainText('Miércoles');
    expect(escrituras(reg, 'configuracion')[0].cuerpo).toEqual({ clave: 'respaldo_dia_semana', valor: 3 });
    expect(await page.evaluate(() => [1, 2].map(d => nivelAvisoRespaldo(d, 4)))).toEqual([null, 'ambar']);
  });

  test('el nombre se guarda sin espacios sobrantes y el símbolo puede quedar vacío', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'negocio_nombre', '   Café Lobo  '); await guardar(page, 'negocio_nombre');
    await escribir(page, 'negocio_emoji', ''); await guardar(page, 'negocio_emoji');
    await expect(page.locator('#cfg-hoy-negocio_emoji')).toContainText('(sin símbolo)');
    expect(escrituras(reg, 'configuracion').map(e => e.cuerpo)).toEqual([{ clave: 'negocio_nombre', valor: 'Café Lobo' }, { clave: 'negocio_emoji', valor: '' }]);
    expect(await marca(page)).toBe('Café Lobo');
  });

  test('lo que se escribe como nombre nunca se interpreta como código', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    const malo = '<img src=x onerror=window.__hackeado=1>';
    await escribir(page, 'negocio_nombre', malo.slice(0, 40)); await guardar(page, 'negocio_nombre');
    await expect(page.locator('#cfg-hoy-negocio_nombre')).toContainText('<img');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => ({ img: document.querySelectorAll('img[src="x"]').length, hack: window.__hackeado || 0 }))).toEqual({ img: 0, hack: 0 });
    expect(await marca(page)).toContain('<img');                                      // se ve como texto
    expect(reg.errores).toEqual([]);
  });
});

// ── 5. Valores que no se pueden guardar ─────────────────────────────────────────
test.describe('valores inválidos', () => {
  const CASOS = [
    ['mesas', '0', 'entre 1 y 60'], ['mesas', '61', 'entre 1 y 60'], ['mesas', '', 'debe ser un número'],
    ['recargo_para_llevar', '50001', 'entre 0 y 50.000'], ['recargo_para_llevar', '', 'debe ser un número'],
    ['empaque_domicilio', '60000', 'entre 0 y 50.000'],
    ['respaldo_rojo_dias', '6', 'entre 7 y 60'], ['respaldo_rojo_dias', '61', 'entre 7 y 60'],
    ['negocio_nombre', '', 'entre 1 y 40 caracteres'], ['negocio_nombre', 'N'.repeat(41), 'entre 1 y 40 caracteres'],
    ['negocio_emoji', '🐺'.repeat(9), 'hasta 8 caracteres'],
  ];
  for (const [clave, texto, mensaje] of CASOS) {
    test(`${clave} = «${texto.length > 12 ? texto.slice(0, 12) + '…' : texto}» se rechaza antes de mandar nada`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await escribir(page, clave, texto);
      await page.evaluate(c => cfgGuardar(c), clave);                                  // sin pasar por el botón (que quizá siga apagado)
      await expect(page.locator('.toast').last()).toContainText(mensaje);
      await page.waitForTimeout(100);
      expect(await page.locator('#modal-sistema').isVisible()).toBe(false);          // ni siquiera pregunta
      expect(escrituras(reg, 'configuracion')).toEqual([]);
    });
  }

  test('si el servidor lo rechaza igual (otra versión del sistema, otro equipo), avisa con su mensaje y no cambia nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.evaluate(() => { window.cfgValidar = () => null; });                   // se salta la revisión de la pantalla
    await escribir(page, 'mesas', '99');
    await guardar(page, 'mesas');
    await expect(page.locator('.toast').last()).toContainText('El número de mesas debe ser un número entero entre 1 y 60.');
    expect(escrituras(reg, 'configuracion')).toEqual([]);                             // la base no guardó nada
    expect(await page.evaluate(() => numMesas())).toBe(8);
    expect(await page.evaluate(() => ST.configuracion.length)).toBe(2);
  });

  test('guardar lo mismo que ya rige no escribe nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'recargo_para_llevar', '1000');
    await page.evaluate(() => cfgGuardar('recargo_para_llevar'));
    await expect(page.locator('.toast').last()).toContainText('Ya está así');
    expect(escrituras(reg, 'configuracion')).toEqual([]);
  });
});

// ── 6. Mesas ────────────────────────────────────────────────────────────────────
test.describe('número de mesas', () => {
  test('subir de 8 a 10 usa las mesas que ya existen en la tabla y dibuja 10', async ({ page }) => {
    const { reg } = await abrirAdmin(page);                                          // los datos de ejemplo traen 15 mesas
    await escribir(page, 'mesas', '10'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 10 mesas');
    expect(escrituras(reg, 'mesas')).toEqual([]);
    expect(escrituras(reg, 'configuracion').length).toBe(1);
    await expect(page.locator('#ing-mesas-grid .mesa-btn')).toHaveCount(10);
  });

  test('subir por encima de las mesas que existen en la tabla crea las que faltan ANTES de guardar el cambio', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'mesas', '18'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 18 mesas');
    const orden = reg.escrituras.map(e => e.tabla);
    expect(orden).toEqual(['mesas', 'configuracion']);                                // primero las mesas, después la configuración
    expect(escrituras(reg, 'mesas')[0].cuerpo).toEqual([16, 17, 18].map(numero => ({ numero, estado: 'libre' })));
    expect(await page.evaluate(() => ST.mesas.length)).toBe(18);
    await expect(page.locator('#ing-mesas-grid .mesa-btn')).toHaveCount(18);
  });

  test('bajar el número se niega si hay pedidos pendientes en las mesas que se quitarían', async ({ page }) => {
    const d = copia(DATOS_BASE);
    d.pedidos.push({ ...d.pedidos.find(p => p.id === 203), id: 310, mesa: 7 });
    const { reg } = await abrirAdmin(page, { datos: d });
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await escribir(page, 'mesas', '6'); await guardar(page, 'mesas');
    await expect(page.locator('#sis-titulo')).toHaveText('Todavía no se pueden quitar esas mesas');
    await expect(page.locator('#sis-cuerpo')).toContainText('la mesa 7');
    await page.click('#sis-opciones button[data-eleccion="ok"]');
    expect(escrituras(reg, 'configuracion')).toEqual([]);
    expect(await page.evaluate(() => numMesas())).toBe(8);
  });

  test('bajar el número sí se puede cuando esas mesas están sin pedidos pendientes', async ({ page }) => {
    const { reg } = await abrirAdmin(page);                                          // el único pendiente en mesa es el de la mesa 3
    await escribir(page, 'mesas', '5'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 5 mesas');
    await expect(page.locator('#ing-mesas-grid .mesa-btn')).toHaveCount(5);
    expect(escrituras(reg, 'configuracion')[0].cuerpo).toEqual({ clave: 'mesas', valor: 5 });
  });

  test('si en el formulario de Pedidos estaba elegida una mesa que ya no existe, se quita la elección', async ({ page }) => {
    await abrirAdmin(page);
    await page.evaluate(() => seleccionarUbicacion('mesa_7'));
    expect(await page.evaluate(() => selectedUbicacion)).toBe('mesa_7');
    await escribir(page, 'mesas', '5'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 5 mesas');
    expect(await page.evaluate(() => selectedUbicacion)).toBeNull();
    // y una mesa que SÍ sigue existiendo se queda elegida
    await page.evaluate(() => seleccionarUbicacion('mesa_2'));
    await escribir(page, 'mesas', '4'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 4 mesas');
    expect(await page.evaluate(() => selectedUbicacion)).toBe('mesa_2');
  });

  test('bajar exactamente hasta la mesa donde hay un pedido pendiente sí se puede (esa mesa se queda)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await escribir(page, 'mesas', '3'); await guardar(page, 'mesas');
    await expect(page.locator('#cfg-hoy-mesas')).toContainText('Hoy: 3 mesas');
    expect(escrituras(reg, 'configuracion').length).toBe(1);
  });
});

// ── 7. Respaldo y Empezar de cero ────────────────────────────────────────────────
test.describe('respaldo', () => {
  test('el respaldo completo incluye la historia de la configuración', async ({ page }) => {
    await abrirAdmin(page);
    const incluida = await page.evaluate(() => TABLAS_RESPALDO.includes('configuracion') && TABLAS_OPCIONALES_EN_ARCHIVO.includes('configuracion') && TABLAS_RESPALDO_OPCIONALES.configuracion());
    expect(incluida).toBe(true);
  });

  test('si la tabla no existe todavía, el respaldo la omite en vez de fallar', async ({ page }) => {
    await abrirAdmin(page, { tablasFaltantes: ['configuracion'] });
    expect(await page.evaluate(() => TABLAS_RESPALDO_OPCIONALES.configuracion())).toBe(false);
  });

  test('«Empezar de cero» lo dice en su aviso: la configuración del negocio se conserva', async ({ page }) => {
    await abrirAdmin(page);
    const texto = await page.evaluate(() => { const t = document.documentElement.innerHTML; return t.includes('la <b>configuración del negocio</b>'); });
    expect(texto).toBe(true);
  });
});
