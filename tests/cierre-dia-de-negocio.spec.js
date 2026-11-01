// CIERRE y «día de negocio»: caja solo trabaja el día en curso, y el día en curso cambia a las 9:00 a. m. (igual que el
// candado de la base, sql/candado_dias.sql), NO a medianoche. Así la cena (5 pm–2 am) se sigue cerrando con la fecha en
// que empezó aunque ya pasara la medianoche. Un día anterior se ve bloqueado para caja (haya cierre o no) y el
// calendario del selector de fecha no deja escogerlo; el administrador no tiene ningún límite.
//
// Relojes de las pruebas (hora de Bogotá):
//   - 14:00 del 20-oct (por defecto)         → día de negocio 20-oct, hoy (calendario) 20-oct
//   - 00:30 del 21-oct (cena sin cerrar)     → día de negocio 20-oct, hoy (calendario) 21-oct
//   - 08:59 / 09:00 / 09:30 del 21-oct       → día de negocio 20-oct / 21-oct / 21-oct
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { diaNegocio: diaNegocioDelCandado } = require('./helpers/candado');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { entrarComoAdmin, salirDeAdmin } = require('./helpers/sesion');

const A_LAS_00_30 = new Date('2026-10-21T00:30:00-05:00');
const A_LAS_08_59 = new Date('2026-10-21T08:59:59-05:00');
const A_LAS_09_00 = new Date('2026-10-21T09:00:00-05:00');
const A_LAS_09_30 = new Date('2026-10-21T09:30:00-05:00');

const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const verCierre = (page, fecha, turno = 'almuerzo') => page.evaluate(([f, t]) => { document.getElementById('dd-fecha').value = f; ddTurno = t; onFechaCierreChange(); }, [fecha, turno]);
const corregir = page => page.locator('#btn-corregir-cierre');
const abrir = page => page.locator('#btn-abrir-turno-cierre');
const banner = page => page.locator('#dd-cerrado-banner');
const mensaje = page => page.locator('#dd-cerrado-mensaje');
const formulario = page => page.locator('#dd-form-activo');

// Datos de ejemplo + la cena del 20-oct YA cerrada y un pedido pagado en esa cena (para el descuento).
function datosConCenaDel20() {
  const datos = JSON.parse(JSON.stringify(DATOS_BASE));
  datos.cierres_dia = [...datos.cierres_dia, { id: 78, fecha: FECHA_HOY, turno: 'cena', efectivo: 18000, transferencia: 0, gastos: 0, resultado: 18000, manual: false, platos_familia: null }];
  return datos;
}

// Pedidos pagados con fecha de cobro distinta a la del pedido (la base manda la fecha de cobro cuando existe).
function datosConPagadosDeFechaMixta() {
  const datos = JSON.parse(JSON.stringify(DATOS_BASE));
  const base = datos.pedidos.find(p => p.id === 101);
  datos.pedidos.push(
    // consumido hace días, cobrado HOY (20-oct): caja puede tocarlo
    { ...base, id: 301, fecha: '2026-10-12', fecha_pago: FECHA_HOY, grupo_pedido: 'g-301' },
    // del día de hoy pero cobrado en un día ya cerrado (19-oct): sellado para caja
    { ...base, id: 302, fecha: FECHA_HOY, fecha_pago: '2026-10-19', grupo_pedido: 'g-302' },
  );
  return datos;
}

test.describe('el día de negocio de la pantalla coincide con el del candado de la base', () => {
  for (const [nombre, reloj] of [['00:30', A_LAS_00_30], ['08:59:59', A_LAS_08_59], ['09:00', A_LAS_09_00], ['09:30', A_LAS_09_30]]) {
    test(`a las ${nombre} del 21-oct: diaNegocio() = ${diaNegocioDelCandado(reloj)} (como la base)`, async ({ page }) => {
      await abrirSistema(page, { fecha: reloj });
      expect(await page.evaluate(() => diaNegocio())).toBe(diaNegocioDelCandado(reloj));
    });
  }

  test('today() sigue siendo el día del calendario (a las 00:30 ya es el 21-oct)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    expect(await page.evaluate(() => today())).toBe('2026-10-21');
    expect(await page.evaluate(() => diaNegocio())).toBe('2026-10-20');
  });
});

