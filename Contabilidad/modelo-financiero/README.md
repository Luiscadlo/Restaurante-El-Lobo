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

1. En el sistema contable, entra a la pestaña **Datos** y pulsa
   **Exportar todos los datos a Excel** (baja `ElLobo_datos_AAAA-MM-DD.xlsx`).
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

## 3. Uso de prueba con datos ficticios

Para ver cómo queda el modelo sin depender de datos reales (genera 12 meses de
ejemplo):

```
python generar_modelo_financiero.py --demo
```

## 4. Qué genera

Un `.xlsx` de 4 hojas: **Cover / Outputs / Inputs / Model**.

- **Estado de Resultados**: con fórmulas reales de Excel — histórico real y
  proyección según los drivers de la hoja *Inputs* (switch Mejor / Base / Peor).
  Cambias un input y recalcula.
- **Balance General** y **Flujo de Caja**: quedan como **estructura pendiente de
  completar**. Lo que el sistema ya sabe calcular (caja, inventario valorizado,
  utilidades retenidas) viene lleno; lo que falta (cuentas por cobrar de
  fiados, aportes de capital, préstamos, activos fijos) aparece en celdas
  marcadas `[PENDIENTE]`.

## Notas

- **No subas el Excel exportado ni el modelo generado al repositorio:**
  contienen los datos reales del negocio y el repo es público en GitHub Pages.
