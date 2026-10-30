"""Ensayo de restauración sobre el ESQUEMA REAL de producción, con los datos de ejemplo de las pruebas del sistema.

Qué comprueba (todo en un Postgres desechable, nunca en Supabase):
  1. Que los datos de ejemplo del sistema (tests/fixtures/datos.js, los mismos de las pruebas de pantalla) caben
     en las tablas reales: mismos nombres de columna, tipos, columnas obligatorias y llaves foráneas. Si una
     prueba "inventa" una columna que la base real no tiene, aquí se nota. Se cargan fila por fila, como las
     escribe el sistema (solo las columnas que trae cada fila; el resto lo completa la base con sus valores por
     defecto), y de esa base sale el respaldo, igual que en producción.
  2. Que ese respaldo se convierte en SQL (herramientas/respaldo_a_sql.py), se aplica sobre una base recién
     creada con sql/esquema_completo.sql y queda IDÉNTICO (tabla por tabla, fila por fila).
  3. Que se puede repetir: de la base restaurada se saca otro respaldo, se restaura en otra base nueva y sigue
     idéntico (nada se pierde ni se deforma en el camino).
  4. Que los contadores (ids automáticos) quedan listos: un pedido nuevo no choca con los restaurados.

  · Si sql/esquema_completo.sql no existe todavía, o falta `node`, el ensayo se salta solo y dice por qué.

Correr:  python -m pytest tests/python/test_ensayo_esquema_real.py -q   (necesita PostgreSQL y Node; si no, se salta)
"""
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "herramientas"))
import esquema_a_sql as conv  # noqa: E402
import respaldo_a_sql as r2s  # noqa: E402
import restaurar_respaldo as rr  # noqa: E402

ESQUEMA_COMPLETO = RAIZ / "sql" / "esquema_completo.sql"
CONSULTA = RAIZ / "sql" / "consulta_esquema.sql"
DATOS_JS = RAIZ / "tests" / "fixtures" / "datos.js"

pytestmark = [
    pytest.mark.skipif(not ESQUEMA_COMPLETO.exists(), reason="Todavía no existe sql/esquema_completo.sql (se genera con el resultado de sql/consulta_esquema.sql)"),
    pytest.mark.skipif(shutil.which("node") is None, reason="Falta Node.js para leer los datos de ejemplo"),
]


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    c.psql_ok("postgres", "create database plantilla;")
    c.preparar_supabase_falso("plantilla")
    yield c
    c.detener()


def esquema_de(cluster, db):
    return json.loads(cluster.valor(db, CONSULTA.read_text(encoding="utf-8")))


def volcar_base(cluster, db, tablas):
    """Como lo hace el sistema: cada tabla como una lista JSON de filas."""
    return {t: rr._cargar_json(cluster.valor(db, f"select coalesce(json_agg(x order by to_json(x)::text), '[]') from public.{conv.qi(t)} x")) for t in tablas}


def datos_de_ejemplo():
    salida = subprocess.run(
        ["node", "-e", "process.stdout.write(JSON.stringify(require('./tests/fixtures/datos.js').datos))"],
        cwd=RAIZ, capture_output=True, text=True, check=True, encoding="utf-8")
    return json.loads(salida.stdout)


def escribir_respaldo(carpeta, nombre, tablas):
    ruta = carpeta / nombre
    ruta.write_text(rr.volcar({"version": 1, "generado_en": "2026-10-20T03:00:00.000Z", "fecha": "2026-10-20",
                               "conteos": {t: len(f) for t, f in tablas.items()}, "tablas": tablas}), encoding="utf-8")
    return ruta


def restaurar(cluster, db, respaldo, carpeta, subcarpeta):
    """Genera los .sql del respaldo y los pega en orden en la base `db` (nueva, con el esquema real)."""
    esquema = esquema_de(cluster, db)
    leido = rr.leer_respaldo(respaldo)
    orden, _ = rr.orden_por_llaves(list(leido.tablas), esquema["restricciones"])
    textos = r2s.generar(leido, orden)
    final = ""
    for k, t in enumerate(textos, 1):
        ruta = carpeta / f"{subcarpeta}_{k}.sql"
        ruta.write_text(t, encoding="utf-8")
        codigo, salida, avisos = cluster.psql(db, t)
        assert codigo == 0, f"{ruta.name} falló sobre el esquema real:\n{avisos}"
        final = salida
    return final


