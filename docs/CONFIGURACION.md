# ⚙️ Configuración del negocio (etapa 1)

Pestaña **⚙️ Configuración** — solo el administrador. Aquí se cambian los valores que antes estaban escritos a mano en el
código. Esta es la **etapa 1** del plan: lo primero y más simple. Las siguientes (productos y precios, menú, finanzas,
turnos y horarios) se suman a la misma tabla y la misma pantalla.

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
