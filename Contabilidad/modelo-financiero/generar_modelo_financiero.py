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

import re
import sys
import argparse
from datetime import date
from pathlib import Path

# El modelo generado SIEMPRE se guarda en esta misma carpeta
# (modelo-financiero/), sin importar desde qué directorio se corra el
# script — así no se dispersan copias sueltas en la raíz del repo o en
# donde sea que estuviera parada la terminal.
SCRIPT_DIR = Path(__file__).resolve().parent

# En Windows, la consola (cmd/PowerShell) no siempre usa UTF-8 por defecto,
# y los prints con emoji (✅) revientan con UnicodeEncodeError aunque el
# Excel se haya guardado bien. Forzamos UTF-8 en stdout/stderr para que el
# script corra igual en Windows/Mac/Linux sin depender de configurar
# PYTHONIOENCODING a mano.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

import numpy as np
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
# CAPA DE DATOS DIARIOS — funciones de módulo reutilizables (mensual y diario)
# ══════════════════════════════════════════════════════════════════════
# Rubros de egreso del modelo. MISMA regla que el Estado de Resultados
# mensual (ver suma_cat() más abajo): Egresos.cat y Gastos_Cierre.categoria →
# 4 rubros. "prestamo" (plata propia que se saca de la caja) se EXCLUYE: no es
# un gasto del negocio. Cualquier otra categoría es "huérfana": no se suma en
# ningún lado y se reporta por consola (nunca se reasigna en silencio).
MAPA_RUBRO = {
    "proveedor": "insumos",
    "nomina": "nomina",
    "arriendo": "arriendo_servicios",
    "servicios": "arriendo_servicios",
    "otro": "otros",
}
CATEGORIAS_EXCLUIDAS = {"prestamo"}
RUBROS = ["insumos", "nomina", "arriendo_servicios", "otros"]
RUBRO_LABEL = {
    "insumos": "Insumos", "nomina": "Nómina",
    "arriendo_servicios": "Arriendo + Servicios", "otros": "Otros",
}

# Catálogo de comida rápida: código de producto → categoría. ES UNA COPIA de
# PL.comidaRapida en "ElLobo-Sistema Contable.html" (campo "cat"): si allá se
# agregan o cambian productos, hay que mantener esta lista sincronizada a mano.
# Cada tupla es (prefijo del código, cuántos códigos hay, categoría) — p. ej.
# ("PE", 6, "PERROS") = PE01…PE06.
_CATALOGO_CR = [
    ("PE", 6, "PERROS"), ("HB", 2, "HAMBURGUESAS"), ("CRA", 3, "ASADOS"),
    ("PI", 5, "PICADAS"), ("SL", 4, "SALCHIPAPAS"), ("CU", 4, "SANDWICH CUBANO"),
    ("ARP", 11, "AREPAS"), ("SZ", 5, "SUIZOS"), ("ADI", 3, "ADICIONALES"),
    ("BEB", 6, "BEBIDAS"),
]
MAPA_CR_CATEGORIA = {f"{pre}{i:02d}": cat for pre, n, cat in _CATALOGO_CR for i in range(1, n + 1)}
CATEGORIAS_CR = [cat for _pre, _n, cat in _CATALOGO_CR]
# Los pedidos "extra" (productos sueltos: bebidas, botella de agua…) no traen
# código de catálogo, así que en comida rápida se agrupan aparte.
CATEGORIA_CR_EXTRAS = "EXTRAS"

LABEL_ALMUERZO = {
    "completo": "Completo", "seco": "Seco", "asado130": "Asado 130g", "asado200": "Asado 200g",
    "porcion-sopa": "Porción sopa", "porcion-arroz": "Porción arroz",
    "porcion-proteina": "Porción proteína", "sopa-y-arroz": "Sopa y arroz",
    "extra": "Productos extra",
}

DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _num(df, col):
    """Columna numérica (NaN si no es número) — o ceros si la columna no existe."""
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce")
    return pd.Series(0.0, index=df.index, dtype="float64")


def _bool(df, col):
    """Columna booleana robusta: True solo si el valor es literalmente True."""
    if col in df.columns:
        return df[col] == True  # noqa: E712 — NaN/None cuentan como False
    return pd.Series(False, index=df.index)


def ingresos_por_cierre(cierres):
    """Ingreso total de CADA cierre (una Serie alineada con cierres.index):
    efectivo + transferencia + ajuste manual (de efectivo y de transferencia) —
    MISMA fórmula que ajustesDeCierre() del sistema, para que cuadre con el
    KPI de Ingresos del Tablero. Los cierres viejos (anteriores a la
    separación del ajuste) solo traen "ajuste_manual", que siempre se trató
    como parte del efectivo."""
    if cierres is None or cierres.empty:
        return pd.Series(dtype="float64")
    if {"efectivo", "transferencia"}.issubset(cierres.columns):
        base = _num(cierres, "efectivo").fillna(0) + _num(cierres, "transferencia").fillna(0)
    else:
        base = pd.Series(0.0, index=cierres.index)
    if "ajuste_efectivo" in cierres.columns:
        ajuste_ef = _num(cierres, "ajuste_efectivo")
        if "ajuste_manual" in cierres.columns:
            ajuste_ef = ajuste_ef.fillna(_num(cierres, "ajuste_manual"))
    elif "ajuste_manual" in cierres.columns:
        ajuste_ef = _num(cierres, "ajuste_manual")
    else:
        ajuste_ef = pd.Series(0.0, index=cierres.index)
    ajuste_tr = _num(cierres, "ajuste_transferencia") if "ajuste_transferencia" in cierres.columns else pd.Series(0.0, index=cierres.index)
    return base + ajuste_ef.fillna(0) + ajuste_tr.fillna(0)


def ingreso_turno_cierres(cierres, turno):
    """Total real de un turno en el conjunto de cierres recibido (un mes, un
    día, lo que sea): efectivo + transferencia + ajustes. No se reconstruye
    sumando Pedidos_Pagados porque el desayuno (sumado al cierre de almuerzo
    al abrir el turno) y los ajustes manuales no generan filas de pedido.
    Antes vivía anidada dentro de cargar_datos_reales()."""
    if cierres is None or cierres.empty or "turno" not in cierres.columns:
        return 0.0
    del_turno = cierres[cierres["turno"] == turno]
    if del_turno.empty:
        return 0.0
    return float(ingresos_por_cierre(del_turno).sum())


def desayuno_por_dia(aperturas):
    """Venta de desayuno por fecha (Aperturas_Turno, turno almuerzo):
    venta_desayuno (efectivo) + venta_desayuno_transferencia."""
    if aperturas is None or aperturas.empty or not {"fecha", "turno"}.issubset(aperturas.columns):
        return pd.Series(dtype="float64")
    a = aperturas[aperturas["turno"] == "almuerzo"]
    total = _num(a, "venta_desayuno").fillna(0)
    if "venta_desayuno_transferencia" in a.columns:
        total = total + _num(a, "venta_desayuno_transferencia").fillna(0)
    return total.groupby(a["fecha"]).sum()


