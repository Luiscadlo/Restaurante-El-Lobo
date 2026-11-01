"""Pruebas de la opción «comidas de la familia en el cierre» (sql/configuracion_cierre_familia.sql) contra un Postgres de verdad.

Misma base desechable que test_configuracion.py (imita a Supabase; esquema real de El Lobo + reglas de acceso + etapas 1, 2, 4 y 3);
nunca toca tu Supabase. Qué comprueban:
  · La clave cierre_comidas_familia solo acepta verdadero o falso (nada de texto, números, listas ni nulos), y los casos de
    tests/fixtures/casos-familia.json (los mismos que usan las pruebas de la pantalla y del servidor falso) dan aquí el mismo
    veredicto y el MISMO mensaje.
  · Cada guardado es una fila nueva, sellada por la base (fecha y autor); lo anterior queda; solo administrador guarda.
  · Lo de las etapas 1, 2, 4 y 3 sigue igual (claves, rangos, catálogos, categorías, platos, solo agregar, permisos).
  · El valor por defecto de la página (CFG_DEFECTOS) es «sí»: sin nada guardado todo funciona como siempre en El Lobo.
  · Instalar encima de la etapa 3 y repetir no rompe nada; el rollback deja la etapa 3 tal cual (funciones idénticas) sin borrar el
    historial, y se puede volver a instalar. Sin las etapas anteriores, la instalación se niega con un mensaje claro.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_configuracion_cierre_familia.py -q
"""
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402
from test_configuracion import agregar, filas, llamar  # noqa: E402
from test_configuracion_etapa_3 import BASE as PLATOS_BASE  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONFIG = RAIZ / "sql" / "configuracion.sql"
ETAPA2 = RAIZ / "sql" / "configuracion_etapa_2.sql"
ETAPA4 = RAIZ / "sql" / "configuracion_etapa_4.sql"
ETAPA3 = RAIZ / "sql" / "configuracion_etapa_3.sql"
SQL_FAMILIA = RAIZ / "sql" / "configuracion_cierre_familia.sql"
ROLLBACK_FAMILIA = RAIZ / "sql" / "rollback_configuracion_cierre_familia.sql"
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
CASOS = json.loads((RAIZ / "tests" / "fixtures" / "casos-familia.json").read_text(encoding="utf-8"))["casos"]

