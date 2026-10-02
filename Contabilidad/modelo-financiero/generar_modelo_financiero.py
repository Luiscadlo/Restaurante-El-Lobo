#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generar_modelo_financiero.py
=============================
Genera "ElLobo_Modelo_Financiero.xlsx" — un modelo financiero de 3 estados
con la MISMA estructura del curso "3-Statement Modeling" de CFI (Cover /
Outputs / Inputs / Model), simplificado para el tamaño real de El Lobo.

Uso:
    python generar_modelo_financiero.py <archivo_exportado.xlsx> [--hasta AAAA-MM | --meses-proyeccion N] [--mes AAAA-MM]
    python generar_modelo_financiero.py --demo

    <archivo_exportado.xlsx>  El archivo que genera el botón "Exportar todo a
                               Excel" de la pestaña Datos del sistema contable
                               (una hoja por tabla: Pedidos_Pagados, Egresos,
                               Cierres_Dia, etc.)
    --demo                    Ignora el archivo y genera 12 meses de datos de
                               EJEMPLO (para probar el modelo sin depender de
                               datos reales).
    --hasta AAAA-MM           Último mes de la proyección (por defecto 2027-12).
    --meses-proyeccion N      Alternativa a --hasta; si se pasa, manda.
    --mes AAAA-MM             Mes en foco de los gráficos mensuales (por defecto,
                               el último mes con datos reales).