def ingresos_diarios(cierres, aperturas):
    """Ingreso por día en los 3 turnos del modelo (DataFrame indexado por fecha):
      desayuno · almuerzo_neto · comida_rapida · total · almuerzo_bruto.
    El cierre de ALMUERZO ya incluye el desayuno (se suma al abrir el turno),
    igual que "Ingresos Almuerzo" del Model; por eso Almuerzo neto = Almuerzo
    del cierre − desayuno. El desayuno solo se descuenta en días que tienen
    cierre de almuerzo (si no, nunca entró a los ingresos). Así, por
    construcción, desayuno + almuerzo_neto + comida_rapida = total."""
    cols = ["desayuno", "almuerzo_neto", "comida_rapida", "total", "almuerzo_bruto"]
    vacio = pd.DataFrame(columns=cols, index=pd.DatetimeIndex([], name="fecha"), dtype="float64")
    if cierres is None or cierres.empty or not {"fecha", "turno"}.issubset(cierres.columns):
        return vacio
    c = cierres.assign(_ing=ingresos_por_cierre(cierres))
    alm = c[c["turno"] == "almuerzo"].groupby("fecha")["_ing"].sum()
    cena = c[c["turno"] == "cena"].groupby("fecha")["_ing"].sum()
    idx = alm.index.union(cena.index)
    out = pd.DataFrame(index=idx)
    out.index.name = "fecha"
    tiene_alm = alm.reindex(idx).notna()
    out["almuerzo_bruto"] = alm.reindex(idx).fillna(0.0)
    out["comida_rapida"] = cena.reindex(idx).fillna(0.0)
    out["desayuno"] = desayuno_por_dia(aperturas).reindex(idx).fillna(0.0).where(tiene_alm, 0.0)
    out["almuerzo_neto"] = out["almuerzo_bruto"] - out["desayuno"]
    out["total"] = out["almuerzo_bruto"] + out["comida_rapida"]
    return out.sort_index()[cols]


def dias_operados(ingresos_dia):
    """Un "día operado" es una fecha con ingresos > 0 (igual que el KPI
    "Promedio por día" del Tablero). TODO promedio diario se divide por días
    operados, nunca por días calendario."""
    if ingresos_dia.empty:
        return pd.DatetimeIndex([], name="fecha")
    return ingresos_dia.index[ingresos_dia["total"] > 0]


def egresos_diarios(egresos, gastos_cierre):
    """Egresos por día y rubro, en formato largo (fecha, rubro, monto):
    Egresos (columna "cat") + Gastos_Cierre (columna "categoria"), mapeados a
    los 4 rubros del modelo con la misma regla EXACTA que suma_cat() mensual
    (coincidencia exacta de texto). Devuelve (egresos_largo, huerfanos):
    "prestamo" se descarta; una categoría fuera de MAPA_RUBRO (o vacía) es
    huérfana → no se suma y se lista en `huerfanos` (origen, categoria, n,
    monto) para reportarla — nunca se reasigna en silencio."""
    partes, huerfanas = [], []
    for origen, df, col in (("Egresos", egresos, "cat"), ("Gastos_Cierre", gastos_cierre, "categoria")):
        if df is None or df.empty or col not in df.columns or "fecha" not in df.columns:
            continue
        t = pd.DataFrame({"fecha": df["fecha"], "categoria": df[col], "monto": _num(df, "monto").fillna(0)})
        excluida = t["categoria"].isin(CATEGORIAS_EXCLUIDAS)
        rubro = t["categoria"].map(MAPA_RUBRO)
        huerf = rubro.isna() & ~excluida
        if huerf.any():
            h = t[huerf].assign(categoria=lambda d: d["categoria"].astype("object").where(d["categoria"].notna(), "<sin categoría>"))
            g = h.groupby("categoria")["monto"].agg(["count", "sum"]).reset_index()
            for _, fila in g.iterrows():
                huerfanas.append(dict(origen=origen, categoria=fila["categoria"], n=int(fila["count"]), monto=float(fila["sum"])))
        ok = t[rubro.notna()].assign(rubro=rubro[rubro.notna()])
        partes.append(ok[["fecha", "rubro", "monto"]])
    largo = pd.concat(partes, ignore_index=True) if partes else pd.DataFrame(columns=["fecha", "rubro", "monto"])
    return largo, pd.DataFrame(huerfanas, columns=["origen", "categoria", "n", "monto"])


def es_gratis(df):
    """Pedidos de ubicación "Gratis" (regalo de la casa / consumo de la
    familia en comida rápida). El sistema los guarda con es_gratis = TRUE y
    metodo = 'gratis' — se aceptan ambas marcas por si falta la columna."""
    return _bool(df, "es_gratis") | (df["metodo"] == "gratis" if "metodo" in df.columns else pd.Series(False, index=df.index))


def preparar_pedidos(pagados, pendientes):
    """Separa los pedidos en (pedidos, gratis):
      · pedidos = Pedidos_Pagados SIN los Gratis, normalizado, con las
        columnas derivadas que usan los gráficos (periodo, grupo de producto,
        canal). Los Gratis NUNCA entran a volúmenes, tickets, Pareto ni a
        ningún conteo de pedidos (los ingresos salen de los cierres).
      · gratis = pedidos Gratis, pagados (ya entregados) y pendientes, a
        precio de venta (monto_total)."""
    cols_num = ["cantidad", "monto_total", "monto_efectivo", "monto_transferencia"]
    def norm(df):
        if df is None or df.empty or "fecha" not in df.columns:
            return pd.DataFrame()
        d = df.copy()
        for c in cols_num:
            d[c] = _num(d, c).fillna(0)
        return d
    pag, pen = norm(pagados), norm(pendientes)
    gratis_partes = [d[es_gratis(d)] for d in (pag, pen) if not d.empty]
    gratis = pd.concat(gratis_partes, ignore_index=True) if gratis_partes else pd.DataFrame(columns=["fecha", "turno", "cantidad", "monto_total"])
    if not gratis.empty:
        gratis = gratis[["fecha", "turno", "cantidad", "monto_total"] + [c for c in ("grupo_pedido", "id", "pedido", "estado") if c in gratis.columns]]
    if pag.empty:
        return pd.DataFrame(columns=["fecha", "turno", "pedido", "cantidad", "monto_total"]), gratis
    ped = pag[~es_gratis(pag)].copy()
    ped["periodo"] = ped["fecha"].dt.to_period("M").astype(str)
    tipo = ped["pedido"].astype("object") if "pedido" in ped.columns else pd.Series("", index=ped.index)
    ped["grupo_producto"] = np.where(
        ped["turno"] == "almuerzo",
        tipo.map(lambda t: LABEL_ALMUERZO.get(t, str(t))),
        tipo.map(lambda t: MAPA_CR_CATEGORIA.get(t, CATEGORIA_CR_EXTRAS if t == "extra" else "OTROS")),
    )
    # Canal de venta: domicilio / para llevar (o sin mesa) / mesa.
    dom, llevar = _bool(ped, "es_domicilio"), _bool(ped, "para_llevar") | _bool(ped, "es_sin_mesa")
    con_mesa = ped["mesa"].notna() if "mesa" in ped.columns else pd.Series(False, index=ped.index)
    ped["canal"] = np.select([dom, llevar, con_mesa], ["Domicilio", "Para llevar / sin mesa", "Mesa"], default="Otro")
    # Cuánto de cada pedido entró en efectivo / transferencia — mismas reglas
    # que efectivoDe()/transferenciaDe() del sistema (el pago dividido guarda
    # su reparto exacto en monto_efectivo / monto_transferencia).
    met = ped["metodo"] if "metodo" in ped.columns else pd.Series("", index=ped.index)
    ped["pago_efectivo"] = np.where(met == "dividido", ped["monto_efectivo"], np.where(met == "efectivo", ped["monto_total"], 0.0))
    ped["pago_transferencia"] = np.where(met == "dividido", ped["monto_transferencia"], np.where(met == "transferencia", ped["monto_total"], 0.0))
    return ped, gratis


