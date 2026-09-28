#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generar_modelo_financiero.py
=============================
Genera "ElLobo_Modelo_Financiero.xlsx" — un modelo financiero de 3 estados
con la MISMA estructura del curso "3-Statement Modeling" de CFI (Cover /
Outputs / Inputs / Model), simplificado para el tamaño real de El Lobo.

Uso:
    python generar_modelo_financiero.py <archivo_exportado.xlsx> [--meses-proyeccion N]
    python generar_modelo_financiero.py --demo

    <archivo_exportado.xlsx>  El archivo que genera el botón "Exportar todo a
                               Excel" de la pestaña Datos del sistema contable
                               (una hoja por tabla: Pedidos_Pagados, Egresos,
                               Cierres_Dia, etc.)
    --demo                    Ignora el archivo y genera 12 meses de datos de
                               EJEMPLO (para probar el modelo sin depender de
                               datos reales).

Qué SÍ queda con fórmulas reales de Excel (cambias un input y recalcula):
  - Estado de Resultados: histórico real + proyectado con los drivers de la
    hoja Inputs (switch Mejor/Base/Peor).
  - Revenue Schedule (Volumen × Ticket) y Cost Schedule (insumos % de
    ingresos, gastos fijos con inflación).
  - Caja acumulada (Balance) y Flujo de Caja: reales en el histórico,
    proyectados con una relación simplificada (ver notas en la propia hoja).

Qué queda como ESTRUCTURA para completar más adelante (tal como se pidió):
  - Balance General: activos/pasivos/patrimonio con lo que el sistema ya
    puede calcular (caja, inventario valorizado, utilidades retenidas) —
    filas marcadas [PENDIENTE] donde falte un dato que el sistema todavía
    no registra de forma explotable (cuentas por cobrar de fiados, aportes
    de capital, préstamos formales, activos fijos).
  - Flujo de Caja proyectado: simplificado (no maneja capital de trabajo
    día a día todavía).

