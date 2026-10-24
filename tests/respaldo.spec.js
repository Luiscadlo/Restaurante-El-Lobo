// Respaldo completo y aviso de respaldo (Prompt A).
// Todo contra el backend falso: nada toca tu Supabase real.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { abrirSistema, URL_HTML, TABLAS_LOADSTATE } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { entrarComoAdmin } = require('./helpers/sesion');

const copia = x => JSON.parse(JSON.stringify(x));
const HTML_TEXTO = fs.readFileSync(decodeURIComponent(new URL(URL_HTML).pathname), 'utf-8');

// ── Que el respaldo no se olvide de ninguna tabla ──────────────────────────────
test('TABLAS_RESPALDO cubre TODAS las tablas que usa el código (y nada más)', async ({ page }) => {
  await abrirSistema(page);
  const usadas = new Set([...HTML_TEXTO.matchAll(/sb(?:Get|GetAll|Insert|InsertConCuenta|Patch|Delete)\('([a-z_]+)'/g)].map(m => m[1]));
  const enRespaldo = await page.evaluate(() => TABLAS_RESPALDO);
  // Todas las del código están en la lista…
  for (const t of usadas) expect(enRespaldo, `falta "${t}" en TABLAS_RESPALDO`).toContain(t);
  // …y la lista no trae tablas que el código no use.
  expect([...enRespaldo].sort()).toEqual([...usadas].sort());
  expect([...enRespaldo].sort()).toEqual([...TABLAS_LOADSTATE].sort());
});

// ── Aviso en pantalla ──────────────────────────────────────────────────────────
test.describe('aviso de respaldo', () => {
  // `hoy`: fecha "de hoy" simulada (por defecto martes 20-oct). Domingos de la semana: 18 y 25 de octubre.
  const abrirConRespaldo = async (page, valor, hoy) => {
    const datos = copia(DATOS_BASE);
    datos.config = valor === undefined ? [] : [{ clave: 'ultimo_respaldo', valor }];
    const opciones = { datos, usuario: 'admin' };   // el aviso es del administrador
    if (hoy) opciones.fecha = new Date(`${hoy}T14:00:00-05:00`);
    return abrirSistema(page, opciones);
  };
  const aviso = page => page.locator('#aviso-respaldo');

  // ── El respaldo es semanal: el aviso sale desde cada DOMINGO y dura hasta que se exporte ──
  test('martes con el respaldo hecho el domingo (hace 2 días) → sin aviso', async ({ page }) => {
    const reg = await abrirConRespaldo(page, { fecha: '2026-10-18' });
    await expect(aviso(page)).toBeHidden();
    expect(reg.errores).toEqual([]);
  });

  test('martes con el respaldo del sábado anterior (hace 3 días, ANTES del domingo) → aviso ámbar "toca el respaldo semanal"', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-17' });
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('Toca el respaldo semanal');
    await expect(aviso(page)).toContainText('hace 3 días');
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);
    await expect(aviso(page).locator('.alert.warning')).toHaveCount(0);
    await expect(aviso(page).getByRole('button', { name: /Hacer respaldo ahora/ })).toBeVisible();
  });

  test('el DOMINGO el aviso sale aunque el respaldo sea de ayer; si el respaldo es de ese mismo domingo, no', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-24' }, '2026-10-25');       // sábado → domingo
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('hace 1 día.');                       // singular
    const pagina2 = await page.context().newPage();
    await abrirConRespaldo(pagina2, { fecha: '2026-10-25' }, '2026-10-25');       // ya lo hizo hoy domingo
    await expect(pagina2.locator('#aviso-respaldo')).toBeHidden();
  });

  test('el sábado con el respaldo del domingo (hace 6) → sin aviso; con el del sábado anterior (hace 7) → ámbar', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-18' }, '2026-10-24');
    await expect(aviso(page)).toBeHidden();
    const pagina2 = await page.context().newPage();
    await abrirConRespaldo(pagina2, { fecha: '2026-10-17' }, '2026-10-24');
    await expect(pagina2.locator('#aviso-respaldo .alert.info')).toHaveCount(1);
    await expect(pagina2.locator('#aviso-respaldo')).toContainText('hace 7 días');
  });

  test('el aviso se queda cada día hasta que el respaldo se haga bien, y entonces se apaga hasta el próximo domingo', async ({ page }) => {
    // respaldo de la semana pasada; hoy es miércoles 21-oct y no se ha exportado desde el domingo
    await abrirConRespaldo(page, { fecha: '2026-10-17' }, '2026-10-21');
    await expect(aviso(page)).toBeVisible();
    // se exporta (completo y verificado) → queda registrado → desaparece
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar/ }).click();
    await descarga;
    await expect.poll(() => page.evaluate(() => ST.config.find(c => c.clave === 'ultimo_respaldo').valor.fecha)).toBe('2026-10-21');
    await expect(aviso(page)).toBeHidden();
    // y sigue apagado el resto de la semana; el siguiente domingo (25-oct) vuelve a salir
    const n = await page.evaluate(() => ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map(h => nivelAvisoRespaldo(diasDesdeFecha('2026-10-21', h), diaDeLaSemana(h))));
    expect(n).toEqual([null, null, null, 'ambar']);
  });

  test('si el respaldo FALLA (faltan filas) no se registra y el aviso sigue', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [{ clave: 'ultimo_respaldo', valor: { fecha: '2026-10-17' } }];
    await abrirSistema(page, { datos, usuario: 'admin', totalesFalsos: { pedidos: 999 } });
    await expect(aviso(page)).toBeVisible();
    await page.getByRole('button', { name: /Exportar/ }).click();
    await expect(page.locator('.toast.warning', { hasText: 'El respaldo NO se completó' })).toBeVisible();
    await expect(aviso(page)).toBeVisible();
  });

  test('hace 9 días → ámbar; hace 10 días → rojo', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-11' });
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);
    await expect(aviso(page)).toContainText('hace 9 días');
    const pagina2 = await page.context().newPage();
    await abrirConRespaldo(pagina2, { fecha: '2026-10-10' });
    await expect(pagina2.locator('#aviso-respaldo .alert.warning')).toHaveCount(1);
    await expect(pagina2.locator('#aviso-respaldo')).toContainText('Hace 10 días');
  });

  test('nunca se ha hecho respaldo → aviso ámbar', async ({ page }) => {
    await abrirConRespaldo(page, undefined);
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('Todavía no se ha hecho ningún respaldo');
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);
  });

  test('la tabla config no existe → el sistema NO falla; solo muestra un mensaje claro', async ({ page }) => {
    const reg = await abrirSistema(page, { tablasFaltantes: ['config'], usuario: 'admin' });
    expect(reg.errores.filter(e => !/404/.test(e))).toEqual([]);   // el 404 de la tabla falsa es esperado
    await expect(aviso(page)).toContainText('falta crear la tabla');
    await expect(aviso(page)).toContainText('sql/migracion_supabase_config.sql');
    // el resto del sistema sigue andando
    const nPedidos = await page.evaluate(() => ST.ingresos.length + ST.pendientes.length);
    expect(nPedidos).toBeGreaterThan(0);
  });

  test('el administrador ve el aviso desde cualquier pestaña', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-01' });
    for (const id of ['ingresos', 'fiados', 'diaadia']) {
      await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
      await expect(aviso(page)).toBeVisible();
    }
  });

  test('con caja el aviso NO aparece (hacer el respaldo es del administrador), ni el de "falta la tabla config"', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [{ clave: 'ultimo_respaldo', valor: { fecha: '2026-10-01' } }];   // 19 días: con admin sería rojo
    await abrirSistema(page, { datos });                                              // sesión de caja
    await expect(aviso(page)).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('aviso-respaldo').innerHTML)).toBe('');
    const pagina2 = await page.context().newPage();
    await abrirSistema(pagina2, { tablasFaltantes: ['config'] });
    await expect(pagina2.locator('#aviso-respaldo')).toBeHidden();
  });

  test('al entrar un administrador (autorizado en el sitio) el aviso aparece, y al salir desaparece', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [{ clave: 'ultimo_respaldo', valor: { fecha: '2026-10-01' } }];
    await abrirSistema(page, { datos });
    await expect(aviso(page)).toBeHidden();
    await entrarComoAdmin(page);
    await expect(aviso(page)).toBeVisible();
    await page.evaluate(() => cerrarSesionAdmin());
    await expect(aviso(page)).toBeHidden();
  });
});

