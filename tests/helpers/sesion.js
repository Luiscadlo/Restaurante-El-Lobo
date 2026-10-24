// Sesión de administrador en las pruebas — UN SOLO sitio.
//
// En el sistema, quien está en el mostrador tiene sesión de CAJA. Para abrir las secciones de
// administración se "autoriza en el sitio" un administrador (correo + contraseña). Aquí se hace
// igual, pasando por el Supabase Auth falso (sin teclear en los campos de la página).
//
// Si la página ya se abrió como admin (abrirSistema(page, { usuario: 'admin' })), no hace falta nada.
const { USUARIOS, USUARIO_POR_ROL } = require('./backend-falso');

async function entrarComoAdmin(page, correo = USUARIO_POR_ROL.admin) {
  const clave = USUARIOS[correo].password;
  const r = await page.evaluate(([c, p]) => autorizarAdmin(c, p), [correo, clave]);
  if (!r.ok) throw new Error('No se pudo autorizar al admin de prueba: ' + r.mensaje);
  await page.evaluate(() => renderAll());
}

async function salirDeAdmin(page) {
  await page.evaluate(() => { cerrarSesionAdmin(); });
}

module.exports = { entrarComoAdmin, salirDeAdmin };