def construir_diario(cierres, aperturas, egresos, gastos_cierre, pagados, pendientes, hoy=None):
    """Arma el paquete de datos DIARIOS que comparten el modelo mensual y los
    gráficos (dict de DataFrames). Todo sale de las mismas hojas del export."""
    ing_dia = ingresos_diarios(cierres, aperturas)
    egr, huerf = egresos_diarios(egresos, gastos_cierre)
    ped, gratis = preparar_pedidos(pagados, pendientes)
    if cierres is not None and not cierres.empty and {"fecha", "turno"}.issubset(cierres.columns):
        cie = pd.DataFrame({
            "fecha": cierres["fecha"], "turno": cierres["turno"],
            "platos_familia": _num(cierres, "platos_familia"),  # NaN = "sin registro" (columna ausente = todo sin registro)
            "manual": _bool(cierres, "manual"),
        })
    else:
        cie = pd.DataFrame(columns=["fecha", "turno", "platos_familia", "manual"])
    fiados = pd.DataFrame(columns=["fecha", "monto_total"])
    if pendientes is not None and not pendientes.empty and "es_fiar" in pendientes.columns:
        f = pendientes[_bool(pendientes, "es_fiar")]
        fiados = pd.DataFrame({"fecha": f["fecha"], "monto_total": _num(f, "monto_total").fillna(0)})
    return dict(ingresos=ing_dia, egresos=egr, egresos_huerfanos=huerf, pedidos=ped, gratis=gratis,
                cierres=cie, fiados=fiados, hoy=hoy or date.today())


def enriquecer_hist(hist, diario):
    """Agrega a `hist` (una fila por mes real) lo que el modelo necesita de los
    datos DIARIOS — todo calculado por el script al generar el modelo:
      dias_operados · dias_alm_operados · dias_con_registro · platos_registrados ·
      valor_alm_registrado · suma_tickets_sin_registro · valor_cr_registrado ·
      gratis_alm_valor · gratis_cr_valor (consumo familiar y Gratis).
    ticket_d = (ingreso de almuerzo del día − desayuno del día) ÷ pedidos de
    almuerzo del día (Σ cantidad, SIN Gratis); si el día no tiene pedidos o no
    se puede calcular (p. ej. un cierre manual) se usa el ticket promedio real
    del mes (el del Revenue Schedule)."""
    ing, ped, cie, gr = diario["ingresos"], diario["pedidos"], diario["cierres"], diario["gratis"]
    h = hist.copy()
    h["_ticket_mes"] = (h["ingresos_almuerzo"] - h["ingresos_desayuno"]) / h["volumen_almuerzo"].clip(lower=1)
    ticket_mes = h.set_index("periodo")["_ticket_mes"]

    # días operados (cualquier turno) por mes
    op = dias_operados(ing)
    dias_op = pd.Series(1, index=op).groupby(op.to_period("M").astype(str)).sum() if len(op) else pd.Series(dtype=int)

    # almuerzo, día por día
    alm = ing[ing["almuerzo_bruto"] > 0].copy()
    alm["periodo"] = alm.index.to_period("M").astype(str)
    ped_alm = ped[ped["turno"] == "almuerzo"].groupby("fecha")["cantidad"].sum() if not ped.empty else pd.Series(dtype=float)
    alm["pedidos"] = ped_alm.reindex(alm.index).fillna(0)
    cie_alm = cie[cie["turno"] == "almuerzo"]
    pf = cie_alm.groupby("fecha")["platos_familia"].max() if not cie_alm.empty else pd.Series(dtype=float)
    alm["platos_familia"] = pf.reindex(alm.index)
    alm["ticket"] = (alm["almuerzo_neto"] / alm["pedidos"]).where((alm["pedidos"] > 0) & (alm["almuerzo_neto"] > 0))
    alm["ticket"] = alm["ticket"].fillna(alm["periodo"].map(ticket_mes))
    con = alm["platos_familia"].notna()
    por_mes = pd.DataFrame({
        "dias_alm_operados": alm.groupby("periodo").size(),
        "dias_con_registro": con.groupby(alm["periodo"]).sum(),
        "platos_registrados": alm["platos_familia"].where(con, 0).groupby(alm["periodo"]).sum(),
        "valor_alm_registrado": (alm["platos_familia"] * alm["ticket"]).where(con, 0).groupby(alm["periodo"]).sum(),
        "suma_tickets_sin_registro": alm["ticket"].where(~con, 0).groupby(alm["periodo"]).sum(),
    })
    # Gratis (a precio de venta): comida rápida = consumo de la familia REGISTRADO;
    # almuerzo = pedidos Gratis legados (anteriores a la regla "Gratis solo en comida rápida").
    if not gr.empty:
        g = gr.assign(periodo=gr["fecha"].dt.to_period("M").astype(str))
        gr_cr = g[g["turno"] == "cena"].groupby("periodo")["monto_total"].sum()
        gr_al = g[g["turno"] == "almuerzo"].groupby("periodo")["monto_total"].sum()
    else:
        gr_cr = gr_al = pd.Series(dtype=float)
    h = h.drop(columns="_ticket_mes").set_index("periodo")
    h["dias_operados"] = dias_op.reindex(h.index).fillna(0).astype(int)
    for c in por_mes.columns:
        h[c] = por_mes[c].reindex(h.index).fillna(0)
    for c in ("dias_alm_operados", "dias_con_registro"):
        h[c] = h[c].astype(int)
    h["valor_cr_registrado"] = gr_cr.reindex(h.index).fillna(0.0)
    h["gratis_alm_valor"] = gr_al.reindex(h.index).fillna(0.0)
    h["gratis_cr_valor"] = h["valor_cr_registrado"]
    return h.reset_index()