Además de Cover / Outputs / Inputs / Model, el libro trae el tablero mensual
"tipo presentación": hojas A_Resultado, B_Ingresos, C_Egresos, E_Proyeccion,
F_Familia y G_Extras (gráficos #1–#21, ver CATALOGO_GRAFICOS.md) y la hoja de
apoyo Datos_Graficos (con el Plan = proyección Base a un mes). El consumo
familiar (la familia come sin pagar) tiene su propia sección en Inputs y su
bloque "Consumo Familiar (ESTIMADO)" en Model.

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

import math
import re
import sys
import argparse
from datetime import date, timedelta
from pathlib import Path

# El modelo generado SIEMPRE se guarda en esta misma carpeta
# (modelo-financiero/), sin importar desde qué directorio se corra el
# script — así no se dispersan copias sueltas en la raíz del repo o en
# donde sea que estuviera parada la terminal.
SCRIPT_DIR = Path(__file__).resolve().parent

# Filas FIJAS de la hoja Model (Estado de Resultados + días operados) — la
# hoja Inputs las necesita para construir fórmulas que apuntan a Model
# (costo de insumos %, período base) ANTES de que hoja_model() exista
# todavía (Inputs se arma primero). El layout de hoja_model() es
# determinístico (no depende de los datos), así que estos números son
# estables — hoja_model() los valida con un assert al construirse, para
# que un cambio de layout ahí avise en vez de romper fórmulas en silencio.
FILAS_MODEL_FIJAS = dict(
    dias_operados=6, dias_alm_ingreso=7, dias_cena_ingreso=8,
    ing_alm=12, ing_cena=13, ingresos=14, costo_insumos=16,
    nomina=19, arriendo=20, otros=21,
)

# Los datos reales del negocio (no --demo) empiezan acá — todo lo anterior
# (agosto 2026: el mes de prueba del dueño, antes de llevar el negocio en
# serio por el sistema) se ignora en TODAS las tablas del export. Overridable
# con --inicio AAAA-MM si hace falta correr el modelo con otro corte.
MES_INICIO_DATOS_REALES = "2026-09"

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
from openpyxl.chart import BarChart, LineChart, DoughnutChart, Reference, Series
from openpyxl.chart.axis import ChartLines
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.legend import LegendEntry
from openpyxl.chart.marker import Marker
from openpyxl.chart.text import RichText
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.text import Paragraph, ParagraphProperties, CharacterProperties, RichTextProperties
from openpyxl.formatting.rule import ColorScaleRule, FormulaRule
from openpyxl.worksheet.pagebreak import Break
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
# "desechables" (vasos, platos, bolsas…) cuenta como COSTO DE INSUMOS, pero el
# modelo guarda aparte cuánto de los insumos son desechables (costo_desechables)
# para que todo gráfico de insumos lo deje a la vista.
MAPA_RUBRO = {
    "proveedor": "insumos",
    "desechables": "insumos",
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


def _pascua(anio):
    """Domingo de Pascua de un año — algoritmo de Meeus/Jones/Butcher (calendario gregoriano)."""
    a = anio % 19
    b = anio // 100
    c = anio % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(anio, mes, dia)


def _siguiente_lunes(d):
    """Ley Emiliani: si la fecha no cae lunes, se traslada al lunes siguiente (si ya es lunes, queda igual)."""
    return d + timedelta(days=(7 - d.weekday()) % 7)


def festivos_colombia(anio_inicio, anio_fin):
    """Festivos civiles de Colombia entre anio_inicio y anio_fin (ambos inclusive) — los 18
    festivos nacionales oficiales (Ley 51 de 1983 "Ley Emiliani" + Semana Santa), calculados a
    mano con el algoritmo de Pascua + el corrimiento al lunes siguiente que manda la ley.

    Se probó usar la librería `holidays` (si está instalada) en vez de este cálculo, pero para
    Colombia agrega un festivo que NO es nacional (Virgen de Chiquinquirá — una fecha religiosa
    regional de Boyacá, no un festivo civil en el resto del país); por eso se prefiere este
    cálculo propio, verificado contra la lista oficial de 18. La tabla de Inputs que arma con
    esto queda editable, así que si el negocio sí para algún día adicional (o no para alguno de
    estos), se ajusta a mano ahí sin tocar el script.

    Devuelve {fecha: nombre}, ordenado por fecha."""
    out = {}
    for anio in range(anio_inicio, anio_fin + 1):
        fijos = {
            date(anio, 1, 1): "Año Nuevo",
            date(anio, 5, 1): "Día del Trabajo",
            date(anio, 7, 20): "Día de la Independencia",
            date(anio, 8, 7): "Batalla de Boyacá",
            date(anio, 12, 8): "La Inmaculada Concepción",
            date(anio, 12, 25): "Navidad",
        }
        out.update(fijos)
        emiliani = {
            date(anio, 1, 6): "Reyes Magos",
            date(anio, 3, 19): "San José",
            date(anio, 6, 29): "San Pedro y San Pablo",
            date(anio, 8, 15): "La Asunción",
            date(anio, 10, 12): "Día de la Raza",
            date(anio, 11, 1): "Todos los Santos",
            date(anio, 11, 11): "Independencia de Cartagena",
        }
        for d, nombre in emiliani.items():
            out[_siguiente_lunes(d)] = nombre
        p = _pascua(anio)
        out[p - timedelta(days=3)] = "Jueves Santo"
        out[p - timedelta(days=2)] = "Viernes Santo"
        for delta_dias, nombre in ((39, "Ascensión del Señor"), (60, "Corpus Christi"), (68, "Sagrado Corazón de Jesús")):
            out[_siguiente_lunes(p + timedelta(days=delta_dias))] = nombre
    return dict(sorted(out.items()))


def cantidad_pedidos(df):
    """Unidades de cada fila de pedidos con la MISMA regla del Tablero del sistema
    ((b.cantidad || 1) en JS): una cantidad nula o 0 cuenta como 1. Todo volumen
    de pedidos del modelo (mensual, diario, gráficos) se cuenta con esta regla."""
    c = _num(df, "cantidad").fillna(0)
    return c.where(c != 0, 1)


# Platos fuertes del almuerzo: base del ticket informativo (#9/#17, Revenue Schedule) — ya no alimenta el
# consumo familiar. Quedan fuera las porciones (sopa, arroz, proteína), sopa-y-arroz y los extras (y el
# desayuno, que ni es pedido).
PLATOS_FUERTES = ("completo", "seco", "asado130", "asado200")


def monto_almuerzo_pedidos(df):
    """Parte de almuerzo de cada fila de pedidos (monto_almuerzo): deja fuera el domicilio/empaque que
    sí está en monto_total. Si el export no trae la columna, se usa monto_total − monto_domicilio."""
    sin_dom = _num(df, "monto_total").fillna(0) - _num(df, "monto_domicilio").fillna(0)
    if "monto_almuerzo" in df.columns:
        return _num(df, "monto_almuerzo").fillna(sin_dom)
    return sin_dom


def marcar_turnos_cerrados(pedidos, cierres):
    """Agrega la columna `cerrado` a los pedidos: True si su fecha + turno tiene un
    cierre guardado — igual que turnosCerrados() del sistema, que usa el Tablero
    para decidir qué pedidos cuentan (ventas, ticket)."""
    p = pedidos.copy()
    if p.empty:
        p["cerrado"] = pd.Series(dtype=bool)
        return p
    if cierres is None or cierres.empty or not {"fecha", "turno"}.issubset(cierres.columns):
        p["cerrado"] = False
        return p
    claves = set(zip(pd.to_datetime(cierres["fecha"]).dt.normalize(), cierres["turno"]))
    p["cerrado"] = [(f, t) in claves for f, t in zip(pd.to_datetime(p["fecha"]).dt.normalize(), p["turno"])]
    return p


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


def desglose_sin_pedido(cierres_mes, ventas_dia, desayuno_dia, turno):
    """De dónde viene lo que el cierre de un turno trae SIN pedido que lo respalde:
    (ingresos del cierre − desayuno) − ventas por pedidos, separado en
      · ajustes   — ajuste_efectivo / ajuste_transferencia / ajuste_manual (misma
                    lógica de ajustesDeCierre() del sistema),
      · manuales  — cierres manuales: efectivo + transferencia − desayuno − pedidos de ese día,
      · otros     — el resto (p. ej. pedidos fiados que figuran con su monto pero cuya plata
                    no entró al cierre del día).
    `ventas_dia` / `desayuno_dia`: Series por fecha (Σ monto_total de los pedidos del turno; desayuno)."""
    c = cierres_mes[cierres_mes["turno"] == turno] if (cierres_mes is not None and not cierres_mes.empty and "turno" in cierres_mes.columns) else pd.DataFrame()
    if c.empty:
        return dict(ajustes=0.0, manuales=0.0)
    total_cierre = ingresos_por_cierre(c)
    base = _num(c, "efectivo").fillna(0) + _num(c, "transferencia").fillna(0)
    ajustes = float((total_cierre - base).sum())
    des = c["fecha"].map(desayuno_dia).fillna(0) if turno == "almuerzo" else 0.0
    resto = base - des - c["fecha"].map(ventas_dia).fillna(0)
    manuales = float(resto[_bool(c, "manual")].sum())
    return dict(ajustes=ajustes, manuales=manuales)


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


def preparar_pedidos(pagados, pendientes, cierres=None):
    """Separa los pedidos en (pedidos, gratis):
      · pedidos = Pedidos_Pagados SIN los Gratis y solo de turnos con cierre
        guardado (como el Tablero; si `cierres` es None no se filtra),
        normalizado, con las columnas derivadas que usan los gráficos (periodo,
        grupo de producto, canal). `cantidad` nula o 0 cuenta como 1. Los Gratis
        NUNCA entran a volúmenes, tickets, Pareto ni a ningún conteo de pedidos
        (los ingresos salen de los cierres).
      · gratis = pedidos Gratis, pagados (ya entregados) y pendientes, a
        precio de venta (monto_total)."""
    cols_num = ["cantidad", "monto_total", "monto_efectivo", "monto_transferencia"]
    def norm(df):
        if df is None or df.empty or "fecha" not in df.columns:
            return pd.DataFrame()
        d = df.copy()
        for c in cols_num:
            d[c] = _num(d, c).fillna(0)
        d["cantidad"] = cantidad_pedidos(d)        # regla del Tablero: nula o 0 → 1
        return d
    pag, pen = norm(pagados), norm(pendientes)
    gratis_partes = [d[es_gratis(d)] for d in (pag, pen) if not d.empty]
    gratis = pd.concat(gratis_partes, ignore_index=True) if gratis_partes else pd.DataFrame(columns=["fecha", "turno", "cantidad", "monto_total"])
    if not gratis.empty:
        gratis = gratis[["fecha", "turno", "cantidad", "monto_total"] + [c for c in ("grupo_pedido", "id", "pedido", "estado") if c in gratis.columns]]
    if pag.empty:
        return pd.DataFrame(columns=["fecha", "turno", "pedido", "cantidad", "monto_total"]), gratis
    ped = pag[~es_gratis(pag)].copy()
    if cierres is not None:                          # solo turnos con cierre guardado (como el Tablero)
        ped = marcar_turnos_cerrados(ped, cierres)
        ped = ped[ped["cerrado"]].copy()
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
    ped, gratis = preparar_pedidos(pagados, pendientes, cierres)
    if cierres is not None and not cierres.empty and {"fecha", "turno"}.issubset(cierres.columns):
        # OJO: _num() devuelve 0.0 (no NaN) cuando falta la columna — correcto
        # para columnas de plata, pero acá 0 significaría "la familia comió
        # cero platos ese día" en vez de "no hay registro, se estima con
        # comidas por día de Inputs". Exports de antes de que existiera esta
        # columna (platos_familia) deben quedar en NaN, no en 0.
        if "platos_familia" in cierres.columns:
            platos_familia_col = pd.to_numeric(cierres["platos_familia"], errors="coerce")
        else:
            platos_familia_col = pd.Series(np.nan, index=cierres.index, dtype="float64")
        cie = pd.DataFrame({
            "fecha": cierres["fecha"], "turno": cierres["turno"],
            "platos_familia": platos_familia_col,  # NaN = "sin registro" (columna ausente = todo sin registro)
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
      valor_cr_registrado · gratis_alm_valor · gratis_cr_valor (consumo familiar y Gratis) ·
      ticket_platos_fuertes (Σ monto_almuerzo ÷ Σ cantidad de los platos fuertes del mes; 0 si no hubo) ·
      ticket_pf_usado (el mismo, pero un mes sin platos fuertes usa el último mes con dato).
    El consumo familiar de almuerzo se valora con UN valor por comida por mes (ver Model →
    Consumo Familiar): ya no se suma un ticket por día, porque un día con pocos pedidos o un
    cierre manual distorsionaba el resultado."""
    ing, ped, cie, gr = diario["ingresos"], diario["pedidos"], diario["cierres"], diario["gratis"]
    h = hist.copy()

    # días operados (cualquier turno) por mes
    op = dias_operados(ing)
    dias_op = pd.Series(1, index=op).groupby(op.to_period("M").astype(str)).sum() if len(op) else pd.Series(dtype=int)

    # almuerzo, día por día: solo para contar días con registro de comidas de la familia
    alm = ing[ing["almuerzo_bruto"] > 0].copy()
    alm["periodo"] = alm.index.to_period("M").astype(str)
    cie_alm = cie[cie["turno"] == "almuerzo"]
    pf = cie_alm.groupby("fecha")["platos_familia"].max() if not cie_alm.empty else pd.Series(dtype=float)
    alm["platos_familia"] = pf.reindex(alm.index)
    con = alm["platos_familia"].notna()
    por_mes = pd.DataFrame({
        "dias_alm_operados": alm.groupby("periodo").size(),
        "dias_con_registro": con.groupby(alm["periodo"]).sum(),
        "platos_registrados": alm["platos_familia"].where(con, 0).groupby(alm["periodo"]).sum(),
    })
    # días con ingreso de comida rápida — mismo criterio que dias_alm_operados,
    # pero del turno de cena. Lo usa el "factor de operación del turno" de la
    # proyección (Model → Supuestos del dueño): vale 1 si el turno opera
    # todos los días del período base.
    cena_op = ing[ing["comida_rapida"] > 0].copy()
    cena_op["periodo"] = cena_op.index.to_period("M").astype(str)
    dias_cena_operados = cena_op.groupby("periodo").size()
    # Gratis (a precio de venta): comida rápida = consumo de la familia REGISTRADO;
    # almuerzo = pedidos Gratis legados (anteriores a la regla "Gratis solo en comida rápida").
    if not gr.empty:
        g = gr.assign(periodo=gr["fecha"].dt.to_period("M").astype(str))
        gr_cr = g[g["turno"] == "cena"].groupby("periodo")["monto_total"].sum()
        gr_al = g[g["turno"] == "almuerzo"].groupby("periodo")["monto_total"].sum()
    else:
        gr_cr = gr_al = pd.Series(dtype=float)
    h = h.set_index("periodo")
    h["dias_operados"] = dias_op.reindex(h.index).fillna(0).astype(int)
    for c in por_mes.columns:
        h[c] = por_mes[c].reindex(h.index).fillna(0)
    for c in ("dias_alm_operados", "dias_con_registro"):
        h[c] = h[c].astype(int)
    h["dias_cena_operados"] = dias_cena_operados.reindex(h.index).fillna(0).astype(int)
    h["valor_cr_registrado"] = gr_cr.reindex(h.index).fillna(0.0)
    h["gratis_alm_valor"] = gr_al.reindex(h.index).fillna(0.0)
    h["gratis_cr_valor"] = h["valor_cr_registrado"]
    # ticket de platos fuertes: real (0 si el mes no tuvo) y "usado" (respaldo = último mes con dato)
    tk = (h["ventas_platos_fuertes_almuerzo"] / h["unidades_platos_fuertes_almuerzo"]).where(h["unidades_platos_fuertes_almuerzo"] > 0)
    h["ticket_platos_fuertes"] = tk.fillna(0.0)
    h["ticket_pf_usado"] = tk.ffill().fillna(0.0)
    return h.reset_index()


# ══════════════════════════════════════════════════════════════════════
# CARGA DE DATOS — desde el export real, o datos de EJEMPLO
# ══════════════════════════════════════════════════════════════════════
def cargar_datos_reales(path_excel, mes_inicio=MES_INICIO_DATOS_REALES):
    """Lee el archivo del botón 'Exportar a Excel' de la pestaña Datos (una
    hoja por tabla de Supabase) y arma (hist, extra, diario):
      hist   — DataFrame mensual (una fila por mes real)
      extra  — saldos puntuales para el Balance (caja, inventario, fiados)
      diario — datos por día para los gráficos (ver construir_diario())
    Ajusta los nombres de hoja/columna aquí si cambian en el sistema.

    `mes_inicio` (AAAA-MM): cualquier fila con fecha anterior se ignora en
    TODAS las tablas, antes de calcular nada — ver MES_INICIO_DATOS_REALES."""
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

    # Recorta TODO a partir de mes_inicio — datos de antes (ej. el mes de
    # prueba) se ignoran en cualquier tabla con columna "fecha", antes de que
    # nada más se calcule (así "Meses históricos reales" de la portada, los
    # promedios del período base, etc. ya nacen sin esos meses).
    inicio_ts = pd.Timestamp(f"{mes_inicio}-01")
    tablas_fecha = dict(Cierres_Dia=cierres, Pedidos_Pagados=pedidos, Pedidos_Pendientes=pendientes,
                         Egresos=egresos, Gastos_Cierre=gastos_cierre, Movimientos_Caja=movs_caja,
                         Aperturas_Turno=aperturas, Abonos_Fiado=abonos)
    for nombre_tabla, df in tablas_fecha.items():
        if df.empty or "fecha" not in df.columns:
            continue
        fechas = pd.to_datetime(df["fecha"], errors="coerce")
        antes = (fechas < inicio_ts).fillna(False)
        n = int(antes.sum())
        if n:
            print(f"  (ignorando {n} fila(s) de {nombre_tabla} anteriores a {mes_inicio} — MES_INICIO_DATOS_REALES)")
            df.drop(df.index[antes], inplace=True)

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
    # Ventas y volumen de pedidos SOLO de turnos con cierre guardado (como el Tablero),
    # y cantidad nula o 0 = 1 unidad (como el Tablero).
    pedidos = marcar_turnos_cerrados(pedidos, cierres) if not pedidos.empty else pedidos
    pedidos_vendidos = pedidos[~es_gratis(pedidos) & pedidos["cerrado"]] if not pedidos.empty else pedidos

    filas = []
    for periodo in meses:
        ing_alm = pedidos_vendidos[(pedidos_vendidos.get("periodo") == periodo) & (pedidos_vendidos.get("turno") == "almuerzo")] if not pedidos_vendidos.empty else pd.DataFrame()
        ing_cena = pedidos_vendidos[(pedidos_vendidos.get("periodo") == periodo) & (pedidos_vendidos.get("turno") == "cena")] if not pedidos_vendidos.empty else pd.DataFrame()
        cierres_mes = cierres[cierres["periodo"] == periodo] if not cierres.empty else pd.DataFrame()
        egresos_mes = egresos[egresos["periodo"] == periodo] if not egresos.empty else pd.DataFrame()
        gastos_mes = gastos_cierre[gastos_cierre["periodo"] == periodo] if not gastos_cierre.empty else pd.DataFrame()
        aperturas_mes = aperturas[aperturas["periodo"] == periodo] if not aperturas.empty and "periodo" in aperturas.columns else pd.DataFrame()

        vol_alm = int(round(float(cantidad_pedidos(ing_alm).sum()))) if not ing_alm.empty else 0
        vol_cena = int(round(float(cantidad_pedidos(ing_cena).sum()))) if not ing_cena.empty else 0
        ventas_alm = float(_num(ing_alm, "monto_total").fillna(0).sum()) if not ing_alm.empty else 0.0
        ventas_cena = float(_num(ing_cena, "monto_total").fillna(0).sum()) if not ing_cena.empty else 0.0
        # platos fuertes del almuerzo (completo, seco, asado130, asado200): Σ monto_almuerzo y Σ cantidad
        pf_alm = ing_alm[ing_alm["pedido"].isin(PLATOS_FUERTES)] if (not ing_alm.empty and "pedido" in ing_alm.columns) else ing_alm.iloc[0:0]
        unid_pf = float(cantidad_pedidos(pf_alm).sum()) if not pf_alm.empty else 0.0
        ventas_pf = float(monto_almuerzo_pedidos(pf_alm).sum()) if not pf_alm.empty else 0.0
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

        # De dónde vienen los ingresos de cierre que no tienen pedido detrás (ajustes, cierres manuales)
        desayuno_dia = desayuno_por_dia(aperturas_mes)
        sp_alm = desglose_sin_pedido(cierres_mes, ing_alm.groupby("fecha")["monto_total"].sum() if not ing_alm.empty else pd.Series(dtype=float), desayuno_dia, "almuerzo")
        sp_cena = desglose_sin_pedido(cierres_mes, ing_cena.groupby("fecha")["monto_total"].sum() if not ing_cena.empty else pd.Series(dtype=float), desayuno_dia, "cena")

        def suma_cat(df, cat):
            # "egresos" guarda la categoría en la columna "cat"; "gastos_dia"
            # (los gastos registrados al cierre del turno) la guarda en
            # "categoria" — mismos valores (nomina/proveedor/desechables/otro),
            # columna distinta. gastos_dia tampoco maneja arriendo/servicios
            # (esos son gastos fijos mensuales, no de cierre diario).
            col = "cat" if "cat" in df.columns else ("categoria" if "categoria" in df.columns else None)
            if df.empty or col is None:
                return 0.0
            return float(df[df[col] == cat]["monto"].sum())

        # Costo de insumos = proveedores + desechables; costo_desechables es la
        # parte de los insumos que corresponde a desechables (ya está dentro de
        # costo_insumos, NO se suma otra vez).
        costo_desechables = suma_cat(egresos_mes, "desechables") + suma_cat(gastos_mes, "desechables")
        costo_insumos = suma_cat(egresos_mes, "proveedor") + suma_cat(gastos_mes, "proveedor") + costo_desechables
        nomina        = suma_cat(egresos_mes, "nomina") + suma_cat(gastos_mes, "nomina")
        arriendo_serv = suma_cat(egresos_mes, "arriendo") + suma_cat(egresos_mes, "servicios")
        otros         = suma_cat(egresos_mes, "otro") + suma_cat(gastos_mes, "otro")

        filas.append(dict(
            periodo=str(periodo), anio=periodo.year, mes=periodo.month,
            ingresos_almuerzo=ingresos_alm,
            ingresos_cena=ingresos_cena,
            volumen_almuerzo=max(vol_alm, 1), volumen_cena=max(vol_cena, 1),
            ventas_pedidos_almuerzo=ventas_alm, ventas_pedidos_cena=ventas_cena,
            unidades_platos_fuertes_almuerzo=unid_pf, ventas_platos_fuertes_almuerzo=ventas_pf,
            sinped_ajustes_almuerzo=sp_alm["ajustes"], sinped_manual_almuerzo=sp_alm["manuales"],
            sinped_ajustes_cena=sp_cena["ajustes"], sinped_manual_cena=sp_cena["manuales"],
            costo_insumos=costo_insumos, costo_desechables=costo_desechables, nomina=nomina,
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
        costo_ins = round((ing_alm + ing_cena) * random.uniform(0.33, 0.38), -3)
        filas.append(dict(
            periodo=f"{a}-{m:02d}", anio=a, mes=m,
            ingresos_almuerzo=round(ing_alm, -3),
            ingresos_cena=round(ing_cena, -3),
            volumen_almuerzo=int(ing_alm / 15000),
            volumen_cena=int(ing_cena / 13000),
            costo_insumos=costo_ins,
            costo_desechables=round(costo_ins * random.uniform(0.05, 0.08), -3),   # parte de los insumos que son desechables
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
    ped_d = diario["pedidos"]
    for turno_, col_ in (("almuerzo", "ventas_pedidos_almuerzo"), ("cena", "ventas_pedidos_cena")):
        ventas_mes = ped_d[ped_d["turno"] == turno_].groupby("periodo")["monto_total"].sum() if not ped_d.empty else pd.Series(dtype=float)
        hist[col_] = hist["periodo"].map(ventas_mes).fillna(0.0)
        hist[f"sinped_ajustes_{turno_}"] = 0.0     # el demo no trae ajustes manuales
        # cierres manuales del demo: días con ingreso del turno y cierre marcado "manual" (ingreso − pedidos de ese día)
        cie_m = diario["cierres"]
        dias_man = cie_m[cie_m["manual"] & (cie_m["turno"] == turno_)]["fecha"] if not cie_m.empty else []
        ing_turno = diario["ingresos"]["almuerzo_neto" if turno_ == "almuerzo" else "comida_rapida"]
        ped_dia = ped_d[ped_d["turno"] == turno_].groupby("fecha")["monto_total"].sum() if not ped_d.empty else pd.Series(dtype=float)
        resto_man = ing_turno.reindex(dias_man).fillna(0) - ped_dia.reindex(dias_man).fillna(0) if len(dias_man) else pd.Series(dtype=float)
        hist[f"sinped_manual_{turno_}"] = hist["periodo"].map(resto_man.groupby(resto_man.index.to_period("M").astype(str)).sum()).fillna(0.0) if len(resto_man) else 0.0
    pf_d = ped_d[(ped_d["turno"] == "almuerzo") & ped_d["pedido"].isin(PLATOS_FUERTES)] if not ped_d.empty else ped_d
    hist["unidades_platos_fuertes_almuerzo"] = hist["periodo"].map(pf_d.groupby("periodo")["cantidad"].sum()).fillna(0.0) if not pf_d.empty else 0.0
    hist["ventas_platos_fuertes_almuerzo"] = hist["periodo"].map(monto_almuerzo_pedidos(pf_d).groupby(pf_d["periodo"]).sum()).fillna(0.0) if not pf_d.empty else 0.0
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
            aj = rng.choice([0] * 14 + [-2000, 3000]) if bruto else 0   # el ajuste se descuenta de la transferencia: efectivo + transferencia + ajuste = bruto
            pf = (float(rng.choice([8, 9, 9, 10])) if rng.random() > .15 else None) if reciente else None
            cierres.append(dict(fecha=f, turno="almuerzo", efectivo=ef, transferencia=bruto - ef - aj, ajuste_efectivo=aj,
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
                        turno=turno, pedido=cod, cantidad=cant, monto_total=monto, monto_almuerzo=monto, metodo=met,
                        monto_efectivo=mef, monto_transferencia=(monto - mef) if met == "dividido" else 0,
                        es_domicilio=dom, es_sin_mesa=(not dom) and sin_mesa, para_llevar=(not dom) and rng.random() < .15,
                        mesa=None if (dom or sin_mesa) else rng.randint(1, 8),
                        proteina=rng.choice(proteinas) if (turno == "almuerzo" and cod in ("completo", "seco", "asado130", "asado200")) else None,
                        es_gratis=False, estado="pagado"))
        # Pedidos Gratis de comida rápida (consumo de la familia a precio de venta) — no suman a ingresos
        for d in rng.sample(dias, 3):
            cod, precio, _w = eleg(mezcla_cr)
            pagados.append(dict(fecha=d.date().isoformat(), hora="20:15", turno="cena", pedido=cod, cantidad=1, monto_total=precio, monto_almuerzo=precio,
                                metodo="gratis", monto_efectivo=0, monto_transferencia=0, es_domicilio=False, es_sin_mesa=False,
                                para_llevar=False, mesa=3, proteina=None, es_gratis=True, estado="pagado"))
        # Egresos del mes, repartidos en sus fechas reales (suma EXACTA por rubro). "prestamo" va aparte y se excluye.
        d_ops = [d.date().isoformat() for d in dias]
        # Los insumos del mes = proveedores + desechables (costo_desechables es la parte de desechables).
        compras = sorted(rng.sample(d_ops, 9))
        for f, v in zip(compras, _repartir(int(r["costo_insumos"] - r["costo_desechables"]), [rng.uniform(.5, 1.5) for _ in compras], paso=100)):
            if rng.random() < .3:   # parte de las compras se anotó como gasto de cierre, parte como egreso
                gastos.append(dict(fecha=f, turno="almuerzo", nombre="Compra de insumos", monto=v, categoria="proveedor"))
            else:
                egresos.append(dict(fecha=f, cat="proveedor", monto=v))
        compras_des = sorted(rng.sample(d_ops, 3))
        for f, v in zip(compras_des, _repartir(int(r["costo_desechables"]), [rng.uniform(.5, 1.5) for _ in compras_des], paso=100)):
            if rng.random() < .5:
                gastos.append(dict(fecha=f, turno="almuerzo", nombre="Vasos, platos y bolsas", monto=v, categoria="desechables"))
            else:
                egresos.append(dict(fecha=f, cat="desechables", monto=v))
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
        df(pagados, ["fecha", "hora", "turno", "pedido", "cantidad", "monto_total", "monto_almuerzo", "metodo", "monto_efectivo", "monto_transferencia",
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
    for nombre, desc in [
        ("A_Resultado", "¿Cómo me fue este mes? — tarjetas y gráficos #1–#4 y #12"),
        ("B_Ingresos", "¿De dónde viene la plata? — gráficos #5–#9"),
        ("C_Egresos", "¿En qué se va la plata? — gráficos #10–#11"),
        ("E_Proyeccion", "¿Hacia dónde voy? — gráficos #13–#15"),
        ("F_Familia", "Si la familia pagara — gráficos #16–#18"),
        ("G_Extras", "Complementarios — gráficos #19–#21"),
        ("Datos_Graficos", "Tablas de apoyo de los gráficos (no editar)"),
    ]:
        ws.cell(row=r, column=3, value=f"· {nombre} — {desc}").font = FONT_LABEL   # una sola celda: se lee completa
        r += 1

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
def hoja_inputs(wb, hist_df, meses_fcst_labels, mes_foco):
    ws = wb.create_sheet("Inputs")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 3
    ws.column_dimensions["D"].width = 3
    ws.column_dimensions["E"].width = 14
    ws.column_dimensions["F"].width = 28
    for i in range(len(meses_fcst_labels)):
        ws.column_dimensions[get_column_letter(6 + i)].width = 11

    col_ini = 6
    col_fin = col_ini + max(len(meses_fcst_labels), 1) - 1

    # Período base de "si todo sigue igual" (ver Model → Supuestos del
    # dueño): hasta los 3 últimos meses reales que terminan en el mes en
    # foco. Las columnas de Model que le corresponden (para las fórmulas de
    # más abajo) usan las filas FIJAS de FILAS_MODEL_FIJAS.
    idxs_base = periodo_base_meses(hist_df, mes_foco, max_meses=3)
    col_pb_ini_m, col_pb_fin_m = get_column_letter(col_ini + idxs_base[0]), get_column_letter(col_ini + idxs_base[-1])

    def rango_model(clave_fila):
        fila = FILAS_MODEL_FIJAS[clave_fila]
        return f"{col_pb_ini_m}{fila}:{col_pb_fin_m}{fila}" if len(idxs_base) > 1 else f"{col_pb_ini_m}{fila}"

    banner(ws, 2, "Supuestos del dueño (editables)", col_fin=col_fin)
    nota(ws, 4, "Cambia cualquier celda azul — el modelo se recalcula solo. Las celdas en negro son fórmulas que vienen de los datos reales (período base: "
                + ", ".join(hist_df.iloc[i]["periodo"] for i in idxs_base) + ") — no se editan a mano.")

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
    n_fcst = len(meses_fcst_labels)
    # Costo de insumos %: fórmula real (Σ costo de insumos ÷ Σ ingresos del
    # período base) — NO es una suposición, sale de los datos. Mejor/Base/
    # Peor quedan iguales (no hay 3 escenarios de esto todavía).
    costo_insumos_formula = f"=-SUM(Model!{rango_model('costo_insumos')})/SUM(Model!{rango_model('ingresos')})"
    # Caso Base de cada driver (valores sin cambios): el Plan en pandas (plan_pandas)
    # los usa para decidir rangos de ejes y contrastar las fórmulas de Excel.
    # OJO: hist_df.costo_insumos es POSITIVO (Model lo niega solo al escribir la celda) —
    # sin negar acá de nuevo.
    costo_insumos_pct_base = float(hist_df.iloc[idxs_base]["costo_insumos"].sum()) / float(
        (hist_df.iloc[idxs_base]["ingresos_almuerzo"] + hist_df.iloc[idxs_base]["ingresos_cena"]).sum())
    BASE = dict(crecimiento_almuerzo=0.01, crecimiento_cena=0.01, costo_insumos_pct=costo_insumos_pct_base, inflacion_gastos=0.0)
    driver_rows["_base_valores"] = BASE
    r = 12
    driver_rows["crecimiento_almuerzo"], r = bloque_driver(
        r, "Crecimiento de ventas — Almuerzo (%/mes)",
        [BASE["crecimiento_almuerzo"]] * n_fcst, [BASE["crecimiento_almuerzo"]] * n_fcst, [BASE["crecimiento_almuerzo"]] * n_fcst,
        nota_txt="Mejor y Peor: sin definir todavía — son iguales a Base. Edita estas celdas si querés probar un escenario optimista o pesimista distinto.")
    driver_rows["crecimiento_cena"], r = bloque_driver(
        r, "Crecimiento de ventas — Comidas rápidas (%/mes)",
        [BASE["crecimiento_cena"]] * n_fcst, [BASE["crecimiento_cena"]] * n_fcst, [BASE["crecimiento_cena"]] * n_fcst,
        nota_txt="Mejor y Peor: sin definir todavía — son iguales a Base. Edita estas celdas si querés probar un escenario optimista o pesimista distinto.")
    driver_rows["costo_insumos_pct"], r = bloque_driver(
        r, "Costo de insumos (% de ingresos)",
        [costo_insumos_formula] * n_fcst, [costo_insumos_formula] * n_fcst, [costo_insumos_formula] * n_fcst,
        nota_txt="Fórmula real (Σ costo de insumos ÷ Σ ingresos del período base) — no es una suposición editable. Mejor/Base/Peor quedan iguales.")
    driver_rows["inflacion_gastos"], r = bloque_driver(
        r, "Inflación de gastos fijos — nómina / arriendo / servicios / otros (%/mes)",
        [BASE["inflacion_gastos"]] * n_fcst, [BASE["inflacion_gastos"]] * n_fcst, [BASE["inflacion_gastos"]] * n_fcst,
        nota_txt="Mejor y Peor: sin definir todavía — son iguales a Base (0%). Edita estas celdas si querés modelar inflación.")
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

    # ── Festivos en que NO abrimos ─────────────────────────────────────
    # No se abre domingos (NETWORKDAYS.INTL "0000001", ver Model) ni estos
    # festivos — tabla editable: agregá, quitá o cambiá fechas según cómo
    # opere el negocio de verdad (insertando filas DENTRO de la tabla para
    # que el rango que usa NETWORKDAYS.INTL en Model las siga incluyendo).
    r += 3
    banner(ws, r, "Festivos en que NO abrimos", col_fin=col_fin)
    r += 1
    anio_ini_fest = int(hist_df["periodo"].min().split("-")[0])
    anio_fin_fest = int(meses_fcst_labels[-1].split("-")[0]) if meses_fcst_labels else anio_ini_fest
    nota(ws, r, f"Festivos civiles de Colombia {anio_ini_fest}–{anio_fin_fest} (Ley Emiliani + Semana Santa), calculados por el script. "
                "No incluye domingos (esos ya se excluyen aparte). Editable: agregá o quitá filas si tu negocio no sigue exactamente este calendario.")
    r += 2
    festivos = festivos_colombia(anio_ini_fest, anio_fin_fest)
    label(ws, r, "Fecha", bold=True)
    label(ws, r, "Festivo", bold=True, col=6)
    r += 1
    fila_festivos_ini = r
    for fecha_f, nombre_f in festivos.items():
        c = ws.cell(row=r, column=5, value=fecha_f)
        c.number_format = "DD/MM/YYYY"
        c.font = Font(name="Calibri", size=10, bold=False, color=AZUL_TEXTO)
        label(ws, r, nombre_f, col=6)
        r += 1
    fila_festivos_fin = r - 1
    driver_rows["_festivos_rango"] = f"Inputs!$E${fila_festivos_ini}:$E${fila_festivos_fin}"
    r += 1

    # ── Consumo familiar (estimado): la familia come sin pagar ────────────
    # Almuerzo: el cierre registra la CANTIDAD de platos (platos_familia); los
    # días sin registro (y los meses proyectados) se estiman con estas celdas.
    # Comida rápida: se registra VALOR real con los pedidos "Gratis"; solo se
    # proyecta un valor mensual. Nada de esto suma a los ingresos reales.
    r += 3
    banner(ws, r, "Consumo familiar (estimado)", col_fin=col_fin)
    r += 1
    nota(ws, r, "La familia come sin pagar. Valor por comida de la familia = estimado fijo (celda de abajo, no es el ticket del Tablero) "
                "— ya no distingue plato fuerte de porción. Lo único que varía mes a mes es la CANTIDAD de comidas: lo que ya registra "
                "el cierre, y para días sin registro (y meses proyectados) se usan las comidas por día de aquí abajo (ver Model → Consumo Familiar).")
    r += 2
    FAM = dict(comidas_dia=12, valor_comida=15000, cr_estimado=500000)   # valores por defecto (celdas editables de Inputs)
    driver_rows["_familia_valores"] = FAM
    entradas = [
        ("fam_comidas_dia", "Comidas de la familia por día", FAM["comidas_dia"], "0"),
        ("fam_valor_comida", "Valor por comida de la familia ($) — estimado fijo", FAM["valor_comida"], FMT_CONTABLE),
        ("fam_cr_proy", "Consumo familiar de comida rápida — estimado mensual ($)", FAM["cr_estimado"], FMT_CONTABLE),
    ]
    for clave, texto, valor, fmt_celda in entradas:
        label(ws, r, texto)
        c = numero(ws, r, 5, valor, bold=True)
        c.number_format = fmt_celda
        driver_rows[clave] = r
        r += 1

    config_impresion(ws, horizontal=True)
    return ws, driver_rows


# ══════════════════════════════════════════════════════════════════════
# HOJA: MODEL
# ══════════════════════════════════════════════════════════════════════
def hoja_model(wb, hist_df, meses_fcst_labels, extra, driver_rows, mes_foco):
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

    # ── Días operados — real (histórico) y NETWORKDAYS.INTL (proyectado) ──
    # "0000001" = solo domingo es no-laborable (sábado SÍ opera, aunque sea
    # con cierre manual). Reemplaza el viejo input fijo "días operados
    # proyectados" (26) — ahora varía mes a mes según festivos reales.
    # Las dos filas de abajo (días CON INGRESO por turno) son históricas
    # nada más: alimentan el "factor de operación del turno" del período
    # base (Supuestos del dueño) — un turno que no vende todos los días
    # (p. ej. comida rápida) no debe proyectarse como si vendiera siempre.
    fila_dias_operados = 6
    label(ws, fila_dias_operados, "Días operados del mes")
    for i in range(n_hist):
        numero(ws, fila_dias_operados, col_ini + i, int(hist_df.iloc[i]["dias_operados"]))
    festivos_rango = driver_rows.get("_festivos_rango")
    for i, c in enumerate(cols_fcst):
        anio_m, mes_m = (int(x) for x in meses_fcst_labels[i].split("-"))
        f_festivos = f',"0000001",{festivos_rango}' if festivos_rango else ',"0000001"'
        numero(ws, fila_dias_operados, c, f"=NETWORKDAYS.INTL(DATE({anio_m},{mes_m},1),EOMONTH(DATE({anio_m},{mes_m},1),0){f_festivos})")
    fila_dias_alm_ingreso = fila_dias_operados + 1
    label(ws, fila_dias_alm_ingreso, "· de los cuales, con ingreso de almuerzo (histórico)")
    for i in range(n_hist):
        numero(ws, fila_dias_alm_ingreso, col_ini + i, int(hist_df.iloc[i]["dias_alm_operados"]))
    fila_dias_cena_ingreso = fila_dias_alm_ingreso + 1
    label(ws, fila_dias_cena_ingreso, "· de los cuales, con ingreso de comida rápida (histórico)")
    for i in range(n_hist):
        numero(ws, fila_dias_cena_ingreso, col_ini + i, int(hist_df.iloc[i]["dias_cena_operados"]))
    assert (fila_dias_operados, fila_dias_alm_ingreso, fila_dias_cena_ingreso) == (
        FILAS_MODEL_FIJAS["dias_operados"], FILAS_MODEL_FIJAS["dias_alm_ingreso"], FILAS_MODEL_FIJAS["dias_cena_ingreso"]
    ), "FILAS_MODEL_FIJAS quedó desincronizado con el layout real de hoja_model() — actualízalo."

    # ══ ESTADO DE RESULTADOS ═════════════════════════════════════════
    banner(ws, 10, "Estado de Resultados", col_fin=col_fin)
    r = 12
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
    nota(ws, r + 1, "Utilidad neta = utilidad operativa: el negocio no paga impuestos ni intereses mensuales.")
    r += 3

    assert (fila_ing_alm, fila_ing_cena, fila_ingresos, fila_costo_insumos, fila_nomina, fila_arriendo, fila_otros) == (
        FILAS_MODEL_FIJAS["ing_alm"], FILAS_MODEL_FIJAS["ing_cena"], FILAS_MODEL_FIJAS["ingresos"], FILAS_MODEL_FIJAS["costo_insumos"],
        FILAS_MODEL_FIJAS["nomina"], FILAS_MODEL_FIJAS["arriendo"], FILAS_MODEL_FIJAS["otros"]
    ), "FILAS_MODEL_FIJAS quedó desincronizado con el layout real del Estado de Resultados — actualízalo."

    # ══ SUPUESTOS DEL DUEÑO — período base de la proyección ════════════
    # "Si todo sigue igual, con los datos reales": hasta los 3 últimos
    # meses reales que terminan en el mes en foco (hoy, con 1 solo mes
    # real, el período base es ese único mes). De acá sale el ritmo de
    # ventas por día operado y el ancla de gastos fijos que usa la
    # proyección de abajo — el costo de insumos % (fórmula, Inputs) también
    # usa este mismo período base.
    col_ini_l = get_column_letter(col_ini)
    idxs_base = periodo_base_meses(hist_df, mes_foco, max_meses=3)
    col_pb_ini, col_pb_fin = get_column_letter(col_ini + idxs_base[0]), get_column_letter(col_ini + idxs_base[-1])
    rango_pb = lambda fila: f"{col_pb_ini}{fila}:{col_pb_fin}{fila}" if len(idxs_base) > 1 else f"{col_pb_ini}{fila}"
    banner(ws, r, "Supuestos del dueño — período base de la proyección", col_fin=col_fin)
    r += 1
    nota(ws, r, f"Período base: {', '.join(hist_df.iloc[i]['periodo'] for i in idxs_base)} (hasta los 3 últimos meses reales que terminan en el mes en foco). "
                "Ingreso por día operado = Σ ingresos del turno ÷ Σ días CON INGRESO de ese turno; factor de operación = Σ días con ingreso ÷ Σ días operados totales "
                "(vale 1 si el turno opera todos los días). La proyección de abajo multiplica estos dos por el crecimiento y los días operados de cada mes.")
    r += 2
    fila_rate_alm = r
    label(ws, r, "Ingreso por día operado — Almuerzo (período base)")
    numero(ws, r, col_ini, f"=SUM({rango_pb(fila_ing_alm)})/SUM({rango_pb(fila_dias_alm_ingreso)})")
    r += 1
    fila_factor_alm = r
    label(ws, r, "Factor de operación — Almuerzo (período base)")
    numero(ws, r, col_ini, f"=SUM({rango_pb(fila_dias_alm_ingreso)})/SUM({rango_pb(fila_dias_operados)})", pct=True)
    r += 1
    fila_rate_cena = r
    label(ws, r, "Ingreso por día operado — Comidas Rápidas (período base)")
    numero(ws, r, col_ini, f"=SUM({rango_pb(fila_ing_cena)})/SUM({rango_pb(fila_dias_cena_ingreso)})")
    r += 1
    fila_factor_cena = r
    label(ws, r, "Factor de operación — Comidas Rápidas (período base)")
    numero(ws, r, col_ini, f"=SUM({rango_pb(fila_dias_cena_ingreso)})/SUM({rango_pb(fila_dias_operados)})", pct=True)
    r += 1
    fila_gf_nomina = r
    label(ws, r, "Nómina promedio mensual (período base)")
    numero(ws, r, col_ini, f"=AVERAGE({rango_pb(fila_nomina)})")
    r += 1
    fila_gf_arriendo = r
    label(ws, r, "Arriendo + Servicios promedio mensual (período base)")
    numero(ws, r, col_ini, f"=AVERAGE({rango_pb(fila_arriendo)})")
    r += 1
    fila_gf_otros = r
    label(ws, r, "Otros Gastos promedio mensual (período base)")
    numero(ws, r, col_ini, f"=AVERAGE({rango_pb(fila_otros)})")
    r += 2

    # ── proyección: ingresos = ritmo del período base × crecimiento^n ×
    #    días operados proyectados del mes × factor de operación del turno
    #    (n=1 el primer mes proyectado). Nómina/arriendo/otros arrancan del
    #    promedio del período base y desde ahí encadenan mes a mes con la
    #    inflación de Inputs (igual que antes). Costo de insumos sigue
    #    siendo % de los ingresos de ESE mes (fórmula de Inputs, mismo
    #    período base). Todo jala los drivers de Inputs (mismo mecanismo
    #    INDEX+MATCH que ya resuelve Mejor/Base/Peor ahí). ────────────────
    for i, c in enumerate(cols_fcst):
        cl, cl_prev = get_column_letter(c), get_column_letter(c - 1)
        n = i + 1
        numero(ws, fila_ing_alm, c,
               f"=${col_ini_l}${fila_rate_alm}*(1+{fila_inputs('crecimiento_almuerzo', i)})^{n}*{cl}{fila_dias_operados}*${col_ini_l}${fila_factor_alm}")
        numero(ws, fila_ing_cena, c,
               f"=${col_ini_l}${fila_rate_cena}*(1+{fila_inputs('crecimiento_cena', i)})^{n}*{cl}{fila_dias_operados}*${col_ini_l}${fila_factor_cena}")
        numero(ws, fila_costo_insumos, c, f"=-{cl}{fila_ingresos}*{fila_inputs('costo_insumos_pct', i)}")
        if i == 0:
            numero(ws, fila_nomina, c, f"=${col_ini_l}${fila_gf_nomina}*(1+{fila_inputs('inflacion_gastos', i)})")
            numero(ws, fila_arriendo, c, f"=${col_ini_l}${fila_gf_arriendo}*(1+{fila_inputs('inflacion_gastos', i)})")
            numero(ws, fila_otros, c, f"=${col_ini_l}${fila_gf_otros}*(1+{fila_inputs('inflacion_gastos', i)})")
        else:
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
    # Por turno: ventas por pedidos → ingresos de cierre sin pedido → pedidos registrados → ticket →
    # pedidos equivalentes (estimado) → equivalentes totales → verificación.
    #   ticket = Σ monto_total ÷ Σ cantidad de pedidos pagados del turno (sin Gratis, turnos cerrados;
    #   cantidad nula o 0 = 1) — la MISMA definición del Tablero; NO incluye ajustes ni cierres manuales.
    filas_rev = {}
    for nombre_t, turno_t, f_ing, f_des, col_ventas, col_vol in (
            ("Almuerzo", "almuerzo", fila_ing_alm, fila_desayuno, "ventas_pedidos_almuerzo", "volumen_almuerzo"),
            ("Comidas Rápidas", "cena", fila_ing_cena, None, "ventas_pedidos_cena", "volumen_cena")):
        fr = {}
        fr["ventas"] = r
        label(ws, r, f"Ventas por pedidos — {nombre_t}")
        for i in range(n_hist):
            numero(ws, r, col_ini + i, float(hist_df.iloc[i][col_ventas]))
        r += 1
        fr["sin"] = r
        label(ws, r, "Ingresos de cierre sin pedido asociado (ajustes y cierres manuales)")
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            neto = f"({cl}{f_ing}-{cl}{f_des})" if f_des else f"{cl}{f_ing}"
            numero(ws, r, c, f"={neto}-{cl}{fr['ventas']}")
        r += 1
        # Desglose informativo (suma EXACTAMENTE la fila de arriba): a) ajustes, b) cierres manuales, c) el residual.
        fr["sin_aj"] = r
        label(ws, r, "Ajustes de cierre (efectivo y transferencia)", indent=1)
        for i in range(n_hist):
            numero(ws, r, col_ini + i, float(hist_df.iloc[i][f"sinped_ajustes_{turno_t}"]))
        r += 1
        fr["sin_man"] = r
        label(ws, r, "Cierres manuales", indent=1)
        for i in range(n_hist):
            numero(ws, r, col_ini + i, float(hist_df.iloc[i][f"sinped_manual_{turno_t}"]))
        r += 1
        fr["sin_dif"] = r
        label(ws, r, "Diferencia entre pedidos y cierre (fiados no cobrados u otros)", indent=1)
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            numero(ws, r, c, f"={cl}{fr['sin']}-{cl}{fr['sin_aj']}-{cl}{fr['sin_man']}")
        r += 1
        fr["vol"] = r
        label(ws, r, f"Pedidos registrados — {nombre_t}")
        for i in range(n_hist):
            numero(ws, r, col_ini + i, int(hist_df.iloc[i][col_vol]))
        r += 1
        fr["tkt"] = r
        label(ws, r, f"Ticket promedio — {nombre_t}")
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            numero(ws, r, c, f"=IF({cl}{fr['vol']}=0,0,{cl}{fr['ventas']}/{cl}{fr['vol']})")
        r += 1
        fr["eq"] = r
        label(ws, r, "Pedidos equivalentes por ingresos sin pedido (ESTIMADO)")
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            numero(ws, r, c, f"=IF(AND({cl}{fr['tkt']}>0,{cl}{fr['sin']}>0),{cl}{fr['sin']}/{cl}{fr['tkt']},0)")
        r += 1
        fr["eqtot"] = r
        label(ws, r, "Pedidos equivalentes totales", bold=True)
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            numero(ws, r, c, f"={cl}{fr['vol']}+{cl}{fr['eq']}", bold=True)
        r += 1
        fr["chk"] = r
        label(ws, r, "Verificación: ticket × equivalentes totales − (ingresos del turno" + (" − desayuno)" if f_des else ")"))
        for c in range(col_ini, col_ini + n_hist):
            cl = get_column_letter(c)
            neto = f"({cl}{f_ing}-{cl}{f_des})" if f_des else f"{cl}{f_ing}"
            numero(ws, r, c, f"=ROUND({cl}{fr['tkt']}*{cl}{fr['eqtot']}-{neto},0)")
        filas_rev[turno_t] = fr
        if turno_t == "almuerzo":
            # Platos fuertes: ticket informativo (#9/#17) — ya no alimenta el consumo familiar.
            r += 1
            fr["tkt_pf"] = r
            label(ws, r, "Ticket platos fuertes — Almuerzo")
            for i in range(n_hist):
                numero(ws, r, col_ini + i, float(hist_df.iloc[i]["ticket_platos_fuertes"]))
            r += 1
            fr["unid_pf"] = r
            label(ws, r, "Unidades platos fuertes — Almuerzo")
            for i in range(n_hist):
                numero(ws, r, col_ini + i, float(hist_df.iloc[i]["unidades_platos_fuertes_almuerzo"]))
        if turno_t == "cena":
            nota(ws, r + 1, "Diferencia = ajustes negativos del turno (faltantes de caja); no es un error")
            r += 1
        r += 2
    fila_ventas_ped_alm, fila_sin_pedido_alm = filas_rev["almuerzo"]["ventas"], filas_rev["almuerzo"]["sin"]
    fila_vol_alm, fila_tkt_alm = filas_rev["almuerzo"]["vol"], filas_rev["almuerzo"]["tkt"]
    fila_eq_alm, fila_eqtot_alm = filas_rev["almuerzo"]["eq"], filas_rev["almuerzo"]["eqtot"]
    fila_ventas_ped_cena, fila_sin_pedido_cena = filas_rev["cena"]["ventas"], filas_rev["cena"]["sin"]
    fila_vol_cena, fila_tkt_cena = filas_rev["cena"]["vol"], filas_rev["cena"]["tkt"]
    fila_eq_cena, fila_eqtot_cena = filas_rev["cena"]["eq"], filas_rev["cena"]["eqtot"]
    nota(ws, r, "Ticket = ventas por pedidos ÷ pedidos registrados (misma definición del Tablero; sin ajustes manuales ni cierres manuales, sin Gratis, solo turnos cerrados). "
                "Los pedidos equivalentes son un ESTIMADO de cuántos pedidos 'valen' los ingresos sin pedido (a ticket promedio); si esos ingresos son negativos se dejan en 0 y la verificación muestra esa diferencia. "
                "No se usan para el comportamiento de clientes (gráficos de pedidos) ni para el consumo familiar. "
                "Platos fuertes (informativo) = completo, seco, asado130 y asado200: ticket = Σ monto_almuerzo (sin domicilio ni empaque) ÷ Σ cantidad; "
                "ya no alimenta el consumo familiar (ese usa un valor por comida fijo de Inputs).")
    r += 2
    nota(ws, r, "Solo histórico (el volumen proyectado no es necesario para calcular Ingresos, que se proyectan directo con el driver de crecimiento).")
    r += 2

    # ══ COST SCHEDULE ═══════════════════════════════════════════════
    banner(ws, r, "Cost Schedule", col_fin=col_fin)
    r += 2
    fila_cost_pct = r
    label(ws, r, "Costo de insumos (% de ingresos)")
    for c in range(col_ini, col_fin + 1):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=-{cl}{fila_costo_insumos}/{cl}{fila_ingresos}", pct=True)
    r += 1
    # Desechables: ya están DENTRO del costo de insumos (no se suman otra vez);
    # estas filas solo dejan a la vista cuánto de los insumos son desechables.
    fila_desech = r
    label(ws, r, "· de los cuales, desechables ($, informativo)")
    for i in range(n_hist):
        numero(ws, r, col_ini + i, float(hist_df.iloc[i]["costo_desechables"]))
    r += 1
    fila_desech_pct = r
    label(ws, r, "· Desechables (% de los ingresos)")
    for c in range(col_ini, col_ini + n_hist):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=IF({cl}{fila_ingresos}=0,0,{cl}{fila_desech}/{cl}{fila_ingresos})", pct=True)
    r += 1
    fila_ins_prov = r
    label(ws, r, "· Insumos de proveedores, sin desechables ($)")
    for c in range(col_ini, col_ini + n_hist):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=-{cl}{fila_costo_insumos}-{cl}{fila_desech}")
    r += 1
    nota(ws, r, "Costo de insumos = proveedores + desechables. Solo meses reales: el driver de proyección de insumos no separa los desechables.")
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

    # ══ CONSUMO FAMILIAR (ESTIMADO) ═══════════════════════════════════
    r += 3
    fam = bloque_consumo_familiar(
        ws, r, hist_df, driver_rows, col_ini, n_hist, n_fcst, col_fin,
        dict(ingresos=fila_ingresos, utilidad_neta=fila_utilidad_neta, costo_insumos=fila_costo_insumos,
             nomina=fila_nomina, arriendo=fila_arriendo, otros=fila_otros, tkt_alm=fila_tkt_alm, cost_pct=fila_cost_pct,
             desech=fila_desech, tkt_pf=filas_rev["almuerzo"]["tkt_pf"], unid_pf=filas_rev["almuerzo"]["unid_pf"],
             dias_operados=fila_dias_operados))

    model_refs = dict(
        fila_ingresos=fila_ingresos, fila_utilidad_bruta=fila_utilidad_bruta,
        fila_utilidad_op=fila_utilidad_op, fila_margen_op=fila_margen_op,
        fila_utilidad_neta=fila_utilidad_neta, col_ini=col_ini, col_fin=col_fin,
        labels_periodo=labels_periodo, n_hist=n_hist,
        fila_ing_alm=fila_ing_alm, fila_ing_cena=fila_ing_cena,
        fila_costo_insumos=fila_costo_insumos, fila_nomina=fila_nomina,
        fila_arriendo=fila_arriendo, fila_otros=fila_otros,
        fila_desayuno=fila_desayuno, fila_vol_alm=fila_vol_alm, fila_tkt_alm=fila_tkt_alm,
        fila_vol_cena=fila_vol_cena, fila_tkt_cena=fila_tkt_cena, fila_cost_pct=fila_cost_pct, fam=fam,
        fila_ventas_ped_alm=fila_ventas_ped_alm, fila_sin_pedido_alm=fila_sin_pedido_alm,
        fila_eq_alm=fila_eq_alm, fila_eqtot_alm=fila_eqtot_alm,
        fila_ventas_ped_cena=fila_ventas_ped_cena, fila_sin_pedido_cena=fila_sin_pedido_cena,
        fila_eq_cena=fila_eq_cena, fila_eqtot_cena=fila_eqtot_cena,
        fila_ticket_pf_alm=filas_rev["almuerzo"]["tkt_pf"], fila_unid_pf_alm=filas_rev["almuerzo"]["unid_pf"],
        fila_sin_aj_alm=filas_rev["almuerzo"]["sin_aj"], fila_sin_man_alm=filas_rev["almuerzo"]["sin_man"], fila_sin_dif_alm=filas_rev["almuerzo"]["sin_dif"],
        fila_sin_aj_cena=filas_rev["cena"]["sin_aj"], fila_sin_man_cena=filas_rev["cena"]["sin_man"], fila_sin_dif_cena=filas_rev["cena"]["sin_dif"],
        fila_desechables=fila_desech, fila_desech_pct=fila_desech_pct, fila_ins_prov=fila_ins_prov,
    )
    config_impresion(ws, horizontal=True)
    return ws, model_refs


# ══════════════════════════════════════════════════════════════════════
# MODEL: bloque "Consumo Familiar (ESTIMADO)" — la familia come sin pagar
# ══════════════════════════════════════════════════════════════════════
def bloque_consumo_familiar(ws, r, hist_df, driver_rows, col_ini, n_hist, n_fcst, col_fin, f):
    """Escribe en Model, a partir de la fila r, el consumo de la familia a
    PRECIO DE VENTA y los indicadores "reales" vs. "ajustados" (como si la
    familia hubiera pagado). Devuelve {clave: fila}.

    ALMUERZO: el cierre registra la CANTIDAD de comidas (cierres_dia.platos_familia: una por persona,
      aunque haya sido en porciones). Comidas del mes = Σ de las registradas + (días sin registro × comidas
      por día de Inputs). UN valor por comida por mes, fijo (ticket único de Inputs, no un blend con
      platos fuertes/porciones): valor del almuerzo = comidas del mes × valor por comida de Inputs.
      Lo único que varía mes a mes es la CANTIDAD de comidas, nunca el precio.
    COMIDA RÁPIDA: se registra VALOR real, con los pedidos de ubicación "Gratis"
      (llevan su precio de venta); no se estima nada en meses reales.
    Meses PROYECTADOS: todo sale de Inputs (días operados × comidas por día × valor por comida;
      comida rápida = el input proyectado).
    El costo de insumos de este consumo es solo informativo: ese costo YA está
    en los egresos (no se resta de nuevo). Los pedidos Gratis NUNCA suman a los
    ingresos reales.
    `f` = filas del Model que se necesitan: ingresos, utilidad_neta,
    costo_insumos, nomina, arriendo, otros, tkt_alm, cost_pct, desech, tkt_pf, unid_pf."""
    I = lambda k: f"Inputs!$E${driver_rows[k]}"
    banner(ws, r, "Consumo Familiar (ESTIMADO) — la familia come sin pagar", col_fin=col_fin)
    nota(ws, r + 1, "◆ = calculado por el script al generar el modelo (datos diarios del export). Las demás filas son fórmulas que leen la sección "
                    "'Consumo familiar (estimado)' de Inputs. Nada de esto suma a los ingresos reales.")
    r += 3

    orden = [
        # (clave, etiqueta, negrita, es_porcentaje)
        ("sec_op", "OPERACIÓN", None, False),
        ("dias_op", "◆ Días operados (con ingresos)", False, False),
        ("dias_alm", "◆ Días de almuerzo operados", False, False),
        ("sec_alm", "ALMUERZO — comidas registradas en el cierre", None, False),
        ("dias_reg", "◆ Días con registro de comidas", False, False),
        ("dias_sin", "Días sin registro", False, False),
        ("pct_reg", "% de días con registro real", False, True),
        ("platos_reg", "◆ Comidas registradas (Σ platos_familia)", False, False),
        ("sec_est", "ALMUERZO — comidas estimadas (días sin registro) y total", None, False),
        ("platos_est", "Comidas estimadas (días sin registro × comidas por día)", False, False),
        ("platos_tot", "Comidas totales (registradas + estimadas)", True, False),
        ("sec_val", "ALMUERZO — valor por comida de la familia (estimado fijo)", None, False),
        ("val_comida", "Valor por comida de la familia ($) — de Inputs", True, False),
        ("val_alm_reg", "Valor registrado a precio de venta (comidas registradas × valor por comida)", False, False),
        ("val_alm_est", "Valor estimado a precio de venta (comidas estimadas × valor por comida)", False, False),
        ("val_alm_tot", "Valor almuerzo a precio de venta (registrado + estimado)", True, False),
        ("sec_cr", "COMIDA RÁPIDA — pedidos Gratis (valor real)", None, False),
        ("val_cr", "◆ Valor a precio de venta (real; en meses proyectados = input)", True, False),
        ("sec_tot", "TOTAL DEL CONSUMO FAMILIAR", None, False),
        ("val_tot", "Valor total a precio de venta", True, False),
        ("costo_fam", "· Costo de insumos del consumo (informativo; YA está en los egresos, no restar)", False, False),
        ("sec_aj", "REAL vs. AJUSTADO (como si la familia hubiera pagado)", None, False),
        ("ing_aj", "Ingresos ajustados", True, False),
        ("ut_aj", "Utilidad ajustada", True, False),
        ("mg_real", "Margen neto real", False, True),
        ("mg_aj", "Margen neto ajustado", False, True),
        ("ins_real", "Costo de insumos % — real", False, True),
        ("ins_aj", "Costo de insumos % — ajustado (insumos ÷ ingresos ajustados)", False, True),
        ("des_real", "· de los cuales, desechables % de los ingresos — real", False, True),
        ("des_aj", "· de los cuales, desechables % — ajustado (÷ ingresos ajustados)", False, True),
        ("primo_real", "Costo primo % (insumos + nómina) — real", False, True),
        ("primo_aj", "Costo primo % (insumos + nómina) — ajustado", False, True),
        ("util_dia_real", "Utilidad diaria promedio — real", False, False),
        ("util_dia_aj", "Utilidad diaria promedio — ajustada", False, False),
        ("pe_real", "Punto de equilibrio diario — real", False, False),
        ("pe_aj", "Punto de equilibrio diario — ajustado", False, False),
        ("sec_gr", "INFORMATIVO — pedidos Gratis registrados (no son ingresos)", None, False),
        ("gratis_tot", "◆ Pedidos Gratis registrados (valor a precio de venta)", False, False),
        ("gratis_cr", "◆ · de comida rápida (ya incluidos en el consumo familiar de arriba)", False, False),
        ("gratis_alm", "◆ · de almuerzo (legado, NO incluidos arriba: hoy se anota la cantidad en el cierre)", False, False),
    ]
    filas = {}
    for clave, texto, negrita, _pct in orden:
        if negrita is None:   # subtítulo de sección
            if clave != "sec_op":
                r += 1
            label(ws, r, texto, bold=True)
            ws.cell(row=r, column=2).font = Font(name="Calibri", size=10, bold=True, color=AZUL_TEXTO)
        else:
            label(ws, r, texto, bold=negrita, indent=1)
        filas[clave] = r
        r += 1
    pct_de = {c: p for c, _t, _n, p in orden}

    h = lambda i, col: float(hist_df.iloc[i][col])
    def put(clave, fn, bold=False):
        for i, c in enumerate(range(col_ini, col_fin + 1)):
            v = fn(i, get_column_letter(c), i >= n_hist)
            if v is not None:
                numero(ws, filas[clave], c, v, bold=bold, pct=pct_de[clave])
    F = lambda k, cl: f"{cl}{filas[k]}"     # celda de una fila de este bloque
    M = lambda k, cl: f"{cl}{f[k]}"         # celda de una fila del resto del Model
    # ── OPERACIÓN (días operados proyectados: NETWORKDAYS.INTL de más arriba
    #    en Model, ya no un input fijo — reemplazado en el bloque A de días/festivos)
    put("dias_op", lambda i, cl, proy: f"={M('dias_operados', cl)}" if proy else int(h(i, "dias_operados")))
    put("dias_alm", lambda i, cl, proy: f"={M('dias_operados', cl)}" if proy else int(h(i, "dias_alm_operados")))
    # ── ALMUERZO registrado
    put("dias_reg", lambda i, cl, proy: 0 if proy else int(h(i, "dias_con_registro")))
    put("dias_sin", lambda i, cl, proy: f"={F('dias_alm', cl)}-{F('dias_reg', cl)}")
    put("pct_reg", lambda i, cl, proy: f"=IF({F('dias_alm', cl)}=0,0,{F('dias_reg', cl)}/{F('dias_alm', cl)})")
    put("platos_reg", lambda i, cl, proy: 0 if proy else h(i, "platos_registrados"))
    # ── ALMUERZO estimado y total (comidas)
    put("platos_est", lambda i, cl, proy: f"={F('dias_sin', cl)}*{I('fam_comidas_dia')}")
    put("platos_tot", lambda i, cl, proy: f"={F('platos_reg', cl)}+{F('platos_est', cl)}", bold=True)
    # ── ALMUERZO: UN valor por comida por mes — ticket único y fijo de
    #    Inputs (fam_valor_comida). Ya no distingue plato fuerte de porción ni
    #    mira el ticket real de platos fuertes del mes: lo único que varía la
    #    valoración mes a mes es la CANTIDAD de comidas (platos_reg/platos_est
    #    de arriba), no el precio.
    put("val_comida", lambda i, cl, proy: f"={I('fam_valor_comida')}", bold=True)
    put("val_alm_reg", lambda i, cl, proy: f"={F('platos_reg', cl)}*{F('val_comida', cl)}")
    put("val_alm_est", lambda i, cl, proy: f"={F('platos_est', cl)}*{F('val_comida', cl)}")
    put("val_alm_tot", lambda i, cl, proy: f"={F('val_alm_reg', cl)}+{F('val_alm_est', cl)}", bold=True)
    # ── COMIDA RÁPIDA y total
    put("val_cr", lambda i, cl, proy: f"={I('fam_cr_proy')}" if proy else h(i, "valor_cr_registrado"), bold=True)
    put("val_tot", lambda i, cl, proy: f"={F('val_alm_tot', cl)}+{F('val_cr', cl)}", bold=True)
    put("costo_fam", lambda i, cl, proy: f"={F('val_tot', cl)}*{M('cost_pct', cl)}")
    # ── REAL vs. AJUSTADO
    put("ing_aj", lambda i, cl, proy: f"={M('ingresos', cl)}+{F('val_tot', cl)}", bold=True)
    put("ut_aj", lambda i, cl, proy: f"={M('utilidad_neta', cl)}+{F('val_tot', cl)}", bold=True)
    put("mg_real", lambda i, cl, proy: f"=IF({M('ingresos', cl)}=0,0,{M('utilidad_neta', cl)}/{M('ingresos', cl)})")
    put("mg_aj", lambda i, cl, proy: f"=IF({F('ing_aj', cl)}=0,0,{F('ut_aj', cl)}/{F('ing_aj', cl)})")
    put("ins_real", lambda i, cl, proy: f"=IF({M('ingresos', cl)}=0,0,-{M('costo_insumos', cl)}/{M('ingresos', cl)})")
    put("ins_aj", lambda i, cl, proy: f"=IF({F('ing_aj', cl)}=0,0,-{M('costo_insumos', cl)}/{F('ing_aj', cl)})")
    # desechables (ya incluidos en insumos): solo meses reales, el proyectado no los separa
    put("des_real", lambda i, cl, proy: None if proy else f"=IF({M('ingresos', cl)}=0,0,{M('desech', cl)}/{M('ingresos', cl)})")
    put("des_aj", lambda i, cl, proy: None if proy else f"=IF({F('ing_aj', cl)}=0,0,{M('desech', cl)}/{F('ing_aj', cl)})")
    put("primo_real", lambda i, cl, proy: f"=IF({M('ingresos', cl)}=0,0,-({M('costo_insumos', cl)}+{M('nomina', cl)})/{M('ingresos', cl)})")
    put("primo_aj", lambda i, cl, proy: f"=IF({F('ing_aj', cl)}=0,0,-({M('costo_insumos', cl)}+{M('nomina', cl)})/{F('ing_aj', cl)})")
    put("util_dia_real", lambda i, cl, proy: f"=IF({F('dias_op', cl)}=0,0,{M('utilidad_neta', cl)}/{F('dias_op', cl)})")
    put("util_dia_aj", lambda i, cl, proy: f"=IF({F('dias_op', cl)}=0,0,{F('ut_aj', cl)}/{F('dias_op', cl)})")
    # punto de equilibrio diario = costos fijos ÷ (1 − insumos %) ÷ días operados
    fijos = lambda cl: f"-({M('nomina', cl)}+{M('arriendo', cl)}+{M('otros', cl)})"
    put("pe_real", lambda i, cl, proy: f"=IF(OR({F('dias_op', cl)}=0,{F('ins_real', cl)}>=1),0,({fijos(cl)})/(1-{F('ins_real', cl)})/{F('dias_op', cl)})")
    put("pe_aj", lambda i, cl, proy: f"=IF(OR({F('dias_op', cl)}=0,{F('ins_aj', cl)}>=1),0,({fijos(cl)})/(1-{F('ins_aj', cl)})/{F('dias_op', cl)})")
    # ── INFORMATIVO Gratis (solo meses reales)
    put("gratis_tot", lambda i, cl, proy: None if proy else h(i, "gratis_alm_valor") + h(i, "gratis_cr_valor"))
    put("gratis_cr", lambda i, cl, proy: None if proy else h(i, "gratis_cr_valor"))
    put("gratis_alm", lambda i, cl, proy: None if proy else h(i, "gratis_alm_valor"))
    nota(ws, r + 1, "Punto de equilibrio diario = (nómina + arriendo/servicios + otros) ÷ (1 − costo de insumos %) ÷ días operados. "
                    "En meses proyectados el consumo sale de Inputs (no hay registro diario).")
    return filas


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
    # Desechables (ya incluidos en el costo de insumos): solo meses reales.
    label(ws, r, "· de los cuales, desechables (% de Ingresos)")
    for c in range(col_ini, col_ini + model_refs["n_hist"]):
        cl = get_column_letter(c)
        numero(ws, r, c, f"=Model!{cl}{model_refs['fila_desech_pct']}", pct=True)
    fila_ref["Desechables Pct"] = r
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
        if fila_modelo == model_refs["fila_costo_insumos"]:
            # el rótulo de Insumos deja a la vista cuánto del total son desechables
            nombre = (f'="Costo de Insumos (incl. desechables $"&FIXED(SUM(Model!{col_hist_ini}{model_refs["fila_desechables"]}:'
                      f'{col_hist_fin}{model_refs["fila_desechables"]})/1000000,1)&" M)"')
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
    # Segunda línea: la parte de los insumos que son desechables (dentro del total de arriba)
    chart5.add_data(Reference(ws, min_col=col_ini, max_col=col_fin, min_row=fila_ref["Desechables Pct"]), titles_from_data=False, from_rows=True)
    chart5.series[1].tx = SeriesLabel(v="de los cuales, desechables")
    chart5.series[1].graphicalProperties.line.solidFill = "F1948A"
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


# ══════════════════════════════════════════════════════════════════════
# GRÁFICOS "TIPO PRESENTACIÓN" — infraestructura común
# ══════════════════════════════════════════════════════════════════════
# Un color = un significado. TODOS los gráficos nuevos usan SOLO estos nombres:
# la estética final se ajusta cambiando únicamente este diccionario.
PALETA = {
    "ingresos":      "2F6690",   # azul oscuro   — ventas / ingresos
    "egresos":       "B07AA1",   # malva         — egresos / costos
    "desechables":   "6E4565",   # malva oscuro  — desechables (la parte de los insumos que son vasos, platos, bolsas…)
    "utilidad":      "3FA66B",   # verde         — utilidad / lo favorable
    "alerta":        "C0392B",   # rojo          — por debajo de lo esperado / desfavorable
    "desayuno":      "E8C468",   # amarillo      — turno desayuno
    "almuerzo":      "4C7EA6",   # azul medio    — turno almuerzo
    "comida_rapida": "D98B3F",   # naranja       — turno comida rápida
    "real":          "2F6690",   # lo ya ocurrido (sólido)
    "proyectado":    "9DB9D3",   # lo proyectado (tono claro)
    "plan":          "E0A030",   # Plan = proyección Base a un mes
    "neutro_claro":  "D9D9D9",   # rejillas, referencias, "otros"
    "neutro_oscuro": "404040",   # títulos y textos
}


def tono_claro(hex_color, factor=0.55):
    """Mezcla un color con blanco (factor 0 = igual, 1 = blanco): tono claro
    del MISMO significado, p. ej. el proyectado de una serie real."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return "".join(f"{int(round(c + (255 - c) * factor)):02X}" for c in (r, g, b))


# Maquetación: cada gráfico es una "lámina" del tamaño de una página horizontal:
# título (celda grande) + subtítulo con el hallazgo + gráfico + nota de fuente/escala.
ANCHO_COL = 10          # ancho de las columnas B..N de las hojas de gráficos
N_COLS = 13             # B..N
ALTO_BLOQUE = 31        # filas por lámina (salto de página al final)
CHART_ANCHO, CHART_ALTO = 25.0, 12.6   # cm


def fmt_n(x, dec=0):
    """Número con separador de miles '.' y decimal ',' (estilo es-CO)."""
    s = f"{x:,.{dec}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def fmt_pesos(x):
    return ("−" if x < 0 else "") + "$" + fmt_n(abs(x))


def fmt_mill(x, dec=1):
    return ("−" if x < 0 else "") + "$" + fmt_n(abs(x) / 1e6, dec) + " M"


def fmt_pct(x, dec=0, signo=False):
    s = fmt_n(abs(x) * 100, dec) + "%"
    return (("+" if x > 0 else "−" if x < 0 else "") + s) if signo else (("−" if x < 0 else "") + s)


def txt_desechables(fh):
    """Frase para los gráficos de insumos: cuánto del costo de insumos del mes son
    desechables (ya están dentro de los insumos, no se suman otra vez). `fh` es la
    fila de `hist` del mes. Siempre se muestra, aunque sea $0: así se ve que se midió."""
    des, ins = float(fh["costo_desechables"]), float(fh["costo_insumos"])
    return f"{fmt_mill(des)} de desechables ({fmt_pct(des / ins if ins else 0, 1)} del rubro)"


def techo_bonito(x):
    """Redondea un máximo hacia arriba a un valor 'redondo' para el eje Y."""
    if x <= 0:
        return 1
    import math
    p = 10 ** math.floor(math.log10(x))
    for k in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if x <= k * p:
            return k * p
    return 10 * p


class HojaGraficos:
    """Una hoja de láminas. Cada lámina = bloque de ALTO_BLOQUE filas con salto
    de página al final. Las hojas de gráficos no usan cuadrícula."""

    def __init__(self, wb, nombre):
        ws = wb.create_sheet(nombre)
        ws.sheet_view.showGridLines = False
        ws.column_dimensions["A"].width = 2
        for c in range(2, 2 + N_COLS):
            ws.column_dimensions[get_column_letter(c)].width = ANCHO_COL
        ws.column_dimensions[get_column_letter(2 + N_COLS)].width = 2
        self.ws, self.nombre, self.fila = ws, nombre, 2

    def lamina(self, titulo, subtitulo, nota_txt, alto=ALTO_BLOQUE, alto_nota=36):
        """Escribe título, subtítulo y nota de una lámina y devuelve la fila donde
        anclar el gráfico. `subtitulo` puede ser una fórmula (empieza con '=')."""
        ws, r = self.ws, self.fila
        ultima_col = get_column_letter(1 + N_COLS)
        ws.merge_cells(f"B{r}:{ultima_col}{r}")
        c = ws.cell(row=r, column=2, value=titulo)
        c.font = Font(name="Calibri", size=18, bold=True, color=PALETA["neutro_oscuro"])
        c.alignment = Alignment(vertical="center")
        ws.row_dimensions[r].height = 30
        ws.merge_cells(f"B{r + 1}:{ultima_col}{r + 1}")
        s = ws.cell(row=r + 1, column=2, value=subtitulo)
        s.font = Font(name="Calibri", size=11, color=PALETA["neutro_oscuro"])
        s.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r + 1].height = 32
        fila_nota = r + alto - 3
        ws.merge_cells(f"B{fila_nota}:{ultima_col}{fila_nota}")
        n = ws.cell(row=fila_nota, column=2, value=nota_txt)
        n.font = Font(name="Calibri", size=9, italic=True, color=GRIS_NOTA)
        n.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[fila_nota].height = alto_nota
        ws.row_breaks.append(Break(id=r + alto - 1))
        self.fila = r + alto
        return r + 3

    def cerrar(self):
        ws = self.ws
        ws.print_area = f"A1:{get_column_letter(2 + N_COLS)}{self.fila - 1}"
        config_impresion(ws, horizontal=True)


# ── utilidades de gráficos ────────────────────────────────────────────
def serie_fila(ws, fila, c1, c2, titulo):
    return Series(Reference(ws, min_col=c1, max_col=c2, min_row=fila, max_row=fila), title=titulo)


def serie_col(ws, col, r1, r2, titulo):
    return Series(Reference(ws, min_col=col, min_row=r1, max_row=r2), title=titulo)


def titulo_eje(axis, texto):
    """Título de eje SIN overlay (si no, se dibuja encima de las etiquetas)."""
    axis.title = texto
    axis.title.overlay = False


def ejes(chart, x_titulo=None, y_titulo=None, y_fmt=None, y_min=None, y_max=None, rot_x=None, x_fmt=None):
    """openpyxl 3.1: sin delete=False los ejes NO se ven."""
    chart.x_axis.delete = False
    chart.y_axis.delete = False
    chart.roundedCorners = False
    if x_titulo:
        titulo_eje(chart.x_axis, x_titulo)
    if y_titulo:
        titulo_eje(chart.y_axis, y_titulo)
    if y_fmt:
        chart.y_axis.number_format = y_fmt
        chart.y_axis.numFmt.sourceLinked = False
    if x_fmt:
        chart.x_axis.number_format = x_fmt
    if y_min is not None:
        chart.y_axis.scaling.min = y_min
    if y_max is not None:
        chart.y_axis.scaling.max = y_max
    chart.y_axis.majorGridlines = ChartLines(spPr=GraphicalProperties(ln=LineProperties(solidFill=PALETA["neutro_claro"], w=6350)))
    if rot_x is not None:
        chart.x_axis.txPr = RichText(
            bodyPr=RichTextProperties(rot=int(rot_x * 60000), vert="horz"),
            p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=900)), endParaRPr=CharacterProperties())])


