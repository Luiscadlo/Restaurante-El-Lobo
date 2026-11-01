// REVISIÓN FINAL — arreglo A: «texto que parece código».
//
// El sistema pinta en pantalla muchos textos que escribe la gente (nombres de clientes, detalles de pedidos, notas, descripciones,
// direcciones, motivos...). Si uno de esos textos trae código disfrazado (por ejemplo una etiqueta <img ... onerror=...>) y la
// pantalla lo pintara «tal cual», el navegador lo EJECUTARÍA dentro de la sesión de quien mira — y el administrador mira todo.
// Esta prueba mete ese tipo de texto en TODOS los campos de texto libre de la base, recorre todas las pantallas (como
// administrador y como caja), abre las ventanas de detalle/edición, y comprueba que:
//   · no se ejecutó nada (window.__xss sigue vacío) y no apareció ninguna etiqueta nueva con código;
//   · los textos que viajan dentro de un botón (onclick/onmousedown) siguen siendo texto de JavaScript válido;
//   · el texto SÍ se ve en pantalla, literal (no se «perdió»): la prueba no es vacía.
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: BASE } = require('./fixtures/datos');

const copia = x => JSON.parse(JSON.stringify(x));
// Sale de comillas dobles y simples (rompe atributos y textos de JavaScript) y luego abre una etiqueta con código.
const S = tag => `"'><img src=x onerror=__xss.push('${tag}')>`;
const LITERAL = tag => `onerror=__xss.push('${tag}')`;            // lo que se tiene que VER escrito si el texto se pintó como texto

// Columnas de texto libre (sin lista cerrada) de cada tabla. Las de lista cerrada (turno, metodo, cuenta, tipo...) las valida la base.
const TEXTO_LIBRE = {
  pedidos: ['sopa', 'arroz', 'proteina', 'acomp', 'detalle', 'direccion', 'motivo_descuento', 'hora'],
  abonos_fiado: ['nota'], cierres_dia: ['ajuste_manual_nota'], clientes_fiado: ['nombre'], egresos: ['description'],
  gastos_dia: ['nombre'], inventario: ['nombre', 'unidad'], pedidos_eliminados: ['detalle', 'ubicacion', 'pedido'],
  pedidos_descuentos: ['motivo', 'gastos_eliminados', 'hora'],
};

