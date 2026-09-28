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
python generar_modelo_financiero.py ElLobo_datos_2026-09-27.xlsx --meses-proyeccion 6
```

Opciones:

| Opción | Descripción |
|---|---|
| `<archivo_exportado.xlsx>` | Excel exportado desde la pestaña Datos |
| `--meses-proyeccion N` | Meses a proyectar hacia adelante (por defecto 6) |
| `--salida archivo.xlsx` | Nombre del archivo generado (por defecto `ElLobo_Modelo_Financiero.xlsx`) |

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

- **Windows:** si al final ves un `UnicodeEncodeError` (el archivo sí se
  alcanza a guardar; falla solo el mensaje de "listo" con el ✅), corre antes
  `set PYTHONIOENCODING=utf-8` (cmd) o `$env:PYTHONIOENCODING="utf-8"`
  (PowerShell).
- **No subas el Excel exportado ni el modelo generado al repositorio:**
  contienen los datos reales del negocio y el repo es público en GitHub Pages.
