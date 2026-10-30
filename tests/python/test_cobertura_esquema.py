"""¿El esquema completo (sql/esquema_completo.sql) cubre TODO lo que el sistema usa?

Compara las tablas y columnas que el código del sistema necesita (tests/fixtures/columnas_usadas.json, sacado de
docs/ESPECIFICO_EL_LOBO.md §2.5) contra el esquema que se crea al aplicar sql/esquema_completo.sql en un
Postgres desechable. También comprueba que ese esquema funciona junto con sql/rls_seguridad.sql (las reglas de
acceso) y que se puede aplicar dos veces.

  · Mientras sql/esquema_completo.sql NO exista (se genera con el resultado de sql/consulta_esquema.sql
    corrido en Supabase), las pruebas sobre el archivo real se saltan solas y avisan por qué.
  · La lógica de la comparación se prueba siempre, con el esquema de ejemplo.

Correr:  python -m pytest tests/python/test_cobertura_esquema.py -q   (necesita PostgreSQL; si no, se salta)
"""
import json
import re
import sys
import warnings
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "herramientas"))
import esquema_a_sql as conv  # noqa: E402
import generar_rls  # noqa: E402

AQUI = Path(__file__).resolve().parent
USADAS = json.loads((RAIZ / "tests" / "fixtures" / "columnas_usadas.json").read_text(encoding="utf-8"))
ESQUEMA_COMPLETO = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONSULTA = RAIZ / "sql" / "consulta_esquema.sql"
MATRIZ = json.loads((RAIZ / "sql" / "matriz_permisos.json").read_text(encoding="utf-8"))
# La última fila del script de seguridad: tablas_sin_rls | vistas_sin_proteger | anon_con_permisos | politicas | reglas_ajenas_abiertas
# Una política por cada operación (S/I/U/D) que algún rol tenga en la matriz: las tablas «solo agregar» (p. ej. configuracion) tienen menos de 4.
_TABLAS_M, _ROLES_M = generar_rls.cargar()
VERIFICACION_RLS = re.compile(r"^\s*0\s*\|\s*0\s*\|\s*0\s*\|\s*%d\s*\|\s*0\s*$" % generar_rls.total_politicas(_TABLAS_M, _ROLES_M), re.M)


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    c.psql_ok("postgres", "create database plantilla;")
    c.preparar_supabase_falso("plantilla")
    yield c
    c.detener()


def columnas_de(cluster, db):
    filas = cluster.consulta(db, "select table_name, column_name from information_schema.columns where table_schema = 'public' order by 1, 2")
    por_tabla = {}
    for f in filas:
        t, c = f.split("|")
        por_tabla.setdefault(t, set()).add(c)
    return por_tabla


def faltantes(por_tabla):
    """Devuelve (tablas que faltan, columnas requeridas que faltan, columnas opcionales que faltan)."""
    sin_tabla = sorted(set(USADAS["requeridas"]) - set(por_tabla))
    req = sorted(f"{t}.{c}" for t, cols in USADAS["requeridas"].items() if t in por_tabla for c in cols if c not in por_tabla[t])
    opc = sorted(f"{t}.{c}" for t, cols in USADAS["opcionales"].items() if t in por_tabla for c in cols if c not in por_tabla[t])
    return sin_tabla, req, opc


# ── La lógica de la comparación, con el esquema de ejemplo (siempre) ──────────
@pytest.fixture(scope="module")
def ejemplo(cluster):
    cluster.base_nueva("ejemplo", plantilla="plantilla")
    cluster.archivo("ejemplo", AQUI / "esquema_ejemplo.sql")
    return columnas_de(cluster, "ejemplo")


def test_el_ejemplo_cubre_lo_que_usa_el_sistema(ejemplo):
    sin_tabla, req, opc = faltantes(ejemplo)
    assert (sin_tabla, req, opc) == ([], [], [])


def test_la_comparacion_detecta_lo_que_falta(ejemplo):
    sin_columna = {t: set(c) for t, c in ejemplo.items()}
    sin_columna["pedidos"].discard("monto_total")        # requerida
    sin_columna["pedidos"].discard("es_fiar")            # opcional (†)
    del sin_columna["egresos"]                           # una tabla entera
    sin_tabla, req, opc = faltantes(sin_columna)
    assert sin_tabla == ["egresos"] and req == ["pedidos.monto_total"] and opc == ["pedidos.es_fiar"]


