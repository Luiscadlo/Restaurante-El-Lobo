// OJITO DE LA CONTRASEÑA en la pantalla de entrada: sirve para revisar lo que se escribe antes de entrar.
//  · Empieza siempre oculta; el botón la muestra/oculta (con ratón, teclado y lector de pantalla).
//  · No envía el formulario ni borra lo escrito; con la clave visible se puede entrar igual.
//  · Al entrar, la clave se borra y el campo vuelve a «oculto» para la próxima vez.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');

const campo = page => page.locator('#login-password');
const ojo = page => page.locator('#login-ver-clave');

async function abrirEntrada(page) {
  const reg = await abrirSistema(page, { usuario: null });
  await expect(page.locator('#loginOverlay')).toBeVisible();
  return reg;
}
const esperarCarga = page => page.waitForFunction(() => ['loginOverlay', 'loadingOverlay'].every(id => getComputedStyle(document.getElementById(id)).display === 'none'));

test.describe('ojito de la contraseña', () => {
  test('empieza oculta, con el botón listo para mostrarla', async ({ page }) => {
    await abrirEntrada(page);
    await expect(campo(page)).toHaveAttribute('type', 'password');
    await expect(ojo(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(ojo(page)).toHaveAttribute('aria-label', 'Mostrar contraseña');
    await expect(page.locator('#ojo-abierto')).toBeVisible();
    await expect(page.locator('#ojo-tachado')).toBeHidden();
  });

  test('al pulsarlo se ve lo escrito; al pulsarlo otra vez se oculta, sin perder el texto', async ({ page }) => {
    await abrirEntrada(page);
    await campo(page).fill('Mi-clave-123');
    await ojo(page).click();
    await expect(campo(page)).toHaveAttribute('type', 'text');
    await expect(campo(page)).toHaveValue('Mi-clave-123');
    await expect(ojo(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(ojo(page)).toHaveAttribute('aria-label', 'Ocultar contraseña');
    await expect(page.locator('#ojo-tachado')).toBeVisible();
    await expect(page.locator('#ojo-abierto')).toBeHidden();
    await ojo(page).click();
    await expect(campo(page)).toHaveAttribute('type', 'password');
    await expect(campo(page)).toHaveValue('Mi-clave-123');
    await expect(ojo(page)).toHaveAttribute('aria-label', 'Mostrar contraseña');
  });

  test('es un botón aparte: no envía el formulario ni muestra errores, y deja el cursor en la clave', async ({ page }) => {
    const reg = await abrirEntrada(page);
    await page.fill('#login-email', 'caja');
    await campo(page).fill('clave-caja');
    await ojo(page).click();
    await expect(page.locator('#login-error')).toBeHidden();
    expect(reg.auth).toEqual([]);
    await expect(campo(page)).toBeFocused();
  });

  test('con el teclado: se llega con Tab y se alterna con Espacio o Enter', async ({ page }) => {
    await abrirEntrada(page);
    await campo(page).focus();
    await page.keyboard.press('Tab');
    await expect(ojo(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(campo(page)).toHaveAttribute('type', 'text');
    await ojo(page).focus();
    await page.keyboard.press('Enter');
    await expect(campo(page)).toHaveAttribute('type', 'password');
  });

  test('con la clave visible se entra igual; al entrar vuelve a oculta y vacía', async ({ page }) => {
    const reg = await abrirEntrada(page);
    await page.fill('#login-email', 'caja');
    await campo(page).fill('clave-caja');
    await ojo(page).click();
    await page.click('#login-btn');
    await esperarCarga(page);
    expect(reg.auth).toEqual(['password:caja@elobo.test']);
    await expect(campo(page)).toHaveAttribute('type', 'password');
    await expect(campo(page)).toHaveValue('');
    await expect(ojo(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('entrar SIN tocar el ojito: el campo queda oculto (nunca se «destapa» solo al entrar)', async ({ page }) => {
    await abrirEntrada(page);
    await page.fill('#login-email', 'caja');
    await campo(page).fill('clave-caja');
    await page.click('#login-btn');
    await esperarCarga(page);
    await expect(campo(page)).toHaveAttribute('type', 'password');
    await expect(campo(page)).toHaveValue('');
  });

  test('si la clave estaba mal, sigue visible para poder corregirla (y el aviso de error aparece)', async ({ page }) => {
    await abrirEntrada(page);
    await page.fill('#login-email', 'caja');
    await campo(page).fill('clave-equivocada');
    await ojo(page).click();
    await page.click('#login-btn');
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(campo(page)).toHaveAttribute('type', 'text');
    await expect(campo(page)).toHaveValue('clave-equivocada');
  });

  test('el botón queda dentro del campo, sin tapar el texto ni el botón «Entrar» (celular y computador)', async ({ page }) => {
    for (const ancho of [360, 1280]) {
      await page.setViewportSize({ width: ancho, height: 700 });
      await abrirEntrada(page);
      const c = await campo(page).boundingBox();
      const o = await ojo(page).boundingBox();
      const e = await page.locator('#login-btn').boundingBox();
      expect(o.x).toBeGreaterThanOrEqual(c.x);
      expect(o.x + o.width).toBeLessThanOrEqual(c.x + c.width);
      expect(o.y).toBeGreaterThanOrEqual(c.y);
      expect(o.y + o.height).toBeLessThanOrEqual(c.y + c.height);
      expect(o.y + o.height).toBeLessThan(e.y);
      expect(o.width).toBeGreaterThanOrEqual(34);              // cómodo para el dedo
      // el texto largo no pasa por debajo del botón: el campo deja margen a la derecha
      expect(await campo(page).evaluate(el => parseFloat(getComputedStyle(el).paddingRight))).toBeGreaterThanOrEqual(o.width);
      await page.screenshot({ path: `test-results/ojo-clave-${ancho}.png`, clip: { x: 0, y: 0, width: ancho, height: 500 } });
    }
  });
});
