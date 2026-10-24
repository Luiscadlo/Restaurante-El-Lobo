# Matriz de permisos — quién puede hacer qué

> **Estado: pendiente de tu OK en las 3 decisiones de abajo** (mientras no respondas, valen las opciones A).
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

Además: **sin sesión no se puede nada** (la llave pública que va en la página deja de abrir la base).

## Qué ve cada uno en pantalla

- **Caja:** Pedidos, Pendientes, Fiados, Cierre (Día a día), Inventario y Menú. Las secciones de dueño (Tablero, Ingresos, Egresos, Caja, Auditoría, Datos) **no aparecen** con caja; tampoco aparece **nada** de administrador dentro de sus pestañas: ni **Exportar**, ni **Importar**, ni el **Cierre manual**, ni el **Historial completo de cierres**, ni el aviso de respaldo, ni cajitas de usuario y contraseña. Un cierre de otro día ya guardado solo dice «sal e ingresa como administrador» para verlo o corregirlo.
- **Ver las secciones de dueño o usar sus funciones:** pulsar **Salir** y entrar como administrador. Ya no hay candados con usuario y contraseña a la vista dentro de las pestañas de caja.
- **Admin entrando directo:** todo abierto; no se recuerda (al recargar hay que volver a entrar).
- **Caja entrando directo:** se recuerda en ese equipo para no pedir la clave en cada recarga. "Salir" la borra.

## Decisiones que necesito de ti

**1. ¿Caja puede eliminar pedidos YA COBRADOS?** (hoy cualquiera puede)
- **A (propuesto):** sí, como hoy. Cada eliminación queda en Auditoría y caja no puede borrar ni leer ese rastro. Tú revisas Auditoría (al autorizarte, la pestaña muestra cuántas novedades hay desde la última vez; con el usuario de caja ese numerito no se ve).
- **B:** solo admin puede eliminar cobrados; caja solo cancela pendientes. Es más estricto, pero requiere pedir autorización cada vez que haya que corregir un error en el mostrador, y algo más de código.

**2. Descuentos y el gasto "Otro" de Egresos.** Al aplicar un descuento, el sistema ofrece borrar el gasto "Otro" que alguien anotó a mano para compensarlo (para no contarlo doble). Caja ya no puede ver `egresos` (es finanzas), así que **solo le ofrecerá los gastos "Otro" del cierre del turno**, no los de la pestaña Egresos.
- **A (propuesto):** aceptar. Si un descuento se anotó en Egresos, lo corrige un admin.
- **B:** dejar que caja lea `egresos` (entonces ve todos los gastos del negocio).

**3. Cambios en días anteriores.** Hoy la pantalla ya exige administrador para corregir cierres o pedidos de otros días. Esa restricción **sigue siendo solo de pantalla**: quien sepa manipular la página con el usuario de caja podría tocar datos de días pasados. Hacerlo cumplir en el servidor requiere reglas más complejas (y más riesgo de bloquear algo del mostrador).
- **A (propuesto):** dejarlo así por ahora y revisarlo después de una semana de operación.
- **B:** exigirlo en el servidor desde ya.

## Otras cosas que conviene que sepas

- Caja **puede leer** `pedidos` y `cierres_dia`, así que alguien técnico con esa cuenta podría consultar todas las ventas históricas (no compras, gastos ni caja). Es inevitable si el mostrador cobra y cierra turno.
- **Importar** y **Exportar** (los botones del encabezado) son solo de administrador y con caja ni se dibujan. Antes cualquiera podía importar.
- **Eliminar un abono de fiado** (botón 🗑 en Fiados) es solo de administrador; la base ya limitaba ese borrado a admin.
- El usuario `respaldo` es solo lectura. La tarea semanal automática de respaldo (que corría con la llave pública) se **eliminó** al activar las reglas: el respaldo es a mano cada domingo con **Exportar**, y el aviso lo recuerda hasta que se haga (solo lo ve el administrador). El usuario `respaldo` queda disponible por si algún día se quiere automatizar.
- Nada más en el repositorio usa la base: el Menú del día no la toca.
