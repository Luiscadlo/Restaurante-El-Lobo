"""Pruebas de la consulta de esquema y del convertidor a SQL (herramientas/esquema_a_sql.py).

Idea central, "ida y vuelta" en un Postgres de verdad:
  1. Se arma una base con un esquema de ejemplo (tests/python/esquema_ejemplo.sql) y datos.
  2. Se corre sql/consulta_esquema.sql → JSON.
  3. herramientas/esquema_a_sql.py convierte ese JSON en SQL.
  4. Ese SQL se aplica en una base NUEVA y vacía.
  5. Se vuelve a correr la consulta: el esquema tiene que salir igual (salvo lo que se cambia a propósito).
  6. Se pasan los datos de una a otra como lo hace el respaldo (JSON) y tienen que quedar idénticos.

No toca tu Supabase. Necesita PostgreSQL instalado (si no está, estas pruebas se saltan).
Correr:  python -m pytest tests/python/test_esquema.py -q
"""
import copy
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "herramientas"))
import esquema_a_sql as conv  # noqa: E402
import restaurar_respaldo as rr  # noqa: E402

CONSULTA = RAIZ / "sql" / "consulta_esquema.sql"
EJEMPLO = Path(__file__).resolve().parent / "esquema_ejemplo.sql"

CASOS_RAROS = (Path(__file__).resolve().parent / "esquema_raros.sql").read_text(encoding="utf-8")


def normalizar(esquema, *, igualar_identidad=False):
    """Deja solo lo que debe ser igual entre el origen y la copia."""
    e = copy.deepcopy(esquema)
    for clave in ("generado_en", "postgres", "permisos_de_tabla", "politicas", "extensiones"):
        e.pop(clave, None)
    for t in e["tablas"]:
        t.pop("rls_activo", None)
        t.pop("rls_forzado", None)
    for s in e["secuencias"]:
        s.pop("ultimo_valor", None)
    if igualar_identidad:   # «identity ALWAYS» se vuelve «BY DEFAULT» a propósito
        for c in e["columnas"]:
            if c["identidad"] == "a":
                c["identidad"] = "d"
    return {k: v for k, v in sorted(e.items())}


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    c.psql_ok("postgres", "create database plantilla;")
    c.preparar_supabase_falso("plantilla")
    yield c
    c.detener()


def consultar_esquema(cluster, db):
    texto = cluster.valor(db, CONSULTA.read_text(encoding="utf-8"))
    return json.loads(texto)


@pytest.fixture(scope="module")
def origen(cluster):
    cluster.base_nueva("origen", plantilla="plantilla")
    cluster.archivo("origen", EJEMPLO)
    return consultar_esquema(cluster, "origen")


@pytest.fixture(scope="module")
def copia(cluster, origen):
    sql, avisos, _ = conv.generar(origen)
    cluster.base_nueva("copia", plantilla="plantilla")
    cluster.psql_ok("copia", sql)
    return {"sql": sql, "avisos": avisos, "esquema": consultar_esquema(cluster, "copia")}


# ── La consulta ───────────────────────────────────────────────────────────────
def test_la_consulta_es_de_solo_lectura(cluster, origen):
    texto = CONSULTA.read_text(encoding="utf-8")
    sin_comentarios = "\n".join(l.split("--")[0] for l in texto.splitlines())
    for palabra in ("insert", "update", "delete", "drop", "alter", "truncate", "grant", "revoke", "create "):
        assert not re.search(rf"\b{palabra}\b", sin_comentarios, re.I), f"la consulta no debería contener «{palabra}»"
    # Y la base la acepta dentro de una transacción de solo lectura.
    codigo, _, avisos = cluster.psql("origen", "begin read only;\n" + texto + "\ncommit;")
    assert codigo == 0, avisos


def test_la_consulta_devuelve_una_sola_celda_con_json(cluster):
    texto = CONSULTA.read_text(encoding="utf-8")
    assert texto.count(" as esquema") == 1
    assert isinstance(json.loads(cluster.valor("origen", texto)), dict)


