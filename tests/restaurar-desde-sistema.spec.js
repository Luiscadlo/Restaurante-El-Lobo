// RESTAURAR DESDE UN RESPALDO y EMPEZAR DE CERO (pestaña Datos, solo administrador).
// Todo contra el backend falso (que imita las dos funciones de sql/restaurar_respaldo.sql): nada toca tu Supabase real.
// Se comprueba, desde la pantalla, que:
//   · solo el administrador lo ve y lo puede usar (con caja, ni aparece ni responde);
//   · la nota deja claro que solo sirve el .json original y que no se edita;
//   · un archivo que no es el respaldo del sistema (otro formato, roto, recortado, modificado, de otro programa) se
//     rechaza ANTES de tocar nada, con un mensaje claro;
//   · antes de pedir nada se ve qué cambia (ahora vs respaldo) y hace falta la palabra exacta y la contraseña;
//   · el orden es: contraseña → copia de lo actual (descargada) → recién ahí la base;
//   · si algo falla (contraseña, copia, servidor, conexión) no se cambia nada y el mensaje lo dice;
//   · después, la pantalla muestra los datos restaurados; «Empezar de cero» deja mesas libres e inventario según la casilla.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { abrirSistema, USUARIOS, URL_HTML } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { entrarComoAdmin, salirDeAdmin } = require('./helpers/sesion');

const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const CLAVE_ADMIN = USUARIOS['dueno1@elobo.test'].password;
const HTML_TEXTO = fs.readFileSync(decodeURIComponent(new URL(URL_HTML).pathname), 'utf-8');