test.describe('funciones del aviso', () => {
  test('diasDesdeFecha, diaDeLaSemana y nivelAvisoRespaldo', async ({ page }) => {
    await abrirSistema(page);
    const r = await page.evaluate(() => ({
      mismoDia: diasDesdeFecha('2026-10-20', '2026-10-20'),
      siete: diasDesdeFecha('2026-10-13', '2026-10-20'),
      cruceMes: diasDesdeFecha('2026-09-28', '2026-10-02'),
      cruceAnio: diasDesdeFecha('2025-12-30', '2026-01-02'),
      semana: ['2026-10-25', '2026-10-26', '2026-10-20', '2026-10-24', '2026-01-01'].map(f => diaDeLaSemana(f)),
      // martes (2): un respaldo de hace ≤2 días es de este domingo o posterior; de 3 en adelante es anterior
      martes: [0, 1, 2, 3, 7, 9, 10, 25, null, NaN].map(d => nivelAvisoRespaldo(d, 2)),
      domingo: [0, 1, 7].map(d => nivelAvisoRespaldo(d, 0)),
      sabado: [0, 6, 7].map(d => nivelAvisoRespaldo(d, 6)),
    }));
    expect(r.mismoDia).toBe(0);
    expect(r.siete).toBe(7);
    expect(r.cruceMes).toBe(4);     // 28→30 sep = 2, +1 (1-oct) +1 (2-oct) = 4
    expect(r.cruceAnio).toBe(3);    // 30, 31 dic, 1, 2 ene → 3 días
    expect(r.semana).toEqual([0, 1, 2, 6, 4]);   // dom 25-oct, lun, mar 20-oct, sáb 24-oct, jue 1-ene
    expect(r.martes).toEqual([null, null, null, 'ambar', 'ambar', 'ambar', 'rojo', 'rojo', 'ambar', 'ambar']);
    expect(r.domingo).toEqual([null, 'ambar', 'ambar']);
    expect(r.sabado).toEqual([null, null, 'ambar']);
  });
});

