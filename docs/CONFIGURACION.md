# ⚙️ Configuración del negocio (etapas 1 a 4 y el interruptor del cierre del día)

Pestaña **⚙️ Configuración** — solo el administrador. Aquí se cambian los valores que antes estaban escritos a mano en el
código. La **etapa 1** (nombre, mesas, recargos, respaldo) y la **etapa 2** (🍽️ **Productos y precios**, más abajo) viven en
la misma tabla y la misma pantalla; igual la **etapa 3** (📋 **Platos del menú**, más abajo), la **etapa 4** (🧾 **Egresos y cuentas**, más abajo) y el interruptor 🍽️ **Cierre del día** (¿se piden las comidas de la familia?, más abajo). Las siguientes se suman igual.

## Regla de oro

> **Un cambio rige desde el momento en que se guarda y nunca toca el pasado.**

- Los pedidos y los cierres **ya guardan sus montos**: cambiar el recargo de «para llevar» no recalcula ningún pedido hecho.
- Cada cambio es **una fila nueva** con su «vigente desde» (la hora del servidor). Nada se edita ni se borra: el historial
  completo queda a la vista al final de la pestaña, con quién lo hizo.
- La única vez que el sistema mira la historia es al **editar un pedido viejo**: usa el recargo que regía cuando se hizo,
  no el de hoy (así corregir una cantidad de ayer no cambia el precio de ayer).
- **Sin nada guardado, el sistema funciona exactamente como siempre** (valores de El Lobo). Si la tabla todavía no existe en
  Supabase pasa lo mismo, y la pestaña avisa que falta instalarla.

## Qué se puede cambiar

| Valor | Qué hace | Rango | De siempre |
|---|---|---|---|
| Nombre del negocio | Arriba en la pantalla y en el título de la pestaña del navegador | 1–40 letras, sin espacios al inicio ni al final | El Lobo |
| Símbolo (emoji) | Va junto al nombre; puede quedar vacío | hasta 8 caracteres | 🐺 |
| Número de mesas | Cuántas mesas se dibujan (salón, mapa, «cambiar de mesa») | 1–60 | 8 |
| Recargo «para llevar» | Pesos que se suman a cada almuerzo para llevar (mesa o sin mesa) | $0–$50.000 | $1.000 |
| Empaque de domicilio | Pesos por cada almuerzo a domicilio (la comida rápida no lo cobra) | $0–$50.000 | $1.000 |
| Cada cuánto se hace el respaldo | **Semanal:** el aviso aparece desde el día elegido de cada semana. **Mensual:** desde el último día de cada mes (lo ideal: hacerlo ese día al cerrar la noche, o el primero del mes antes de abrir). **Trimestral:** desde el último día de marzo, junio, septiembre y diciembre. En todos los casos el aviso se apaga solo con un respaldo completo hecho desde ese día | semanal · mensual · trimestral | semanal |
| Día del respaldo semanal | Solo cuenta si la frecuencia es semanal: el aviso aparece desde ese día y sigue hasta que haya un respaldo completo hecho desde entonces | domingo … sábado | domingo |
| Días para el aviso rojo | Con tantos días sin respaldo completo, el aviso se pone rojo. Nunca antes de 7 días (semanal), 35 (mensual) o 100 (trimestral), aunque el número escrito sea menor. Al elegir la frecuencia, este número se ajusta solo al sugerido y no deja guardar uno menor que el mínimo de esa frecuencia (más alto sí) | 7–400 | 10 (semanal) · 35 (mensual) · 100 (trimestral) |

La pantalla de **entrada** (antes de iniciar sesión) siempre dice «El Lobo»: todavía no hay sesión para leer la configuración.

## Cómo se usa

1. Entra como administrador → pestaña **⚙️ Configuración**.
2. Cada valor muestra «**Hoy:** … · desde cuándo · por quién». Escribe el nuevo valor: el botón **Guardar** se enciende solo
   cuando es distinto del que rige.
