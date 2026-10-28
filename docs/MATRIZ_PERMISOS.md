# Matriz de permisos — quién puede hacer qué

> **Estado: las 3 decisiones están tomadas** (25-oct: 1 = A, 2 = A, 3 = B, el candado de días en el servidor; detalle más abajo). El candado de días se activa corriendo `sql/candado_dias.sql` (Paso 6b de `docs/DESPLIEGUE_SEGURIDAD.md`).
> La fuente única de esta matriz, en formato máquina, es `sql/matriz_permisos.json`: de ahí salen el SQL de Supabase (`sql/rls_seguridad.sql`), las pruebas web y las pruebas contra Postgres. Si cambias una decisión, cambia el JSON, corre `python herramientas/generar_rls.py` y actualiza esta tabla. El despliegue está en `docs/DESPLIEGUE_SEGURIDAD.md`.

## En una frase

Cada persona entra con **su** usuario. Hay tres roles: **admin** (los dueños, cada uno con su usuario), **caja** (un usuario compartido del mostrador) y **respaldo** (solo para la copia semanal automática; no entra a la pantalla). El servidor (Supabase) es quien hace cumplir los permisos; lo que se esconde en pantalla es solo comodidad.

## Qué puede hacer cada rol en cada tabla

*Ver = leer · Crear · Cambiar · Borrar. "Todo" = las cuatro.*

| Tabla (qué guarda) | Admin | Caja | Respaldo |
|---|---|---|---|
| `pedidos` (ventas y pendientes) | Todo | Todo | Ver |
| `mesas` | Todo | Ver y cambiar (ocupada/libre) | Ver |
| `clientes_fiado` | Todo | Ver y crear | Ver |
| `abonos_fiado` | Todo | Ver y crear | Ver |
| `inventario` | Todo | Todo | Ver |
| `consumos` | Todo | Ver y crear | Ver |
| `gastos_dia` (gastos del turno) | Todo | Todo | Ver |
| `cierres_dia` | Todo | Todo | Ver |
| `aperturas_turno` | Todo | Ver, crear y cambiar | Ver |
| `notas_dia` | Todo | Ver, crear y borrar | Ver |
| `config` (aviso de respaldo) | Todo | Solo ver | Ver |
| `pedidos_eliminados` (rastro de lo borrado) | Todo | **Solo agregar** (no puede leer, cambiar ni borrar el rastro) | Ver |
| `pedidos_descuentos` (rastro de descuentos) | Todo | **Solo agregar** | Ver |
| `egresos` | Todo | **Nada** | Ver |
| `movimientos_caja` | Todo | **Nada** | Ver |
| `ingresos_extra` | Todo | **Nada** | Ver |

**Candado de días:** en `pedidos` (lo ya cobrado), `cierres_dia`, `gastos_dia`, `aperturas_turno`, `notas_dia`, `abonos_fiado` y `consumos`, caja solo puede crear, cambiar o borrar registros de **hoy** (el día cambia a las 9:00 a. m., hora de Bogotá). Ver «Candado de días» más abajo.

Además: **sin sesión no se puede nada** (la llave pública que va en la página deja de abrir la base).

## Qué ve cada uno en pantalla

- **Caja:** Pedidos, Pendientes, Fiados, Cierre (Día a día), Inventario y Menú. Las secciones de dueño (Tablero, Ingresos, Egresos, Caja, Auditoría, Datos) **no aparecen** con caja; tampoco aparece **nada** de administrador dentro de sus pestañas: ni el **Respaldo completo** ni el **Excel** (viven en la pestaña Datos), ni el **Cierre manual**, ni el **Historial completo de cierres**, ni el aviso de respaldo, ni cajitas de usuario y contraseña. En **Cierre**, un día anterior al día de negocio en curso aparece **bloqueado** para caja (haya cierre guardado o no): solo dice «sal e ingresa como administrador» para verlo o corregirlo, sin formulario ni botones, y el calendario del selector de fecha no deja escogerlo; al administrador no se le limita nada y, sobre un cierre de un día anterior, le aparece «✏️ Editar turno».
- **Ver las secciones de dueño o usar sus funciones:** pulsar **Salir** y entrar como administrador. Ya no hay candados con usuario y contraseña a la vista dentro de las pestañas de caja.
- **Admin entrando directo:** todo abierto; no se recuerda (al recargar hay que volver a entrar).
- **Caja entrando directo:** se recuerda en ese equipo para no pedir la clave en cada recarga. "Salir" la borra.