// ── Botón Exportar: solo administrador ────────────────────────────────────────
test.describe('botón Exportar', () => {
  test('con caja ni se ve; si alguien llama la función a mano, se niega: no descarga ni pide tablas', async ({ page }) => {
    const reg = await abrirSistema(page);
    await expect(page.getByRole('button', { name: /Exportar/ })).toBeHidden();
    await expect(page.locator('#btn-importar')).toBeHidden();
    const peticionesAntes = reg.peticiones.length;
    let descargo = false;
    page.on('download', () => { descargo = true; });
    await page.evaluate(() => pedirRespaldoCompleto());
    await expect(page.locator('.toast.warning').last()).toContainText('solo para administradores');
    expect(await page.evaluate(() => document.getElementById('modal-respaldo'))).toBeNull();   // ya no hay ventana de contraseña
    expect(descargo).toBe(false);
    expect(reg.peticiones.length).toBe(peticionesAntes);   // no bajó ninguna tabla
    expect(reg.escrituras).toEqual([]);
  });

  test('con administrador se ve y descarga directo, sin pedir contraseña', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    const boton = page.getByRole('button', { name: /Exportar/ });
    await expect(boton).toBeVisible();
    const descarga = page.waitForEvent('download');
    await boton.click();
    const d = await descarga;
    expect(d.suggestedFilename()).toBe('ElLobo_respaldo_completo_2026-10-20.json');
    expect(reg.errores).toEqual([]);
  });

  test('un administrador autorizado en el sitio lo ve; al volver a caja se oculta de nuevo', async ({ page }) => {
    await abrirSistema(page);
    await entrarComoAdmin(page);
    await expect(page.getByRole('button', { name: /Exportar/ })).toBeVisible();
    await page.evaluate(() => cerrarSesionAdmin());
    await expect(page.getByRole('button', { name: /Exportar/ })).toBeHidden();
  });
});

