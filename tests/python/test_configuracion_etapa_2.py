"""Pruebas de PRODUCTOS Y PRECIOS (sql/configuracion_etapa_2.sql) contra un Postgres de verdad.

Misma base desechable que test_configuracion.py (imita a Supabase; esquema real de El Lobo + reglas de acceso + etapa 1);
nunca toca tu Supabase. Qué comprueban:
  · Los catálogos (almuerzos, comidas rápidas, productos adicionales) se guardan como UNA fila nueva cada vez, sellada por la
    base (fecha y autor), y las reglas se aplican aunque alguien se salte la pantalla: precio entero de $100 a $500.000,
    nombres sin caracteres de código, código y categoría con su forma, sin repetidos, cantidades válidas.
  · Un producto NUNCA se borra: cada versión nueva debe traer todos los códigos de la anterior (y los 49 / 8 de El Lobo);
    para dejar de ofrecer algo se «retira» (activo = false). Los adicionales (sin código) sí pueden quitarse.
  · Los casos de tests/fixtures/casos-catalogo.json (los mismos que usan las pruebas de la pantalla y del servidor falso)
    dan aquí el mismo veredicto y el MISMO mensaje: las tres reglas dicen lo mismo.
  · Lo de la etapa 1 sigue igual (claves, rangos, solo agregar, permisos); caja y respaldo siguen sin poder escribir.
  · Los catálogos base que trae la página (JSON dentro del HTML) son exactamente los códigos que exige la base.
  · Instalar sobre una base nueva y sobre una que ya estaba en la etapa 1 da lo mismo; correrlo dos veces no rompe nada;
    el rollback deja la etapa 1 tal cual (funciones idénticas) sin borrar el historial, y se puede volver a instalar.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_configuracion_etapa_2.py -q
"""
import copy
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402
from test_configuracion import agregar, filas, llamar, lit  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONFIG = RAIZ / "sql" / "configuracion.sql"
ETAPA2 = RAIZ / "sql" / "configuracion_etapa_2.sql"
ROLLBACK2 = RAIZ / "sql" / "rollback_configuracion_etapa_2.sql"
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
CASOS = json.loads((RAIZ / "tests" / "fixtures" / "casos-catalogo.json").read_text(encoding="utf-8"))["casos"]

pytestmark = pytest.mark.skipif(not (ESQUEMA.exists() and CONFIG.exists() and ETAPA2.exists()), reason="Falta el SQL")
_n = [0]
R, A, E = "catalogo_rapidas", "catalogo_almuerzos", "catalogo_extras"


def leer_base(nombre):
    """Los catálogos base viven en la página como JSON: se leen de ahí."""
    m = re.search(rf"const CATALOGO_{nombre}_BASE = Object\.freeze\((\[.*?\n\])\.map\(Object\.freeze\)\)", HTML.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(1))


BASE = {A: leer_base("ALMUERZOS"), R: leer_base("RAPIDAS"), E: leer_base("EXTRAS")}


def armar(caso):
    """El valor completo de un caso compartido (mismo algoritmo que la prueba de la pantalla)."""
    if "valor" in caso:
        return caso["valor"]
    v = copy.deepcopy(BASE[caso["clave"]])
    for i, cambios in (caso.get("mod") or {}).items():
        v[int(i)].update(cambios)
    for i, campos in (caso.get("sin") or {}).items():
        for campo in campos:
            del v[int(i)][campo]
    for i in sorted(caso.get("quitar") or [], reverse=True):
        del v[i]
    v += copy.deepcopy(caso.get("agregar") or [])
    for i in range(caso.get("relleno") or 0):
        if caso["clave"] == E:
            v.append({"nombre": f"Relleno {i + 1}", "precio": 1000, "activo": True})
        else:
            v.append({"codigo": "Z" + str(i + 1).zfill(3), "nombre": f"Relleno {i + 1}", "precio": 1000, "categoria": "RELLENO", "activo": True})
    return v


