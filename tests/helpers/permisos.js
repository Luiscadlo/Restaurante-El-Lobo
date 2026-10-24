// MATRIZ DE PERMISOS — tabla × rol × operación. Es la FUENTE ÚNICA de lo que cada rol puede hacer.
//
//   S = leer (SELECT)   I = crear (INSERT)   U = modificar (UPDATE)   D = borrar (DELETE)
//
// La usan DOS cosas:
//   1) El backend falso de las pruebas (helpers/backend-falso.js) hace cumplir esta matriz igual
//      que lo hará Supabase con las reglas RLS: si el sistema intenta algo que el rol no puede,
//      la prueba lo ve (`reg.denegadas`). Así se comprueba que el sistema funciona COMPLETO con
//      los permisos mínimos de caja, antes de tocar la base real.
//   2) La prueba tests/rls-sql.spec.js (cuando exista el archivo sql/rls_*.sql) compara esta matriz
//      con las políticas del SQL, para que ambos no se desvíen.
//
// Documento para humanos: docs/MATRIZ_PERMISOS.md (mismo contenido, explicado).

const TABLAS = [
  'pedidos', 'mesas', 'clientes_fiado', 'abonos_fiado', 'pedidos_eliminados', 'pedidos_descuentos',
  'inventario', 'consumos', 'gastos_dia', 'cierres_dia', 'aperturas_turno', 'notas_dia', 'config',
  'egresos', 'movimientos_caja', 'ingresos_extra',
];

const todas = ops => Object.fromEntries(TABLAS.map(t => [t, ops]));

const PERMISOS = {
  // Dueños/familia: todo.
  admin: todas('SIUD'),

  // Respaldo automático: SOLO lectura de todo (para descargar copias). No entra a la pantalla.
  respaldo: todas('S'),

  // Empleado del mostrador (usuario compartido): solo lo operativo del día a día.
  // Sin fila = sin acceso (RLS no le entrega ni le deja tocar nada de esa tabla).
  caja: {
    pedidos:            'SIUD',   // tomar, cobrar, editar y cancelar pedidos
    mesas:              'SU',     // ocupada/libre
    clientes_fiado:     'SI',     // crear clientes de fiado
    abonos_fiado:       'SI',     // registrar abonos (no se borran ni editan)
    pedidos_eliminados: 'I',      // auditoría: solo AGREGAR — no puede leer, cambiar ni borrar el rastro
    pedidos_descuentos: 'I',      // auditoría: solo AGREGAR
    inventario:         'SIUD',
    consumos:           'SI',
    gastos_dia:         'SIUD',   // gastos del turno (parte del cierre)
    cierres_dia:        'SIUD',   // cerrar turno / reabrir turno
    aperturas_turno:    'SIU',
    notas_dia:          'SID',
    config:             'S',      // solo para ver el aviso de respaldo
    // egresos, movimientos_caja, ingresos_extra → sin acceso (finanzas)
  },
};

const OPERACION_HTTP = { GET: 'S', POST: 'I', PATCH: 'U', DELETE: 'D' };

function puede(rol, tabla, operacion) {
  const ops = (PERMISOS[rol] || {})[tabla] || '';
  return ops.includes(operacion);
}

module.exports = { TABLAS, PERMISOS, OPERACION_HTTP, puede };