// Un respaldo como el que baja el sistema, hecho con los datos de ejemplo (por defecto, con MENOS pedidos que ahora).
function respaldoDe(datos, extra = {}) {
  const tablas = copia(datos);
  return { version: 1, generado_en: '2026-10-19T15:30:00.000Z', fecha: '2026-10-19', conteos: Object.fromEntries(Object.entries(tablas).map(([k, v]) => [k, v.length])), tablas, ...extra };
}
function respaldoViejo() {
  const d = copia(DATOS_BASE);
  d.pedidos = d.pedidos.slice(0, 6);
  d.cierres_dia = d.cierres_dia.slice(0, 1);
  return respaldoDe(d);
}
const archivo = (obj, name = 'ElLobo_respaldo_completo_2026-10-19.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });

async function abrirAdmin(page, opciones = {}) {
  const reg = await abrirSistema(page, { usuario: 'admin', ...opciones });
  const descargas = [];
  page.on('download', d => descargas.push(d));
  await irA(page, 'datos');
  await expect(page.locator('#panel-restaurar')).toBeVisible();
  return { reg, descargas };
}
const elegir = (page, obj, name) => page.setInputFiles('#restaurar-archivo', archivo(obj, name));
async function elegirValido(page, obj = respaldoViejo()) {
  await elegir(page, obj);
  await expect(page.locator('#restaurar-resumen .rest-ok')).toBeVisible();
  await expect(page.locator('#btn-restaurar')).toBeEnabled();
}
async function abrirYConfirmar(page, { palabra = 'RESTAURAR', clave = CLAVE_ADMIN } = {}) {
  await page.fill('#rest-palabra', palabra);
  await page.fill('#rest-clave', clave);
}
const contenido = async d => JSON.parse(fs.readFileSync(await d.path(), 'utf-8'));
const pedidosEnPantalla = page => page.evaluate(() => ST.ingresos.length + ST.pendientes.length);
const esperarResultado = page => expect(page.locator('#rest-resultado')).toBeVisible({ timeout: 20000 });

// ── Quién lo ve ───────────────────────────────────────────────────────────
test.describe('quién puede', () => {
  test('con caja no se ve ni responde: sin ventana, sin llamadas a la base', async ({ page }) => {
    const reg = await abrirSistema(page);                    // sesión de caja
    await expect(page.locator('#tab-nav-datos')).toBeHidden();
    await expect(page.locator('#panel-restaurar')).toBeHidden();
    await expect(page.locator('#panel-cero')).toBeHidden();
    const ultimoAviso = () => page.locator('.toast.warning').last();
    await page.evaluate(() => abrirRestaurar());
    await expect(ultimoAviso()).toContainText('Restaurar es solo para administradores');
    await page.evaluate(() => abrirEmpezarDeCero());
    await expect(ultimoAviso()).toContainText('Empezar de cero es solo para administradores');
    await expect(page.locator('#modal-restauracion')).toBeHidden();
    // aunque alguien llene a mano los campos y llame a la función de confirmar, no hace nada
    await page.evaluate(() => { restModo = 'cero'; document.getElementById('rest-palabra').value = 'BORRAR TODO'; document.getElementById('rest-clave').value = 'x'; });
    await page.evaluate(() => confirmarRestauracion());
    await expect(ultimoAviso()).toContainText('Solo para administradores');
    // ni siquiera se acepta el archivo (el campo está escondido, pero se le puede forzar un archivo)
    await page.setInputFiles('#restaurar-archivo', archivo(respaldoViejo()));
    await expect(page.locator('#restaurar-resumen')).toContainText('Restaurar es solo para administradores');
    expect(await page.evaluate(() => restaurarArchivo)).toBeNull();
    expect(reg.rpc).toEqual([]);
    expect(reg.auth.filter(a => a.startsWith('password'))).toEqual([]);
    expect(reg.escrituras).toEqual([]);
  });

  test('un administrador autorizado en el sitio lo ve; al volver a caja desaparece y no queda el archivo en memoria', async ({ page }) => {
    await abrirSistema(page);
    await entrarComoAdmin(page);
    await irA(page, 'datos');
    await expect(page.locator('#panel-restaurar')).toBeVisible();
    await elegirValido(page);
    await salirDeAdmin(page);
    await expect(page.locator('#panel-restaurar')).toBeHidden();
    expect(await page.evaluate(() => restaurarArchivo)).toBeNull();
  });

  test('el administrador ve las dos tarjetas y la nota que dice que solo sirve el .json original y que no se edita', async ({ page }) => {
    await abrirAdmin(page);
    const nota = page.locator('#panel-restaurar .rest-aviso');
    await expect(nota).toContainText('usa solo el archivo original del respaldo');
    await expect(nota).toContainText('.json');
    await expect(nota).toContainText('No lo abras ni lo edites ni lo guardes con otro programa');
    await expect(nota).toContainText('no le cambies el formato');
    await expect(nota).toContainText('Excel');
    await expect(nota).toContainText('reemplaza todo');
    await expect(page.locator('#restaurar-archivo')).toHaveAttribute('accept', /\.json/);
    await expect(page.locator('#btn-restaurar')).toBeDisabled();
    await expect(page.locator('#panel-cero')).toContainText('irreversible');
  });
});

// ── Revisión del archivo ──────────────────────────────────────────────────
test.describe('archivo que NO se puede restaurar', () => {
  const casos = [
    ['un Excel', () => archivo('PK\u0003\u0004 lo-que-sea', 'ElLobo_datos.xlsx'), 'no es un archivo .json'],
    ['un .txt', () => archivo('hola', 'respaldo.txt'), 'no es un archivo .json'],
    ['un .json roto (cortado a la mitad)', () => archivo(JSON.stringify(respaldoViejo()).slice(0, 4000)), 'No se pudo leer el archivo'],
    ['un .json vacío', () => archivo(''), 'No se pudo leer el archivo'],
    ['un .json que es otra cosa', () => archivo({ hola: 'mundo' }), 'no se puede restaurar'],
    ['una lista en vez de un respaldo', () => archivo([1, 2, 3]), 'no tiene la forma de un respaldo'],
    ['un respaldo de otra versión', () => archivo({ ...respaldoViejo(), version: 2 }), 'versión 1'],
    ['un respaldo al que le cambiaron un conteo (modificado a mano)', () => archivo({ ...respaldoViejo(), conteos: { ...respaldoViejo().conteos, pedidos: 99 } }), 'Pedidos y fiados'],
    ['un respaldo sin la sección de conteos', () => { const r = respaldoViejo(); delete r.conteos; return archivo(r); }, 'No trae los conteos'],
    ['un respaldo al que le agregaron filas (el conteo dice menos)', () => { const r = respaldoViejo(); r.conteos.pedidos = 3; return archivo(r); }, 'se modificó o se cortó'],
    ['un respaldo al que le borraron filas', () => { const r = respaldoViejo(); r.tablas.pedidos = r.tablas.pedidos.slice(0, 2); return archivo(r); }, 'se modificó o se cortó'],
    ['un respaldo con una tabla ajena', () => archivo(respaldoDe({ ...copia(DATOS_BASE), usuarios: [] })), 'no es de El Lobo'],
    ['un respaldo al que le falta una tabla obligatoria', () => { const r = respaldoViejo(); delete r.tablas.egresos; return archivo(r); }, 'Le falta la tabla'],
    ['un respaldo con una tabla que no es lista', () => { const r = respaldoViejo(); r.tablas.egresos = { a: 1 }; return archivo(r); }, 'no es una lista de filas'],
    ['un respaldo con filas dañadas', () => { const r = respaldoViejo(); r.tablas.egresos = [1, 2]; r.conteos.egresos = 2; return archivo(r); }, 'filas dañadas'],
  ];
  for (const [nombre, hacer, mensaje] of casos) {
    test(`se rechaza ${nombre}, con mensaje claro, sin habilitar el botón ni llamar a la base`, async ({ page }) => {
      const { reg } = await abrirAdmin(page);
      await page.setInputFiles('#restaurar-archivo', hacer());
      await expect(page.locator('#restaurar-resumen .rest-error')).toContainText(mensaje);
      await expect(page.locator('#btn-restaurar')).toBeDisabled();
      expect(await page.evaluate(() => restaurarArchivo)).toBeNull();
      expect(reg.rpc).toEqual([]);
      expect(reg.escrituras).toEqual([]);
    });
  }

  test('un archivo de más de 100 MB se rechaza sin ni siquiera abrirlo', async ({ page }, testInfo) => {
    await abrirAdmin(page);
    const enorme = testInfo.outputPath('enorme.json');
    fs.writeFileSync(enorme, '');
    fs.truncateSync(enorme, 101 * 1024 * 1024);                      // archivo «hueco» de 101 MB: no ocupa espacio de verdad
    await page.setInputFiles('#restaurar-archivo', enorme);
    await expect(page.locator('#restaurar-resumen .rest-error')).toContainText('pesa más de 100 MB');
    await expect(page.locator('#btn-restaurar')).toBeDisabled();
  });

  test('si no se puede consultar lo que hay ahora, no se deja continuar (no se compara a ciegas)', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    reg.control.tablasFaltantes = ['egresos'];
    await elegir(page, respaldoViejo());
    await expect(page.locator('#restaurar-resumen .rest-error')).toContainText('No se pudo consultar lo que hay ahora en «Egresos»');
    await expect(page.locator('#btn-restaurar')).toBeDisabled();
  });

  test('la extensión en mayúsculas (RESPALDO.JSON, como la escriben algunos equipos) sí se acepta', async ({ page }) => {
    await abrirAdmin(page);
    await page.setInputFiles('#restaurar-archivo', archivo(respaldoViejo(), 'RESPALDO.JSON'));
    await expect(page.locator('#restaurar-resumen .rest-ok')).toBeVisible();
  });

  test('si ya había un archivo bueno y se elige uno malo, el bueno se descarta (no queda nada cargado)', async ({ page }) => {
    await abrirAdmin(page);
    await elegirValido(page);
    await page.setInputFiles('#restaurar-archivo', archivo('hola', 'otro.txt'));
    await expect(page.locator('#restaurar-resumen .rest-error')).toBeVisible();
    await expect(page.locator('#btn-restaurar')).toBeDisabled();
    expect(await page.evaluate(() => restaurarArchivo)).toBeNull();
    await page.evaluate(() => abrirRestaurar());
    await expect(page.locator('#modal-restauracion')).toBeHidden();
  });

  test('después de un archivo malo, uno bueno sí se acepta', async ({ page }) => {
    await abrirAdmin(page);
    await page.setInputFiles('#restaurar-archivo', archivo('hola', 'respaldo.txt'));
    await expect(page.locator('#restaurar-resumen .rest-error')).toBeVisible();
    await elegirValido(page);
    await expect(page.locator('#restaurar-resumen .rest-error')).toHaveCount(0);
  });

  test('un respaldo viejo sin config ni descuentos sí se acepta y avisa que esas tablas se dejan como están', async ({ page }) => {
    await abrirAdmin(page);
    const r = respaldoViejo();
    delete r.tablas.config; delete r.tablas.pedidos_descuentos;
    await elegirValido(page, r);
    await expect(page.locator('#restaurar-resumen')).toContainText('no viene: se deja igual');
  });
});

