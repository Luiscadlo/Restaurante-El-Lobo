# Modelo financiero de El Lobo

Script en Python que toma los datos exportados del sistema contable y genera un
modelo financiero de 3 estados (estilo CFI "3-Statement Model") en un Excel.

> **Se corre a mano y en tu computador.** No está integrado al sistema web ni
> necesita ningún cambio en el hosting de GitHub Pages.

## 1. Requisitos

```
pip install openpyxl pandas
```

## 2. Uso con datos reales

1. En el sistema contable, entra a la pestaña **Datos**, elige el **período de los datos
   históricos** que quieres que use el modelo (todo el historial, este año, últimos 12/6/3 meses
   o unos meses a mano, siempre meses completos) y pulsa **Exportar datos a Excel** (baja
   `ElLobo_datos_AAAA-MM-DD.xlsx`; con período elegido el nombre lleva `_AAAA-MM_a_AAAA-MM`).
   Los meses del período son los que el modelo toma como reales para proyectar; inventario,
   fiados pendientes y movimientos de caja van siempre completos (son saldos, no un histórico).
2. Corre el script apuntando a ese archivo:

```
python generar_modelo_financiero.py ElLobo_datos_2026-09-27.xlsx --hasta 2027-12 --mes 2026-09
```

> **Datos reales fuera del repo (este repo es público).** El export y el modelo generado
> contienen los datos del negocio. Lo recomendable es guardar el export en una carpeta **fuera**
> del repo, p. ej. `C:\Users\<tu usuario>\OneDrive\Documents\Luisk\ElLobo-datos\` (queda
> respaldada por OneDrive y ningún `git add` puede tocarla), y correr el script con la ruta
> completa — acepta rutas absolutas, relativas o con `~`:
>
> ```
> python generar_modelo_financiero.py "C:\Users\57EF\OneDrive\Documents\Luisk\ElLobo-datos\ElLobo_datos_2026-10-01.xlsx" --salida "C:\Users\57EF\OneDrive\Documents\Luisk\ElLobo-datos\modelo.xlsx"
> ```
>
> Con `--salida` y una ruta con carpeta, el modelo también queda fuera del repo. Si el export queda
> dentro del repo, el `.gitignore` ya ignora `*.xlsx`, `ElLobo_datos_*`, `ElLobo_respaldo_*.json` y
> `datos_*.json`.

Opciones:

| Opción | Descripción |
|---|---|
| `<archivo_exportado.xlsx>` | Excel exportado desde la pestaña Datos |
| `--hasta AAAA-MM` | Último mes de la proyección (por defecto `2027-12`). El script calcula solo cuántos meses proyectar a partir del último mes real. |
| `--meses-proyeccion N` | Alternativa a `--hasta`: cantidad de meses a proyectar. **Si se pasa, manda** sobre `--hasta`. |
| `--mes AAAA-MM` | Mes en foco de los gráficos mensuales (por defecto, el último mes con datos reales). Debe ser un mes real. |
| `--inicio AAAA-MM` | Primer mes de datos reales a considerar (por defecto `2026-09` — agosto fue el mes de prueba del dueño, antes de llevar el negocio en serio por el sistema). Cualquier fila anterior, en cualquier tabla, se ignora. Solo aplica a datos reales, no a `--demo`. |
| `--salida archivo.xlsx` | Nombre del archivo generado. Por defecto se arma solo (`ElLobo_Modelo_Financiero_REAL.xlsx` con datos reales, `_DEMO.xlsx` con `--demo`) y siempre se guarda en esta misma carpeta, sin importar desde dónde corras el comando — así nunca hay dudas de si un archivo es de prueba o de datos reales. |

### Plan (para comparar real vs. proyectado)

No hay presupuesto congelado. **Plan(M) = proyección del escenario *Base* a un mes**:
parte del real del mes anterior (M-1) y aplica los drivers *Base* del primer mes
proyectado (crecimiento de almuerzo y de comida rápida, costo de insumos % e
inflación de gastos fijos). Solo existe para meses reales que tengan un mes anterior
real; el resto queda en blanco y los elementos que dependen del Plan se omiten con una
nota. Vive en la hoja `Datos_Graficos` como **fórmulas** hacia `Model` e `Inputs`, así
que si cambias los drivers *Base* el Plan se recalcula. El **Plan anual** es la suma de
los Plan mensuales (en meses sin real, la proyección del modelo). Ojo: el Plan supone
meses comparables — si el mes anterior real es parcial (p. ej. el sistema empezó a
mediados de mes), el Plan del mes siguiente queda muy bajo.

### Días operados proyectados y festivos de Colombia

Los días operados de cada mes proyectado (fila "Días operados del mes" de `Model`, al
tope de la hoja) ya no son un input fijo (antes, 26 para todos los meses): son
`NETWORKDAYS.INTL(inicio del mes, fin del mes, "0000001", festivos)` — solo el
**domingo** es no-laborable (el **sábado sí opera**, aunque sea con cierre manual).
Los festivos salen de `festivos_colombia()`: los 18 festivos civiles oficiales de
Colombia (Ley 51 de 1983 "Ley Emiliani" + Semana Santa, calculados a mano con el
algoritmo de Pascua de Meeus/Jones/Butcher) — **no** la librería `holidays`, que para
Colombia agrega un festivo regional de Boyacá (Virgen de Chiquinquirá) que no es
nacional. La lista queda como tabla editable **"Festivos en que NO abrimos"** en
`Inputs`, por si tu negocio no sigue exactamente este calendario (agregá o quitá filas
ahí, no en el script). El script imprime por consola los festivos entre octubre 2026 y
diciembre 2027 para validarlos cada vez que corre.

### Supuestos del dueño (período base de la proyección)

La sección de `Inputs` se renombró de "Supuestos del Modelo" a **"Supuestos del dueño
(editables)"**. El *período base* — hasta los 3 últimos meses reales que terminan en el
mes en foco (`periodo_base_meses()`) — reemplaza los supuestos de demostración:

- **Crecimiento de ventas** (Almuerzo / Comidas Rápidas): Base = 1 %/mes, editable mes a
  mes. Mejor y Peor quedan **iguales a Base** ("sin definir todavía" — no hay un
  escenario optimista/pesimista propio); editalos si querés probar uno.
- **Costo de insumos (% de ingresos)**: ya no es un número tipeado (antes 35/32/40 %):
  es una **fórmula** = Σ costo de insumos ÷ Σ ingresos del período base, en `Model`.
  Mejor/Base/Peor quedan iguales (celda negra, no azul: no se edita a mano).
- **Inflación de gastos fijos**: Base = 0 %/mes (antes 0,6 %), editable. Mejor/Peor
  también iguales a Base.
- **Ingresos proyectados** (Almuerzo y Comidas Rápidas) = (Σ ingresos del turno ÷ Σ días
  CON INGRESO de ese turno, en el período base) × (1 + crecimiento)^n × días operados
  proyectados del mes × factor de operación del turno (= Σ días con ingreso ÷ Σ días
  operados totales del período base; vale 1 si el turno vende todos los días). `n = 1`
  en el primer mes proyectado. Ya no es una cadena simple "mes anterior × (1 +
  crecimiento)": un mes con más o menos festivos pesa de verdad.
- **Nómina / Arriendo + Servicios / Otros gastos** proyectados arrancan del *promedio
  mensual del período base* (no ya del último mes real) y desde ahí encadenan mes a mes
  con la inflación de Inputs, igual que antes.
- El **Plan** (`Datos_Graficos`) ya usaba estos mismos drivers "Base" — hereda la lógica
  nueva sin cambios propios.

### Consumo familiar (la familia come sin pagar)

La hoja `Inputs` tiene la sección **Consumo familiar (estimado)** (celdas azules editables):
**comidas de la familia por día** (12), **valor por comida de la familia** — estimado fijo, $15.000,
que NO es el ticket del Tablero —, días operados por mes en meses proyectados (26) y consumo familiar
de comida rápida proyectado por mes (0). En `Model`, el bloque **Consumo Familiar (ESTIMADO)** lo
calcula así:

- **Almuerzo:** el cierre registra la *cantidad de comidas* de la familia
  (`cierres_dia.platos_familia`: una por persona, aunque haya sido en porciones). Comidas del mes =
  las registradas + (días sin registro × comidas por día de `Inputs`). Se valora con **el valor por
  comida de la familia de Inputs**, un estimado fijo (ya no distingue plato fuerte de porción ni mira
  el ticket real de platos fuertes del mes): lo único que varía la valoración mes a mes es la *cantidad*
  de comidas, no el precio.

  ```
  valor del almuerzo del mes = comidas del mes × valor por comida de la familia (Inputs)
  ```

  El **ticket de platos fuertes** (Σ `monto_almuerzo` ÷ Σ `cantidad` de completo/seco/asado130/asado200)
  sigue calculándose y mostrándose como dato informativo (consola y la fila "Ticket platos fuertes —
  Almuerzo" del Revenue Schedule), pero ya **no** alimenta el consumo familiar ni ningún otro cálculo.
  El ticket que SÍ usan la tarjeta "Ticket promedio almuerzo" de `A_Resultado`, #9 y #9B es el ticket
  normal por unidad vendida (Σ `monto_total` ÷ Σ `cantidad` de TODOS los pedidos de almuerzo, fila
  "Ticket promedio — Almuerzo" del Revenue Schedule) — no cambió, sigue coincidiendo con el Tablero.
- **Comida rápida:** el dueño no siempre anota el consumo familiar de comida rápida como
  pedido Gratis, así que el valor usado = **MÁXIMO**(valor registrado con pedidos
  **Gratis**, estimado mensual de `Inputs` — "Consumo familiar de comida rápida —
  estimado mensual ($)", $500.000 por defecto): nunca se cuenta menos del estimado, más
  si de verdad se registró más. Una fila aparte ("· Fuente del valor usado") marca si
  ganó lo registrado ("reg.") o el estimado ("est."). La fila informativa de Gratis
  sigue mostrando el valor registrado sin tocar — las dos fuentes conviven, el MÁXIMO
  solo decide cuál alimenta el consumo familiar total.
- **Meses proyectados:** todo sale de `Inputs` (días operados × comidas por día × valor por comida de
  la familia; comida rápida = directo el estimado, no hay nada registrado todavía que comparar).
- Los pedidos Gratis **nunca** suman a los ingresos reales (ni a volúmenes, tickets o
  conteos de pedidos). El costo de insumos del consumo familiar es solo informativo:
  ya está dentro de los egresos, no se resta de nuevo.
- Salen los indicadores *reales* vs. *ajustados* (como si la familia hubiera pagado):
  ingresos y utilidad ajustados, margen neto, costo de insumos %, costo primo %,
  utilidad diaria promedio y punto de equilibrio diario.

## 3. Uso de prueba con datos ficticios

Para ver cómo queda el modelo sin depender de datos reales (genera 12 meses de
ejemplo):

```
python generar_modelo_financiero.py --demo
```

## 4. Qué genera

Un `.xlsx` con estas hojas, en este orden:

| Hoja | Contenido |
|---|---|
| `Cover` | Portada y resumen del período cargado |
| `Outputs` | **Resumen para presentación — la única hoja pensada para exportar a PDF.** 4 páginas horizontales fijas (ver abajo) |
| `A_Resultado` | **¿Cómo me fue este mes?** — tarjetas KPI (▲▼ vs mes anterior y vs Plan) y gráficos #1–#4 y #12 |
| `B_Ingresos` | **¿De dónde viene la plata?** — gráficos #5–#9 |
| `C_Egresos` | **¿En qué se va la plata?** — gráficos #10–#11 |
| `E_Proyeccion` | **¿Hacia dónde voy?** — gráficos #13–#15 (proyección hasta `--hasta`) |
| `F_Familia` | **Si la familia pagara** — gráficos #16–#18 |
| `G_Extras` | Complementarios — gráficos #19–#21 |
| `Inputs` | *Supuestos del dueño (editables)*, *Festivos en que NO abrimos* y sección *Consumo familiar (estimado)* |
| `Model` | Estado de Resultados (+ Total Gastos Operativos y Margen Neto), Días operados, Supuestos del dueño, Balance General, Flujo de Caja y *Consumo Familiar (ESTIMADO)* |
| `Datos_Graficos` | Tablas de apoyo de los gráficos y la tabla del **Plan** |

### Outputs — lo que se exporta a PDF

4 páginas horizontales fijas, en este orden (área de impresión ya configurada: Carta
horizontal, márgenes 0,5", escala fija — **no** "ajustar a 1 página", para que la letra
no quede ilegible al imprimir):

| Página | Contenido |
|---|---|
| 1 — *¿Cómo nos fue en {mes}?* | Las 6 tarjetas del mes en foco (ingreso/gasto/utilidad diaria, punto de equilibrio, ticket, días operados) + Estado de Resultados completo con columna de proyección del mes siguiente y chequeo de cuadre |
| 2 | #2 — *De cada $100 vendidos, ¿cuánto queda?* (cascada) + #6 — *¿Qué días vendo más?* |
| 3 — *¿Cuánto cuesta la familia?* | #16 — *¿Cuánto dejo de ganar por el consumo familiar?* (cascada utilidad real → ajustada) + #17 — *Indicadores: reales vs. si la familia pagara* (tabla: margen neto, costo de insumos, desechables, costo primo, utilidad diaria, punto de equilibrio) |
| 4 — *¿Qué se vende más?* | #8A y #8B — Pareto de almuerzo y de comida rápida |

Cada bloque reutiliza las MISMAS tablas/fórmulas de `Datos_Graficos` que ya arman
`A_Resultado`/`B_Ingresos`/`F_Familia` (nada se calcula dos veces): solo cambia el
tamaño del gráfico y el layout, para que entren 1–2 bloques por página. Si no hay mes
anterior real (p. ej. hoy, con un solo mes de datos reales), las columnas "Mes
anterior"/"Cambio" del Estado de Resultados y las líneas "vs mes anterior" de las
tarjetas quedan en blanco en vez de mostrar una comparación inventada.

- **Estado de Resultados**: con fórmulas reales de Excel — histórico real y
  proyección según los drivers de la hoja *Inputs* (switch Mejor / Base / Peor).
  Cambias un input y recalcula.
- **Balance General** y **Flujo de Caja**: quedan como **estructura pendiente de
  completar**. Lo que el sistema ya sabe calcular (caja, inventario valorizado,
  utilidades retenidas) viene lleno; lo que falta (cuentas por cobrar de
  fiados, aportes de capital, préstamos, activos fijos) aparece en celdas
  marcadas `[PENDIENTE]`.
- **Gráficos nuevos** (A–G): cada uno es una *lámina* del tamaño de una página
  horizontal (título, hallazgo con número, gráfico y nota de fuente/escala) con
  salto de página entre láminas — son hojas de trabajo, para explorar mes a mes;
  *para presentar o imprimir, la hoja pensada para eso es `Outputs`* (arriba). Catálogo
  numerado y reglas: **[CATALOGO_GRAFICOS.md](CATALOGO_GRAFICOS.md)**. La estética se
  ajusta cambiando solo el diccionario `PALETA` del script.
- Lo que `Model` ya tiene va como **fórmulas** hacia `Model`/`Inputs`/Plan; solo
  lo que `Model` no tiene (datos diarios, día de la semana, pedidos) se calcula
  con pandas y queda rotulado *"calculado por el script al generar el modelo"*.

### Cómo se calculan los datos diarios

- **Día operado** = fecha con ingresos > 0 (igual que "Promedio por día" del
  Tablero). Todo promedio diario se divide por días operados, no por días calendario.
- **Ingresos por turno**: Desayuno (de `Aperturas_Turno`) / Almuerzo neto / Comida
  rápida (de `Cierres_Dia`, efectivo + transferencia + ajustes). El modelo ya incluye el
  desayuno dentro de "Ingresos Almuerzo", por eso *Almuerzo neto = Almuerzo − desayuno*;
  los tres turnos suman exactamente "Ingresos Totales".
- **Egresos por día y rubro**: `Egresos` + `Gastos_Cierre`, mapeados a 4 rubros
  (insumos = proveedor + desechables, nómina, arriendo + servicios, otros). `prestamo` se excluye.
  Una categoría fuera de esos rubros es "huérfana": no se suma y el script la avisa.
- **Desechables**: la categoría `desechables` (vasos, platos, bolsas…) cuenta como **costo de
  insumos**, pero el modelo guarda aparte cuánto de los insumos son desechables
  (`costo_desechables`, ya incluido en el costo de insumos: no se suma dos veces). **Todo gráfico
  de insumos deja ese valor a la vista** (ver el catálogo). En `Model` aparece en *Cost Schedule*:
  desechables ($ y % de los ingresos) e insumos de proveedores sin desechables. Solo meses reales:
  la proyección de insumos no los separa.
- **Pedidos Gratis**: nunca entran a volúmenes, tickets, Pareto ni conteos de pedidos
  (los ingresos mensuales no cambian: salen de los cierres).
- **Ticket y pedidos** (misma definición del Tablero del sistema, para que los números
  coincidan): **ticket = Σ `monto_total` ÷ Σ `cantidad`** de los pedidos pagados del turno,
  **sin Gratis y solo de turnos con cierre guardado**; una `cantidad` nula o 0 cuenta como 1
  (como `(cantidad||1)` del sistema). El ticket **no incluye** ajustes manuales ni cierres
  manuales, ni en el numerador ni en el denominador, y el desayuno queda fuera del ticket de
  almuerzo. Como los ingresos del modelo salen de los **cierres** (incluyen desayuno, ajustes y
  cierres manuales), el *Revenue Schedule* de `Model` los concilia por turno, en este orden:
  1. *Ventas por pedidos* (valor calculado por el script);
  2. *Ingresos de cierre sin pedido asociado (ajustes y cierres manuales)* = (ingresos del
     turno − desayuno) − ventas por pedidos. Debajo, tres filas informativas que **suman exactamente**
     esa fila: *Ajustes de cierre (efectivo y transferencia)*, *Cierres manuales* y *Diferencia entre
     pedidos y cierre (fiados no cobrados u otros)* (el residual; el script también lo imprime en consola);
  3. *Pedidos registrados* (cantidad real);
  4. *Ticket promedio* = fila 1 ÷ fila 3;
  5. *Pedidos equivalentes por ingresos sin pedido (ESTIMADO)* = fila 2 ÷ ticket (0 si la fila 2
     es negativa; el script lo reporta);
  6. *Pedidos equivalentes totales* = fila 3 + fila 5, y una fila de verificación
     (ticket × fila 6 − ingresos del turno, debe dar 0 cuando la fila 2 no es negativa; si es
     negativa, en comida rápida la diferencia son ajustes negativos del turno —faltantes de
     caja— y no es un error).
  Al final del bloque de almuerzo hay dos filas informativas: *Ticket platos fuertes — Almuerzo* y
  *Unidades platos fuertes — Almuerzo* (completo, seco, asado130 y asado200; ticket = Σ `monto_almuerzo` ÷
  Σ `cantidad`), que alimentan la valoración del consumo familiar.
  Los gráficos de comportamiento de clientes (#8, #9, #19 y los que cuentan pedidos) y el consumo
  familiar usan solo los pedidos registrados y el ticket; nunca los pedidos equivalentes. Al terminar,
  el script imprime *"Ticket almuerzo del mes en foco: $X (debe coincidir con el Tablero)"*.

### Cómo verificar el resultado

Con `--demo` salen todos los gráficos con datos de ejemplo. Con datos reales conviene
revisar que `Σ ingresos diarios del mes = Ingresos del mes en Model`, que `Desayuno +
Almuerzo neto + Comida rápida = Ingresos Totales` y que `Σ egresos por categoría =
egresos del mes` (se pueden leer en las tablas de `Datos_Graficos`).

## Notas

- **No subas el Excel exportado ni el modelo generado al repositorio:**
  contienen los datos reales del negocio y el repo es público en GitHub Pages.
  El `.gitignore` de la raíz ya excluye cualquier `.xlsx` (salvo el catálogo
  público del Menú).