def tamano(chart, ancho=CHART_ANCHO, alto=CHART_ALTO):
    chart.width, chart.height = ancho, alto


def leyenda(chart, pos="b", ocultar_idx=()):
    if chart.legend is None:
        return
    chart.legend.position = pos
    chart.legend.overlay = False
    chart.legend.legendEntry = [LegendEntry(idx=i, delete=True) for i in ocultar_idx]


def sin_leyenda(chart):
    chart.legend = None


def color_serie(s, color, linea=False, ancho_pt=2.25, guion=None, marcador=False, suave=False):
    """Pinta una serie: barra (relleno) o línea."""
    if linea:
        s.graphicalProperties = GraphicalProperties()
        s.graphicalProperties.line.solidFill = color
        s.graphicalProperties.line.width = int(ancho_pt * 12700)
        if guion:
            s.graphicalProperties.line.dashStyle = guion
        s.smooth = suave
        if marcador:
            s.marker = Marker(symbol="circle", size=6)
            s.marker.graphicalProperties = GraphicalProperties(solidFill=color)
            s.marker.graphicalProperties.line.solidFill = color
        else:
            s.marker = Marker(symbol="none")
    else:
        s.graphicalProperties = GraphicalProperties(solidFill=color)
        s.graphicalProperties.line.solidFill = color
        s.invertIfNegative = False   # sin esto, una barra negativa sale hueca (relleno blanco)


