// MATRIZ DE PERMISOS — tabla × rol × operación. La FUENTE ÚNICA es sql/matriz_permisos.json.
//
//   S = leer (SELECT)   I = crear (INSERT)   U = modificar (UPDATE)   D = borrar (DELETE)
//
// De esa misma matriz salen:
//   1) El SQL que se aplica en Supabase (herramientas/generar_rls.py → sql/rls_seguridad.sql).
//   2) El backend falso de las pruebas JS (helpers/backend-falso.js), que hace cumplir esta matriz
//      igual que lo hará Supabase con RLS: si el sistema intenta algo que el rol no puede, la prueba
//      lo ve (`reg.denegadas`). Así se comprueba que el sistema funciona COMPLETO con los permisos
//      mínimos de caja, antes de tocar la base real.
//   3) La prueba tests/python/test_rls.py, que aplica el SQL en un Postgres de verdad y comprueba,
//      rol por rol, tabla por tabla y operación por operación, que se cumple exactamente esta matriz.
//
// Documento para humanos: docs/MATRIZ_PERMISOS.md.
const MATRIZ = require('../../sql/matriz_permisos.json');

const TABLAS = MATRIZ.tablas;
const PERMISOS = MATRIZ.roles;
const OPERACION_HTTP = { GET: 'S', POST: 'I', PATCH: 'U', DELETE: 'D' };

function puede(rol, tabla, operacion) {
  const ops = (PERMISOS[rol] || {})[tabla] || '';
  return ops.includes(operacion);
}

module.exports = { TABLAS, PERMISOS, OPERACION_HTTP, puede };
