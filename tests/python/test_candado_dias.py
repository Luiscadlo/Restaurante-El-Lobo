"""Pruebas del CANDADO DE DÍAS (sql/candado_dias.sql) contra un Postgres de verdad.

Qué comprueban (todo en una base desechable que imita a Supabase, con el ESQUEMA REAL de El Lobo
—sql/esquema_completo.sql— más las reglas de acceso y el candado; nunca tocan tu Supabase):

  · Cada caso de tests/fixtures/candado_casos.json (≈100 situaciones: hoy/ayer/antier, medianoche, las
    9:00 a. m., fin de mes, fiados viejos que se cobran hoy, deshacer pagos, agregar productos a pedidos
    pendientes viejos…) da exactamente lo esperado: lo que caja puede hacer HOY sigue funcionando, y lo que
    caja intente cambiar de un día cerrado lo rechaza la base con un mensaje claro. Los mismos casos los
    corre tests/candado-reglas.spec.js contra la copia en JS que usan las pruebas de pantalla.
  · El administrador (y la llave de servicio) no tienen candado. Leer días pasados sigue permitido.
  · El mensaje de rechazo: código 42501 (un 403, no un 401 que cerraría la sesión), DETAIL «candado_dias»,
    la fecha del registro y la indicación de pedírselo al administrador.
  · Es seguro correrlo dos veces; exige haber corrido antes la seguridad; el rollback lo quita por completo.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_candado_dias.py -q
"""
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CANDADO = RAIZ / "sql" / "candado_dias.sql"
ROLLBACK = RAIZ / "sql" / "rollback_candado.sql"
CASOS = json.loads((RAIZ / "tests" / "fixtures" / "candado_casos.json").read_text(encoding="utf-8"))

TABLAS_CON_CANDADO = ["abonos_fiado", "aperturas_turno", "cierres_dia", "consumos", "gastos_dia", "notas_dia", "pedidos"]
ID_FILA = 1000          # id de la fila "existente" que siembra cada caso
MATRIZ = json.loads((RAIZ / "sql" / "matriz_permisos.json").read_text(encoding="utf-8"))
CANTIDAD_POLITICAS = sum(1 for t in MATRIZ["tablas"] for letra in "SIUD" if any(letra in MATRIZ["roles"].get(r, {}).get(t, "") for r in MATRIZ["roles"]))

pytestmark = pytest.mark.skipif(not ESQUEMA.exists(), reason="Falta sql/esquema_completo.sql")


