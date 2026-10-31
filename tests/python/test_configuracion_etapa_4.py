"""Pruebas de CATEGORÍAS DE EGRESOS Y NOMBRES DE CUENTAS (sql/configuracion_etapa_4.sql) contra un Postgres de verdad.

Misma base desechable que test_configuracion.py (imita a Supabase; esquema real de El Lobo + reglas de acceso + etapas 1 y 2);
nunca toca tu Supabase. Qué comprueban:
  · Las categorías de egresos y los nombres de las 3 cuentas se guardan como UNA fila nueva cada vez, sellada por la base
    (fecha y autor), y las reglas se aplican aunque alguien se salte la pantalla: forma, largos, caracteres de código,
    grupo y «dónde» válidos, sin repetidos, lo que no cuenta como egreso solo va al cierre, siempre queda una categoría
    activa para Egresos y otra para el cierre, las cuentas son siempre las 3 de El Lobo.
  · Una categoría NUNCA se borra (se retira) y su GRUPO nunca cambia: cada versión debe traer todos los códigos de la
    anterior (y los 7 de El Lobo) con el mismo grupo, así lo que ya se registró nunca cambia de casilla.
  · Los casos de tests/fixtures/casos-egresos.json (los mismos que usan las pruebas de la pantalla y del servidor falso)
    dan aquí el mismo veredicto y el MISMO mensaje: las tres reglas dicen lo mismo.
  · Lo de las etapas 1 y 2 sigue igual (claves, rangos, catálogos, solo agregar, permisos).
  · Las listas base que trae la página (JSON dentro del HTML) son exactamente las que exige la base.
  · Instalar encima de la etapa 2 y repetir no rompe nada; el rollback deja la etapa 2 tal cual (funciones idénticas)
    sin borrar el historial, y se puede volver a instalar.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_configuracion_etapa_4.py -q
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
from test_configuracion_etapa_2 import CASOS as CASOS_CATALOGO, armar as armar_catalogo  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONFIG = RAIZ / "sql" / "configuracion.sql"
ETAPA2 = RAIZ / "sql" / "configuracion_etapa_2.sql"
ETAPA4 = RAIZ / "sql" / "configuracion_etapa_4.sql"
ROLLBACK4 = RAIZ / "sql" / "rollback_configuracion_etapa_4.sql"
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
CASOS = json.loads((RAIZ / "tests" / "fixtures" / "casos-egresos.json").read_text(encoding="utf-8"))["casos"]

pytestmark = pytest.mark.skipif(not (ESQUEMA.exists() and CONFIG.exists() and ETAPA2.exists() and ETAPA4.exists()), reason="Falta el SQL")
_n = [0]
C, K = "categorias_egresos", "nombres_cuentas"


def leer_base(nombre):
    """Las listas base viven en la página como JSON: se leen de ahí."""
    m = re.search(rf"const {nombre}_BASE = Object\.freeze\((\[.*?\n\])\.map\(Object\.freeze\)\)", HTML.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(1))


BASE = {C: leer_base("CATEGORIAS_EGRESOS"), K: leer_base("NOMBRES_CUENTAS")}


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
        v.append({"codigo": "z" + str(i + 1), "nombre": f"Relleno {i + 1}", "grupo": "otro", "donde": "ambos", "activo": True})
    return v


def nueva(cod, nombre="Mantenimiento", grupo="otro", donde="ambos", activo=True):
    return {"codigo": cod, "nombre": nombre, "grupo": grupo, "donde": donde, "activo": activo}


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
        c.psql_ok("plantilla_e2", ETAPA2.read_text(encoding="utf-8"))                       # etapa 2: hasta aquí, lo que ya está en producción
        c.base_nueva("plantilla_e4", plantilla="plantilla_e2")
        c.psql_ok("plantilla_e4", ETAPA4.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    return cluster.base_nueva(f"cfg4_{_n[0]}", plantilla="plantilla_e4")


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


def test_hay_casos_validos_e_invalidos_de_cada_lista():
    for clave in (C, K):
        assert any(c["clave"] == clave and c["mensaje"] is None for c in CASOS), clave
        assert sum(1 for c in CASOS if c["clave"] == clave and c["mensaje"] is not None) >= 20, clave


# ── 2. Los catálogos de productos (etapa 2) se comportan exactamente igual con la etapa 4 puesta ─────
@pytest.mark.parametrize("caso", CASOS_CATALOGO, ids=lambda c: "e2 · " + c["id"])
def test_los_casos_de_catalogos_de_la_etapa_2_siguen_dando_lo_mismo(cluster, db, caso):
    res = agregar(cluster, db, caso["clave"], armar_catalogo(caso))
    if caso["mensaje"] is None:
        assert res[0] == "ok", res
    else:
        assert res[0] == "error" and res[1] == "22023" and res[3] == caso["mensaje"], res


def test_la_regla_de_historia_de_los_productos_sigue_igual(cluster, db):
    base = json.loads(cluster.valor(db, "select to_json(seguridad.codigos_catalogo_base('catalogo_rapidas'))"))
    assert len(base) == 49
    rapidas = [{"codigo": c, "nombre": f"P {c}", "precio": 1000, "categoria": "X", "activo": True} for c in base]
    guardar_ok(cluster, db, "catalogo_rapidas", rapidas + [{"codigo": "X001", "nombre": "Flan", "precio": 6000, "categoria": "POSTRES", "activo": True}])
    res = agregar(cluster, db, "catalogo_rapidas", rapidas)
    assert res[0] == "error" and res[3] == "No se pueden borrar productos (X001): se retiran, para que los pedidos viejos se sigan mostrando.", res


# ── 3. Las listas base de la página son las que exige la base ──────────────────────────────────────
def test_las_listas_base_de_la_pagina_son_las_que_exige_la_base(cluster, db):
    sql = json.loads(cluster.valor(db, "select seguridad.categorias_egresos_base()::text"))
    assert [(x["codigo"], x["grupo"]) for x in BASE[C]] == [(x["codigo"], x["grupo"]) for x in sql]
    for clave in (C, K):
        guardar_ok(cluster, db, clave, BASE[clave])
    assert [f["clave"] for f in filas(cluster, db)] == [C, K]


def test_los_valores_de_siempre_de_la_pagina_son_los_de_el_lobo():
    assert [(x["codigo"], x["nombre"], x["grupo"], x["donde"], x["activo"]) for x in BASE[C]] == [
        ("nomina", "Nómina", "nomina", "ambos", True), ("proveedor", "Proveedores", "proveedor", "ambos", True),
        ("arriendo", "Arriendo", "operativo", "egresos", True), ("servicios", "Servicios", "operativo", "egresos", True),
        ("desechables", "Desechables", "desechable", "ambos", True), ("otro", "Otro", "otro", "ambos", True),
        ("prestamo", "Préstamo", "excluido", "cierre", True)]
    assert [(x["codigo"], x["emoji"], x["nombre"]) for x in BASE[K]] == [
        ("efectivo", "💵", "Efectivo"), ("transf_almuerzos", "☀️", "Transf. Almuerzos"), ("transf_rapidas", "🌙", "Transf. Comidas rápidas")]


# ── 4. Cada guardado es una fila nueva, sellada por la base ────────────────────────────────────────
def test_cada_cambio_es_una_fila_nueva_sellada_y_lo_anterior_queda(cluster, db):
    primera = guardar_ok(cluster, db, K, BASE[K], correo="luisca@elobo.test")
    cambiado = copy.deepcopy(BASE[K]); cambiado[0]["nombre"] = "Caja menor"
    segunda = guardar_ok(cluster, db, K, cambiado, correo="ana@elobo.test")
    assert (primera["id"], segunda["id"]) == (1, 2)
    assert (primera["creado_por"], segunda["creado_por"]) == ("luisca", "ana")
    assert [x["valor"][0]["nombre"] for x in filas(cluster, db)] == ["Efectivo", "Caja menor"]     # la versión vieja sigue ahí
    assert cluster.valor(db, "select bool_and(abs(extract(epoch from now() - vigente_desde)) < 60) from public.configuracion") == "t"


def test_nadie_puede_escribir_con_fecha_o_autor_inventados(cluster, db):
    res = agregar(cluster, db, C, BASE[C], extra="vigente_desde='2020-01-01T00:00:00+00:00'", correo="ana@elobo.test")
    assert res[0] == "ok", res
    assert res[1]["vigente_desde"].startswith("202") and not res[1]["vigente_desde"].startswith("2020") and res[1]["creado_por"] == "ana"


# ── 5. Las categorías nunca se borran ni cambian de grupo ──────────────────────────────────────────
def test_una_version_nueva_debe_traer_todos_los_codigos_de_la_anterior(cluster, db):
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento"), nueva("cat2", "Internet", "operativo", "egresos")])
    res = agregar(cluster, db, C, BASE[C] + [nueva("cat2", "Internet", "operativo", "egresos")])
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
    assert res[3] == "No se pueden borrar categorías (cat1): se retiran, para que los gastos viejos se sigan mostrando.", res
    assert "cat1, cat2" in agregar(cluster, db, C, BASE[C])[3]                                  # los nombra a todos, en el orden en que estaban
    assert len(filas(cluster, db)) == 1                                                         # nada se guardó


def test_el_grupo_de_una_categoria_ya_creada_no_cambia_nunca(cluster, db):
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento", "otro")])
    res = agregar(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento", "nomina")])
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
    assert res[3] == "No se puede cambiar el grupo de una categoría ya creada (cat1): lo que ya se registró seguiría contándose distinto.", res
    # incluso hacia «excluido» (un gasto viejo dejaría de contar como egreso)
    assert agregar(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento", "excluido", "cierre")])[0] == "error"
    assert len(filas(cluster, db)) == 1


def test_retirar_reactivar_renombrar_y_cambiar_donde_si_se_puede(cluster, db):
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento")])
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento", activo=False)])
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1", "Mantenimiento y obras", "otro", "egresos", True)])
    assert [(f["valor"][-1]["nombre"], f["valor"][-1]["donde"], f["valor"][-1]["activo"]) for f in filas(cluster, db)] == [
        ("Mantenimiento", "ambos", True), ("Mantenimiento", "ambos", False), ("Mantenimiento y obras", "egresos", True)]


def test_el_orden_lo_decide_vigente_desde_el_mas_nuevo_y_no_el_id(cluster, db):
    """Si la fila más reciente por fecha es la de id más bajo (restauración), la regla mira ESA."""
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde) values "
                        f"(5, 'categorias_egresos', {lit(json.dumps(BASE[C] + [nueva('cat1')]))}::jsonb, '2030-01-01T00:00:00+00:00'),"
                        f" (9, 'categorias_egresos', {lit(json.dumps(BASE[C]))}::jsonb, '2029-01-01T00:00:00+00:00');")
    res = agregar(cluster, db, C, BASE[C])
    assert res[0] == "error" and "cat1" in res[3], res                                          # la de 2030 (id 5) manda


def test_un_valor_viejo_ilegible_no_estorba_la_regla(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (clave, valor) values ('categorias_egresos', '\"basura\"'::jsonb);")
    guardar_ok(cluster, db, C, BASE[C])


def test_las_cuentas_se_pueden_renombrar_las_veces_que_se_quiera(cluster, db):
    for i in range(4):
        v = copy.deepcopy(BASE[K]); v[i % 3]["nombre"] = f"Nombre {i}"
        guardar_ok(cluster, db, K, v)
    assert len(filas(cluster, db)) == 4


# ── 6. Lo de las etapas 1 y 2 sigue igual ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("clave,valor,codigo", [
    ("mesas", 12, "ok"), ("mesas", 61, "22023"), ("recargo_para_llevar", 1500, "ok"), ("recargo_para_llevar", -1, "22023"),
    ("negocio_nombre", "Café Lobo", "ok"), ("negocio_nombre", " Lobo", "22023"), ("negocio_emoji", "", "ok"),
    ("respaldo_rojo_dias", 6, "22023"), ("foo", 5, "22023"), ("categorias_otra", [], "22023"),
])
def test_las_claves_y_rangos_de_las_etapas_anteriores_no_cambiaron(cluster, db, clave, valor, codigo):
    res = agregar(cluster, db, clave, valor)
    assert (res[0] == "ok") == (codigo == "ok"), res
    if codigo != "ok":
        assert res[1] == codigo, res


def test_sigue_siendo_solo_agregar(cluster, db):
    guardar_ok(cluster, db, C, BASE[C])
    cluster.psql_ok(db, "create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);"
                        "create policy abierta_d on public.configuracion for delete to authenticated using (true);")
    for sentencia in ("update public.configuracion set valor = '[]' where id = 1", "delete from public.configuracion where id = 1"):
        res = llamar(cluster, db, "admin", f"with x as ({sentencia} returning 1) select json_agg(x)::text from x;")
        assert res[0] == "error" and res[1] == "42501" and res[2] == "configuracion_solo_agregar", res


@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_caja_respaldo_y_token_sin_rol_no_pueden_guardar(cluster, db, rol):
    for clave in (C, K):
        res = agregar(cluster, db, clave, BASE[clave], rol=rol)
        assert res[0] == "error" and res[1] == "42501", res
    assert filas(cluster, db) == []


def test_la_llave_publica_no_toca_la_configuracion(cluster, db):
    guardar_ok(cluster, db, C, BASE[C])
    res = llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res
    assert cluster.valor(db, "select has_schema_privilege('anon', 'seguridad', 'usage')") == "f"


def test_caja_y_respaldo_leen_lo_guardado(cluster, db):
    guardar_ok(cluster, db, C, BASE[C]); guardar_ok(cluster, db, K, BASE[K])
    for rol in ("admin", "caja", "respaldo"):
        assert llamar(cluster, db, rol, "select json_build_object('n', count(*))::text from public.configuracion where clave in ('categorias_egresos','nombres_cuentas');") == ("ok", {"n": 2}), rol


# ── 7. La restauración devuelve la historia tal cual (sin pasar por la validación) ───────────────────
def test_el_dueno_de_la_base_y_la_llave_de_servicio_restauran_sin_validacion_ni_sello(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                        f"(7, 'nombres_cuentas', {lit(json.dumps(BASE[K]))}::jsonb, '2026-09-01T15:00:00+00:00', 'luis', '2026-09-01T15:00:00+00:00');")
    res = llamar(cluster, db, None, "with i as (insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                 "(8, 'categorias_egresos', '[]'::jsonb, '2026-09-02T15:00:00+00:00', 'ana', '2026-09-02T15:00:00+00:00') returning *) select jsonb_agg(to_jsonb(i))::text from i;",
                 rol_pg="service_role", claims={"role": "service_role"})
    assert res[0] == "ok", res
    assert [(x["id"], x["creado_por"], x["vigente_desde"][:10]) for x in filas(cluster, db)] == [(7, "luis", "2026-09-01"), (8, "ana", "2026-09-02")]


# ── 8. Instalación: encima de la etapa 2, repetir y deshacer ─────────────────────────────────────────
FUNCIONES_E2 = ("configuracion_antes", "validar_configuracion", "validar_catalogo", "validar_catalogo_historia", "codigos_catalogo_base")
FUNCIONES_E4 = FUNCIONES_E2 + ("validar_categorias_egresos", "validar_nombres_cuentas", "categorias_egresos_base")


def huella(cluster, db, funciones):
    en = ",".join(f"'{f}'" for f in funciones)
    return {
        "funciones": cluster.valor(db, f"select json_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "permisos_funciones": cluster.valor(db, f"select json_agg(json_build_array(p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "disparadores": cluster.valor(db, "select json_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.configuracion'::regclass and not tgisinternal"),
        "politicas": cluster.valor(db, "select json_agg(json_build_array(policyname, cmd, roles::text, qual, with_check) order by policyname) from pg_policies where schemaname='public' and tablename='configuracion'"),
    }


def test_la_verificacion_del_final_dice_lo_esperado(cluster):
    base = cluster.base_nueva("cfg4_verif", plantilla="plantilla_e2")
    salida = cluster.psql_ok(base, ETAPA4.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]              # categorias_instaladas · disparador · anon_con_permisos


def test_instalar_sobre_una_base_nueva_y_sobre_una_que_ya_estaba_en_la_etapa_2_da_lo_mismo(cluster, db):
    actualizada = cluster.base_nueva("cfg4_actualizada", plantilla="plantilla_e2")
    cluster.psql_ok(actualizada, ETAPA4.read_text(encoding="utf-8"))
    assert huella(cluster, actualizada, FUNCIONES_E4) == huella(cluster, db, FUNCIONES_E4)
    assert agregar(cluster, actualizada, C, BASE[C])[0] == "ok"


def test_correrlo_dos_veces_no_rompe_nada_ni_pierde_el_historial(cluster, db):
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1")]); guardar_ok(cluster, db, K, BASE[K])
    antes, huella_antes = filas(cluster, db), huella(cluster, db, FUNCIONES_E4)
    cluster.psql_ok(db, ETAPA4.read_text(encoding="utf-8"))
    assert filas(cluster, db) == antes and huella(cluster, db, FUNCIONES_E4) == huella_antes
    assert agregar(cluster, db, C, BASE[C])[3].startswith("No se pueden borrar categorías (cat1)")    # y las reglas siguen funcionando


def test_sin_la_etapa_1_o_la_2_la_instalacion_se_niega_con_un_mensaje_claro(cluster):
    cluster.base_nueva("cfg4_sin_e1", plantilla="plantilla_base")
    codigo, _, avisos = cluster.psql("cfg4_sin_e1", ETAPA4.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg4_sin_e2", plantilla="plantilla_e1")
    codigo, _, avisos = cluster.psql("cfg4_sin_e2", ETAPA4.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_2.sql" in avisos, avisos[-400:]
    assert cluster.valor("cfg4_sin_e2", "select coalesce(to_regprocedure('seguridad.validar_categorias_egresos(jsonb)')::text, '')") == ""


def test_el_rollback_deja_la_etapa_2_tal_cual_sin_borrar_el_historial_y_se_puede_reinstalar(cluster, db):
    solo_e2 = cluster.base_nueva("cfg4_solo_e2", plantilla="plantilla_e2")
    huella_e2 = huella(cluster, solo_e2, FUNCIONES_E2)
    guardar_ok(cluster, db, C, BASE[C] + [nueva("cat1")]); guardar_ok(cluster, db, K, BASE[K])
    historial = filas(cluster, db)
    salida = cluster.psql_ok(db, ROLLBACK4.read_text(encoding="utf-8"))
    assert re.search(r"^\s*f\s*\|\s*1\s*$", salida, re.M), salida[-200:]                          # categorias_instaladas = false · disparador = 1
    assert huella(cluster, db, FUNCIONES_E2) == huella_e2                                          # funciones, permisos, disparador: los de la etapa 2
    assert filas(cluster, db) == historial                                                         # el historial NO se borra
    res = agregar(cluster, db, C, BASE[C])
    assert res[0] == "error" and res[2] == "configuracion_clave_desconocida", res                  # y la base ya no acepta listas nuevas
    assert agregar(cluster, db, "mesas", 12)[0] == "ok" and agregar(cluster, db, "catalogo_extras", [])[0] == "ok"   # lo demás sigue
    cluster.psql_ok(db, ROLLBACK4.read_text(encoding="utf-8"))                                     # dos veces: igual de tranquilo
    cluster.psql_ok(db, ETAPA4.read_text(encoding="utf-8"))                                        # y se vuelve a instalar, con el historial puesto
    assert agregar(cluster, db, C, BASE[C])[3].startswith("No se pueden borrar categorías (cat1)")
