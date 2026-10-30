// Ventanas del sistema (en lugar de los avisos del navegador).
//
// El sistema ya NO usa alert/confirm/prompt del navegador: cada pregunta («¿Eliminar…?», «¿Continuar?», «¿A nombre de quién
// queda este fiado?») sale en una ventana propia (#modal-sistema y #modal-elegir-cliente). Estos ayudantes las atienden en las
// pruebas, y vigilan que el navegador NO muestre ningún aviso propio (si saliera, se anota en `nativos` y se cierra).
// Hay que llamarlos ANTES de abrir el sistema (abrirSistema).

// Pulsa «Sí / Aceptar» (valor 'si', o 'usar' en las preguntas de saldo a favor) cada vez que sale una ventana del sistema.
// Devuelve la lista de avisos del navegador que hayan salido (debe quedar vacía).
function aceptarAvisos(page) {
  const nativos = [];
  page.on('dialog', async d => { nativos.push({ tipo: d.type(), mensaje: d.message() }); await d.dismiss(); });
  page.addInitScript(() => {
    setInterval(() => {
      if (window.__noAceptarAvisos) return;      // una prueba que quiera contestar ella misma lo activa: page.evaluate(() => { window.__noAceptarAvisos = true; })
      const m = document.getElementById('modal-sistema');
      if (!m || getComputedStyle(m).display === 'none') return;
      const botones = [...m.querySelectorAll('#sis-opciones button')];
      const ok = botones.find(b => b.dataset.eleccion === 'si') || botones.find(b => b.dataset.eleccion === 'usar');
      if (ok) ok.click();
    }, 15);
  });
  return nativos;
}

module.exports = { aceptarAvisos };