def nuevo(cod, nombre="Flan de la casa", precio=6000, cat="POSTRES", activo=True):
    return {"codigo": cod, "nombre": nombre, "precio": precio, "categoria": cat, "activo": activo}


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
        c.psql_ok("plantilla_e1", CONFIG.read_text(encoding="utf-8"))                       # hasta aquí: lo que ya está en producción (etapa 1)
        c.base_nueva("plantilla_e2", plantilla="plantilla_e1")
        c.psql_ok("plantilla_e2", ETAPA2.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    return cluster.base_nueva(f"cfg2_{_n[0]}", plantilla="plantilla_e2")


def guardar_ok(cluster, db, clave, valor, **kw):
    res = agregar(cluster, db, clave, valor, **kw)
    assert res[0] == "ok", res
    return res[1]


# ── 1. Los casos compartidos: mismo veredicto y mismo mensaje que la pantalla y el servidor falso ─────
@pytest.mark.parametrize("caso", CASOS, ids=lambda c: c["id"])
def test_cada_caso_compartido_se_acepta_o_se_rechaza_con_su_mensaje(cluster, db, caso):
    res = agregar(cluster, db, caso["clave"], armar(caso))
    if caso["mensaje"] is None:
        assert res[0] == "ok", res
        assert len(filas(cluster, db)) == 1
    else:
        assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
        assert res[3] == caso["mensaje"], res
        assert filas(cluster, db) == []                                                       # y no queda nada a medias


def test_hay_casos_validos_e_invalidos_de_cada_catalogo():
    for clave in (A, R, E):
        assert any(c["clave"] == clave and c["mensaje"] is None for c in CASOS), clave
        assert any(c["clave"] == clave and c["mensaje"] is not None for c in CASOS), clave


# ── 2. Los catálogos base de la página son los que exige la base ───────────────────────────────────
def test_los_catalogos_base_de_la_pagina_son_los_codigos_que_exige_la_base(cluster, db):
    assert [x["codigo"] for x in BASE[A]] == json.loads(cluster.valor(db, "select to_json(seguridad.codigos_catalogo_base('catalogo_almuerzos'))"))
    assert [x["codigo"] for x in BASE[R]] == json.loads(cluster.valor(db, "select to_json(seguridad.codigos_catalogo_base('catalogo_rapidas'))"))
    assert cluster.valor(db, "select cardinality(seguridad.codigos_catalogo_base('catalogo_extras'))") == "0"
    assert (len(BASE[A]), len(BASE[R]), len(BASE[E])) == (8, 49, 14)
    for clave in (A, R, E):
        guardar_ok(cluster, db, clave, BASE[clave])
    assert [f["clave"] for f in filas(cluster, db)] == [A, R, E]


def test_los_valores_de_siempre_de_la_pagina_siguen_siendo_los_de_el_lobo():
    por_codigo = {x["codigo"]: x for x in BASE[A]}
    assert {c: por_codigo[c]["precio"] for c in por_codigo} == {"completo": 14000, "seco": 12000, "asado130": 17000, "asado200": 20000,
                                                                 "porcion-sopa": 6000, "porcion-arroz": 4000, "porcion-proteina": 8000, "sopa-y-arroz": 11000}
    assert all(x["activo"] is True for lista in BASE.values() for x in lista)


# ── 3. Cada guardado es una fila nueva, sellada por la base ────────────────────────────────────────
def test_cada_cambio_es_una_fila_nueva_sellada_y_lo_anterior_queda(cluster, db):
    primera = guardar_ok(cluster, db, A, BASE[A], correo="luisca@elobo.test")
    cambiado = copy.deepcopy(BASE[A]); cambiado[0]["precio"] = 15000
    segunda = guardar_ok(cluster, db, A, cambiado, correo="ana@elobo.test")
    assert (primera["id"], segunda["id"]) == (1, 2)
    assert (primera["creado_por"], segunda["creado_por"]) == ("luisca", "ana")
    f = filas(cluster, db)
    assert [x["valor"][0]["precio"] for x in f] == [14000, 15000]                              # la versión vieja sigue ahí
    assert cluster.valor(db, "select bool_and(abs(extract(epoch from now() - vigente_desde)) < 60) from public.configuracion") == "t"


def test_nadie_puede_escribir_un_catalogo_con_fecha_o_autor_inventados(cluster, db):
    res = agregar(cluster, db, A, BASE[A], extra="vigente_desde='2020-01-01T00:00:00+00:00'", correo="ana@elobo.test")
    assert res[0] == "ok", res
    assert res[1]["vigente_desde"].startswith("202") and not res[1]["vigente_desde"].startswith("2020") and res[1]["creado_por"] == "ana"


# ── 4. Los productos nunca se borran (se retiran) ──────────────────────────────────────────────────
def test_una_version_nueva_debe_traer_todos_los_codigos_de_la_anterior(cluster, db):
    guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001"), nuevo("X002", "Otro")])
    sin_uno = BASE[R] + [nuevo("X002", "Otro")]
    res = agregar(cluster, db, R, sin_uno)
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
    assert res[3] == "No se pueden borrar productos (X001): se retiran, para que los pedidos viejos se sigan mostrando.", res
    sin_ambos = copy.deepcopy(BASE[R])
    assert "X001, X002" in agregar(cluster, db, R, sin_ambos)[3]                               # los nombra a todos, en el orden en que estaban
    assert len(filas(cluster, db)) == 1                                                        # nada se guardó


def test_retirar_si_se_puede_y_se_puede_reactivar(cluster, db):
    guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001")])
    retirado = BASE[R] + [nuevo("X001", activo=False)]
    guardar_ok(cluster, db, R, retirado)
    guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001", "Flan renovado", 7000, "POSTRES", True)])      # reactivar y hasta renombrar
    assert [f["valor"][-1]["activo"] for f in filas(cluster, db)] == [True, False, True]


def test_lo_que_se_quito_de_una_version_no_puede_volver_a_desaparecer_ni_se_exige_lo_de_versiones_viejas(cluster, db):
    # La regla mira la versión MÁS RECIENTE: X001 está en las dos primeras; la tercera lo conserva.
    guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001")])
    guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001", activo=False)])
    assert agregar(cluster, db, R, BASE[R])[0] == "error"


def test_el_orden_lo_decide_vigente_desde_el_mas_nuevo_y_no_el_id(cluster, db):
    """Si la fila más reciente por fecha es la de id más bajo (restauración), la regla mira ESA."""
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde) values "
                        f"(5, 'catalogo_rapidas', {lit(json.dumps(BASE[R] + [nuevo('X001')]))}::jsonb, '2030-01-01T00:00:00+00:00'),"
                        f" (9, 'catalogo_rapidas', {lit(json.dumps(BASE[R]))}::jsonb, '2029-01-01T00:00:00+00:00');")
    res = agregar(cluster, db, R, BASE[R])
    assert res[0] == "error" and "X001" in res[3], res                                        # la de 2030 (id 5) manda


