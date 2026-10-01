# Catálogo de gráficos del modelo financiero

Referencia numerada de los gráficos que genera `generar_modelo_financiero.py`. **La numeración
(#1–#21) es la que se usa para pedir cambios** ("cambia el #6", "agrega X al #13"). Los gráficos
nuevos viven en hojas propias, después de `Outputs`, y sus tablas de apoyo en `Datos_Graficos`
(última hoja).

## Cómo leerlos

- **Una lámina = una página horizontal**: título fijo (celda grande), subtítulo con el hallazgo
  (una frase con número), gráfico y nota de fuente/escala. Hay salto de página entre láminas, así
  que *Archivo → Exportar → PDF* funciona como presentación.
- **Escalas**: mensual en **$ millones**, diario en **$ miles**; barras siempre desde 0;
  máximo 3–4 series (salvo donde el catálogo pide más: #11, #19 y #20).
- **Un color = un significado**, todo desde el diccionario `PALETA` al inicio del bloque de
  gráficos del script (ingresos, egresos, utilidad, alerta, desayuno, almuerzo, comida_rapida,
  real, proyectado, plan, neutro_claro, neutro_oscuro). Cambiar la estética = cambiar solo `PALETA`.
- **Solo días operados** (fecha con ingresos > 0, igual que el KPI "Promedio por día" del
  Tablero); todo promedio diario se divide por días operados. Días de la semana lun–sáb (el
  domingo aparece solo si hubo ventas).
- **Comparativos obligatorios** (vs mes anterior y vs Plan): tarjetas KPI de A_Resultado, #4 y
  #17. En los demás, el subtítulo menciona la variación vs mes anterior cuando aplica (y avisa
  si el mes anterior tuvo muy distinta cantidad de días operados).
- **Fuente de cada número**: *Fórmulas* = fórmulas de Excel hacia `Model`/`Inputs`/Plan (cambian
  si cambias Inputs). *Script* = calculado por pandas al generar el modelo (diario, día de la
  semana y pedidos, que `Model` no tiene).
- **Si algo no aplica** (p. ej. un mes sin Plan), la lámina sale con una nota y sin gráfico; no
  se rompe.

## Plan y consumo familiar (reglas)

- **Plan(M) = proyección del escenario Base a un mes**: parte del real del mes M-1 y aplica los
  drivers Base del primer mes proyectado (crecimiento almuerzo y comida rápida, costo de insumos %,
  inflación de gastos fijos). Solo meses reales con un mes anterior real. **No hay presupuesto
  anual aparte: el Plan anual es la SUMA de los Plan mensuales** (para meses sin real, la
  proyección del modelo; un mes real sin Plan cuenta con su valor real). Aplica a #14 y #15.
- **Consumo familiar** (la familia come sin pagar): *almuerzo* se registra por CANTIDAD de platos
  en el cierre (`cierres_dia.platos_familia`) y se valora a precio de venta (platos × ticket del
  día); los días sin registro se estiman con los supuestos de `Inputs`. *Comida rápida* se
  registra por VALOR real con los pedidos de ubicación **Gratis** (no se estima). Los pedidos
  Gratis **nunca** suman a los ingresos reales ni entran a volúmenes, tickets, Pareto ni conteos
  de pedidos. El costo de insumos del consumo familiar es informativo (ya está en los egresos).

## Ticket y pedidos (regla)

Misma definición del Tablero del sistema: **ticket = Σ monto_total ÷ Σ cantidad** de pedidos pagados
del turno, **sin Gratis y solo de turnos cerrados** (cantidad nula o 0 cuenta como 1). No incluye ajustes
manuales ni cierres manuales, y el desayuno queda fuera del ticket de almuerzo. Los ingresos del modelo
salen de los cierres, así que `Model → Revenue Schedule` concilia: *Ventas por pedidos*, *Ingresos de cierre
sin pedido asociado (ajustes y cierres manuales)*, *Pedidos registrados*, *Ticket promedio*, *Pedidos
equivalentes por ingresos sin pedido (ESTIMADO)* y *Pedidos equivalentes totales* (+ verificación). Los
gráficos de pedidos (#8, #9, #19) y el consumo familiar usan **solo los pedidos registrados** y el ticket,
nunca los equivalentes. La misma estructura aplica a comida rápida.

## Insumos y desechables (regla)

El costo de **insumos** = compras a proveedores + **desechables** (categoría `desechables`: vasos, platos,
bolsas…). Los desechables van *dentro* de insumos (el total no cambia), pero **todo gráfico donde aparezcan
insumos deja a la vista cuánto son desechables**: partido en dos barras/segmentos (#2, #11), en el rótulo
del rubro (#4, #10, Outputs gráf. 3), como fila propia (#17) o como línea propia (#20, Outputs gráf. 5).
El valor sale de `Model` → *Cost Schedule* (solo meses reales; la proyección de insumos no los separa).
Color de desechables: `PALETA["desechables"]` (malva oscuro, dentro de la familia de egresos).

## Catálogo

| # | Hoja | Gráfico | Tipo | Fuente | Comparativo |
|---|---|---|---|---|---|
| — | A_Resultado | **Tarjetas**: ingreso diario promedio, gasto diario promedio, utilidad diaria promedio, punto de equilibrio diario, ticket promedio almuerzo, días operados | KPI con ▲▼ | Fórmulas | vs mes anterior; las 3 primeras también vs Plan |
| 1 | A_Resultado | Ingreso diario vs. gasto diario promedio | Barras diarias + 2 líneas (barras bajo el gasto promedio en rojo) | Script (barras) + fórmulas (líneas) | — |
| 2 | A_Resultado | De cada $100 vendidos, ¿cuánto queda? | Cascada (ingresos → insumos → nómina → arriendo y servicios → otros → utilidad) | Fórmulas | — |
| 3 | A_Resultado | Evolución mensual: ingresos, egresos y margen | Barras agrupadas + línea de margen (ene–dic del año en foco; real sólido, proyectado claro) | Fórmulas | Subtítulo: vs mes anterior |
| 4 | A_Resultado | Real vs. Plan | Barras horizontales divergentes por rubro (verde/rojo según favorable) | Fórmulas | **vs Plan** |
| 12 | A_Resultado | Ritmo del mes: utilidad acumulada vs. meta *(Bloque D)* | Líneas acumuladas por día (real vs meta lineal del Plan) | Script (real) + fórmulas (meta) | vs Plan (meta) |
| 5 | B_Ingresos | Ingresos por turno (Desayuno / Almuerzo neto / Comida rápida) | Barras apiladas por semana S1–S5 (+ donut de participación) | Script | Subtítulo: vs mes anterior |
| 6 | B_Ingresos | ¿Qué días vendo más? | Barras por día de la semana + línea de los meses anteriores + línea del promedio del mes | Script | vs meses anteriores |
| 7 | B_Ingresos | Mapa de calor día × turno | Matriz con escala de color de un solo tono (ingreso promedio por día operado) | Script | — |
| 8 | B_Ingresos | ¿Qué producto sostiene el negocio? **8A** almuerzo por tipo de pedido y **8B** comida rápida por categoría (misma lámina); **8C** almuerzo por proteína, top 10 | Pareto (barras + % acumulado) | Script (sin Gratis) | — |
| 9 | B_Ingresos | ¿Crezco por más clientes o por cobrar más? **9A** semanas del mes; **9B** últimos 6 meses | Barras (pedidos) + línea (ticket almuerzo) | Script (9A) / fórmulas (9B) | vs mes anterior |
| 10 | C_Egresos | Egresos por categoría | Barras horizontales ordenadas, con % de los ingresos (+ donut) | Fórmulas | Subtítulo: vs mes anterior |
| 11 | C_Egresos | Estructura de costos como % de las ventas | Barras apiladas al 100 % por mes + línea del costo primo | Fórmulas | Subtítulo: vs mes anterior |
| 13 | E_Proyeccion | Proyección mensual (ene del primer año → dic del último) | Barras de ingresos y utilidad (real sólido / proyectado claro) + línea de margen | Fórmulas | — |
| 14 | E_Proyeccion | Acumulado del año: real vs. Plan / proyectado | Líneas de utilidad acumulada | Fórmulas | **vs Plan** |
| 15 | E_Proyeccion | Resumen anual | Barras agrupadas por año (ingresos, egresos, utilidad, utilidad Plan/proyección); el margen anual va en el nombre del año | Fórmulas | **vs Plan anual** |
| 16 | F_Familia | ¿Cuánto dejo de ganar por el consumo familiar? | Cascada: utilidad real → + familia almuerzo → + familia comida rápida → utilidad ajustada | Fórmulas | — |
| 17 | F_Familia | Indicadores: reales vs. si la familia pagara | Tabla (margen neto, insumos %, costo primo %, utilidad diaria, punto de equilibrio) con ▲▼ | Fórmulas | **vs mes anterior y vs Plan** |
| 18 | F_Familia | Peso del consumo familiar en el tiempo | Barras apiladas (almuerzo, comida rápida; $ M) + línea de % de las ventas; cada mes marcado est./mixto/reg./proy. | Fórmulas | — |
| 19 | G_Extras | Cómo me pagan y por dónde vendo | Dos barras 100 % apiladas (efectivo/transferencia; mesa / para llevar / domicilio) | Script | — |
| 20 | G_Extras | ¿Qué gasto crece más rápido que mis ventas? | Líneas en índice base 100 (primer mes real = 100) por rubro de egreso + ventas | Fórmulas | — |
| 21 | G_Extras | Plata por cobrar (fiados) por antigüedad | Barras 0–7, 8–15, 16–30, +30 días (snapshot de hoy) | Script | — |

Notas por gráfico:

- **#9** Pedidos = pedidos registrados (cantidad real, sin Gratis, turnos cerrados); ticket = Σ monto_total ÷ Σ cantidad. **No incluye pedidos equivalentes por ingresos sin pedido** (ajustes y cierres manuales).
- **#2 / #11** Insumos va partido en *Insumos (proveedores)* y *Desechables* (juntos = costo de insumos); el valor de los desechables va en el rótulo de #2 y la serie #11 se ve en el tono oscuro.
- **#4 / #10** El rótulo del rubro Insumos incluye "incl. desechables $X M" (el Plan de insumos de #4 no los separa).
- **#17** Fila extra "· Desechables (% de ventas)", real vs. ajustado (no tiene Plan: el Plan de insumos no los separa).
- **#20** "Insumos (incl. desechables)" y, aparte, "Desechables (parte de insumos)" en línea punteada; si el primer mes real no tiene desechables, esa línea se omite (el aviso la lista).
- **#1** El umbral de las barras rojas es el gasto total del mes ÷ días operados (incluye arriendo y nómina).
- **#3 / #13** El eje del margen es 0–40 % y se amplía solo si algún mes real lo supera (p. ej. un primer mes parcial).
- **#4** El eje es de −30 % a +30 %; se amplía a ±60 % o ±100 % si hay variaciones mayores (las barras más largas se recortan en el borde y el valor real va en el nombre del rubro).
- **#5** Almuerzo neto = cierre de almuerzo − desayuno (el modelo ya incluye el desayuno dentro de "Ingresos Almuerzo"). Semanas: S1 = días 1–7, S2 = 8–14, S3 = 15–21, S4 = 22–28, S5 = 29–31.
- **#8** Fuente: `Pedidos_Pagados` (sin Gratis); **no incluye desayuno ni ajustes manuales**, por eso suma menos que los ingresos. El mapa código→categoría de comida rápida es una copia de `PL.comidaRapida` del sistema (`MAPA_CR_CATEGORIA`): hay que mantenerlo sincronizado a mano. Los pedidos "extra" van en la categoría EXTRAS.
- **#12** Meta lineal = utilidad del Plan ÷ días operados esperados (26 si el mes no ha terminado; los reales si ya terminó), sumada solo en días operados. Los egresos entran en su fecha real.
- **#14** Sin datos antes del primer mes real: el acumulado arranca ahí.
- **#19** Canal: Domicilio, Para llevar / sin mesa, Mesa; "Otro" = sin ubicación (p. ej. fiados). Efectivo/transferencia según el reparto real de cada pedido.
- **#21** Es un snapshot: el sistema solo guarda los fiados pendientes de hoy; monto bruto del pedido (el saldo de Cuentas por Cobrar del Balance descuenta abonos).

## Qué gráficos de `Outputs` quedan superados

`Outputs` **no se modifica ni se elimina nada** todavía; estos gráficos viejos quedan superados por los nuevos:

| Gráfico de `Outputs` | Lo supera | Por qué |
|---|---|---|
| Gráf. 1 — Ingresos vs. Utilidad Neta por mes | **#3** | Mismo dato mensual, con egresos, margen y distinción real/proyectado |
| Gráf. 2 — Margen Operativo por mes | **#3** | El margen va como línea en #3 |
| Gráf. 3 — ¿En qué se va la plata? (histórico acumulado) | **#10** | #10 lo hace del mes en foco, con % de los ingresos |
| Gráf. 4 — Composición de Ingresos por Turno | **#5** | El gráf. 4 rotula "Almuerzo" pero **incluye el desayuno**; #5 separa Desayuno / Almuerzo (neto) / Comida rápida |
| Gráf. 5 — Costo de Insumos % de Ingresos | **#11** | #11 muestra insumos % junto al resto de la estructura de costos |

## Hojas y datos

| Hoja | Contenido |
|---|---|
| `A_Resultado` | Tarjetas + #1, #2, #3, #4 y #12 (Bloque D) |
| `B_Ingresos` | #5 a #9 |
| `C_Egresos` | #10 y #11 |
| `E_Proyeccion` | #13 a #15 |
| `F_Familia` | #16 a #18 |
| `G_Extras` | #19 a #21 |
| `Datos_Graficos` | Tablas de apoyo de todos los gráficos, incluida la tabla del Plan (cada tabla dice si es fórmula o "calculado por el script al generar el modelo") |