test.describe('el límite del calendario sigue al reloj', () => {
  test('con la pantalla abierta: pasadas las 9:00 el mínimo pasa del 20 al 21-oct sin recargar', async ({ page }) => {
    const reg = await abrirSistema(page, { fecha: A_LAS_08_59 });
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', '2026-10-20');
    await reg.fijarReloj(A_LAS_09_00);
    await page.evaluate(() => renderDiaADia());
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', '2026-10-21');
  });

  test('de un día a otro con la pantalla abierta (cena que se cierra pasadas las 9:00): el día 20 ya queda bloqueado', async ({ page }) => {
    const reg = await abrirSistema(page, { fecha: A_LAS_08_59, datos: datosConCenaDel20() });
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY, 'cena');
    await expect(corregir(page)).toBeVisible();            // 08:59: todavía es el día 20
    await reg.fijarReloj(A_LAS_09_00);
    await page.evaluate(() => renderDiaADia());
    await expect(corregir(page)).toBeHidden();             // 09:00: ya es el 21
    await expect(mensaje(page)).toContainText('ingresa como administrador');
  });
});

test.describe('descuento a un pedido pagado: manda la fecha de cobro (como la base)', () => {
  test('consumido antes pero cobrado hoy: caja lo puede tocar', async ({ page }) => {
    await abrirSistema(page, { datos: datosConPagadosDeFechaMixta() });
    await page.evaluate(() => abrirModalDescuento([301]));
    await expect(page.locator('#modal-descuento')).toBeVisible();
  });

  test('un pedido PENDIENTE de días atrás (domicilio de ayer): caja sí puede aplicarle el descuento (el freno es solo para lo ya cobrado)', async ({ page }) => {
    await abrirSistema(page);
    await page.evaluate(() => abrirModalDescuento([204]));   // 204 = domicilio de ayer sin cobrar
    await expect(page.locator('#modal-descuento')).toBeVisible();
  });

  test('del día de hoy pero cobrado en un día ya cerrado: «sal e ingresa como administrador»', async ({ page }) => {
    await abrirSistema(page, { datos: datosConPagadosDeFechaMixta() });
    await page.evaluate(() => abrirModalDescuento([302]));
    await expect(page.locator('.toast.warning').last()).toContainText('ingresa como administrador');
    await expect(page.locator('#modal-descuento')).toBeHidden();
  });
});

test.describe('el límite del calendario también se pone al cambiar de rol sin redibujar', () => {
  test('la autorización de administrador se quita en silencio (sin redibujar): el calendario recupera el mínimo de caja', async ({ page }) => {
    await abrirSistema(page);
    await entrarComoAdmin(page);
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).not.toHaveAttribute('min', /.*/);
    await page.evaluate(() => quitarAdmin(true));
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', FECHA_HOY);
  });
});

test.describe('caja a las 00:30 (la cena del 20-oct sigue en curso)', () => {
  test('puede ver y corregir el cierre de la cena del 20-oct: «Corregir cierre»; «Abrir turno» ahora abre la cena del 20 (no del 21)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30, datos: datosConCenaDel20() });
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY, 'cena');
    await expect(banner(page)).toBeVisible();
    await expect(mensaje(page)).toContainText('Este turno ya está cerrado');
    await expect(corregir(page)).toBeVisible();
    await expect(corregir(page)).toHaveText(/Corregir cierre/);
    await expect(abrir(page)).toBeVisible();               // a las 00:30 la cena que se mira ES el turno en curso: «Abrir turno» la abriría con fecha 20-oct
    await corregir(page).click();                          // ya no la frena la pantalla (antes: «otro día» desde la medianoche)
    await expect(formulario(page)).toBeVisible();
    await expect(banner(page)).toBeHidden();
    await expect(page.locator('#dd-fecha')).toHaveValue(FECHA_HOY);
  });

  test('el calendario deja escoger el 20-oct (mínimo = día de negocio), no el 19', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', '2026-10-20');
  });

  test('un día anterior (19-oct) aparece bloqueado aunque NO tenga cierre: aviso de administrador y sin formulario ni botones', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await irA(page, 'diaadia');
    await verCierre(page, '2026-10-19');
    await expect(banner(page)).toBeVisible();
    await expect(mensaje(page)).toContainText('ingresa como administrador');
    await expect(formulario(page)).toBeHidden();
    await expect(corregir(page)).toBeHidden();
    await expect(abrir(page)).toBeHidden();
  });

  test('descuento a un pedido pagado de la cena del 20-oct: ya no lo frena la pantalla', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_00_30 });
    await page.evaluate(() => abrirModalDescuento([105]));   // 105 = pagado de la cena del 20-oct
    await expect(page.locator('#modal-descuento')).toBeVisible();
  });
});