3. Al guardar, el sistema pregunta mostrando «Hoy → Nuevo» y recuerda que rige desde ahora y no cambia lo ya vendido.
4. Listo: la pantalla se actualiza y el cambio queda en el **Historial de cambios**.
5. Los **demás equipos** (por ejemplo el celular de caja) toman el cambio al **recargar la página**.

### Mesas

- **Subir** el número: si faltan filas en la tabla `mesas`, el sistema las crea (libres) **antes** de guardar el cambio.
- **Bajar** el número: se niega mientras haya **pedidos pendientes** en las mesas que se quitarían. Cóbralos, muévelos o ciérralos y vuelve a intentar.

### Lo que la base no deja guardar

Aunque alguien se saltara la pantalla, la base de datos vuelve a exigir las mismas reglas: una clave que no existe, un valor
fuera de rango o de otro tipo (mesas = −3, nombre vacío…), una fecha inventada o un autor inventado se rechazan. La fecha
(«vigente desde») y quién lo hizo **los pone la base**, no el sistema; por eso nadie puede reescribir la historia.

## Permisos

| Rol | Ver | Agregar un cambio | Modificar o borrar |
|---|---|---|---|
| Administrador | ✅ | ✅ | ❌ (nadie) |
| Caja | ✅ (necesita saber las mesas, el recargo…) | ❌ | ❌ |
| Respaldo | ✅ | ❌ | ❌ |
| Sin rol / llave pública | ❌ | ❌ | ❌ |

(Fuente: `sql/matriz_permisos.json`. La tabla `configuracion` es de las pocas que **no** admiten modificar ni borrar.)

## Instalación (una sola vez)

> Siempre **primero en Lobo-Pruebas**, y en producción solo cuando el restaurante no esté en servicio.

1. Supabase → **SQL Editor** → pega y corre `sql/configuracion.sql`. Se ejecuta en una sola transacción (si algo falla no
   queda nada a medias) y es seguro de correr dos veces. Al final muestra una fila de verificación:
   `tabla = 1 · rls_activo = true · politicas = 2 · disparador = 1 · anon_con_permisos = false`.
2. Corre también la versión actualizada de `sql/restaurar_respaldo.sql` (para que «Restaurar» y «Empezar de cero» conozcan la
   tabla nueva). Verificación esperada: `funciones = 2 · anon_puede_ejecutar = 0 · bitacora = 1`.
3. Proyectos **nuevos** (no es el caso de producción): `sql/esquema_completo.sql` + `sql/rls_seguridad.sql` ya incluyen la tabla y sus permisos; después corre `sql/configuracion.sql` para el disparador.
4. Publica la nueva versión del sistema (pull request → `main`). Hasta ese momento la tabla nueva no estorba: el sistema viejo ni la mira.

Para **deshacer**: `sql/rollback_configuracion.sql` quita la tabla, el disparador y las funciones (¡borra el historial de
configuración!; haz antes un «Respaldo completo»). El sistema vuelve a los valores de siempre.

## 🍽️ Productos y precios (etapa 2)

Tres tablas dentro de la misma pestaña. Cada una guarda el catálogo **completo** como una versión nueva (con «vigente desde»
y quién lo hizo); la versión anterior queda para siempre.

| Tabla | Qué contiene | Qué se puede hacer |
|---|---|---|
| ☀️ Almuerzos | Los 8 tipos de siempre (completo, seco, asado 130 g, asado 200 g, porción de sopa, porción de arroz, porción de proteína, sopa y arroz) | Cambiar **nombre** y **precio**, **retirar** o reactivar. **No** se crean tipos nuevos |
| 🌙 Comidas rápidas, bebidas y adicionales | Los 49 productos de siempre (perros, hamburguesas, asados, picadas, salchipapas, cubanos, arepas, suizos, adicionales y bebidas) | Cambiar nombre, precio o categoría; retirar o reactivar; **agregar productos nuevos**; una **categoría nueva** se crea escribiendo su nombre; hay buscador |
| ➕ Productos adicionales | La lista que autocompleta nombre y valor en «Agregar producto» de un pedido | Cambiar, retirar, agregar y quitar. Igual se puede escribir cualquier otro a mano |

