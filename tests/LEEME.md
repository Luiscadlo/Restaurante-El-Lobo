# Pruebas automáticas de El Lobo

Estas pruebas abren el sistema contable en un navegador de prueba, con **datos ficticios** y un
**Supabase falso**, y comprueban que todo sigue funcionando y que las cuentas de plata dan lo mismo
que dan a mano. **No tocan tu base de datos real ni salen a internet.** No forman parte del sistema:
GitHub Pages sigue publicando solo el sistema.

## Cómo correrlas

Hace falta Node.js (ya lo tienes si usas Claude Code) y, para el motor, Python.

La primera vez, en una terminal, en la carpeta del repositorio:

```
npm install
npx playwright install chromium
pip install -r requirements-dev.txt
```

Cada vez que quieras comprobar que todo está bien:

```
npm test              # el sistema web (humo + reglas de plata)
npm run test:motor    # el motor Python (modelo financiero) y la seguridad de la base (test_rls.py)
```

Si todo está bien verás `passed` en verde. Si algo falla, copia el mensaje y pégaselo a Claude.

**Regla de oro:** corre `npm test` **antes de fusionar cualquier cambio a `main`**.

## Qué cubre cada archivo

| Archivo | Qué comprueba |
|---|---|
| `tests/humo.spec.js` | El sistema abre; como **caja** pide solo las 12 tablas operativas y como **admin** las 16; las 12 pestañas abren sin errores; las pestañas con candado muestran su login (como caja) y su contenido con un admin autorizado; abrir el sistema no escribe nada ni intenta nada prohibido. |
| `tests/reglas.spec.js` | Las reglas de plata: reparto de descuentos, cuánto aporta cada pedido a efectivo y transferencia, saldo de fiados, ajustes y abonos de los cierres, ventas fijas de cada turno, fechas y formato de pesos. Los valores esperados están calculados a mano y comentados. |
| `tests/seguridad.spec.js` | **Acceso y roles:** pantalla de entrada (clave mala, sin rol, usuario de respaldo, servicio caído); la sesión de caja se recuerda y la de admin nunca; renovación del token (una sola aunque haya muchas peticiones; adopta la de otra pestaña); "Salir"; autorizar un dueño desde caja (cualquiera de los dos, con su propio usuario); que la autorización no se guarda y se borra de memoria al cerrarla; que forzar el candado por consola no da datos (el servidor manda); que el archivo no trae contraseñas ni llaves de servicio; **que con caja no aparezca ningún control de administrador** (Cierre manual, Historial de cierres, aviso de respaldo, cajitas de contraseña; y la pestaña Datos con el respaldo completo) en ninguna de sus 6 pestañas. |
| `tests/respaldo.spec.js` | **Respaldo completo y su aviso:** la lista de tablas cubre todo lo que usa el código; el aviso semanal (ámbar desde cada domingo, rojo a los 10 días, solo administrador) y se apaga al hacer un respaldo bueno; la tarjeta «Respaldo completo» de la pestaña Datos (estado del último respaldo, solo administrador, sin botones Exportar/Importar en el encabezado); el respaldo baja las 16 tablas, verifica los conteos y solo entonces se registra. |
| `tests/flujos-caja.spec.js` | **El mostrador completo con permisos mínimos de caja:** tomar y cobrar pedidos, cancelar, eliminar cobrados, descuentos, gastos del turno, abrir/cerrar/reabrir turno, notas, inventario, abonos de fiado. En cada flujo el servidor falso no debe negar nada (`denegadas` vacío) y las tablas de auditoría se escriben "a ciegas". |
| `tests/auditoria-filtro.spec.js` | **Auditoría, filtro por día:** Hoy/Ayer/Semana/Mes/Todo y rango «desde – hasta» (un día = elegir solo una fecha); los ajustes se ubican por la fecha del cierre y los eliminados/descuentos por el día local en que se hicieron (incluye casos que cruzan la medianoche UTC); cartelitos de «sin … en ese día»; el numerito de la pestaña no da por vistos los registros que el filtro esconde. |
| `tests/abonos-fiado.spec.js` | **Eliminar un abono de fiado** (solo administrador): la secuencia real de un abono hecho por error (abono → ↩ → cancelar el pedido) deja el saldo a favor visible en Fiados y en el cierre hasta que el administrador lo elimina; no se puede eliminar un abono con el que se saldó un pedido (hay que devolverlo con ↩ antes); si el abono está en un cierre guardado se abre «Corregir cierre»; caja no ve el botón. |
| `tests/saldo-a-favor.spec.js` | **Formulario «Registrar saldo a favor»** (pestaña Fiados): un cliente que paga de más sin deber nada (de la lista o nombre nuevo, sin duplicar uno existente aunque cambien tildes/mayúsculas); el abono entra al cierre del día/turno en su cuenta (efectivo o transferencia); validaciones sin escribir nada; con deuda se comporta como abono normal; el saldo se gasta con «Aplicar saldo a favor» sin meter plata nueva; si el cierre ya estaba guardado, pide confirmar y abre «Corregir cierre»; el administrador puede eliminar el abono y caja no ve el botón. |
| `tests/python/test_rls.py` | **La seguridad contra un Postgres de verdad:** aplica `sql/rls_seguridad.sql` en una base desechable que imita a Supabase y comprueba, para 9 perfiles (admin, caja, respaldo, sin rol, rol inventado, rol en `user_metadata`, llave pública…) × 17 tablas × 5 operaciones, que se cumple EXACTAMENTE la matriz; que las vistas no se saltan las reglas; que aplicar dos veces es seguro y que el rollback deja todo como estaba. Si no hay PostgreSQL instalado, se salta sola. |
| `tests/python/test_motor.py` | El motor del modelo financiero corre en modo demo sin errores, genera el Excel esperado y no deja archivos dentro del repo. |