def serie_invisible(s):
    s.graphicalProperties = GraphicalProperties(noFill=True)
    s.graphicalProperties.line.noFill = True


def puntos_color(s, colores):
    """Color por punto (barras): lista de hex, uno por categoría."""
    s.data_points = [DataPoint(idx=i, spPr=GraphicalProperties(solidFill=c)) for i, c in enumerate(colores) if c]


def etiquetas(s, fmt="0.0", pos=None, tam=900, color=None):
    s.dLbls = DataLabelList()
    s.dLbls.showVal = True
    s.dLbls.showSerName = s.dLbls.showCatName = s.dLbls.showLegendKey = s.dLbls.showPercent = False
    s.dLbls.numFmt = fmt
    if pos:
        s.dLbls.position = pos
    s.dLbls.txPr = RichText(
        bodyPr=RichTextProperties(),
        p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=tam, b=True, solidFill=color) if color else CharacterProperties(sz=tam)),
                     endParaRPr=CharacterProperties())])


def combo_secundario(bar, linea, y_titulo=None, y_fmt=None, y_min=None, y_max=None):
    """Barras (eje izq.) + líneas (eje derecho)."""
    linea.y_axis.axId = 200
    linea.y_axis.delete = False
    linea.y_axis.crosses = "max"
    linea.y_axis.majorGridlines = None
    if y_titulo:
        titulo_eje(linea.y_axis, y_titulo)
    if y_fmt:
        linea.y_axis.number_format = y_fmt
        linea.y_axis.numFmt.sourceLinked = False
    if y_min is not None:
        linea.y_axis.scaling.min = y_min
    if y_max is not None:
        linea.y_axis.scaling.max = y_max
    bar += linea
    return bar


def nuevo_bar(horizontal=False, apilado=False, ancho_gap=60):
    ch = BarChart()
    ch.type = "bar" if horizontal else "col"
    if apilado:
        ch.grouping = "stacked"
    ch.overlap = 100 if apilado else None
    ch.gapWidth = ancho_gap
    tamano(ch)
    return ch


def nuevo_linea():
    ch = LineChart()
    tamano(ch)
    return ch


# ══════════════════════════════════════════════════════════════════════
# CONTEXTO DEL MES EN FOCO + utilidades de acceso a Model / Datos_Graficos
# ══════════════════════════════════════════════════════════════════════
MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                "septiembre", "octubre", "noviembre", "diciembre"]


def nombre_mes_largo(periodo):
    return f"{MESES_LARGOS[int(periodo[5:]) - 1]} {periodo[:4]}"


def preparar_foco(ctx):
    """Calcula (y guarda en ctx) lo que comparten los gráficos del mes en foco."""
    hist, diario, mf = ctx["hist"], ctx["diario"], ctx["mes_foco"]
    periodos = list(hist["periodo"])
    ctx["periodos_reales"] = periodos
    ctx["i"] = periodos.index(mf)
    p = pd.Period(mf)
    ini, fin = p.start_time.normalize(), p.end_time.normalize()
    ctx["ini"], ctx["fin"] = ini, fin
    ctx["dias_cal"] = list(pd.date_range(ini, fin))
    ing = diario["ingresos"]
    ctx["ing_m"] = ing[(ing.index >= ini) & (ing.index <= fin)]
    ctx["op_m"] = ctx["ing_m"][ctx["ing_m"]["total"] > 0]
    egr = diario["egresos"]
    egr_m = egr[(egr["fecha"] >= ini) & (egr["fecha"] <= fin)] if not egr.empty else egr
    ctx["egr_m"] = egr_m
    ctx["egr_dia"] = egr_m.groupby("fecha")["monto"].sum() if not egr_m.empty else pd.Series(dtype=float)
    ultimo_dato = ing.index.max() if not ing.empty else ini
    # ¿el mes ya terminó? (hay datos hasta su último día, o hoy ya pasó)
    ctx["mes_terminado"] = bool(ultimo_dato >= fin or pd.Timestamp(diario["hoy"]) > fin)
    ctx["nombre_mes"] = nombre_mes_largo(mf)
    ctx["fila_hist"] = hist.iloc[ctx["i"]]


def cm(ctx, clave, i):
    """Referencia a una celda de Model: clave de model_refs ('fila_ingresos'…)
    o del bloque de consumo familiar ('dias_op', 'pe_real'…), mes i (0 = primer mes real)."""
    mr = ctx["mr"]
    fila = mr[clave] if clave in mr else mr["fam"][clave]
    return f"Model!{get_column_letter(mr['col_ini'] + i)}{fila}"


def hay_plan(ctx, i=None):
    plan = ctx["dg"].refs.get("plan")
    return bool(plan and plan["tiene_plan"][ctx["i"] if i is None else i])


def cplan(ctx, clave, i=None):
    """Referencia a una celda del Plan (hoja Datos_Graficos) para el mes i."""
    dg = ctx["dg"]
    i = ctx["i"] if i is None else i
    return f"Datos_Graficos!{get_column_letter(dg.col(i))}{dg.refs['plan']['filas'][clave]}"


def escribir_tabla(dg, r0, encabezados, filas, formatos=None, col0=2):
    """Escribe una tabla vertical en Datos_Graficos: fila de encabezados en r0 y
    los datos debajo. Valores calculados por el script van en azul (constantes);
    las fórmulas (empiezan con '=') en negro. Devuelve (primera, última) fila de datos."""
    ws = dg.ws
    for j, h in enumerate(encabezados):
        c = ws.cell(row=r0, column=col0 + j, value=h)
        c.font = Font(name="Calibri", size=10, bold=True)
        c.alignment = Alignment(horizontal="center" if j else "left", wrap_text=True)
    for k, fila in enumerate(filas):
        for j, v in enumerate(fila):
            if v is None:
                continue
            c = ws.cell(row=r0 + 1 + k, column=col0 + j, value=v)
            if isinstance(v, str) and not v.startswith("="):
                c.font = FONT_LABEL
            else:
                c.font = FONT_FORMULA if (isinstance(v, str) and v.startswith("=")) else Font(name="Calibri", size=10, color=AZUL_TEXTO)
                c.number_format = (formatos[j] if formatos and formatos[j] else FMT_CONTABLE)
    return r0 + 1, r0 + len(filas)


# ══════════════════════════════════════════════════════════════════════
# HOJA A_RESULTADO — ¿Cómo me fue este mes?
# ══════════════════════════════════════════════════════════════════════
def tabla_tarjetas(dg, ctx):
    """Tabla de apoyo de las 6 tarjetas: valor del mes, del mes anterior, Plan y
    variaciones. FÓRMULAS hacia Model / Plan (nada se calcula a mano)."""
    i = ctx["i"]
    tiene_ant = i > 0
    tiene_plan = hay_plan(ctx)
    r0 = dg.seccion("Tarjetas del mes en foco — " + ctx["nombre_mes"],
                    "FÓRMULAS hacia Model (mes en foco y mes anterior) y hacia el Plan (Datos_Graficos). Diario = mensual ÷ días operados.")
    dias = lambda j: cm(ctx, "dias_op", j)
    costos = lambda j: f"-({cm(ctx,'fila_costo_insumos',j)}+{cm(ctx,'fila_nomina',j)}+{cm(ctx,'fila_arriendo',j)}+{cm(ctx,'fila_otros',j)})"
    def valor(clave, j):
        return {
            "ingreso": f"=IF({dias(j)}=0,0,{cm(ctx,'fila_ingresos',j)}/{dias(j)})",
            "gasto": f"=IF({dias(j)}=0,0,({costos(j)})/{dias(j)})",
            "utilidad": f"=IF({dias(j)}=0,0,{cm(ctx,'fila_utilidad_neta',j)}/{dias(j)})",
            "pe": f"={cm(ctx,'pe_real',j)}",
            "ticket": f"={cm(ctx,'fila_tkt_alm',j)}",
            "dias": f"={dias(j)}",
        }[clave]
    plan_claves = {"ingreso": "ingresos", "gasto": "egresos", "utilidad": "utilidad"}
    filas, orden = [], ["ingreso", "gasto", "utilidad", "pe", "ticket", "dias"]
    nombres = {"ingreso": "Ingreso diario promedio", "gasto": "Gasto diario promedio", "utilidad": "Utilidad diaria promedio",
               "pe": "Punto de equilibrio diario", "ticket": "Ticket promedio almuerzo", "dias": "Días operados"}
    for k, clave in enumerate(orden):
        r = r0 + 1 + k
        plan = None
        if tiene_plan and clave in plan_claves:
            plan = f"=IF({dias(i)}=0,0,{cplan(ctx, plan_claves[clave])}/{dias(i)})"
        filas.append([
            nombres[clave], valor(clave, i),
            valor(clave, i - 1) if tiene_ant else None, plan,
            f'=IF(OR(D{r}="",D{r}=0),"",C{r}/D{r}-1)',
            f'=IF(OR(E{r}="",E{r}=0),"",C{r}/E{r}-1)',
        ])
    a, b = escribir_tabla(dg, r0, ["Indicador", "Mes en foco", "Mes anterior", "Plan", "Var. vs mes anterior", "Var. vs Plan"],
                          filas, formatos=[None, FMT_CONTABLE, FMT_CONTABLE, FMT_CONTABLE, FMT_PCT, FMT_PCT])
    dg.refs["tarjetas"] = dict(filas={c: a + k for k, c in enumerate(orden)})
    dg.cerrar(b)


def tarjeta(ws, fila, col, titulo, ref_valor, fmt_valor, ref_ant, ref_plan, fav_sube=True, con_plan=True):
    """Una tarjeta KPI (3 columnas × 5 filas): título, valor grande y dos
    líneas ▲▼ (vs mes anterior y vs Plan). Verde = favorable, rojo = desfavorable."""
    c0, c2 = get_column_letter(col), get_column_letter(col + 2)
    relleno = PatternFill("solid", fgColor=tono_claro(PALETA["neutro_claro"], 0.65))
    for r in range(fila, fila + 5):
        for c in range(col, col + 3):
            ws.cell(row=r, column=c).fill = relleno
        ws.cell(row=r, column=col).border = Border(left=Side(style="thick", color=PALETA["ingresos"]))
    ws.merge_cells(f"{c0}{fila}:{c2}{fila}")
    t = ws.cell(row=fila, column=col, value=titulo)
    t.font = Font(name="Calibri", size=10, bold=True, color=GRIS_NOTA)
    t.alignment = Alignment(horizontal="left", indent=1)
    ws.merge_cells(f"{c0}{fila + 1}:{c2}{fila + 2}")
    v = ws.cell(row=fila + 1, column=col, value=ref_valor)
    v.font = Font(name="Calibri", size=22, bold=True, color=PALETA["neutro_oscuro"])
    v.number_format = fmt_valor
    v.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    lineas = [(fila + 3, ref_ant, "mes anterior", True)]
    if con_plan:
        lineas.append((fila + 4, ref_plan, "Plan", True))
    for r, ref, txt, _ in lineas:
        ws.merge_cells(f"{c0}{r}:{c2}{r}")
        x = ws.cell(row=r, column=col, value=ref)
        x.font = Font(name="Calibri", size=10, bold=True)
        x.alignment = Alignment(horizontal="left", indent=1)
        bien, mal = PALETA["utilidad"], PALETA["alerta"]
        sube_c, baja_c = (bien, mal) if fav_sube else (mal, bien)
        ws.conditional_formatting.add(f"{c0}{r}", FormulaRule(formula=[f'LEFT({c0}{r},1)="▲"'], font=Font(color=sube_c, bold=True)))
        ws.conditional_formatting.add(f"{c0}{r}", FormulaRule(formula=[f'LEFT({c0}{r},1)="▼"'], font=Font(color=baja_c, bold=True)))


def f_var_texto(celda_var, etiqueta):
    """Texto '▲ 12,3% vs mes anterior' a partir de una celda de variación (o vacío).
    FIXED respeta el separador decimal de la configuración regional (TEXT con "0.0" no)."""
    return f'=IF({celda_var}="","sin {etiqueta}",IF({celda_var}>=0,"▲ ","▼ ")&FIXED(ABS({celda_var})*100,1)&"% vs {etiqueta}")'


def f_mill(expr, dec=1):
    """Fórmula-texto de un monto en $ millones, locale-safe: FIXED(x/1e6, 1)."""
    return f"FIXED(({expr})/1000000,{dec})"


def f_signo_pct(expr):
    """Fórmula-texto '+12%' / '−5%' (entero) de una variación."""
    return f'IF(({expr})>=0,"+","−")&FIXED(ABS({expr})*100,0)&"%"'


def hoja_a_resultado(wb, ctx):
    dg = ctx["dg"]
    tabla_tarjetas(dg, ctx)
    h = HojaGraficos(wb, "A_Resultado")
    ws, i = h.ws, ctx["i"]
    fh = ctx["fila_hist"]
    T = dg.refs["tarjetas"]["filas"]
    dgc = lambda clave, col: f"Datos_Graficos!{col}{T[clave]}"

    # ── Lámina 0: tarjetas ──────────────────────────────────────────
    ingresos_mes = float(fh["ingresos_almuerzo"] + fh["ingresos_cena"])
    egresos_mes = float(fh["costo_insumos"] + fh["nomina"] + fh["arriendo_servicios"] + fh["otros_gastos"])
    r = h.lamina(
        f"¿Cómo me fue este mes? — {ctx['nombre_mes'].capitalize()}",
        f"En {ctx['nombre_mes']} se vendieron {fmt_pesos(ingresos_mes)} y se gastaron {fmt_pesos(egresos_mes)} en {int(fh['dias_operados'])} días operados: "
        f"quedaron {fmt_pesos(ingresos_mes - egresos_mes)} de utilidad.",
        "Cada tarjeta compara con el mes anterior y, las tres primeras, con el Plan = proyección Base a un mes (real del mes anterior × drivers Base de Inputs). "
        "▲▼ en verde = favorable, en rojo = desfavorable (en gasto y punto de equilibrio, subir es desfavorable). Todo diario = mensual ÷ días operados. "
        "Fuente: hoja Model (fórmulas).")
    tiles = [
        ("INGRESO DIARIO PROMEDIO", "ingreso", True, True), ("GASTO DIARIO PROMEDIO", "gasto", False, True), ("UTILIDAD DIARIA PROMEDIO", "utilidad", True, True),
        ("PUNTO DE EQUILIBRIO DIARIO", "pe", False, False), ("TICKET PROMEDIO ALMUERZO", "ticket", True, False), ("DÍAS OPERADOS", "dias", True, False),
    ]
    for k, (titulo, clave, fav_sube, con_plan) in enumerate(tiles):
        fila = r + 1 + (k // 3) * 7
        col = 2 + (k % 3) * 4
        tarjeta(ws, fila, col, titulo, f"={dgc(clave, 'C')}", "$ #,##0" if clave != "dias" else "0",
                f_var_texto(dgc(clave, "F"), "mes anterior"), f_var_texto(dgc(clave, "G"), "Plan"), fav_sube=fav_sube,
                con_plan=con_plan and hay_plan(ctx))
    if not hay_plan(ctx):
        nota(ws, r + 15, "Sin Plan para este mes (necesita un mes anterior real y meses proyectados): las líneas 'vs Plan' se omiten.", col=2)

    for g in (grafico_1, grafico_2, grafico_3, grafico_4, grafico_12):
        g(h, ctx)
    h.cerrar()
    return h


# ── #1 Ingreso diario vs. gasto diario promedio ───────────────────────
def grafico_1(h, ctx):
    ws, dg, i, fh = h.ws, ctx["dg"], ctx["i"], ctx["fila_hist"]
    op = ctx["op_m"]
    ingresos_mes = float(fh["ingresos_almuerzo"] + fh["ingresos_cena"])
    egresos_mes = float(fh["costo_insumos"] + fh["nomina"] + fh["arriendo_servicios"] + fh["otros_gastos"])
    n = max(int(fh["dias_operados"]), 1)
    ing_prom, gas_prom = ingresos_mes / n, egresos_mes / n
    por_debajo = int((op["total"] < gas_prom).sum())
    r = h.lamina(
        f"Ingreso diario vs. gasto diario promedio — {ctx['nombre_mes'].capitalize()}",
        f"El ingreso diario promedio fue {fmt_pesos(ing_prom)} y el gasto diario promedio {fmt_pesos(gas_prom)}; "
        f"en {por_debajo} de {len(op)} días operados el ingreso quedó por debajo del gasto diario promedio.",
        "Escala: $ miles por día. Barras en rojo = días con ingreso menor al gasto diario promedio (el gasto total del mes ÷ días operados, incluye arriendo, nómina e insumos). "
        "Solo días operados. Fuente: Cierres_Dia (ingresos) y Egresos + Gastos_Cierre (gasto promedio, vía Model).")
    T = dg.refs["tarjetas"]["filas"]
    r0 = dg.seccion("#1 — Ingreso diario del mes en foco ($ miles)",
                    "Barras: calculado por el script al generar el modelo (Cierres_Dia). Líneas: FÓRMULAS hacia la tabla de tarjetas (promedios ÷ 1.000).")
    filas = []
    for d, row in op.iterrows():
        v = row["total"] / 1000
        filas.append([f"{d.day} {DIAS_SEMANA[d.dayofweek]}", None if row["total"] < gas_prom else v, v if row["total"] < gas_prom else None,
                      f"=Datos_Graficos!$C${T['ingreso']}/1000", f"=Datos_Graficos!$C${T['gasto']}/1000"])
    a, b = escribir_tabla(dg, r0, ["Día", "Ingreso ≥ gasto prom.", "Ingreso < gasto prom.", "Ingreso diario promedio", "Gasto diario promedio"],
                          filas, formatos=[None, "#,##0", "#,##0", "#,##0", "#,##0"])
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=40)
    bar.overlap = 100
    for col, color, nom in ((3, PALETA["ingresos"], "Ingreso del día"), (4, PALETA["alerta"], "Ingreso < gasto diario promedio")):
        s = serie_col(dg.ws, col, a, b, nom)
        color_serie(s, color)
        bar.series.append(s)
    bar.set_categories(cats)
    techo = techo_bonito(max(op["total"].max() / 1000, ing_prom / 1000, gas_prom / 1000) * 1.06)
    ejes(bar, x_titulo="Día operado", y_titulo="$ miles por día", y_fmt="#,##0", y_min=0, y_max=techo, rot_x=-90)
    linea = nuevo_linea()
    for col, color, nom, guion in ((5, PALETA["ingresos"], "Ingreso diario promedio", "dash"), (6, PALETA["egresos"], "Gasto diario promedio", "solid")):
        s = serie_col(dg.ws, col, a, b, nom)
        color_serie(s, color, linea=True, ancho_pt=2.5, guion=guion)
        linea.series.append(s)
    linea.set_categories(cats)
    bar += linea
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── helper: cascada (barras apiladas con base invisible) ───────────────
def tabla_cascada(dg, titulo, origen, pasos, dec=1):
    """Cascada en $ millones con FÓRMULAS. `pasos` = [(etiqueta, formula_en_pesos, tipo)],
    tipo: 'total' (barra desde 0 hasta el valor) o 'delta' (flotante: suma/resta al acumulado).
    Soporta valores que cruzan el cero (separa la parte positiva de la negativa).
    Devuelve (primera, última fila, columnas) para armar el gráfico."""
    r0 = dg.seccion(titulo, origen)
    enc = ["Paso", "Valor ($ M)", "Inicio", "Fin", "Base (+)", "Valor (+)", "Base (−)", "Valor (−)"]
    filas = []
    for k, (et, f, tipo) in enumerate(pasos):
        r = r0 + 1 + k
        valor = f"=({f[1:] if f.startswith('=') else f})/1000000"
        if tipo == "total":
            ini, fin = "=0", f"=C{r}"
        else:
            ini, fin = (f"=E{r - 1}" if k else "=0"), f"=D{r}+C{r}"
        filas.append([et, valor, ini, fin,
                      f"=MAX(MIN(D{r},E{r}),0)", f"=MAX(MAX(D{r},E{r}),0)-MAX(MIN(D{r},E{r}),0)",
                      f"=MIN(MAX(D{r},E{r}),0)", f"=MIN(MIN(D{r},E{r}),0)-MIN(MAX(D{r},E{r}),0)"])
    # (columnas: B etiqueta, C valor, D inicio, E fin, F base+, G val+, H base−, I val−)
    fmt_lab = "#,##0." + "0" * dec + ";-#,##0." + "0" * dec + ";;"   # las etiquetas heredan este formato: sin ceros
    a, b = escribir_tabla(dg, r0, enc, filas, formatos=[None, "#,##0.00", "#,##0.00", "#,##0.00", "#,##0.00", fmt_lab, "#,##0.00", fmt_lab])
    return a, b


def grafico_cascada(h, dg, a, b, colores, y_titulo="$ millones", etiqueta_fmt="#,##0.0;-#,##0.0;;", y_fmt="#,##0.0"):
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    ch = nuevo_bar(apilado=True, ancho_gap=45)
    series = []
    for col, nom, visible in ((6, "Base (+)", False), (7, "Valor (+)", True), (8, "Base (−)", False), (9, "Valor (−)", True)):
        s = serie_col(dg.ws, col, a, b, nom)
        if visible:
            color_serie(s, PALETA["neutro_claro"])
            puntos_color(s, colores)
            etiquetas(s, fmt=etiqueta_fmt, pos="inEnd", color="FFFFFF")
        else:
            serie_invisible(s)
        ch.series.append(s)
        series.append(s)
    ch.set_categories(cats)
    ejes(ch, y_titulo=y_titulo, y_fmt=y_fmt)
    sin_leyenda(ch)
    return ch


# ── #2 ¿De cada $100 vendidos, cuánto queda? ──────────────────────────
def grafico_2(h, ctx):
    ws, dg, i, fh = h.ws, ctx["dg"], ctx["i"], ctx["fila_hist"]
    ing = float(fh["ingresos_almuerzo"] + fh["ingresos_cena"])
    ins, nom, arr, otr = (float(fh[k]) for k in ("costo_insumos", "nomina", "arriendo_servicios", "otros_gastos"))
    des = float(fh["costo_desechables"])
    ut = ing - ins - nom - arr - otr
    por100 = lambda x: fmt_n(100 * x / ing, 1) if ing else "0"
    r = h.lamina(
        f"De cada $100 vendidos, ¿cuánto queda? — {ctx['nombre_mes'].capitalize()}",
        f"De cada $100 vendidos: ${por100(ins)} van a insumos (${por100(des)} de ellos son desechables), ${por100(nom)} a nómina, ${por100(arr)} a arriendo y servicios, "
        f"${por100(otr)} a otros gastos y quedan ${por100(ut)} de utilidad.",
        "Escala: $ millones del mes. La barra azul es el total vendido; cada paso resta un rubro hasta llegar a la utilidad. "
        "Los insumos se separan en proveedores y desechables (los dos juntos son el costo de insumos). "
        "Fuente: hoja Model — Estado de Resultados (fórmulas).")
    pasos = [("Ingresos", f"={cm(ctx,'fila_ingresos',i)}", "total"),
             ("Insumos (proveedores)", f"=-{cm(ctx,'fila_ins_prov',i)}", "delta"),
             (f"Desechables ({fmt_mill(des)})", f"=-{cm(ctx,'fila_desechables',i)}", "delta"),   # el valor va en el rótulo: la barra es muy delgada
             ("Nómina", f"={cm(ctx,'fila_nomina',i)}", "delta"),
             ("Arriendo y servicios", f"={cm(ctx,'fila_arriendo',i)}", "delta"),
             ("Otros", f"={cm(ctx,'fila_otros',i)}", "delta"),
             ("Utilidad", f"={cm(ctx,'fila_utilidad_neta',i)}", "total")]
    a, b = tabla_cascada(dg, "#2 — Cascada de resultados del mes en foco ($ M)", "FÓRMULAS hacia Model. Las columnas Base son invisibles: sostienen las barras flotantes.", pasos)
    dg.cerrar(b)
    colores = ([PALETA["ingresos"], PALETA["egresos"], PALETA["desechables"]] + [PALETA["egresos"]] * 3
               + [PALETA["utilidad"] if ut >= 0 else PALETA["alerta"]])
    ch = grafico_cascada(h, dg, a, b, colores)
    ejes(ch, x_titulo="Paso del estado de resultados", y_titulo="$ millones", y_fmt="#,##0.0")
    ws.add_chart(ch, f"B{r}")


# ── #3 Evolución mensual: ingresos, egresos y margen ──────────────────
def meses_del_anio(ctx, anio):
    """Lista de 12 periodos AAAA-MM del año, con su índice en Model (None si ese
    mes no está en el modelo: antes del primer mes real o después de la proyección)."""
    labels = ctx["mr"]["labels_periodo"]
    out = []
    for m in range(1, 13):
        p = f"{anio}-{m:02d}"
        out.append((p, labels.index(p) if p in labels else None))
    return out


def margen_mes(hist_idx, p):
    """Margen neto de un mes real (utilidad ÷ ingresos), desde `hist` indexado por periodo."""
    ing = float(hist_idx.loc[p, "ingresos_almuerzo"] + hist_idx.loc[p, "ingresos_cena"])
    egr = float(hist_idx.loc[p, "costo_insumos"] + hist_idx.loc[p, "nomina"] + hist_idx.loc[p, "arriendo_servicios"] + hist_idx.loc[p, "otros_gastos"])
    return (ing - egr) / ing if ing else 0.0