# ══════════════════════════════════════════════════════════════════════
# CARGA DE DATOS — desde el export real, o datos de EJEMPLO
# ══════════════════════════════════════════════════════════════════════
def cargar_datos_reales(path_excel):
    """Lee el archivo del botón 'Exportar a Excel' de la pestaña Datos (una
    hoja por tabla de Supabase) y arma (hist, extra, diario):
      hist   — DataFrame mensual (una fila por mes real)
      extra  — saldos puntuales para el Balance (caja, inventario, fiados)
      diario — datos por día para los gráficos (ver construir_diario())
    Ajusta los nombres de hoja/columna aquí si cambian en el sistema."""
    xls = pd.ExcelFile(path_excel)

    def hoja(nombre):
        return pd.read_excel(xls, nombre) if nombre in xls.sheet_names else pd.DataFrame()

    cierres = hoja("Cierres_Dia")
    pedidos = hoja("Pedidos_Pagados")
    egresos = hoja("Egresos")
    gastos_cierre = hoja("Gastos_Cierre")
    inventario = hoja("Inventario")
    movs_caja = hoja("Movimientos_Caja")
    pendientes = hoja("Pedidos_Pendientes")
    abonos = hoja("Abonos_Fiado")
    aperturas = hoja("Aperturas_Turno")

    for df in (cierres, pedidos, pendientes, egresos, gastos_cierre, movs_caja, aperturas):
        if not df.empty and "fecha" in df.columns:
            df["fecha"] = pd.to_datetime(df["fecha"])
            df["periodo"] = df["fecha"].dt.to_period("M")

    # OJO (sin cambiar a propósito, pendiente de decidir): por precedencia de
    # operadores esto se lee "A if hay_cierres else (set() | B)", así que
    # cuando existe Cierres_Dia NO se incorporan los meses que solo tienen
    # egresos. Con los datos actuales no se nota (no hay meses solo-egresos).
    meses = sorted(
        set(cierres["periodo"]) if "periodo" in cierres.columns else set()
        | (set(egresos["periodo"]) if "periodo" in egresos.columns else set())
    )

    # Los pedidos "Gratis" (regalos de la casa / consumo de la familia en
    # comida rápida) no son ventas: se excluyen de los VOLÚMENES (y, por tanto,
    # de los tickets) del Revenue Schedule. Los ingresos mensuales no cambian
    # porque salen de los cierres.
    pedidos_vendidos = pedidos[~es_gratis(pedidos)] if not pedidos.empty else pedidos

    filas = []
    for periodo in meses:
        ing_alm = pedidos_vendidos[(pedidos_vendidos.get("periodo") == periodo) & (pedidos_vendidos.get("turno") == "almuerzo")] if not pedidos_vendidos.empty else pd.DataFrame()
        ing_cena = pedidos_vendidos[(pedidos_vendidos.get("periodo") == periodo) & (pedidos_vendidos.get("turno") == "cena")] if not pedidos_vendidos.empty else pd.DataFrame()
        cierres_mes = cierres[cierres["periodo"] == periodo] if not cierres.empty else pd.DataFrame()
        egresos_mes = egresos[egresos["periodo"] == periodo] if not egresos.empty else pd.DataFrame()
        gastos_mes = gastos_cierre[gastos_cierre["periodo"] == periodo] if not gastos_cierre.empty else pd.DataFrame()
        aperturas_mes = aperturas[aperturas["periodo"] == periodo] if not aperturas.empty and "periodo" in aperturas.columns else pd.DataFrame()

        vol_alm = int(ing_alm["cantidad"].sum()) if not ing_alm.empty and "cantidad" in ing_alm else len(ing_alm)
        vol_cena = int(ing_cena["cantidad"].sum()) if not ing_cena.empty and "cantidad" in ing_cena else len(ing_cena)
        # Ingresos: SIEMPRE desde Cierres_Dia (igual que renderTablero() del
        # sistema) y no sumando Pedidos_Pagados — el desayuno se suma directo
        # al cierre de almuerzo al abrir el turno (calcularVentasFijas()) y
        # los ajustes manuales de cierre tampoco generan fila de pedido, así
        # que sumar solo pedidos siempre se quedaba corto frente al Tablero.
        ingresos_alm = ingreso_turno_cierres(cierres_mes, "almuerzo")
        ingresos_cena = ingreso_turno_cierres(cierres_mes, "cena")
        if not aperturas_mes.empty and {"turno", "venta_desayuno"}.issubset(aperturas_mes.columns):
            desayuno_mes = aperturas_mes[aperturas_mes["turno"] == "almuerzo"]
            ingresos_desayuno = float(desayuno_mes["venta_desayuno"].fillna(0).sum())
            if "venta_desayuno_transferencia" in desayuno_mes.columns:
                ingresos_desayuno += float(desayuno_mes["venta_desayuno_transferencia"].fillna(0).sum())
        else:
            ingresos_desayuno = 0.0

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
            ingresos_almuerzo=ingresos_alm,
            ingresos_cena=ingresos_cena,
            volumen_almuerzo=max(vol_alm, 1), volumen_cena=max(vol_cena, 1),
            costo_insumos=costo_insumos, nomina=nomina,
            arriendo_servicios=arriendo_serv, otros_gastos=otros,
            ingresos_desayuno=ingresos_desayuno,
        ))

    hist = pd.DataFrame(filas).sort_values("periodo").reset_index(drop=True)

    # Datos DIARIOS (gráficos + consumo familiar) y lo que de ellos necesita
    # el modelo mensual. `periodo` es solo auxiliar de arriba: se descarta.
    diario = construir_diario(
        cierres.drop(columns="periodo", errors="ignore"), aperturas.drop(columns="periodo", errors="ignore"),
        egresos.drop(columns="periodo", errors="ignore"), gastos_cierre.drop(columns="periodo", errors="ignore"),
        pedidos.drop(columns="periodo", errors="ignore"), pendientes.drop(columns="periodo", errors="ignore"),
    )
    if not hist.empty:
        hist = enriquecer_hist(hist, diario)

    # "monto" en movimientos_caja SIEMPRE se guarda positivo (ver
    # agregarMovimientoCaja() en el HTML) — el signo lo da "tipo": 'aporte'
    # suma, 'gasto' resta, 'traspaso' es neto $0 (solo mueve plata entre las
    # 3 cuentas, no entra ni sale del negocio). Sumar "monto" tal cual, sin
    # mirar "tipo", inflaba caja_acumulada cada vez que había un gasto o un
    # traspaso registrado como movimiento de Caja.
    if not movs_caja.empty and {"monto", "tipo"}.issubset(movs_caja.columns):
        signo = movs_caja["tipo"].map({"aporte": 1, "gasto": -1, "traspaso": 0}).fillna(0)
        caja_acumulada = float((movs_caja["monto"] * signo).sum())
    else:
        caja_acumulada = None
    valor_inventario = None
    if not inventario.empty and {"stock", "costo"}.issubset(inventario.columns):
        valor_inventario = float((inventario["stock"] * inventario["costo"]).sum())

    cuentas_por_cobrar_fiados = calcular_cuentas_por_cobrar_fiados(pendientes, abonos, pedidos)

    return hist, {
        "caja_acumulada": caja_acumulada,
        "valor_inventario": valor_inventario,
        "cuentas_por_cobrar_fiados": cuentas_por_cobrar_fiados,
    }, diario