def test_la_consulta_no_trae_datos(origen):
    texto = json.dumps(origen)
    for dato in ("Doña Marta", "Don Pedro", "Mojarra", "Sancocho"):
        assert dato not in texto


def test_la_consulta_ve_todo_lo_importante(origen):
    assert {t["nombre"] for t in origen["tablas"] if t["tipo"] == "r"} >= {"pedidos", "config", "egresos", "clientes_fiado"}
    assert [t["nombre"] for t in origen["tablas"] if t["tipo"] == "v"] == ["ventas_por_dia"]
    assert {k["tipo"] for k in origen["restricciones"]} >= {"p", "u", "c", "f"}
    assert origen["tipos_enum"][0]["valores"] == ["pendiente", "pagado"]
    assert origen["dominios"][0]["nombre"] == "monto_cop"
    assert origen["funciones"][0]["nombre"] == "marcar_actualizado"
    assert origen["disparadores"][0]["nombre"] == "config_actualizado"
    seq = {s["nombre"]: s for s in origen["secuencias"]}
    assert seq["pedidos_id_seq"]["tabla"] == "pedidos" and seq["pedidos_id_seq"]["vinculo"] == "a"
    assert seq["clientes_fiado_id_seq"]["vinculo"] == "i"
    assert seq["consecutivo_suelto"]["tabla"] is None


# ── Ida y vuelta ──────────────────────────────────────────────────────────────
def test_la_copia_tiene_el_mismo_esquema(origen, copia):
    a, b = normalizar(origen, igualar_identidad=True), normalizar(copia["esquema"])
    for clave in a:
        assert a[clave] == b[clave], f"Difiere «{clave}»:\norigen: {json.dumps(a[clave], ensure_ascii=False)[:1500]}\ncopia:  {json.dumps(b[clave], ensure_ascii=False)[:1500]}"


def test_los_serial_normales_se_escriben_como_serial(copia):
    sql = copia["sql"]
    assert "  id bigserial,\n" in sql and "create sequence if not exists public.pedidos_id_seq" not in sql
    assert "create sequence if not exists public.consecutivo_suelto" in sql          # la suelta sí se crea


def test_la_copia_queda_cerrada_y_sin_las_reglas_viejas(origen, copia):
    assert any(p["nombre"] == "todo abierto" for p in origen["politicas"])
    assert copia["esquema"]["politicas"] == []
    reales = [t for t in copia["esquema"]["tablas"] if t["tipo"] == "r"]
    assert reales and all(t["rls_activo"] for t in reales)
    assert any("NO se copiaron" in a for a in copia["avisos"])


def test_identity_always_pasa_a_by_default_con_aviso(origen, copia):
    antes = {(c["tabla"], c["nombre"]) for c in origen["columnas"] if c["identidad"] == "a"}
    assert antes == {("abonos_fiado", "id"), ("notas_dia", "id")}
    despues = {(c["tabla"], c["nombre"]) for c in copia["esquema"]["columnas"] if c["identidad"] == "d"}
    assert antes <= despues
    assert sum("identity ALWAYS" in a for a in copia["avisos"]) == 2


def test_el_sql_se_puede_correr_dos_veces(cluster, origen, copia):
    cluster.psql_ok("copia", copia["sql"])
    assert normalizar(consultar_esquema(cluster, "copia")) == normalizar(copia["esquema"])


def test_la_verificacion_final_da_lo_esperado(cluster, copia):
    consulta_final = copia["sql"].split("-- 12 ·")[1].split("\n", 1)[1]
    fila = cluster.consulta("copia", consulta_final)[0].split("|")
    real_esperado = [(int(fila[i]), int(fila[i + 1])) for i in range(0, len(fila), 2)]
    assert all(real == esperado for real, esperado in real_esperado), fila
    assert real_esperado[0][0] == 16


