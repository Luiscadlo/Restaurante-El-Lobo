// La pestaña Menú del sistema carga el generador en un iframe: si ese archivo no se publica, la pestaña queda
// en blanco. Esta prueba vigila que el archivo que apunta el iframe exista en el repositorio y NO esté en
// .gitignore (el resto de Menu/ sí se excluye a propósito: plantilla, tipografías, presentaciones).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'Contabilidad', 'ElLobo-Sistema Contable.html'), 'utf-8');
const git = (...args) => spawnSync('git', args, { cwd: RAIZ, encoding: 'utf-8' });
const hayGit = git('rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';

// Rutas que la pestaña Menú usa (iframe, enlace «Abrir en pestaña aparte», recarga con ?v=…), relativas a Contabilidad/.
function rutasDelMenu() {
  const rutas = new Set();
  for (const m of HTML.matchAll(/(\.\.\/Menu\/[^"'?]+\.html)/g)) rutas.add(decodeURIComponent(m[1]));
  return [...rutas];
}

test('la pestaña Menú apunta a un archivo que existe', () => {
  const rutas = rutasDelMenu();
  expect(rutas.length, 'no se encontró la ruta del generador de menú en el HTML').toBeGreaterThan(0);
  expect(rutas).toHaveLength(1);                              // iframe, enlace y recarga apuntan al mismo archivo
  for (const r of rutas) expect(fs.existsSync(path.join(RAIZ, 'Contabilidad', r)), `falta ${r}`).toBe(true);
});

test('ese archivo está en el repositorio: no lo ignora .gitignore y git lo rastrea', () => {
  test.skip(!hayGit, 'No hay git en este equipo');
  for (const r of rutasDelMenu()) {
    const rel = path.posix.join('Menu', path.posix.basename(r));
    expect(git('check-ignore', '-q', '--no-index', '--', rel).status, `${rel} está en .gitignore: la pestaña Menú quedaría en blanco`).not.toBe(0);
    expect(git('ls-files', '--error-unmatch', '--', rel).status, `${rel} no está rastreado por git`).toBe(0);
  }
});

test('el resto de Menu/ (materiales de diseño) no se sube', () => {
  test.skip(!hayGit, 'No hay git en este equipo');
  for (const rel of ['Menu/plantilla.png', 'Menu/Fonts/Anton/Anton-Regular.ttf', 'Menu/Menu/COMIDAS EL LOBO - PUBLICIDAD.pptx', 'Menu/platos.xlsx']) {
    expect(git('check-ignore', '-q', '--', rel).status, `${rel} debería estar en .gitignore`).toBe(0);
  }
  const rastreados = git('-c', 'core.quotepath=off', 'ls-files', 'Menu').stdout.split('\n').filter(Boolean);
  expect(rastreados).toHaveLength(1);
});