def calcular_cuentas_por_cobrar_fiados(pendientes, abonos, pagados):
    """saldo_cliente = pendiente_cliente - max(0, abonos_cliente -
    pagado_via_abono_cliente). Total = suma de saldo_cliente > 0 entre
    todos los clientes, más los fiados pendientes sin cliente_fiado_id
    asignado (huérfanos — siguen siendo plata por cobrar aunque
    todavía no tengan a quién cobrarle).

    Misma fórmula que calcularSaldoFiado() y gruposFiadoHuerfanos() en el
    sistema JS (ElLobo-Sistema Contable.html), para que este número cuadre
    con lo que muestra la pestaña Fiados y el aviso del Tablero."""
    if pendientes.empty or "es_fiar" not in pendientes.columns:
        return 0.0
    fiados_pend = pendientes[pendientes["es_fiar"] == True]
    if fiados_pend.empty:
        return 0.0
    con_cliente = fiados_pend[fiados_pend["cliente_fiado_id"].notna()]
    huerfanos = fiados_pend[fiados_pend["cliente_fiado_id"].isna()]
    total_huerfanos = float(huerfanos["monto_total"].sum())
    if con_cliente.empty:
        return total_huerfanos
    pendiente_por_cliente = con_cliente.groupby("cliente_fiado_id")["monto_total"].sum()
    abonos_por_cliente = (
        abonos.groupby("cliente_fiado_id")["monto"].sum()
        if not abonos.empty and "cliente_fiado_id" in abonos.columns
        else pd.Series(dtype=float)
    )
    if not pagados.empty and "pagado_via_abono" in pagados.columns and "cliente_fiado_id" in pagados.columns:
        pagado_via_abono_por_cliente = (
            pagados[pagados["pagado_via_abono"] == True]
            .groupby("cliente_fiado_id")["monto_total"].sum()
        )
    else:
        pagado_via_abono_por_cliente = pd.Series(dtype=float)
    saldo = pendiente_por_cliente.subtract(
        abonos_por_cliente.subtract(pagado_via_abono_por_cliente, fill_value=0).clip(lower=0),
        fill_value=0
    )
    return float(saldo[saldo > 0.5].sum()) + total_huerfanos


def datos_de_ejemplo(n_meses=12):
    """Meses de datos ILUSTRATIVOS (no son datos reales de El Lobo), solo
    para poder ver y probar la estructura del modelo. Devuelve (hist, extra,
    diario) — igual que cargar_datos_reales(). Los datos DIARIOS se generan
    coherentes con los mensuales (mismos totales, sin domingos) y pasan por
    exactamente el mismo código que los datos reales (construir_diario)."""
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
            ingresos_desayuno=round(ing_alm * 0.08, -3),
        ))
    hist = pd.DataFrame(filas)
    extra = {
        "caja_acumulada": 8_400_000,
        "valor_inventario": 1_650_000,
        "cuentas_por_cobrar_fiados": 950_000,
    }
    diario = _diario_de_ejemplo(hist, hoy)
    hist = enriquecer_hist(hist, diario)
    return hist, extra, diario


def _repartir(total, pesos, paso=100):
    """Reparte `total` en partes proporcionales a `pesos`, redondeadas al
    `paso` más cercano; la última absorbe el resto, así la suma es EXACTA."""
    pesos = [float(p) for p in pesos]
    s = sum(pesos)
    if not pesos or s <= 0:
        return []
    partes = [int(round(total * p / s / paso)) * paso for p in pesos[:-1]]
    partes.append(int(total) - sum(partes))
    if partes[-1] < 0:  # rarísimo (total diminuto): se le quita a la parte más grande
        k = max(range(len(partes) - 1), key=lambda j: partes[j]) if len(partes) > 1 else 0
        partes[k] += partes[-1]
        partes[-1] = 0
    return partes