Ayudas (no son pruebas): `tests/helpers/backend-falso.js` (el Supabase falso: base **y** Auth con usuarios
de prueba por rol, que hace cumplir los permisos como lo hará Supabase), `tests/helpers/permisos.js`
(la **matriz de permisos** tabla × rol × operación — fuente única, explicada en `docs/MATRIZ_PERMISOS.md`),
`tests/helpers/sesion.js` (cómo se autoriza un administrador de prueba: **un solo lugar**) y
`tests/fixtures/datos.js` (los datos de ejemplo).

Por defecto cada prueba abre el sistema **como caja** (como en el mostrador). Para otro caso:
`abrirSistema(page, { usuario: 'admin' })` (entra tecleando en la pantalla de entrada),
`{ usuario: null }` (sin sesión, se queda en la entrada) o `entrarComoAdmin(page)` (autoriza un dueño
sobre la sesión de caja). Los usuarios y claves de prueba son ficticios y están en `backend-falso.js`.

## Los datos de ejemplo

Todo es inventado ("Cliente Uno (prueba)", etc.). "Hoy" en las pruebas es siempre el **martes
20-oct-2026**, para que los resultados no cambien con el día en que se corran. Las cuentas a mano
están en los comentarios de `tests/fixtures/datos.js` y de `tests/reglas.spec.js`: si cambias un dato
de ejemplo, vuelve a calcularlas.

## Cómo agregar una prueba nueva

1. Abre `tests/reglas.spec.js` y copia una prueba parecida.
2. Calcula el resultado esperado **a mano** y déjalo escrito en un comentario. **No copies lo que
   devuelve la función**: si la función tuviera un error, la prueba lo congelaría en vez de mostrarlo.
3. Corre `npm test`.
4. Si una prueba falla porque el cambio fue a propósito, actualiza la prueba y explica por qué.
   Si falla por otra razón, no la apagues: es un posible error.

## Lo que estas pruebas NO hacen

- No prueban cómo se ve el sistema en un celular real.
- No prueban tu Supabase **real**: `test_rls.py` aplica el SQL en un Postgres desechable que imita a
  Supabase (misma lógica de reglas, roles y token), y el backend falso de las pruebas web hace cumplir
  la misma matriz. La comprobación en tu proyecto real es el Paso 7 de `docs/DESPLIEGUE_SEGURIDAD.md`.
- Los flujos con guardado (vender, cobrar, cerrar) comprueban que se hagan las escrituras correctas y
  que los permisos alcancen, pero la base falsa responde "ok" y no las recuerda: no verifican cómo
  queda la pantalla después de recargar.
- La librería de Excel (`xlsx`, que viene de internet) y las fuentes se reemplazan por respuestas
  vacías: la exportación a Excel del sistema no se prueba aquí.
- Una prueba en verde no es una garantía absoluta: solo cubre lo que está escrito. La lista de lo
  que falta cubrir está en la descripción del pull request.
