// El respaldo que baja la pantalla lo entienden las herramientas de restauración.
//
// docs/RESTAURAR.md explica cómo reconstruir El Lobo desde el .json de «Datos → Respaldo completo».
// Las pruebas de herramientas/ (tests/python) usan respaldos armados a mano; esta prueba cierra el
// círculo: baja un respaldo REAL del sistema (contra el backend falso, con datos de ejemplo) y se lo
// pasa a herramientas/respaldo_a_sql.py, que valida el archivo y genera el SQL de restauración.
// Si algún día cambia el formato del respaldo en la pantalla, esta prueba avisa antes de que haga falta.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { abrirSistema } = require('./helpers/backend-falso');

const RAIZ = path.join(__dirname, '..');
const PYTHON = ['python3', 'python'].find(p => spawnSync(p, ['--version']).status === 0);

const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);

async function bajarRespaldo(page, carpeta) {
  await abrirSistema(page, { usuario: 'admin' });
  await irA(page, 'datos');
  const descarga = page.waitForEvent('download');
  await page.locator('#btn-respaldo-completo').click();
  const ruta = path.join(carpeta, 'respaldo.json');
  await (await descarga).saveAs(ruta);
  // Los datos de ejemplo son filas escritas a mano y no todas traen las mismas columnas; el Supabase real
  // (PostgREST) devuelve SIEMPRE todas las columnas de cada fila, con null donde no hay valor. Se rellena
  // igual para que el archivo sea como el de verdad. Lo demás (formato, conteos, nombres) queda tal cual.
  const respaldo = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  for (const filas of Object.values(respaldo.tablas)) {
    const columnas = [...new Set(filas.flatMap(f => Object.keys(f)))];
    for (const f of filas) for (const c of columnas) if (!(c in f)) f[c] = null;
  }
  fs.writeFileSync(ruta, JSON.stringify(respaldo));
  return ruta;
}

test.describe('el respaldo de la pantalla sirve para restaurar', () => {
  test.skip(!PYTHON, 'No hay Python instalado en este equipo');
  let carpeta;
  test.beforeEach(() => { carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'lobo-restaurable-')); });
  test.afterEach(() => { fs.rmSync(carpeta, { recursive: true, force: true }); });

  test('respaldo_a_sql.py acepta el archivo, cuenta las mismas filas y genera el SQL', async ({ page }) => {
    const ruta = await bajarRespaldo(page, carpeta);
    const respaldo = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    const tablas = Object.keys(respaldo.tablas);
    const filas = Object.values(respaldo.conteos).reduce((a, b) => a + b, 0);
    expect(tablas.length).toBeGreaterThan(10);
    expect(filas).toBeGreaterThan(0);

    const salida = path.join(carpeta, 'sql');
    const texto = execFileSync(PYTHON, [path.join(RAIZ, 'herramientas', 'respaldo_a_sql.py'), ruta, '-o', salida], { encoding: 'utf-8' });
    expect(texto).toContain(`Respaldo: ${tablas.length} tablas, ${filas} filas.`);
    expect(texto).not.toContain('NO SE HIZO NADA');

    const archivos = fs.readdirSync(salida).filter(f => /^ElLobo_restaurar_\d+_de_\d+\.sql$/.test(f));
    expect(archivos.length).toBeGreaterThan(0);
    const sql = archivos.map(f => fs.readFileSync(path.join(salida, f), 'utf-8')).join('\n');
    // una tabla con datos del ejemplo viaja con sus filas
    expect(sql).toMatch(/insert into\s+"?(public\.)?"?pedidos/i);
  });

  test('si el archivo se altera (una fila menos que el conteo), la herramienta se niega', async ({ page }) => {
    const ruta = await bajarRespaldo(page, carpeta);
    const respaldo = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    const tabla = Object.keys(respaldo.tablas).find(t => respaldo.tablas[t].length > 1);
    respaldo.tablas[tabla].pop();
    fs.writeFileSync(ruta, JSON.stringify(respaldo));
    const r = spawnSync(PYTHON, [path.join(RAIZ, 'herramientas', 'respaldo_a_sql.py'), ruta, '-o', path.join(carpeta, 'sql')], { encoding: 'utf-8' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('NO SE HIZO NADA');
    expect(r.stdout).toContain('Está dañado o incompleto');
  });
});