# ── Utilidades ──────────────────────────────────────────────────────────────
def lit(v):
    """Valor de Python → literal de SQL."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def insertar(tabla, fila):
    cols = ", ".join(fila)
    vals = ", ".join(lit(v) for v in fila.values())
    return f"insert into public.{tabla} ({cols}) values ({vals});"


def fijar_reloj(ahora):
    return ("create or replace function seguridad.ahora() returns timestamptz language sql stable as "
            f"$$ select timestamptz {lit(ahora)} $$;")


def como(rol_pg, claims, sentencias):
    """Bloque que corre las sentencias con ese rol y esas credenciales, una por una, y avisa el resultado de cada una."""
    cuerpos = []
    for i, s in enumerate(sentencias):
        cuerpos.append(
            "  begin\n"
            f"    execute $s${s}$s$;\n"
            "    get diagnostics n = row_count;\n"
            f"    raise notice 'RESULTADO|{i}|ok|%', n;\n"
            "  exception when others then\n"
            "    get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint, v_msg = message_text;\n"
            f"    raise notice 'RESULTADO|{i}|error|%|%|%|%', sqlstate, coalesce(v_detail, ''), coalesce(v_hint, ''), v_msg;\n"
            "  end;\n")
    return ("do $q$ declare n bigint; v_detail text; v_hint text; v_msg text; begin\n"
            f"  perform set_config('request.jwt.claims', {lit(json.dumps(claims))}, true);\n"
            f"  set local role {rol_pg};\n" + "".join(cuerpos) + "end $q$;\n")


def leer_resultados(avisos):
    """{indice: ('ok', filas) | ('error', sqlstate, detalle, mensaje, pista)}"""
    res = {}
    for linea in avisos.splitlines():
        m = re.search(r"RESULTADO\|(\d+)\|(ok|error)\|(.*)", linea)
        if not m:
            continue
        partes = m.group(3).split("|", 3)
        res[int(m.group(1))] = ("ok", int(partes[0])) if m.group(2) == "ok" else ("error", partes[0], partes[1], partes[3], partes[2])
    return res


def correr(cluster, siembra, ahora, rol, sentencias, claims=None, rol_pg="authenticated", db=None, reloj=True):
    """Siembra (como dueño de la base), fija el reloj, corre las sentencias como `rol` y deshace todo."""
    claims = claims if claims is not None else {"role": rol_pg, "app_metadata": {"rol": rol}}
    guion = ("begin;\n" + "\n".join(siembra) + "\n" + (fijar_reloj(ahora) if reloj else "") + "\n"
             + como(rol_pg, claims, sentencias) + "rollback;\n")
    _, _, avisos = cluster.psql(db or cluster.db_candado, guion, parar_en_error=False)
    res = leer_resultados(avisos)
    assert len(res) == len(sentencias), f"Se esperaban {len(sentencias)} resultados y llegaron {len(res)}.\n{avisos[-1500:]}"
    return [res[i] for i in range(len(sentencias))]


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    try:
        c.psql_ok("postgres", "create database plantilla_sin_candado;")
        c.preparar_supabase_falso("plantilla_sin_candado")
        c.psql_ok("plantilla_sin_candado", ESQUEMA.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_sin_candado", RLS.read_text(encoding="utf-8"))
        c.base_nueva("plantilla_con_candado", plantilla="plantilla_sin_candado")
        c.psql_ok("plantilla_con_candado", CANDADO.read_text(encoding="utf-8"))
        c.db_candado = "plantilla_con_candado"
        yield c
    finally:
        c.detener()


_n = [0]


@pytest.fixture()
def base_propia(cluster):
    """Una base nueva con seguridad + candado, para las pruebas que sí cambian la base."""
    _n[0] += 1
    return cluster.base_nueva(f"propia_{_n[0]}", plantilla="plantilla_con_candado")


# ── 1. Todos los casos ─────────────────────────────────────────────────────
def guion_de_caso(caso):
    tabla, op, base = caso["tabla"], caso["op"], CASOS["base"][caso["tabla"]]
    siembra = [insertar(s["tabla"], {**CASOS["base"].get(s["tabla"], {}), **s["fila"]}) for s in CASOS["siembra_comun"] + caso.get("semilla", [])]
    if op in ("U", "D"):
        siembra.append(insertar(tabla, {"id": ID_FILA, **base, **caso.get("antes", {})}))
    if op == "I":
        sentencia = insertar(tabla, {**base, **caso["despues"]})
    elif op == "U":
        cambios = ", ".join(f"{k} = {lit(v)}" for k, v in caso["despues"].items())
        sentencia = f"update public.{tabla} set {cambios} where id = {ID_FILA};"
    else:
        sentencia = f"delete from public.{tabla} where id = {ID_FILA};"
    return siembra, sentencia


@pytest.mark.parametrize("caso", CASOS["casos"], ids=[c["id"] for c in CASOS["casos"]])
def test_caso(cluster, caso):
    siembra, sentencia = guion_de_caso(caso)
    [resultado] = correr(cluster, siembra, caso.get("ahora", CASOS["ahora_por_defecto"]), caso["rol"], [sentencia])
    if caso["esperado"] == "ok":
        assert resultado == ("ok", 1), f"{caso['id']}: debía poder hacerse y salió {resultado}"
    else:
        assert resultado[0] == "error", f"{caso['id']}: debía rechazarse y salió {resultado}"
        assert resultado[1] == "42501" and resultado[2] == "candado_dias", f"{caso['id']}: se rechazó por otra razón: {resultado}"


def test_los_casos_cubren_todas_las_tablas_con_candado_y_los_tres_cambios():
    cubiertas = {(c["tabla"], c["op"]) for c in CASOS["casos"] if c["rol"] == "caja"}
    for t in TABLAS_CON_CANDADO:
        assert (t, "I") in cubiertas, f"ningún caso crea en {t}"
    for t in ["cierres_dia", "gastos_dia", "aperturas_turno", "pedidos"]:
        assert (t, "U") in cubiertas, f"ningún caso cambia {t}"
    for t in ["cierres_dia", "gastos_dia", "notas_dia", "pedidos"]:
        assert (t, "D") in cubiertas, f"ningún caso borra en {t}"
    assert {c["esperado"] for c in CASOS["casos"]} == {"ok", "bloqueado"}


# ── 2. El mensaje de rechazo ───────────────────────────────────────────────
def test_el_rechazo_dice_la_fecha_y_a_quien_pedirle_el_cambio(cluster):
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-10-19", "turno": "cena"})]
    [r] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", [f"delete from public.cierres_dia where id = {ID_FILA};"])
    assert r[:3] == ("error", "42501", "candado_dias")
    assert "19/10/2026" in r[3] and "administrador" in r[3] and "hoy" in r[3]


def test_el_rechazo_trae_la_pista_de_las_9_am(cluster):
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-10-19", "turno": "cena"})]
    [r] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", [f"delete from public.cierres_dia where id = {ID_FILA};"])
    assert r[:3] == ("error", "42501", "candado_dias")
    assert "9:00" in r[4] and "Bogotá" in r[4]


def test_si_son_dos_fechas_pasadas_el_mensaje_nombra_la_mas_vieja(cluster):
    """Llevar un registro de antier a ayer toca dos días cerrados: se nombra el más viejo."""
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-10-18", "turno": "cena"})]
    [r] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", [f"update public.cierres_dia set fecha = '2026-10-19' where id = {ID_FILA};"])
    assert r[:3] == ("error", "42501", "candado_dias")
    assert "18/10/2026" in r[3] and "19/10/2026" not in r[3]


def test_un_pedido_cobrado_con_fecha_de_pago_vieja_nombra_el_dia_del_cobro(cluster):
    """Si la fecha del pedido es de hoy pero su cobro es de ayer, el día cerrado es el del cobro."""
    fila = {**CASOS["base"]["pedidos"], "estado": "pagado", "fecha": "2026-10-20", "fecha_pago": "2026-10-19"}
    [r] = correr(cluster, [], "2026-10-20T14:00:00-05:00", "caja", [insertar("pedidos", fila)])
    assert r[:3] == ("error", "42501", "candado_dias")
    assert "19/10/2026" in r[3] and "20/10/2026" not in r[3]


def test_el_mensaje_no_se_confunde_con_los_avisos_de_columnas_faltantes():
    """El sistema, ante ciertos errores, reintenta sin una columna «que falta» (cuenta, turno, categoria…). El mensaje del
    candado no debe contener ninguno de esos nombres, o el sistema reintentaría en vez de avisar."""
    sql = CANDADO.read_text(encoding="utf-8")
    mensaje = re.search(r"message = format\('([^']+)'", sql).group(1).lower()
    html = (RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html").read_text(encoding="utf-8")
    nombres = set(re.findall(r"(?:msg|e\.message|\(e\.message \|\| ''\))\.includes\('([a-z_]+)'\)", html))
    for lista in re.findall(r"\[([^\]]*)\]\.(?:find|some)\(c => [^\n]*?msg\.includes\(c\)", html):
        nombres |= set(re.findall(r"'([a-z_]+)'", lista))
    assert {"turno", "cuenta", "categoria", "fecha_pago", "descuento"} <= nombres, "la búsqueda de nombres en el HTML dejó de funcionar"
    chocan = sorted(n for n in nombres if n in mensaje)
    assert chocan == [], f"el mensaje contiene {chocan}"


# ── 3. Quién queda fuera del candado, y qué sigue permitido ────────────────
def test_el_administrador_y_la_llave_de_servicio_no_tienen_candado(cluster):
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-10-10", "turno": "cena"})]
    sentencia = f"update public.cierres_dia set efectivo = 1 where id = {ID_FILA};"
    [admin] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "admin", [sentencia])
    assert admin == ("ok", 1)
    # La llave de servicio (la usa la restauración) no trae rol de la app.
    [servicio] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "", [sentencia],
                        claims={"role": "service_role"}, rol_pg="service_role")
    assert servicio == ("ok", 1)


def test_caja_sigue_pudiendo_LEER_dias_pasados(cluster):
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-09-01", "turno": "cena"}),
               insertar("pedidos", {"id": ID_FILA, **CASOS["base"]["pedidos"], "fecha": "2026-09-01", "estado": "pagado"})]
    r = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja",
               ["select 1 from public.cierres_dia where fecha = '2026-09-01';", "select 1 from public.pedidos where fecha = '2026-09-01';"])
    assert r == [("ok", 1), ("ok", 1)]


def test_una_secuencia_real_cobrar_un_fiado_viejo_y_deshacerlo(cluster):
    """Lo que hace la pantalla: cobra el fiado de hace días (pasa a hoy) y el ↩ lo devuelve. Después no puede tocar lo viejo."""
    siembra = [insertar("pedidos", {"id": ID_FILA, **CASOS["base"]["pedidos"], "fecha": "2026-10-15", "estado": "pendiente", "es_fiar": True})]
    r = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", [
        f"update public.pedidos set estado = 'pagado', fecha = '2026-10-20', fecha_original = '2026-10-15', metodo = 'efectivo' where id = {ID_FILA};",
        f"update public.pedidos set estado = 'pendiente', fecha = '2026-10-15', fecha_original = null where id = {ID_FILA};",
        f"update public.pedidos set estado = 'pagado', fecha = '2026-10-20', fecha_original = '2026-10-15', metodo = 'efectivo' where id = {ID_FILA};",
        f"update public.pedidos set fecha = '2026-10-01' where id = {ID_FILA};",
    ])
    assert r[:3] == [("ok", 1)] * 3
    assert r[3][:3] == ("error", "42501", "candado_dias")


def test_el_candado_no_cambia_lo_que_caja_ya_no_podia_hacer(cluster):
    """El candado se SUMA a la matriz de permisos: no abre nada. Caja sigue sin tocar egresos ni leer la auditoría."""
    siembra = [insertar("pedidos_eliminados", {"pedido_id": 1, "fecha": "2026-10-20"})]
    r = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", [
        "insert into public.egresos (fecha, cat, monto) values ('2026-10-20', 'otro', 1);",
        "select 1 from public.pedidos_eliminados;",
    ])
    assert r[0][0] == "error" and r[0][1] == "42501" and r[0][2] != "candado_dias"        # lo niega la matriz (RLS)
    assert r[1] == ("ok", 0)                                                                # existe la fila, pero caja no la ve


# ── 4. El día de negocio ───────────────────────────────────────────────────
@pytest.mark.parametrize("ahora, esperado", [
    ("2026-10-20T09:00:00-05:00", "2026-10-20"),
    ("2026-10-20T23:59:59-05:00", "2026-10-20"),
    ("2026-10-21T00:00:00-05:00", "2026-10-20"),
    ("2026-10-21T08:59:59-05:00", "2026-10-20"),
    ("2026-10-21T09:00:00-05:00", "2026-10-21"),
    ("2026-10-21T13:59:59Z", "2026-10-20"),       # 8:59:59 a. m. en Bogotá
    ("2026-10-21T14:00:00Z", "2026-10-21"),       # 9:00:00 a. m. en Bogotá
    ("2026-01-01T03:00:00-05:00", "2025-12-31"),  # cruce de año
    ("2028-03-01T05:00:00-05:00", "2028-02-29"),  # año bisiesto
])
def test_dia_de_negocio(cluster, ahora, esperado):
    guion = fijar_reloj(ahora) + " select seguridad.dia_negocio();"
    # fijar_reloj y la consulta van juntos en una transacción que se deshace
    salida = cluster.psql_ok(cluster.db_candado, "begin;\n" + guion + "\nrollback;\n")
    assert esperado in salida, salida


# ── 5. Aplicar, repetir, exigir la seguridad, deshacer ─────────────────────
def test_la_verificacion_final_cuenta_siete_candados(cluster):
    _, salida, _ = cluster.psql(cluster.db_candado, CANDADO.read_text(encoding="utf-8"))
    assert re.search(r"\b7\s*\|\s*\d{4}-\d{2}-\d{2}", salida), salida[-300:]
    filas = cluster.consulta(cluster.db_candado,
        "select c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid "
        "where g.tgname = 'lobo_candado_dias' and not g.tgisinternal order by 1")
    assert filas == TABLAS_CON_CANDADO


def test_aplicarlo_dos_veces_es_seguro(cluster, base_propia):
    cluster.psql_ok(base_propia, CANDADO.read_text(encoding="utf-8"))
    cluster.psql_ok(base_propia, CANDADO.read_text(encoding="utf-8"))
    assert cluster.consulta(base_propia, "select count(*) from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal") == ["7"]
    assert cluster.consulta(base_propia, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                         "where n.nspname = 'seguridad' and p.proname in ('ahora','dia_negocio','rechazar_dia_cerrado','candado_dias','candado_dias_pedidos')") == ["5"]


def test_sin_la_seguridad_previa_se_niega_y_no_deja_nada_a_medias(cluster):
    cluster.base_nueva("sin_seguridad", plantilla="plantilla_sin_candado")
    cluster.psql_ok("sin_seguridad", "drop function seguridad.rol_app() cascade;")
    codigo, _, avisos = cluster.psql("sin_seguridad", CANDADO.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "Primero corre sql/rls_seguridad.sql" in avisos
    assert cluster.consulta("sin_seguridad", "select count(*) from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal") == ["0"]
    assert cluster.consulta("sin_seguridad", "select to_regprocedure('seguridad.dia_negocio()') is null") == ["t"]


def test_si_falla_a_la_mitad_no_queda_nada_a_medias(cluster):
    """Aquí falta la tabla consumos: el script falla casi al final (al poner el último candado simple) y debe deshacer
    también las funciones y los candados que ya había creado."""
    cluster.base_nueva("a_medias", plantilla="plantilla_sin_candado")
    cluster.psql_ok("a_medias", "drop table public.consumos cascade;")
    codigo, _, avisos = cluster.psql("a_medias", CANDADO.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "consumos" in avisos
    assert cluster.consulta("a_medias", "select count(*) from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal") == ["0"]
    assert cluster.consulta("a_medias", "select to_regprocedure('seguridad.dia_negocio()') is null") == ["t"]
    assert cluster.consulta("a_medias", "select to_regprocedure('seguridad.candado_dias()') is null") == ["t"]


def _prueba_de_la_guia():
    """El SQL de comprobación que la guía de despliegue (Paso 6b) le pide correr al dueño en Supabase."""
    guia = (RAIZ / "docs" / "DESPLIEGUE_SEGURIDAD.md").read_text(encoding="utf-8")
    bloque = re.search(r"```sql\n(-- prueba-candado.*?)```", guia, re.S)
    assert bloque, "la guía ya no trae la prueba del candado (-- prueba-candado)"
    return bloque.group(1)


def test_la_prueba_de_la_guia_dice_BIEN_con_el_candado_y_MAL_sin_el(cluster, base_propia):
    """Esa comprobación termina a propósito con un error (así se deshace todo): con el candado dice BIEN, sin él dice MAL."""
    siembra = insertar("cierres_dia", {"id": ID_FILA, "fecha": (date.today() - timedelta(days=5)).isoformat(), "turno": "cena"})
    cluster.psql_ok(base_propia, siembra)
    _, _, avisos = cluster.psql(base_propia, _prueba_de_la_guia(), parar_en_error=False)
    assert "BIEN: el candado respondió: Caja solo puede cambiar lo de hoy" in avisos, avisos

    # Sin el candado (solo la seguridad), la misma comprobación dice MAL. dia_negocio() se pone a mano para que la consulta exista.
    sin = cluster.base_nueva("guia_sin_candado", plantilla="plantilla_sin_candado")
    cluster.psql_ok(sin, "create function seguridad.dia_negocio() returns date language sql stable as $$ select current_date $$;")
    cluster.psql_ok(sin, siembra)
    _, _, avisos = cluster.psql(sin, _prueba_de_la_guia(), parar_en_error=False)
    assert "MAL: caja pudo tocar" in avisos, avisos


def test_el_rollback_quita_todo_y_caja_vuelve_a_poder_como_antes(cluster, base_propia):
    siembra = [insertar("cierres_dia", {"id": ID_FILA, "fecha": "2026-10-19", "turno": "cena"})]
    sentencia = [f"update public.cierres_dia set efectivo = 1 where id = {ID_FILA};"]
    [antes] = correr(cluster, siembra, "2026-10-20T14:00:00-05:00", "caja", sentencia, db=base_propia)
    assert antes[:3] == ("error", "42501", "candado_dias")
    cluster.psql_ok(base_propia, ROLLBACK.read_text(encoding="utf-8"))
    assert cluster.consulta(base_propia, "select count(*) from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal") == ["0"]
    assert cluster.consulta(base_propia, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                         "where n.nspname = 'seguridad' and p.proname in ('ahora','dia_negocio','rechazar_dia_cerrado','candado_dias','candado_dias_pedidos')") == ["0"]
    # la seguridad (matriz) sigue en pie, y rol_app() también
    assert cluster.consulta(base_propia, "select count(*) from pg_policies where policyname like 'lobo\\_%'") == [str(CANTIDAD_POLITICAS)]
    assert cluster.consulta(base_propia, "select to_regprocedure('seguridad.rol_app()') is not null") == ["t"]
    [despues] = correr(cluster, siembra, None, "caja", sentencia, db=base_propia, reloj=False)
    assert despues == ("ok", 1)
    cluster.psql_ok(base_propia, ROLLBACK.read_text(encoding="utf-8"))          # y se puede repetir