def test_los_datos_pasan_identicos_como_json(cluster, origen, copia):
    """Mismo camino que el respaldo: filas como JSON → json_populate_recordset (lo que hace PostgREST)."""
    tablas, _ = rr.orden_por_llaves([t["nombre"] for t in origen["tablas"] if t["tipo"] == "r"], origen["restricciones"])   # padres antes que hijos
    for t in tablas:
        volcado = cluster.valor("origen", f"select coalesce(json_agg(x order by to_json(x)::text), '[]') from public.{conv.qi(t)} x")
        cluster.psql_ok("copia", f"insert into public.{conv.qi(t)} select * from json_populate_recordset(null::public.{conv.qi(t)}, $json${volcado}$json$::json);")
        vuelta = cluster.valor("copia", f"select coalesce(json_agg(x order by to_json(x)::text), '[]') from public.{conv.qi(t)} x")
        assert json.loads(vuelta) == json.loads(volcado), f"Los datos de «{t}» no quedaron idénticos"
    assert sum(len(json.loads(cluster.valor("copia", f"select coalesce(json_agg(x), '[]') from public.{t} x"))) for t in tablas) >= 10


def test_despues_de_restaurar_los_numeros_automaticos_siguen(cluster, origen):
    """Tras cargar con id propios, hay que subir los contadores: el SQL que imprime el script de restauración lo hace."""
    tablas = {t["nombre"]: json.loads(cluster.valor("copia", f"select coalesce(json_agg(x), '[]') from public.{conv.qi(t['nombre'])} x"))
              for t in origen["tablas"] if t["tipo"] == "r"}
    sql = rr.sql_secuencias(rr.Respaldo(tablas, "exportar", None, []))
    assert "pedidos" in sql and "abonos_fiado" in sql and "notas_dia" in sql      # serial, identidad por defecto y la que era «ALWAYS»
    cluster.psql_ok("copia", sql)
    cluster.psql_ok("copia", "insert into public.pedidos (fecha, monto_total) values ('2026-10-05', 1);"
                             "insert into public.abonos_fiado (fecha, cliente_fiado_id, monto) values ('2026-10-05', 1, 100);"
                             "insert into public.notas_dia (fecha, texto) values ('2026-10-05', 'x');")
    assert cluster.valor("copia", "select count(*) from public.pedidos") == "3"


# ── Casos raros, aplicados a un Postgres de verdad ────────────────────────────
@pytest.fixture(scope="module")
def raros(cluster):
    cluster.base_nueva("raros_a", plantilla="plantilla")
    cluster.psql_ok("raros_a", CASOS_RAROS)
    esquema = consultar_esquema(cluster, "raros_a")
    sql, avisos, _ = conv.generar(esquema)
    cluster.base_nueva("raros_b", plantilla="plantilla")
    cluster.psql_ok("raros_b", "create publication pub_prueba;")  # la publicación existe en un proyecto nuevo (Realtime)
    cluster.psql_ok("raros_b", sql)
    return {"a": esquema, "b": consultar_esquema(cluster, "raros_b"), "sql": sql, "avisos": avisos}


def test_casos_raros_ida_y_vuelta(raros):
    a, b = normalizar(raros["a"], igualar_identidad=True), normalizar(raros["b"])
    # Lo que no se copia a propósito: la tabla particionada y la vista materializada.
    a["tablas"] = [t for t in a["tablas"] if t["tipo"] in ("r", "v")]
    b["tablas"] = [t for t in b["tablas"] if t["tipo"] in ("r", "v")]
    a["tablas"] = [t for t in a["tablas"] if t["nombre"] != "particionada"]
    nombres_a = {t["nombre"] for t in a["tablas"]}
    for lista in ("columnas", "restricciones", "indices"):
        a[lista] = [x for x in a[lista] if x["tabla"] in nombres_a]
        b[lista] = [x for x in b[lista] if x["tabla"] in nombres_a]
    assert a["tablas"] == b["tablas"]
    for clave in ("columnas", "restricciones", "indices", "funciones", "tipos_enum", "dominios"):
        assert a[clave] == b[clave], clave


def test_casos_raros_avisos(raros):
    avisos = " | ".join(raros["avisos"])
    assert "particionada" in avisos and "vista materializada" in avisos
    assert "SECURITY DEFINER" in avisos and "peligrosa" in avisos