pytestmark = pytest.mark.skipif(not all(p.exists() for p in (ESQUEMA, CONFIG, ETAPA2, ETAPA4, ETAPA3, SQL_FAMILIA)), reason="Falta el SQL")
_n = [0]
K = "cierre_comidas_familia"


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    try:
        c.psql_ok("postgres", "create database plantilla_base;")
        c.preparar_supabase_falso("plantilla_base")
        c.base_nueva("plantilla_e1", plantilla="plantilla_base")
        c.psql_ok("plantilla_e1", ESQUEMA.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_e1", RLS.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_e1", "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;")
        c.psql_ok("plantilla_e1", CONFIG.read_text(encoding="utf-8"))                       # etapa 1
        c.base_nueva("plantilla_e2", plantilla="plantilla_e1")
        c.psql_ok("plantilla_e2", ETAPA2.read_text(encoding="utf-8"))                       # etapa 2
        c.base_nueva("plantilla_e4", plantilla="plantilla_e2")
        c.psql_ok("plantilla_e4", ETAPA4.read_text(encoding="utf-8"))                       # etapa 4
        c.base_nueva("plantilla_e3", plantilla="plantilla_e4")
        c.psql_ok("plantilla_e3", ETAPA3.read_text(encoding="utf-8"))                       # etapa 3
        c.base_nueva("plantilla_e5", plantilla="plantilla_e3")
        c.psql_ok("plantilla_e5", SQL_FAMILIA.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    return cluster.base_nueva(f"cfg5_{_n[0]}", plantilla="plantilla_e5")


def guardar_ok(cluster, db, valor, **kw):
    res = agregar(cluster, db, K, valor, **kw)
    assert res[0] == "ok", res
    return res[1]


# ── 1. Los casos compartidos: mismo veredicto y mismo mensaje que la pantalla y el servidor falso ─────
@pytest.mark.parametrize("caso", CASOS, ids=lambda c: c["id"])
def test_cada_caso_compartido_se_acepta_o_se_rechaza_con_su_mensaje(cluster, db, caso):
    res = agregar(cluster, db, caso["clave"], caso["valor"])
    if caso["mensaje"] is None:
        assert res[0] == "ok", res
        assert [f["valor"] for f in filas(cluster, db)] == [caso["valor"]]
    else:
        assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
        assert res[3] == caso["mensaje"], res
        assert filas(cluster, db) == []                                                       # y no queda nada a medias


def test_hay_casos_validos_e_invalidos():
    assert sum(1 for c in CASOS if c["mensaje"] is None) == 2
    assert sum(1 for c in CASOS if c["mensaje"] is not None) >= 8


def test_el_nulo_de_sql_tampoco_pasa(cluster, db):
    """Un NULL de SQL (no el JSON null) lo frena el disparador con el mismo mensaje claro, antes de la restricción de la tabla."""
    res = llamar(cluster, db, "admin", "with i as (insert into public.configuracion (clave, valor) values ('cierre_comidas_familia', null) returning *) select to_json(i)::text from i;")
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida" and res[3] == CASOS[2]["mensaje"], res
    assert filas(cluster, db) == []


# ── 2. Cada guardado es una fila nueva, sellada por la base ────────────────────────────────────────
def test_cada_cambio_es_una_fila_nueva_sellada_y_lo_anterior_queda(cluster, db):
    primera = guardar_ok(cluster, db, False, correo="luisca@elobo.test")
    segunda = guardar_ok(cluster, db, True, correo="ana@elobo.test")
    assert (primera["id"], segunda["id"]) == (1, 2)
    assert (primera["creado_por"], segunda["creado_por"]) == ("luisca", "ana")
    assert [x["valor"] for x in filas(cluster, db)] == [False, True]                          # la versión vieja sigue ahí
    assert cluster.valor(db, "select bool_and(abs(extract(epoch from now() - vigente_desde)) < 60) from public.configuracion") == "t"


def test_nadie_puede_escribir_con_fecha_o_autor_inventados(cluster, db):
    res = agregar(cluster, db, K, False, extra="vigente_desde='2020-01-01T00:00:00+00:00'", correo="ana@elobo.test")
    assert res[0] == "ok", res
    assert not res[1]["vigente_desde"].startswith("2020") and res[1]["creado_por"] == "ana"


@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_caja_respaldo_y_token_sin_rol_no_pueden_guardar(cluster, db, rol):
    res = agregar(cluster, db, K, False, rol=rol)
    assert res[0] == "error" and res[1] == "42501", res
    assert filas(cluster, db) == []


def test_caja_y_respaldo_si_leen_lo_guardado(cluster, db):
    """Caja necesita leerlo: es quien cierra el turno y debe ver (o no) el campo de la familia."""
    guardar_ok(cluster, db, False)
    for rol in ("admin", "caja", "respaldo"):
        assert llamar(cluster, db, rol, f"select json_build_object('valor', (select valor from public.configuracion where clave = '{K}'))::text;") == ("ok", {"valor": False}), rol


def test_sigue_siendo_solo_agregar(cluster, db):
    guardar_ok(cluster, db, False)
    cluster.psql_ok(db, "create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);"
                        "create policy abierta_d on public.configuracion for delete to authenticated using (true);")
    for sentencia in ("update public.configuracion set valor = 'true'::jsonb where id = 1", "delete from public.configuracion where id = 1"):
        res = llamar(cluster, db, "admin", f"with x as ({sentencia} returning 1) select json_agg(x)::text from x;")
        assert res[0] == "error" and res[1] == "42501" and res[2] == "configuracion_solo_agregar", res


def test_la_llave_publica_no_toca_la_configuracion(cluster, db):
    guardar_ok(cluster, db, False)
    res = llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res


# ── 3. Lo de las etapas anteriores sigue igual ────────────────────────────────────────────────────
@pytest.mark.parametrize("clave,valor,codigo", [
    ("mesas", 12, "ok"), ("mesas", 61, "22023"), ("recargo_para_llevar", 1500, "ok"), ("recargo_para_llevar", -1, "22023"),
    ("negocio_nombre", "Café Lobo", "ok"), ("negocio_nombre", " Lobo", "22023"), ("negocio_emoji", "", "ok"),
    ("respaldo_rojo_dias", 6, "22023"), ("foo", 5, "22023"), ("cierre_familia", True, "22023"), ("catalogo_extras", [], "ok"),
    ("menu_platos", PLATOS_BASE, "ok"), ("menu_platos", [], "22023"),
])
def test_las_claves_y_rangos_de_las_etapas_anteriores_no_cambiaron(cluster, db, clave, valor, codigo):
    res = agregar(cluster, db, clave, valor)
    assert (res[0] == "ok") == (codigo == "ok"), res
    if codigo != "ok":
        assert res[1] == codigo, res


def test_una_clave_desconocida_sigue_dando_su_codigo_propio(cluster, db):
    res = agregar(cluster, db, "cierre_familia", True)
    assert res[0] == "error" and res[2] == "configuracion_clave_desconocida", res


# ── 4. La página y la base dicen lo mismo ──────────────────────────────────────────────────────────
def test_el_valor_de_siempre_de_la_pagina_es_si():
    """Sin nada guardado El Lobo sigue pidiendo las comidas de la familia: el defecto de la página es verdadero."""
    html = HTML.read_text(encoding="utf-8")
    assert re.search(r"cierre_comidas_familia: true\s*\n\}\);", html), "CFG_DEFECTOS debe traer cierre_comidas_familia: true"
    assert "cierre_comidas_familia: { tipo: 'booleano'" in html


# ── 5. Instalación: encima de la etapa 3, repetir y deshacer ─────────────────────────────────────────
FUNCIONES = ("configuracion_antes", "validar_configuracion", "validar_catalogo", "validar_catalogo_historia", "codigos_catalogo_base",
             "validar_categorias_egresos", "validar_nombres_cuentas", "categorias_egresos_base", "validar_menu_platos", "menu_platos_base")


def huella(cluster, db):
    en = ",".join(f"'{f}'" for f in FUNCIONES)
    return {
        "funciones": cluster.valor(db, f"select json_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "permisos": cluster.valor(db, f"select json_agg(json_build_array(p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "disparadores": cluster.valor(db, "select json_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.configuracion'::regclass and not tgisinternal"),
        "politicas": cluster.valor(db, "select json_agg(json_build_array(policyname, cmd, roles::text, qual, with_check) order by policyname) from pg_policies where schemaname='public' and tablename='configuracion'"),
    }


def test_la_verificacion_del_final_dice_lo_esperado(cluster):
    base = cluster.base_nueva("cfg5_verif", plantilla="plantilla_e3")
    salida = cluster.psql_ok(base, SQL_FAMILIA.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]              # familia_instalada · disparador · anon_con_permisos


def test_instalar_cambia_solo_la_validacion_general(cluster, db):
    """Todo lo demás (disparador, permisos, políticas, las otras funciones) queda idéntico a la etapa 3."""
    solo_e3 = cluster.base_nueva("cfg5_solo_e3", plantilla="plantilla_e3")
    antes, despues = huella(cluster, solo_e3), huella(cluster, db)
    assert antes["disparadores"] == despues["disparadores"] and antes["politicas"] == despues["politicas"] and antes["permisos"] == despues["permisos"]
    assert antes["funciones"] != despues["funciones"]
    funcs_antes, funcs_despues = json.loads(antes["funciones"]), json.loads(despues["funciones"])
    cambiadas = [a.split("(")[0].split(".")[-1] for a, d in zip(funcs_antes, funcs_despues) if a != d]
    assert cambiadas == ["validar_configuracion"], cambiadas


def test_correrlo_dos_veces_no_rompe_nada_ni_pierde_el_historial(cluster, db):
    guardar_ok(cluster, db, False)
    antes, huella_antes = filas(cluster, db), huella(cluster, db)
    cluster.psql_ok(db, SQL_FAMILIA.read_text(encoding="utf-8"))
    assert filas(cluster, db) == antes and huella(cluster, db) == huella_antes
    assert agregar(cluster, db, K, "no")[0] == "error"                                         # y la regla sigue funcionando


def test_sin_las_etapas_anteriores_la_instalacion_se_niega_con_un_mensaje_claro(cluster):
    cluster.base_nueva("cfg5_sin_e1", plantilla="plantilla_base")
    codigo, _, avisos = cluster.psql("cfg5_sin_e1", SQL_FAMILIA.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg5_sin_e2", plantilla="plantilla_e1")
    codigo, _, avisos = cluster.psql("cfg5_sin_e2", SQL_FAMILIA.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_2.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg5_sin_e4", plantilla="plantilla_e2")
    codigo, _, avisos = cluster.psql("cfg5_sin_e4", SQL_FAMILIA.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_4.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg5_sin_e3", plantilla="plantilla_e4")                                  # el orden importa: 2 → 4 → 3 → 5
    codigo, _, avisos = cluster.psql("cfg5_sin_e3", SQL_FAMILIA.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_3.sql" in avisos, avisos[-400:]
    assert "cierre_comidas_familia" not in cluster.valor("cfg5_sin_e3", "select pg_get_functiondef('seguridad.validar_configuracion(text,jsonb)'::regprocedure)")


def test_el_rollback_deja_la_etapa_3_tal_cual_sin_borrar_el_historial_y_se_puede_reinstalar(cluster, db):
    solo_e3 = cluster.base_nueva("cfg5_rb_e3", plantilla="plantilla_e3")
    huella_e3 = huella(cluster, solo_e3)
    guardar_ok(cluster, db, False)
    historial = filas(cluster, db)
    salida = cluster.psql_ok(db, ROLLBACK_FAMILIA.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*$", salida, re.M), salida[-200:]                                    # familia_quitada = true
    assert huella(cluster, db) == huella_e3                                                        # funciones, permisos, disparador: los de la etapa 3
    assert filas(cluster, db) == historial                                                         # el historial NO se borra
    res = agregar(cluster, db, K, True)
    assert res[0] == "error" and res[2] == "configuracion_clave_desconocida", res                  # la base ya no acepta cambios de esta opción
    assert agregar(cluster, db, "mesas", 12)[0] == "ok" and agregar(cluster, db, "menu_platos", PLATOS_BASE)[0] == "ok"   # lo demás sigue
    cluster.psql_ok(db, ROLLBACK_FAMILIA.read_text(encoding="utf-8"))                                     # dos veces: igual de tranquilo
    cluster.psql_ok(db, SQL_FAMILIA.read_text(encoding="utf-8"))                                        # y se vuelve a instalar, con el historial puesto
    assert agregar(cluster, db, K, True)[0] == "ok"
    assert [f["valor"] for f in filas(cluster, db) if f["clave"] == K] == [False, True]                # el historial de esta opción: lo viejo y lo nuevo
