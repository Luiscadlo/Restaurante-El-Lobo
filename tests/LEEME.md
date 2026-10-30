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
| `tests/secretos.spec.js` | Red contra filtraciones (el repo es público): toda llave JWT del repositorio es la pública (`anon`) del proyecto; ninguna llave secreta, cadena de conexión con clave, clave privada ni token; ningún respaldo o export con datos reales (salvo el catálogo `Menu/platos.xlsx`). |
| `tests/enlace-viejo.spec.js` | **Los enlaces de entrada van directo al sistema:** el permanente (raíz) y el viejo (`Contabildad/`, con «d») redirigen al instante, sin pantalla de aviso ni cuenta regresiva, conservando `?` y `#`; las dos páginas del enlace viejo son idénticas. |
| `tests/auditoria-filtro.spec.js` | **Auditoría, filtro por día:** Hoy/Ayer/Semana/Mes/Todo y rango «desde – hasta» (un día = elegir solo una fecha); los ajustes se ubican por la fecha del cierre y los eliminados/descuentos por el día local en que se hicieron (incluye casos que cruzan la medianoche UTC); cartelitos de «sin … en ese día»; el numerito de la pestaña no da por vistos los registros que el filtro esconde. |
| `tests/abonos-fiado.spec.js` | **Eliminar un abono de fiado** (solo administrador): la secuencia real de un abono hecho por error (abono → ↩ → cancelar el pedido) deja el saldo a favor visible en Fiados y en el cierre hasta que el administrador lo elimina; no se puede eliminar un abono con el que se saldó un pedido (hay que devolverlo con ↩ antes); si el abono está en un cierre guardado se abre «Corregir cierre»; caja no ve el botón. |
| `tests/restaurar-desde-sistema.spec.js` | **Los botones «Restaurar desde un respaldo» y «Empezar de cero» (pantalla, contra el backend falso):** solo el administrador los ve y los puede usar; la nota del `.json` original; rechazo de archivos que no son el respaldo (Excel, `.txt`, roto, vacío, otra versión, conteos alterados, filas borradas, tabla ajena o faltante, más de 100 MB) sin llamar a la base; resumen «ahora vs respaldo»; palabra exacta + contraseña; orden contraseña → copia previa descargada → la base; todo-o-nada ante fallas (contraseña, copia, rechazo, función no instalada, tiempo, conexión cortada, 500/502); doble clic = una sola vez; la contraseña no viaja ni se guarda; el texto del servidor nunca se interpreta como HTML; «Empezar de cero» (cartel, BORRAR TODO, casilla del inventario, mesas libres); que las listas de tablas de la pantalla y del SQL no se desincronicen. |
| `tests/respaldo-restaurable.spec.js` | **Del botón a la restauración:** baja el respaldo real de «Datos → Respaldo completo» (con datos de ejemplo) y se lo pasa a `herramientas/respaldo_a_sql.py`: debe aceptarlo, contar las mismas tablas y filas y generar el SQL; y si el archivo se altera (una fila menos que su conteo) la herramienta se niega. Así, si cambia el formato del respaldo, se nota antes de necesitarlo. |
| `tests/aviso-saldo-a-favor.spec.js` | **Aviso de saldo a favor al dejar un fiado a nombre de un cliente** (los TRES lugares: Pedidos → «Fiar», Pendientes → «📒 Fiar» y Fiados sin cliente → «Asignar»): si el saldo alcanza para pagar el pedido completo, pregunta y, al aceptar, lo salda sin sumar plata a ningún cierre (del más viejo al más nuevo, completos); si no alcanza, solo avisa; sin saldo no dice nada; un pedido de mesa o pagado al instante (sin «Fiar», sin cliente) no toca el saldo, aunque haya quedado un cliente elegido; un error al aplicar no estropea el fiado ya guardado; con caja y con admin. **También el aviso verde DENTRO del formulario de Pedidos** (al elegir el cliente de «Fiar»: cuánto tiene a favor y si alcanza para este pedido; cambia con el pedido, la cantidad y el descuento; desaparece al quitar el cliente o cambiar de tipo de pedido) **y la pregunta con ventana propia** (botones con nombre, no Aceptar/Cancelar; un cliente no tiene a la vez «cuenta de saldo» y «cuenta de fiado»: si el saldo alcanza, el fiado se descuenta): con «Registrar pedido como pendiente» y un cliente de «Fiar» cuyo saldo alcanza para algún pedido completo, pregunta ANTES de guardar con DOS botones: «✔ Usar saldo a favor» (se paga con el saldo, sin plata nueva en caja) o «Volver» (no se registra nada; Esc hace lo mismo y un clic fuera no cierra); con «Pagado inmediatamente» (si el saldo alcanza para ese pedido) TRES: «✔ Pagar con saldo a favor» · «💵 Cobrar normal» (entra a caja, el saldo no se toca) · «Volver»; si el saldo no alcanza, solo avisa; en Pendientes→Fiar y Fiados→Asignar la pregunta también sale antes de mover/asignar (Usar saldo / Volver). La tarjeta de Fiados muestra bajo el neto la cuenta («$14.000 en pedidos − $20.000 a favor»). |
| `tests/saldo-a-favor.spec.js` | **Formulario «Registrar saldo a favor»** (pestaña Fiados): un cliente que paga de más sin deber nada (de la lista o nombre nuevo, sin duplicar uno existente aunque cambien tildes/mayúsculas); el abono entra al cierre del día/turno en su cuenta (efectivo o transferencia); validaciones sin escribir nada; con deuda se comporta como abono normal; el saldo se gasta con «Aplicar saldo a favor» sin meter plata nueva; si el cierre ya estaba guardado, pide confirmar y abre «Corregir cierre»; el administrador puede eliminar el abono y caja no ve el botón. |
| `tests/antiguedad.spec.js` | **Indicadores de antigüedad:** chip de color en cada cliente de Fiados según su pedido pendiente más viejo (verde < 8 días, amarillo 8, naranja 15, rojo 25 o de un mes anterior), chips en Pendientes («de ayer», tiempo abierto), borde rojo en el mapa del salón y la alerta del Tablero «N fiado(s) con 15 días o más sin pagar»; no cambia el orden de la lista. |
| `tests/menu-publicado.spec.js` | **La pestaña Menú no se queda en blanco:** el generador al que apunta el iframe existe, git lo rastrea y `.gitignore` no lo excluye; el resto de `Menu/` (plantilla, tipografías, presentación) sí queda fuera del repositorio. |
| `tests/ojo-clave.spec.js` | **Ojito de la contraseña** (pantalla de entrada): empieza oculta; el botón la muestra/oculta sin perder lo escrito, con ratón y teclado (Tab, Espacio, Enter) y con etiquetas para lector de pantalla; no envía el formulario; con la clave visible se entra igual y, al entrar, vuelve a oculta y vacía; si la clave estaba mal sigue visible para corregirla; el botón cabe dentro del campo sin tapar el texto ni «Entrar» (celular y computador). |
| `tests/cierre-otro-dia.spec.js` | **Cierre de un día anterior:** caja ve solo el aviso «sal e ingresa como administrador» (ni «Corregir cierre» ni «Abrir turno», que siempre abre el turno de hoy); el administrador ve «✏️ Editar turno» y al pulsarlo se abre la edición; con el cierre de hoy siguen «Corregir cierre» y «Abrir turno»; los rótulos se actualizan al cambiar de fecha. |
| `tests/cierre-dia-de-negocio.spec.js` | **Cierre y «día de negocio» (9:00 a. m., como el candado de la base):** la pantalla calcula el mismo día que la base (8:59:59 vs 9:00); a las 00:30 caja sigue pudiendo ver y corregir la cena del día anterior (sin «Abrir turno»), y desde las 9:30 ya no (solo aviso de administrador, sin formulario ni botones); un día anterior sin cierre también se muestra bloqueado; el calendario de caja tiene como mínimo el día de negocio (y se actualiza al pasar las 9:00 sin recargar) y el del administrador no tiene límite; hoy y fechas futuras se trabajan normal; descuento a un pedido ya cobrado: cuenta la fecha de cobro. |
| `tests/copia-pruebas.spec.js` | **La copia de pruebas abierta de verdad** (con el Supabase falso): se ve el cartel rojo y el título de PRUEBAS (el sistema real no los tiene); habla SOLO con el proyecto de pruebas (cero peticiones a producción); la sesión guardada de producción ni se usa ni se borra y la de la copia se guarda con otro nombre; caja y administrador entran y cargan los datos sin errores; la franja roja deja pasar los clics; **la pestaña Menú de la copia en «archivo único»** (suelto, sin carpeta `Menu/` al lado): carga el Menú, guarda su catálogo, «Abrir en pestaña aparte» lo abre y no hay ningún archivo local "no encontrado"; la copia en carpeta sigue cargando el Menú por su ruta. |
| `tests/candado-reglas.spec.js` | **Candado de días (pantalla):** los ~100 casos compartidos de `tests/fixtures/candado_casos.json` contra la copia en JS de la regla (`tests/helpers/candado.js`); el cambio de día a las 9:00 a. m. de Bogotá; el mensaje de rechazo (sale del propio SQL); y el sistema real con el candado puesto: caja no puede tocar el cierre ni los gastos de ayer (y el aviso sale una sola vez), el administrador sí, la cena de anoche se opera a las 12:30 a. m. y a las 9:30 ya no, y los flujos delicados de días viejos (cobrar un fiado viejo y deshacerlo, agregar un producto a un pendiente de ayer, abonar, cobrar el domicilio de ayer) siguen funcionando. |
| `tests/python/test_rls.py` | **La seguridad contra un Postgres de verdad:** aplica `sql/rls_seguridad.sql` en una base desechable que imita a Supabase y comprueba, para 9 perfiles (admin, caja, respaldo, sin rol, rol inventado, rol en `user_metadata`, llave pública…) × 17 tablas × 5 operaciones, que se cumple EXACTAMENTE la matriz; que las vistas no se saltan las reglas; que aplicar dos veces es seguro y que el rollback deja todo como estaba. Si no hay PostgreSQL instalado, se salta sola. |
| `tests/python/test_candado_dias.py` | **El candado de días contra un Postgres de verdad:** cada caso de `candado_casos.json` (hoy/ayer/antier, medianoche, las 9:00, fin de mes, fiados viejos, deshacer pagos, agregar productos…) en las 7 tablas y los 3 cambios (crear, cambiar, borrar); administrador y llave de servicio sin candado; el mensaje (código 42501 = 403, no 401; fecha; pista de las 9:00); que no choque con los avisos de «columna que falta»; la prueba de comprobación de la guía de despliegue; seguro dos veces; no deja nada a medias si falla; el rollback lo quita. Las mismas reglas las corre la prueba de pantalla de arriba: si el SQL y la copia en JS se apartan, una de las dos falla. |
| `tests/python/test_esquema.py` | **La consulta de esquema y su conversión a SQL, en un Postgres de verdad:** que la consulta sea de solo lectura y no traiga datos; que armar una base nueva con el SQL generado dé exactamente el mismo esquema (columnas, llaves, índices, funciones, vistas, disparadores…); que las reglas viejas no se copien y todo quede cerrado (RLS); que sea repetible; que los datos pasen idénticos como JSON; casos raros (nombres reservados, columnas calculadas, secuencias sueltas…). |
| `tests/python/test_restaurar_desde_sistema.py` | **Las dos funciones de los botones, contra un Postgres de verdad** (`sql/restaurar_respaldo.sql`): el administrador restaura y queda IDÉNTICO al archivo (cifras exactas, textos difíciles, nulos, contadores de `id`, orden de las llaves foráneas); dos veces seguidas no duplica; respaldo viejo sin `config`/`pedidos_descuentos`; 12 clases de archivo malo dejan la base idéntica (todo-o-nada, también si falla a mitad de la carga); solo el administrador puede (caja, respaldo, sin rol, llave pública y el truco de `user_metadata` quedan fuera) y con la palabra exacta; «Empezar de cero» (mesas libres, inventario según el parámetro, usuarios intactos); bitácora; un respaldo de 12 000 pedidos dentro del límite de 8 s; instalar dos veces y deshacer; que las listas de tablas coincidan con la pantalla. |
| `tests/python/test_restaurar.py` | **El script de restauración por internet, contra un Supabase falso:** simulacro sin escribir; carga en orden y en tandas con números exactos; verificación fila por fila; rechazos (respaldo cortado o incompleto, destino con datos, llave pública, proyecto de producción, tabla o columna faltante); se detiene ante errores; **nunca imprime la llave**. |
| `tests/python/test_copia_pruebas.py` | **La herramienta de la copia de pruebas (réplica):** la copia cambia SOLO lo previsto (dirección y llave públicas, nombres de almacenamiento, título, carteles) y, al deshacerlo, queda idéntica al sistema real; no deja rastro de producción; se niega —sin escribir nada— ante llave de servicio/secret, llave de otro rol, de otro proyecto, vencida o con otro formato, direcciones raras, proyecto de producción y carpeta de salida dentro del repositorio. **Modo «archivo único»:** el Menú va incrustado y se recupera idéntico (también con `</script>`, `<!--`, comillas y saltos raros dentro del Menú); no queda ninguna referencia a `../Menu/`; lo demás es idéntico a la copia en carpeta; escribe un solo archivo; se niega si el Menú menciona producción, si el sistema cambió cómo carga el Menú, si falta el Menú o si el destino no es `.html` / está dentro del repositorio; por línea de comandos exige elegir carpeta **o** archivo único. |
| `tests/python/test_respaldo_a_sql.py` | **La restauración sin llaves (archivos SQL):** se aplican en un Postgres real y los datos quedan idénticos (incluidos textos difíciles); todo-o-nada por archivo; se niega si el destino tiene datos; contadores automáticos; comprobación final; no escribe dentro del repo. |
| `tests/python/test_cobertura_esquema.py` | Que el esquema completo cubra las 16 tablas y las columnas que el sistema usa, y que funcione junto con las reglas de acceso. Se salta lo del archivo real si `sql/esquema_completo.sql` no existe. |
| `tests/python/test_ensayo_esquema_real.py` | **Ensayo de restauración con tu esquema real:** carga los datos de ejemplo de las pruebas de pantalla (`tests/fixtures/datos.js`) en las tablas reales (mismas columnas, tipos y reglas de valores), saca el respaldo, lo convierte en SQL, lo restaura en una base nueva y comprueba que queda idéntico; luego lo repite sobre lo restaurado. Si una prueba «inventa» una columna o un valor que la base real rechaza, aquí se nota. Se salta si no hay `sql/esquema_completo.sql` o falta Node. |
| `tests/python/test_motor.py` | El motor del modelo financiero corre en modo demo sin errores, genera el Excel esperado y no deja archivos dentro del repo. |
| `tests/python/test_motor_funciones.py` | Descuentos y abonos de fiado en el motor, con datos inventados y cuentas a mano: ingreso por cierre (sin contar los abonos dos veces), desglose de ingresos sin pedido, fiados saldados con abonos, descuentos informativos, cuentas por cobrar, un Excel exportado de mentira de punta a punta y el libro generado (si hay LibreOffice, también recalcula las fórmulas). |

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
