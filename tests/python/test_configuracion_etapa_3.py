"""Pruebas de los PLATOS DEL MENÚ (sql/configuracion_etapa_3.sql) contra un Postgres de verdad.

Misma base desechable que test_configuracion.py (imita a Supabase; esquema real de El Lobo + reglas de acceso + etapas 1, 2 y 4);
nunca toca tu Supabase. Qué comprueban:
  · La lista única de platos (sopas, arroces, proteínas, acompañamientos y asados) se guarda como UNA fila nueva cada vez,
    sellada por la base (fecha y autor), y las reglas se aplican aunque alguien se salte la pantalla: forma, largos, caracteres
    prohibidos, lista válida, código con el prefijo de su lista, sin repetidos (proteínas y asados cuentan como una sola lista),
    de 47 a 300 platos.
  · Un plato NUNCA se borra (se retira): cada versión debe traer todos los códigos de la anterior y los 47 de El Lobo, así los
    pedidos viejos siempre se pueden contar. Renombrar sí se puede las veces que se quiera.
  · Los casos de tests/fixtures/casos-platos.json (los mismos que usan las pruebas de la pantalla y del servidor falso) dan
    aquí el mismo veredicto y el MISMO mensaje: las tres reglas dicen lo mismo.
  · Lo de las etapas 1, 2 y 4 sigue igual (claves, rangos, catálogos, categorías, solo agregar, permisos).
  · La lista base que trae la página (JSON dentro del HTML) es exactamente la que exige la base.
  · Instalar encima de la etapa 4 y repetir no rompe nada; el rollback deja la etapa 4 tal cual (funciones idénticas) sin borrar
    el historial, y se puede volver a instalar.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_configuracion_etapa_3.py -q
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
from test_configuracion_etapa_4 import CASOS as CASOS_EGRESOS, armar as armar_egresos  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CONFIG = RAIZ / "sql" / "configuracion.sql"
ETAPA2 = RAIZ / "sql" / "configuracion_etapa_2.sql"
ETAPA4 = RAIZ / "sql" / "configuracion_etapa_4.sql"
ETAPA3 = RAIZ / "sql" / "configuracion_etapa_3.sql"
ROLLBACK3 = RAIZ / "sql" / "rollback_configuracion_etapa_3.sql"
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
CASOS = json.loads((RAIZ / "tests" / "fixtures" / "casos-platos.json").read_text(encoding="utf-8"))["casos"]

pytestmark = pytest.mark.skipif(not all(p.exists() for p in (ESQUEMA, CONFIG, ETAPA2, ETAPA4, ETAPA3)), reason="Falta el SQL")
_n = [0]
P = "menu_platos"


def leer_base():
    """La lista base vive en la página como JSON: se lee de ahí."""
    m = re.search(r"const PLATOS_BASE = Object\.freeze\((\[.*?\n\])\.map\(Object\.freeze\)\)", HTML.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(1))


BASE = leer_base()


def armar(caso):
    """El valor completo de un caso compartido (mismo algoritmo que la prueba de la pantalla)."""
    if "valor" in caso:
        return caso["valor"]
    v = copy.deepcopy(BASE)
    for i, cambios in (caso.get("mod") or {}).items():
        v[int(i)].update(cambios)
    for i, campos in (caso.get("sin") or {}).items():
        for campo in campos:
            del v[int(i)][campo]
    for i in sorted(caso.get("quitar") or [], reverse=True):
        del v[i]
    v += copy.deepcopy(caso.get("agregar") or [])
    for i in range(caso.get("relleno") or 0):
        v.append({"codigo": f"PT{28 + i}", "lista": "proteina", "nombre": f"Relleno {i + 1}", "activo": True})
    return v


def plato(cod, lista, nombre, activo=True):
    return {"codigo": cod, "lista": lista, "nombre": nombre, "activo": activo}


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
        c.psql_ok("plantilla_e4", ETAPA4.read_text(encoding="utf-8"))                       # etapa 4: hasta aquí, lo que ya está en producción
        c.base_nueva("plantilla_e3", plantilla="plantilla_e4")
        c.psql_ok("plantilla_e3", ETAPA3.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    return cluster.base_nueva(f"cfg3_{_n[0]}", plantilla="plantilla_e3")


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


def test_hay_casos_validos_e_invalidos():
    assert sum(1 for c in CASOS if c["mensaje"] is None) >= 15
    assert sum(1 for c in CASOS if c["mensaje"] is not None) >= 55


def test_un_codigo_con_salto_de_linea_al_final_no_pasa(cluster, db):
    """El «$» de la regla no deja pasar «SP10» + salto de línea (su mensaje lleva un salto de línea y psql lo parte: por eso no está en los casos compartidos)."""
    v = copy.deepcopy(BASE); v[0]["codigo"] = "SP10\n"
    res = agregar(cluster, db, P, v)
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida" and res[3].startswith('El código "SP10'), res
    assert filas(cluster, db) == []


def test_cada_caracter_prohibido_tiene_su_propio_caso():
    """Aprendido en la etapa 4: un símbolo que se escapa solo se descubre probando cada uno por separado."""
    con_caracter = [c["mod"]["0"]["nombre"] for c in CASOS if c.get("mod", {}).get("0", {}).get("nombre") and c["mensaje"] and c["mensaje"].startswith("Los nombres no pueden")]
    for ch in '<>&"\'`\\\n\x7f\t':
        assert any(ch in n for n in con_caracter), repr(ch)


# ── 2. Lo de las etapas 1, 2 y 4 se comporta exactamente igual con la etapa 3 puesta ─────────────────
@pytest.mark.parametrize("caso", CASOS_CATALOGO, ids=lambda c: "e2 · " + c["id"])
def test_los_casos_de_catalogos_de_la_etapa_2_siguen_dando_lo_mismo(cluster, db, caso):
    res = agregar(cluster, db, caso["clave"], armar_catalogo(caso))
    if caso["mensaje"] is None:
        assert res[0] == "ok", res
    else:
        assert res[0] == "error" and res[1] == "22023" and res[3] == caso["mensaje"], res


@pytest.mark.parametrize("caso", CASOS_EGRESOS, ids=lambda c: "e4 · " + c["id"])
def test_los_casos_de_egresos_y_cuentas_de_la_etapa_4_siguen_dando_lo_mismo(cluster, db, caso):
    res = agregar(cluster, db, caso["clave"], armar_egresos(caso))
    if caso["mensaje"] is None:
        assert res[0] == "ok", res
    else:
        assert res[0] == "error" and res[1] == "22023" and res[3] == caso["mensaje"], res


def test_las_reglas_de_historia_de_productos_y_categorias_siguen_igual(cluster, db):
    base = json.loads(cluster.valor(db, "select to_json(seguridad.codigos_catalogo_base('catalogo_rapidas'))"))
    rapidas = [{"codigo": c, "nombre": f"P {c}", "precio": 1000, "categoria": "X", "activo": True} for c in base]
    guardar_ok(cluster, db, "catalogo_rapidas", rapidas + [{"codigo": "X001", "nombre": "Flan", "precio": 6000, "categoria": "POSTRES", "activo": True}])
    res = agregar(cluster, db, "catalogo_rapidas", rapidas)
    assert res[0] == "error" and res[3] == "No se pueden borrar productos (X001): se retiran, para que los pedidos viejos se sigan mostrando.", res
    base_cat = json.loads(cluster.valor(db, "select seguridad.categorias_egresos_base()::text"))
    cats = [{"codigo": b["codigo"], "nombre": b["codigo"].capitalize(), "grupo": b["grupo"], "donde": "cierre" if b["grupo"] == "excluido" else "ambos", "activo": True} for b in base_cat]
    guardar_ok(cluster, db, "categorias_egresos", cats + [{"codigo": "cat1", "nombre": "Extra", "grupo": "otro", "donde": "ambos", "activo": True}])
    res = agregar(cluster, db, "categorias_egresos", cats)
    assert res[0] == "error" and res[3].startswith("No se pueden borrar categorías (cat1)"), res
    res = agregar(cluster, db, "categorias_egresos", cats + [{"codigo": "cat1", "nombre": "Extra", "grupo": "nomina", "donde": "ambos", "activo": True}])
    assert res[0] == "error" and res[3].startswith("No se puede cambiar el grupo de una categoría ya creada (cat1)"), res


# ── 3. La lista base de la página es la que exige la base ──────────────────────────────────────────
def test_la_lista_base_de_la_pagina_es_la_que_exige_la_base(cluster, db):
    sql = json.loads(cluster.valor(db, "select seguridad.menu_platos_base()::text"))
    assert [(x["codigo"], x["lista"]) for x in BASE] == [(x["codigo"], x["lista"]) for x in sql]
    guardar_ok(cluster, db, P, BASE)
    assert [f["clave"] for f in filas(cluster, db)] == [P]


def test_los_platos_de_siempre_de_la_pagina_son_los_de_el_lobo():
    por_lista = {l: [x["nombre"] for x in BASE if x["lista"] == l] for l in ("sopa", "arroz", "proteina", "acomp", "asado")}
    assert [len(v) for v in por_lista.values()] == [9, 5, 27, 3, 3]
    assert por_lista["sopa"][:2] == ["Sopa de Hueso", "Sopa de Queso"] and por_lista["acomp"] == ["Patacones", "Tajada madura", "Yuca Cocida"]
    assert por_lista["asado"] == ["Asado de cerdo", "Asado de pechuga", "Asado de Res"]
    assert por_lista["proteina"][-2:] == ["Pollo Frito/BBQ", "Pechuga en salsa"]            # las dos que solo tenía el generador del Menú
    assert all(x["activo"] is True for x in BASE) and len(BASE) == 47
    assert all(re.fullmatch({"sopa": "SP", "arroz": "AR", "proteina": "PT", "acomp": "AC", "asado": "AS"}[x["lista"]] + r"\d{2}", x["codigo"]) for x in BASE)


# ── 4. Cada guardado es una fila nueva, sellada por la base ────────────────────────────────────────
def test_cada_cambio_es_una_fila_nueva_sellada_y_lo_anterior_queda(cluster, db):
    primera = guardar_ok(cluster, db, P, BASE, correo="luisca@elobo.test")
    cambiado = copy.deepcopy(BASE); cambiado[0]["nombre"] = "Sopa de Huesos"
    segunda = guardar_ok(cluster, db, P, cambiado, correo="ana@elobo.test")
    assert (primera["id"], segunda["id"]) == (1, 2)
    assert (primera["creado_por"], segunda["creado_por"]) == ("luisca", "ana")
    assert [x["valor"][0]["nombre"] for x in filas(cluster, db)] == ["Sopa de Hueso", "Sopa de Huesos"]     # la versión vieja sigue ahí
    assert cluster.valor(db, "select bool_and(abs(extract(epoch from now() - vigente_desde)) < 60) from public.configuracion") == "t"


def test_nadie_puede_escribir_con_fecha_o_autor_inventados(cluster, db):
    res = agregar(cluster, db, P, BASE, extra="vigente_desde='2020-01-01T00:00:00+00:00'", correo="ana@elobo.test")
    assert res[0] == "ok", res
    assert res[1]["vigente_desde"].startswith("202") and not res[1]["vigente_desde"].startswith("2020") and res[1]["creado_por"] == "ana"


# ── 5. Los platos nunca se borran ──────────────────────────────────────────────────────────────────
def test_una_version_nueva_debe_traer_todos_los_codigos_de_la_anterior(cluster, db):
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Sopa de Mondongo"), plato("PT28", "proteina", "Cerdo Agridulce")])
    res = agregar(cluster, db, P, BASE + [plato("PT28", "proteina", "Cerdo Agridulce")])
    assert res[0] == "error" and res[1] == "22023" and res[2] == "configuracion_invalida", res
    assert res[3] == "No se pueden borrar platos (SP10): se retiran, para que los pedidos viejos se sigan contando.", res
    assert "SP10, PT28" in agregar(cluster, db, P, BASE)[3]                                    # los nombra a todos, en el orden en que estaban
    assert len(filas(cluster, db)) == 1                                                        # nada se guardó


def test_retirar_reactivar_y_renombrar_si_se_puede_las_veces_que_se_quiera(cluster, db):
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Sopa de Mondongo")])
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Sopa de Mondongo", False)])
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Mondongo", True)])
    for i in range(4):
        v = copy.deepcopy(BASE) + [plato("SP10", "sopa", "Mondongo")]; v[0]["nombre"] = f"Sopa número {i}"
        guardar_ok(cluster, db, P, v)
    ultimos = [(f["valor"][-1]["nombre"], f["valor"][-1]["activo"]) for f in filas(cluster, db)][:3]
    assert ultimos == [("Sopa de Mondongo", True), ("Sopa de Mondongo", False), ("Mondongo", True)]
    assert len(filas(cluster, db)) == 7


def test_un_nombre_viejo_se_puede_volver_a_usar_en_otro_plato(cluster, db):
    """Renombrar X → Y y después crear otro plato llamado X es válido (el reporte lo distingue por la fecha del pedido)."""
    v1 = copy.deepcopy(BASE); v1[0]["nombre"] = "Sopa de Huesos"
    guardar_ok(cluster, db, P, v1)
    guardar_ok(cluster, db, P, v1 + [plato("SP10", "sopa", "Sopa de Hueso")])
    assert len(filas(cluster, db)) == 2


def test_el_orden_lo_decide_vigente_desde_el_mas_nuevo_y_no_el_id(cluster, db):
    """Si la fila más reciente por fecha es la de id más bajo (restauración), la regla mira ESA."""
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde) values "
                        f"(5, 'menu_platos', {lit(json.dumps(BASE + [plato('SP10', 'sopa', 'Sopa nueva')]))}::jsonb, '2030-01-01T00:00:00+00:00'),"
                        f" (9, 'menu_platos', {lit(json.dumps(BASE))}::jsonb, '2029-01-01T00:00:00+00:00');")
    res = agregar(cluster, db, P, BASE)
    assert res[0] == "error" and "SP10" in res[3], res                                          # la de 2030 (id 5) manda


def test_un_valor_viejo_ilegible_no_estorba_la_regla(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (clave, valor) values ('menu_platos', '\"basura\"'::jsonb);")
    guardar_ok(cluster, db, P, BASE)


# ── 6. Lo de las etapas anteriores sigue igual ───────────────────────────────────────────────────
@pytest.mark.parametrize("clave,valor,codigo", [
    ("mesas", 12, "ok"), ("mesas", 61, "22023"), ("recargo_para_llevar", 1500, "ok"), ("recargo_para_llevar", -1, "22023"),
    ("negocio_nombre", "Café Lobo", "ok"), ("negocio_nombre", " Lobo", "22023"), ("negocio_emoji", "", "ok"),
    ("respaldo_rojo_dias", 6, "22023"), ("foo", 5, "22023"), ("menu_otro", [], "22023"), ("catalogo_extras", [], "ok"),
])
def test_las_claves_y_rangos_de_las_etapas_anteriores_no_cambiaron(cluster, db, clave, valor, codigo):
    res = agregar(cluster, db, clave, valor)
    assert (res[0] == "ok") == (codigo == "ok"), res
    if codigo != "ok":
        assert res[1] == codigo, res


def test_sigue_siendo_solo_agregar(cluster, db):
    guardar_ok(cluster, db, P, BASE)
    cluster.psql_ok(db, "create policy abierta_u on public.configuracion for update to authenticated using (true) with check (true);"
                        "create policy abierta_d on public.configuracion for delete to authenticated using (true);")
    for sentencia in ("update public.configuracion set valor = '[]' where id = 1", "delete from public.configuracion where id = 1"):
        res = llamar(cluster, db, "admin", f"with x as ({sentencia} returning 1) select json_agg(x)::text from x;")
        assert res[0] == "error" and res[1] == "42501" and res[2] == "configuracion_solo_agregar", res


@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_caja_respaldo_y_token_sin_rol_no_pueden_guardar(cluster, db, rol):
    res = agregar(cluster, db, P, BASE, rol=rol)
    assert res[0] == "error" and res[1] == "42501", res
    assert filas(cluster, db) == []


def test_la_llave_publica_no_toca_la_configuracion(cluster, db):
    guardar_ok(cluster, db, P, BASE)
    res = llamar(cluster, db, None, "select json_build_object('n', count(*))::text from public.configuracion;", rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501", res
    assert cluster.valor(db, "select has_schema_privilege('anon', 'seguridad', 'usage')") == "f"


def test_caja_y_respaldo_leen_lo_guardado(cluster, db):
    guardar_ok(cluster, db, P, BASE)
    for rol in ("admin", "caja", "respaldo"):
        assert llamar(cluster, db, rol, "select json_build_object('n', count(*))::text from public.configuracion where clave = 'menu_platos';") == ("ok", {"n": 1}), rol


# ── 7. La restauración devuelve la historia tal cual (sin pasar por la validación) ───────────────────
def test_el_dueno_de_la_base_y_la_llave_de_servicio_restauran_sin_validacion_ni_sello(cluster, db):
    cluster.psql_ok(db, "insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                        f"(7, 'menu_platos', {lit(json.dumps(BASE))}::jsonb, '2026-09-01T15:00:00+00:00', 'luis', '2026-09-01T15:00:00+00:00');")
    res = llamar(cluster, db, None, "with i as (insert into public.configuracion (id, clave, valor, vigente_desde, creado_por, creado_en) values "
                 "(8, 'menu_platos', '[]'::jsonb, '2026-09-02T15:00:00+00:00', 'ana', '2026-09-02T15:00:00+00:00') returning *) select jsonb_agg(to_jsonb(i))::text from i;",
                 rol_pg="service_role", claims={"role": "service_role"})
    assert res[0] == "ok", res
    assert [(x["id"], x["creado_por"], x["vigente_desde"][:10]) for x in filas(cluster, db)] == [(7, "luis", "2026-09-01"), (8, "ana", "2026-09-02")]


# ── 8. Instalación: encima de la etapa 4, repetir y deshacer ─────────────────────────────────────────
FUNCIONES_E4 = ("configuracion_antes", "validar_configuracion", "validar_catalogo", "validar_catalogo_historia", "codigos_catalogo_base",
                "validar_categorias_egresos", "validar_nombres_cuentas", "categorias_egresos_base")
FUNCIONES_E3 = FUNCIONES_E4 + ("validar_menu_platos", "menu_platos_base")


def huella(cluster, db, funciones):
    en = ",".join(f"'{f}'" for f in funciones)
    return {
        "funciones": cluster.valor(db, f"select json_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "permisos_funciones": cluster.valor(db, f"select json_agg(json_build_array(p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='seguridad' and p.proname in ({en})"),
        "disparadores": cluster.valor(db, "select json_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.configuracion'::regclass and not tgisinternal"),
        "politicas": cluster.valor(db, "select json_agg(json_build_array(policyname, cmd, roles::text, qual, with_check) order by policyname) from pg_policies where schemaname='public' and tablename='configuracion'"),
    }


def test_la_verificacion_del_final_dice_lo_esperado(cluster):
    base = cluster.base_nueva("cfg3_verif", plantilla="plantilla_e4")
    salida = cluster.psql_ok(base, ETAPA3.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*\|\s*1\s*\|\s*f\s*$", salida, re.M), salida[-300:]              # platos_instalados · disparador · anon_con_permisos


def test_instalar_sobre_una_base_nueva_y_sobre_una_que_ya_estaba_en_la_etapa_4_da_lo_mismo(cluster, db):
    actualizada = cluster.base_nueva("cfg3_actualizada", plantilla="plantilla_e4")
    cluster.psql_ok(actualizada, ETAPA3.read_text(encoding="utf-8"))
    assert huella(cluster, actualizada, FUNCIONES_E3) == huella(cluster, db, FUNCIONES_E3)
    assert agregar(cluster, actualizada, P, BASE)[0] == "ok"


def test_correrlo_dos_veces_no_rompe_nada_ni_pierde_el_historial(cluster, db):
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Sopa de Mondongo")])
    antes, huella_antes = filas(cluster, db), huella(cluster, db, FUNCIONES_E3)
    cluster.psql_ok(db, ETAPA3.read_text(encoding="utf-8"))
    assert filas(cluster, db) == antes and huella(cluster, db, FUNCIONES_E3) == huella_antes
    assert agregar(cluster, db, P, BASE)[3].startswith("No se pueden borrar platos (SP10)")     # y las reglas siguen funcionando


def test_sin_la_etapa_1_2_o_4_la_instalacion_se_niega_con_un_mensaje_claro(cluster):
    cluster.base_nueva("cfg3_sin_e1", plantilla="plantilla_base")
    codigo, _, avisos = cluster.psql("cfg3_sin_e1", ETAPA3.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg3_sin_e2", plantilla="plantilla_e1")
    codigo, _, avisos = cluster.psql("cfg3_sin_e2", ETAPA3.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_2.sql" in avisos, avisos[-400:]
    cluster.base_nueva("cfg3_sin_e4", plantilla="plantilla_e2")                                  # el orden importa: 2 → 4 → 3
    codigo, _, avisos = cluster.psql("cfg3_sin_e4", ETAPA3.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "sql/configuracion_etapa_4.sql" in avisos, avisos[-400:]
    assert cluster.valor("cfg3_sin_e4", "select coalesce(to_regprocedure('seguridad.validar_menu_platos(jsonb)')::text, '')") == ""


def test_el_rollback_deja_la_etapa_4_tal_cual_sin_borrar_el_historial_y_se_puede_reinstalar(cluster, db):
    solo_e4 = cluster.base_nueva("cfg3_solo_e4", plantilla="plantilla_e4")
    huella_e4 = huella(cluster, solo_e4, FUNCIONES_E4)
    guardar_ok(cluster, db, P, BASE + [plato("SP10", "sopa", "Sopa de Mondongo")])
    historial = filas(cluster, db)
    salida = cluster.psql_ok(db, ROLLBACK3.read_text(encoding="utf-8"))
    assert re.search(r"^\s*t\s*$", salida, re.M), salida[-200:]                                    # platos_quitados = true
    assert huella(cluster, db, FUNCIONES_E4) == huella_e4                                          # funciones, permisos, disparador: los de la etapa 4
    assert filas(cluster, db) == historial                                                         # el historial NO se borra
    res = agregar(cluster, db, P, BASE)
    assert res[0] == "error" and res[2] == "configuracion_clave_desconocida", res                  # y la base ya no acepta platos nuevos
    assert agregar(cluster, db, "mesas", 12)[0] == "ok" and agregar(cluster, db, "catalogo_extras", [])[0] == "ok"   # lo demás sigue
    cluster.psql_ok(db, ROLLBACK3.read_text(encoding="utf-8"))                                     # dos veces: igual de tranquilo
    cluster.psql_ok(db, ETAPA3.read_text(encoding="utf-8"))                                        # y se vuelve a instalar, con el historial puesto
    assert agregar(cluster, db, P, BASE)[3].startswith("No se pueden borrar platos (SP10)")