Requiere: pip install openpyxl pandas
"""

import sys
import argparse
from datetime import date

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import SeriesLabel, DataPoint
from openpyxl.chart.shapes import GraphicalProperties

# ══════════════════════════════════════════════════════════════════════
# ESTILO — misma convención que la plantilla CFI (Cover/Outputs/Inputs/Model)
# ══════════════════════════════════════════════════════════════════════
AZUL_BANNER = "E7F2FF"        # fondo de los banners de sección
AZUL_TEXTO  = "3271D2"        # texto de banners e inputs (celdas editables)
NEGRO       = "000000"        # texto de fórmulas / resultados calculados
GRIS_NOTA   = "808080"
NARANJA_PENDIENTE = "E07C3A"  # filas "estructura, falta completar"

FMT_CONTABLE = '_(#,##0_);(#,##0);_("–"_);_(@_)'
FMT_PCT      = '_(#,##0.0%_);(#,##0.0%);_("–"_)_%;_(@_)_%'

FONT_BANNER    = Font(name="Calibri", size=11, bold=True, color=AZUL_TEXTO)
FONT_SUBTITULO = Font(name="Calibri", size=10, italic=True, color=GRIS_NOTA)
FONT_FORMULA   = Font(name="Calibri", size=10, color=NEGRO)
FONT_FORMULA_B = Font(name="Calibri", size=10, bold=True, color=NEGRO)
FONT_LABEL     = Font(name="Calibri", size=10, color=NEGRO)
FONT_LABEL_B   = Font(name="Calibri", size=10, bold=True, color=NEGRO)
FONT_PENDIENTE = Font(name="Calibri", size=10, italic=True, color=NARANJA_PENDIENTE)

FILL_BANNER = PatternFill("solid", fgColor=AZUL_BANNER)
BORDE_SUBTOTAL = Border(top=Side(style="hair"))


def banner(ws, row, texto, col_ini=2, col_fin=16):
    """Barra de sección — azul claro con texto azul (igual a la plantilla
    CFI: 'Income Statement', 'Balance Sheet', etc.)."""
    for c in range(col_ini, col_fin + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = FILL_BANNER
        if c == col_ini:
            cell.value = texto
            cell.font = FONT_BANNER


def nota(ws, row, texto, col=2):
    ws.cell(row=row, column=col, value=texto).font = FONT_SUBTITULO


def label(ws, row, texto, bold=False, col=2, indent=0):
    c = ws.cell(row=row, column=col, value=texto)
    c.font = FONT_LABEL_B if bold else FONT_LABEL
    if indent:
        c.alignment = Alignment(indent=indent)
    return c


def numero(ws, row, col, valor_o_formula, bold=False, pct=False, pendiente=False):
    c = ws.cell(row=row, column=col, value=valor_o_formula)
    c.number_format = FMT_PCT if pct else FMT_CONTABLE
    if pendiente:
        c.font = FONT_PENDIENTE
    elif isinstance(valor_o_formula, str) and valor_o_formula.startswith("="):
        c.font = FONT_FORMULA_B if bold else FONT_FORMULA
    else:
        c.font = Font(name="Calibri", size=10, bold=bold, color=AZUL_TEXTO)
    return c


def subtotal_borde(ws, row, col_ini, col_fin):
    for c in range(col_ini, col_fin + 1):
        ws.cell(row=row, column=c).border = BORDE_SUBTOTAL


def config_impresion(ws, horizontal=True, ajustar_ancho=True):
    """Config. de impresión — sin esto, hojas anchas (18 meses de columnas)
    se cortan en varias páginas verticales al exportar a PDF/imprimir."""
    ws.page_setup.orientation = "landscape" if horizontal else "portrait"
    ws.page_setup.fitToWidth = 1 if ajustar_ancho else 0
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.gridLines = False
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5


# ══════════════════════════════════════════════════════════════════════
# CARGA DE DATOS — desde el export real, o datos de EJEMPLO
# ══════════════════════════════════════════════════════════════════════
def cargar_datos_reales(path_excel):
    """Lee el archivo del botón 'Exportar a Excel' de la pestaña Datos (una
    hoja por tabla de Supabase) y arma un DataFrame mensual. Ajusta los
    nombres de hoja/columna aquí si cambian en el sistema."""
    xls = pd.ExcelFile(path_excel)

    def hoja(nombre):
        return pd.read_excel(xls, nombre) if nombre in xls.sheet_names else pd.DataFrame()

    cierres = hoja("Cierres_Dia")
    pedidos = hoja("Pedidos_Pagados")
    egresos = hoja("Egresos")
    gastos_cierre = hoja("Gastos_Cierre")
    inventario = hoja("Inventario")
    movs_caja = hoja("Movimientos_Caja")

    for df in (cierres, pedidos, egresos, gastos_cierre, movs_caja):
        if not df.empty and "fecha" in df.columns:
            df["fecha"] = pd.to_datetime(df["fecha"])
            df["periodo"] = df["fecha"].dt.to_period("M")

    meses = sorted(
        set(cierres["periodo"]) if "periodo" in cierres.columns else set()
        | (set(egresos["periodo"]) if "periodo" in egresos.columns else set())
    )

    filas = []
    for periodo in meses:
        ing_alm = pedidos[(pedidos.get("periodo") == periodo) & (pedidos.get("turno") == "almuerzo")] if not pedidos.empty else pd.DataFrame()
        ing_cena = pedidos[(pedidos.get("periodo") == periodo) & (pedidos.get("turno") == "cena")] if not pedidos.empty else pd.DataFrame()
        cierres_mes = cierres[cierres["periodo"] == periodo] if not cierres.empty else pd.DataFrame()
        egresos_mes = egresos[egresos["periodo"] == periodo] if not egresos.empty else pd.DataFrame()
        gastos_mes = gastos_cierre[gastos_cierre["periodo"] == periodo] if not gastos_cierre.empty else pd.DataFrame()

        ingresos_totales = float(cierres_mes[["efectivo", "transferencia"]].sum().sum()) if not cierres_mes.empty else 0.0
        vol_alm = int(ing_alm["cantidad"].sum()) if not ing_alm.empty and "cantidad" in ing_alm else len(ing_alm)
        vol_cena = int(ing_cena["cantidad"].sum()) if not ing_cena.empty and "cantidad" in ing_cena else len(ing_cena)
        ingresos_alm = float(ing_alm["monto_total"].sum()) if not ing_alm.empty else 0.0
        ingresos_cena = float(ing_cena["monto_total"].sum()) if not ing_cena.empty else 0.0

        def suma_cat(df, cat):
            # "egresos" guarda la categoría en la columna "cat"; "gastos_dia"
            # (los gastos registrados al cierre del turno) la guarda en
            # "categoria" — mismos valores (nomina/proveedor/otro), columna
            # distinta. gastos_dia tampoco maneja arriendo/servicios (esos
            # son gastos fijos mensuales, no de cierre diario).
            col = "cat" if "cat" in df.columns else ("categoria" if "categoria" in df.columns else None)
            if df.empty or col is None:
                return 0.0
            return float(df[df[col] == cat]["monto"].sum())

        costo_insumos = suma_cat(egresos_mes, "proveedor") + suma_cat(gastos_mes, "proveedor")
        nomina        = suma_cat(egresos_mes, "nomina") + suma_cat(gastos_mes, "nomina")
        arriendo_serv = suma_cat(egresos_mes, "arriendo") + suma_cat(egresos_mes, "servicios")
        otros         = suma_cat(egresos_mes, "otro") + suma_cat(gastos_mes, "otro")

        filas.append(dict(
            periodo=str(periodo), anio=periodo.year, mes=periodo.month,
            ingresos_almuerzo=ingresos_alm or ingresos_totales * 0.55,
            ingresos_cena=ingresos_cena or ingresos_totales * 0.45,
            volumen_almuerzo=max(vol_alm, 1), volumen_cena=max(vol_cena, 1),
            costo_insumos=costo_insumos, nomina=nomina,
            arriendo_servicios=arriendo_serv, otros_gastos=otros,
        ))

    hist = pd.DataFrame(filas).sort_values("periodo").reset_index(drop=True)

    caja_acumulada = float(movs_caja["monto"].sum()) if not movs_caja.empty and "monto" in movs_caja.columns else None
    # Nota: "caja_acumulada" suma movimientos_caja.monto tal cual — es una
    # cifra de referencia rápida, no un saldo formal (los traspasos entre
    # cuentas pueden inflar/desinflar esta suma; no se usa en el Estado de
    # Resultados, solo como dato adicional del Balance General).
    valor_inventario = None
    if not inventario.empty and {"stock", "costo"}.issubset(inventario.columns):
        valor_inventario = float((inventario["stock"] * inventario["costo"]).sum())

    return hist, {"caja_acumulada": caja_acumulada, "valor_inventario": valor_inventario}


def datos_de_ejemplo(n_meses=12):
    """Meses de datos ILUSTRATIVOS (no son datos reales de El Lobo), solo
    para poder ver y probar la estructura del modelo."""
    import random
    random.seed(7)
    hoy = date.today()
    filas = []
    base_alm, base_cena = 5_200_000, 3_800_000
    for i in range(n_meses, 0, -1):
        m = hoy.month - i
        a = hoy.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        crecim = 1 + 0.012 * (n_meses - i)
        ruido = lambda: random.uniform(0.92, 1.08)
        ing_alm = base_alm * crecim * ruido()
        ing_cena = base_cena * crecim * ruido()
        filas.append(dict(
            periodo=f"{a}-{m:02d}", anio=a, mes=m,
            ingresos_almuerzo=round(ing_alm, -3),
            ingresos_cena=round(ing_cena, -3),
            volumen_almuerzo=int(ing_alm / 15000),
            volumen_cena=int(ing_cena / 13000),
            costo_insumos=round((ing_alm + ing_cena) * random.uniform(0.33, 0.38), -3),
            nomina=2_500_000,
            arriendo_servicios=1_200_000,
            otros_gastos=round(random.uniform(150_000, 400_000), -3),
        ))
    hist = pd.DataFrame(filas)
    extra = {"caja_acumulada": 8_400_000, "valor_inventario": 1_650_000}
    return hist, extra


# ══════════════════════════════════════════════════════════════════════
# HOJA: COVER
# ══════════════════════════════════════════════════════════════════════
def hoja_cover(wb, n_hist, n_fcst, es_demo):
    ws = wb.create_sheet("Cover")
    ws.sheet_view.showGridLines = False
    for col, w in zip("ABCDEFGHIJ", [3, 24, 3, 3, 3, 3, 3, 3, 3, 3]):
        ws.column_dimensions[col].width = w

    ws["C3"] = "🐺 El Lobo"
    ws["C3"].font = Font(name="Calibri", size=22, bold=True, color=AZUL_TEXTO)
    ws["C4"] = "Modelo Financiero — Estado de Resultados, Balance y Flujo de Caja"
    ws["C4"].font = Font(name="Calibri", size=13, color=NEGRO)
    if es_demo:
        ws["C5"] = "⚠ DATOS DE EJEMPLO — no son cifras reales del restaurante"
        ws["C5"].font = Font(name="Calibri", size=10, bold=True, color="C0392B")

    ws["C8"] = "Contenido"
    ws["C8"].font = FONT_BANNER
    hojas = [
        ("Outputs", "KPIs clave, gráficos y resumen ejecutivo"),
        ("Inputs", "Supuestos y escenarios (Mejor / Base / Peor)"),
        ("Model", "Estado de Resultados, Balance General y Flujo de Caja"),
    ]
    r = 10
    for nombre, desc in hojas:
        cell = ws.cell(row=r, column=3, value=f"→ {nombre}")
        cell.font = Font(bold=True, color=AZUL_TEXTO, underline="single")
        cell.hyperlink = f"#'{nombre}'!A1"
        ws.cell(row=r, column=5, value=desc).font = FONT_LABEL
        r += 2

    r += 1
    ws.cell(row=r, column=3, value="Resumen del período cargado").font = FONT_BANNER
    r += 2
    for etiqueta, valor in [
        ("Meses históricos reales", n_hist),
        ("Meses proyectados", n_fcst),
        ("Escenario activo", "=Inputs!$E$6"),
    ]:
        ws.cell(row=r, column=3, value=etiqueta).font = FONT_LABEL
        ws.cell(row=r, column=6, value=valor).font = FONT_FORMULA_B
        r += 1

    r += 2
    ws.cell(row=r, column=3, value="Estado de las 3 secciones del modelo").font = FONT_BANNER
    r += 2
    for nombre, est in [
        ("Estado de Resultados", "✅ Completo — histórico real + proyección con escenarios"),
        ("Balance General", "🟠 Estructura lista — completar activos/pasivos que el sistema aún no registra"),
        ("Flujo de Caja", "🟠 Estructura lista — histórico real, proyección simplificada"),
    ]:
        ws.cell(row=r, column=3, value=nombre).font = FONT_LABEL_B
        ws.cell(row=r, column=6, value=est).font = FONT_LABEL
        r += 1

    r += 3
    ws.cell(row=r, column=3, value=f"Generado automáticamente el {date.today().isoformat()} desde el sistema contable de El Lobo.").font = FONT_SUBTITULO
    ws.cell(row=r + 1, column=3, value="No reemplaza asesoría contable o tributaria profesional.").font = FONT_SUBTITULO
    config_impresion(ws, horizontal=False)
    return ws


# ══════════════════════════════════════════════════════════════════════
# HOJA: INPUTS  — devuelve además las filas donde vive cada driver, para
# que Model las referencie sin duplicar números "quemados" en dos hojas.
# ══════════════════════════════════════════════════════════════════════
def hoja_inputs(wb, meses_fcst_labels):
    ws = wb.create_sheet("Inputs")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 3
    ws.column_dimensions["D"].width = 3
    ws.column_dimensions["E"].width = 12
    for i in range(len(meses_fcst_labels)):
        ws.column_dimensions[get_column_letter(6 + i)].width = 11

    col_ini = 6
    col_fin = col_ini + max(len(meses_fcst_labels), 1) - 1

    banner(ws, 2, "Supuestos del Modelo", col_fin=col_fin)
    nota(ws, 4, "Cambia cualquier celda azul — el modelo se recalcula solo.")

    ws["B6"] = "Escenario activo"
    ws["B6"].font = FONT_LABEL_B
    dv = DataValidation(type="list", formula1='"Mejor,Base,Peor"', allow_blank=False)
    ws.add_data_validation(dv)
    ws["E6"] = "Base"
    ws["E6"].font = Font(bold=True, color=AZUL_TEXTO, size=12)
    ws["E6"].fill = PatternFill("solid", fgColor="FFF3CD")
    dv.add(ws["E6"])
    nota(ws, 7, "↑ Elige Mejor / Base / Peor de la lista (así funciona todo el modelo)")

    r = 9
    ws.cell(row=r, column=2, value="Meses proyectados →").font = FONT_LABEL_B
    for i, lab in enumerate(meses_fcst_labels):
        ws.cell(row=r, column=col_ini + i, value=lab).font = FONT_LABEL_B

    def bloque_driver(fila_titulo, titulo, valores_mejor, valores_base, valores_peor, pct=True, nota_txt=None):
        """Layout igual al de la plantilla CFI: el TÍTULO y el resultado
        (=INDEX(...) según el escenario) viven en la MISMA fila; debajo, una
        fila en blanco y luego Mejor/Base/Peor con los valores de cada caso.
        Devuelve (fila_del_resultado, siguiente_fila_libre)."""
        r_result = fila_titulo
        label(ws, r_result, titulo, bold=True)
        r_mejor, r_base, r_peor = fila_titulo + 2, fila_titulo + 3, fila_titulo + 4
        for r_caso, nombre_caso, valores in [
            (r_mejor, "Mejor", valores_mejor), (r_base, "Base", valores_base), (r_peor, "Peor", valores_peor)
        ]:
            label(ws, r_caso, nombre_caso, indent=1)
            for i, v in enumerate(valores):
                numero(ws, r_caso, col_ini + i, v, pct=pct)
        for i in range(len(meses_fcst_labels)):
            cl = get_column_letter(col_ini + i)
            f = f'=INDEX({cl}{r_mejor}:{cl}{r_peor},MATCH($E$6,{{"Mejor";"Base";"Peor"}},0))'
            numero(ws, r_result, col_ini + i, f, pct=pct, bold=True)
        siguiente = r_peor + 2
        if nota_txt:
            nota(ws, r_peor + 1, nota_txt)
            siguiente = r_peor + 3
        return r_result, siguiente

    driver_rows = {}
    r = 12
    driver_rows["crecimiento_almuerzo"], r = bloque_driver(
        r, "Crecimiento de ventas — Almuerzo (%/mes)",
        [0.03] * len(meses_fcst_labels), [0.015] * len(meses_fcst_labels), [0.0] * len(meses_fcst_labels))
    driver_rows["crecimiento_cena"], r = bloque_driver(
        r, "Crecimiento de ventas — Comidas rápidas (%/mes)",
        [0.035] * len(meses_fcst_labels), [0.015] * len(meses_fcst_labels), [-0.01] * len(meses_fcst_labels))
    driver_rows["costo_insumos_pct"], r = bloque_driver(
        r, "Costo de insumos (% de ingresos)",
        [0.32] * len(meses_fcst_labels), [0.35] * len(meses_fcst_labels), [0.40] * len(meses_fcst_labels))
    driver_rows["inflacion_gastos"], r = bloque_driver(
        r, "Inflación de gastos fijos — nómina / arriendo / servicios / otros (%/mes)",
        [0.003] * len(meses_fcst_labels), [0.006] * len(meses_fcst_labels), [0.012] * len(meses_fcst_labels),
        nota_txt="Aplica a nómina + arriendo/servicios + otros gastos proyectados.")

    r += 1
    banner(ws, r, "Otros Supuestos", col_fin=col_fin)
    r += 2
    label(ws, r, "Meses a proyectar")
    numero(ws, r, 5, len(meses_fcst_labels), bold=True)
    r += 1
    label(ws, r, "Primer mes de proyección")
    ws.cell(row=r, column=5, value=meses_fcst_labels[0] if meses_fcst_labels else "").font = Font(bold=True, color=AZUL_TEXTO)

    config_impresion(ws, horizontal=True)
    return ws, driver_rows


# ══════════════════════════════════════════════════════════════════════
# HOJA: MODEL
# ══════════════════════════════════════════════════════════════════════
def hoja_model(wb, hist_df, meses_fcst_labels, extra, driver_rows):
    ws = wb.create_sheet("Model")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 3
    ws.column_dimensions["D"].width = 3
    ws.column_dimensions["E"].width = 3
    n_hist = len(hist_df)
    n_fcst = len(meses_fcst_labels)
    col_ini = 6  # F
    cols_fcst = list(range(col_ini + n_hist, col_ini + n_hist + n_fcst))
    col_fin = col_ini + n_hist + n_fcst - 1
    for c in range(col_ini, col_fin + 1):
        ws.column_dimensions[get_column_letter(c)].width = 11

    labels_periodo = list(hist_df["periodo"]) + list(meses_fcst_labels)

    ws.cell(row=3, column=2, value="Modelo corriendo con supuestos:").font = FONT_SUBTITULO
    ws.cell(row=3, column=5, value="=Inputs!$E$6").font = Font(bold=True, italic=True, color=AZUL_TEXTO)
    ws.cell(row=4, column=2, value="Cifras en pesos colombianos (COP)").font = FONT_SUBTITULO
    fila_periodos = 4
    for i, lab in enumerate(labels_periodo):
        c = ws.cell(row=fila_periodos, column=col_ini + i, value=lab)
        c.font = Font(bold=True, color=NEGRO if (col_ini + i) < col_ini + n_hist else AZUL_TEXTO)
        c.alignment = Alignment(horizontal="center")
    ws.cell(row=5, column=col_ini, value="◄ Real").font = FONT_SUBTITULO
    if cols_fcst:
        ws.cell(row=5, column=cols_fcst[0], value="Proyectado ►").font = FONT_SUBTITULO

    def fila_inputs(driver_key, i):
        """Referencia a la celda de Inputs para el mes proyectado i (0-based)
        de ese driver — misma columna en ambas hojas."""
        cl = get_column_letter(col_ini + i)
        return f"Inputs!{cl}{driver_rows[driver_key]}"

    # ══ ESTADO DE RESULTADOS ═════════════════════════════════════════
    banner(ws, 8, "Estado de Resultados", col_fin=col_fin)
    r = 10
    fila_ing_alm = r
    label(ws, r, "Ingresos Almuerzo")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, float(hist_df.iloc[i]["ingresos_almuerzo"]))
    r += 1
    fila_ing_cena = r
    label(ws, r, "Ingresos Comidas Rápidas")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, float(hist_df.iloc[i]["ingresos_cena"]))
    r += 1
    fila_ingresos = r
    label(ws, r, "Ingresos Totales", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=SUM({cl}{fila_ing_alm}:{cl}{fila_ing_cena})", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    fila_costo_insumos = r
    label(ws, r, "Costo de Insumos")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, -float(hist_df.iloc[i]["costo_insumos"]))
    r += 1
    fila_utilidad_bruta = r
    label(ws, r, "Utilidad Bruta", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_ingresos}+{cl}{fila_costo_insumos}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    fila_nomina = r
    label(ws, r, "Nómina")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, -float(hist_df.iloc[i]["nomina"]))
    r += 1
    fila_arriendo = r
    label(ws, r, "Arriendo + Servicios")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, -float(hist_df.iloc[i]["arriendo_servicios"]))
    r += 1
    fila_otros = r
    label(ws, r, "Otros Gastos")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, -float(hist_df.iloc[i]["otros_gastos"]))
    r += 1
    fila_utilidad_op = r
    label(ws, r, "Utilidad Operativa (EBITDA)", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_utilidad_bruta}+SUM({cl}{fila_nomina}:{cl}{fila_otros})", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 1
    fila_margen_op = r
    label(ws, r, "Margen Operativo")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_utilidad_op}/{cl}{fila_ingresos}", pct=True)
    r += 2

    fila_utilidad_neta = r
    label(ws, r, "Utilidad Neta", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_utilidad_op}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    nota(ws, r + 1, "Utilidad neta = utilidad operativa (el modelo aún no separa impuestos formales — ajústalo si aplica).")
    r += 3

    # ── proyección: sobrescribe las columnas de pronóstico con fórmulas
    #    que jalan los drivers de Inputs (mismo mecanismo INDEX+MATCH que
    #    ya resuelve Mejor/Base/Peor en la propia hoja Inputs) ──────────
    for i, c in enumerate(cols_fcst):
        cl, cl_prev = get_column_letter(c), get_column_letter(c - 1)
        numero(ws, fila_ing_alm, c, f"={cl_prev}{fila_ing_alm}*(1+{fila_inputs('crecimiento_almuerzo', i)})")
        numero(ws, fila_ing_cena, c, f"={cl_prev}{fila_ing_cena}*(1+{fila_inputs('crecimiento_cena', i)})")
        numero(ws, fila_costo_insumos, c, f"=-{cl}{fila_ingresos}*{fila_inputs('costo_insumos_pct', i)}")
        numero(ws, fila_nomina, c, f"={cl_prev}{fila_nomina}*(1+{fila_inputs('inflacion_gastos', i)})")
        numero(ws, fila_arriendo, c, f"={cl_prev}{fila_arriendo}*(1+{fila_inputs('inflacion_gastos', i)})")
        numero(ws, fila_otros, c, f"={cl_prev}{fila_otros}*(1+{fila_inputs('inflacion_gastos', i)})")

    # ══ REVENUE SCHEDULE ═════════════════════════════════════════════
    r += 1
    banner(ws, r, "Revenue Schedule — Volumen × Ticket Promedio", col_fin=col_fin)
    r += 2
    fila_vol_alm = r
    label(ws, r, "Volumen pedidos — Almuerzo")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, int(hist_df.iloc[i]["volumen_almuerzo"]))
    r += 1
    fila_tkt_alm = r
    label(ws, r, "Ticket promedio — Almuerzo")
    for c in range(col_ini, col_ini + n_hist):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_ing_alm}/{cl}{fila_vol_alm}")
    r += 1
    fila_vol_cena = r
    label(ws, r, "Volumen pedidos — Comidas Rápidas")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, int(hist_df.iloc[i]["volumen_cena"]))
    r += 1
    fila_tkt_cena = r
    label(ws, r, "Ticket promedio — Comidas Rápidas")
    for c in range(col_ini, col_ini + n_hist):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_ing_cena}/{cl}{fila_vol_cena}")
    r += 2
    nota(ws, r, "Solo histórico (el volumen proyectado no es necesario para calcular Ingresos, que se proyectan directo con el driver de crecimiento).")
    r += 2

    # ══ COST SCHEDULE ═══════════════════════════════════════════════
    banner(ws, r, "Cost Schedule", col_fin=col_fin)
    r += 2
    label(ws, r, "Costo de insumos (% de ingresos)")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=-{cl}{fila_costo_insumos}/{cl}{fila_ingresos}", pct=True)
    r += 2

    # ══ BALANCE GENERAL (estructura) ═══════════════════════════════
    banner(ws, r, "Balance General  —  🟠 estructura, completar según notas", col_fin=col_fin)
    r += 2
    label(ws, r, "ACTIVOS", bold=True); r += 1
    fila_caja = r
    label(ws, r, "Caja")
    caja_ini = extra.get("caja_acumulada")
    if caja_ini is not None and n_hist:
        numero(ws, r, col_ini, caja_ini)
        for i in range(1, n_hist):
            cl, cl_prev = get_column_letter(col_ini + i), get_column_letter(col_ini + i - 1)
            numero(ws, r, col_ini + i, f"={cl_prev}{fila_caja}+{cl}{fila_utilidad_neta}")
    else:
        for i in range(n_hist):
            numero(ws, r, col_ini + i, "[PENDIENTE]", pendiente=True)
    for c in cols_fcst:
        cl, cl_prev = get_column_letter(c), get_column_letter(c - 1)
        numero(ws, r, c, f"={cl_prev}{fila_caja}+{cl}{fila_utilidad_neta}")
    r += 1
    fila_cxc = r
    label(ws, r, "Cuentas por Cobrar (fiados pendientes)")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, "[PENDIENTE — enlazar con saldo de fiados]", pendiente=True)
    r += 1
    fila_inv = r
    label(ws, r, "Inventario")
    val_inv = extra.get("valor_inventario")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, val_inv if val_inv is not None else "[PENDIENTE]", pendiente=(val_inv is None))
    r += 1
    fila_total_activos = r
    label(ws, r, "Total Activos", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=SUM({cl}{fila_caja}:{cl}{fila_inv})", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    label(ws, r, "PASIVOS", bold=True); r += 1
    fila_prestamos = r
    label(ws, r, "Préstamos / Deuda")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, 0)
    r += 1
    fila_total_pasivos = r
    label(ws, r, "Total Pasivos", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_prestamos}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    label(ws, r, "PATRIMONIO", bold=True); r += 1
    fila_aportes = r
    label(ws, r, "Aportes de Capital")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, "[PENDIENTE — enlazar con aportes en Caja]", pendiente=True)
    r += 1
    fila_util_ret = r
    label(ws, r, "Utilidades Retenidas (acumuladas)")
    numero(ws, r, col_ini, f"={get_column_letter(col_ini)}{fila_utilidad_neta}")
    for c in range(col_ini + 1, col_fin + 1):
        cl, cl_prev = get_column_letter(c), get_column_letter(c - 1)
        numero(ws, r, c, f"={cl_prev}{fila_util_ret}+{cl}{fila_utilidad_neta}")
    r += 1
    fila_total_patrimonio = r
    label(ws, r, "Total Patrimonio", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_util_ret}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    label(ws, r, "Check (debe ser 0)")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        cc = numero(ws, r, c, f"=ROUND({cl}{fila_total_activos}-{cl}{fila_total_pasivos}-{cl}{fila_total_patrimonio},0)")
        cc.font = Font(italic=True, size=9, color=GRIS_NOTA)
    nota(ws, r + 1, "No da 0 todavía a propósito: Cuentas por Cobrar y Aportes de Capital están marcados [PENDIENTE] — al completarlos, cuadra.")
    r += 3

    # ══ FLUJO DE CAJA (estructura) ═══════════════════════════════════
    banner(ws, r, "Flujo de Caja  —  🟠 estructura, proyección simplificada", col_fin=col_fin)
    r += 2
    label(ws, r, "OPERACIÓN", bold=True); r += 1
    fila_fc_ni = r
    label(ws, r, "Utilidad Neta")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_utilidad_neta}")
    r += 1
    fila_fc_op = r
    label(ws, r, "Subtotal Operación", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_fc_ni}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    label(ws, r, "INVERSIÓN", bold=True); r += 1
    fila_fc_inv = r
    label(ws, r, "Compra de Equipos / Activos")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, 0)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    label(ws, r, "FINANCIACIÓN", bold=True); r += 1
    fila_fc_fin = r
    label(ws, r, "Aportes de Capital / Préstamos")
    for c in range(col_ini, col_fin + 1):
        numero(ws, r, c, "[PENDIENTE]", pendiente=True)
    subtotal_borde(ws, r, col_ini, col_fin)
    r += 2

    fila_fc_total = r
    label(ws, r, "Cambio en Caja del Período", bold=True)
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"={cl}{fila_fc_op}+{cl}{fila_fc_inv}", bold=True)
    subtotal_borde(ws, r, col_ini, col_fin)

    model_refs = dict(
        fila_ingresos=fila_ingresos, fila_utilidad_bruta=fila_utilidad_bruta,
        fila_utilidad_op=fila_utilidad_op, fila_margen_op=fila_margen_op,
        fila_utilidad_neta=fila_utilidad_neta, col_ini=col_ini, col_fin=col_fin,
        labels_periodo=labels_periodo, n_hist=n_hist,
        fila_ing_alm=fila_ing_alm, fila_ing_cena=fila_ing_cena,
        fila_costo_insumos=fila_costo_insumos, fila_nomina=fila_nomina,
        fila_arriendo=fila_arriendo, fila_otros=fila_otros,
    )
    config_impresion(ws, horizontal=True)
    return ws, model_refs


# ══════════════════════════════════════════════════════════════════════
# HOJA: OUTPUTS
# ══════════════════════════════════════════════════════════════════════
def hoja_outputs(wb, model_refs):
    ws = wb.create_sheet("Outputs")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["B"].width = 26
    col_ini, col_fin = model_refs["col_ini"], model_refs["col_fin"]
    for c in range(col_ini, col_fin + 1):
        ws.column_dimensions[get_column_letter(c)].width = 11

    banner(ws, 2, "Dashboard — Resumen Ejecutivo", col_fin=col_fin)
    ws.cell(row=4, column=2, value="Escenario:").font = FONT_LABEL_B
    ws.cell(row=4, column=4, value="=Inputs!$E$6").font = Font(bold=True, color=AZUL_TEXTO)

    fila_periodos = 6
    for i, lab in enumerate(model_refs["labels_periodo"]):
        ws.cell(row=fila_periodos, column=col_ini + i, value=lab).font = Font(bold=True, size=9)

    filas_kpi = [
        ("Ingresos Totales", model_refs["fila_ingresos"], False),
        ("Utilidad Operativa", model_refs["fila_utilidad_op"], False),
        ("Margen Operativo", model_refs["fila_margen_op"], True),
        ("Utilidad Neta", model_refs["fila_utilidad_neta"], False),
    ]
    fila_ref = {}
    r = fila_periodos + 1
    for nombre, fila_modelo, pct in filas_kpi:
        label(ws, r, nombre, bold=True)
        for c in range(col_ini, col_fin + 1):
            cl = get_column_letter(c)
            numero(ws, r, c, f"=Model!{cl}{fila_modelo}", pct=pct, bold=True)
        fila_ref[nombre] = r
        r += 1

    r += 2
    ws.cell(row=r, column=2, value="Detalle para gráficos").font = FONT_SUBTITULO
    r += 1
    for nombre, fila_modelo in [
        ("Ingresos Almuerzo", model_refs["fila_ing_alm"]),
        ("Ingresos Comidas Rápidas", model_refs["fila_ing_cena"]),
    ]:
        label(ws, r, nombre)
        for c in range(col_ini, col_fin + 1):
            cl = get_column_letter(c)
            numero(ws, r, c, f"=Model!{cl}{fila_modelo}")
        fila_ref[nombre] = r
        r += 1
    label(ws, r, "Costo de Insumos (% de Ingresos)")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=ABS(Model!{cl}{model_refs['fila_costo_insumos']})/Model!{cl}{model_refs['fila_ingresos']}", pct=True)
    fila_ref["Costo Insumos Pct"] = r
    r += 1

    r += 2
    ws.cell(row=r, column=2, value="📊 Ingresos vs. Utilidad Neta por mes").font = FONT_BANNER
    fila_chart_ancla = r + 1

    cats = Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_periodos)

    chart1 = BarChart()
    chart1.type = "col"
    chart1.title = "Ingresos vs. Utilidad Neta"
    chart1.y_axis.title = "COP"
    chart1.height, chart1.width = 8, 22
    # from_rows=True es clave: cada fila (Ingresos / Utilidad Neta) es UNA
    # serie con 18 puntos (uno por mes) — sin esto, openpyxl interpreta cada
    # COLUMNA como una serie distinta (18 series de 1 punto, se ve mal).
    chart1.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Ingresos Totales"]), titles_from_data=False, from_rows=True)
    chart1.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Utilidad Neta"]), titles_from_data=False, from_rows=True)
    chart1.series[0].tx = SeriesLabel(v="Ingresos Totales")
    chart1.series[1].tx = SeriesLabel(v="Utilidad Neta")
    chart1.set_categories(cats)
    chart1.series[0].graphicalProperties.solidFill = "4C7EA6"
    chart1.series[1].graphicalProperties.solidFill = "3FA66B"
    ws.add_chart(chart1, f"B{fila_chart_ancla}")

    r2 = fila_chart_ancla + 18
    ws.cell(row=r2, column=2, value="📈 Margen Operativo por mes").font = FONT_BANNER
    chart2 = LineChart()
    chart2.title = "Margen Operativo (%)"
    chart2.height, chart2.width = 8, 22
    chart2.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Margen Operativo"]), titles_from_data=False, from_rows=True)
    chart2.series[0].tx = SeriesLabel(v="Margen Operativo")
    chart2.set_categories(cats)
    ws.add_chart(chart2, f"B{r2 + 1}")

    # ── Gráfico 3: ¿en qué se va la plata? — barras horizontales, orden fijo
    # de mayor a menor gasto típico. Se evita un pie/donut a propósito: con
    # 4 categorías un ranking de barras se lee mejor que comparar ángulos.
    r3 = r2 + 18
    ws.cell(row=r3, column=2, value="💸 Distribución de Gastos por Categoría (histórico)").font = FONT_BANNER
    ws.column_dimensions["D"].width = 16
    fila_tabla_gastos = r3 + 2
    categorias_gasto = [
        ("Costo de Insumos", model_refs["fila_costo_insumos"], "1B4F72"),
        ("Nómina", model_refs["fila_nomina"], "3B6FA0"),
        ("Arriendo + Servicios", model_refs["fila_arriendo"], "6E97C4"),
        ("Otros Gastos", model_refs["fila_otros"], "A9C2DE"),
    ]
    col_hist_ini = get_column_letter(col_ini)
    col_hist_fin = get_column_letter(col_ini + model_refs["n_hist"] - 1)
    for i, (nombre, fila_modelo, _color) in enumerate(categorias_gasto):
        rr = fila_tabla_gastos + i
        label(ws, rr, nombre)
        numero(ws, rr, 4, f"=ABS(SUM(Model!{col_hist_ini}{fila_modelo}:{col_hist_fin}{fila_modelo}))")
    nota(ws, fila_tabla_gastos + len(categorias_gasto), "Suma de los meses históricos reales (no incluye proyección).")

    chart3 = BarChart()
    chart3.type = "bar"  # horizontal — más fácil de leer un ranking de 4 categorías
    chart3.title = "¿En qué se va la plata?"
    chart3.y_axis.title = "COP (histórico acumulado)"
    chart3.height, chart3.width = 8, 22
    data3 = Reference(ws, min_col=4, min_row=fila_tabla_gastos, max_row=fila_tabla_gastos + len(categorias_gasto) - 1)
    cats3 = Reference(ws, min_col=2, min_row=fila_tabla_gastos, max_row=fila_tabla_gastos + len(categorias_gasto) - 1)
    chart3.add_data(data3, titles_from_data=False)
    chart3.series[0].tx = SeriesLabel(v="Gasto histórico")
    chart3.set_categories(cats3)
    chart3.legend = None  # una sola serie con colores por categoría — la leyenda no aporta
    chart3.series[0].data_points = [
        DataPoint(idx=i, spPr=GraphicalProperties(solidFill=color))
        for i, (_n, _f, color) in enumerate(categorias_gasto)
    ]
    ws.add_chart(chart3, f"B{fila_tabla_gastos + len(categorias_gasto) + 2}")

    # ── Gráfico 4: composición de ingresos por turno, mes a mes (barras
    # apiladas) — muestra a la vez el volumen total y el mix Almuerzo/Cena.
    r4 = fila_tabla_gastos + len(categorias_gasto) + 2 + 18
    ws.cell(row=r4, column=2, value="🍽️ Ingresos por Turno — Almuerzo vs. Comidas Rápidas").font = FONT_BANNER
    chart4 = BarChart()
    chart4.type = "col"
    chart4.grouping = "stacked"
    chart4.overlap = 100
    chart4.title = "Composición de Ingresos por Turno"
    chart4.y_axis.title = "COP"
    chart4.height, chart4.width = 8, 22
    chart4.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Ingresos Almuerzo"]), titles_from_data=False, from_rows=True)
    chart4.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Ingresos Comidas Rápidas"]), titles_from_data=False, from_rows=True)
    chart4.series[0].tx = SeriesLabel(v="Almuerzo")
    chart4.series[1].tx = SeriesLabel(v="Comidas Rápidas")
    chart4.set_categories(cats)
    chart4.series[0].graphicalProperties.solidFill = "4C7EA6"
    chart4.series[1].graphicalProperties.solidFill = "D98B3F"
    ws.add_chart(chart4, f"B{r4 + 1}")

    # ── Gráfico 5: tendencia del costo de insumos como % de ingresos — para
    # detectar si el margen se está comiendo antes de que duela en la caja.
    r5 = r4 + 18
    ws.cell(row=r5, column=2, value="⚠️ Costo de Insumos como % de Ingresos (tendencia)").font = FONT_BANNER
    chart5 = LineChart()
    chart5.title = "Costo de Insumos (% de Ingresos)"
    chart5.height, chart5.width = 8, 22
    chart5.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Costo Insumos Pct"]), titles_from_data=False, from_rows=True)
    chart5.series[0].tx = SeriesLabel(v="Costo Insumos % Ingresos")
    chart5.series[0].graphicalProperties.line.solidFill = "C0392B"
    chart5.set_categories(cats)
    ws.add_chart(chart5, f"B{r5 + 1}")

    config_impresion(ws, horizontal=True)
    return ws


# ══════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo", nargs="?", help="Excel exportado desde la pestaña Datos")
    ap.add_argument("--demo", action="store_true", help="Usar datos de ejemplo")
    ap.add_argument("--meses-proyeccion", type=int, default=6)
    ap.add_argument("--salida", default="ElLobo_Modelo_Financiero.xlsx")
    args = ap.parse_args()

    if args.demo or not args.archivo:
        hist_df, extra = datos_de_ejemplo()
        es_demo = True
    else:
        hist_df, extra = cargar_datos_reales(args.archivo)
        es_demo = False

    if hist_df.empty:
        print("No se encontraron meses con datos en el archivo. Usa --demo para probar con datos de ejemplo.")
        sys.exit(1)

    ultimo = hist_df.iloc[-1]
    a, m = int(ultimo["anio"]), int(ultimo["mes"])
    meses_fcst_labels = []
    for _ in range(args.meses_proyeccion):
        m += 1
        if m > 12:
            m = 1
            a += 1
        meses_fcst_labels.append(f"{a}-{m:02d}")

    wb = Workbook()
    wb.remove(wb.active)

    hoja_cover(wb, len(hist_df), len(meses_fcst_labels), es_demo)
    ws_inputs, driver_rows = hoja_inputs(wb, meses_fcst_labels)
    ws_model, model_refs = hoja_model(wb, hist_df, meses_fcst_labels, extra, driver_rows)
    hoja_outputs(wb, model_refs)

    # Orden final de hojas: Cover, Outputs, Inputs, Model
    wb._sheets = [wb["Cover"], wb["Outputs"], wb["Inputs"], wb["Model"]]
    wb.active = 0

    wb.save(args.salida)
    print(f"✅ Modelo generado: {args.salida}  ({len(hist_df)} meses reales + {len(meses_fcst_labels)} proyectados)")


if __name__ == "__main__":
    main()