def test_los_adicionales_no_tienen_codigo_y_si_se_pueden_quitar(cluster, db):
    guardar_ok(cluster, db, E, BASE[E])
    guardar_ok(cluster, db, E, BASE[E][:5])
    guardar_ok(cluster, db, E, [])
    assert [len(f["valor"]) for f in filas(cluster, db)] == [14, 5, 0]


def test_los_almuerzos_siempre_son_los_8_y_se_pueden_retirar_pero_no_borrar(cluster, db):
    v = copy.deepcopy(BASE[A]); v[1]["activo"] = False
    guardar_ok(cluster, db, A, v)
    assert agregar(cluster, db, A, v[:7])[3].endswith("trae 7 productos y esa cantidad no es válida.")


def test_un_catalogo_viejo_ilegible_no_estorba_la_regla(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (clave, valor) values ('catalogo_rapidas', '\"basura\"'::jsonb);")
    guardar_ok(cluster, db, R, BASE[R])


# ── 5. Lo de la etapa 1 sigue igual ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("clave,valor,codigo", [
    ("mesas", 12, "ok"), ("mesas", 61, "22023"), ("recargo_para_llevar", 1500, "ok"), ("recargo_para_llevar", -1, "22023"),
    ("negocio_nombre", "Café Lobo", "ok"), ("negocio_nombre", " Lobo", "22023"), ("negocio_emoji", "", "ok"),
    ("respaldo_rojo_dias", 6, "22023"), ("foo", 5, "22023"), ("catalogo_otro", [], "22023"),
])
def test_las_claves_y_rangos_de_la_etapa_1_no_cambiaron(cluster, db, clave, valor, codigo):
    res = agregar(cluster, db, clave, valor)
    assert (res[0] == "ok") == (codigo == "ok"), res
    if codigo != "ok":
        assert res[1] == codigo, res


