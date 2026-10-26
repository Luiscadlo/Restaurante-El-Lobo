# El Lobo — Sistema Contable

Sistema de un solo archivo (`ElLobo-Sistema Contable.html`) para el día a día del
restaurante, respaldado en Supabase. No tiene build: se abre el `.html` directo
en el navegador.

Este README documenta, por ahora, solo la función de **descuentos/promociones**
sobre pedidos — el resto del sistema se documenta a medida que haga falta.

## Migraciones de Supabase

Todas las migraciones y correcciones ya se corrieron en Supabase (hasta el
16-oct-2026) y sus `.sql` se quitaron de la carpeta; siguen en el historial de
git si hace falta consultarlos:

- `migracion_supabase_platos_familia.sql`
- `migracion_supabase_auditoria_cancelaciones.sql`
- `migracion_supabase_descuentos.sql` — columnas `descuento`/`motivo_descuento`
  en `pedidos` + tabla `pedidos_descuentos` (log de auditoría).
- `migracion_supabase_abonos_turno.sql` — `abonos_fiado.turno`,
  `pedidos.fecha_pago`/`turno_pago`, `cierres_dia.abonos_efectivo`/`abonos_transferencia`.
- `correcciones_octubre_fiados.sql` y `unir_clientes_maria.sql` — correcciones
  de datos de una sola vez.

Para una función nueva, su script va en un `.sql` nuevo en esta carpeta.

Si una migración no se ha corrido, el sistema lo detecta solo (`descuentosDisponibles()`)
y deshabilita los botones correspondientes con un mensaje claro, en vez de fallar
a medias.

## Descuentos ≠ gastos

Un descuento es **plata que no ingresó**, no un gasto:

- No cambia la cantidad vendida, no toca Egresos, inventario ni consumos.
- `pedidos.descuento` (entero, pesos) y `pedidos.motivo_descuento` guardan cuánto
  y por qué. `monto_almuerzo` y `monto_total` quedan **netos** (ya restado el
  descuento); `monto_unit`, `cantidad` y `monto_domicilio` nunca se tocan (no se
  descuenta envío ni empaque). El valor de lista de una fila siempre se puede
  reconstruir: `monto_almuerzo + descuento` (ver `valorListaFila()`).
- El descuento se define por **pedido completo** (todas las filas que comparten
  `grupo_pedido`) y se reparte proporcional al valor de lista de cada fila con
  `repartirDescuento()` — función pura, con sus pruebas en consola (sección
  "Descuentos / promociones" del script).
- Nunca aplica a pedidos `es_gratis` (ya no cobran nada) ni a los marcados
  `pagado_via_abono` (dañaría el saldo de fiados).

### Dónde se usa

- **Al registrar** (pestaña Pedidos): campo "Descuento ($)" + motivo, junto al
  total. Si D=0 no se mandan las columnas nuevas (retrocompatible); si D>0 y la
  migración no está corrida, se aborta el registro (nunca se guarda a medias ni
  se pierde el dato silenciosamente).
- **Pedidos pendientes** (mesas, domicilios, sin mesa, fiados): botón
  "🏷 Descuento" junto al de pagar.
- **Pedidos ya pagados** (Ingresos de hoy e Historial, incluido con el turno ya
  cerrado — el caso principal): mismo botón 🏷, con un badge que muestra el
  descuento aplicado.

El modal único (`abrirModalDescuento()`/`aplicarDescuentoGrupo()`) hace, en
este orden: valida → actualiza las filas de `pedidos` → si el pedido ya estaba
pagado y su turno tiene un cierre guardado, ajusta `efectivo`/`transferencia`/
`resultado` de ese cierre por el delta (si falla, revierte los pedidos) → borra
los gastos "Otro" que el usuario marque como ya anotados a mano (para no
descontar dos veces) → deja un registro en `pedidos_descuentos`. Un cierre
manual pide confirmación aparte antes de tocarlo.

### Auditoría e informes

- Pestaña Auditoría: tabla "Descuentos aplicados" (de dónde sale cada ajuste a
  un cierre y qué gastos se borraron con él).
- Auditoría tiene filtro por día: Hoy / Ayer / Semana / Mes / Todo, o «desde – hasta»
  (elegir solo una fecha muestra solo ese día). Los ajustes se ubican por la fecha del
  cierre; los pedidos eliminados y los descuentos, por el día (hora local) en que se
  hicieron. El numerito de la pestaña no cuenta como visto lo que el filtro esconde.
- Tablero: "Descuentos otorgados" y "Ventas a precio de lista" son solo
  informativos — nunca se restan dos veces del ingreso real (que ya es neto).
- `exportarExcelCompleto()`: `Pedidos_Pagados`/`Pedidos_Pendientes` llevan
  `descuento`/`motivo_descuento`; hoja `Descuentos_Log` aparte si hay alguno en
  el período exportado.

## Fiados: abonos y saldo a favor

- **Abono** (tarjeta de cada cliente en la pestaña Fiados): la plata entra al
  cierre del día/turno **real** en que se recibe (antes de las 9 am cuenta como
  la cena del día anterior), en la columna de su cuenta (efectivo o
  transferencia), y se reparte contra los fiados pendientes del cliente, del más
  viejo al más nuevo, siempre por pedido completo.
- **Saldo a favor** (formulario «💰 Registrar saldo a favor de un cliente», misma pestaña): para
  un cliente que paga de más y **no debe nada**. Ejemplo: paga 20.000 una cuenta
  de 15.000 → se cobra la cuenta normal (15.000) y aquí se registran los 5.000
  sobrantes. Se elige un cliente de la lista o se escribe uno nuevo (si ya existe
  uno con el mismo nombre —aunque cambien tildes o mayúsculas— se usa ese, no se
  duplica). Por dentro es un abono normal, así que entra al cierre y a Caja igual.
- **Cómo se gasta:** el próximo pedido del cliente se registra como fiado y se
  pulsa «✔ Aplicar saldo a favor» (salda los pedidos fiados completos que alcance
  a cubrir, sin meter plata nueva a Caja); o se cobra y se abona solo la diferencia.
- **Si se registró por error:** solo el administrador puede eliminar el abono (🗑).
  Si con ese abono ya se saldaron pedidos, no deja eliminarlo hasta devolver esos
  pedidos a pendiente (↩); si el abono estaba en un cierre guardado, abre
  «Corregir cierre».
- Pruebas: `tests/saldo-a-favor.spec.js` y `tests/abonos-fiado.spec.js`.
