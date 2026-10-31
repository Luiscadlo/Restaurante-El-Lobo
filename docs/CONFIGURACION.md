# ⚙️ Configuración del negocio (etapas 1 y 2)

Pestaña **⚙️ Configuración** — solo el administrador. Aquí se cambian los valores que antes estaban escritos a mano en el
código. La **etapa 1** (nombre, mesas, recargos, respaldo) y la **etapa 2** (🍽️ **Productos y precios**, más abajo) viven en
la misma tabla y la misma pantalla. Las siguientes (categorías de egresos y cuentas, finanzas) se suman igual.

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
| Día del respaldo semanal | El aviso aparece desde ese día y sigue hasta que haya un respaldo completo hecho desde entonces | domingo … sábado | domingo |
| Días para el aviso rojo | Con tantos días sin respaldo completo, el aviso se pone rojo | 7–60 | 10 |

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