## Decisiones (todas tomadas el 25-oct)

**1. ¿Caja puede eliminar pedidos YA COBRADOS?** → **Sí (opción A, como hoy).** Si el empleado se equivoca puede corregirlo en el mostrador; cada eliminación queda en Auditoría y caja no puede borrar ni leer ese rastro. Tú revisas Auditoría (al autorizarte, la pestaña muestra cuántas novedades hay desde la última vez; con el usuario de caja ese numerito no se ve).
- *(B, descartada: solo admin elimina cobrados. Más estricto, pero obligaría a pedir autorización cada vez que haya que corregir un error en el mostrador.)*

**2. Descuentos y el gasto "Otro" de Egresos.** → **Opción A.** Al aplicar un descuento, el sistema ofrece borrar el gasto "Otro" que alguien anotó a mano para compensarlo (para no contarlo doble). Caja ya no puede ver `egresos` (es finanzas), así que **solo le ofrece los gastos "Otro" del cierre del turno**, no los de la pestaña Egresos. Si un descuento se anotó en Egresos, lo corrige un admin.
- *(B, descartada: dejar que caja lea `egresos`, y entonces vería todos los gastos del negocio.)*

**3. Cambios en días anteriores.** → **Opción B: lo exige el servidor.** La pantalla ya le pedía administrador a caja para corregir cierres o pedidos de otros días, pero eso era solo de pantalla: quien supiera manipular la página con el usuario de caja podía tocar datos pasados. Ahora la base de datos lo rechaza (ver «Candado de días» abajo; se activa corriendo `sql/candado_dias.sql`, Paso 6b de `docs/DESPLIEGUE_SEGURIDAD.md`).
- *(A, descartada: dejarlo solo en pantalla y revisarlo tras una semana de operación.)*

## Candado de días (lo exige el servidor)

**Idea simple:** el usuario `caja` solo puede cambiar lo de **hoy**. Si algo es de un día anterior (un cierre, un gasto, una apertura, un pedido ya cobrado…), la base de datos lo **rechaza con un aviso claro** («Caja solo puede cambiar lo de hoy. Este registro es del 19/10/2026: pídele el cambio al administrador.»), no lo ignora en silencio. El administrador, el usuario de respaldo y las herramientas de restauración **no tienen candado**.

**Qué es «hoy»:** el día de negocio en hora de Bogotá. El día **cambia a las 9:00 a. m.**, no a medianoche, porque la cena puede terminar pasada la medianoche y se sigue registrando y cerrando con la fecha del día en que empezó. Ejemplo: a las 12:30 a. m. del 21 todavía es «hoy 20»; a las 9:00 a. m. del 21 ya es «hoy 21» y lo del 20 queda cerrado para caja. Solo se mira hacia el pasado: fechas de hoy o futuras no se bloquean.

| Tabla | Lo que caja NO puede hacer con registros de días anteriores |
|---|---|
| `cierres_dia`, `gastos_dia`, `aperturas_turno`, `notas_dia`, `abonos_fiado`, `consumos` | Crearlos, cambiarlos ni borrarlos. Tampoco *mover* un registro de hoy hacia el pasado ni traer uno viejo a hoy. |
| `pedidos` **ya cobrados** | Cambiarlos ni borrarlos (si el cobro fue en un día anterior), ni crear un pedido cobrado con fecha anterior, ni mover su fecha o su fecha de cobro al pasado. |
| `pedidos` **pendientes** (mesas, domicilios, fiados) | **Sí puede** cobrarlos, editarlos, cancelarlos o agregarles productos aunque sean de días atrás (así se cobra un fiado viejo). Al cobrarlos, el pedido pasa a ser de hoy, y «↩ Deshacer» le devuelve su fecha original. |

**En pantalla (Cierre):** la pantalla usa el mismo «día de negocio» (reloj del equipo menos 9 horas). Para caja el calendario de **Fecha a cerrar** tiene como mínimo ese día y un día anterior se muestra bloqueado; por eso, después de medianoche, caja sigue pudiendo escoger el día anterior para cerrar la cena (y hasta las 8:59 a. m. «Corregir cierre» funciona con él), pero desde las 9:00 a. m. ese día ya es de administrador. Lo mismo vale para aplicar un descuento a un pedido ya cobrado (cuenta la fecha de cobro, como en la base). Esto es comodidad: lo que realmente protege los datos es la base. Pantalla y base usan el mismo criterio (hay una prueba que lo compara a las 8:59:59 y a las 9:00).