function envenenar() {
  const d = copia(BASE);
  for (const [tabla, cols] of Object.entries(TEXTO_LIBRE)) {
    for (const fila of d[tabla]) for (const c of cols) if (c in fila && fila[c] !== null && fila[c] !== undefined) fila[c] = S(`${tabla}.${c}`);
  }
  // lo que está en el día de hoy se ve en todas las listas (los filtros por defecto son «hoy»)
  for (const e of d.egresos) e.fecha = FECHA_HOY;
  for (const g of d.gastos_dia) g.fecha = FECHA_HOY;
  for (const c of d.cierres_dia) { c.ajuste_manual_nota = S('cierres_dia.ajuste_manual_nota'); }
  d.cierres_dia.push({ id: 3, fecha: FECHA_HOY, turno: 'cena', efectivo: 100000, transferencia: 20000, gastos: 5000, resultado: 115000,
    ajuste_efectivo: 1000, ajuste_transferencia: 0, ajuste_manual_nota: S('cierres_dia.ajuste_manual_nota(hoy)'), manual: true, platos_familia: 0 });
  for (const f of d.pedidos_eliminados) { f.fecha = FECHA_HOY; f.ubicacion = S('pedidos_eliminados.ubicacion'); f.detalle = S('pedidos_eliminados.detalle'); f.hora = S('pedidos_eliminados.hora'); }
  d.pedidos_descuentos[0].gastos_eliminados = S('pedidos_descuentos.gastos_eliminados');
  d.pedidos_descuentos[0].fecha = S('pedidos_descuentos.fecha');

  // Más pedidos para que se dibujen TODOS los grupos de «Pendientes» (mesa con dos pedidos, sin mesa, domicilio, gratis, fiado sin dueño).
  const base = d.pedidos.find(p => p.id === 101);
  const nuevo = (id, extra) => Object.assign(copia(base), { id, grupo_pedido: `g-${id}`, hora: '12:45', created_at: `${FECHA_HOY}T12:45:00-05:00` }, extra);
  d.pedidos.push(
    nuevo(301, { estado: 'pendiente', mesa: 5, grupo_pedido: S('pedidos.grupo_pedido(mesa)'), pedido: S('pedidos.pedido'), hora: S('pedidos.hora'),
      sopa: S('pedidos.sopa'), arroz: S('pedidos.arroz'), proteina: S('pedidos.proteina'), acomp: S('pedidos.acomp'), detalle: S('pedidos.detalle') }),
    nuevo(302, { estado: 'pendiente', mesa: 5, grupo_pedido: S('pedidos.grupo_pedido(mesa)'), pedido: S('pedidos.pedido(extra)'), cantidad: 2, detalle: S('pedidos.detalle(extra)') }),
    nuevo(303, { estado: 'pendiente', es_sin_mesa: true, grupo_pedido: S('pedidos.grupo_pedido(sin mesa)'), pedido: S('pedidos.pedido(sin mesa)'), detalle: S('pedidos.detalle(sin mesa)') }),
    nuevo(304, { estado: 'pendiente', es_domicilio: true, monto_domicilio: 3000, monto_total: 18000, grupo_pedido: S('pedidos.grupo_pedido(dom)'),
      direccion: S('pedidos.direccion'), detalle: S('pedidos.detalle(dom)'), pedido: S('pedidos.pedido(dom)') }),
    nuevo(305, { estado: 'pendiente', es_gratis: true, metodo: 'gratis', turno: 'cena', hora: '20:10', grupo_pedido: S('pedidos.grupo_pedido(gratis)'),
      pedido: S('pedidos.pedido(gratis)'), detalle: S('pedidos.detalle(gratis)') }),
    nuevo(306, { estado: 'pendiente', es_fiar: true, cliente_fiado_id: null, fecha: '2026-10-08', grupo_pedido: S('pedidos.grupo_pedido(huérfano)'),
      pedido: S('pedidos.pedido(huérfano)'), detalle: S('pedidos.detalle(huérfano)'), created_at: '2026-10-08T12:45:00-05:00' }),
    nuevo(307, { estado: 'pendiente', es_fiar: true, cliente_fiado_id: 1, grupo_pedido: S('pedidos.grupo_pedido(fiado)'),
      pedido: S('pedidos.pedido(fiado)'), detalle: S('pedidos.detalle(fiado)') }),
    nuevo(308, { turno: 'cena', hora: '20:30', pedido: S('pedidos.pedido(pagado)'), detalle: S('pedidos.detalle(pagado)'), grupo_pedido: S('pedidos.grupo_pedido(pagado)') }),
  );
  d.mesas.find(m => m.numero === 5).estado = 'ocupada';

  d.notas_dia = [{ id: 1, fecha: FECHA_HOY, texto: S('notas_dia.texto'), created_at: `${FECHA_HOY}T10:00:00-05:00` }];
  d.movimientos_caja = [
    { id: 1, fecha: FECHA_HOY, tipo: 'gasto', cuenta: 'efectivo', descripcion: S('movimientos_caja.descripcion'), monto: 1000, created_at: `${FECHA_HOY}T10:00:00-05:00` },
    { id: 2, fecha: FECHA_HOY, tipo: 'traspaso', cuenta: 'efectivo', cuenta_destino: 'transf_rapidas', descripcion: S('movimientos_caja.descripcion(traspaso)'), monto: 2000, created_at: `${FECHA_HOY}T10:05:00-05:00` },
  ];
  d.ingresos_extra = [{ id: 1, fecha: FECHA_HOY, descripcion: S('ingresos_extra.descripcion'), monto: 5000, cuenta: 'efectivo', created_at: `${FECHA_HOY}T10:00:00-05:00` }];
  d.abonos_fiado[0].nota = S('abonos_fiado.nota');
  d.abonos_fiado[3].nota = S('abonos_fiado.nota(hoy)');
  return d;
}

