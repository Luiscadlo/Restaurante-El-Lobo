"""Pruebas del generador de SQL para restaurar (herramientas/respaldo_a_sql.py) contra un Postgres de verdad.

Se arma una base de origen con datos (incluidos textos difíciles: comillas, $$, barras, tildes, emojis), se
saca el respaldo como lo hace el sistema, se generan los archivos .sql, se aplican UNO TRAS OTRO en una base
nueva y vacía —exactamente lo que haría la persona en el SQL Editor de Supabase— y se compara todo.

Correr:  python -m pytest tests/python/test_respaldo_a_sql.py -q   (necesita PostgreSQL; si no, se salta)
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

AQUI = Path(__file__).resolve().parent
CONSULTA = RAIZ / "sql" / "consulta_esquema.sql"
TEXTO_DIFICIL = "Línea 1\nLínea 2 con 'comillas', \"dobles\", $$ dólares $$, $lobo$ marca $lobo$, barra \\ y \\n, tilde ñ, emoji 😀, tab\t."


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


@pytest.fixture(scope="module")
def mundo(cluster, tmp_path_factory):
    cluster.base_nueva("origen", plantilla="plantilla")
    cluster.archivo("origen", AQUI / "esquema_ejemplo.sql")
    cluster.psql_ok("origen", f"insert into public.notas_dia (fecha, texto) values ('2026-10-02', $x${TEXTO_DIFICIL}$x$);")
    esquema = esquema_de(cluster, "origen")
    sql_esquema, _, _ = conv.generar(esquema)
    reales = [t["nombre"] for t in esquema["tablas"] if t["tipo"] == "r"]
    datos = volcar_base(cluster, "origen", reales)
    carpeta = tmp_path_factory.mktemp("restauracion")
    respaldo = carpeta / "ElLobo_respaldo_completo_2026-10-03.json"
    respaldo.write_text(rr.volcar({"version": 1, "generado_en": "2026-10-04T03:00:00.000Z", "fecha": "2026-10-03",
                                   "conteos": {t: len(f) for t, f in datos.items()}, "tablas": datos}), encoding="utf-8")
    return {"esquema": esquema, "sql_esquema": sql_esquema, "reales": reales, "datos": datos, "respaldo": respaldo, "carpeta": carpeta}


def destino_nuevo(cluster, mundo, nombre):
    cluster.base_nueva(nombre, plantilla="plantilla")
    cluster.psql_ok(nombre, mundo["sql_esquema"])
    return nombre


def generar_archivos(mundo, subcarpeta, *extra):
    salida = io.StringIO()
    codigo = r2s.principal([str(mundo["respaldo"]), "-o", str(mundo["carpeta"] / subcarpeta), *extra], salida=salida)
    assert codigo == 0, salida.getvalue()
    return sorted((mundo["carpeta"] / subcarpeta).glob("ElLobo_restaurar_*.sql")), salida.getvalue()


def aplicar(cluster, db, archivos):
    """Pega cada archivo en orden, como en el SQL Editor. Devuelve la salida del último."""
    ultima = ""
    for a in archivos:
        codigo, salida, avisos = cluster.psql(db, a.read_text(encoding="utf-8"))
        assert codigo == 0, f"{a.name} falló:\n{avisos}"
        ultima = salida
    return ultima


def contar(cluster, db, reales):
    return {t: int(cluster.valor(db, f"select count(*) from public.{conv.qi(t)}")) for t in reales}


# ── Camino feliz ──────────────────────────────────────────────────────────────
def test_restaura_todo_idéntico_y_la_comprobacion_dice_ok(cluster, mundo):
    db = destino_nuevo(cluster, mundo, "dest_feliz")
    archivos, texto = generar_archivos(mundo, "feliz")
    assert len(archivos) == 1 and "Listo: 1 archivo(s)" in texto
    final = aplicar(cluster, db, archivos)
    assert "DIFERENTE" not in final and final.count("OK") >= len(mundo["reales"])
    assert volcar_base(cluster, db, mundo["reales"]) == mundo["datos"]
    assert any(TEXTO_DIFICIL in (f.get("texto") or "") for f in volcar_base(cluster, db, ["notas_dia"])["notas_dia"])


def test_los_contadores_quedan_listos_para_los_pedidos_nuevos(cluster, mundo):
    db = "dest_feliz"
    cluster.psql_ok(db, "insert into public.pedidos (fecha, monto_total) values ('2026-10-09', 1);"
                        "insert into public.abonos_fiado (fecha, cliente_fiado_id, monto) values ('2026-10-09', 1, 1);"
                        "insert into public.notas_dia (fecha, texto) values ('2026-10-09', 'nueva');")
    assert contar(cluster, db, ["pedidos"])["pedidos"] == len(mundo["datos"]["pedidos"]) + 1


def test_varios_archivos_se_aplican_en_orden_y_dan_lo_mismo(cluster, mundo):
    db = destino_nuevo(cluster, mundo, "dest_varios")
    respaldo = rr.leer_respaldo(mundo["respaldo"])
    orden, _ = rr.orden_por_llaves(list(respaldo.tablas), mundo["esquema"]["restricciones"])
    textos = r2s.generar(respaldo, orden, max_bytes=1500)
    assert len(textos) >= 3
    assert "El destino NO está vacío" in textos[0] and all("El destino NO está vacío" not in t for t in textos[1:])
    assert all(t.rstrip().startswith("-- ═") and "begin;" in t and "commit;" in t for t in textos)
    assert "Archivo 1 de" in textos[0] and f"Archivo {len(textos)} de {len(textos)}" in textos[-1]
    assert "setval" in textos[-1] and all("setval" not in t for t in textos[:-1])
    archivos = []
    for k, t in enumerate(textos, 1):
        ruta = mundo["carpeta"] / f"varios_{k}.sql"
        ruta.write_text(t, encoding="utf-8")
        archivos.append(ruta)
    final = aplicar(cluster, db, archivos)
    assert "DIFERENTE" not in final
    assert volcar_base(cluster, db, mundo["reales"]) == mundo["datos"]


# ── Seguridad ─────────────────────────────────────────────────────────────────
def test_la_comprobacion_final_avisa_si_algo_no_cuadra(cluster, mundo):
    db = destino_nuevo(cluster, mundo, "dest_comprobacion")
    archivos, _ = generar_archivos(mundo, "comprobacion")
    aplicar(cluster, db, archivos)
    comprobacion = archivos[-1].read_text(encoding="utf-8").split("-- Comprobación")[1].split("\n", 1)[1]
    assert all(f.endswith("|OK") for f in cluster.consulta(db, comprobacion))
    cluster.psql_ok(db, "delete from public.egresos where id = (select min(id) from public.egresos);")
    filas = cluster.consulta(db, comprobacion)
    assert [f for f in filas if f.endswith("|DIFERENTE")] == ["egresos|0|1|DIFERENTE"]


def test_se_niega_si_el_destino_ya_tiene_datos_y_no_cambia_nada(cluster, mundo):
    db = "dest_feliz"
    antes = contar(cluster, db, mundo["reales"])
    archivos, _ = generar_archivos(mundo, "repetido")
    codigo, _, avisos = cluster.psql(db, archivos[0].read_text(encoding="utf-8"))
    assert codigo != 0 and "El destino NO está vacío" in avisos
    assert contar(cluster, db, mundo["reales"]) == antes


def test_un_archivo_que_falla_no_deja_nada_a_medias(cluster, mundo):
    """Si algo falla a mitad del archivo (aquí, una llave foránea rota), todo el archivo se deshace."""
    datos = json.loads(rr.volcar(mundo["datos"]))                                              # copia
    datos["clientes_fiado"] = [c for c in datos["clientes_fiado"] if c["id"] != 1]            # el cliente 1 desaparece, pero un pedido y un abono lo usan
    roto = mundo["carpeta"] / "roto.json"
    roto.write_text(json.dumps({"tablas": datos}), encoding="utf-8")
    salida = io.StringIO()
    assert r2s.principal([str(roto), "-o", str(mundo["carpeta"] / "roto")], salida=salida) == 0
    db = destino_nuevo(cluster, mundo, "dest_roto")
    codigo, _, avisos = cluster.psql(db, next((mundo["carpeta"] / "roto").glob("*.sql")).read_text(encoding="utf-8"))
    assert codigo != 0 and "violates foreign key" in avisos
    assert sum(contar(cluster, db, mundo["reales"]).values()) == 0


def test_se_niega_a_escribir_dentro_del_repositorio(tmp_path, mundo):
    destino = RAIZ / "tests" / "no_debe_existir_restauracion"
    salida = io.StringIO()
    try:
        assert r2s.principal([str(mundo["respaldo"]), "-o", str(destino)], salida=salida) == 2
        assert "dentro del repositorio" in salida.getvalue() and not destino.exists()
    finally:
        shutil.rmtree(destino, ignore_errors=True)      # si la guardia fallara, que al menos no deje datos dentro del repo


def test_rechaza_respaldos_danados_igual_que_el_otro_script(tmp_path):
    malo = tmp_path / "malo.json"
    malo.write_text('{"tablas": {"pedidos": [', encoding="utf-8")
    salida = io.StringIO()
    assert r2s.principal([str(malo), "-o", str(tmp_path / "s")], salida=salida) == 3
    assert "NO SE HIZO NADA" in salida.getvalue() and not (tmp_path / "s").exists()


def test_los_archivos_con_datos_reales_estan_ignorados_por_git():
    if not shutil.which("git"):
        pytest.skip("git no está instalado")
    r = subprocess.run(["git", "check-ignore", "-q", "ElLobo_restaurar_01_de_01.sql"], cwd=RAIZ)
    assert r.returncode == 0, "falta ElLobo_restaurar_*.sql en .gitignore"


# ── Detalles ──────────────────────────────────────────────────────────────────
def test_una_tabla_grande_se_reparte_en_varias_sentencias():
    filas = [{"id": i, "texto": "x" * 40} for i in range(1, 41)]
    sentencias = r2s.sentencias_de_tabla("notas_dia", filas, max_bytes=1200)
    assert len(sentencias) >= 3 and all(len(s.encode("utf-8")) <= 1200 for s in sentencias)
    assert sum(s.count('{"id":') for s in sentencias) == 40
    # Una fila que por sí sola pasa del máximo igual se envía (sola), sin perderse.
    una = r2s.sentencias_de_tabla("notas_dia", [{"id": 1, "texto": "y" * 5000}], max_bytes=1200)
    assert len(una) == 1 and "y" * 5000 in una[0]


def test_los_numeros_viajan_exactos_en_el_sql():
    import decimal
    D = decimal.Decimal
    sql = r2s.sentencias_de_tabla("config", [{"clave": "k", "valor": {"a": D("0.10"), "b": [D("12345678901234567.89")]}, "monto": D("12345678901234567.89")}])[0]
    assert '"monto":12345678901234567.89' in sql and '"a":0.10' in sql and "[12345678901234567.89]" in sql


def test_la_marca_de_comillas_nunca_choca_con_los_datos():
    assert r2s._etiqueta("nada especial") == "$lobo$"
    assert r2s._etiqueta("trae $lobo$ adentro") == "$lobo1$"
    assert r2s._etiqueta("trae $lobo$ y $lobo1$") == "$lobo2$"


def test_las_columnas_calculadas_se_omiten_y_la_base_las_calcula(cluster, tmp_path):
    cluster.base_nueva("raros_a", plantilla="plantilla")
    cluster.psql_ok("raros_a", (AQUI / "esquema_raros.sql").read_text(encoding="utf-8"))
    esquema = esquema_de(cluster, "raros_a")
    esquema_json = tmp_path / "esquema.json"
    esquema_json.write_text(json.dumps(esquema), encoding="utf-8")
    sql, _, _ = conv.generar(esquema)
    cluster.base_nueva("raros_b", plantilla="plantilla")
    cluster.psql_ok("raros_b", "create publication pub_prueba;")
    cluster.psql_ok("raros_b", sql)
    respaldo = tmp_path / "r.json"
    respaldo.write_text(json.dumps({"tablas": {"serial_renombrado": [{"id": 7, "area": 14, "dato": "x"}, {"id": 9, "area": 18, "dato": None}],
                                                "order": [{"desc": 1, "user": "u", "Mayúsc": "M"}]}}), encoding="utf-8")
    salida = io.StringIO()
    assert r2s.principal([str(respaldo), "-o", str(tmp_path / "salida"), "--esquema", str(esquema_json)], salida=salida) == 0, salida.getvalue()
    archivos = sorted((tmp_path / "salida").glob("*.sql"))
    assert "area" not in "".join(a.read_text(encoding="utf-8") for a in archivos).split("insert into public.serial_renombrado")[1].split(";")[0].split("select")[0]
    aplicar(cluster, "raros_b", archivos)
    assert cluster.consulta("raros_b", 'select id, area from public.serial_renombrado order by id') == ["7|14", "9|18"]
    assert cluster.consulta("raros_b", 'select "desc", "user", "Mayúsc" from public."order"') == ["1|u|M"]
    cluster.psql_ok("raros_b", "insert into public.serial_renombrado (dato) values ('nuevo');")
    assert cluster.valor("raros_b", "select max(id) from public.serial_renombrado") == "10"


def test_linea_de_comandos(tmp_path, mundo):
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "respaldo_a_sql.py"), str(mundo["respaldo"]), "-o", str(tmp_path / "cli")], capture_output=True, text=True)
    assert r.returncode == 0 and "ElLobo_restaurar_01_de_01.sql" in r.stdout
    assert (tmp_path / "cli" / "ElLobo_restaurar_01_de_01.sql").exists()