def _diario_de_ejemplo(hist, hoy):
    """Datos diarios SINTÉTICOS coherentes con `hist` (mismos totales
    mensuales, exactos): cierres, aperturas (desayuno), egresos, pedidos
    (incluye algunos Gratis de comida rápida), consumo familiar registrado en
    los últimos meses y fiados pendientes. Sin domingos."""
    import random
    rng = random.Random(11)
    peso_alm = {0: 0.95, 1: 0.97, 2: 1.00, 3: 1.02, 4: 1.25, 5: 1.10}
    peso_cr = {0: 0.60, 1: 0.70, 2: 0.80, 3: 0.90, 4: 1.30, 5: 1.50}
    # (tipo de pedido, precio unitario, peso en la mezcla) — solo para repartir montos en el demo
    mezcla_alm = [("completo", 14000, .55), ("seco", 12000, .17), ("asado130", 17000, .10), ("porcion-sopa", 6000, .06),
                  ("sopa-y-arroz", 11000, .04), ("asado200", 20000, .02), ("porcion-arroz", 4000, .03),
                  ("porcion-proteina", 8000, .02), ("extra", 3000, .01)]
    mezcla_cr = [("PE01", 5000, .12), ("PE02", 7000, .08), ("ARP01", 7000, .14), ("ARP02", 8000, .08), ("SL02", 16000, .09),
                 ("SL01", 12000, .06), ("HB01", 14000, .05), ("HB02", 20000, .03), ("CU01", 6000, .09), ("PI04", 20000, .03),
                 ("CRA02", 16000, .05), ("SZ03", 16000, .03), ("BEB01", 4000, .06), ("extra", 3000, .06), ("ADI01", 5000, .03)]
    proteinas = ["Pollo Guisado", "Carne Desmechada", "Cerdo Encebollado", "Pollo Frito", "Chuleta Frita/BBQ", "Carne Molida"]
    cierres, aperturas, egresos, gastos, pagados, pendientes = [], [], [], [], [], []
    n = len(hist)

    def eleg(mezcla):
        return rng.choices(mezcla, weights=[m[2] for m in mezcla])[0]

    for k, r in hist.iterrows():
        a, m = int(r["anio"]), int(r["mes"])
        dias = [d for d in pd.date_range(f"{a}-{m:02d}-01", periods=pd.Period(f"{a}-{m:02d}").days_in_month) if d.dayofweek != 6]
        for _ in range(rng.randint(0, 2)):  # festivos: se cae algún día
            if len(dias) > 22:
                dias.pop(rng.randrange(len(dias)))
        w_a = [peso_alm[d.dayofweek] * rng.uniform(.85, 1.15) for d in dias]
        w_c = [peso_cr[d.dayofweek] * rng.uniform(.85, 1.15) for d in dias]
        des_m = int(r["ingresos_desayuno"])
        alm_neto = _repartir(int(r["ingresos_almuerzo"]) - des_m, w_a)
        desay = _repartir(des_m, [rng.uniform(.5, 1.5) for _ in dias])
        cena = _repartir(int(r["ingresos_cena"]), w_c)
        vol_a = _repartir(int(r["volumen_almuerzo"]), w_a, paso=1)
        vol_c = _repartir(int(r["volumen_cena"]), w_c, paso=1)
        reciente = k >= n - 3          # los últimos 3 meses ya registran el consumo familiar
        manual_dia = dias[len(dias) // 2] if k >= n - 2 else None   # un cierre manual (sin pedidos) por mes reciente
        for j, d in enumerate(dias):
            f = d.date().isoformat()
            bruto = alm_neto[j] + desay[j]
            ef = int(round(bruto * rng.uniform(.55, .70), -2))
            aj = rng.choice([0] * 14 + [-2000, 3000]) if bruto else 0
            pf = (float(rng.choice([8, 9, 9, 10])) if rng.random() > .15 else None) if reciente else None
            cierres.append(dict(fecha=f, turno="almuerzo", efectivo=ef, transferencia=bruto - ef, ajuste_efectivo=aj,
                                ajuste_transferencia=0, manual=(manual_dia is not None and d == manual_dia), platos_familia=pf))
            efc = int(round(cena[j] * rng.uniform(.50, .65), -2))
            cierres.append(dict(fecha=f, turno="cena", efectivo=efc, transferencia=cena[j] - efc, ajuste_efectivo=0,
                                ajuste_transferencia=0, manual=False, platos_familia=None))
            dd_ef = int(round(desay[j] * .7, -2))
            aperturas.append(dict(fecha=f, turno="almuerzo", caja_inicial=50000, venta_desayuno=dd_ef, venta_desayuno_transferencia=desay[j] - dd_ef))
            aperturas.append(dict(fecha=f, turno="cena", caja_inicial=30000, venta_desayuno=0, venta_desayuno_transferencia=0))
            # pedidos del día (el día del cierre manual no tiene pedidos registrados)
            for turno, vol, ingreso, mezcla in (("almuerzo", vol_a[j], alm_neto[j], mezcla_alm), ("cena", vol_c[j], cena[j], mezcla_cr)):
                if manual_dia is not None and d == manual_dia and turno == "almuerzo":
                    continue
                filas_d, resto = [], vol
                while resto > 0:
                    cant = 2 if (resto >= 2 and rng.random() < .05) else 1
                    cod, precio, _w = eleg(mezcla)
                    filas_d.append((cod, precio, cant))
                    resto -= cant
                montos = _repartir(ingreso, [p * c for _cod, p, c in filas_d]) if filas_d else []
                for (cod, precio, cant), monto in zip(filas_d, montos):
                    met = rng.choices(["efectivo", "transferencia", "dividido"], weights=[.65, .28, .07])[0]
                    mef = int(round(monto / 2, -2)) if met == "dividido" else 0
                    dom, sin_mesa = rng.random() < .20, rng.random() < .08
                    pagados.append(dict(
                        fecha=f, hora=f"{(rng.randint(11, 14) if turno == 'almuerzo' else rng.randint(17, 21)):02d}:{rng.randint(0, 59):02d}",
                        turno=turno, pedido=cod, cantidad=cant, monto_total=monto, metodo=met,
                        monto_efectivo=mef, monto_transferencia=(monto - mef) if met == "dividido" else 0,
                        es_domicilio=dom, es_sin_mesa=(not dom) and sin_mesa, para_llevar=(not dom) and rng.random() < .15,
                        mesa=None if (dom or sin_mesa) else rng.randint(1, 8),
                        proteina=rng.choice(proteinas) if (turno == "almuerzo" and cod in ("completo", "seco", "asado130", "asado200")) else None,
                        es_gratis=False, estado="pagado"))
        # Pedidos Gratis de comida rápida (consumo de la familia a precio de venta) — no suman a ingresos
        for d in rng.sample(dias, 3):
            cod, precio, _w = eleg(mezcla_cr)
            pagados.append(dict(fecha=d.date().isoformat(), hora="20:15", turno="cena", pedido=cod, cantidad=1, monto_total=precio,
                                metodo="gratis", monto_efectivo=0, monto_transferencia=0, es_domicilio=False, es_sin_mesa=False,
                                para_llevar=False, mesa=3, proteina=None, es_gratis=True, estado="pagado"))
        # Egresos del mes, repartidos en sus fechas reales (suma EXACTA por rubro). "prestamo" va aparte y se excluye.
        d_ops = [d.date().isoformat() for d in dias]
        compras = sorted(rng.sample(d_ops, 9))
        for f, v in zip(compras, _repartir(int(r["costo_insumos"]), [rng.uniform(.5, 1.5) for _ in compras], paso=100)):
            if rng.random() < .3:   # parte de las compras se anotó como gasto de cierre, parte como egreso
                gastos.append(dict(fecha=f, turno="almuerzo", nombre="Compra de insumos", monto=v, categoria="proveedor"))
            else:
                egresos.append(dict(fecha=f, cat="proveedor", monto=v))
        for f, v in zip(d_ops, _repartir(int(r["nomina"]), [1] * len(d_ops))):
            gastos.append(dict(fecha=f, turno="almuerzo", nombre="Nómina del día", monto=v, categoria="nomina"))
        arriendo = int(r["arriendo_servicios"] * .8)
        egresos.append(dict(fecha=f"{a}-{m:02d}-03", cat="arriendo", monto=arriendo))
        egresos.append(dict(fecha=f"{a}-{m:02d}-10", cat="servicios", monto=int(r["arriendo_servicios"]) - arriendo))
        for f, v in zip(sorted(rng.sample(d_ops, 4)), _repartir(int(r["otros_gastos"]), [1, 1, 1, 1])):
            egresos.append(dict(fecha=f, cat="otro", monto=v))
        for f in rng.sample(d_ops, 2):
            gastos.append(dict(fecha=f, turno="cena", nombre="Cambio para vueltos", monto=50000, categoria="prestamo"))
    # Fiados pendientes (para el gráfico de antigüedad): fechas relativas a hoy
    for _ in range(7):
        pendientes.append(dict(fecha=(hoy - pd.Timedelta(days=rng.randint(1, 60))).isoformat(), es_fiar=True,
                               monto_total=rng.choice([20000, 35000, 60000, 90000, 150000]), estado="pendiente"))

    def df(filas, cols):
        d = pd.DataFrame(filas, columns=cols)
        d["fecha"] = pd.to_datetime(d["fecha"])
        return d
    return construir_diario(
        df(cierres, ["fecha", "turno", "efectivo", "transferencia", "ajuste_efectivo", "ajuste_transferencia", "manual", "platos_familia"]),
        df(aperturas, ["fecha", "turno", "caja_inicial", "venta_desayuno", "venta_desayuno_transferencia"]),
        df(egresos, ["fecha", "cat", "monto"]),
        df(gastos, ["fecha", "turno", "nombre", "monto", "categoria"]),
        df(pagados, ["fecha", "hora", "turno", "pedido", "cantidad", "monto_total", "metodo", "monto_efectivo", "monto_transferencia",
                     "es_domicilio", "es_sin_mesa", "para_llevar", "mesa", "proteina", "es_gratis", "estado"]),
        df(pendientes, ["fecha", "es_fiar", "monto_total", "estado"]),
        hoy=hoy,
    )


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
    # Fila donde vive el caso "Base" de cada driver (3 filas debajo de la fila
    # del resultado, ver bloque_driver): el Plan (Datos_Graficos) lo usa SIEMPRE,
    # sin importar qué escenario esté activo en Inputs!E6.
    for k in ("crecimiento_almuerzo", "crecimiento_cena", "costo_insumos_pct", "inflacion_gastos"):
        driver_rows[k + "_base"] = driver_rows[k] + 3

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
    fila_desayuno = r
    label(ws, r, "· de los cuales, venta de desayuno (informativo)")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, float(hist_df.iloc[i]["ingresos_desayuno"]))
    r += 1
    fila_vol_alm = r
    label(ws, r, "Volumen pedidos — Almuerzo")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, int(hist_df.iloc[i]["volumen_almuerzo"]))
    r += 1
    fila_tkt_alm = r
    label(ws, r, "Ticket promedio — Almuerzo")
    for c in range(col_ini, col_ini + n_hist):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=({cl}{fila_ing_alm}-{cl}{fila_desayuno})/{cl}{fila_vol_alm}")
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
    # Este saldo es un SNAPSHOT de HOY (calculado desde Pedidos_Pendientes +
    # Abonos_Fiado en el momento de exportar) — a diferencia de Caja o
    # Inventario, no hay forma de reconstruir "cuánto se debía en marzo",
    # así que solo va en la última columna histórica (el mes más reciente)
    # y se sostiene plano en la proyección; los meses históricos previos
    # quedan [PENDIENTE] con una nota que explica por qué.
    cxc = extra.get("cuentas_por_cobrar_fiados")
    if cxc is not None and n_hist:
        for i in range(n_hist - 1):
            numero(ws, r, col_ini + i, "[PENDIENTE — sin historial, solo hay snapshot de hoy]", pendiente=True)
        numero(ws, r, col_ini + n_hist - 1, cxc)
        for c in cols_fcst:
            numero(ws, r, c, cxc)
    else:
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
    nota(ws, r + 1, "No da 0 todavía a propósito: Aportes de Capital está [PENDIENTE] en todos los meses, y Cuentas por Cobrar lo está solo en los meses históricos previos al más reciente (no hay forma de reconstruir su saldo de meses pasados) — al completarlos, cuadra.")
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
# HOJA: DATOS_GRAFICOS — tablas de apoyo de los gráficos nuevos
# ══════════════════════════════════════════════════════════════════════
def _mes_siguiente(periodo):
    a, m = int(periodo[:4]), int(periodo[5:])
    return f"{a + (m == 12)}-{(m % 12) + 1:02d}"