// ── Resumen antes de confirmar ────────────────────────────────────────────
test.describe('qué cambia, antes de pedir nada', () => {
  test('un archivo válido muestra la fecha, cuántos pedidos hay ahora y cuántos trae, y la tabla ahora/respaldo', async ({ page }) => {
    await abrirAdmin(page);
    await elegirValido(page);
    const resumen = page.locator('#restaurar-resumen');
    await expect(resumen).toContainText('Archivo válido');
    await expect(resumen).toContainText('2026-10-19');
    await expect(resumen).toContainText('de ayer');
    await expect(resumen).toContainText('Ahora el sistema tiene 11 pedidos');
    await expect(resumen).toContainText('El respaldo trae 6');
    await expect(resumen).toContainText('Todo lo que se haya registrado después de ese respaldo se perderá');
    const fila = resumen.locator('tr', { hasText: 'Pedidos y fiados' });
    await expect(fila).toContainText('11');
    await expect(fila).toContainText('6');
    await expect(fila.locator('.rest-menos')).toContainText('−5');
    await expect(resumen.locator('tbody tr')).toHaveCount(16);
  });

  test('la ventana de confirmación repite el aviso, tiene el botón apagado y no se cierra tocando afuera', async ({ page }) => {
    await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    const modal = page.locator('#modal-restauracion');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('REEMPLAZA todo lo que hay ahora');
    await expect(modal).toContainText('después');
    await expect(modal).toContainText('descarga automáticamente una copia de lo que hay ahora');
    await expect(modal).toContainText('sin servicio');
    await expect(modal).toContainText('Escribe RESTAURAR para confirmar');
    await expect(page.locator('#rest-confirmar')).toBeDisabled();
    await page.mouse.click(5, 5);                                   // afuera de la ventana
    await expect(modal).toBeVisible();
    await page.click('#rest-cancelar');
    await expect(modal).toBeHidden();
  });

  test('el botón solo se prende con la palabra exacta Y la contraseña (la palabra vale en minúscula y con espacios)', async ({ page }) => {
    await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    const boton = page.locator('#rest-confirmar');
    await page.fill('#rest-palabra', 'RESTAURAR');
    await expect(boton).toBeDisabled();                             // falta la contraseña
    await page.fill('#rest-clave', 'x');
    await expect(boton).toBeEnabled();
    for (const mala of ['', 'RESTAURA', 'restaurar ya', 'BORRAR TODO', 'si']) {
      await page.fill('#rest-palabra', mala);
      await expect(boton, `con «${mala}»`).toBeDisabled();
    }
    await page.fill('#rest-palabra', '  restaurar ');
    await expect(boton).toBeEnabled();
    await page.fill('#rest-clave', '');
    await expect(boton).toBeDisabled();
  });

  test('Cancelar cierra la ventana y borra la palabra y la contraseña escritas', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-cancelar');
    await expect(page.locator('#modal-restauracion')).toBeHidden();
    expect(await page.evaluate(() => [document.getElementById('rest-palabra').value, document.getElementById('rest-clave').value])).toEqual(['', '']);
    expect(reg.rpc).toEqual([]);
  });
});