test.describe('caja a las 9:30 (ya empezó el 21-oct)', () => {
  test('la cena del 20-oct ya es un día anterior: solo el aviso de administrador, sin botones', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_30, datos: datosConCenaDel20() });
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY, 'cena');
    await expect(banner(page)).toBeVisible();
    await expect(mensaje(page)).toContainText('ingresa como administrador');
    await expect(formulario(page)).toBeHidden();
    await expect(corregir(page)).toBeHidden();
    await expect(abrir(page)).toBeHidden();
    await page.evaluate(() => corregirCierreActual());
    await expect(page.locator('.toast.warning').last()).toContainText('ingresa como administrador');
    await expect(formulario(page)).toBeHidden();
  });

  test('el calendario ya no deja escoger el 20-oct (mínimo = 21-oct)', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_30 });
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', '2026-10-21');
  });

  test('descuento a un pedido pagado del 20-oct: «sal e ingresa como administrador»', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_30 });
    await page.evaluate(() => abrirModalDescuento([105]));
    await expect(page.locator('.toast.warning').last()).toContainText('ingresa como administrador');
    await expect(page.locator('#modal-descuento')).toBeHidden();
  });

  test('administrador: el mismo cierre de la cena del 20-oct se «edita» y se abre sin trabas', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_30, datos: datosConCenaDel20(), usuario: 'admin' });
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY, 'cena');
    await expect(banner(page)).toBeVisible();
    await expect(corregir(page)).toHaveText(/Editar turno/);
    await expect(abrir(page)).toBeHidden();
    await corregir(page).click();
    await expect(formulario(page)).toBeVisible();
  });

  test('administrador: descuento a un pedido pagado del 20-oct sí se abre', async ({ page }) => {
    await abrirSistema(page, { fecha: A_LAS_09_30, usuario: 'admin' });
    await page.evaluate(() => abrirModalDescuento([105]));
    await expect(page.locator('#modal-descuento')).toBeVisible();
  });
});

test.describe('en el día normal (14:00 del 20-oct)', () => {
  test('caja: un día anterior sin cierre también aparece bloqueado (no hay formulario para llenar)', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await verCierre(page, '2026-10-19');
    await expect(banner(page)).toBeVisible();
    await expect(mensaje(page)).toContainText('ingresa como administrador');
    await expect(formulario(page)).toBeHidden();
    await expect(page.locator('#dd-turno-label')).toContainText('Día anterior');
  });

  test('caja: con el cierre de hoy ya guardado el rótulo sigue siendo «Abre un turno nuevo» (no el de día anterior)', async ({ page }) => {
    await abrirSistema(page, { datos: datosConCenaDel20() });
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY, 'cena');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('#dd-turno-label')).toContainText('Abre un turno nuevo');
    await expect(page.locator('#dd-turno-label')).not.toContainText('Día anterior');
  });

  test('caja: hoy y los días que vienen se trabajan normal (formulario visible)', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await verCierre(page, FECHA_HOY);
    await expect(formulario(page)).toBeVisible();
    await expect(banner(page)).toBeHidden();
    await verCierre(page, '2026-10-25');                  // la base permite fechas futuras: solo bloquea el pasado
    await expect(formulario(page)).toBeVisible();
    await expect(banner(page)).toBeHidden();
  });

  test('caja: el calendario tiene como mínimo hoy', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', FECHA_HOY);
  });

  test('administrador: calendario sin mínimo y un día anterior sin cierre se muestra como siempre (formulario visible)', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).not.toHaveAttribute('min', /.*/);
    await verCierre(page, '2026-10-19');
    await expect(formulario(page)).toBeVisible();
    await expect(banner(page)).toBeHidden();
  });

  test('administrador entra «en el sitio» sobre una sesión de caja: el calendario pierde el mínimo; al salir, lo recupera', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', FECHA_HOY);
    await entrarComoAdmin(page);
    await expect(page.locator('#dd-fecha')).not.toHaveAttribute('min', /.*/);
    await salirDeAdmin(page);
    await expect(page.locator('#dd-fecha')).toHaveAttribute('min', FECHA_HOY);
  });
});