def test_sigue_siendo_solo_agregar(cluster, db):
    guardar_ok(cluster, db, A, BASE[A])
    cluster.psql_ok(db, "create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);"
                        "create policy abierta_d on public.configuracion for delete to authenticated using (true);")
    for sentencia in ("update public.configuracion set valor = '[]' where id = 1", "delete from public.configuracion where id = 1"):
        res = llamar(cluster, db, "admin", f"with x as ({sentencia} returning 1) select json_agg(x)::text from x;")
        assert res[0] == "error" and res[1] == "42501" and res[2] == "configuracion_solo_agregar", res


@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_caja_respaldo_y_token_sin_rol_no_pueden_guardar_catalogos(cluster, db, rol):
    res = agregar(cluster, db, A, BASE[A], rol=rol)
    assert res[0] == "error" and res[1] == "42501", res
    assert filas(cluster, db) == []


def test_la_llave_publica_no_toca_los_catalogos(cluster, db):
    guardar_ok(cluster, db, A, BASE[A])
    res = llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res
    # Las funciones nuevas viven en el esquema «seguridad», al que la llave pública no entra (igual que las de la etapa 1).
    assert cluster.valor(db, "select has_schema_privilege('anon', 'seguridad', 'usage')") == "f"
    assert cluster.valor(db, "select has_schema_privilege('authenticated', 'seguridad', 'usage')") == "t"


def test_caja_y_respaldo_leen_los_catalogos_guardados(cluster, db):
    guardar_ok(cluster, db, A, BASE[A])
    for rol in ("admin", "caja", "respaldo"):
        assert llamar(cluster, db, rol, "select json_build_object('n', count(*))::text from public.configuracion where clave like 'catalogo_%';") == ("ok", {"n": 1}), rol


# ── 6. La restauración devuelve la historia tal cual (sin pasar por la validación) ───────────────────
def test_el_dueno_de_la_base_y_la_llave_de_servicio_restauran_catalogos_sin_validacion_ni_sello(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                        f"(7, 'catalogo_extras', {lit(json.dumps(BASE[E]))}::jsonb, '2026-09-01T15:00:00+00:00', 'luis', '2026-09-01T15:00:00+00:00');")
    res = llamar(cluster, db, None, "with i as (insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                 "(8, 'catalogo_rapidas', '[]'::jsonb, '2026-09-02T15:00:00+00:00', 'ana', '2026-09-02T15:00:00+00:00') returning *) select jsonb_agg(to_jsonb(i))::text from i;",
                 rol_pg="service_role", claims={"role": "service_role"})
    assert res[0] == "ok", res
    assert [(x["id"], x["creado_por"], x["vigente_desde"][:10]) for x in filas(cluster, db)] == [(7, "luis", "2026-09-01"), (8, "ana", "2026-09-02")]


# ── 7. Instalación: encima de la etapa 1, repetir y deshacer ─────────────────────────────────────────
FUNCIONES = ("configuracion_antes", "validar_configuracion", "validar_catalogo", "validar_catalogo_historia", "codigos_catalogo_base")