// ── Restaurar de verdad ───────────────────────────────────────────────────
test.describe('restaurar', () => {
  test('flujo completo: contraseña → copia de lo actual descargada → la base → la pantalla muestra lo restaurado', async ({ page }) => {
    const { reg, descargas } = await abrirAdmin(page);
    const respaldo = respaldoViejo();
    expect(await pedidosEnPantalla(page)).toBe(11);
    await elegirValido(page, respaldo);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page, { palabra: 'restaurar' });
    reg.auth.length = 0;
    await page.click('#rest-confirmar');
    await esperarResultado(page);

    // 1. Se comprobó la contraseña con el servicio de acceso (sin tocar la sesión actual).
    expect(reg.auth.filter(a => a.startsWith('password:'))).toEqual(['password:dueno1@elobo.test']);
    expect(reg.auth).toContain('logout');            // y esa sesión de comprobación se cerró
    // 2. Se descargó UNA copia de lo que había antes, con el nombre claro y completa (11 pedidos).
    expect(descargas.length).toBe(1);
    expect(descargas[0].suggestedFilename()).toMatch(/^ElLobo_respaldo_ANTES_de_restaurar_2026-10-20_\d{4}\.json$/);
    const copiaPrevia = await contenido(descargas[0]);
    expect(copiaPrevia.version).toBe(1);
    expect(copiaPrevia.conteos.pedidos).toBe(11);
    expect(copiaPrevia.tablas.pedidos.length).toBe(11);
    // 3. La base se llamó UNA vez, con la palabra y el archivo, DESPUÉS de bajar todas las tablas.
    expect(reg.rpc.length).toBe(1);
    expect(reg.rpc[0].fn).toBe('lobo_restaurar_respaldo');
    expect(reg.rpc[0].rol).toBe('admin');
    expect(reg.rpc[0].cuerpo.p_confirmacion).toBe('RESTAURAR');
    expect(reg.rpc[0].cuerpo.p_respaldo).toEqual(respaldo);
    const orden = reg.rest.map(r => r.tabla);
    const indiceRpc = orden.indexOf('rpc/lobo_restaurar_respaldo');
    const tablasAntes = new Set(orden.slice(0, indiceRpc));
    for (const t of ['pedidos', 'egresos', 'inventario', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia', 'aperturas_turno', 'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'clientes_fiado', 'abonos_fiado', 'pedidos_descuentos', 'config']) {
      expect(tablasAntes.has(t), `la copia previa debía bajar «${t}» antes de restaurar`).toBe(true);
    }
    // 4. La pantalla muestra el resultado y los datos restaurados.
    await expect(page.locator('#rest-resultado')).toContainText('Restauración completada');
    await expect(page.locator('#rest-resultado')).toContainText('2026-10-19');
    await expect(page.locator('#rest-resultado')).toContainText(descargas[0].suggestedFilename());
    expect(await pedidosEnPantalla(page)).toBe(6);
    expect(reg.datos.pedidos.length).toBe(6);
    expect(reg.errores).toEqual([]);
    expect(reg.noManejadas).toEqual([]);
  });

  test('la contraseña no se guarda en ningún lado: no viaja a la función, el campo queda vacío y no hay rastro en el navegador', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    expect(JSON.stringify(reg.rpc)).not.toContain(CLAVE_ADMIN);
    expect(await page.evaluate(() => document.getElementById('rest-clave').value)).toBe('');
    expect(await page.evaluate(c => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.documentElement.innerHTML.includes(c), CLAVE_ADMIN)).not.toContain(CLAVE_ADMIN);
  });

  test('«Aceptar» cierra el resultado, limpia el archivo elegido y deja la pestaña lista para otra vez', async ({ page }) => {
    await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    await page.click('#rest-resultado button');
    await expect(page.locator('#modal-restauracion')).toBeHidden();
    await expect(page.locator('#btn-restaurar')).toBeDisabled();
    await expect(page.locator('#restaurar-resumen')).toBeEmpty();
    expect(await page.evaluate(() => [restaurarArchivo, document.getElementById('restaurar-archivo').value])).toEqual([null, '']);
  });

  test('el respaldo que hace el propio sistema se puede restaurar tal cual (mismo formato de ida y vuelta)', async ({ page }) => {
    const { descargas } = await abrirAdmin(page);
    const espera = page.waitForEvent('download');
    await page.click('#btn-respaldo-completo');
    const d = await espera;
    const bytes = fs.readFileSync(await d.path());
    await page.setInputFiles('#restaurar-archivo', { name: d.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
    await expect(page.locator('#restaurar-resumen .rest-ok')).toContainText('Archivo válido');
    await expect(page.locator('#restaurar-resumen')).toContainText('de hoy');
    await expect(page.locator('#btn-restaurar')).toBeEnabled();
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    expect(await pedidosEnPantalla(page)).toBe(11);
    expect(descargas.length).toBe(2);       // el respaldo normal + la copia previa
  });

  test('un doble clic (o llamarlo dos veces seguidas) hace UNA sola restauración', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.evaluate(() => { confirmarRestauracion(); confirmarRestauracion(); });
    await esperarResultado(page);
    expect(reg.rpc.length).toBe(1);
  });

  test('con la base lenta, en pleno proceso: no se puede cancelar ni cerrar ni repetir, y al terminar queda un solo resultado', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { rpcRetraso: 1500 });
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await expect(page.locator('#rest-progreso')).toContainText('3/3');
    await expect(page.locator('#rest-cancelar')).toBeDisabled();
    await expect(page.locator('#rest-confirmar')).toBeDisabled();
    await page.evaluate(() => { cerrarModalRestauracion(); confirmarRestauracion(); confirmarRestauracion(); });
    await expect(page.locator('#modal-restauracion')).toBeVisible();
    await esperarResultado(page);
    expect(reg.rpc.length).toBe(1);
  });

  test('confirmar a la fuerza (sin palabra, sin contraseña o sin archivo) no comprueba nada ni descarga ni llama a la base', async ({ page }) => {
    const { reg, descargas } = await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    reg.auth.length = 0;                                            // (la entrada del administrador al abrir el sistema ya quedó anotada)
    const intentar = async (palabra, clave) => {
      await page.evaluate(([a, b]) => { document.getElementById('rest-palabra').value = a; document.getElementById('rest-clave').value = b; return confirmarRestauracion(); }, [palabra, clave]);
    };
    await intentar('RESTAURA', CLAVE_ADMIN);                         // palabra incompleta
    await intentar('RESTAURAR', '');                                // sin contraseña
    await page.evaluate(() => { restaurarArchivo = null; });        // sin archivo cargado
    await intentar('RESTAURAR', CLAVE_ADMIN);
    expect(reg.auth.filter(a => a.startsWith('password'))).toEqual([]);
    expect(descargas.length).toBe(0);
    expect(reg.rpc).toEqual([]);
    expect(reg.datos.pedidos.length).toBe(11);
  });

  test('en pleno proceso, escribir en los campos no vuelve a prender el botón de confirmar', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { rpcRetraso: 1500 });
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await expect(page.locator('#rest-progreso')).toContainText('3/3');
    await page.fill('#rest-clave', 'otra-cosa');                    // dispara la revisión del botón
    await expect(page.locator('#rest-confirmar')).toBeDisabled();
    await esperarResultado(page);
    expect(reg.rpc.length).toBe(1);
  });

  test('si la base dice que quedó una cantidad distinta a la del archivo, la pantalla lo señala', async ({ page }) => {
    await abrirAdmin(page, { rpcDespuesFalso: { pedidos: 5 } });
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    await expect(page.locator('#rest-resultado .rest-error')).toContainText('Pedidos y fiados');
    await expect(page.locator('#rest-resultado .rest-error')).toContainText('no coincide con el archivo');
  });
});