def cargar_como_el_sistema(cluster, db, datos):
    """Inserta cada fila con SOLO sus columnas (el sistema no manda las que no tiene), en orden de llaves."""
    esquema = esquema_de(cluster, db)
    orden, _ = rr.orden_por_llaves(list(datos), esquema["restricciones"])
    for t in orden:
        for fila in datos[t]:
            for sentencia in r2s.sentencias_de_tabla(t, [fila]):
                codigo, _, avisos = cluster.psql(db, sentencia)
                assert codigo == 0, f"La fila de ejemplo de «{t}» no cabe en la tabla real:\n{fila}\n{avisos}"


@pytest.fixture(scope="module")
def mundo(cluster, tmp_path_factory):
    carpeta = tmp_path_factory.mktemp("ensayo_real")
    datos = datos_de_ejemplo()
    cluster.base_nueva("real_0", plantilla="plantilla")
    cluster.archivo("real_0", ESQUEMA_COMPLETO)
    cargar_como_el_sistema(cluster, "real_0", datos)
    reales = [t["nombre"] for t in esquema_de(cluster, "real_0")["tablas"] if t["tipo"] == "r"]
    respaldo_real = volcar_base(cluster, "real_0", sorted(datos))     # lo que exportaría el sistema
    respaldo = escribir_respaldo(carpeta, "ElLobo_respaldo_completo_ejemplo.json", respaldo_real)
    cluster.base_nueva("real_1", plantilla="plantilla")
    cluster.archivo("real_1", ESQUEMA_COMPLETO)
    final = restaurar(cluster, "real_1", respaldo, carpeta, "uno")
    return {"carpeta": carpeta, "datos": datos, "respaldo_real": respaldo_real, "final": final, "reales": reales}


def test_los_datos_de_ejemplo_son_las_17_tablas_que_respalda_el_sistema(mundo):
    assert sorted(mundo["datos"]) == sorted(rr.TABLAS_CONOCIDAS)


def test_cada_fila_de_ejemplo_entra_en_el_esquema_real(cluster, mundo):
    contados = {t: int(cluster.valor("real_0", f"select count(*) from public.{conv.qi(t)}")) for t in mundo["datos"]}
    assert contados == {t: len(f) for t, f in mundo["datos"].items()}
    assert sum(1 for f in mundo["datos"].values() if f) >= 10   # el ejemplo ejercita casi todas las tablas


def test_la_restauracion_sobre_el_esquema_real_dice_ok(cluster, mundo):
    assert "DIFERENTE" not in mundo["final"] and mundo["final"].count("OK") >= len(mundo["datos"])


def test_se_restaura_idéntico_en_una_base_nueva(cluster, mundo):
    assert volcar_base(cluster, "real_1", sorted(mundo["datos"])) == mundo["respaldo_real"]


def test_se_puede_repetir_sobre_lo_restaurado(cluster, mundo):
    primera = volcar_base(cluster, "real_1", sorted(mundo["datos"]))
    segundo = escribir_respaldo(mundo["carpeta"], "ElLobo_respaldo_completo_segundo.json", primera)
    cluster.base_nueva("real_2", plantilla="plantilla")
    cluster.archivo("real_2", ESQUEMA_COMPLETO)
    final = restaurar(cluster, "real_2", segundo, mundo["carpeta"], "dos")
    assert "DIFERENTE" not in final
    assert volcar_base(cluster, "real_2", sorted(mundo["datos"])) == primera


def test_los_contadores_quedan_listos_para_los_pedidos_nuevos(cluster, mundo):
    antes = int(cluster.valor("real_1", "select count(*) from public.pedidos"))
    cluster.psql_ok("real_1", "insert into public.pedidos (fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total) "
                              "values ('2026-10-21', '12:00', 'almuerzo', 'Completo', 1, 1, 1);")
    assert int(cluster.valor("real_1", "select count(*) from public.pedidos")) == antes + 1