def huella(cluster, db):
    en = ",".join(f"'{f}'" for f in FUNCIONES)
    return {
        "funciones": cluster.valor(db, f"select json_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "permisos_funciones": cluster.valor(db, f"select json_agg(json_build_array(p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "disparadores": cluster.valor(db, "select json_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.configuracion'::regclass and not tgisinternal"),
        "politicas": cluster.valor(db, "select json_agg(json_build_array(policyname, cmd, roles::text, qual, with_check) order by policyname) from pg_policies where schemaname='public' and tablename='configuracion'"),
        "columnas": cluster.valor(db, "select json_agg(json_build_array(column_name, data_type, is_nullable) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='configuracion'"),
    }


def test_la_verificacion_del_final_dice_lo_esperado(cluster):
    base = cluster.base_nueva("cfg2_verif", plantilla="plantilla_e1")
    salida = cluster.psql_ok(base, ETAPA2.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]              # catalogos_instalados · disparador · anon_con_permisos


def test_instalar_sobre_una_base_nueva_y_sobre_una_que_ya_estaba_en_la_etapa_1_da_lo_mismo(cluster, db):
    actualizada = cluster.base_nueva("cfg2_actualizada", plantilla="plantilla_e1")
    cluster.psql_ok(actualizada, ETAPA2.read_text(encoding="utf-8"))
    assert huella(cluster, actualizada) == huella(cluster, db)
    assert agregar(cluster, actualizada, A, BASE[A])[0] == "ok"


def test_correrlo_dos_veces_no_rompe_nada_ni_pierde_el_historial(cluster, db):
    guardar_ok(cluster, db, A, BASE[A]); guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001")])
    antes, huella_antes = filas(cluster, db), huella(cluster, db)
    cluster.psql_ok(db, ETAPA2.read_text(encoding="utf-8"))
    assert filas(cluster, db) == antes and huella(cluster, db) == huella_antes
    assert agregar(cluster, db, R, BASE[R])[3].startswith("No se pueden borrar productos (X001)")     # y las reglas siguen funcionando


def test_sin_la_etapa_1_la_instalacion_se_niega_con_un_mensaje_claro(cluster):
    cluster.base_nueva("cfg2_sin_e1", plantilla="plantilla_base")
    codigo, _, avisos = cluster.psql("cfg2_sin_e1", ETAPA2.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion.sql" in avisos, avisos[-400:]
    assert cluster.valor("cfg2_sin_e1", "select coalesce(to_regprocedure('seguridad.validar_catalogo(text,jsonb)')::text, '')") == ""


def test_el_rollback_deja_la_etapa_1_tal_cual_sin_borrar_el_historial_y_se_puede_reinstalar(cluster, db):
    solo_e1 = cluster.base_nueva("cfg2_solo_e1", plantilla="plantilla_e1")
    huella_e1 = huella(cluster, solo_e1)
    guardar_ok(cluster, db, A, BASE[A]); guardar_ok(cluster, db, R, BASE[R] + [nuevo("X001")])
    historial = filas(cluster, db)
    salida = cluster.psql_ok(db, ROLLBACK2.read_text(encoding="utf-8"))
    assert re.search(r"^\s*f\s*\|\s*1\s*$", salida, re.M), salida[-200:]                          # catalogos_instalados = false · disparador = 1
    assert huella(cluster, db) == huella_e1                                                        # funciones, permisos, disparador: los de la etapa 1
    assert filas(cluster, db) == historial                                                         # el historial de catálogos NO se borra
    res = agregar(cluster, db, A, BASE[A])
    assert res[0] == "error" and res[2] == "configuracion_clave_desconocida", res                  # y la base ya no acepta catálogos nuevos
    assert agregar(cluster, db, "mesas", 12)[0] == "ok"                                            # lo demás sigue
    cluster.psql_ok(db, ROLLBACK2.read_text(encoding="utf-8"))                                     # dos veces: igual de tranquilo
    cluster.psql_ok(db, ETAPA2.read_text(encoding="utf-8"))                                        # y se vuelve a instalar, con el historial puesto
    assert agregar(cluster, db, R, BASE[R])[3].startswith("No se pueden borrar productos (X001)")


def test_el_sql_y_su_rollback_no_dejan_funciones_sueltas_en_public(cluster, db):
    cluster.psql_ok(db, ROLLBACK2.read_text(encoding="utf-8"))
    n = cluster.valor(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname like '%catalogo%'")
    assert n == "0"
