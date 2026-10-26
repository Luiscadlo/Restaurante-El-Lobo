// CIERRE de un día que no es hoy: el botón «Abrir turno» siempre abre el turno de HOY, así que no se ofrece cuando se
// mira (o se corrige) otro día. Caja no ve ningún botón (solo el aviso de pedirle el cambio al administrador); el
// administrador ve «✏️ Editar turno». Con el cierre de hoy todo sigue como siempre: «Corregir cierre» y «Abrir turno».
const { test, expect } = require('@playwright/test');
const { abrirSistema, FECHA_HOY } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');

const OTRO_DIA = '2026-10-18';      // en los datos de ejemplo ya tiene cierre de almuerzo
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const verCierre = (page, fecha) => page.evaluate(f => { document.getElementById('dd-fecha').value = f; ddTurno = 'almuerzo'; onFechaCierreChange(); }, fecha);

function datosConCierreDeHoy() {
  const datos = JSON.parse(JSON.stringify(DATOS_BASE));
  datos.cierres_dia = [...datos.cierres_dia, { id: 77, fecha: FECHA_HOY, turno: 'almuerzo', efectivo: 100000, transferencia: 20000, gastos: 0, resultado: 120000, manual: false, platos_familia: 0 }];
  return datos;
}
const corregir = page => page.locator('#btn-corregir-cierre');
const abrir = page => page.locator('#btn-abrir-turno-cierre');

test.describe('cierre de otro día', () => {
  test('caja: ve el aviso de pedirle el cambio al administrador y NINGÚN botón (ni corregir ni abrir turno)', async ({ page }) => {
    await abrirSistema(page);
    await irA(page, 'diaadia');
    await verCierre(page, OTRO_DIA);
    await expect(page.locator('#dd-cerrado-banner')).toBeVisible();
    await expect(page.locator('#dd-cerrado-mensaje')).toContainText('ingresa como administrador');
    await expect(corregir(page)).toBeHidden();
    await expect(abrir(page)).toBeHidden();
  });

  test('administrador: el botón dice «Editar turno» y no hay «Abrir turno»; al pulsarlo se abre la edición de ese cierre', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin' });
    await irA(page, 'diaadia');
    await verCierre(page, OTRO_DIA);
    await expect(page.locator('#dd-cerrado-banner')).toBeVisible();
    await expect(corregir(page)).toBeVisible();
    await expect(corregir(page)).toHaveText(/Editar turno/);
    await expect(abrir(page)).toBeHidden();
    await corregir(page).click();
    await expect(page.locator('#dd-form-activo')).toBeVisible();
    await expect(page.locator('#dd-cerrado-banner')).toBeHidden();
    await expect(page.locator('#dd-fecha')).toHaveValue(OTRO_DIA);
  });

  for (const usuario of ['caja', 'admin']) {
    test(`${usuario}: con el cierre de HOY todo sigue como siempre («Corregir cierre» y «Abrir turno»)`, async ({ page }) => {
      await abrirSistema(page, { usuario, datos: datosConCierreDeHoy() });
      await irA(page, 'diaadia');
      await verCierre(page, FECHA_HOY);
      await expect(page.locator('#dd-cerrado-banner')).toBeVisible();
      await expect(page.locator('#dd-cerrado-mensaje')).toContainText('Este turno ya está cerrado');
      await expect(corregir(page)).toBeVisible();
      await expect(corregir(page)).toHaveText(/Corregir cierre/);
      await expect(abrir(page)).toBeVisible();
      await expect(abrir(page)).toHaveText(/Abrir turno/);
    });
  }

  test('ir de un día anterior a hoy y volver: los botones y rótulos se actualizan cada vez', async ({ page }) => {
    await abrirSistema(page, { usuario: 'admin', datos: datosConCierreDeHoy() });
    await irA(page, 'diaadia');
    await verCierre(page, OTRO_DIA);
    await expect(corregir(page)).toHaveText(/Editar turno/);
    await expect(abrir(page)).toBeHidden();
    await verCierre(page, FECHA_HOY);
    await expect(corregir(page)).toHaveText(/Corregir cierre/);
    await expect(abrir(page)).toBeVisible();
    await verCierre(page, OTRO_DIA);
    await expect(corregir(page)).toHaveText(/Editar turno/);
    await expect(abrir(page)).toBeHidden();
  });
});
