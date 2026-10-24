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
  const abrirConRespaldo = async (page, valor) => {
    const datos = copia(DATOS_BASE);
    datos.config = valor === undefined ? [] : [{ clave: 'ultimo_respaldo', valor }];
    const reg = await abrirSistema(page, { datos });
    return reg;
  };
  const aviso = page => page.locator('#aviso-respaldo');

  test('respaldo de hace 2 días → sin aviso', async ({ page }) => {
    const reg = await abrirSistema(page);
    await expect(aviso(page)).toBeHidden();
    expect(reg.errores).toEqual([]);
  });

  test('respaldo de hace exactamente 7 días → sin aviso (el aviso es con MÁS de 7)', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-13' });
    await expect(aviso(page)).toBeHidden();
  });

  test('hace 8 días → aviso ámbar con el botón', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-12' });
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('Hace 8 días');
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);
    await expect(aviso(page).locator('.alert.warning')).toHaveCount(0);
    await expect(aviso(page).getByRole('button', { name: /Hacer respaldo ahora/ })).toBeVisible();
  });

  test('hace 9 días → todavía ámbar; hace 10 días → rojo', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-11' });
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);
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
    const reg = await abrirSistema(page, { tablasFaltantes: ['config'] });
    expect(reg.errores.filter(e => !/404/.test(e))).toEqual([]);   // el 404 de la tabla falsa es esperado
    await expect(aviso(page)).toContainText('falta crear la tabla');
    await expect(aviso(page)).toContainText('sql/migracion_supabase_config.sql');
    // el resto del sistema sigue andando
    const nPedidos = await page.evaluate(() => ST.ingresos.length + ST.pendientes.length);
    expect(nPedidos).toBeGreaterThan(0);
  });

  test('el aviso se ve desde cualquier pestaña y también sin sesión de admin', async ({ page }) => {
    await abrirConRespaldo(page, { fecha: '2026-10-01' });
    for (const id of ['ingresos', 'fiados', 'diaadia']) {
      await page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
      await expect(aviso(page)).toBeVisible();
    }
  });
});

test.describe('funciones del aviso', () => {
  test('diasDesdeFecha y nivelAvisoRespaldo', async ({ page }) => {
    await abrirSistema(page);
    const r = await page.evaluate(() => ({
      mismoDia: diasDesdeFecha('2026-10-20', '2026-10-20'),
      siete: diasDesdeFecha('2026-10-13', '2026-10-20'),
      cruceMes: diasDesdeFecha('2026-09-28', '2026-10-02'),
      cruceAnio: diasDesdeFecha('2025-12-30', '2026-01-02'),
      niveles: [0, 7, 8, 9, 10, 25, null, NaN].map(nivelAvisoRespaldo),
    }));
    expect(r.mismoDia).toBe(0);
    expect(r.siete).toBe(7);
    expect(r.cruceMes).toBe(4);     // 28→30 sep = 2, +1 (1-oct) +1 (2-oct) = 4
    expect(r.cruceAnio).toBe(3);    // 30, 31 dic, 1, 2 ene → 3 días
    expect(r.niveles).toEqual([null, null, 'ambar', 'ambar', 'rojo', 'rojo', 'ambar', 'ambar']);
  });
});

