// Red contra filtraciones: el repositorio es PÚBLICO, así que en NINGÚN archivo (versionado o por versionar)
// puede haber llaves de servicio, claves de base de datos ni contraseñas. La única llave permitida es la
// PÚBLICA (rol "anon") de Supabase, que va en el HTML por diseño.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function archivos() {
  // Rastreados + nuevos que no están ignorados (lo que se subiría con un `git add .`)
  const salida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RAIZ, maxBuffer: 1 << 28 });
  return salida.toString('utf8').split('\0').filter(Boolean)
    .filter(f => !f.startsWith('node_modules/'))
    .filter(f => fs.existsSync(path.join(RAIZ, f)));
}

function textoDe(f) {
  const b = fs.readFileSync(path.join(RAIZ, f));
  if (b.includes(0)) return null;            // binario (fuentes, imágenes, docx…)
  return b.toString('utf8');
}

function jwts(texto) {
  return texto.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
}

function payload(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

test('toda llave JWT del repositorio es la PÚBLICA (rol anon) de Supabase', () => {
  const encontradas = [];
  for (const f of archivos()) {
    const t = textoDe(f);
    if (!t) continue;
    for (const j of jwts(t)) encontradas.push({ f, p: payload(j) });
  }
  expect(encontradas.length).toBeGreaterThan(0);   // la del HTML
  for (const { f, p } of encontradas) {
    expect(p.role, `llave no pública en ${f}`).toBe('anon');
  }
  // y todas apuntan al mismo proyecto
  expect(new Set(encontradas.map(e => e.p.ref)).size).toBe(1);
});

test('no hay llaves secretas, cadenas de conexión con clave ni claves privadas en ningún archivo', () => {
  const patrones = [
    [/sb_secret_[A-Za-z0-9_-]{10,}/, 'llave secreta nueva de Supabase'],
    [/postgres(ql)?:\/\/[^\s:@\/]+:[^\s@\/]{3,}@/, 'cadena de conexión a Postgres con contraseña'],
    [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'clave privada'],
    [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'token de GitHub'],
    [/sk-ant-[A-Za-z0-9_-]{20,}/, 'llave de API'],
    [/ADMIN_PASSWORD\s*=/, 'contraseña de administrador escrita en el código'],
  ];
  const hallazgos = [];
  for (const f of archivos()) {
    if (f === 'tests/secretos.spec.js') continue;   // este archivo describe los patrones
    const t = textoDe(f);
    if (!t) continue;
    for (const [re, que] of patrones) if (re.test(t)) hallazgos.push(`${f}: ${que}`);
  }
  expect(hallazgos).toEqual([]);
});

test('ningún respaldo ni export con datos reales está por subirse', () => {
  const malos = archivos().filter(f =>
    /(^|\/)ElLobo_(respaldo|datos|Modelo)/i.test(f) || /(^|\/)datos_[^/]*\.json$/i.test(f) || /\.(xlsx|xls|xlsm)$/i.test(f));
  // Única excepción permitida: el catálogo público de platos del Menú
  const permitidos = new Set(['Menu/platos.xlsx', 'Menu/Menu/platos.xlsx']);
  expect(malos.filter(f => !permitidos.has(f))).toEqual([]);
});
