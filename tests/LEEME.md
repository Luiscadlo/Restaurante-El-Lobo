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
| `tests/seguridad.spec.js` | **Acceso y roles:** pantalla de entrada (clave mala, sin rol, usuario de respaldo, servicio caído); la sesión de caja se recuerda y la de admin nunca; renovación del token (una sola aunque haya muchas peticiones; adopta la de otra pestaña); "Salir"; autorizar un dueño desde caja (cualquiera de los dos, con su propio usuario); que la autorización no se guarda y se borra de memoria al cerrarla; que forzar el candado por consola no da datos (el servidor manda); que el archivo no trae contraseñas ni llaves de servicio. |
| `tests/flujos-caja.spec.js` | **El mostrador completo con permisos mínimos de caja:** tomar y cobrar pedidos, cancelar, eliminar cobrados, descuentos, gastos del turno, abrir/cerrar/reabrir turno, notas, inventario, abonos de fiado. En cada flujo el servidor falso no debe negar nada (`denegadas` vacío) y las tablas de auditoría se escriben "a ciegas". |
| `tests/secretos.spec.js` | Red contra filtraciones (el repo es público): toda llave JWT del repositorio es la pública (`anon`) del proyecto; ninguna llave secreta, cadena de conexión con clave, clave privada ni token; ningún respaldo o export con datos reales (salvo el catálogo `Menu/platos.xlsx`). |
| `tests/aviso-enlace.spec.js` | El enlace viejo (`Contabildad/`) avisa que el enlace cambió, muestra el nuevo con un botón, y a los 8 segundos (ni antes ni después) lleva allá; las dos páginas del aviso son idénticas; el enlace permanente sigue llevando al sistema. |
| `tests/python/test_rls.py` | **La seguridad contra un Postgres de verdad:** aplica `sql/rls_seguridad.sql` en una base desechable que imita a Supabase y comprueba, para 9 perfiles (admin, caja, respaldo, sin rol, rol inventado, rol en `user_metadata`, llave pública…) × 17 tablas × 5 operaciones, que se cumple EXACTAMENTE la matriz; que las vistas no se saltan las reglas; que aplicar dos veces es seguro y que el rollback deja todo como estaba. Si no hay PostgreSQL instalado, se salta sola. |
| `tests/python/test_esquema.py` | **La consulta de esquema y su conversión a SQL, en un Postgres de verdad:** que la consulta sea de solo lectura y no traiga datos; que armar una base nueva con el SQL generado dé exactamente el mismo esquema (columnas, llaves, índices, funciones, vistas, disparadores…); que las reglas viejas no se copien y todo quede cerrado (RLS); que sea repetible; que los datos pasen idénticos como JSON; casos raros (nombres reservados, columnas calculadas, secuencias sueltas…). |
| `tests/python/test_restaurar.py` | **El script de restauración por internet, contra un Supabase falso:** simulacro sin escribir; carga en orden y en tandas con números exactos; verificación fila por fila; rechazos (respaldo cortado o incompleto, destino con datos, llave pública, proyecto de producción, tabla o columna faltante); se detiene ante errores; **nunca imprime la llave**. |
| `tests/python/test_respaldo_a_sql.py` | **La restauración sin llaves (archivos SQL):** se aplican en un Postgres real y los datos quedan idénticos (incluidos textos difíciles); todo-o-nada por archivo; se niega si el destino tiene datos; contadores automáticos; comprobación final; no escribe dentro del repo. |
| `tests/python/test_cobertura_esquema.py` | Que el esquema completo cubra las 16 tablas y las columnas que el sistema usa, y que funcione junto con las reglas de acceso. Se salta lo del archivo real mientras `sql/esquema_completo.sql` no exista. |
| `tests/python/test_motor.py` | El motor del modelo financiero corre en modo demo sin errores, genera el Excel esperado y no deja archivos dentro del repo. |

Ayudas (no son pruebas): `tests/python/pgtemporal.py` (un Postgres desechable), `tests/python/postgrest_falso.py` (un Supabase falso para el script de restauración), `tests/python/esquema_ejemplo.sql` y `esquema_raros.sql` (esquemas inventados), `tests/helpers/backend-falso.js` (el Supabase falso: base **y** Auth con usuarios
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