def etiqueta_mes(periodo, corto=True):
    """'2026-09' → 'sep-26' (o 'sep 2026' si corto=False)."""
    a, m = int(periodo[:4]), int(periodo[5:])
    return f"{MESES_ES[m - 1]}-{str(a)[2:]}" if corto else f"{MESES_ES[m - 1]} {a}"


class DatosGraficos:
    """Hoja de apoyo: cada gráfico nuevo lee de una tabla de esta hoja. Cada
    tabla se abre con un banner y una línea de ORIGEN que dice de dónde salen
    los números: FÓRMULAS hacia Model/Inputs (cuando el dato ya está en el
    modelo) o "calculado por el script al generar el modelo" (lo que Model no
    tiene: diario, día de la semana, pedidos). Las tablas mensuales ponen el
    mes i en la columna COL_DATO + i."""
    COL_DATO = 3   # C: primera columna de datos (B lleva las etiquetas)

    def __init__(self, wb, ancho_cols=32):
        ws = wb.create_sheet("Datos_Graficos")
        ws.sheet_view.showGridLines = False
        ws.column_dimensions["A"].width = 2
        ws.column_dimensions["B"].width = 44
        for c in range(self.COL_DATO, self.COL_DATO + ancho_cols):
            ws.column_dimensions[get_column_letter(c)].width = 12
        self.ws, self.col_fin = ws, self.COL_DATO + ancho_cols - 1
        banner(ws, 2, "Datos de apoyo de los gráficos", col_fin=self.col_fin)
        nota(ws, 3, "Esta hoja alimenta A_Resultado, B_Ingresos, C_Egresos, E_Proyeccion, F_Familia y G_Extras. No la edites: se regenera con el script. "
                    "Valores en $ millones (mensual) o $ miles (diario) donde el gráfico lo pide.")
        self.fila = 5
        self.refs = {}

    def col(self, i):
        """Columna (número) de la hoja donde va el mes i de una tabla mensual."""
        return self.COL_DATO + i

    def seccion(self, titulo, origen):
        """Abre una tabla (banner + línea de origen) y devuelve la primera fila libre."""
        banner(self.ws, self.fila, titulo, col_fin=self.col_fin)
        nota(self.ws, self.fila + 1, origen)
        return self.fila + 3

    def cerrar(self, ultima_fila):
        """Deja la siguiente tabla 3 filas debajo de la última escrita."""
        self.fila = ultima_fila + 3


def tabla_plan(dg, ctx):
    """PLAN = proyección del escenario BASE a un mes: para cada mes real que
    tenga un mes anterior real, parte del real de ese mes anterior (hoja
    Model) y aplica los drivers del caso Base del PRIMER mes proyectado
    (hoja Inputs) — crecimiento de almuerzo y de comida rápida, costo de
    insumos % e inflación de gastos fijos. No hay presupuesto congelado: el
    Plan se recalcula con las fórmulas (si cambias los drivers Base, cambia).
    Meses sin Plan (el primer mes real, o uno sin mes anterior real) quedan
    en blanco. Plan anual = SUMA de los Plan mensuales (para meses sin real,
    la proyección del modelo)."""
    ws, mr, dr = dg.ws, ctx["mr"], ctx["dr"]
    labels, n_hist = mr["labels_periodo"], mr["n_hist"]
    r0 = dg.seccion(
        "Plan = proyección Base a un mes",
        "FÓRMULAS: real del mes anterior (Model) × drivers del caso Base del primer mes proyectado (Inputs). Pesos ($). Solo meses reales con mes anterior real.")
    for i, lab in enumerate(labels):
        c = ws.cell(row=r0, column=dg.col(i), value=lab)
        c.font = Font(bold=True, color=NEGRO if i < n_hist else AZUL_TEXTO)
        c.alignment = Alignment(horizontal="center")
    nombres = ["ing_alm", "ing_cena", "ingresos", "insumos", "nomina", "arriendo", "otros", "egresos", "utilidad"]
    titulos = ["Plan Ingresos Almuerzo", "Plan Ingresos Comidas Rápidas", "Plan Ingresos Totales", "Plan Insumos", "Plan Nómina",
               "Plan Arriendo + Servicios", "Plan Otros Gastos", "Plan Egresos Totales", "Plan Utilidad Neta"]
    filas = {n: r0 + 1 + k for k, n in enumerate(nombres)}
    for n, t in zip(nombres, titulos):
        label(ws, filas[n], t, bold=n in ("ingresos", "egresos", "utilidad"))
    tiene_plan = [False] * len(labels)
    if ctx["fcst"]:
        for i in range(1, n_hist):
            tiene_plan[i] = labels[i] == _mes_siguiente(labels[i - 1])
        base_f = lambda k: f"Inputs!$F${dr[k + '_base']}"
        for i in range(n_hist):
            if not tiene_plan[i]:
                continue
            c, cl = dg.col(i), get_column_letter(dg.col(i))
            cp = get_column_letter(mr["col_ini"] + i - 1)  # columna del mes anterior en Model
            f = lambda n: f"{cl}{filas[n]}"
            numero(ws, filas["ing_alm"], c, f"=Model!{cp}{mr['fila_ing_alm']}*(1+{base_f('crecimiento_almuerzo')})")
            numero(ws, filas["ing_cena"], c, f"=Model!{cp}{mr['fila_ing_cena']}*(1+{base_f('crecimiento_cena')})")
            numero(ws, filas["ingresos"], c, f"={f('ing_alm')}+{f('ing_cena')}", bold=True)
            numero(ws, filas["insumos"], c, f"={f('ingresos')}*{base_f('costo_insumos_pct')}")
            numero(ws, filas["nomina"], c, f"=ABS(Model!{cp}{mr['fila_nomina']})*(1+{base_f('inflacion_gastos')})")
            numero(ws, filas["arriendo"], c, f"=ABS(Model!{cp}{mr['fila_arriendo']})*(1+{base_f('inflacion_gastos')})")
            numero(ws, filas["otros"], c, f"=ABS(Model!{cp}{mr['fila_otros']})*(1+{base_f('inflacion_gastos')})")
            numero(ws, filas["egresos"], c, f"=SUM({f('insumos')}:{f('otros')})", bold=True)
            numero(ws, filas["utilidad"], c, f"={f('ingresos')}-{f('egresos')}", bold=True)
    ultima = filas["utilidad"]
    if not any(tiene_plan):
        nota(ws, ultima + 1, "Sin Plan: no hay ningún mes real con un mes anterior real (o no hay meses proyectados). Los elementos que dependen del Plan se omiten.")
        ultima += 1
    dg.refs["plan"] = dict(filas=filas, tiene_plan=tiene_plan, r_cab=r0)
    dg.cerrar(ultima)