def grafico_3(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    mr, n_hist = ctx["mr"], ctx["mr"]["n_hist"]
    anio = int(ctx["mes_foco"][:4])
    meses = meses_del_anio(ctx, anio)
    labels_real = ctx["periodos_reales"]
    # hallazgo: variación del último mes real del año vs. el anterior
    reales_anio = [p for p, ix in meses if ix is not None and ix < n_hist]
    hist = ctx["hist"].set_index("periodo")
    ing = lambda p: float(hist.loc[p, "ingresos_almuerzo"] + hist.loc[p, "ingresos_cena"])
    if len(reales_anio) >= 2 and ing(reales_anio[-2]) > 0:
        hallazgo = (f"Los ingresos de {nombre_mes_largo(reales_anio[-1])} fueron {fmt_mill(ing(reales_anio[-1]))}, "
                    f"{fmt_pct(ing(reales_anio[-1]) / ing(reales_anio[-2]) - 1, 1, True)} frente a {nombre_mes_largo(reales_anio[-2])} ({fmt_mill(ing(reales_anio[-2]))}).")
    elif reales_anio:
        hallazgo = f"Los ingresos de {nombre_mes_largo(reales_anio[-1])} fueron {fmt_mill(ing(reales_anio[-1]))} (no hay mes anterior real para comparar)."
    if len(reales_anio) >= 2 and reales_anio[-1] == ctx["mes_foco"]:
        hallazgo += aviso_dias(ctx)
    else:
        hallazgo = "No hay meses reales en este año."
    r = h.lamina(
        f"Evolución mensual {anio}: ingresos, egresos y margen",
        hallazgo,
        f"Escala: $ millones por mes (barras, eje izquierdo desde 0) y margen neto % (línea, eje derecho). Tono sólido = real; tono claro = proyectado "
        f"(escenario activo de Inputs). Los meses de {anio} que no están en el modelo quedan vacíos. Fuente: hoja Model (fórmulas).")
    r0 = dg.seccion(f"#3 — Evolución mensual {anio} ($ M y margen)", "FÓRMULAS hacia Model. Mes i del año en la columna C+i; vacío si ese mes no está en el modelo.")
    ws_d = dg.ws
    label(ws_d, r0, "Mes")
    filas = {"ing": r0 + 1, "egr": r0 + 2, "mgr": r0 + 3, "mgp": r0 + 4}
    label(ws_d, filas["ing"], "Ingresos ($ M)"); label(ws_d, filas["egr"], "Egresos ($ M)")
    label(ws_d, filas["mgr"], "Margen neto — real"); label(ws_d, filas["mgp"], "Margen neto — proyectado")
    colores_i, colores_e = [], []
    for k, (p, ix) in enumerate(meses):
        c = dg.col(k)
        ws_d.cell(row=r0, column=c, value=etiqueta_mes(p)).font = Font(bold=True)
        ws_d.cell(row=r0, column=c).alignment = Alignment(horizontal="center")
        real = ix is not None and ix < n_hist
        colores_i.append(PALETA["ingresos"] if real else tono_claro(PALETA["ingresos"]))
        colores_e.append(PALETA["egresos"] if real else tono_claro(PALETA["egresos"]))
        if ix is None:
            continue
        ing_f, egr_f = cm(ctx, "fila_ingresos", ix), f"-({cm(ctx,'fila_costo_insumos',ix)}+{cm(ctx,'fila_nomina',ix)}+{cm(ctx,'fila_arriendo',ix)}+{cm(ctx,'fila_otros',ix)})"
        numero(ws_d, filas["ing"], c, f"={ing_f}/1000000").number_format = "#,##0.0"
        numero(ws_d, filas["egr"], c, f"=({egr_f})/1000000").number_format = "#,##0.0"
        mg = f"=IF({ing_f}=0,0,{cm(ctx,'fila_utilidad_neta',ix)}/{ing_f})"
        numero(ws_d, filas["mgr" if real else "mgp"], c, mg, pct=True)
    dg.cerrar(filas["mgp"])
    c1, c2 = dg.col(0), dg.col(11)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=r0)
    bar = nuevo_bar(ancho_gap=70)
    s_i = serie_fila(ws_d, filas["ing"], c1, c2, "Ingresos"); color_serie(s_i, PALETA["ingresos"]); puntos_color(s_i, colores_i)
    s_e = serie_fila(ws_d, filas["egr"], c1, c2, "Egresos"); color_serie(s_e, PALETA["egresos"]); puntos_color(s_e, colores_e)
    bar.series += [s_i, s_e]
    bar.set_categories(cats)
    ejes(bar, x_titulo="Mes", y_titulo="$ millones", y_fmt="#,##0.0", y_min=0)
    linea = nuevo_linea()
    s_mr = serie_fila(ws_d, filas["mgr"], c1, c2, "Margen neto (real)"); color_serie(s_mr, PALETA["utilidad"], linea=True, marcador=True)
    s_mp = serie_fila(ws_d, filas["mgp"], c1, c2, "Margen neto (proyectado)"); color_serie(s_mp, PALETA["utilidad"], linea=True, guion="dash", marcador=True)
    linea.series += [s_mr, s_mp]
    linea.set_categories(cats)
    # margen real puede salirse de 0–40 % (p. ej. un primer mes parcial): el eje se amplía solo cuando hace falta
    margenes = [margen_mes(hist, p) for p in reales_anio] or [0.0]
    mg_max, mg_min = max(0.40, math.ceil(max(margenes) * 10) / 10), min(0.0, math.floor(min(margenes) * 10) / 10)
    combo_secundario(bar, linea, y_titulo="Margen neto", y_fmt="0%", y_min=mg_min, y_max=mg_max)
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── Plan en pandas (contraste de las fórmulas + rango de ejes) ─────────
def plan_pandas(ctx, i):
    """Plan(M) calculado en pandas con la MISMA regla que las fórmulas de la tabla
    Plan: real del mes anterior × drivers Base del primer mes proyectado. Solo se
    usa para decidir rangos de ejes y para contrastar las fórmulas en las pruebas."""
    b = ctx["dr"]["_base_valores"]
    hist = ctx["hist"]
    prev = hist.iloc[i - 1]
    alm = float(prev["ingresos_almuerzo"]) * (1 + b["crecimiento_almuerzo"])
    cena = float(prev["ingresos_cena"]) * (1 + b["crecimiento_cena"])
    ing = alm + cena
    ins = ing * b["costo_insumos_pct"]
    nom = float(prev["nomina"]) * (1 + b["inflacion_gastos"])
    arr = float(prev["arriendo_servicios"]) * (1 + b["inflacion_gastos"])
    otr = float(prev["otros_gastos"]) * (1 + b["inflacion_gastos"])
    egr = ins + nom + arr + otr
    return dict(ing_alm=alm, ing_cena=cena, ingresos=ing, insumos=ins, nomina=nom, arriendo=arr, otros=otr, egresos=egr, utilidad=ing - egr)


# ── #4 Real vs. Plan ──────────────────────────────────────────────────
def grafico_4(h, ctx):
    ws, dg, i, fh = h.ws, ctx["dg"], ctx["i"], ctx["fila_hist"]
    titulo = f"Real vs. Plan — {ctx['nombre_mes'].capitalize()}"
    if not hay_plan(ctx):
        h.lamina(titulo, "Sin Plan para este mes: el Plan necesita un mes anterior real y meses proyectados.",
                 "Plan = proyección Base a un mes (real del mes anterior × drivers Base del primer mes proyectado). "
                 "Omitido para este mes; se genera cuando el mes en foco tiene un mes anterior real.")
        return
    rubros = [("Ingresos", f"={cm(ctx,'fila_ingresos',i)}", "ingresos", True),
              (f"Insumos (incl. desechables {fmt_mill(float(fh['costo_desechables']))})", f"=-{cm(ctx,'fila_costo_insumos',i)}", "insumos", False),
              ("Nómina", f"=-{cm(ctx,'fila_nomina',i)}", "nomina", False),
              ("Arriendo y servicios", f"=-{cm(ctx,'fila_arriendo',i)}", "arriendo", False),
              ("Otros", f"=-{cm(ctx,'fila_otros',i)}", "otros", False),
              ("Utilidad", f"={cm(ctx,'fila_utilidad_neta',i)}", "utilidad", True)]
    r0 = dg.seccion("#4 — Real vs. Plan del mes en foco",
                    "FÓRMULAS: real (Model) y Plan (tabla Plan). Favorable / desfavorable por rubro (en costos, gastar más que el Plan es desfavorable).")
    pl = plan_pandas(ctx, i)
    real_ut = float(fh["ingresos_almuerzo"] + fh["ingresos_cena"] - fh["costo_insumos"] - fh["nomina"] - fh["arriendo_servicios"] - fh["otros_gastos"])
    reales = dict(ingresos=float(fh["ingresos_almuerzo"] + fh["ingresos_cena"]), insumos=float(fh["costo_insumos"]), nomina=float(fh["nomina"]),
                  arriendo=float(fh["arriendo_servicios"]), otros=float(fh["otros_gastos"]), utilidad=real_ut)
    variaciones = [reales[c] / pl[c] - 1 for _n, _f, c, _e in rubros if pl[c]]
    peor = max([abs(v) for v in variaciones] + [0.0])
    # eje de −30 % a +30 %; solo se amplía (a 60 % o 100 %) si hay variaciones mayores. Las barras más
    # grandes se recortan en el borde del eje: el valor REAL va siempre en el nombre de la categoría.
    tope = 0.30 if peor <= 0.30 else 0.60 if peor <= 0.60 else 1.00
    filas = []
    for k, (nom, f_real, clave_plan, es_ingreso) in enumerate(rubros):
        rr, sg = r0 + 1 + k, ("" if es_ingreso else "-")
        recorte = f"MAX(-{tope},MIN({tope},E{rr}))"
        filas.append([nom, f_real, f"={cplan(ctx, clave_plan)}", f"=IF(D{rr}=0,0,C{rr}/D{rr}-1)",
                      f'=B{rr}&"  ("&{f_signo_pct(f"E{rr}")}&")"',
                      f"=IF({sg}E{rr}>=0,{recorte},0)", f"=IF({sg}E{rr}<0,{recorte},0)"])
    a, b = escribir_tabla(dg, r0, ["Rubro", "Real ($)", "Plan ($)", "Variación % real", "Rubro (con variación)", "Favorable (graficado)", "Desfavorable (graficado)"],
                          filas, formatos=[None, FMT_CONTABLE, FMT_CONTABLE, "+0.0%;-0.0%;0.0%", None, "+0%;-0%;;", "+0%;-0%;;"])
    dg.cerrar(b)
    sub = (f'="Utilidad real "&{f_mill(f"Datos_Graficos!C{b}")}&" M frente a "&{f_mill(f"Datos_Graficos!D{b}")}&" M de Plan ("&{f_signo_pct(f"Datos_Graficos!E{b}")}&")."')
    r = h.lamina(
        titulo, sub,
        "Escala: variación % del real contra el Plan (= proyección Base a un mes). Verde = favorable (más ingresos/utilidad o menos costo que el Plan), rojo = desfavorable. "
        + (f"El eje se amplió a ±{int(tope * 100)} % porque hay variaciones mayores: las barras más largas se recortan en el borde y su valor real está entre paréntesis en el nombre del rubro. "
           if tope > 0.30 else "Eje de −30 % a +30 %. ")
        + "Insumos = proveedores + desechables (el valor de los desechables va en el nombre del rubro; el Plan de insumos no los separa). "
        + "Fuente: Model y Plan (fórmulas).")
    cats = Reference(dg.ws, min_col=6, min_row=a, max_row=b)
    bar = nuevo_bar(horizontal=True, ancho_gap=45)
    bar.overlap = 100
    s_f = serie_col(dg.ws, 7, a, b, "Favorable"); color_serie(s_f, PALETA["utilidad"])
    s_d = serie_col(dg.ws, 8, a, b, "Desfavorable"); color_serie(s_d, PALETA["alerta"])
    bar.series += [s_f, s_d]
    bar.set_categories(cats)
    bar.x_axis.scaling.orientation = "maxMin"        # primer rubro arriba
    ejes(bar, y_titulo="Variación % vs. Plan", y_fmt="+0%;-0%;0%", y_min=-tope, y_max=tope)
    bar.y_axis.majorUnit = 0.1 if tope <= 0.3 else 0.2 if tope <= 0.6 else 0.25
    bar.y_axis.crosses = "max"                       # eje de valores abajo aunque las categorías vayan invertidas
    bar.x_axis.tickLblPos = "low"                    # nombres de rubros a la izquierda aunque haya barras negativas
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── #12 Ritmo del mes: utilidad acumulada vs. meta ────────────────────
def grafico_12(h, ctx):
    ws, dg, i = h.ws, ctx["dg"], ctx["i"]
    titulo = f"Ritmo del mes: utilidad acumulada vs. meta — {ctx['nombre_mes'].capitalize()}"
    if not hay_plan(ctx):
        h.lamina(titulo, "Sin Plan para este mes: la meta sale de la utilidad del Plan.",
                 "Meta = utilidad Plan del mes repartida en partes iguales por día operado esperado. Omitido porque este mes no tiene Plan.")
        return
    dias = ctx["dias_cal"]
    ing, egr = ctx["ing_m"]["total"], ctx["egr_dia"]
    ultimo_dato = min(ctx["ing_m"].index.max(), ctx["fin"])
    util_dia = [float(ing.get(d, 0.0) - egr.get(d, 0.0)) for d in dias]
    acum = list(np.cumsum(util_dia))
    ult_real = max(k for k, d in enumerate(dias) if d <= ultimo_dato)
    # días operados esperados: 26 si el mes no ha terminado; los reales si ya terminó
    if ctx["mes_terminado"]:
        operados = set(ctx["op_m"].index)
        k_d = [int(v) for v in np.cumsum([1 if d in operados else 0 for d in dias])]
        n_esp = max(len(operados), 1)
        esp_txt = f"{len(operados)} días operados reales (el mes ya terminó)"
    else:
        n_esp = 26
        k_d = [min(n_esp, int(v)) for v in np.cumsum([1 if d.dayofweek != 6 else 0 for d in dias])]
        esp_txt = "26 días operados esperados (el mes no ha terminado)"
    plan_ut = cplan(ctx, "utilidad")
    r0 = dg.seccion("#12 — Ritmo del mes: utilidad acumulada ($ M)",
                    "Real: calculado por el script (Cierres_Dia − Egresos/Gastos_Cierre por fecha). Meta: FÓRMULA = utilidad Plan × días operados esperados hasta ese día ÷ total esperado.")
    filas = [[str(d.day), (acum[k] / 1e6 if k <= ult_real else None), f"={plan_ut}/1000000*{k_d[k]}/{n_esp}"] for k, d in enumerate(dias)]
    a, b = escribir_tabla(dg, r0, ["Día del mes", "Utilidad acumulada real ($ M)", "Meta lineal ($ M)"], filas, formatos=[None, "#,##0.00", "#,##0.00"])
    dg.cerrar(b)
    fila_u = a + ult_real
    r = h.lamina(
        titulo,
        f'="Al día {dias[ult_real].day} la utilidad acumulada es "&FIXED(Datos_Graficos!C{fila_u},1)&" M frente a "&FIXED(Datos_Graficos!D{fila_u},1)&" M de la meta lineal."',
        f"Escala: $ millones acumulados por día del mes. Meta lineal = utilidad del Plan del mes ÷ {esp_txt}, sumada solo en días operados. Los egresos entran en su fecha real "
        "(por eso la línea real puede caer en días de compras, nómina o arriendo). Fuente: Cierres_Dia y Egresos/Gastos_Cierre; la meta es fórmula sobre el Plan.")
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    ch = nuevo_linea()
    s_r = serie_col(dg.ws, 3, a, b, "Utilidad acumulada real"); color_serie(s_r, PALETA["real"], linea=True, ancho_pt=3)
    s_m = serie_col(dg.ws, 4, a, b, "Meta lineal (Plan)"); color_serie(s_m, PALETA["plan"], linea=True, ancho_pt=2.5, guion="dash")
    ch.series += [s_r, s_m]
    ch.set_categories(cats)
    ejes(ch, x_titulo="Día del mes", y_titulo="$ millones acumulados", y_fmt="#,##0.0")
    leyenda(ch, "b")
    ws.add_chart(ch, f"B{r}")


# ══════════════════════════════════════════════════════════════════════
# HOJA B_INGRESOS — ¿De dónde viene la plata?
# ══════════════════════════════════════════════════════════════════════
def semana_del_mes(fecha):
    """S1 = días 1–7, S2 = 8–14, S3 = 15–21, S4 = 22–28, S5 = 29–31."""
    return (fecha.day - 1) // 7 + 1


ETIQ_SEMANA = {1: "S1 (1–7)", 2: "S2 (8–14)", 3: "S3 (15–21)", 4: "S4 (22–28)", 5: "S5 (29–31)"}


def dias_semana_presentes(ing_df):
    """Días de la semana (0=lun … 6=dom) con al menos un día operado; el domingo solo si hay ventas."""
    return sorted(int(d) for d in set(ing_df.index.dayofweek))


def anterior_real(ctx):
    """Periodo del mes real anterior al mes en foco (o None)."""
    return ctx["periodos_reales"][ctx["i"] - 1] if ctx["i"] > 0 else None


def ingresos_de(hist_idx, p):
    return float(hist_idx.loc[p, "ingresos_almuerzo"] + hist_idx.loc[p, "ingresos_cena"])


def hoja_b_ingresos(wb, ctx):
    h = HojaGraficos(wb, "B_Ingresos")
    for g in (grafico_5, grafico_6, grafico_7, grafico_8, grafico_9):
        g(h, ctx)
    h.cerrar()
    return h


# ── #5 Ingresos por turno (barras apiladas por semana + donut) ─────────
def grafico_5(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    op = ctx["op_m"].copy()
    op["semana"] = [semana_del_mes(d) for d in op.index]
    sem = op.groupby("semana")[["desayuno", "almuerzo_neto", "comida_rapida"]].sum() / 1e6
    tot = sem.sum()
    total_mes = float(tot.sum())
    share = {k: (float(tot[k]) / total_mes if total_mes else 0.0) for k in tot.index}
    hist = ctx["hist"].set_index("periodo")
    prev = anterior_real(ctx)
    var_txt = (f" Los ingresos del mes {fmt_pct(ingresos_de(hist, ctx['mes_foco']) / ingresos_de(hist, prev) - 1, 1, True)} frente a {nombre_mes_largo(prev)}."
               if prev and ingresos_de(hist, prev) else "")
    mayor = int(sem.sum(axis=1).idxmax()) if len(sem) else 1
    r = h.lamina(
        f"Ingresos por turno — {ctx['nombre_mes'].capitalize()}",
        f"Almuerzo (neto) aportó {fmt_pct(share['almuerzo_neto'])} de los ingresos, comida rápida {fmt_pct(share['comida_rapida'])} y desayuno {fmt_pct(share['desayuno'])}; "
        f"la semana {ETIQ_SEMANA[mayor]} fue la de mayor venta ({fmt_mill(float(sem.loc[mayor].sum()) * 1e6)}).{var_txt}{aviso_dias(ctx)}",
        "Escala: $ millones por semana del mes (S1 = días 1–7 … S5 = 29–31). Almuerzo (neto) = cierre de almuerzo − desayuno (el modelo incluye el desayuno dentro de Ingresos Almuerzo). "
        "El % de la leyenda es la participación en el mes. Fuente: Cierres_Dia y Aperturas_Turno (calculado por el script).")
    r0 = dg.seccion("#5 — Ingresos por turno y semana del mes en foco ($ M)",
                    "Calculado por el script al generar el modelo (Cierres_Dia + Aperturas_Turno). Los encabezados de las series son fórmulas con el % de participación.")
    filas = [[ETIQ_SEMANA[int(k)], float(sem.loc[k, "desayuno"]), float(sem.loc[k, "almuerzo_neto"]), float(sem.loc[k, "comida_rapida"])] for k in sem.index]
    a, b = escribir_tabla(dg, r0, ["Semana", "Desayuno", "Almuerzo (neto)", "Comida rápida"], filas, formatos=[None] + ["#,##0.00"] * 3)
    # encabezados con % de participación (fórmula → nombre de la serie en la leyenda)
    for col, nom in ((3, "Desayuno"), (4, "Almuerzo (neto)"), (5, "Comida rápida")):
        L = get_column_letter(col)
        ws_d = dg.ws
        ws_d.cell(row=r0, column=col, value=f'="{nom} · "&FIXED(IF(SUM($C${a}:$E${b})=0,0,SUM({L}{a}:{L}{b})/SUM($C${a}:$E${b}))*100,0)&"%"')
    # participación (donut)
    rd = b + 2
    for k, (nom, col) in enumerate((("Desayuno", "C"), ("Almuerzo (neto)", "D"), ("Comida rápida", "E"))):
        label(dg.ws, rd + k, nom)
        numero(dg.ws, rd + k, 3, f"=SUM({col}{a}:{col}{b})").number_format = "#,##0.00"
    dg.cerrar(rd + 2)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(apilado=True, ancho_gap=55)
    for col, color in ((3, PALETA["desayuno"]), (4, PALETA["almuerzo"]), (5, PALETA["comida_rapida"])):
        s = Series(Reference(dg.ws, min_col=col, min_row=r0, max_row=b), title_from_data=True)
        color_serie(s, color)
        bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo="Semana del mes", y_titulo="$ millones", y_fmt="#,##0.0", y_min=0)
    bar.width = 16.2
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")
    don = DoughnutChart()
    don.holeSize = 55
    sd = Series(Reference(dg.ws, min_col=3, min_row=rd, max_row=rd + 2), title="Participación")
    sd.data_points = [DataPoint(idx=k, spPr=GraphicalProperties(solidFill=c)) for k, c in enumerate((PALETA["desayuno"], PALETA["almuerzo"], PALETA["comida_rapida"]))]
    sd.dLbls = DataLabelList()
    sd.dLbls.showPercent = True
    sd.dLbls.showVal = sd.dLbls.showCatName = sd.dLbls.showSerName = sd.dLbls.showLegendKey = False
    sd.dLbls.txPr = RichText(bodyPr=RichTextProperties(), p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=1000, b=True, solidFill="FFFFFF")), endParaRPr=CharacterProperties())])
    don.series.append(sd)
    don.set_categories(Reference(dg.ws, min_col=2, min_row=rd, max_row=rd + 2))
    don.width, don.height = 8.6, CHART_ALTO
    don.roundedCorners = False
    don.legend.position = "b"
    don.legend.overlay = False
    ws.add_chart(don, f"J{r}")


# ── #6 ¿Qué días vendo más? ───────────────────────────────────────────
def grafico_6(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    ing = ctx["diario"]["ingresos"]
    op = ctx["op_m"]
    dows = dias_semana_presentes(op)
    prom_mes = {d: float(op[op.index.dayofweek == d]["total"].mean()) / 1000 for d in dows}
    n_dias = {d: int((op.index.dayofweek == d).sum()) for d in dows}
    prom_general = float(op["total"].mean()) / 1000 if len(op) else 0.0
    # promedio de los hasta 3 meses reales anteriores, por día de la semana
    previos = ctx["periodos_reales"][max(0, ctx["i"] - 3):ctx["i"]]
    prom_prev = {}
    if previos:
        sel = ing[(ing.index.to_period("M").astype(str).isin(previos)) & (ing["total"] > 0)]
        for d in dows:
            x = sel[sel.index.dayofweek == d]["total"]
            prom_prev[d] = float(x.mean()) / 1000 if len(x) else None
    # mejor / peor día: solo entre días con al menos 2 días operados (con 1 solo el promedio no es fiable)
    cand = [d for d in dows if n_dias[d] >= 2] or dows
    mejor = max(cand, key=lambda d: prom_mes[d]) if cand else 0
    peor = min(cand, key=lambda d: prom_mes[d]) if cand else 0
    hallazgo = (f"El {DIAS_SEMANA[mejor]} vende {fmt_pct(prom_mes[mejor] / prom_general - 1)} más que el promedio del mes y el {DIAS_SEMANA[peor]} {fmt_pct(1 - prom_mes[peor] / prom_general)} menos"
                f" (promedio por día operado: {fmt_pesos(prom_general * 1000)}).") if prom_general else "No hay días operados en el mes."
    r = h.lamina(
        f"¿Qué días vendo más? — {ctx['nombre_mes'].capitalize()}",
        hallazgo,
        "Escala: $ miles de ingreso total por día operado, promediado por día de la semana. Verde = mejor día, rojo = peor día (solo entre días con 2 o más observaciones). Línea punteada = promedio de "
        f"{'mes anterior' if len(previos) == 1 else str(len(previos)) + ' meses anteriores' if previos else 'meses anteriores (no hay datos)'}; línea gris = promedio general del mes. "
        "Días promediados: " + ", ".join(f"{DIAS_SEMANA[d]} {n_dias[d]}" for d in dows) + ". Fuente: Cierres_Dia (calculado por el script).")
    r0 = dg.seccion("#6 — Ingreso promedio por día operado, por día de la semana ($ miles)",
                    "Calculado por el script al generar el modelo (Cierres_Dia). Línea del promedio general = fórmula sobre la tabla.")
    filas = []
    a = r0 + 1
    for k, d in enumerate(dows):
        filas.append([DIAS_SEMANA[d], prom_mes[d], prom_prev.get(d) if previos else None, prom_general])
    a, b = escribir_tabla(dg, r0, ["Día", "Promedio del mes", "Promedio meses anteriores", "Promedio general del mes"], filas, formatos=[None] + ["#,##0"] * 3)
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=55)
    s = serie_col(dg.ws, 3, a, b, "Promedio por día operado (mes en foco)")
    color_serie(s, PALETA["ingresos"])
    puntos_color(s, [PALETA["utilidad"] if d == mejor else PALETA["alerta"] if d == peor else PALETA["ingresos"] for d in dows])
    etiquetas(s, fmt="#,##0", pos="outEnd")
    bar.series.append(s)
    bar.set_categories(cats)
    techo = techo_bonito(max(list(prom_mes.values()) + [v for v in prom_prev.values() if v] + [prom_general]) * 1.12)
    ejes(bar, x_titulo="Día de la semana", y_titulo="$ miles por día operado", y_fmt="#,##0", y_min=0, y_max=techo)
    linea = nuevo_linea()
    if previos and any(v for v in prom_prev.values()):
        s2 = serie_col(dg.ws, 4, a, b, "Promedio del mes anterior" if len(previos) == 1 else f"Promedio de los {len(previos)} meses anteriores")
        color_serie(s2, PALETA["plan"], linea=True, guion="dash", marcador=True)
        linea.series.append(s2)
    s3 = serie_col(dg.ws, 5, a, b, "Promedio general del mes")
    color_serie(s3, PALETA["neutro_oscuro"], linea=True, ancho_pt=1.75)
    linea.series.append(s3)
    linea.set_categories(cats)
    bar += linea
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── #7 Mapa de calor día × turno ──────────────────────────────────────
def grafico_7(h, ctx):
    ws = h.ws
    op = ctx["op_m"]
    dows = dias_semana_presentes(op)
    turnos = [("desayuno", "Desayuno"), ("almuerzo_neto", "Almuerzo (neto)"), ("comida_rapida", "Comida rápida")]
    mat = {d: {k: float(op[op.index.dayofweek == d][k].mean()) / 1000 for k, _ in turnos} for d in dows}
    n_dias = {d: int((op.index.dayofweek == d).sum()) for d in dows}
    celdas = [(d, k, mat[d][k]) for d in dows for k, _ in turnos]
    mejor = max(celdas, key=lambda x: x[2]) if celdas else None
    nom_turno = dict(turnos)
    hallazgo = (f"La combinación más fuerte es {nom_turno[mejor[1]].lower()} del {DIAS_SEMANA[mejor[0]]}: {fmt_pesos(mejor[2] * 1000)} por día operado en promedio."
                if mejor else "No hay días operados en el mes.")
    r = h.lamina(
        f"Mapa de calor: día de la semana × turno — {ctx['nombre_mes'].capitalize()}",
        hallazgo,
        "Escala: $ miles de ingreso promedio por día operado; más oscuro = más ingreso. n = número de días operados promediados en cada fila (con pocos días el promedio es poco fiable). "
        "Fuente: Cierres_Dia y Aperturas_Turno (calculado por el script; las celdas son los valores).", alto=22)
    # matriz en celdas: etiqueta B:C, tres turnos D:F / G:I / J:L, n en M:N
    cab = r
    cols = [("Día", 2, 3), ("Desayuno", 4, 6), ("Almuerzo (neto)", 7, 9), ("Comida rápida", 10, 12), ("n días", 13, 14)]
    for txt, c1, c2 in cols:
        ws.merge_cells(start_row=cab, start_column=c1, end_row=cab, end_column=c2)
        c = ws.cell(row=cab, column=c1, value=txt)
        c.font = Font(name="Calibri", size=11, bold=True, color=PALETA["neutro_oscuro"])
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[cab].height = 24
    blanco = Side(style="thin", color="FFFFFF")
    borde = Border(left=blanco, right=blanco, top=blanco, bottom=blanco)
    for k, d in enumerate(dows):
        rr = cab + 1 + k
        ws.row_dimensions[rr].height = 34
        for (txt, c1, c2), valor in zip(cols, [DIAS_SEMANA[d].capitalize(), mat[d]["desayuno"], mat[d]["almuerzo_neto"], mat[d]["comida_rapida"], n_dias[d]]):
            ws.merge_cells(start_row=rr, start_column=c1, end_row=rr, end_column=c2)
            c = ws.cell(row=rr, column=c1, value=valor)
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.font = Font(name="Calibri", size=13 if txt != "Día" else 12, bold=(txt == "Día"), color=PALETA["neutro_oscuro"])
            if txt not in ("Día", "n días"):
                c.number_format = "#,##0"
            for cc in range(c1, c2 + 1):
                ws.cell(row=rr, column=cc).border = borde
    rango = f"D{cab + 1}:L{cab + len(dows)}"
    ws.conditional_formatting.add(rango, ColorScaleRule(start_type="min", start_color="EEF3F9", end_type="max", end_color=tono_claro(PALETA["ingresos"], 0.2)))


