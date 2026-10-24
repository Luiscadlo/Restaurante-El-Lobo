// Sesión de administrador en las pruebas — UN SOLO sitio.
// Hoy el acceso admin es la variable `adminAutenticado` (intentarAccesoAdmin la pone en true y
// llama renderAll()). Aquí se simula igual, SIN teclear ninguna contraseña.
// Cuando el Prompt D cambie el login (token con rol), se actualiza SOLO este archivo.

async function entrarComoAdmin(page) {
  await page.evaluate(() => { adminAutenticado = true; renderAll(); });
}

async function salirDeAdmin(page) {
  await page.evaluate(() => { cerrarSesionAdmin(); });
}

module.exports = { entrarComoAdmin, salirDeAdmin };