def test_la_lista_de_columnas_usadas_es_razonable():
    assert len(USADAS["requeridas"]) == 17 and sum(len(c) for c in USADAS["requeridas"].values()) > 100
    html = (RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html").read_text(encoding="utf-8")
    tablas_respaldo = set(re.findall(r"'(\w+)'", re.search(r"const TABLAS_RESPALDO = \[(.*?)\];", html, re.S).group(1)))
    assert set(USADAS["requeridas"]) == tablas_respaldo
    # Cada columna requerida realmente aparece en el código (que no sea una lista vieja).
    for tabla, columnas in USADAS["requeridas"].items():
        for c in columnas:
            assert re.search(rf"\b{c}\b", html), f"{tabla}.{c} no aparece en el código del sistema"


def test_el_esquema_de_ejemplo_convertido_tambien_cubre_lo_que_usa_el_sistema(cluster, ejemplo):
    """El camino completo: consulta → convertidor → base nueva → comparación."""
    esquema = json.loads(cluster.valor("ejemplo", CONSULTA.read_text(encoding="utf-8")))
    sql, _, _ = conv.generar(esquema)
    cluster.base_nueva("ejemplo_copia", plantilla="plantilla")
    cluster.psql_ok("ejemplo_copia", sql)
    assert faltantes(columnas_de(cluster, "ejemplo_copia")) == ([], [], [])


def test_el_esquema_convertido_funciona_junto_con_las_reglas_de_acceso(cluster):
    """esquema_completo + rls_seguridad = ninguna tabla sin RLS, ninguna vista sin proteger, anon sin permisos."""
    esquema = json.loads(cluster.valor("ejemplo", CONSULTA.read_text(encoding="utf-8")))
    sql, _, _ = conv.generar(esquema)
    cluster.base_nueva("con_reglas", plantilla="plantilla")
    cluster.psql_ok("con_reglas", sql)
    salida = cluster.psql_ok("con_reglas", RLS.read_text(encoding="utf-8"))
    cluster.psql_ok("con_reglas", RLS.read_text(encoding="utf-8"))                      # y repetible
    assert VERIFICACION_RLS.search(salida), salida[-400:]


# ── El archivo real (cuando exista) ───────────────────────────────────────────
@pytest.fixture(scope="module")
def real(cluster):
    if not ESQUEMA_COMPLETO.exists():
        pytest.skip("sql/esquema_completo.sql todavía no existe: se genera con el resultado de sql/consulta_esquema.sql (docs/RESTAURAR.md, Paso 0)")
    cluster.base_nueva("real", plantilla="plantilla")
    cluster.psql_ok("real", ESQUEMA_COMPLETO.read_text(encoding="utf-8"))
    return columnas_de(cluster, "real")


def test_esquema_completo_cubre_las_17_tablas_y_las_columnas_que_usa_el_sistema(real):
    sin_tabla, req, opc = faltantes(real)
    assert sin_tabla == [] and req == [], f"Faltan tablas {sin_tabla} o columnas {req}"
    if opc:
        warnings.warn("Columnas opcionales (†) que el esquema real no tiene (el sistema reintenta sin ellas): " + ", ".join(opc))


def test_esquema_completo_se_puede_aplicar_dos_veces(cluster, real):
    cluster.psql_ok("real", ESQUEMA_COMPLETO.read_text(encoding="utf-8"))
    assert columnas_de(cluster, "real") == real


def test_esquema_completo_funciona_con_las_reglas_de_acceso(cluster, real):
    salida = cluster.psql_ok("real", RLS.read_text(encoding="utf-8"))
    assert VERIFICACION_RLS.search(salida), salida[-400:]
    tablas_de_la_matriz = set(MATRIZ["tablas"])
    assert tablas_de_la_matriz <= set(real), f"La matriz de permisos nombra tablas que el esquema no tiene: {tablas_de_la_matriz - set(real)}"