# ── #8 Pareto de productos ────────────────────────────────────────────
def tabla_pareto(dg, titulo, serie, etiqueta_total="Valor ($ M)"):
    """Tabla ordenada de mayor a menor + % acumulado (FÓRMULA). serie: pandas Series (pesos)."""
    serie = serie[serie > 0].sort_values(ascending=False)
    r0 = dg.seccion(titulo, "Valores calculados por el script (Pedidos_Pagados sin Gratis, mes en foco); el % acumulado es fórmula.")
    n = len(serie)
    filas = [[str(k), float(v) / 1e6, f"=SUM($C${r0 + 1}:C{r0 + 1 + i})/SUM($C${r0 + 1}:$C${r0 + n})"] for i, (k, v) in enumerate(serie.items())]
    a, b = escribir_tabla(dg, r0, ["Producto", etiqueta_total, "% acumulado"], filas, formatos=[None, "#,##0.0", "0%"])
    dg.cerrar(b)
    return a, b, serie


def chart_pareto(dg, a, b, alto, y_titulo="$ millones", x_titulo=None):
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=35)
    s = serie_col(dg.ws, 3, a, b, "Ventas del producto")
    color_serie(s, PALETA["ingresos"])
    etiquetas(s, fmt="#,##0.0", pos="outEnd", tam=800)
    bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo=x_titulo, y_titulo=y_titulo, y_fmt="#,##0.0", y_min=0, rot_x=-30)
    linea = nuevo_linea()
    s2 = serie_col(dg.ws, 4, a, b, "% acumulado")
    color_serie(s2, PALETA["alerta"], linea=True, marcador=True)
    linea.series.append(s2)
    linea.set_categories(cats)
    combo_secundario(bar, linea, y_titulo="% acumulado de las ventas", y_fmt="0%", y_min=0, y_max=1)
    leyenda(bar, "b")
    bar.width, bar.height = CHART_ANCHO, alto
    return bar


def frase_pareto(serie, que):
    """'El 80 % de lo vendido en {que} viene de k de N productos: a, b, c.'"""
    if serie.empty or serie.sum() <= 0:
        return f"No hay ventas de {que} en el mes."
    cum = serie.cumsum() / serie.sum()
    k = int((cum < 0.8).sum()) + 1
    return f"El {fmt_pct(float(cum.iloc[k - 1]))} de lo vendido en {que} viene de {k} de {len(serie)}: {', '.join(serie.index[:k])}."


def grafico_8(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    ped = ctx["diario"]["pedidos"]
    mf = ctx["mes_foco"]
    pm = ped[ped["periodo"] == mf] if not ped.empty else ped
    alm = pm[pm["turno"] == "almuerzo"].groupby("grupo_producto")["monto_total"].sum() if not pm.empty else pd.Series(dtype=float)
    cr = pm[pm["turno"] == "cena"].groupby("grupo_producto")["monto_total"].sum() if not pm.empty else pd.Series(dtype=float)
    a1, b1, s1 = tabla_pareto(dg, "#8A — Pareto de almuerzo por tipo de pedido ($ M)", alm)
    a2, b2, s2 = tabla_pareto(dg, "#8B — Pareto de comida rápida por categoría ($ M)", cr)
    nota_fuente = ("Fuente: Pedidos_Pagados del mes en foco, sin pedidos Gratis. NO incluye la venta de desayuno ni los ajustes manuales de cierre, por eso los totales son "
                   "menores que los ingresos del mes. Categorías de comida rápida: copia de PL.comidaRapida del sistema (mantener sincronizada); 'EXTRAS' = productos sueltos.")
    r = h.lamina(
        f"¿Qué producto sostiene el negocio? — {ctx['nombre_mes'].capitalize()}",
        frase_pareto(s1, "almuerzo") + " " + frase_pareto(s2, "comida rápida"),
        "Escala: $ millones vendidos por producto (barras) y % acumulado (línea, eje derecho 0–100 %). " + nota_fuente)
    ws.add_chart(chart_pareto(dg, a1, b1, 6.1, x_titulo="Almuerzo — tipo de pedido"), f"B{r}")
    ws.add_chart(chart_pareto(dg, a2, b2, 6.1, x_titulo="Comida rápida — categoría"), f"B{r + 12}")
    # segunda lámina: proteínas
    prot = pm[(pm["turno"] == "almuerzo") & pm["proteina"].notna()].groupby("proteina")["monto_total"].sum().sort_values(ascending=False).head(10) if (not pm.empty and "proteina" in pm.columns) else pd.Series(dtype=float)
    a3, b3, s3 = tabla_pareto(dg, "#8C — Pareto de almuerzo por proteína, top 10 ($ M)", prot)
    todo_alm = ped[ped["turno"] == "almuerzo"] if not ped.empty else ped
    con_prot = int(todo_alm["proteina"].notna().sum()) if (not todo_alm.empty and "proteina" in todo_alm.columns) else 0
    r = h.lamina(
        f"¿Qué proteína sostiene el almuerzo? — {ctx['nombre_mes'].capitalize()}",
        frase_pareto(s3, "los platos con proteína registrada") if len(s3) else
        f"En {ctx['nombre_mes']} ningún pedido de almuerzo trae la proteína registrada (en todo el periodo cargado solo {con_prot} de {len(todo_alm)} pedidos de almuerzo la traen): no hay datos para este gráfico.",
        "Escala: $ millones vendidos por proteína (top 10). Solo cuentan pedidos de almuerzo que tienen la proteína registrada (los porciones, extras y otros pedidos sin proteína quedan fuera). "
        "Fuente: Pedidos_Pagados del mes en foco, sin Gratis.")
    if len(s3):
        ws.add_chart(chart_pareto(dg, a3, b3, CHART_ALTO, x_titulo="Proteína"), f"B{r}")


# ── #9 ¿Más clientes o cobrar más? ────────────────────────────────────
def grafico_9(h, ctx):
    ws, dg, i = h.ws, ctx["dg"], ctx["i"]
    ped = ctx["diario"]["pedidos"]
    mf = ctx["mes_foco"]
    pm = ped[(ped["periodo"] == mf) & (ped["turno"] == "almuerzo")] if not ped.empty else ped
    op = ctx["op_m"]
    pm = pm.assign(semana=[semana_del_mes(d) for d in pm["fecha"]]) if not pm.empty else pm
    vol = pm.groupby("semana")["cantidad"].sum() if not pm.empty else pd.Series(dtype=float)
    ventas = pm.groupby("semana")["monto_total"].sum() if not pm.empty else pd.Series(dtype=float)
    neto = op.assign(semana=[semana_del_mes(d) for d in op.index]).groupby("semana")["almuerzo_neto"].sum()
    semanas = sorted(set(vol.index) | set(neto.index))
    ticket = {s: (float(ventas.get(s, 0.0)) / float(vol.get(s, 0)) if vol.get(s, 0) else None) for s in semanas}
    hist = ctx["hist"].set_index("periodo")
    prev = anterior_real(ctx)
    def tk(p):
        return float(hist.loc[p, "ventas_pedidos_almuerzo"]) / max(float(hist.loc[p, "volumen_almuerzo"]), 1)
    if prev:
        tk_a, tk_p = tk(mf), tk(prev)
        v_a, v_p = float(hist.loc[mf, "volumen_almuerzo"]), float(hist.loc[prev, "volumen_almuerzo"])
        # tk_p puede ser exactamente $0 si ese mes no tiene pedidos de almuerzo
        # INDIVIDUALES registrados (sus ingresos vinieron solo de ajustes/cierres
        # manuales) — sin guardar, tk_a/tk_p revienta con ZeroDivisionError.
        if tk_p and v_p:
            hallazgo = (f"En {ctx['nombre_mes']} el ticket promedio de almuerzo fue {fmt_pesos(tk_a)} ({fmt_pct(tk_a / tk_p - 1, 1, True)} vs {nombre_mes_largo(prev)}) "
                        f"y el volumen {fmt_n(v_a)} pedidos ({fmt_pct(v_a / v_p - 1, 1, True)}): el crecimiento viene {'sobre todo de más pedidos' if abs(v_a / v_p - 1) > abs(tk_a / tk_p - 1) else 'sobre todo de cobrar más por pedido'}.{aviso_dias(ctx)}")
        else:
            hallazgo = (f"En {ctx['nombre_mes']} el ticket promedio de almuerzo fue {fmt_pesos(tk_a)} sobre {fmt_n(v_a)} pedidos "
                        f"({nombre_mes_largo(prev)} no tiene pedidos de almuerzo individuales registrados para comparar — sus ingresos vinieron solo de ajustes/cierres manuales).{aviso_dias(ctx)}")
    else:
        hallazgo = f"En {ctx['nombre_mes']} el ticket promedio de almuerzo fue {fmt_pesos(tk(mf))} sobre {fmt_n(float(hist.loc[mf, 'volumen_almuerzo']))} pedidos (no hay mes anterior real para comparar)."
    r = h.lamina(
        f"¿Crezco por más clientes o por cobrar más? — {ctx['nombre_mes'].capitalize()}",
        hallazgo,
        "Escala: número de pedidos de almuerzo por semana del mes (barras, sin Gratis) y ticket promedio de almuerzo en $ miles (línea, eje derecho). Ticket = ventas por pedidos ÷ pedidos registrados (misma definición del Tablero). "
        "No incluye pedidos equivalentes por ingresos sin pedido (ajustes y cierres manuales). "
        "Fuente: Pedidos_Pagados de turnos cerrados (calculado por el script). Segunda lámina: últimos 6 meses.")
    r0 = dg.seccion("#9A — Pedidos y ticket de almuerzo por semana ($ miles)", "Calculado por el script al generar el modelo (Pedidos_Pagados sin Gratis, turnos cerrados). Ticket = Σ monto_total ÷ Σ cantidad; no incluye pedidos equivalentes por ingresos sin pedido.")
    filas = [[ETIQ_SEMANA[int(s)], float(vol.get(s, 0)), (ticket[s] / 1000 if ticket[s] else None)] for s in semanas]
    a, b = escribir_tabla(dg, r0, ["Semana", "Pedidos de almuerzo", "Ticket promedio ($ miles)"], filas, formatos=[None, "#,##0", "#,##0.0"])
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=60)
    s = serie_col(dg.ws, 3, a, b, "Pedidos de almuerzo"); color_serie(s, PALETA["almuerzo"]); etiquetas(s, fmt="#,##0", pos="inBase", color="FFFFFF")
    bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo="Semana del mes", y_titulo="Pedidos", y_fmt="#,##0", y_min=0)
    linea = nuevo_linea()
    s2 = serie_col(dg.ws, 4, a, b, "Ticket promedio ($ miles)"); color_serie(s2, PALETA["plan"], linea=True, marcador=True, ancho_pt=3)
    etiquetas(s2, fmt="#,##0.0", pos="t")
    linea.series.append(s2)
    linea.set_categories(cats)
    combo_secundario(bar, linea, y_titulo="Ticket ($ miles)", y_fmt="#,##0.0", y_min=0)
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")
    # segunda vista: últimos 6 meses reales (fórmulas hacia Model)
    desde = max(0, i - 5)
    idxs = list(range(desde, i + 1))
    r = h.lamina(
        f"¿Crezco por más clientes o por cobrar más? — últimos {len(idxs)} meses",
        f"En {len(idxs)} mes(es) real(es): el volumen de almuerzo va de {fmt_n(float(hist.iloc[desde]['volumen_almuerzo']))} a {fmt_n(float(hist.iloc[i]['volumen_almuerzo']))} pedidos y "
        f"el ticket de {fmt_pesos(tk(ctx['periodos_reales'][desde]))} a {fmt_pesos(tk(mf))}.",
        "Escala: pedidos de almuerzo por mes (barras, sin Gratis) y ticket promedio de almuerzo en $ miles (línea, eje derecho). Mismas definiciones del Revenue Schedule (pedidos registrados, sin los pedidos equivalentes por ingresos sin pedido). Fuente: hoja Model (fórmulas).")
    r0 = dg.seccion("#9B — Pedidos y ticket de almuerzo, últimos meses", "FÓRMULAS hacia Model (Revenue Schedule).")
    ws_d = dg.ws
    label(ws_d, r0, "Mes"); label(ws_d, r0 + 1, "Pedidos de almuerzo"); label(ws_d, r0 + 2, "Ticket promedio ($ miles)")
    for k, ix in enumerate(idxs):
        c = dg.col(k)
        ws_d.cell(row=r0, column=c, value=etiqueta_mes(ctx["periodos_reales"][ix])).font = Font(bold=True)
        numero(ws_d, r0 + 1, c, f"={cm(ctx, 'fila_vol_alm', ix)}").number_format = "#,##0"
        numero(ws_d, r0 + 2, c, f"={cm(ctx, 'fila_tkt_alm', ix)}/1000").number_format = "#,##0.0"
    dg.cerrar(r0 + 2)
    c1, c2 = dg.col(0), dg.col(len(idxs) - 1)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=r0)
    bar = nuevo_bar(ancho_gap=60)
    s = serie_fila(ws_d, r0 + 1, c1, c2, "Pedidos de almuerzo"); color_serie(s, PALETA["almuerzo"]); etiquetas(s, fmt="#,##0", pos="inBase", color="FFFFFF")
    bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo="Mes", y_titulo="Pedidos", y_fmt="#,##0", y_min=0)
    linea = nuevo_linea()
    s2 = serie_fila(ws_d, r0 + 2, c1, c2, "Ticket promedio ($ miles)"); color_serie(s2, PALETA["plan"], linea=True, marcador=True, ancho_pt=3)
    etiquetas(s2, fmt="#,##0.0", pos="t")
    linea.series.append(s2)
    linea.set_categories(cats)
    combo_secundario(bar, linea, y_titulo="Ticket ($ miles)", y_fmt="#,##0.0", y_min=0)
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ══════════════════════════════════════════════════════════════════════
# HOJA C_EGRESOS — ¿En qué se va la plata?
# ══════════════════════════════════════════════════════════════════════
def hoja_c_egresos(wb, ctx):
    h = HojaGraficos(wb, "C_Egresos")
    for g in (grafico_10, grafico_11):
        g(h, ctx)
    h.cerrar()
    return h


def aviso_dias(ctx):
    """Aviso (texto) cuando el mes anterior tuvo muy distinta cantidad de días operados que
    el mes en foco (p. ej. un primer mes parcial): las comparaciones vs mes anterior son engañosas."""
    prev = anterior_real(ctx)
    if not prev:
        return ""
    hist = ctx["hist"].set_index("periodo")
    n, n_prev = int(hist.loc[ctx["mes_foco"], "dias_operados"]), int(hist.loc[prev, "dias_operados"])
    if n and (n_prev < 0.8 * n or n_prev > 1.25 * n):
        return f" Ojo: {nombre_mes_largo(prev)} tuvo {n_prev} días operados frente a {n} de {ctx['nombre_mes']}; la comparación con el mes anterior es poco fiable."
    return ""


# ── #10 Egresos por categoría ─────────────────────────────────────────
def grafico_10(h, ctx):
    ws, dg, i, fh = h.ws, ctx["dg"], ctx["i"], ctx["fila_hist"]
    rubros = [("Insumos", "fila_costo_insumos", float(fh["costo_insumos"])), ("Nómina", "fila_nomina", float(fh["nomina"])),
              ("Arriendo y servicios", "fila_arriendo", float(fh["arriendo_servicios"])), ("Otros", "fila_otros", float(fh["otros_gastos"]))]
    orden = sorted(rubros, key=lambda x: -x[2])          # de mayor a menor (los meses reales no dependen de Inputs)
    ing = float(fh["ingresos_almuerzo"] + fh["ingresos_cena"])
    total = sum(v for _n, _f, v in rubros)
    hist = ctx["hist"].set_index("periodo")
    prev = anterior_real(ctx)
    var = ""
    if prev:
        tot_prev = float(hist.loc[prev, ["costo_insumos", "nomina", "arriendo_servicios", "otros_gastos"]].sum())
        if tot_prev:
            var = f", {fmt_pct(total / tot_prev - 1, 1, True)} frente a {nombre_mes_largo(prev)}"
    mayor = orden[0]
    r = h.lamina(
        f"Egresos por categoría — {ctx['nombre_mes'].capitalize()}",
        f"{mayor[0]} es el mayor egreso: {fmt_mill(mayor[2])} ({fmt_pct(mayor[2] / ing if ing else 0)} de los ingresos). En total se gastaron {fmt_mill(total)} "
        f"({fmt_pct(total / ing if ing else 0)} de los ingresos){var}. Los insumos incluyen {txt_desechables(fh)}." + aviso_dias(ctx),
        "Escala: $ millones del mes, de mayor a menor. Entre paréntesis, el % de los ingresos del mes. Insumos = Egresos y gastos de cierre de 'proveedor' + 'desechables' "
        "(el valor de los desechables se muestra en el rótulo de Insumos); no incluye préstamos "
        "(plata propia, no es gasto del negocio). Fuente: hoja Model (fórmulas).")
    r0 = dg.seccion("#10 — Egresos por categoría del mes en foco ($ M)", "FÓRMULAS hacia Model. El orden (mayor a menor) se fijó al generar el modelo.")
    filas = []
    for k, (nom, clave, _v) in enumerate(orden):
        rr = r0 + 1 + k
        ing_ref = cm(ctx, "fila_ingresos", i)
        # El rótulo de Insumos deja a la vista cuánto de ese rubro son desechables
        extra = f'&"; incl. desechables $"&FIXED({cm(ctx, "fila_desechables", i)}/1000000,1)&" M"' if clave == "fila_costo_insumos" else ""
        filas.append([nom, f"=-{cm(ctx, clave, i)}/1000000", f"=IF({ing_ref}=0,0,C{rr}*1000000/{ing_ref})",
                      f'=B{rr}&"  ("&FIXED(D{rr}*100,0)&"% de los ingresos"{extra}&")"'])
    a, b = escribir_tabla(dg, r0, ["Rubro", "Egreso ($ M)", "% de los ingresos", "Rubro (con %)"], filas, formatos=[None, "#,##0.0", "0.0%", None])
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=5, min_row=a, max_row=b)
    bar = nuevo_bar(horizontal=True, ancho_gap=50)
    s = serie_col(dg.ws, 3, a, b, "Egreso del mes")
    color_serie(s, PALETA["egresos"])
    etiquetas(s, fmt="#,##0.0", pos="outEnd", tam=1000)
    bar.series.append(s)
    bar.set_categories(cats)
    bar.x_axis.scaling.orientation = "maxMin"
    ejes(bar, y_titulo="$ millones", y_fmt="#,##0.0", y_min=0)
    bar.y_axis.crosses = "max"
    bar.width = 16.2
    sin_leyenda(bar)
    ws.add_chart(bar, f"B{r}")
    # opción B: participación en un donut pequeño
    don = DoughnutChart()
    don.holeSize = 55
    sd = Series(Reference(dg.ws, min_col=3, min_row=a, max_row=b), title="Participación")
    tonos = [PALETA["egresos"], tono_claro(PALETA["egresos"], 0.3), tono_claro(PALETA["egresos"], 0.55), PALETA["neutro_claro"]]
    sd.data_points = [DataPoint(idx=k, spPr=GraphicalProperties(solidFill=c)) for k, c in enumerate(tonos)]
    sd.dLbls = DataLabelList()
    sd.dLbls.showPercent = True
    sd.dLbls.showVal = sd.dLbls.showCatName = sd.dLbls.showSerName = sd.dLbls.showLegendKey = False
    sd.dLbls.txPr = RichText(bodyPr=RichTextProperties(), p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=1000, b=True, solidFill="404040")), endParaRPr=CharacterProperties())])
    don.series.append(sd)
    don.set_categories(Reference(dg.ws, min_col=2, min_row=a, max_row=b))
    don.width, don.height = 8.6, CHART_ALTO
    don.legend.position = "b"
    don.legend.overlay = False
    don.roundedCorners = False
    ws.add_chart(don, f"J{r}")