def test_casos_raros_detalles_del_sql(raros):
    sql = raros["sql"]
    assert 'create table if not exists public."order"' in sql and '"desc" integer generated by default as identity' in sql
    assert "start with 1000 increment by 10" in sql
    assert "owned by public.serial_renombrado.id" in sql                    # serial con secuencia de otro nombre
    assert "generated always as ((id * 2)) stored" in sql
    assert "'Tabla con nombre reservado y una ''comilla'''" in sql
    assert "with (security_invoker=true, security_barrier=true)" in sql
    assert "alter publication pub_prueba add table public.identidad_con_inicio" in sql
    assert "serial_dato_unico" in sql and "IF NOT EXISTS serial_dato_unico" in sql


# ── Lectura tolerante del resultado ───────────────────────────────────────────
@pytest.fixture(scope="module")
def mini():
    return {"tablas": [{"nombre": "t", "tipo": "r"}], "columnas": [{"tabla": "t", "posicion": 1, "nombre": "id", "tipo": "integer", "obligatoria": True}],
            "restricciones": []}


@pytest.mark.parametrize("forma", ["crudo", "bom", "texto_entre_comillas", "lista_con_texto", "lista_con_objeto", "csv"])
def test_se_aceptan_las_formas_de_copiar_el_resultado(mini, forma):
    pretty = json.dumps(mini, indent=2)
    texto = {
        "crudo": pretty,
        "bom": "﻿" + pretty,
        "texto_entre_comillas": json.dumps(pretty),
        "lista_con_texto": json.dumps([{"esquema": pretty}]),
        "lista_con_objeto": json.dumps([{"esquema": mini}]),
        "csv": 'esquema\n"' + pretty.replace('"', '""') + '"\n',
    }[forma]
    assert conv.cargar_esquema(texto)["tablas"][0]["nombre"] == "t"


@pytest.mark.parametrize("texto,fragmento", [
    ("", "vacío"),
    ("hola", "No reconozco"),
    ('{"tablas": [', "No reconozco"),                                    # copiado a medias
    (json.dumps({"tablas": [], "columnas": [], "restricciones": []}), "ninguna tabla"),
    (json.dumps({"tablas": [{"nombre": "t", "tipo": "r"}], "columnas": []}), "restricciones"),
])
def test_resultados_malos_dan_un_mensaje_claro(texto, fragmento):
    with pytest.raises(conv.EsquemaInvalido, match=fragmento):
        conv.cargar_esquema(texto)


def test_restricciones_raras_y_not_null_de_postgres_17(mini):
    e = copy.deepcopy(mini)
    e["restricciones"] = [
        {"tabla": "t", "nombre": "t_id_not_null", "tipo": "n", "definicion": "NOT NULL id", "tabla_referida": None},
        {"tabla": "t", "nombre": "t_pkey", "tipo": "p", "definicion": "PRIMARY KEY (id)", "tabla_referida": None},
    ]
    sql, avisos, _ = conv.generar(e)
    assert "t_pkey" in sql and "t_id_not_null" not in sql
    assert not any("t_id_not_null" in a for a in avisos)


def test_identificadores_y_literales():
    assert conv.qi("pedidos") == "pedidos" and conv.qi("order") == '"order"' and conv.qi("Mayúsc") == '"Mayúsc"'
    assert conv.qi('a"b') == '"a""b"' and conv.qi("1abc") == '"1abc"'
    assert conv.lit("o'k") == "'o''k'"


def test_la_herramienta_por_linea_de_comandos(tmp_path, origen):
    import subprocess
    entrada, salida = tmp_path / "e.json", tmp_path / "s.sql"
    entrada.write_text(json.dumps(origen), encoding="utf-8")
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "esquema_a_sql.py"), str(entrada), "-o", str(salida)], capture_output=True, text=True)
    assert r.returncode == 0 and salida.read_text(encoding="utf-8").startswith("-- ═")
    malo = tmp_path / "malo.json"
    malo.write_text("no es json", encoding="utf-8")
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "esquema_a_sql.py"), str(malo)], capture_output=True, text=True)
    assert r.returncode == 2 and "No reconozco" in r.stderr
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "esquema_a_sql.py"), str(tmp_path / "nada.json")], capture_output=True, text=True)
    assert r.returncode == 2 and "No pude leer" in r.stderr
