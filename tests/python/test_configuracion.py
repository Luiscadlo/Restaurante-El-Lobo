"""Pruebas de la CONFIGURACIÓN EDITABLE (sql/configuracion.sql) contra un Postgres de verdad.

Se arma una base desechable que imita a Supabase (roles anon / authenticated / service_role, auth.jwt()), con el ESQUEMA
REAL de El Lobo (sql/esquema_completo.sql) y las reglas de acceso (sql/rls_seguridad.sql); nunca toca tu Supabase.
Qué comprueban:
  · Cada cambio es UNA fila nueva que la base sella sola: «vigente desde» = ahora, quién lo hizo = su correo.
    Nadie puede escribir un cambio con fecha pasada para reescribir la historia (lo que mande el sistema se ignora).
  · La base rechaza claves que no existen y valores fuera de rango o de otro tipo (mesas = -3, nombre vacío…), y deja
    pasar los extremos válidos.
  · Solo se agrega: nadie —ni el administrador— modifica o borra una fila por la API; y aunque alguien abriera una
    política por error, el disparador lo rechazaría.
  · Permisos por rol (los de sql/matriz_permisos.json): admin lee y agrega; caja y respaldo solo leen; un token sin rol
    y la llave pública, nada.
  · La restauración (llave de servicio / usuario de la base) devuelve la historia tal cual venía, sin sellarla de nuevo.
  · Instalar sobre una base nueva y sobre una que ya estaba en producción da exactamente lo mismo; correrlo dos veces
    no rompe nada ni pierde el historial; el rollback lo quita por completo y se puede volver a instalar.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_configuracion.py -q
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONFIG = RAIZ / "sql" / "configuracion.sql"
ROLLBACK = RAIZ / "sql" / "rollback_configuracion.sql"

pytestmark = pytest.mark.skipif(not (ESQUEMA.exists() and CONFIG.exists()), reason="Falta el SQL")
_n = [0]


def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


def llamar(cluster, db, rol, sentencia, correo=None, rol_pg="authenticated", claims=None):
    """Corre UNA sentencia como ese rol (con su token) en una transacción que se confirma si sale bien.
    Devuelve ('ok', json) o ('error', sqlstate, detalle, mensaje). La sentencia debe terminar devolviendo un texto JSON."""
    if claims is None:
        claims = {"role": rol_pg, "app_metadata": ({"rol": rol} if rol else {})}
        claims["email"] = correo if correo is not None else f"{rol or 'nadie'}@elobo.test"
    guion = ("\\set VERBOSITY verbose\nbegin;\n"
             f"do $c$ begin perform set_config('request.jwt.claims', {lit(json.dumps(claims))}, true); end $c$;\n"
             f"set local role {rol_pg};\n" + sentencia + "\ncommit;\n")
    cmd = cluster.prefijo + [cluster.psql_bin, "-X", "-q", "-A", "-t", "-h", str(cluster.dir), "-p", str(cluster.puerto), "-U", "postgres",
                             "-d", db, "-v", "ON_ERROR_STOP=1", "-f", "-"]
    r = subprocess.run(cmd, input=guion, capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        return ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
    m = re.search(r"ERROR:\s+(\w{5}):\s+(.*)", r.stderr)
    d = re.search(r"DETAIL:\s+(.*)", r.stderr)
    return ("error", m.group(1) if m else "?", d.group(1).strip() if d else "", (m.group(2) if m else r.stderr).strip())


def agregar(cluster, db, clave, valor, rol="admin", extra="", **kw):
    """INSERT como ese rol; devuelve la fila guardada."""
    columnas = "clave, valor" + (", " + extra.split("=")[0] if extra else "")
    valores = f"{lit(clave)}, {lit(json.dumps(valor, ensure_ascii=False))}::jsonb" + (", " + extra.split("=", 1)[1] if extra else "")
    return llamar(cluster, db, rol, f"with i as (insert into public.configuracion ({columnas}) values ({valores}) returning *) select to_json(i)::text from i;", **kw)


def filas(cluster, db):
    return json.loads(cluster.valor(db, "select coalesce(json_agg(c order by id), '[]') from public.configuracion c"))


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    try:
        c.psql_ok("postgres", "create database plantilla_base;")
        c.preparar_supabase_falso("plantilla_base")                  # lo que Supabase ya trae (los roles son de todo el clúster)
        c.base_nueva("plantilla_cfg", plantilla="plantilla_base")
        c.psql_ok("plantilla_cfg", ESQUEMA.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_cfg", RLS.read_text(encoding="utf-8"))
        # Supabase da permiso de ejecutar a anon / authenticated en toda función que se cree en public.
        c.psql_ok("plantilla_cfg", "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;")
        c.psql_ok("plantilla_cfg", CONFIG.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    return cluster.base_nueva(f"cfg_{_n[0]}", plantilla="plantilla_cfg")


# ── 1. Sellos: la base pone la fecha y el autor ────────────────────────────────────
def test_el_admin_agrega_un_cambio_y_la_base_lo_sella(cluster, db):
    res = agregar(cluster, db, "mesas", 12, correo="luisca@elobo.test")
    assert res[0] == "ok", res
    f = res[1]
    assert f["clave"] == "mesas" and f["valor"] == 12 and f["id"] == 1
    assert f["creado_por"] == "luisca"                                 # lo que va antes de la @
    assert cluster.valor(db, "select abs(extract(epoch from now() - vigente_desde)) < 60 and abs(extract(epoch from now() - creado_en)) < 60 from public.configuracion") == "t"


def test_nadie_puede_escribir_un_cambio_con_fecha_o_autor_inventados(cluster, db):
    res = agregar(cluster, db, "mesas", 10, extra="vigente_desde='2020-01-01T00:00:00+00:00'", correo="ana@elobo.test")
    assert res[0] == "ok", res
    res = llamar(cluster, db, "admin", "with i as (insert into public.configuracion (clave, valor, vigente_desde, creado_en, creado_por) "
                 "values ('mesas', '11', '2019-05-05', '2019-05-05', 'otro') returning *) select to_json(i)::text from i;", correo="ana@elobo.test")
    assert res[0] == "ok", res
    for f in filas(cluster, db):
        assert f["vigente_desde"].startswith("202") and not f["vigente_desde"].startswith(("2020", "2019")), f
        assert f["creado_en"][:4] != "2019" and f["creado_por"] == "ana", f


def test_un_token_sin_correo_queda_como_desconocido_y_un_correo_largo_se_recorta(cluster, db):
    assert agregar(cluster, db, "mesas", 9, claims={"role": "authenticated", "app_metadata": {"rol": "admin"}})[1]["creado_por"] == "desconocido"
    largo = "x" * 200 + "@elobo.test"
    assert len(agregar(cluster, db, "mesas", 10, correo=largo)[1]["creado_por"]) == 60


def test_los_ids_crecen_y_cada_cambio_es_una_fila_aparte(cluster, db):
    for v in (8, 10, 12):
        assert agregar(cluster, db, "mesas", v)[0] == "ok"
    assert [(f["id"], f["valor"]) for f in filas(cluster, db)] == [(1, 8), (2, 10), (3, 12)]


# ── 2. Validación de claves y valores ───────────────────────────────────────────────
VALIDOS = [
    ("mesas", 1), ("mesas", 8), ("mesas", 60),
    ("recargo_para_llevar", 0), ("recargo_para_llevar", 1500), ("recargo_para_llevar", 50000),
    ("empaque_domicilio", 0), ("empaque_domicilio", 50000),
    ("respaldo_dia_semana", 0), ("respaldo_dia_semana", 3), ("respaldo_dia_semana", 6),
    ("respaldo_rojo_dias", 7), ("respaldo_rojo_dias", 10), ("respaldo_rojo_dias", 60),
    ("negocio_nombre", "X"), ("negocio_nombre", "El Lobo"), ("negocio_nombre", "Ñ" * 40), ("negocio_nombre", "Café & «Más» 😀"),
    ("negocio_emoji", ""), ("negocio_emoji", "🐺"), ("negocio_emoji", "🐺" * 8),
    ("mesas", 8.0),                       # 8.0 es el entero 8 escrito con decimales: sigue siendo un entero
]


@pytest.mark.parametrize("clave,valor", VALIDOS, ids=lambda x: str(x)[:30])
def test_los_valores_validos_incluidos_los_extremos_se_guardan(cluster, db, clave, valor):
    res = agregar(cluster, db, clave, valor)
    assert res[0] == "ok", res


INVALIDOS = [
    ("mesas", 0), ("mesas", -3), ("mesas", 61), ("mesas", 8.5), ("mesas", "8"), ("mesas", None), ("mesas", True), ("mesas", [8]),
    ("recargo_para_llevar", -1), ("recargo_para_llevar", 50001), ("recargo_para_llevar", 1000.5), ("recargo_para_llevar", "1000"),
    ("empaque_domicilio", -1), ("empaque_domicilio", 50001), ("empaque_domicilio", None),
    ("respaldo_dia_semana", -1), ("respaldo_dia_semana", 7), ("respaldo_dia_semana", 2.5), ("respaldo_dia_semana", "domingo"),
    ("respaldo_rojo_dias", 6), ("respaldo_rojo_dias", 61), ("respaldo_rojo_dias", 10.1),
    ("negocio_nombre", ""), ("negocio_nombre", "   "), ("negocio_nombre", " El Lobo"), ("negocio_nombre", "El Lobo "),
    ("negocio_nombre", "N" * 41), ("negocio_nombre", 5), ("negocio_nombre", None),
    ("negocio_emoji", "🐺" * 9), ("negocio_emoji", 7), ("negocio_emoji", None),
]


@pytest.mark.parametrize("clave,valor", INVALIDOS, ids=lambda x: str(x)[:30])
def test_los_valores_fuera_de_rango_o_de_otro_tipo_se_rechazan_y_no_queda_nada(cluster, db, clave, valor):
    res = agregar(cluster, db, clave, valor)
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
    assert filas(cluster, db) == []


@pytest.mark.parametrize("clave", ["foo", "Mesas", "mesas ", "", "numero_de_mesas", "ultimo_respaldo"])
def test_una_clave_que_no_existe_se_rechaza(cluster, db, clave):
    res = agregar(cluster, db, clave, 5)
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_clave_desconocida", res
    assert filas(cluster, db) == []


def test_un_lote_con_un_valor_malo_no_guarda_ni_los_buenos(cluster, db):
    res = llamar(cluster, db, "admin", "with i as (insert into public.configuracion (clave, valor) values ('mesas', '10'), ('mesas', '999') returning *) select json_agg(i)::text from i;")
    assert res[0] == "error" and res[2] == "configuracion_invalida", res
    assert filas(cluster, db) == []


# ── 3. Solo se agrega ────────────────────────────────────────────────────────────────
def sembrar(cluster, db):
    for v in (8, 10):
        assert agregar(cluster, db, "mesas", v)[0] == "ok"
    return filas(cluster, db)


@pytest.mark.parametrize("rol", ["admin", "caja", "respaldo"])
def test_ni_el_administrador_modifica_o_borra_una_fila_por_la_api(cluster, db, rol):
    antes = sembrar(cluster, db)
    mod = llamar(cluster, db, rol, "with u as (update public.configuracion set valor = '55' where true returning 1) select json_build_object('n', count(*))::text from u;")
    bor = llamar(cluster, db, rol, "with d as (delete from public.configuracion where true returning 1) select json_build_object('n', count(*))::text from d;")
    assert mod == ("ok", {"n": 0}) and bor == ("ok", {"n": 0}), (mod, bor)       # sin política: el cambio no alcanza ninguna fila
    assert filas(cluster, db) == antes


def test_aunque_alguien_abriera_una_politica_por_error_el_disparador_lo_rechaza(cluster, db):
    antes = sembrar(cluster, db)
    cluster.psql_ok(db, """
        create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);
        create policy abierta_d on public.configuracion for delete to authenticated using (true);""")
    for sentencia in ("update public.configuracion set valor = '55' where id = 1", "delete from public.configuracion where id = 1"):
        res = llamar(cluster, db, "admin", f"with x as ({sentencia} returning 1) select json_agg(x)::text from x;")
        assert res[0] == "error" and res[1] == "42501" and res[2] == "configuracion_solo_agregar", res
    assert filas(cluster, db) == antes


def test_tampoco_se_puede_vaciar_ni_reescribir_la_historia_de_un_golpe(cluster, db):
    antes = sembrar(cluster, db)
    cluster.psql_ok(db, "create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);")
    res = llamar(cluster, db, "admin", "with u as (update public.configuracion set vigente_desde = '2000-01-01' where true returning 1) select jsonb_agg(to_jsonb(u))::text from u;")
    assert res[0] == "error" and res[2] == "configuracion_solo_agregar", res
    assert filas(cluster, db) == antes


# ── 4. Permisos por rol ──────────────────────────────────────────────────────────────
def test_admin_caja_y_respaldo_leen_la_configuracion(cluster, db):
    sembrar(cluster, db)
    for rol in ("admin", "caja", "respaldo"):
        res = llamar(cluster, db, rol, "select json_build_object('n', count(*))::text from public.configuracion;")
        assert res == ("ok", {"n": 2}), (rol, res)


@pytest.mark.parametrize("rol", ["caja", "respaldo"])
def test_caja_y_respaldo_no_pueden_agregar(cluster, db, rol):
    res = agregar(cluster, db, "mesas", 12, rol=rol)
    assert res[0] == "error" and res[1] == "42501", res
    assert filas(cluster, db) == []


def test_un_token_sin_rol_no_ve_ni_agrega(cluster, db):
    sembrar(cluster, db)
    assert llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;") == ("ok", {"n": 0})
    res = agregar(cluster, db, "mesas", 12, rol=None)
    assert res[0] == "error" and res[1] == "42501", res


def test_la_llave_publica_anon_no_toca_nada(cluster, db):
    sembrar(cluster, db)
    res = llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res
    res = llamar(cluster, db, None, "with i as (insert into public.configuracion (clave, valor) values ('mesas', '12') returning *) select json_agg(i)::text from i;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res
    assert cluster.valor(db, "select has_table_privilege('anon', 'public.configuracion', 'select,insert,update,delete')") == "f"


# ── 5. La restauración devuelve la historia tal cual ─────────────────────────────────
HISTORIA = ("insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
            "(7, 'mesas', '10', '2026-09-01T15:00:00+00:00', 'luis', '2026-09-01T15:00:00+00:00'), "
            "(9, 'mesas', '12', '2026-10-01T15:00:00+00:00', 'ana', '2026-10-01T15:00:00+00:00');")


def test_el_dueno_de_la_base_inserta_la_historia_sin_que_se_selle_de_nuevo(cluster, db):
    cluster.psql_ok(db, HISTORIA)
    f = filas(cluster, db)
    assert [(x["id"], x["valor"], x["creado_por"], x["vigente_desde"][:10]) for x in f] == [(7, 10, "luis", "2026-09-01"), (9, 12, "ana", "2026-10-01")]


def test_la_llave_de_servicio_tambien_inserta_la_historia_tal_cual(cluster, db):
    res = llamar(cluster, db, None, HISTORIA.replace("insert into", "with i as (insert into").replace(";", " returning *) select jsonb_agg(to_jsonb(i))::text from i;"),
                 rol_pg="service_role", claims={"role": "service_role"})
    assert res[0] == "ok", res
    assert [(x["id"], x["creado_por"], x["vigente_desde"][:10]) for x in filas(cluster, db)] == [(7, "luis", "2026-09-01"), (9, "ana", "2026-10-01")]


def test_despues_de_restaurar_el_contador_de_ids_sigue_sin_chocar(cluster, db):
    cluster.psql_ok(db, HISTORIA + "\nselect setval(pg_get_serial_sequence('public.configuracion', 'id'), (select max(id) from public.configuracion));")
    res = agregar(cluster, db, "mesas", 14)
    assert res[0] == "ok" and res[1]["id"] == 10, res


# ── 6. Instalación: nueva vs. ya en producción, repetir y deshacer ─────────────────
def huella(cluster, db):
    """Todo lo que define a la configuración en la base, en un solo texto comparable."""
    consultas = {
        "columnas": "select json_agg(json_build_array(column_name, data_type, is_nullable, column_default, is_identity) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='configuracion'",
        "llave": "select json_agg(json_build_array(conname, contype, pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.configuracion'::regclass",
        "politicas": "select json_agg(json_build_array(policyname, cmd, roles::text, qual, with_check) order by policyname) from pg_policies where schemaname='public' and tablename='configuracion'",
        "disparadores": "select json_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.configuracion'::regclass and not tgisinternal",
        "funciones": "select json_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ('configuracion_antes','validar_configuracion')",
        "rls": "select relrowsecurity from pg_class where oid='public.configuracion'::regclass",
        "permisos": "select json_agg(json_build_array(grantee, privilege_type) order by grantee, privilege_type) from information_schema.table_privileges where table_schema='public' and table_name='configuracion' and grantee in ('anon','authenticated')",
    }
    return {k: cluster.valor(db, q) for k, q in consultas.items()}


def test_instalar_sobre_una_base_nueva_y_sobre_una_que_ya_estaba_en_produccion_da_lo_mismo(cluster):
    nueva = cluster.base_nueva("cfg_nueva", plantilla="plantilla_cfg")
    # «Producción hoy»: esquema y reglas de acceso ya puestos, SIN la tabla de configuración ni sus políticas.
    cluster.base_nueva("cfg_prod", plantilla="plantilla_base")
    cluster.psql_ok("cfg_prod", ESQUEMA.read_text(encoding="utf-8"))
    cluster.psql_ok("cfg_prod", RLS.read_text(encoding="utf-8"))
    cluster.psql_ok("cfg_prod", "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;")
    cluster.psql_ok("cfg_prod", "drop table public.configuracion;")
    assert cluster.valor("cfg_prod", "select coalesce(to_regclass('public.configuracion')::text, '')") == ""
    cluster.psql_ok("cfg_prod", CONFIG.read_text(encoding="utf-8"))
    assert huella(cluster, "cfg_prod") == huella(cluster, nueva)
    # y la actualizada funciona igual que la nueva
    assert agregar(cluster, "cfg_prod", "mesas", 12)[0] == "ok"
    assert agregar(cluster, "cfg_prod", "mesas", 0)[2] == "configuracion_invalida"


def test_correrlo_dos_veces_no_rompe_nada_ni_pierde_el_historial(cluster, db):
    antes = sembrar(cluster, db)
    salida = cluster.psql_ok(db, CONFIG.read_text(encoding="utf-8"))
    assert filas(cluster, db) == antes
    assert agregar(cluster, db, "mesas", 12)[0] == "ok"
    assert re.search(r"^\s*1\s*\|\s*t\s*\|\s*2\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]     # tabla · rls · politicas · disparador · anon


def test_la_verificacion_del_final_dice_lo_esperado(cluster, db):
    salida = cluster.psql_ok(db, CONFIG.read_text(encoding="utf-8"))
    assert re.search(r"^\s*1\s*\|\s*t\s*\|\s*2\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]


def test_sin_las_reglas_de_acceso_previas_la_instalacion_se_niega_con_un_mensaje_claro(cluster):
    cluster.base_nueva("cfg_sin_rls", plantilla="plantilla_base")
    codigo, _, avisos = cluster.psql("cfg_sin_rls", CONFIG.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "rls_seguridad.sql" in avisos, avisos[-400:]
    assert cluster.valor("cfg_sin_rls", "select coalesce(to_regclass('public.configuracion')::text, '')") == ""    # y no quedó nada a medias


def test_el_rollback_quita_todo_y_se_puede_volver_a_instalar(cluster, db):
    sembrar(cluster, db)
    salida = cluster.psql_ok(db, ROLLBACK.read_text(encoding="utf-8"))
    assert re.search(r"^\s*0\s*\|\s*0\s*$", salida, re.M), salida[-200:]                 # tabla = 0 · funciones = 0
    assert cluster.valor(db, "select count(*) from pg_policies where tablename = 'configuracion'") == "0"
    cluster.psql_ok(db, ROLLBACK.read_text(encoding="utf-8"))                              # dos veces: igual de tranquilo
    cluster.psql_ok(db, CONFIG.read_text(encoding="utf-8"))                                # y se vuelve a instalar, vacío
    assert filas(cluster, db) == []
    assert agregar(cluster, db, "mesas", 12)[0] == "ok"
    assert agregar(cluster, db, "mesas", 61)[2] == "configuracion_invalida"


def test_la_matriz_de_permisos_y_las_politicas_de_la_base_dicen_lo_mismo(cluster, db):
    matriz = json.loads((RAIZ / "sql" / "matriz_permisos.json").read_text(encoding="utf-8"))
    assert {r: p["configuracion"] for r, p in matriz["roles"].items() if "configuracion" in p} == {"admin": "SI", "caja": "S", "respaldo": "S"}
    pol = cluster.consulta(db, "select policyname || ':' || cmd from pg_policies where schemaname='public' and tablename='configuracion' order by 1")
    assert pol == ["lobo_configuracion_insert:INSERT", "lobo_configuracion_select:SELECT"]       # y ninguna de UPDATE ni DELETE


# ── 7. Las reglas están escritas en tres sitios: tienen que decir lo mismo ───────────
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
BACKEND_FALSO = RAIZ / "tests" / "helpers" / "backend-falso.js"
MENSAJES_TEXTO = ["El nombre del negocio debe tener entre 1 y 40 caracteres, sin espacios al principio ni al final.",
                  "El símbolo del negocio puede tener hasta 8 caracteres."]


def test_los_rangos_son_los_mismos_en_la_base_la_pantalla_y_el_servidor_falso():
    sql = CONFIG.read_text(encoding="utf-8")
    html = HTML.read_text(encoding="utf-8")
    js = BACKEND_FALSO.read_text(encoding="utf-8")
    en_sql = {c: (int(a), int(b), n) for c, a, b, n in re.findall(r"\('([a-z_]+)', (\d+), (\d+), '([^']+)'\)", sql)}
    en_html = {c: (int(a), int(b), n) for c, a, b, n in re.findall(r"(\w+):\s+\{ tipo: 'entero', min: (\d+), max: (\d+),\s+nombre: '([^']+)' \}", html)}
    en_js = {c: (int(a), int(b), n) for c, a, b, n in re.findall(r"(\w+): \[(\d+), (\d+), '([^']+)'\]", js)}
    assert set(en_sql) == {"mesas", "recargo_para_llevar", "empaque_domicilio", "respaldo_dia_semana", "respaldo_rojo_dias"}
    assert en_html == en_sql, "la pantalla (CFG_REGLAS) y la base (validar_configuracion) no coinciden"
    assert en_js == en_sql, "el servidor falso de las pruebas (RANGOS_CONFIG) y la base no coinciden"
    # Los textos y el largo del nombre y del símbolo.
    for texto in MENSAJES_TEXTO:
        assert texto in sql and texto in html and texto in js, texto
    assert "char_length(v_txt) > 40" in sql and "largo > 40" in html and "largo > 40" in js
    assert "char_length(v_txt) > 8" in sql and "largo > 8" in html and "largo > 8" in js


def test_los_valores_de_siempre_de_la_pantalla_son_validos_y_cada_clave_tiene_su_campo():
    html = HTML.read_text(encoding="utf-8")
    bloque = re.search(r"const CFG_DEFECTOS = Object\.freeze\(\{(.*?)\}\);", html, re.S).group(1)
    defectos = dict(re.findall(r"(\w+): ('[^']*'|\d+)", bloque))
    assert defectos["mesas"] == "8" and defectos["recargo_para_llevar"] == "1000" and defectos["empaque_domicilio"] == "1000"
    assert defectos["respaldo_dia_semana"] == "0" and defectos["respaldo_rojo_dias"] == "10"
    assert defectos["negocio_nombre"] == "'El Lobo'" and defectos["negocio_emoji"] == "'🐺'"
    en_sql = {c: (int(a), int(b)) for c, a, b, _ in re.findall(r"\('([a-z_]+)', (\d+), (\d+), '([^']+)'\)", CONFIG.read_text(encoding="utf-8"))}
    for clave, (minimo, maximo) in en_sql.items():
        assert minimo <= int(defectos[clave]) <= maximo, clave
    # Toda clave que la base acepta tiene su campo en la pantalla (y al revés).
    en_pantalla = set(re.findall(r"\{ clave: '([a-z_]+)', titulo:", html))
    assert en_pantalla == set(defectos) == set(en_sql) | {"negocio_nombre", "negocio_emoji"}