# ── #11 Estructura de costos como % de las ventas ─────────────────────
def grafico_11(h, ctx):
    ws, dg, i = h.ws, ctx["dg"], ctx["i"]
    idxs = list(range(max(0, i - 11), i + 1))
    hist = ctx["hist"].set_index("periodo")
    per = ctx["periodos_reales"]
    def pct(p, col):
        ing = ingresos_de(hist, p)
        return float(hist.loc[p, col]) / ing if ing else 0.0
    mf, prev = ctx["mes_foco"], anterior_real(ctx)
    pp = ""
    if prev:
        d = (pct(mf, "costo_insumos") - pct(prev, "costo_insumos")) * 100
        pp = f" ({'+' if d >= 0 else '−'}{fmt_n(abs(d), 1)} puntos frente a {nombre_mes_largo(prev)})"
    r = h.lamina(
        "Estructura de costos como % de las ventas",
        f"En {ctx['nombre_mes']} los insumos fueron {fmt_pct(pct(mf, 'costo_insumos'))} de las ventas{pp} (de los cuales {fmt_pct(pct(mf, 'costo_desechables'), 1)} son desechables); el costo primo (insumos + nómina) fue "
        f"{fmt_pct(pct(mf, 'costo_insumos') + pct(mf, 'nomina'))} y quedó {fmt_pct(1 - (pct(mf, 'costo_insumos') + pct(mf, 'nomina') + pct(mf, 'arriendo_servicios') + pct(mf, 'otros_gastos')))} de utilidad." + aviso_dias(ctx),
        "Escala: % de los ingresos de cada mes (cada barra suma 100 %: cuatro rubros de costo + utilidad; los insumos van partidos en proveedores y desechables, que juntos son el costo de insumos). La línea punteada es el costo primo (insumos + nómina). "
        f"Últimos {len(idxs)} meses reales. Fuente: hoja Model (fórmulas).")
    r0 = dg.seccion("#11 — Estructura de costos, % de los ingresos", "FÓRMULAS hacia Model: cada rubro ÷ ingresos del mes.")
    ws_d = dg.ws
    nombres = ["Insumos (proveedores)", "Desechables", "Nómina", "Arriendo y servicios", "Otros", "Utilidad", "Costo primo (insumos + nómina)"]
    claves = ["fila_ins_prov", "fila_desechables", "fila_nomina", "fila_arriendo", "fila_otros", "fila_utilidad_neta", None]
    label(ws_d, r0, "Mes")
    for k, nom in enumerate(nombres):
        label(ws_d, r0 + 1 + k, nom)
    for k, ix in enumerate(idxs):
        c = dg.col(k)
        ws_d.cell(row=r0, column=c, value=etiqueta_mes(per[ix])).font = Font(bold=True)
        ing = cm(ctx, "fila_ingresos", ix)
        for j, clave in enumerate(claves):
            if clave is None:
                f = f"=IF({ing}=0,0,-({cm(ctx,'fila_costo_insumos',ix)}+{cm(ctx,'fila_nomina',ix)})/{ing})"
            elif clave in ("fila_utilidad_neta", "fila_ins_prov", "fila_desechables"):   # filas con signo positivo en Model
                f = f"=IF({ing}=0,0,{cm(ctx,clave,ix)}/{ing})"
            else:
                f = f"=IF({ing}=0,0,-{cm(ctx,clave,ix)}/{ing})"
            cel = numero(ws_d, r0 + 1 + j, c, f, pct=True)
            if j < 6:
                cel.number_format = "0.0%;-0.0%;;"   # las etiquetas de las barras heredan este formato: sin ceros
    dg.cerrar(r0 + 7)
    c1, c2 = dg.col(0), dg.col(len(idxs) - 1)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=r0)
    bar = nuevo_bar(apilado=True, ancho_gap=45)
    # Insumos (proveedores) y Desechables son dos tonos de la misma familia (juntos = costo de insumos); el resto igual que antes
    colores = [PALETA["egresos"], PALETA["desechables"], tono_claro(PALETA["egresos"], 0.3), tono_claro(PALETA["egresos"], 0.55), PALETA["neutro_claro"], PALETA["utilidad"]]
    for j in range(6):
        s = serie_fila(ws_d, r0 + 1 + j, c1, c2, nombres[j])
        color_serie(s, colores[j])
        if len(idxs) <= 8:
            etiquetas(s, fmt="0%;-0%;;", pos="ctr", tam=900, color="FFFFFF" if j in (0, 1, 5) else "404040")
        bar.series.append(s)
    bar.set_categories(cats)
    # el eje cubre 0–100 %; solo se amplía si algún mes tiene pérdida (costos > 100 %)
    maximos = [sum(max(0.0, pct(per[ix], col)) for col in ("costo_insumos", "nomina", "arriendo_servicios", "otros_gastos")) for ix in idxs]
    minimos = [min(0.0, 1 - sum(pct(per[ix], col) for col in ("costo_insumos", "nomina", "arriendo_servicios", "otros_gastos"))) for ix in idxs]
    ymax = max(1.0, math.ceil(max(maximos) * 10) / 10)
    ymin = min(0.0, math.floor(min(minimos) * 10) / 10)
    ejes(bar, x_titulo="Mes", y_titulo="% de los ingresos", y_fmt="0%", y_min=ymin, y_max=ymax)
    linea = nuevo_linea()
    s = serie_fila(ws_d, r0 + 7, c1, c2, nombres[6])
    color_serie(s, PALETA["neutro_oscuro"], linea=True, guion="dash", marcador=True, ancho_pt=2.25)
    linea.series.append(s)
    linea.set_categories(cats)
    bar += linea
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ══════════════════════════════════════════════════════════════════════
# HOJA E_PROYECCION — ¿Hacia dónde voy?
# ══════════════════════════════════════════════════════════════════════
def tabla_ventana(dg, ctx):
    """Serie MENSUAL de todo el modelo (reales + proyectados), alineada a una ventana
    de años completos (ene del primer año → dic del último): mes p de la ventana en la
    columna C+p; vacío si ese mes no está en el modelo. FÓRMULAS hacia Model y Plan.
    La usan #13 (proyección), #14 (acumulado) y #15 (resumen anual)."""
    labels, n_hist = ctx["mr"]["labels_periodo"], ctx["mr"]["n_hist"]
    a0, a1 = int(labels[0][:4]), int(labels[-1][:4])
    ventana = [f"{a}-{m:02d}" for a in range(a0, a1 + 1) for m in range(1, 13)]
    ctx["ventana"] = ventana
    r0 = dg.seccion(f"Serie mensual del modelo, ventana {etiqueta_mes(ventana[0])} → {etiqueta_mes(ventana[-1])} ($ M)",
                    "FÓRMULAS hacia Model (y Plan). Meses fuera del modelo quedan vacíos. 'Plan o modelo' = Plan del mes (meses reales con Plan) o, si no hay, el valor del Model (real o proyectado).")
    ws = dg.ws
    nombres = ["Mes", "Ingresos ($ M)", "Egresos ($ M)", "Utilidad ($ M)", "Utilidad real ($ M)", "Margen neto — real", "Margen neto — proyectado",
               "Utilidad: Plan o modelo ($ M)", "Utilidad acumulada del año — real ($ M)", "Utilidad acumulada del año — Plan o modelo ($ M)"]
    filas = {k: r0 + j for j, k in enumerate(("lab", "ing", "egr", "ut", "ut_real", "mg_r", "mg_p", "plan_modelo", "acum_real", "acum_plan"))}
    for j, nom in enumerate(nombres):
        label(ws, r0 + j, nom, bold=(j == 0))
    plan = dg.refs.get("plan")
    for p, per in enumerate(ventana):
        c = dg.col(p)
        ws.cell(row=filas["lab"], column=c, value=etiqueta_mes(per)).font = Font(bold=True)
        ws.cell(row=filas["lab"], column=c).alignment = Alignment(horizontal="center")
        if per not in labels:
            continue
        ix = labels.index(per)
        real = ix < n_hist
        ing = cm(ctx, "fila_ingresos", ix)
        egr = f"-({cm(ctx,'fila_costo_insumos',ix)}+{cm(ctx,'fila_nomina',ix)}+{cm(ctx,'fila_arriendo',ix)}+{cm(ctx,'fila_otros',ix)})"
        ut = cm(ctx, "fila_utilidad_neta", ix)
        numero(ws, filas["ing"], c, f"={ing}/1000000").number_format = "#,##0.0"
        numero(ws, filas["egr"], c, f"=({egr})/1000000").number_format = "#,##0.0"
        numero(ws, filas["ut"], c, f"={ut}/1000000").number_format = "#,##0.0"
        if real:
            numero(ws, filas["ut_real"], c, f"={ut}/1000000").number_format = "#,##0.0"
        numero(ws, filas["mg_r" if real else "mg_p"], c, f"=IF({ing}=0,0,{ut}/{ing})", pct=True)
        if plan and plan["tiene_plan"][ix]:
            f_pm = f"={cplan(ctx, 'utilidad', ix)}/1000000"
        else:
            f_pm = f"={ut}/1000000"
        numero(ws, filas["plan_modelo"], c, f_pm).number_format = "#,##0.0"
        # acumulados DENTRO del año (se reinician cada enero)
        c_ene = dg.col((p // 12) * 12)
        L_ene, L = get_column_letter(c_ene), get_column_letter(c)
        if real:
            numero(ws, filas["acum_real"], c, f"=SUM({L_ene}{filas['ut_real']}:{L}{filas['ut_real']})").number_format = "#,##0.0"
        numero(ws, filas["acum_plan"], c, f"=SUM({L_ene}{filas['plan_modelo']}:{L}{filas['plan_modelo']})").number_format = "#,##0.0"
    dg.cerrar(r0 + len(nombres) - 1)
    dg.refs["ventana"] = dict(filas=filas, n=len(ventana))
    return filas


def hoja_e_proyeccion(wb, ctx):
    dg = ctx["dg"]
    tabla_ventana(dg, ctx)
    h = HojaGraficos(wb, "E_Proyeccion")
    for g in (grafico_13, grafico_14, grafico_15):
        g(h, ctx)
    h.cerrar()
    return h


def _rango_ventana(ctx, p0, p1):
    dg = ctx["dg"]
    return dg.col(p0), dg.col(p1)


# ── #13 Proyección mensual ────────────────────────────────────────────
def grafico_13(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    V, F = ctx["ventana"], dg.refs["ventana"]["filas"]
    labels, n_hist = ctx["mr"]["labels_periodo"], ctx["mr"]["n_hist"]
    p_ult_real = V.index(labels[n_hist - 1])
    p_fin = V.index(labels[-1])
    p_ini = V.index(labels[0])
    c_ult, c_fin = get_column_letter(dg.col(p_ult_real)), get_column_letter(dg.col(p_fin))
    sub = (f'="Con el escenario "&Inputs!$E$6&", los ingresos proyectados de {etiqueta_mes(labels[-1])} son "&FIXED(Datos_Graficos!{c_fin}{F["ing"]},1)&" M con margen neto de "'
           f'&FIXED(Datos_Graficos!{c_fin}{F["mg_p"]}*100,0)&"%, frente a "&FIXED(Datos_Graficos!{c_ult}{F["ing"]},1)&" M de ingresos reales en {etiqueta_mes(labels[n_hist - 1])}."')
    r = h.lamina(
        f"Proyección mensual {etiqueta_mes(V[0], False)} – {etiqueta_mes(V[-1], False)}",
        sub,
        "Escala: $ millones por mes (barras, eje izquierdo) y margen neto % (línea, eje derecho). Sólido = real; tono claro = proyectado, con el escenario activo de Inputs (celda E6) — una sola línea base. "
        + (f"Los meses de {etiqueta_mes(V[0], False)} a {etiqueta_mes(V[p_ini - 1], False)} quedan vacíos: el sistema no tiene datos de esos meses. " if p_ini > 0 else "")
        + "Fuente: hoja Model (fórmulas).")
    ws_d = dg.ws
    c1, c2 = dg.col(0), dg.col(len(V) - 1)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=F["lab"])
    util = [PALETA["utilidad"] if (p_ini <= p <= p_ult_real) else tono_claro(PALETA["utilidad"]) for p in range(len(V))]
    bar = nuevo_bar(ancho_gap=50)
    s1 = serie_fila(ws_d, F["ing"], c1, c2, "Ingresos"); color_serie(s1, PALETA["ingresos"]); puntos_color(s1, [PALETA["ingresos"] if (p_ini <= p <= p_ult_real) else tono_claro(PALETA["ingresos"]) for p in range(len(V))])
    s2 = serie_fila(ws_d, F["ut"], c1, c2, "Utilidad"); color_serie(s2, PALETA["utilidad"]); puntos_color(s2, util)
    bar.series += [s1, s2]
    bar.set_categories(cats)
    ejes(bar, x_titulo="Mes", y_titulo="$ millones", y_fmt="#,##0.0", rot_x=-90)
    linea = nuevo_linea()
    s3 = serie_fila(ws_d, F["mg_r"], c1, c2, "Margen neto (real)"); color_serie(s3, PALETA["neutro_oscuro"], linea=True, marcador=True)
    s4 = serie_fila(ws_d, F["mg_p"], c1, c2, "Margen neto (proyectado)"); color_serie(s4, PALETA["neutro_oscuro"], linea=True, guion="dash", marcador=True)
    linea.series += [s3, s4]
    linea.set_categories(cats)
    hist = ctx["hist"].set_index("periodo")
    mg_reales = [margen_mes(hist, p) for p in ctx["periodos_reales"]]
    mg_max, mg_min = max(0.40, math.ceil(max(mg_reales + [0.0]) * 10) / 10), min(0.0, math.floor(min(mg_reales + [0.0]) * 10) / 10)
    combo_secundario(bar, linea, y_titulo="Margen neto", y_fmt="0%", y_min=mg_min, y_max=mg_max)
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── #14 Acumulado del año: real vs Plan / proyección ──────────────────
def grafico_14(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    V, F = ctx["ventana"], dg.refs["ventana"]["filas"]
    labels, n_hist = ctx["mr"]["labels_periodo"], ctx["mr"]["n_hist"]
    anio = int(ctx["mes_foco"][:4])
    p_ene = V.index(f"{anio}-01")
    p_dic = p_ene + 11
    reales_anio = [p for p in labels[:n_hist] if p.startswith(str(anio))]
    p_ult_real = V.index(reales_anio[-1]) if reales_anio else None
    c_dic = get_column_letter(dg.col(p_dic))
    if p_ult_real is not None:
        c_ur = get_column_letter(dg.col(p_ult_real))
        sub = (f'="Al cierre de {etiqueta_mes(V[p_ult_real])} la utilidad acumulada real de {anio} es "&FIXED(Datos_Graficos!{c_ur}{F["acum_real"]},1)&" M frente a "'
               f'&FIXED(Datos_Graficos!{c_ur}{F["acum_plan"]},1)&" M del Plan/proyección; al cierre del año el Plan/proyección acumula "&FIXED(Datos_Graficos!{c_dic}{F["acum_plan"]},1)&" M."')
    else:
        sub = f'="El Plan/proyección de {anio} acumula "&FIXED(Datos_Graficos!{c_dic}{F["acum_plan"]},1)&" M (no hay meses reales en ese año)."'
    r = h.lamina(
        f"Acumulado del año {anio}: real vs. Plan / proyectado",
        sub,
        "Escala: utilidad acumulada del año en $ millones. Línea azul = real. Línea amarilla punteada = Plan (proyección Base a un mes) en los meses reales y proyección del modelo (escenario activo) "
        "en los meses futuros; los meses reales sin Plan (el primero) cuentan con su valor real. Plan anual = suma de los Plan mensuales. Meses sin datos quedan vacíos. Fuente: hoja Model y Plan (fórmulas).")
    c1, c2 = dg.col(p_ene), dg.col(p_dic)
    ws_d = dg.ws
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=F["lab"])
    ch = nuevo_linea()
    s1 = serie_fila(ws_d, F["acum_real"], c1, c2, "Utilidad acumulada real"); color_serie(s1, PALETA["real"], linea=True, marcador=True, ancho_pt=3)
    s2 = serie_fila(ws_d, F["acum_plan"], c1, c2, "Plan / proyección"); color_serie(s2, PALETA["plan"], linea=True, marcador=True, guion="dash", ancho_pt=2.5)
    ch.series += [s1, s2]
    ch.set_categories(cats)
    ejes(ch, x_titulo="Mes", y_titulo="$ millones acumulados", y_fmt="#,##0.0")
    leyenda(ch, "b")
    ws.add_chart(ch, f"B{r}")


# ── #15 Resumen anual ─────────────────────────────────────────────────
def grafico_15(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    V, F = ctx["ventana"], dg.refs["ventana"]["filas"]
    labels, n_hist = ctx["mr"]["labels_periodo"], ctx["mr"]["n_hist"]
    anios = sorted({int(p[:4]) for p in labels})
    r0 = dg.seccion("#15 — Resumen anual ($ M)", "FÓRMULAS: suma de la serie mensual del año (Model); Plan anual = suma de los Plan mensuales (meses sin real: la proyección).")
    filas = []
    a_ini = r0 + 1
    for k, a in enumerate(anios):
        rr = a_ini + k
        p0 = V.index(f"{a}-01")
        c1, c2 = get_column_letter(dg.col(p0)), get_column_letter(dg.col(p0 + 11))
        reales = [p for p in labels[:n_hist] if p.startswith(str(a))]
        proys = [p for p in labels[n_hist:] if p.startswith(str(a))]
        tag = "real + proyectado" if reales and proys else ("real" if reales else "proyectado")
        filas.append([f'="{a} ({tag}) · margen "&FIXED(IF(C{rr}=0,0,E{rr}/C{rr})*100,0)&"%"',
                      f"=SUM({c1}{F['ing']}:{c2}{F['ing']})", f"=SUM({c1}{F['egr']}:{c2}{F['egr']})", f"=SUM({c1}{F['ut']}:{c2}{F['ut']})",
                      f"=SUM({c1}{F['plan_modelo']}:{c2}{F['plan_modelo']})"])
    a, b = escribir_tabla(dg, r0, ["Año", "Ingresos ($ M)", "Egresos ($ M)", "Utilidad ($ M)", "Utilidad Plan/proyección ($ M)"], filas, formatos=[None] + ["#,##0.0"] * 4)
    dg.cerrar(b)
    texto = ""
    if len(anios) >= 2:
        texto = (f'="Utilidad {anios[0]}: "&FIXED(Datos_Graficos!E{a},1)&" M; {anios[-1]}: "&FIXED(Datos_Graficos!E{b},1)&" M ("&IF(Datos_Graficos!E{a}=0,"n/d",IF(Datos_Graficos!E{b}>=Datos_Graficos!E{a},"+","−")&FIXED(ABS(Datos_Graficos!E{b}/Datos_Graficos!E{a}-1)*100,0)&"%")&" frente a {anios[0]})."')
    else:
        texto = f'="Utilidad {anios[0]}: "&FIXED(Datos_Graficos!E{a},1)&" M sobre ingresos de "&FIXED(Datos_Graficos!C{a},1)&" M."'
    r = h.lamina(
        f"Resumen anual: {' vs. '.join(str(x) for x in anios)}",
        texto,
        "Escala: $ millones por año. " + " ".join(f"{x} combina meses reales y proyectados." if any(p.startswith(str(x)) for p in labels[:n_hist]) and any(p.startswith(str(x)) for p in labels[n_hist:])
                                                else (f"{x} es proyectado." if not any(p.startswith(str(x)) for p in labels[:n_hist]) else f"{x} es real.") for x in anios)
        + " 'Utilidad Plan/proyección' = suma de los Plan mensuales (meses sin real: la proyección). El margen anual va en el nombre de cada año. Meses del año fuera del modelo no suman. Fuente: hoja Model (fórmulas).")
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=60)
    for col, color, nom in ((3, PALETA["ingresos"], "Ingresos"), (4, PALETA["egresos"], "Egresos"), (5, PALETA["utilidad"], "Utilidad"), (6, PALETA["plan"], "Utilidad Plan/proyección")):
        s = serie_col(dg.ws, col, a, b, nom)
        color_serie(s, color)
        etiquetas(s, fmt="#,##0.0", pos="outEnd", tam=900)
        bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo="Año", y_titulo="$ millones", y_fmt="#,##0.0")
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ══════════════════════════════════════════════════════════════════════
# HOJA F_FAMILIA — Si la familia pagara
# ══════════════════════════════════════════════════════════════════════
def hoja_f_familia(wb, ctx):
    h = HojaGraficos(wb, "F_Familia")
    for g in (grafico_16, grafico_17, grafico_18):
        g(h, ctx)
    h.cerrar()
    return h


def _lit(texto):
    """Texto como literal(es) de fórmula de Excel: comillas escapadas y troceado (un literal admite máx. 255 caracteres)."""
    t = texto.replace('"', '""')
    return "&".join(f'"{t[k:k + 200]}"' for k in range(0, len(t), 200)) if t else '""'


def _nota_familia(ctx, i, previo=""):
    """Nota (fórmula) de los gráficos de consumo familiar: la fórmula de valoración con los números del mes
    en foco (valor por comida fijo, cantidad de comidas) y los supuestos de Inputs. `previo` = texto propio del gráfico."""
    dr = ctx["dr"]
    I = lambda k: f"Inputs!$E${dr[k]}"
    cuerpo = ('"Almuerzo: valor por comida de la familia = $"&FIXED(' + cm(ctx, "val_comida", i)
              + ',0)&" (estimado fijo, editable en Inputs — no es el ticket del Tablero); valor del almuerzo = comidas del mes ("&FIXED(' + cm(ctx, "platos_tot", i) + ',0)&": "&FIXED(' + cm(ctx, "pct_reg", i)
              + '*100,0)&"% de los días con registro real; el resto, "&' + I("fam_comidas_dia") + '&" comidas por día, editable en Inputs) × valor por comida. "'
              + '&' + _lit("Comida rápida: pedidos Gratis a precio de venta (valor real). Nada de esto suma a los ingresos reales. Fuente: hoja Model — Consumo Familiar (fórmulas)."))
    return "=" + (_lit(previo) + "&" if previo else "") + cuerpo


# ── #16 Cascada: utilidad real → ajustada ─────────────────────────────
def grafico_16(h, ctx):
    ws, dg, i = h.ws, ctx["dg"], ctx["i"]
    pasos = [("Utilidad real", f"={cm(ctx, 'fila_utilidad_neta', i)}", "total"),
             ("+ Familia: almuerzo", f"={cm(ctx, 'val_alm_tot', i)}", "delta"),
             ("+ Familia: comida rápida", f"={cm(ctx, 'val_cr', i)}", "delta"),
             ("Utilidad ajustada", f"={cm(ctx, 'ut_aj', i)}", "total")]
    a, b = tabla_cascada(dg, "#16 — Utilidad real → utilidad ajustada ($ M)",
                         "FÓRMULAS hacia Model (Consumo Familiar). Las columnas Base son invisibles: sostienen las barras flotantes.", pasos, dec=2)
    dg.cerrar(b)
    sub = (f'="Si la familia hubiera pagado, la utilidad de {ctx["nombre_mes"]} pasaría de "&{f_mill(cm(ctx, "fila_utilidad_neta", i))}&" M a "&{f_mill(cm(ctx, "ut_aj", i))}'
           f'&" M: +"&{f_mill(cm(ctx, "val_tot", i))}&" M ("&FIXED({cm(ctx, "platos_tot", i)},0)&" comidas de almuerzo a precio de venta y "&{f_mill(cm(ctx, "val_cr", i), 2)}&" M de comida rápida)."')
    r = h.lamina(f"¿Cuánto dejo de ganar por el consumo familiar? — {ctx['nombre_mes'].capitalize()}", sub,
                 _nota_familia(ctx, i, "Escala: $ millones del mes. Las columnas del gráfico parten de la utilidad real y suman lo que la familia no pagó. "))
    colores = [PALETA["utilidad"], PALETA["almuerzo"], PALETA["comida_rapida"], PALETA["utilidad"]]
    ch = grafico_cascada(h, dg, a, b, colores)
    ejes(ch, x_titulo="Paso", y_titulo="$ millones", y_fmt="#,##0.0")
    ws.add_chart(ch, f"B{r}")


# ── #17 Indicadores: reales vs. si la familia pagara ──────────────────
def grafico_17(h, ctx):
    ws, i = h.ws, ctx["i"]
    tiene_ant, tiene_plan = i > 0, hay_plan(ctx)
    P = lambda k: cplan(ctx, k)
    dias = cm(ctx, "dias_op", i)
    # (nombre, clave real, clave ajustada, tipo, favorable_sube, fórmula Plan o None)
    plan_ing, plan_ut = P("ingresos") if tiene_plan else None, P("utilidad") if tiene_plan else None
    plan_f = None
    if tiene_plan:
        plan_f = {
            "mg": f"IF({plan_ing}=0,0,{plan_ut}/{plan_ing})",
            "ins": f"IF({plan_ing}=0,0,{P('insumos')}/{plan_ing})",
            "primo": f"IF({plan_ing}=0,0,({P('insumos')}+{P('nomina')})/{plan_ing})",
            "util": f"IF({dias}=0,0,{plan_ut}/{dias})",
            "pe": f"IF(OR({dias}=0,{plan_ing}=0,{P('insumos')}/{plan_ing}>=1),0,({P('nomina')}+{P('arriendo')}+{P('otros')})/(1-{P('insumos')}/{plan_ing})/{dias})",
        }
    filas = [("Margen neto", "mg_real", "mg_aj", "pct", True, "mg"),
             ("Costo de insumos (% de ventas)", "ins_real", "ins_aj", "pct", False, "ins"),
             ("· Desechables (% de ventas)", "des_real", "des_aj", "pct", False, None),   # el Plan de insumos no los separa
             ("Costo primo (% de ventas)", "primo_real", "primo_aj", "pct", False, "primo"),
             ("Utilidad diaria promedio", "util_dia_real", "util_dia_aj", "money", True, "util"),
             ("Punto de equilibrio diario", "pe_real", "pe_aj", "money", False, "pe")]
    fh = ctx["fila_hist"]
    r = h.lamina(
        f"Indicadores: reales vs. si la familia pagara — {ctx['nombre_mes'].capitalize()}",
        f'="Con el consumo familiar a precio de venta, el margen neto pasa de "&FIXED({cm(ctx, "mg_real", i)}*100,1)&"% a "&FIXED({cm(ctx, "mg_aj", i)}*100,1)&"% y el punto de equilibrio diario de $"&FIXED({cm(ctx, "pe_real", i)},0)&" a $"&FIXED({cm(ctx, "pe_aj", i)},0)&"."',
        _nota_familia(ctx, i, "Real = como lo registra el sistema (la familia no paga). Ajustado = sumando el consumo familiar a precio de venta. ▲▼ comparan el valor REAL con el mes anterior y con el Plan "
                              "(Plan = proyección Base a un mes); verde = favorable, rojo = desfavorable; en % se muestra el cambio en puntos (pp). "), alto=22, alto_nota=52)
    columnas = [("Indicador", 2, 4), ("Real", 5, 6), ("Ajustado", 7, 8), ("Diferencia", 9, 10), ("vs. mes anterior", 11, 12), ("vs. Plan", 13, 14)]
    cab = r
    for txt, c1, c2 in columnas:
        ws.merge_cells(start_row=cab, start_column=c1, end_row=cab, end_column=c2)
        c = ws.cell(row=cab, column=c1, value=txt)
        c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=PALETA["neutro_oscuro"])
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[cab].height = 24
    gris = PatternFill("solid", fgColor=tono_claro(PALETA["neutro_claro"], 0.7))
    for k, (nombre, k_real, k_aj, tipo, fav_sube, k_plan) in enumerate(filas):
        rr = cab + 1 + k
        ws.row_dimensions[rr].height = 34
        real, aj = cm(ctx, k_real, i), cm(ctx, k_aj, i)
        prev = cm(ctx, k_real, i - 1) if tiene_ant else None
        if tipo == "pct":
            f_dif = f"=({aj}-{real})*100"
            fmt_val, fmt_dif = "0.0%", '+0.0" pp";-0.0" pp";0.0" pp"'
            f_ant = f'=IF({real}>={prev},"▲ ","▼ ")&FIXED(ABS({real}-{prev})*100,1)&" pp"' if prev else '="—"'
            f_pl = f'=IF({real}>={plan_f[k_plan]},"▲ ","▼ ")&FIXED(ABS({real}-{plan_f[k_plan]})*100,1)&" pp"' if (plan_f and k_plan) else '="—"'
        else:
            f_dif = f"={aj}-{real}"
            fmt_val, fmt_dif = "$ #,##0", '+$ #,##0;-$ #,##0;$ 0'
            f_ant = f'=IF(OR({prev}=0),"—",IF({real}>={prev},"▲ ","▼ ")&FIXED(ABS({real}/{prev}-1)*100,1)&"%")' if prev else '="—"'
            f_pl = f'=IF({plan_f[k_plan]}=0,"—",IF({real}>={plan_f[k_plan]},"▲ ","▼ ")&FIXED(ABS({real}/{plan_f[k_plan]}-1)*100,1)&"%")' if (plan_f and k_plan) else '="—"'
        valores = [nombre, f"={real}", f"={aj}", f_dif, f_ant, f_pl]
        for (txt, c1, c2), v in zip(columnas, valores):
            ws.merge_cells(start_row=rr, start_column=c1, end_row=rr, end_column=c2)
            c = ws.cell(row=rr, column=c1, value=v)
            c.alignment = Alignment(horizontal="left" if txt == "Indicador" else "center", vertical="center", indent=1 if txt == "Indicador" else 0)
            c.font = Font(name="Calibri", size=12, bold=(txt in ("Indicador", "Ajustado")), color=PALETA["neutro_oscuro"])
            if txt in ("Real", "Ajustado"):
                c.number_format = fmt_val
            elif txt == "Diferencia":
                c.number_format = fmt_dif
            for cc in range(c1, c2 + 1):
                ws.cell(row=rr, column=cc).fill = gris
                ws.cell(row=rr, column=cc).border = Border(bottom=Side(style="thin", color="FFFFFF"))
        bien, mal = PALETA["utilidad"], PALETA["alerta"]
        sube_c, baja_c = (bien, mal) if fav_sube else (mal, bien)
        for L in ("K", "M"):
            ws.conditional_formatting.add(f"{L}{rr}", FormulaRule(formula=[f'LEFT({L}{rr},1)="▲"'], font=Font(color=sube_c, bold=True)))
            ws.conditional_formatting.add(f"{L}{rr}", FormulaRule(formula=[f'LEFT({L}{rr},1)="▼"'], font=Font(color=baja_c, bold=True)))
    if not tiene_plan:
        nota(ws, cab + len(filas) + 2, "Sin Plan para este mes: la columna 'vs. Plan' queda en —.", col=2)