const TABS = ['ingresos', 'pendientes', 'fiados', 'diaadia', 'inventario', 'menu', 'dashboard', 'ingfin', 'egresos', 'caja', 'auditoria', 'datos', 'config'];
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

// Revisa la pantalla tal como está: ¿se ejecutó algo? ¿hay etiquetas con código? ¿algún botón quedó con JavaScript roto?
async function revisar(page) {
  return page.evaluate(() => {
    const hallazgos = [];
    if ((window.__xss || []).length) hallazgos.push('EJECUTADO: ' + [...new Set(window.__xss)].join(', '));
    document.querySelectorAll('[onerror]').forEach(el => {
      if (!/__xss/.test(el.getAttribute('onerror'))) return;
      const donde = el.closest('[id]');
      hallazgos.push('ETIQUETA con código: ' + (el.getAttribute('onerror').match(/push\('([^']+)'/) || [])[1] + ' dentro de #' + (donde ? donde.id : '?') + ' (' + el.parentElement.tagName.toLowerCase() + ')');
    });
    document.querySelectorAll('*').forEach(el => {
      for (const a of el.attributes) {
        if (!/^on/.test(a.name) || a.name === 'onerror' || !/__xss/.test(a.value)) continue;
        try { new Function('event', a.value); } catch (e) { hallazgos.push(`BOTÓN con JavaScript roto (${a.name}): ` + a.value.slice(0, 120)); }
      }
    });
    return { hallazgos, texto: document.body.innerText };
  });
}

async function recorrer(page, pasos) {
  const hallazgos = [], visto = new Set();
  for (const [nombre, fn] of pasos) {
    try { await fn(); } catch (e) { /* algunas ventanas no aplican a ese rol: no es un hallazgo */ }
    await page.waitForTimeout(120);
    const r = await revisar(page);
    for (const h of r.hallazgos) hallazgos.push(`[${nombre}] ${h}`);
    for (const m of r.texto.matchAll(/onerror=__xss\.push\('([^']+)'\)/gi)) visto.add(m[1].toLowerCase());   // algunos rótulos se ven en MAYÚSCULAS por el diseño
  }
  return { hallazgos: [...new Set(hallazgos)], visto };
}

const abrirVentanas = page => [
  ['detalle de pedido (pagado)', () => page.evaluate(() => mostrarDetallePedidoModal(ST.ingresos.find(p => p.id === 308))) ],
  ['detalle de pedido (con todo)', () => page.evaluate(() => mostrarDetallePedidoModal(ST.pendientes.find(p => p.id === 301) || ST.ingresos.find(p => p.id === 301))) ],
  ['detalle de pedido (domicilio)', () => page.evaluate(() => mostrarDetallePedidoModal(ST.pendientes.find(p => p.id === 304) || ST.ingresos.find(p => p.id === 304))) ],
  ['descuento (con motivo)', () => page.evaluate(() => abrirModalDescuento([104])) ],
  ['editar pedido', () => page.evaluate(() => abrirModalEditarPedido(308)) ],
  ['cambiar mesa', () => page.evaluate(() => abrirModalCambiarMesa([301, 302])) ],
  ['editar egreso', () => page.evaluate(() => editarEgreso(1)) ],
  ['editar ingreso extra', () => page.evaluate(() => editarIngresoExtra(1)) ],
  ['editar movimiento de caja', () => page.evaluate(() => editarMovimientoCaja(1)) ],
  ['editar gasto del turno', () => page.evaluate(() => { showTab('diaadia', document.querySelector('.tab[onclick*="showTab(\'diaadia\'"]')); editarGastoDia(1); }) ],
  ['notas del día', () => page.evaluate(() => abrirModalNotas()) ],
  ['cierre manual existente', () => page.evaluate(() => editarCierreManual(FECHA_HOY_PAG, 'cena')) ],
];

test.describe('textos que parecen código: se muestran como texto, nunca se ejecutan', () => {
  test('administrador: todas las pantallas y ventanas con datos «envenenados»', async ({ page }) => {
    const d = envenenar();
    await page.addInitScript(() => { window.__xss = []; });
    const reg = await abrirSistema(page, { usuario: 'admin', datos: d });
    await page.evaluate(f => { window.FECHA_HOY_PAG = f; }, FECHA_HOY);
    const pasos = [['inicio', async () => {}]];
    for (const t of TABS) {
      pasos.push([`pestaña ${t}`, () => irA(page, t)]);
    }
    // pestañas con filtros «todo»: las listas muestran todas las fechas
    pasos.push(['ingresos · historial', async () => { await irA(page, 'ingresos'); await page.evaluate(() => { setFI('todos', null); }).catch(() => {}); }]);
    pasos.push(['fiados', () => irA(page, 'fiados')]);
    pasos.push(['fiados · abrir cliente', async () => { await irA(page, 'fiados'); await page.evaluate(() => { ST.clientesFiado.forEach(c => toggleFiadoCliente(c.id)); }); }]);
    pasos.push(['pendientes', () => irA(page, 'pendientes')]);
    pasos.push(...abrirVentanas(page));
    pasos.push(['día a día · cena de hoy', async () => { await irA(page, 'diaadia'); await page.evaluate(f => { document.getElementById('dd-fecha').value = f; ddTurno = 'cena'; onFechaCierreChange(); }, FECHA_HOY); }]);
    pasos.push(['día a día · almuerzo de un día cerrado', async () => { await irA(page, 'diaadia'); await page.evaluate(() => { document.getElementById('dd-fecha').value = '2026-10-18'; ddTurno = 'almuerzo'; onFechaCierreChange(); }); }]);
    const { hallazgos, visto } = await recorrer(page, pasos);
    expect(hallazgos, 'hallazgos:\n' + hallazgos.join('\n')).toEqual([]);
    expect(reg.noManejadas || []).toEqual([]);

    // la prueba no es vacía: los textos se ven escritos tal cual en pantalla
    const debenVerse = ['clientes_fiado.nombre', 'pedidos.detalle', 'pedidos.pedido', 'pedidos.direccion', 'pedidos.hora', 'egresos.description',
      'notas_dia.texto', 'abonos_fiado.nota', 'movimientos_caja.descripcion', 'ingresos_extra.descripcion', 'gastos_dia.nombre', 'inventario.nombre',
      'cierres_dia.ajuste_manual_nota', 'pedidos_eliminados.detalle', 'pedidos_eliminados.ubicacion', 'pedidos_descuentos.motivo', 'pedidos_descuentos.gastos_eliminados'];
    const faltan = debenVerse.filter(t => !visto.has(t.toLowerCase()));
    expect(faltan, 'estos textos no llegaron a verse en ninguna pantalla (la prueba no los ejercitó): ' + faltan.join(', ')).toEqual([]);
  });

  test('caja: las pantallas de caja también muestran los textos como texto', async ({ page }) => {
    const d = envenenar();
    await page.addInitScript(() => { window.__xss = []; });
    await abrirSistema(page, { usuario: 'caja', datos: d });
    const pasos = [['inicio', async () => {}]];
    for (const t of ['ingresos', 'pendientes', 'fiados', 'diaadia', 'inventario', 'menu']) pasos.push([`pestaña ${t}`, () => irA(page, t)]);
    pasos.push(...abrirVentanas(page).filter(([n]) => !/egreso|ingreso extra|movimiento/.test(n)));
    const { hallazgos, visto } = await recorrer(page, pasos);
    expect(hallazgos, 'hallazgos:\n' + hallazgos.join('\n')).toEqual([]);
    for (const t of ['clientes_fiado.nombre', 'pedidos.detalle', 'pedidos.direccion', 'notas_dia.texto']) expect(visto.has(t.toLowerCase()), `no se vio ${t}`).toBe(true);
  });

  test('un grupo de pedido con comillas y código no rompe los botones de «Pendientes»', async ({ page }) => {
    const d = envenenar();
    await page.addInitScript(() => { window.__xss = []; });
    await abrirSistema(page, { usuario: 'caja', datos: d });
    await irA(page, 'pendientes');
    // cada botón que lleva el grupo del pedido debe seguir siendo JavaScript válido y no ejecutar nada al pulsarlo
    const r = await page.evaluate(() => {
      const botones = [...document.querySelectorAll('button[onclick*="abrirModalAgregar"]')];
      return { cuantos: botones.length, validos: botones.filter(b => { try { new Function('event', b.getAttribute('onclick')); return true; } catch (e) { return false; } }).length };
    });
    expect(r.cuantos).toBeGreaterThan(0);
    expect(r.validos).toBe(r.cuantos);
    await page.evaluate(() => { document.querySelectorAll('button[onclick*="abrirModalAgregarProducto"]').forEach(b => b.click()); });
    expect(await page.evaluate(() => window.__xss)).toEqual([]);
  });

  test('el autocompletar de productos con un nombre raro no se sale del botón', async ({ page }) => {
    await page.addInitScript(() => { window.__xss = []; });
    await abrirSistema(page, { usuario: 'caja' });
    const r = await page.evaluate(() => {
      const nombre = `Café "doble" d'oro \\ <b>x</b>`;
      const html = `<div onmousedown="pickAC(event,'pr',${jsAttr(nombre)})">x</div>`;
      const caja = document.createElement('div'); caja.innerHTML = html;
      const el = caja.firstElementChild;
      let recibido = null;
      window.pickAC = (ev, tipo, n) => { recibido = n; };
      el.dispatchEvent(new MouseEvent('mousedown'));
      return recibido === nombre;
    });
    expect(r).toBe(true);
  });
});

test.describe('ayudantes de seguridad', () => {
  test('jsAttr: ida y vuelta exacta por un atributo HTML, con cualquier carácter raro', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    const malos = await page.evaluate(() => {
      const casos = ['', 'a', `'`, `"`, `\\`, `\\'`, `');alert(1);('`, `"><img src=x onerror=alert(1)>`, '<script>x</script>', 'línea\nnueva', ' ', '`${1}`', '&amp;', 'ñandú €', null, undefined, 12];
      const fallos = [];
      for (const c of casos) {
        let recibido; window.__rx = v => { recibido = v; };
        const cont = document.createElement('div');
        cont.innerHTML = `<button onclick="__rx(${jsAttr(c)})">x</button>`;
        cont.firstElementChild.click();
        const esperado = c == null ? '' : String(c);
        if (recibido !== esperado) fallos.push(JSON.stringify(c));
      }
      return fallos;
    });
    expect(malos).toEqual([]);
  });

  test('idSeguro: deja solo letras, números, guion y guion bajo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    const r = await page.evaluate(() => [idSeguro(`g-123_x`), idSeguro(`g'"><img src=x onerror=1>`), idSeguro(null), idSeguro(77)]);
    expect(r).toEqual(['g-123_x', 'g____img_src_x_onerror_1_', '', '77']);
  });

  test('la política de seguridad solo deja hablar con el Supabase de El Lobo', async ({ page }) => {
    await abrirSistema(page, { usuario: 'caja' });
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    expect(csp).toContain("connect-src https://arxyfcquvsmfoxmbifne.supabase.co;");
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