// ── Botón Exportar: acceso de administrador ────────────────────────────────────
test.describe('botón Exportar', () => {
  test('sin acceso de admin abre el modal con la contraseña y NO descarga ni pide tablas de más', async ({ page }) => {
    const reg = await abrirSistema(page);
    const peticionesAntes = reg.peticiones.length;
    let descargo = false;
    page.on('download', () => { descargo = true; });
    await page.getByRole('button', { name: /Exportar/ }).click();
    await expect(page.locator('#modal-respaldo')).toBeVisible();
    await expect(page.locator('#respaldo-login')).toBeVisible();
    await expect(page.locator('#respaldo-contenido')).toBeHidden();
    // una contraseña incorrecta no abre nada
    await page.fill('#respaldo-password', 'contraseña-incorrecta-de-prueba');
    await page.evaluate(() => intentarAccesoRespaldo());
    await expect(page.locator('#modal-respaldo')).toBeVisible();
    expect(descargo).toBe(false);
    expect(reg.peticiones.length).toBe(peticionesAntes);   // no bajó ninguna tabla
    expect(reg.escrituras).toEqual([]);
  });

  test('al cerrar el modal se cancela el respaldo pendiente', async ({ page }) => {
    await abrirSistema(page);
    await page.getByRole('button', { name: /Exportar/ }).click();
    await page.evaluate(() => cerrarModalRespaldo());
    await expect(page.locator('#modal-respaldo')).toBeHidden();
    expect(await page.evaluate(() => respaldoPendiente)).toBe(false);
  });

  test('con acceso de admin descarga el respaldo; tras pasar el modal también', async ({ page }) => {
    const reg = await abrirSistema(page);
    // Abre el modal sin sesión…
    await page.getByRole('button', { name: /Exportar/ }).click();
    await expect(page.locator('#modal-respaldo')).toBeVisible();
    // …y simula que el acceso de admin se concedió (la contraseña real nunca va en las pruebas).
    const descarga = page.waitForEvent('download');
    await page.evaluate(() => { adminAutenticado = true; aplicarGateAdmin('respaldo', iniciarRespaldoDesdeModal); });
    const d = await descarga;
    expect(d.suggestedFilename()).toBe('ElLobo_respaldo_completo_2026-10-20.json');
    await expect(page.locator('#modal-respaldo')).toBeHidden();
    expect(reg.errores).toEqual([]);
  });
});

// ── El respaldo en sí ──────────────────────────────────────────────────────────
test.describe('respaldoCompleto', () => {
  async function respaldar(page) {
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar/ }).click();   // abre el modal (sin sesión)
    await page.evaluate(() => { adminAutenticado = true; aplicarGateAdmin('respaldo', iniciarRespaldoDesdeModal); });
    const d = await descarga;
    return JSON.parse(fs.readFileSync(await d.path(), 'utf-8'));
  }

  test('baja las 16 tablas completas, con conteos que coinciden, y registra config.ultimo_respaldo', async ({ page }) => {
    const reg = await abrirSistema(page);
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
    await abrirSistema(page, { datos });
    await expect(page.locator('#aviso-respaldo')).toBeVisible();
    await respaldar(page);
    await expect(page.locator('#aviso-respaldo')).toBeHidden();
  });

  test('primer respaldo (config sin fila) → INSERT de ultimo_respaldo', async ({ page }) => {
    const datos = copia(DATOS_BASE);
    datos.config = [];
    const reg = await abrirSistema(page, { datos });
    const archivo = await respaldar(page);
    expect(archivo.tablas.config).toEqual([]);
    await expect.poll(() => reg.escrituras.filter(e => e.tabla === 'config').length).toBe(1);
    const w = reg.escrituras.filter(e => e.tabla === 'config');
    expect(w.map(e => e.metodo)).toEqual(['POST']);
    expect(w[0].cuerpo.clave).toBe('ultimo_respaldo');
  });

  test('si falta una fila (el total no coincide) el respaldo ABORTA: no descarga ni marca el respaldo', async ({ page }) => {
    const reg = await abrirSistema(page, { totalesFalsos: { pedidos: 999 } });
    let descargo = false;
    page.on('download', () => { descargo = true; });
    await page.getByRole('button', { name: /Exportar/ }).click();
    await page.evaluate(() => { adminAutenticado = true; aplicarGateAdmin('respaldo', iniciarRespaldoDesdeModal); });
    await expect(page.locator('.toast.warning', { hasText: 'El respaldo NO se completó' })).toBeVisible();
    // el motivo correcto: se bajaron 11 filas pero "Supabase" dijo 999 (no un error de otro tipo)
    await expect(page.locator('.toast.warning')).toContainText('"pedidos": se bajaron 11 filas pero Supabase reporta 999');
    expect(descargo).toBe(false);
    expect(reg.escrituras.filter(e => e.tabla === 'config')).toEqual([]);   // no marcó el respaldo como hecho
    expect(await page.evaluate(() => respaldoEnCurso)).toBe(false);          // y se puede volver a intentar
  });

  test('si la tabla config no existe: omite config, descarga igual y avisa que no quedó registrado', async ({ page }) => {
    const reg = await abrirSistema(page, { tablasFaltantes: ['config'] });
    const archivo = await respaldar(page);
    expect(Object.keys(archivo.tablas)).not.toContain('config');
    expect(Object.keys(archivo.tablas).length).toBe(15);
    await expect(page.locator('.toast.warning', { hasText: 'no quedó registrado' })).toBeVisible();
    expect(reg.escrituras).toEqual([]);
  });
});