Cómo se usa: escribe sobre la tabla (la fila cambiada se marca y aparece «N cambios sin guardar»), pulsa **Guardar cambios** de
esa tabla y confirma: la ventana lista, en palabras, cada cambio («Almuerzo Completo: $14.000 → $15.500», «🚫 Se retira: …»,
«➕ Nuevo: …»). **Descartar** deshace lo escrito sin guardar. Mientras escribes, nada se manda a la base.

**Reglas** (las exige la pantalla y, otra vez, la base de datos):
- Precio entero de **$100 a $500.000**. Nombre de 1 a 60 caracteres, sin espacios al principio ni al final y **sin** los caracteres `<` `>` `&` `"` `'` `\` ni la tilde invertida ni caracteres de control
  (los nombres se pintan en muchas pantallas: nada que parezca código). Los espacios dobles se arreglan solos.
- Categoría: 1 a 30 caracteres en MAYÚSCULAS (la pantalla las pasa sola). `BEBIDAS` alimenta el desplegable de bebida y `ADICIONALES`
  se vende con el precio escrito a mano en el pedido.
- Los productos **nunca se borran, se retiran**: la base exige que cada versión traiga todos los códigos de la anterior (y los de
  El Lobo). Así un pedido viejo siempre se puede mostrar. Un producto retirado deja de ofrecerse para vender, pero sigue
  existiendo (se puede reactivar). Debe quedar al menos un almuerzo y una comida rápida activos.
- Cada producto nuevo recibe un **código que no cambia nunca** (`X001`, `X002`…). Solo lo ve el administrador en esta tabla.
- Los adicionales no tienen código; el nombre no puede repetirse (sin importar mayúsculas).

**Qué cambia y qué no** (la regla de oro de arriba):
- Un precio nuevo rige para lo que se venda **desde que se guarda**. Lo ya vendido, cerrado o cobrado **no cambia**: cada pedido guarda su monto.
- Un **pedido pendiente** que ya estaba tomado y se edita después usa los **precios de cuando se tomó** (igual que el recargo de «para llevar»).
- Los pedidos y reportes muestran el **nombre actual** del producto (el código es el mismo). Un producto de una categoría nueva
  aparece en el Tablero con esa categoría.
- Si **otro administrador** guardó un cambio en el mismo catálogo mientras tú editabas, no se pisa su cambio: la pantalla se
  actualiza y hay que repetir lo tuyo sobre lo nuevo.
- Sin nada guardado todo se ve y cobra **exactamente igual que antes** (una prueba lo compara con la versión anterior). Los demás
  equipos toman el cambio al recargar la página.

**Instalación**: `sql/configuracion_etapa_2.sql` (después de la etapa 1; una transacción; seguro de repetir; no toca ningún dato).
Verificación esperada: `catalogos_instalados = true · disparador = 1 · anon_con_permisos = false`. Para deshacer:
`sql/rollback_configuracion_etapa_2.sql` (deja la base como al terminar la etapa 1; **no** borra los catálogos guardados).
Hasta que se instale, la pantalla muestra «falta instalar» y los botones quedan apagados.

**Lo que NO está en El Lobo**: ocultar secciones, horarios y turnos, y la plantilla de imagen del menú se dejan para una copia
del sistema pensada para otros tipos de negocio (fase 2).

## 🧾 Egresos y cuentas (etapa 4)

Dos paneles al final de la pestaña. Cada uno guarda su lista **completa** como una versión nueva (con «vigente desde» y quién la hizo).

### Categorías de egresos y gastos

Las categorías con las que se clasifican los gastos del cierre del día y los egresos. Las 7 de El Lobo (Nómina, Proveedores,
Arriendo, Servicios, Desechables, Otro y Préstamo) ya vienen; la persona puede **cambiar el nombre**, decidir **dónde se usa**,
**retirar** o reactivar, y **crear categorías nuevas**.

| Campo | Qué hace | Se puede cambiar |
|---|---|---|
| Código | Lo que guardan los gastos (`nomina`, `proveedor`… y `cat1`, `cat2`… para las nuevas) | Nunca |
| Nombre | Lo que se ve en listas, tablas, colores y reportes (1–40 caracteres, sin los signos de código de siempre, sin repetir) | Siempre |
| **Grupo** | En qué casilla de los reportes y del modelo financiero se suma: Nómina · Proveedores (insumos) · Arriendo y servicios · Desechables · Otros gastos · **No cuenta como egreso** | **Solo al crearla; después nunca** |
| Se usa | Solo en Egresos · solo en el cierre del día · en los dos. «No cuenta como egreso» solo va al cierre | Siempre |
| Estado | Activa o retirada | Siempre |

- **Por qué el grupo no cambia:** si una categoría pasara de «Otros» a «Nómina», todos los gastos que ya registraste se moverían
  de casilla y los reportes de meses cerrados cambiarían. La base de datos lo impide (y también que se borre una categoría).
- **«No cuenta como egreso»** es para plata que sale de la caja pero no es un gasto del negocio (como los préstamos): resta de
  la caja esperada del día, pero no entra a Egresos, al Tablero ni al modelo financiero.
- **Retirar** una categoría la quita de las listas para registrar, pero los gastos viejos la siguen mostrando (y al editarlos se
  puede conservar). El filtro del historial de Egresos sigue ofreciéndola como «(retirada)».
- Debe quedar al menos una categoría activa para Egresos y una para el cierre.
- Las **sumas** (Egresos, Ingresos financiero, Tablero, modelo financiero) siguen el **grupo**, no el nombre: una categoría
  nueva «Mantenimiento» de grupo *Otros gastos* suma en «Otros».
- Los nombres que ves son **siempre los de hoy**, también en gastos viejos; los montos y los códigos guardados no cambian.
- Mientras no cambies el nombre de una categoría de siempre, las listas de los formularios conservan su rótulo largo de
  siempre («Nómina de empleados», «Servicios públicos», «Préstamos (no cuenta como egreso)»).

### Nombres de las cuentas

Cómo se llaman las **3 cuentas** de la caja (efectivo y las dos de transferencia): símbolo (hasta 8 caracteres, puede quedar
vacío) y nombre (1–30, sin repetir). Las cuentas siguen siendo las mismas y **sus saldos no cambian**; aquí no se crean cuentas
nuevas. Mientras una cuenta conserve su nombre de siempre, las tarjetas de Caja conservan su rótulo largo
(«☀️ Transferencia — Almuerzos»).

### Cómo se usa, qué cambia y qué no

Igual que Productos y precios: escribe sobre la tabla (la fila cambiada se marca, «N cambios sin guardar»), **Guardar cambios** y
confirma la ventana que lo cuenta en palabras («Nombre: «Nómina» → «Sueldos»», «➕ Nueva categoría: Mantenimiento · Otros gastos ·
en Egresos y en el cierre», «🚫 Se retira: Otro»). **Descartar** deshace lo escrito. Si otro administrador cambió lo mismo mientras
tanto, no se pisa su cambio. Lo guardado rige desde ese momento en todo el sistema (sin recargar); los demás equipos lo toman al
recargar. **Sin nada guardado todo se ve y suma exactamente igual que antes** (una prueba lo compara con la versión anterior).

### Modelo financiero (Python)

El Excel de «Exportar a Excel» trae dos hojas nuevas: `Categorias_Egresos` (código, nombre, grupo, se usa, activa) y
`Nombres_Cuentas`. El generador del modelo lee el **grupo** de cada código para saber en qué rubro suma (Proveedores y
Desechables → insumos; Nómina; Arriendo y servicios; Otros; «No cuenta como egreso» se descarta). Un export viejo, sin la hoja,
usa las 7 de El Lobo. Un código que no esté en la hoja es «huérfano»: no se suma y se avisa por consola.

**Instalación**: `sql/configuracion_etapa_4.sql` (después de las etapas 1 y 2; una transacción; seguro de repetir; no toca ningún
dato). Verificación esperada: `categorias_instaladas = true · disparador = 1 · anon_con_permisos = false`. Para deshacer:
`sql/rollback_configuracion_etapa_4.sql` (deja la base como al terminar la etapa 2; **no** borra lo guardado). Hasta que se
instale, la pantalla muestra «falta instalar» y los botones quedan apagados.

## 📋 Platos del menú (etapa 3)

Un solo panel con **la lista de platos** del restaurante: sopas, arroces, proteínas, acompañamientos y asados. Esa lista la usan
**dos** cosas que antes tenían cada una su copia (y ya no coincidían): el **autocompletado de Pedidos** y el **generador de la
imagen del Menú**. Los 47 platos de El Lobo ya vienen; se pueden **crear**, **renombrar** y **retirar** (nunca se borran).

| Campo | Qué hace | Se puede cambiar |
|---|---|---|
| Código | Identifica el plato (`SP01` sopa, `AR01` arroz, `PT01` proteína, `AC01` acompañamiento, `AS01` asado; los nuevos siguen la numeración) | Nunca |
| Lista | A cuál de las 5 listas pertenece | Solo al crearlo |
| Nombre | Lo que se ve en el autocompletado, el Menú y los reportes (1–50 caracteres, sin los signos de código de siempre; no se repite dentro de su lista; proteínas y asados cuentan como una sola lista para esto) | Siempre |
| Estado | Activo o retirado | Siempre |

- **Retirar** un plato lo quita del autocompletado y del generador del Menú, pero los pedidos viejos lo siguen mostrando y
  contando. Se puede reactivar. La base de datos no deja borrar un plato ni dejar el menú sin los 47 de El Lobo.
- **Renombrar** muestra debajo del nombre un aviso: «Vas a cambiar el nombre «X» por «Y». Ten en cuenta que los pedidos anteriores
  con «X» se contarán junto con «Y» en los reportes, para que no se parta la estadística en dos». Al guardar, la ventana de
  confirmación lo repite.
- **Crear** un plato nuevo: se elige la lista y el nombre; el código lo pone el sistema.
- **Máximo 300 platos** en total.

### Qué cambia con un nombre nuevo y qué no

Los pedidos guardan el plato como **texto** (el nombre que tenía ese día) y **nunca se modifican**. Lo que cambia es cómo los
**cuenta** el sistema en los reportes de «platos más pedidos» del Tablero: cada pedido se lee con la lista que regía en la fecha
en que se tomó, se reconoce el plato por su código y se cuenta bajo su nombre **de hoy**. Así, si «Sopa de Hueso» pasa a
«Sopa de Huesos», los pedidos de todos los meses —también los anteriores al cambio— suman en «Sopa de Huesos». Si un nombre
viejo ya no se puede reconocer (texto escrito a mano, plato que no estaba en la lista), se cuenta tal cual estaba escrito.
Para saber si un plato es asado o proteína se mira su nombre de hoy, incluso retirado.

### Generador de la imagen del Menú

- El sistema le deja la lista de hoy (solo platos activos, sin los asados, que el generador no usa) en el almacenamiento del
  navegador, al abrirse y cada vez que se guarda un cambio. El generador la lee: dentro de la pestaña «Menú» y en la pestaña
  aparte, y se actualiza solo cuando llega una lista nueva (lo que ya estaba marcado para el menú del día se conserva; lo que
  ya no existe se desmarca).
- Si el generador se abre **sin** haber abierto antes el sistema (o la lista guardada está dañada), ofrece los platos de siempre.
- Su pestaña «📋 Platos disponibles» ya **no edita**: solo muestra la lista y dice dónde se cambia («Configuración → Platos del
  menú»). Ya no existe la lista propia del generador que vivía solo en el navegador.
- **Pendiente (decisión del dueño):** la plantilla de imagen tiene los precios escritos dentro de la imagen.

### Instalación

`sql/configuracion_etapa_3.sql` (después de las etapas 1, 2 y 4; una transacción; seguro de repetir; no toca ningún dato).
Verificación esperada: `platos_instalados = true · disparador = 1 · anon_con_permisos = false`. Para deshacer:
`sql/rollback_configuracion_etapa_3.sql` (deja la base como al terminar la etapa 4; **no** borra lo guardado). Hasta que se
instale, la pantalla muestra «falta instalar» y los botones quedan apagados; el autocompletado y el generador siguen con los
platos de siempre.

### Excel

«Exportar a Excel» trae una hoja más, `Menu_Platos` (código, lista, nombre, activo). El modelo financiero en Python no la lee
(no usa nombres de platos).

## 🍽️ Cierre del día: comidas de la familia

Un solo interruptor, **Sí / No**, en el panel «🍽️ Cierre del día» de la pestaña ⚙️ Configuración:

| Valor | Qué hace | De siempre |
|---|---|---|
| Comidas de la familia al cerrar el almuerzo | **Sí:** el cierre del almuerzo pide cuántas comidas comió la familia sin pagar (obligatorio en el cierre normal, opcional en el manual) y el historial de cierres muestra la columna «Familia». **No:** ese campo y esa columna dejan de aparecer. | Sí |

Para negocios que no llevan ese dato (o que no tienen «comida de la familia»), basta apagarlo.

### Qué cambia con «No» y qué no

- **Cierre normal y cierre manual (solo almuerzo):** no aparece el campo; el almuerzo se puede cerrar sin escribirlo y queda
  guardado como *sin dato* (NULL = «no registrado»; el modelo financiero ya sabe leer eso).
- **Lo ya guardado no se toca nunca.** Si se corrige un cierre que ya traía la cantidad, la cantidad **se conserva** tal cual.
  La columna del historial se oculta, pero el dato sigue en la base, en el Respaldo completo y en el Excel.
- **No cambia:** la opción «🎁 Gratis» de comidas rápidas y su línea «Consumo gratis del turno» (esa va en pesos y sirve también
  para regalos, cortesías y errores de cobro, no solo para la familia); el modelo financiero en Python.
- Volver a poner «Sí» lo devuelve todo. Un cierre hecho mientras estaba apagado (sin dato) se puede corregir sin que obligue a
  poner la cantidad.
- Como todo en esta pantalla: rige desde que se guarda, cada guardado es una fila nueva (queda quién y cuándo en el historial)
  y solo el administrador la cambia; caja la lee (es quien cierra el turno).

### Instalación

`sql/configuracion_cierre_familia.sql` (**de última**: después de las etapas 1, 2, 4 y 3, porque vuelve a escribir la validación general
con todas las claves; una transacción; seguro de repetir; no toca ningún dato). Verificación esperada:
`familia_instalada = true · disparador = 1 · anon_con_permisos = false`. Para deshacer: `sql/rollback_configuracion_cierre_familia.sql`
(deja la base como al terminar la etapa 3; **no** borra lo guardado: el sistema de la etapa 3 ignora esa fila y vuelve a pedir
la cantidad). Hasta que se instale, al intentar guardar la base responde «La configuración "cierre_comidas_familia" no existe» (el sistema lo muestra tal cual) y todo sigue como siempre.
**Orden de instalación completo:** `configuracion.sql` → `configuracion_etapa_2.sql` → `configuracion_etapa_4.sql` →
`configuracion_etapa_3.sql` → `configuracion_cierre_familia.sql`.

## Frecuencia del respaldo (aviso de «toca el respaldo»)

La frecuencia se guarda como la clave `respaldo_frecuencia` de la misma tabla `configuracion` (semanal · mensual · trimestral; sin nada guardado rige
*semanal*, como siempre). Es solo el **aviso** de la pantalla: nada obliga a hacer el respaldo y el respaldo en sí no cambia.

- **Instalación:** `sql/configuracion_respaldo_frecuencia.sql` (**de última**: después de `configuracion_cierre_familia.sql`, porque vuelve a escribir la
  validación general con todas las claves; una transacción; seguro de repetir; no toca ningún dato). Verificación esperada:
  `frecuencia_instalada = true · disparador = 1 · anon_con_permisos = false`. Para deshacer: `sql/rollback_configuracion_respaldo_frecuencia.sql`
  (no borra lo guardado: el sistema anterior ignora esa fila y vuelve al aviso semanal). Hasta que se instale, al guardar la base responde
  «La configuración "respaldo_frecuencia" no existe» (el sistema lo muestra tal cual) y todo sigue como siempre.
- **Orden de instalación completo:** `configuracion.sql` → `configuracion_etapa_2.sql` → `configuracion_etapa_4.sql` → `configuracion_etapa_3.sql` →
  `configuracion_cierre_familia.sql` → `configuracion_respaldo_frecuencia.sql`.
- **Cuándo se pone ámbar:** semanal, desde el día de la semana elegido; mensual, desde el último día del mes; trimestral, desde el último día de
  marzo, junio, septiembre o diciembre. Un respaldo hecho **ese mismo día** o después ya lo apaga (por eso, con «mensual», un respaldo del 31 de
  octubre no vuelve a avisar el 1 de noviembre).
- **Cuándo se pone rojo:** a los «días para el aviso rojo» sin respaldo, con un mínimo de 7 días (semanal), 35 (mensual) o 100 (trimestral).
- **Pruebas:** `tests/python/test_configuracion_respaldo_frecuencia.py` (base real: 49 casos), `tests/configuracion-respaldo.spec.js` (pantalla: cada
  frecuencia, fechas límite, mínimos del rojo, guardar/validar, servidor falso) y `tests/fixtures/casos-respaldo.json` (13 casos compartidos).

## Respaldos

- El **Respaldo completo** incluye la historia de la configuración (17 tablas).
- **Restaurar** la devuelve tal cual (mismos id, fechas y autores). Un respaldo hecho **antes** de que existiera la
  configuración no la toca.
- **Empezar de cero** **conserva** la configuración: es cómo funciona el restaurante, no un dato de trabajo.

## Pruebas

| Qué | Dónde |
|---|---|
| Base de datos real (Postgres): sellos, validación de cada clave y sus extremos, solo-agregar, permisos por rol, restauración, instalar nueva vs. existente, repetir, rollback | `tests/python/test_configuracion.py` |
| Pantalla: valores de siempre sin configuración, lectura con historia, guardar/validar/cancelar, mesas, respaldo, texto nunca interpretado como código | `tests/configuracion.spec.js` |
| Restaurar y Empezar de cero con la tabla nueva | `tests/python/test_restaurar_desde_sistema.py`, `tests/restaurar-desde-sistema.spec.js` |
| Las reglas dicen lo mismo en la base, la pantalla y el servidor falso | `test_los_rangos_son_los_mismos_…` |
| **Etapa 2 · base de datos real:** 95 casos de validación con su mensaje exacto, «los productos se retiran, no se borran», sellos, permisos, instalar sobre la etapa 1, repetir, rollback | `tests/python/test_configuracion_etapa_2.py` |
| **Etapa 2 · pantalla:** sin catálogo guardado = idéntico a antes; precios, nombres, retirados, categorías nuevas; pedidos viejos con su precio de entonces; edición, confirmación, validaciones, cambios simultáneos, permisos; y los **mismos 95 casos** contra la pantalla y el servidor falso | `tests/configuracion-productos.spec.js` + `tests/fixtures/casos-catalogo.json` |
| Foto de cómo se veía todo antes de la etapa 2 | `tests/fixtures/catalogo-anterior.json` |
| **Etapa 4 · base de datos real:** 93 casos compartidos con su mensaje exacto (categorías y cuentas), «las categorías se retiran, no se borran», «el grupo no cambia», sellos, permisos, instalar sobre las etapas 1 y 2, repetir, rollback | `tests/python/test_configuracion_etapa_4.py` |
| **Etapa 4 · pantalla:** sin nada guardado = idéntico a antes (foto de 9 vistas); listas, etiquetas, colores y sumas por grupo con categorías y nombres de cuentas guardados; edición, confirmación, validaciones, cambios simultáneos, permisos; y los **mismos 93 casos** contra la pantalla y el servidor falso | `tests/configuracion-egresos.spec.js` + `tests/fixtures/casos-egresos.json` |
| Foto de cómo se veía todo antes de la etapa 4 | `tests/fixtures/egresos-anterior.json` |
| **Etapa 3 · base de datos real:** 78 casos compartidos con su mensaje exacto (platos del menú), «los platos se retiran, no se borran», los 47 de El Lobo siempre, sellos, permisos, instalar sobre las etapas 1, 2 y 4 (y orden 2→4→3), repetir, rollback | `tests/python/test_configuracion_etapa_3.py` |
| **Etapa 3 · pantalla:** sin nada guardado = idéntico a antes; autocompletado, reportes (renombres, encadenados, nombres reutilizados, pedidos sin hora, asados), edición, aviso de renombre, confirmación, validaciones, cambios simultáneos, permisos, Excel; el generador del Menú recibe la lista, la refresca sin recargar, se protege de lo dañado y nunca interpreta un nombre como código; y los **mismos 78 casos** contra la pantalla y el servidor falso | `tests/configuracion-platos.spec.js` + `tests/fixtures/casos-platos.json` |
| Foto de cómo se veía todo antes de la etapa 3 | `tests/fixtures/platos-anterior.json` |
| **Cierre del día · base de datos real:** 11 casos compartidos con su mensaje exacto (solo verdadero/falso), sellos, permisos, lo de las etapas 1–4 sin cambios, instalar sobre la etapa 3, repetir, rollback que deja la etapa 3 tal cual | `tests/python/test_configuracion_cierre_familia.py`, `tests/fixtures/casos-familia.json` |
| **Cierre del día · pantalla:** sin nada guardado = como siempre; guardar «No» (confirmación, una fila) oculta el campo en el cierre normal y el manual y la columna del historial; apagada se cierra sin la cantidad y corregir un cierre la conserva; caja lo ve; volver a encender | `tests/configuracion-familia.spec.js` |
| **Frecuencia del respaldo · base de datos real y pantalla:** solo 'semanal', 'mensual' o 'trimestral' (13 casos compartidos con su mensaje exacto); cuándo se pone ámbar y rojo en cada frecuencia (fin de mes, fin de trimestre, todos los días de la semana, mínimos del rojo, el caso del 31-oct → 1-nov); guardar con confirmación; historial; caja | `tests/python/test_configuracion_respaldo_frecuencia.py`, `tests/configuracion-respaldo.spec.js`, `tests/fixtures/casos-respaldo.json` |
| Modelo financiero: el rubro sale del grupo (categorías nuevas, renombradas, retiradas, excluidas, huérfanas, export viejo) | `tests/python/test_motor_funciones.py` → `TestCategoriasConfigurables` |