def resolver_mes_foco(mes_arg, hist_df):
    """Mes en foco de los gráficos mensuales (--mes AAAA-MM). Por defecto, el
    último mes con datos reales. Debe ser un mes real (de `hist_df`)."""
    disponibles = list(hist_df["periodo"])
    if mes_arg is None:
        return disponibles[-1]
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes_arg or ""):
        print(f"--mes debe tener formato AAAA-MM (recibido: {mes_arg!r}).")
        sys.exit(1)
    if mes_arg not in disponibles:
        print(f"--mes {mes_arg} no tiene datos reales. Meses disponibles: {', '.join(disponibles)}")
        sys.exit(1)
    return mes_arg


def reportar_huerfanas(diario):
    """Avisa (sin cambiar nada) si hay egresos con una categoría fuera de los
    4 rubros del modelo: esas filas NO se suman en ningún lado."""
    h = diario["egresos_huerfanos"]
    if h is None or h.empty:
        return
    print("⚠ Categorías de egreso fuera de los 4 rubros del modelo (NO se suman; revisa si deben reasignarse):")
    for _, f in h.iterrows():
        print(f"    {f['origen']}: categoría {f['categoria']!r} — {int(f['n'])} fila(s), ${f['monto']:,.0f}")


def etiquetas_proyeccion(hist_df, hasta, meses_proyeccion):
    """Etiquetas AAAA-MM de los meses proyectados, a partir del último mes real.
    --meses-proyeccion N (si se pasó) manda; si no, se proyecta hasta --hasta."""
    ultimo = hist_df.iloc[-1]
    a, m = int(ultimo["anio"]), int(ultimo["mes"])
    if meses_proyeccion is not None:
        n = meses_proyeccion
    else:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", hasta or ""):
            print(f"--hasta debe tener formato AAAA-MM (recibido: {hasta!r}).")
            sys.exit(1)
        n = (int(hasta[:4]) - a) * 12 + (int(hasta[5:]) - m)
        if n < 1:
            print(f"--hasta {hasta} no es posterior al último mes real ({a}-{m:02d}): no habría meses que proyectar.")
            sys.exit(1)
    etiquetas = []
    for _ in range(n):
        m += 1
        if m > 12:
            m = 1
            a += 1
        etiquetas.append(f"{a}-{m:02d}")
    return etiquetas


# ══════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo", nargs="?", help="Excel exportado desde la pestaña Datos")
    ap.add_argument("--demo", action="store_true", help="Usar datos de ejemplo")
    ap.add_argument("--hasta", default="2027-12", metavar="AAAA-MM", help=(
        "Último mes de la proyección (por defecto 2027-12): el script calcula solo "
        "cuántos meses proyectar a partir del último mes real."
    ))
    ap.add_argument("--meses-proyeccion", type=int, default=None, help=(
        "Alternativa a --hasta: cantidad de meses a proyectar hacia adelante. "
        "Si se pasa, manda sobre --hasta."
    ))
    ap.add_argument("--mes", default=None, metavar="AAAA-MM", help=(
        "Mes en foco de los gráficos mensuales (por defecto, el último mes con datos reales)."
    ))
    ap.add_argument("--salida", default=None, help=(
        "Nombre del archivo generado. Por defecto se arma solo — "
        "ElLobo_Modelo_Financiero_DEMO.xlsx o _REAL.xlsx según el modo — y "
        "se guarda en esta misma carpeta (modelo-financiero/), sin importar "
        "desde dónde se corra el script. Si das un nombre suelto (sin ruta) "
        "también se guarda aquí; si das una ruta con carpeta, se respeta tal cual."
    ))
    args = ap.parse_args()

    if args.demo or not args.archivo:
        hist_df, extra, diario = datos_de_ejemplo()
        es_demo = True
    else:
        hist_df, extra, diario = cargar_datos_reales(args.archivo)
        es_demo = False

    # Nombre + carpeta de salida: siempre deja claro si es DEMO o REAL (para
    # no confundir un modelo de prueba con uno de datos reales del negocio),
    # y siempre aterriza en esta carpeta salvo que se pida una ruta explícita
    # con directorio propio.
    if args.salida:
        salida_path = Path(args.salida)
        if not salida_path.is_absolute() and salida_path.parent == Path("."):
            salida_path = SCRIPT_DIR / salida_path.name
    else:
        sufijo = "DEMO" if es_demo else "REAL"
        salida_path = SCRIPT_DIR / f"ElLobo_Modelo_Financiero_{sufijo}.xlsx"

    if hist_df.empty:
        print("No se encontraron meses con datos en el archivo. Usa --demo para probar con datos de ejemplo.")
        sys.exit(1)

    mes_foco = resolver_mes_foco(args.mes, hist_df)
    reportar_huerfanas(diario)

    meses_fcst_labels = etiquetas_proyeccion(hist_df, args.hasta, args.meses_proyeccion)

    wb = Workbook()
    wb.remove(wb.active)

    hoja_cover(wb, len(hist_df), len(meses_fcst_labels), es_demo)
    ws_inputs, driver_rows = hoja_inputs(wb, meses_fcst_labels)
    ws_model, model_refs = hoja_model(wb, hist_df, meses_fcst_labels, extra, driver_rows)
    hoja_outputs(wb, model_refs)

    # Hojas de apoyo y gráficos nuevos (ctx = todo lo que necesitan para armar sus tablas)
    ctx = dict(hist=hist_df, fcst=meses_fcst_labels, mr=model_refs, dr=driver_rows, diario=diario,
               mes_foco=mes_foco, es_demo=es_demo, extra=extra)
    dg = DatosGraficos(wb)
    tabla_plan(dg, ctx)

    # Orden final de hojas: Cover, Outputs, Inputs, Model, Datos_Graficos
    wb._sheets = [wb["Cover"], wb["Outputs"], wb["Inputs"], wb["Model"], dg.ws]
    wb.active = 0

    wb.save(salida_path)
    print(f"✅ Modelo generado: {salida_path}  ({len(hist_df)} meses reales + {len(meses_fcst_labels)} proyectados)")


if __name__ == "__main__":
    main()