// ── Cuando algo sale mal: no se cambia nada y el mensaje lo dice ─────────────────────────────────
test.describe('si algo falla', () => {
  async function intentar(page, opciones = {}, clave = CLAVE_ADMIN) {
    const ctx = await abrirAdmin(page, opciones);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page, { clave });
    await page.click('#rest-confirmar');
    return ctx;
  }
  const errorVisible = (page, texto) => expect(page.locator('#rest-error')).toContainText(texto, { timeout: 20000 });

  test('contraseña incorrecta: no descarga nada, no llama a la base y deja reintentar', async ({ page }) => {
    const { reg, descargas } = await intentar(page, {}, 'esta-no-es');
    await errorVisible(page, 'La contraseña no es correcta');
    expect(descargas.length).toBe(0);
    expect(reg.rpc).toEqual([]);
    expect(reg.auth).toContain('password-fallido:dueno1@elobo.test');
    await expect(page.locator('#modal-restauracion')).toBeVisible();
    await expect(page.locator('#rest-cancelar')).toBeEnabled();
    expect(await page.evaluate(() => document.getElementById('rest-clave').value)).toBe('');
    expect(await pedidosEnPantalla(page)).toBe(11);
  });

  test('la contraseña de OTRO usuario (caja) tampoco sirve', async ({ page }) => {
    const { reg } = await intentar(page, {}, USUARIOS['caja@elobo.test'].password);
    await errorVisible(page, 'La contraseña no es correcta');
    expect(reg.rpc).toEqual([]);
  });

  test('el servicio de acceso sin conexión: lo dice y no cambia nada', async ({ page }) => {
    const ctx = await abrirAdmin(page);
    await elegirValido(page);
    await page.click('#btn-restaurar');
    await abrirYConfirmar(page);
    ctx.reg.control.authFalla = 'red';
    await page.click('#rest-confirmar');
    await errorVisible(page, 'No hay conexión');
    expect(ctx.reg.rpc).toEqual([]);
  });

  test('si no se puede guardar la copia de lo actual (falta una fila al bajarla), NO se restaura', async ({ page }) => {
    const { reg, descargas } = await intentar(page, { totalesFalsos: { pedidos: 9999 } });
    await errorVisible(page, 'No se pudo guardar la copia de lo que hay ahora');
    await errorVisible(page, 'No se cambió nada');
    expect(descargas.length).toBe(0);
    expect(reg.rpc).toEqual([]);
    expect(reg.datos.pedidos.length).toBe(11);
  });

  test('la base rechaza el archivo: muestra su mensaje, no cambia nada y deja cerrar la ventana', async ({ page }) => {
    const { reg } = await intentar(page, { rpcFalla: { status: 400, cuerpo: { code: '22023', message: 'El respaldo está incompleto o dañado: "pedidos" declara 6 filas pero trae 5. No se cambió nada.', details: 'respaldo_conteo', hint: null } } });
    await errorVisible(page, 'El respaldo está incompleto o dañado');
    await errorVisible(page, 'No se cambió nada');
    expect(reg.datos.pedidos.length).toBe(11);
    expect(await pedidosEnPantalla(page)).toBe(11);
    await expect(page.locator('#rest-cancelar')).toBeEnabled();
    await page.click('#rest-cancelar');
    await expect(page.locator('#modal-restauracion')).toBeHidden();
  });

  test('el texto que devuelve la base se muestra como texto, nunca como HTML', async ({ page }) => {
    await intentar(page, { rpcFalla: { status: 400, cuerpo: { code: '22023', message: 'mala <img src=x onerror="window.__xss=1"> cosa', details: 'x', hint: null } } });
    await errorVisible(page, 'mala <img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#rest-error img')).toHaveCount(0);
  });

  test('la función no está instalada en Supabase: lo explica', async ({ page }) => {
    const { reg } = await intentar(page, { rpcFalla: 'no-instalada' });
    await errorVisible(page, 'Falta instalar la función de restauración');
    await errorVisible(page, 'restaurar_respaldo.sql');
    expect(reg.datos.pedidos.length).toBe(11);
  });

  test('la base tarda demasiado (timeout): lo dice y no cambia nada', async ({ page }) => {
    await intentar(page, { rpcFalla: { status: 500, cuerpo: { code: '57014', message: 'canceling statement due to statement timeout' } } });
    await errorVisible(page, 'tardó demasiado');
    await errorVisible(page, 'No se cambió nada');
  });

  test('se corta la conexión en pleno proceso: avisa que NO se sabe si terminó y que no lo repita', async ({ page }) => {
    await intentar(page, { rpcFalla: 'red' });
    await errorVisible(page, 'No se sabe si alcanzó a terminar');
    await errorVisible(page, 'No lo repitas todavía');
  });

  test('un error del servidor sin explicación (502): también avisa que no se sabe si terminó', async ({ page }) => {
    await intentar(page, { rpcFalla: 'servidor' });
    await errorVisible(page, 'No se sabe si alcanzó a terminar');
  });

  test('un error 500 sin código ni mensaje: lo mismo', async ({ page }) => {
    await intentar(page, { rpcFalla: { status: 500, cuerpo: {} } });
    await errorVisible(page, 'No se sabe si alcanzó a terminar');
  });

  test('un rechazo sin nada que explicar (400 sin cuerpo útil) se muestra con su número y no cambia nada', async ({ page }) => {
    const { reg } = await intentar(page, { rpcFalla: { status: 400, cuerpo: {} } });
    await errorVisible(page, 'Error 400');
    expect(reg.datos.pedidos.length).toBe(11);
  });

  test('un token de caja no puede llamar a la función (la base lo rechaza con 403) y la pantalla lo cuenta', async ({ page }) => {
    const { reg } = await intentar(page, { rpcFalla: { status: 403, cuerpo: { code: '42501', message: 'Solo el administrador puede restaurar un respaldo.', details: 'restaurar_solo_admin', hint: null } } });
    await errorVisible(page, 'no tiene permiso');
    expect(reg.datos.pedidos.length).toBe(11);
  });
});

