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

Opciones:

| Opción | Descripción |
|---|---|
| `<archivo_exportado.xlsx>` | Excel exportado desde la pestaña Datos |
| `--hasta AAAA-MM` | Último mes de la proyección (por defecto `2027-12`). El script calcula solo cuántos meses proyectar a partir del último mes real. |
| `--meses-proyeccion N` | Alternativa a `--hasta`: cantidad de meses a proyectar. **Si se pasa, manda** sobre `--hasta`. |
| `--mes AAAA-MM` | Mes en foco de los gráficos mensuales (por defecto, el último mes con datos reales). Debe ser un mes real. |
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

### Consumo familiar (la familia come sin pagar)

La hoja `Inputs` tiene la sección **Consumo familiar (estimado)** (celdas azules editables):
personas que comen almuerzo (9), almuerzos por persona por día operado (1), días
operados por mes en meses proyectados (26), override del ticket de almuerzo (vacío =
ticket real; en meses proyectados, el del último mes real) y consumo familiar de
comida rápida proyectado por mes (0). En `Model`, el bloque **Consumo Familiar
(ESTIMADO)** lo calcula así:

- **Almuerzo:** el cierre registra la *cantidad* de platos (`cierres_dia.platos_familia`).
  Día con registro → valor = platos × ticket del día (ticket del día = (ingreso de
  almuerzo − desayuno) ÷ pedidos de almuerzo sin Gratis; si el día no tiene pedidos,
  p. ej. un cierre manual, se usa el ticket promedio real del mes). Día sin registro
  (`NULL`) → se estima en Excel: personas × almuerzos por persona × suma de los
  tickets diarios de esos días. Si la columna `platos_familia` no existe en el
  export, todo queda estimado.
- **Comida rápida:** se registra *valor* real con los pedidos de ubicación **Gratis**
  (llevan su precio de venta). No se estima nada en meses reales.
- **Meses proyectados:** todo sale de `Inputs` (días operados × personas × almuerzos
  por persona × ticket; comida rápida = el input proyectado).
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
| `Outputs` | KPIs y 5 gráficos del dashboard original (no se modificó) |
| `A_Resultado` | **¿Cómo me fue este mes?** — tarjetas KPI (▲▼ vs mes anterior y vs Plan) y gráficos #1–#4 y #12 |
| `B_Ingresos` | **¿De dónde viene la plata?** — gráficos #5–#9 |
| `C_Egresos` | **¿En qué se va la plata?** — gráficos #10–#11 |
| `E_Proyeccion` | **¿Hacia dónde voy?** — gráficos #13–#15 (proyección hasta `--hasta`) |
| `F_Familia` | **Si la familia pagara** — gráficos #16–#18 |
| `G_Extras` | Complementarios — gráficos #19–#21 |
| `Inputs` | Supuestos y escenarios (Mejor / Base / Peor) + sección *Consumo familiar (estimado)* |
| `Model` | Estado de Resultados, Balance General, Flujo de Caja y *Consumo Familiar (ESTIMADO)* |
| `Datos_Graficos` | Tablas de apoyo de los gráficos y la tabla del **Plan** |

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
  salto de página entre láminas: *Archivo → Exportar → PDF* sirve como
  presentación. Catálogo numerado, reglas y qué gráficos de `Outputs` quedan
  superados: **[CATALOGO_GRAFICOS.md](CATALOGO_GRAFICOS.md)**. La estética se
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