**Lo que SÍ sigue funcionando en el mostrador** (probado en `tests/candado-reglas.spec.js` y contra un Postgres de verdad): cobrar un fiado de hace semanas, abonar y saldar fiados antiguos, agregar un producto a un fiado/mesa pendiente de ayer, cancelar un pendiente viejo, registrar pedidos y cerrar la cena después de medianoche (hasta las 8:59 a. m.), y leer cualquier día (ver el historial, consultar un cierre pasado).

**Limitaciones aceptadas (poco frecuentes; resolverlas toma un minuto con el administrador):**
- **Cena sin cerrar pasadas las 9:00 a. m.:** si al día siguiente, ya después de las 9:00, falta registrar o cerrar algo de la cena de anoche, caja no puede; lo hace el administrador.
- **«↩ Deshacer» de un pendiente viejo ya cobrado hoy:** si se cobra hoy un domicilio o mesa pendiente de ayer y se intenta deshacer el cobro, queda cobrado en un día cerrado y caja ya no puede devolverlo a pendiente (con fiados sí se puede: recuperan su fecha original). El sistema muestra el aviso del candado.
- **Pendientes con fecha vieja:** un pedido pendiente puede conservar su fecha de días atrás (así funciona un fiado). Eso es intencional: en cuanto se cobra, pasa a ser de hoy.
- **Fecha de la pantalla vs. reloj del servidor:** el candado usa el reloj del servidor (hora de Bogotá), no el del celular o computador del mostrador; si ese equipo tiene la hora mal, el servidor manda (la pantalla puede mostrar o esconder un día de más, pero la base decide siempre).
- **Fecha por defecto de Cierre y Pedidos:** al abrir el sistema esas fechas empiezan en el día del calendario (cambia a medianoche). Si se recarga la página pasada la medianoche, para cerrar la cena hay que escoger la fecha de ayer en el calendario (caja sí puede, hasta las 8:59 a. m.).

**Para verificarlo (además de las pruebas automáticas):** ver «Paso 6b» en `docs/DESPLIEGUE_SEGURIDAD.md`. Para quitarlo: `sql/rollback_candado.sql` (deja todo como antes del candado).

## Otras cosas que conviene que sepas

- Caja **puede leer** `pedidos` y `cierres_dia`, así que alguien técnico con esa cuenta podría consultar todas las ventas históricas (no compras, gastos ni caja). Es inevitable si el mostrador cobra y cierra turno.
- El encabezado ya no tiene botones de **Exportar** ni de **Importar**: el respaldo completo (.json) y el Excel están en la pestaña **Datos** (solo administrador). La función de **importar** (formato viejo, limitada y con errores silenciosos) se **eliminó**; restaurar se hace con la tarjeta **«Restaurar desde un respaldo»** de la misma pestaña Datos (o, para el ensayo estricto, con `herramientas/restaurar_respaldo.py`; ver `docs/RESTAURAR.md`).
- **Restaurar y «Empezar de cero» son solo del administrador, y lo exige la base:** las dos funciones (`public.lobo_restaurar_respaldo` y `public.lobo_empezar_de_cero`, de `sql/restaurar_respaldo.sql`) rechazan a `caja`, `respaldo`, usuarios sin rol, la llave pública y quien ponga el rol en `user_metadata` (solo vale `app_metadata`). Además exigen la palabra de confirmación (`RESTAURAR` / `BORRAR TODO`) en la propia llamada. Están fuera de la matriz de tablas (no dan acceso a ninguna tabla por sí mismas) y una prueba vigila que ningún rol salvo `authenticated` pueda ejecutarlas.
- **Eliminar un abono de fiado** (botón 🗑 en Fiados) es solo de administrador; la base ya limitaba ese borrado a admin.
- El usuario `respaldo` es solo lectura. La tarea semanal automática de respaldo (que corría con la llave pública) se **eliminó** al activar las reglas: el respaldo es a mano cada domingo desde **Datos → Respaldo completo**, y el aviso lo recuerda hasta que se haga (solo lo ve el administrador). El usuario `respaldo` queda disponible por si algún día se quiere automatizar.
- Nada más en el repositorio usa la base: el Menú del día no la toca.