// ── Empezar de cero ───────────────────────────────────────────────────────
test.describe('empezar de cero', () => {
  test('el aviso explica TODAS las consecuencias y recomienda hacer un respaldo antes', async ({ page }) => {
    await abrirAdmin(page);
    await page.click('#panel-cero button');
    const modal = page.locator('#modal-restauracion');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Se borran TODOS los datos de trabajo');
    await expect(modal).toContainText('No se puede deshacer');
    await expect(modal).toContainText('Se recomienda hacer un respaldo completo antes');
    await expect(modal).toContainText('descarga automáticamente una copia de todo lo que hay ahora');
    await expect(modal).toContainText('mesas');
    await expect(modal).toContainText('inventario');
    await expect(modal).toContainText('usuarios y contraseñas no cambian');
    await expect(modal).toContainText('sin servicio');
    await expect(modal).toContainText('Escribe BORRAR TODO para confirmar');
    await expect(page.locator('#rest-confirmar')).toBeDisabled();
    await expect(page.locator('#rest-inv')).not.toBeChecked();
  });

  test('exige BORRAR TODO (RESTAURAR no vale) y la contraseña', async ({ page }) => {
    await abrirAdmin(page);
    await page.click('#panel-cero button');
    const boton = page.locator('#rest-confirmar');
    await page.fill('#rest-clave', 'x');
    for (const mala of ['', 'RESTAURAR', 'BORRAR', 'borrar']) {
      await page.fill('#rest-palabra', mala);
      await expect(boton, `con «${mala}»`).toBeDisabled();
    }
    await page.fill('#rest-palabra', 'borrar   todo');
    await expect(boton).toBeEnabled();
  });

  test('flujo completo: copia previa, la base, y la pantalla queda vacía con las mesas libres y el inventario conservado', async ({ page }) => {
    const { reg, descargas } = await abrirAdmin(page);
    expect((reg.datos.mesas.filter(m => m.estado !== 'libre')).length).toBeGreaterThan(0);
    await page.click('#panel-cero button');
    await abrirYConfirmar(page, { palabra: 'BORRAR TODO' });
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    expect(descargas.length).toBe(1);
    expect(descargas[0].suggestedFilename()).toMatch(/^ElLobo_respaldo_ANTES_de_empezar_de_cero_2026-10-20_\d{4}\.json$/);
    expect((await contenido(descargas[0])).conteos.pedidos).toBe(11);
    expect(reg.rpc.length).toBe(1);
    expect(reg.rpc[0].fn).toBe('lobo_empezar_de_cero');
    expect(reg.rpc[0].cuerpo).toEqual({ p_confirmacion: 'BORRAR TODO', p_borrar_inventario: false });
    expect(await pedidosEnPantalla(page)).toBe(0);
    expect(reg.datos.mesas.length).toBe(15);
    expect(reg.datos.mesas.every(m => m.estado === 'libre')).toBe(true);
    expect(reg.datos.inventario.length).toBe(2);
    expect(await page.evaluate(() => [ST.clientesFiado.length, ST.cierresDia.length, ST.mesas.length, ST.inventario.length])).toEqual([0, 0, 15, 2]);
    await expect(page.locator('#rest-resultado')).toContainText('El sistema quedó vacío');
    expect(reg.errores).toEqual([]);
  });

  test('con la casilla marcada también borra el inventario', async ({ page }) => {
    const { reg } = await abrirAdmin(page);
    await page.click('#panel-cero button');
    await page.check('#rest-inv');
    await abrirYConfirmar(page, { palabra: 'BORRAR TODO' });
    await page.click('#rest-confirmar');
    await esperarResultado(page);
    expect(reg.rpc[0].cuerpo.p_borrar_inventario).toBe(true);
    expect(reg.datos.inventario.length).toBe(0);
    expect(reg.datos.mesas.length).toBe(15);
  });

  test('con contraseña incorrecta no se borra nada', async ({ page }) => {
    const { reg, descargas } = await abrirAdmin(page);
    await page.click('#panel-cero button');
    await abrirYConfirmar(page, { palabra: 'BORRAR TODO', clave: 'mal' });
    await page.click('#rest-confirmar');
    await expect(page.locator('#rest-error')).toContainText('La contraseña no es correcta');
    expect(descargas.length).toBe(0);
    expect(reg.rpc).toEqual([]);
    expect(reg.datos.pedidos.length).toBe(11);
  });

  test('si la base rechaza el borrado, no cambia nada', async ({ page }) => {
    const { reg } = await abrirAdmin(page, { rpcFalla: { status: 403, cuerpo: { code: '42501', message: 'Solo el administrador puede empezar de cero.', details: 'cero_solo_admin', hint: null } } });
    await page.click('#panel-cero button');
    await abrirYConfirmar(page, { palabra: 'BORRAR TODO' });
    await page.click('#rest-confirmar');
    await expect(page.locator('#rest-error')).toContainText('no tiene permiso');
    expect(reg.datos.pedidos.length).toBe(11);
  });
});

// ── Que las listas no se desincronicen ────────────────────────────────────
test('la lista de tablas opcionales y los nombres de la pantalla cubren exactamente las tablas del respaldo', async ({ page }) => {
  await abrirAdmin(page);
  const { tablas, nombres, opcionales } = await page.evaluate(() => ({ tablas: TABLAS_RESPALDO, nombres: Object.keys(NOMBRES_TABLAS), opcionales: TABLAS_OPCIONALES_EN_ARCHIVO }));
  expect([...nombres].sort()).toEqual([...tablas].sort());
  expect([...opcionales].sort()).toEqual(['config', 'pedidos_descuentos']);
  const sql = fs.readFileSync(require('path').resolve(__dirname, '../sql/restaurar_respaldo.sql'), 'utf-8');
  const deSql = /c_opcionales constant text\[\] := array\[(.*?)\];/s.exec(sql)[1].match(/'([a-z_]+)'/g).map(s => s.replace(/'/g, ''));
  expect([...deSql].sort()).toEqual([...opcionales].sort());
  expect(HTML_TEXTO).toContain('lobo_restaurar_respaldo');
});