// ── El respaldo en sí ──────────────────────────────────────────────────────────
test.describe('respaldoCompleto', () => {
  // (la página se abre con { usuario: 'admin' }: el botón Exportar es solo del administrador)
  async function respaldar(page) {
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar/ }).click();
    const d = await descarga;
    return JSON.parse(fs.readFileSync(await d.path(), 'utf-8'));
  }

  test('baja las 16 tablas completas, con conteos que coinciden, y registra config.ultimo_respaldo', async ({ page }) => {
    const reg = await abrirSistema(page, { usuario: 'admin' });
    const archivo = await respaldar(page);

    expect(archivo.version).toBe(1);
    expect(archivo.fecha).toBe('2026-10-20');
    expect(Object.keys(archivo.tablas).sort()).toEqual([...TABLAS_LOADSTATE].sort());
    for (const t of TABLAS_LOADSTATE) {
      expect(archivo.tablas[t].length, `filas de ${t}`).toBe(DATOS_BASE[t].length);
      expect(archivo.conteos[t], `conteo de ${t}`).toBe(DATOS_BASE[t].length);
    }
    expect(archivo.conteos.pedidos).toBe(11);     // 7 pagados + 4 pendientes de los datos de ejemplo
    expect(archivo.tablas.pedidos[0]).toHaveProperty('monto_total');

    // Quedó registrado el último respaldo (la fila ya existía → PATCH sobre config).
    // (la descarga ocurre un instante ANTES de que se guarde el registro: se espera a que aparezca)
    await expect.poll(() => reg.escrituras.filter(e => e.tabla === 'config').length).toBe(1);
    const w = reg.escrituras.filter(e => e.tabla === 'config');
    expect(w[0].metodo).toBe('PATCH');
    expect(w[0].consulta).toContain('clave=eq.ultimo_respaldo');
    expect(w[0].cuerpo.valor.fecha).toBe('2026-10-20');
    expect(w[0].cuerpo.valor.conteos.pedidos).toBe(11);
    // …y el respaldo no escribió en ninguna otra tabla.
    expect(reg.escrituras.filter(e => e.tabla !== 'config')).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  test('después del respaldo el aviso desaparece', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [{ clave: 'ultimo_respaldo', valor: { fecha: '2026-10-01' } }];
    await abrirSistema(page, { datos, usuario: 'admin' });
    await expect(page.locator('#aviso-respaldo')).toBeVisible();
    await respaldar(page);
    await expect(page.locator('#aviso-respaldo')).toBeHidden();
  });

  test('primer respaldo (config sin fila) → INSERT de ultimo_respaldo', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [];
    const reg = await abrirSistema(page, { datos, usuario: 'admin' });
    const archivo = await respaldar(page);
    expect(archivo.tablas.config).toEqual([]);
    await expect.poll(() => reg.escrituras.filter(e => e.tabla === 'config').length).toBe(1);
    const w = reg.escrituras.filter(e => e.tabla === 'config');
    expect(w.map(e => e.metodo)).toEqual(['POST']);
    expect(w[0].cuerpo.clave).toBe('ultimo_respaldo');
  });

  test('si falta una fila (el total no coincide) el respaldo ABORTA: no descarga ni marca el respaldo', async ({ page }) => {
    const reg = await abrirSistema(page, { totalesFalsos: { pedidos: 999 }, usuario: 'admin' });
    let descargo = false;
    page.on('download', () => { descargo = true; });
    await page.getByRole('button', { name: /Exportar/ }).click();
    await expect(page.locator('.toast.warning', { hasText: 'El respaldo NO se completó' })).toBeVisible();
    // el motivo correcto: se bajaron 11 filas pero "Supabase" dijo 999 (no un error de otro tipo)
    await expect(page.locator('.toast.warning')).toContainText('"pedidos": se bajaron 11 filas pero Supabase reporta 999');
    expect(descargo).toBe(false);
    expect(reg.escrituras.filter(e => e.tabla === 'config')).toEqual([]);   // no marcó el respaldo como hecho
    expect(await page.evaluate(() => respaldoEnCurso)).toBe(false);          // y se puede volver a intentar
  });

  test('si la tabla config no existe: omite config, descarga igual y avisa que no quedó registrado', async ({ page }) => {
    const reg = await abrirSistema(page, { tablasFaltantes: ['config'], usuario: 'admin' });
    const archivo = await respaldar(page);
    expect(Object.keys(archivo.tablas)).not.toContain('config');
    expect(Object.keys(archivo.tablas).length).toBe(15);
    await expect(page.locator('.toast.warning', { hasText: 'no quedó registrado' })).toBeVisible();
    expect(reg.escrituras).toEqual([]);
  });
});