# ── #18 Peso del consumo familiar en el tiempo ────────────────────────
def grafico_18(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    labels, n_hist = ctx["mr"]["labels_periodo"], ctx["mr"]["n_hist"]
    i = ctx["i"]
    r0 = dg.seccion("#18 — Consumo familiar a precio de venta, por mes ($ M)", "FÓRMULAS hacia Model (Consumo Familiar). La etiqueta del mes lleva el tipo de dato: est. / mixto / reg. / proy.")
    ws_d = dg.ws
    nombres = ["Mes (con tipo de dato)", "Almuerzo ($ M)", "Comida rápida ($ M)", "% de las ventas"]
    for k, nom in enumerate(nombres):
        label(ws_d, r0 + k, nom, bold=(k == 0))
    for ix, lab in enumerate(labels):
        c = dg.col(ix)
        L = get_column_letter(c)
        if ix < n_hist:
            tag = f'IF({cm(ctx, "pct_reg", ix)}>=0.995,"reg.",IF({cm(ctx, "pct_reg", ix)}<=0.005,"est.","mixto"))'
        else:
            tag = '"proy."'
        ws_d.cell(row=r0, column=c, value=f'="{etiqueta_mes(lab)} · "&{tag}').font = Font(bold=True)
        numero(ws_d, r0 + 1, c, f"={cm(ctx, 'val_alm_tot', ix)}/1000000").number_format = "#,##0.00"
        numero(ws_d, r0 + 2, c, f"={cm(ctx, 'val_cr', ix)}/1000000").number_format = "#,##0.00"
        numero(ws_d, r0 + 3, c, f"=IF({cm(ctx, 'fila_ingresos', ix)}=0,0,{cm(ctx, 'val_tot', ix)}/{cm(ctx, 'fila_ingresos', ix)})", pct=True)
    dg.cerrar(r0 + 3)
    L_foco = get_column_letter(dg.col(i))
    sub = (f'="En {ctx["nombre_mes"]} el consumo familiar a precio de venta fue "&FIXED(Datos_Graficos!{L_foco}{r0 + 1}+Datos_Graficos!{L_foco}{r0 + 2},1)&" M, "'
           f'&FIXED(Datos_Graficos!{L_foco}{r0 + 3}*100,1)&"% de las ventas ("&RIGHT(Datos_Graficos!{L_foco}{r0},LEN(Datos_Graficos!{L_foco}{r0})-FIND("·",Datos_Graficos!{L_foco}{r0})-1)&")."')
    r = h.lamina(
        "Peso del consumo familiar en el tiempo",
        sub,
        "Escala: $ millones por mes a precio de venta (barras apiladas: almuerzo y comida rápida) y % de las ventas (línea, eje derecho 0–30 %; se amplía solo si algún mes lo supera). Tipo de dato de cada mes según el % de días de almuerzo con registro real de platos: "
        "est. = todo estimado, mixto = parte registrado, reg. = todo registrado, proy. = proyectado con Inputs. Comida rápida siempre es valor real (pedidos Gratis). "
        "Almuerzo = comidas del mes × valor por comida de la familia (estimado fijo de Inputs, no es el ticket del Tablero). Fuente: hoja Model (fórmulas).")
    c1, c2 = dg.col(0), dg.col(len(labels) - 1)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=r0)
    bar = nuevo_bar(apilado=True, ancho_gap=45)
    s1 = serie_fila(ws_d, r0 + 1, c1, c2, "Almuerzo (a precio de venta)"); color_serie(s1, PALETA["almuerzo"])
    s2 = serie_fila(ws_d, r0 + 2, c1, c2, "Comida rápida (pedidos Gratis)"); color_serie(s2, PALETA["comida_rapida"])
    bar.series += [s1, s2]
    bar.set_categories(cats)
    ejes(bar, x_titulo="Mes · tipo de dato", y_titulo="$ millones", y_fmt="#,##0.0", y_min=0, rot_x=-90)
    linea = nuevo_linea()
    s3 = serie_fila(ws_d, r0 + 3, c1, c2, "% de las ventas"); color_serie(s3, PALETA["neutro_oscuro"], linea=True, marcador=True)
    linea.series.append(s3)
    linea.set_categories(cats)
    # eje 0–30 %; solo se deja automático si algún mes real supera 30 % con los supuestos por defecto de Inputs
    F = ctx["dr"]["_familia_valores"]
    hh = ctx["hist"]
    def _valor_alm_defecto(r):   # con los supuestos por defecto de Inputs (solo para elegir el rango del eje)
        comidas = float(r["platos_registrados"]) + (float(r["dias_alm_operados"]) - float(r["dias_con_registro"])) * F["comidas_dia"]
        return comidas * F["valor_comida"]
    pct_real = [(_valor_alm_defecto(r) + float(r["valor_cr_registrado"]))
                / max(float(r["ingresos_almuerzo"] + r["ingresos_cena"]), 1) for _k, r in hh.iterrows()]
    combo_secundario(bar, linea, y_titulo="% de las ventas", y_fmt="0%", y_min=0, y_max=0.30 if max(pct_real + [0.0]) <= 0.30 else None)
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ══════════════════════════════════════════════════════════════════════
# HOJA G_EXTRAS — complementarios
# ══════════════════════════════════════════════════════════════════════
def hoja_g_extras(wb, ctx):
    h = HojaGraficos(wb, "G_Extras")
    for g in (grafico_19, grafico_20, grafico_21):
        g(h, ctx)
    h.cerrar()
    return h


# ── #19 Cómo me pagan y por dónde vendo ───────────────────────────────
def grafico_19(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    ped = ctx["diario"]["pedidos"]
    mf = ctx["mes_foco"]
    pm = ped[ped["periodo"] == mf] if not ped.empty else ped
    titulo = f"Cómo me pagan y por dónde vendo — {ctx['nombre_mes'].capitalize()}"
    nota_base = ("Escala: % de lo vendido en pedidos del mes (100 % por barra). Efectivo/transferencia según el reparto real de cada pedido (el pago dividido cuenta cada parte en su columna). "
                 "Canal: Domicilio, Para llevar / sin mesa (incluye pedidos marcados 'para llevar'), Mesa; 'Otro' = fiados u otros sin ubicación. Fuente: Pedidos_Pagados del mes en foco, sin Gratis "
                 "(no incluye desayuno ni ajustes manuales).")
    if pm.empty:
        h.lamina(titulo, "No hay pedidos en el mes en foco.", nota_base)
        return
    pagos = [("Efectivo", float(pm["pago_efectivo"].sum())), ("Transferencia", float(pm["pago_transferencia"].sum()))]
    canales = [(c, float(pm[pm["canal"] == c]["monto_total"].sum())) for c in ("Mesa", "Para llevar / sin mesa", "Domicilio", "Otro")]
    canales = [(c, v) for c, v in canales if v > 0]
    tot_p, tot_c = sum(v for _c, v in pagos), sum(v for _c, v in canales)
    sh_p = {c: (v / tot_p if tot_p else 0) for c, v in pagos}
    sh_c = {c: (v / tot_c if tot_c else 0) for c, v in canales}
    r = h.lamina(
        titulo,
        f"El {fmt_pct(sh_p['Transferencia'])} de lo vendido en pedidos entra por transferencia"
        + (f" y el {fmt_pct(sh_c.get('Domicilio', 0))} se vende a domicilio" if "Domicilio" in sh_c else "")
        + (f"; por mesa se vende el {fmt_pct(sh_c['Mesa'])}" if "Mesa" in sh_c else "") + ".",
        nota_base)
    series = [(n, v, "pago") for n, v in pagos] + [(n, v, "canal") for n, v in canales]
    r0 = dg.seccion("#19 — Método de pago y canal de venta ($ M)", "Calculado por el script al generar el modelo (Pedidos_Pagados del mes en foco). Los encabezados llevan el % de cada grupo (fórmula).")
    filas = [["Cómo me pagan"] + [(v / 1e6 if g == "pago" else None) for _n, v, g in series],
             ["Por dónde vendo"] + [(v / 1e6 if g == "canal" else None) for _n, v, g in series]]
    a, b = escribir_tabla(dg, r0, ["Grupo"] + [n for n, _v, _g in series], filas, formatos=[None] + ["#,##0.00"] * len(series))
    for j, (n, _v, g) in enumerate(series):
        col = 3 + j
        L, fila = get_column_letter(col), (a if g == "pago" else b)
        dg.ws.cell(row=r0, column=col, value=f'="{n} · "&FIXED({L}{fila}/SUM($C{fila}:${get_column_letter(2 + len(series))}{fila})*100,0)&"%"')
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(horizontal=True, apilado=True, ancho_gap=70)
    bar.grouping = "percentStacked"
    colores = {"Efectivo": PALETA["neutro_oscuro"], "Transferencia": tono_claro(PALETA["neutro_oscuro"], 0.55), "Mesa": PALETA["ingresos"],
               "Para llevar / sin mesa": tono_claro(PALETA["ingresos"], 0.4), "Domicilio": tono_claro(PALETA["ingresos"], 0.65), "Otro": PALETA["neutro_claro"]}
    for j, (n, _v, _g) in enumerate(series):
        s = Series(Reference(dg.ws, min_col=3 + j, min_row=r0, max_row=b), title_from_data=True)
        color_serie(s, colores[n])
        bar.series.append(s)
    bar.set_categories(cats)
    bar.x_axis.scaling.orientation = "maxMin"
    ejes(bar, y_titulo="% de lo vendido", y_fmt="0%")
    bar.y_axis.crosses = "max"
    leyenda(bar, "b")
    ws.add_chart(bar, f"B{r}")


# ── #20 ¿Qué gasto crece más rápido que mis ventas? ───────────────────
def grafico_20(h, ctx):
    ws, dg, i = h.ws, ctx["dg"], ctx["i"]
    per, hist = ctx["periodos_reales"], ctx["hist"].set_index("periodo")
    titulo = "¿Qué gasto crece más rápido que mis ventas?"
    if len(per) < 2:
        h.lamina(titulo, "Hace falta al menos 2 meses reales para comparar el crecimiento.", "Índice base 100 = primer mes real. Omitido: solo hay un mes real.")
        return
    idxs = list(range(0, i + 1))
    candidatos = [("Ventas", "fila_ingresos", lambda p: ingresos_de(hist, p), PALETA["ingresos"], False),
                  ("Insumos (incl. desechables)", "fila_costo_insumos", lambda p: float(hist.loc[p, "costo_insumos"]), PALETA["egresos"], False),
                  ("Desechables (parte de insumos)", "fila_desechables", lambda p: float(hist.loc[p, "costo_desechables"]), PALETA["desechables"], False),
                  ("Nómina", "fila_nomina", lambda p: float(hist.loc[p, "nomina"]), tono_claro(PALETA["egresos"], 0.3), False),
                  ("Arriendo y servicios", "fila_arriendo", lambda p: float(hist.loc[p, "arriendo_servicios"]), tono_claro(PALETA["egresos"], 0.55), False),
                  ("Otros", "fila_otros", lambda p: float(hist.loc[p, "otros_gastos"]), tono_claro(PALETA["neutro_oscuro"], 0.4), False)]
    usables = [c for c in candidatos if c[2](per[0]) > 0]
    omitidos = [c[0] for c in candidatos if c[2](per[0]) <= 0]
    crec = {c[0]: c[2](per[i]) / c[2](per[0]) - 1 for c in usables}
    gastos = {k: v for k, v in crec.items() if k != "Ventas"}
    mas_rapido = max(gastos, key=gastos.get) if gastos else None
    if mas_rapido is not None and gastos[mas_rapido] > crec.get("Ventas", 0):
        hallazgo = f"Entre {nombre_mes_largo(per[0])} y {nombre_mes_largo(per[i])} las ventas crecieron {fmt_pct(crec['Ventas'], 0, True)} y {mas_rapido.lower()} {fmt_pct(gastos[mas_rapido], 0, True)}: crece más rápido que las ventas."
    else:
        hallazgo = f"Entre {nombre_mes_largo(per[0])} y {nombre_mes_largo(per[i])} las ventas crecieron {fmt_pct(crec.get('Ventas', 0), 0, True)}; ningún rubro de gasto crece más rápido."
    n_primero, n_foco = int(hist.loc[per[0], "dias_operados"]), int(hist.loc[per[i], "dias_operados"])
    ojo = (f" Ojo: el primer mes real tuvo {n_primero} días operados y {nombre_mes_largo(per[i])} {n_foco}; el índice mezcla meses de distinto largo." if n_primero and (n_primero < 0.8 * n_foco or n_primero > 1.25 * n_foco) else "")
    r = h.lamina(
        titulo, hallazgo + ojo,
        "Escala: índice base 100 = primer mes real (cada línea parte de 100). Por encima de la línea de ventas = crece más rápido que las ventas. "
        + (f"Omitidos por tener 0 en el mes base: {', '.join(omitidos)}. " if omitidos else "") + "Fuente: hoja Model (fórmulas).")
    r0 = dg.seccion("#20 — Índice base 100 (primer mes real = 100)", "FÓRMULAS hacia Model: valor del mes ÷ valor del primer mes real × 100.")
    ws_d = dg.ws
    label(ws_d, r0, "Mes")
    for k, ix in enumerate(idxs):
        ws_d.cell(row=r0, column=dg.col(k), value=etiqueta_mes(per[ix])).font = Font(bold=True)
    for j, (nom, clave, _f, _c, _x) in enumerate(usables):
        label(ws_d, r0 + 1 + j, nom)
        base = cm(ctx, clave, 0)
        for k, ix in enumerate(idxs):
            numero(ws_d, r0 + 1 + j, dg.col(k), f"=IF({base}=0,0,{cm(ctx, clave, ix)}/{base}*100)").number_format = "0"
    dg.cerrar(r0 + len(usables))
    c1, c2 = dg.col(0), dg.col(len(idxs) - 1)
    cats = Reference(ws_d, min_col=c1, max_col=c2, min_row=r0)
    ch = nuevo_linea()
    for j, (nom, _cl, _f, color, _x) in enumerate(usables):
        s = serie_fila(ws_d, r0 + 1 + j, c1, c2, nom)
        color_serie(s, color, linea=True, marcador=True, ancho_pt=3.25 if nom == "Ventas" else 2.0, guion=None if nom == "Ventas" else "dash" if nom.startswith("Desechables") else "solid")
        ch.series.append(s)
    ch.set_categories(cats)
    ejes(ch, x_titulo="Mes", y_titulo="Índice (primer mes real = 100)", y_fmt="0")
    leyenda(ch, "b")
    ws.add_chart(ch, f"B{r}")


# ── #21 Plata por cobrar (fiados) por antigüedad ──────────────────────
def grafico_21(h, ctx):
    ws, dg = h.ws, ctx["dg"]
    fi = ctx["diario"]["fiados"]
    hoy = pd.Timestamp(ctx["diario"]["hoy"])
    titulo = "Plata por cobrar (fiados) por antigüedad"
    nota_base = ("Escala: $ miles. Es un SNAPSHOT del día en que se generó el modelo (" + hoy.strftime("%d/%m/%Y") + "): el sistema solo guarda los fiados pendientes de hoy, no el historial de saldos. "
                 "Antigüedad = días desde la fecha del pedido. Montos brutos de los pedidos fiados pendientes (el saldo de Cuentas por Cobrar del Balance además descuenta abonos). Fuente: Pedidos_Pendientes (es_fiar).")
    if fi.empty or fi["monto_total"].sum() <= 0:
        h.lamina(titulo, "No hay fiados pendientes.", nota_base)
        return
    edad = (hoy - fi["fecha"]).dt.days
    cortes = [("0–7 días", 0, 7), ("8–15 días", 8, 15), ("16–30 días", 16, 30), ("Más de 30 días", 31, 10 ** 6)]
    sumas = [float(fi[(edad >= a_) & (edad <= b_)]["monto_total"].sum()) for _n, a_, b_ in cortes]
    total = sum(sumas)
    viejos = sumas[2] + sumas[3]
    r = h.lamina(
        titulo,
        f"Hay {fmt_pesos(total)} en fiados pendientes ({len(fi)} fila(s) de pedido); {fmt_pct(viejos / total if total else 0)} tiene más de 15 días.",
        nota_base)
    r0 = dg.seccion("#21 — Fiados pendientes por antigüedad ($ miles)", "Calculado por el script al generar el modelo (Pedidos_Pendientes con es_fiar).")
    filas = [[n, v / 1000] for (n, _a, _b), v in zip(cortes, sumas)]
    a, b = escribir_tabla(dg, r0, ["Antigüedad", "Por cobrar ($ miles)"], filas, formatos=[None, "#,##0"])
    dg.cerrar(b)
    cats = Reference(dg.ws, min_col=2, min_row=a, max_row=b)
    bar = nuevo_bar(ancho_gap=60)
    s = serie_col(dg.ws, 3, a, b, "Por cobrar")
    color_serie(s, PALETA["utilidad"])
    puntos_color(s, [PALETA["utilidad"], PALETA["plan"], tono_claro(PALETA["alerta"], 0.4), PALETA["alerta"]])
    etiquetas(s, fmt="#,##0", pos="outEnd", tam=1100)
    bar.series.append(s)
    bar.set_categories(cats)
    ejes(bar, x_titulo="Antigüedad del pedido", y_titulo="$ miles", y_fmt="#,##0", y_min=0)
    sin_leyenda(bar)
    ws.add_chart(bar, f"B{r}")


def construir_hojas_graficos(wb, ctx):
    """Crea las hojas de gráficos nuevas (después de Outputs) y devuelve la lista
    de hojas, en el orden en que deben quedar. Datos_Graficos va al final (lo pone main)."""
    hojas = []
    for nombre, fn in HOJAS_GRAFICOS:
        hojas.append(fn(wb, ctx).ws)
    return hojas


HOJAS_GRAFICOS = [
    ("A_Resultado", hoja_a_resultado),
    ("B_Ingresos", hoja_b_ingresos),
    ("C_Egresos", hoja_c_egresos),
    ("E_Proyeccion", hoja_e_proyeccion),
    ("F_Familia", hoja_f_familia),
    ("G_Extras", hoja_g_extras),
]


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


def periodo_base_meses(hist_df, mes_foco, max_meses=3):
    """Índices (posición 0-based en hist_df) de hasta `max_meses` últimos meses
    reales que terminan en mes_foco (inclusive) — el período base de "si todo
    sigue igual" que usa la proyección (Model → Supuestos del dueño): ritmo de
    ventas por día operado, costo de insumos % y gastos fijos promedio.
    Con un solo mes real (hoy), el período base es ese único mes."""
    periodos = list(hist_df["periodo"])
    idx = periodos.index(mes_foco) if mes_foco in periodos else len(periodos) - 1
    return list(range(max(0, idx - max_meses + 1), idx + 1))


def reportar_ingresos_sin_pedido(hist):
    """Imprime, por mes real, cuánto del ingreso de cierre NO tiene pedido detrás (ajustes manuales y
    cierres manuales) y reporta los meses donde ese monto es negativo (pedidos equivalentes = 0)."""
    if hist.empty or "ventas_pedidos_almuerzo" not in hist.columns:
        return
    print("\nIngresos de cierre sin pedido asociado (ajustes y cierres manuales):")
    negativos = []
    for _i, r in hist.iterrows():
        for turno, nombre, ing, des in (("almuerzo", "Almuerzo", r["ingresos_almuerzo"], r["ingresos_desayuno"]), ("cena", "Comidas rápidas", r["ingresos_cena"], 0.0)):
            total = float(ing - des) - float(r[f"ventas_pedidos_{turno}"])
            if total < 0:
                negativos.append((r["periodo"], nombre, total))
            aj, ma = r.get(f"sinped_ajustes_{turno}"), r.get(f"sinped_manual_{turno}")
            detalle = ""
            if aj is not None and pd.notna(aj) and ma is not None and pd.notna(ma):
                detalle = f" = ajustes {fmt_pesos(aj)} + cierres manuales {fmt_pesos(ma)} + otros {fmt_pesos(total - aj - ma)} (p. ej. fiados cuya plata no entró al cierre)"
            if abs(total) >= 1 or detalle:
                print(f"  · {r['periodo']} {nombre}: {fmt_pesos(total)}{detalle}")
    if negativos:
        print("  ⚠ Ingresos sin pedido NEGATIVOS (pedidos equivalentes = 0 en esos meses): "
              + "; ".join(f"{p} {n} {fmt_pesos(v)}" for p, n, v in negativos))


def reportar_ticket_platos_fuertes(hist):
    """Avisa por consola los meses sin pedidos de platos fuertes de almuerzo: el ticket informativo de
    platos fuertes (#9/#17, Revenue Schedule) queda arrastrado del último mes con dato. Ya NO afecta el
    consumo familiar (ese usa un valor por comida fijo de Inputs, no este ticket)."""
    if hist.empty or "unidades_platos_fuertes_almuerzo" not in hist.columns:
        return
    ultimo = None
    for _i, r in hist.iterrows():
        if r["unidades_platos_fuertes_almuerzo"] > 0:
            ultimo = (r["periodo"], r["ticket_platos_fuertes"])
        elif ultimo is not None:
            print(f"  ⚠ {r['periodo']}: no hubo pedidos de platos fuertes de almuerzo; el ticket informativo arrastra el de {ultimo[0]} ({fmt_pesos(ultimo[1])}).")
        else:
            print(f"  ⚠ {r['periodo']}: no hubo pedidos de platos fuertes de almuerzo y no hay un mes anterior con dato: el ticket informativo queda en $0.")


def reportar_festivos(festivos, desde, hasta):
    """Imprime por consola los festivos (fecha: nombre) entre desde y hasta (AAAA-MM, inclusive) —
    para validar el calendario que usa NETWORKDAYS.INTL en Model (ver festivos_colombia())."""
    d0, d1 = pd.Period(desde, freq="M").start_time, pd.Period(hasta, freq="M").end_time
    en_rango = {f: n for f, n in festivos.items() if d0.date() <= f <= d1.date()}
    print(f"\nFestivos Colombia {desde} a {hasta} ({len(en_rango)}) — usados por NETWORKDAYS.INTL en Model, tabla editable en Inputs:")
    for f, n in en_rango.items():
        print(f"  {f.strftime('%Y-%m-%d')} ({DIAS_SEMANA[f.weekday()]}): {n}")


def reportar_meses_pocos_dias(hist, umbral=15):
    """Avisa por consola los meses reales con pocos días operados (p. ej. el mes en curso,
    recién empezado, o un mes donde el sistema todavía no se usaba a diario): las comparaciones
    mes a mes con ellos son poco fiables (ver aviso_dias(), que ya avisa esto dentro del propio
    gráfico cuando corresponde). Si además ese mes no tiene pedidos individuales de almuerzo
    registrados (sus ingresos vinieron solo de ajustes/cierres manuales), el ticket promedio de
    ese mes queda en $0 — el caso que antes hacía reventar #9 con un ZeroDivisionError."""
    if hist.empty or "dias_operados" not in hist.columns:
        return
    for _i, r in hist.iterrows():
        dias = int(r["dias_operados"])
        if 0 < dias < umbral:
            extra = ""
            if {"ventas_pedidos_almuerzo", "ingresos_almuerzo"}.issubset(hist.columns):
                if float(r["ventas_pedidos_almuerzo"]) == 0 and float(r["ingresos_almuerzo"]) > 0:
                    extra = " y no tiene pedidos de almuerzo individuales registrados (sus ingresos vinieron solo de ajustes/cierres manuales) — su ticket promedio queda en $0"
            print(f"  ⚠ {r['periodo']}: solo {dias} día(s) operado(s) — las comparaciones mes a mes con este mes son poco fiables{extra}.")


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
    ap.add_argument("archivo", nargs="?", help=(
        "Excel exportado desde la pestaña Datos. Puede estar en cualquier carpeta (ruta absoluta, relativa o con ~); "
        "se recomienda guardarlo fuera del repo, p. ej. ~/ElLobo-datos/"))
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
    ap.add_argument("--inicio", default=MES_INICIO_DATOS_REALES, metavar="AAAA-MM", help=(
        f"Primer mes de datos reales a considerar (por defecto {MES_INICIO_DATOS_REALES}): "
        "cualquier fila anterior, en cualquier tabla, se ignora. Solo aplica a datos reales, no a --demo."
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
        # El export tiene los datos reales del negocio: lo mejor es guardarlo FUERA de este repo
        # (público). Se acepta cualquier ruta: absoluta, relativa o con ~ (p. ej. ~/ElLobo-datos/export.xlsx).
        archivo = Path(args.archivo).expanduser()
        if not archivo.is_file():
            print(f"No encuentro el archivo: {archivo}\n"
                  "Pasa la ruta completa del Excel exportado (entre comillas si tiene espacios).")
            sys.exit(1)
        hist_df, extra, diario = cargar_datos_reales(str(archivo), mes_inicio=args.inicio)
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
    reportar_ingresos_sin_pedido(hist_df)
    reportar_ticket_platos_fuertes(hist_df)
    reportar_meses_pocos_dias(hist_df)

    meses_fcst_labels = etiquetas_proyeccion(hist_df, args.hasta, args.meses_proyeccion)
    reportar_festivos(festivos_colombia(2026, 2027), "2026-10", "2027-12")

    wb = Workbook()
    wb.remove(wb.active)

    hoja_cover(wb, len(hist_df), len(meses_fcst_labels), es_demo)
    ws_inputs, driver_rows = hoja_inputs(wb, hist_df, meses_fcst_labels, mes_foco)
    ws_model, model_refs = hoja_model(wb, hist_df, meses_fcst_labels, extra, driver_rows, mes_foco)
    hoja_outputs(wb, model_refs)

    # Hojas de apoyo y gráficos nuevos (ctx = todo lo que necesitan para armar sus tablas)
    ctx = dict(hist=hist_df, fcst=meses_fcst_labels, mr=model_refs, dr=driver_rows, diario=diario,
               mes_foco=mes_foco, es_demo=es_demo, extra=extra)
    dg = DatosGraficos(wb)
    ctx["dg"] = dg
    tabla_plan(dg, ctx)
    preparar_foco(ctx)
    hojas_nuevas = construir_hojas_graficos(wb, ctx)
    config_impresion(dg.ws, horizontal=True)

    # Orden final de hojas: Cover, Outputs, hojas de gráficos nuevas, Inputs, Model, Datos_Graficos
    wb._sheets = [wb["Cover"], wb["Outputs"]] + hojas_nuevas + [wb["Inputs"], wb["Model"], dg.ws]
    wb.active = 0

    try:
        wb.save(salida_path)
    except PermissionError:
        print(f"No se pudo guardar {salida_path}: el archivo está abierto en Excel (u otro programa). "
              "Ciérralo y vuelve a correr el script, o usa --salida con otro nombre.")
        sys.exit(1)
    print(f"✅ Modelo generado: {salida_path}  ({len(hist_df)} meses reales + {len(meses_fcst_labels)} proyectados)")
    fila_foco = hist_df[hist_df["periodo"] == mes_foco].iloc[0]
    tkt_foco = float(fila_foco["ventas_pedidos_almuerzo"]) / max(float(fila_foco["volumen_almuerzo"]), 1)
    print(f"Ticket almuerzo del mes en foco ({mes_foco}): {fmt_pesos(tkt_foco)} (debe coincidir con el Tablero)")
    print(f"Ticket de platos fuertes del mes en foco ({mes_foco}): {fmt_pesos(float(fila_foco['ticket_pf_usado']))} "
          f"({fmt_n(float(fila_foco['unidades_platos_fuertes_almuerzo']))} unidades; informativo — ya no alimenta el consumo familiar)")

    # Verificación del consumo familiar del mes en foco (mismas cuentas que Model → Consumo
    # Familiar, calculadas acá en Python para confirmar por consola sin tener que abrir el Excel).
    FAM = driver_rows["_familia_valores"]
    dias_alm_op = int(fila_foco["dias_alm_operados"])
    dias_con_reg = int(fila_foco["dias_con_registro"])
    dias_sin_reg = dias_alm_op - dias_con_reg
    platos_reg = float(fila_foco["platos_registrados"])
    platos_est = dias_sin_reg * FAM["comidas_dia"]
    platos_tot = platos_reg + platos_est
    valor_alm_fam = platos_tot * FAM["valor_comida"]
    valor_cr_fam = float(fila_foco["valor_cr_registrado"])
    total_fam = valor_alm_fam + valor_cr_fam
    print(f"Consumo familiar del mes en foco ({mes_foco}):")
    print(f"  comidas por día (Inputs): {fmt_n(FAM['comidas_dia'])} · días sin registro: {dias_sin_reg} de {dias_alm_op} días de almuerzo operados "
          f"({dias_con_reg} con registro real)")
    print(f"  comidas registradas: {fmt_n(platos_reg)} + comidas estimadas: {fmt_n(platos_est)} = comidas totales: {fmt_n(platos_tot)}")
    print(f"  valor por comida de la familia (Inputs, estimado fijo — no es el ticket del Tablero): {fmt_pesos(FAM['valor_comida'])} -> valor del almuerzo familiar: {fmt_pesos(valor_alm_fam)}")
    print(f"  valor de comida rápida Gratis: {fmt_pesos(valor_cr_fam)}")
    print(f"  total consumo familiar a precio de venta: {fmt_pesos(total_fam)}")


if __name__ == "__main__":
    main()
