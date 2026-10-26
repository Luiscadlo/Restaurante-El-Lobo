"""Pruebas de la SEGURIDAD (RLS) contra un Postgres de verdad.

Aplica sql/rls_seguridad.sql en una base temporal que imita a Supabase (roles anon / authenticated /
service_role y la función auth.jwt()) y comprueba, perfil por perfil, tabla por tabla y operación por
operación, que se cumple EXACTAMENTE la matriz de permisos (sql/matriz_permisos.json):

  · admin, caja y respaldo pueden lo que dice la matriz — y nada más;
  · un usuario sin rol, con un rol inventado, con el rol puesto en user_metadata (que el propio usuario
    puede editar) o la llave pública sola (anon) no pueden NADA, en ninguna tabla;
  · una tabla que no está en la lista también queda cerrada;
  · el SQL es seguro de correr dos veces, y el rollback devuelve todo a como estaba.

No toca tu Supabase: levanta un Postgres desechable en una carpeta temporal y lo borra al terminar.
Hace falta tener PostgreSQL instalado (los programas initdb, pg_ctl y psql). Si no está, estas pruebas
se saltan solas (no fallan).

Correr desde la raíz del repo:  python -m pytest tests/python/test_rls.py -q
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
MATRIZ_JSON = RAIZ / "sql" / "matriz_permisos.json"
SQL_APLICAR = RAIZ / "sql" / "rls_seguridad.sql"
SQL_REVERTIR = RAIZ / "sql" / "rollback_rls.sql"
GENERADOR = RAIZ / "herramientas" / "generar_rls.py"

MATRIZ = json.loads(MATRIZ_JSON.read_text(encoding="utf-8"))
TABLAS = MATRIZ["tablas"]
OPERACIONES = ["S", "I", "R", "U", "D"]   # R = insertar Y recibir la fila de vuelta (lo que hace el sistema: return=representation)


# ── Un Postgres desechable (ver pgtemporal.py) ───────────────────────────────
class Cluster(ClusterTemporal):
    def __init__(self):
        super().__init__()
        self._preparar_plantilla()

    # Base "plantilla": imita lo que Supabase ya trae + las 16 tablas (id, v) con una fila de ejemplo.
    def _preparar_plantilla(self):
        self.psql_ok("postgres", "create database lobo_plantilla;")
        tablas = TABLAS + ["tabla_desconocida"]
        crear = "\n".join(
            f"create table public.{t} (id bigserial primary key, v text);\ninsert into public.{t} (v) values ('semilla');"
            for t in tablas)
        self.preparar_supabase_falso("lobo_plantilla")
        self.psql_ok("lobo_plantilla", crear)

    def base_nueva(self, nombre):
        return super().base_nueva(nombre, plantilla="lobo_plantilla")


@pytest.fixture(scope="module")
def cluster():
    c = None
    try:
        c = Cluster()
        yield c
    finally:
        if c is not None:
            c.detener()


_contador = [0]


@pytest.fixture()
def base(cluster):
    """Una base nueva (copia de la plantilla) para cada prueba."""
    _contador[0] += 1
    return cluster.base_nueva(f"caso_{_contador[0]}")


@pytest.fixture()
def base_con_seguridad(cluster, base):
    cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    return base


# Las reglas "allow all" que trae la base REAL de El Lobo (tomadas de su esquema el 2026-10-24): para todos
# (rol "public", que incluye a los usuarios con sesión), todo permitido. Si el SQL de seguridad no las retira,
# se SUMAN a las nuevas y dejan pasar a caja a tablas de dueños.
TABLAS_CON_REGLA_VIEJA = ["aperturas_turno", "ingresos_extra", "movimientos_caja", "notas_dia", "pedidos_eliminados"]
REGLAS_VIEJAS_SQL = "\n".join(
    f'alter table public.{t} enable row level security;\n'
    f'create policy "allow all {t}" on public.{t} as permissive for all to public using (true) with check (true);'
    for t in TABLAS_CON_REGLA_VIEJA)


@pytest.fixture()
def base_con_reglas_viejas(cluster, base):
    cluster.psql_ok(base, REGLAS_VIEJAS_SQL)
    return base


# ── Perfiles que se prueban ─────────────────────────────────────────────────
PERFILES = {
    "admin":   ("authenticated", {"app_metadata": {"rol": "admin"}}),
    "caja":    ("authenticated", {"app_metadata": {"rol": "caja"}}),
    "respaldo": ("authenticated", {"app_metadata": {"rol": "respaldo"}}),
    # Ninguno de estos debe poder nada:
    "sin_rol": ("authenticated", {"app_metadata": {}}),
    "rol_inventado": ("authenticated", {"app_metadata": {"rol": "superadmin"}}),
    "rol_con_mayuscula": ("authenticated", {"app_metadata": {"rol": "Admin"}}),
    "rol_en_user_metadata": ("authenticated", {"app_metadata": {}, "user_metadata": {"rol": "admin"}}),
    "rol_en_raiz_del_token": ("authenticated", {"rol": "admin", "role": "authenticated"}),
    "llave_publica": ("anon", {"role": "anon"}),
}
PERFILES_CON_ROL = ["admin", "caja", "respaldo"]


def _sql_caso(perfil, tabla, op):
    rol_pg, claims = PERFILES[perfil]
    claims_sql = json.dumps(claims).replace("'", "''")
    cuerpos = {
        "S": ("execute 'select count(*) from public.%s' into n; ok := n > 0;" % tabla),
        "I": ("execute 'insert into public.%s (v) values (''x'')'; ok := true;" % tabla),
        "R": ("execute 'insert into public.%s (v) values (''x'') returning id' into n; ok := n is not null;" % tabla),
        "U": ("execute 'update public.%s set v = ''y'' where id >= 0' ; get diagnostics n = row_count; ok := n > 0;" % tabla),
        "D": ("execute 'delete from public.%s where id >= 0'; get diagnostics n = row_count; ok := n > 0;" % tabla),
    }
    return (
        "begin;\n"
        "do $$ declare n bigint; ok boolean := false; begin\n"
        "  begin\n"
        f"    perform set_config('request.jwt.claims', '{claims_sql}', true);\n"
        f"    set local role {rol_pg};\n"
        f"    {cuerpos[op]}\n"
        "  exception when others then ok := false; end;\n"
        f"  raise notice 'RESULTADO|{perfil}|{tabla}|{op}|%', ok;\n"
        "end $$;\n"
        "rollback;\n"
    )


def _resultados(cluster, db, perfiles, tablas, ops):
    sql = "".join(_sql_caso(p, t, o) for p in perfiles for t in tablas for o in ops)
    codigo, _, avisos = cluster.psql(db, sql, parar_en_error=False)
    encontrados = {}
    for perfil, tabla, op, ok in re.findall(r"RESULTADO\|([^|]+)\|([^|]+)\|([^|]+)\|(\w+)", avisos):
        encontrados[(perfil, tabla, op)] = (ok == "t")   # Postgres imprime los booleanos como t / f
    esperados = len(perfiles) * len(tablas) * len(ops)
    assert len(encontrados) == esperados, f"Se esperaban {esperados} resultados y llegaron {len(encontrados)}.\n{avisos[-2000:]}"
    return encontrados


def _esperado(perfil, tabla, op):
    if perfil not in PERFILES_CON_ROL:
        return False
    ops = MATRIZ["roles"].get(perfil, {}).get(tabla, "")
    if op == "R":
        return "I" in ops and "S" in ops
    if op in ("U", "D"):
        return op in ops and "S" in ops          # PostgREST siempre filtra (WHERE) → hace falta poder leer la fila
    return op in ops


# ── Pruebas ─────────────────────────────────────────────────────────────────
def test_la_matriz_es_coherente():
    """Sin esto el sistema no podría usar la matriz: modificar o borrar exige poder leer."""
    for rol, permisos in MATRIZ["roles"].items():
        for tabla, ops in permisos.items():
            assert tabla in TABLAS, f"{rol}: '{tabla}' no está en la lista de tablas"
            if "U" in ops or "D" in ops:
                assert "S" in ops, f"{rol} puede modificar/borrar {tabla} pero no leerla (PostgREST filtra por fila: no funcionaría)"
    # respaldo: nunca escribe
    for tabla, ops in MATRIZ["roles"]["respaldo"].items():
        assert set(ops) <= {"S"}, f"respaldo no debe escribir en {tabla}"
    # admin: todo
    assert all(MATRIZ["roles"]["admin"].get(t) == "SIUD" for t in TABLAS)


def test_el_sql_esta_al_dia_con_la_matriz():
    r = subprocess.run([sys.executable, "-I", str(GENERADOR), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_la_matriz_se_cumple_tabla_por_tabla(cluster, base_con_seguridad):
    """El corazón: 9 perfiles × 17 tablas × 5 operaciones, contra Postgres de verdad."""
    obtenido = _resultados(cluster, base_con_seguridad, list(PERFILES), TABLAS + ["tabla_desconocida"], OPERACIONES)
    diferencias = []
    for (perfil, tabla, op), ok in sorted(obtenido.items()):
        esp = _esperado(perfil, tabla, op)
        if ok != esp:
            diferencias.append(f"{perfil} {op} {tabla}: obtuvo {'PERMITIDO' if ok else 'negado'}, la matriz dice {'permitido' if esp else 'negado'}")
    assert not diferencias, "\n".join(diferencias)


def test_sin_aplicar_la_seguridad_el_resultado_seria_otro(cluster, base):
    """Control negativo: sin el SQL, la llave pública SÍ lee todo (así se comprueba que la prueba de arriba mide algo)."""
    obtenido = _resultados(cluster, base, ["llave_publica"], ["pedidos", "egresos"], ["S"])
    assert obtenido[("llave_publica", "pedidos", "S")] is True
    assert obtenido[("llave_publica", "egresos", "S")] is True


def test_caja_agrega_a_la_auditoria_pero_no_la_lee_ni_la_toca(cluster, base_con_seguridad):
    obtenido = _resultados(cluster, base_con_seguridad, ["caja"], ["pedidos_eliminados", "pedidos_descuentos"], OPERACIONES)
    for tabla in ["pedidos_eliminados", "pedidos_descuentos"]:
        assert obtenido[("caja", tabla, "I")] is True       # puede dejar su rastro…
        assert obtenido[("caja", tabla, "R")] is False      # …pero no pedir la fila de vuelta (el sistema usa return=minimal)
        assert obtenido[("caja", tabla, "S")] is False
        assert obtenido[("caja", tabla, "U")] is False
        assert obtenido[("caja", tabla, "D")] is False


def test_las_tablas_de_finanzas_estan_cerradas_para_caja(cluster, base_con_seguridad):
    obtenido = _resultados(cluster, base_con_seguridad, ["caja"], ["egresos", "movimientos_caja", "ingresos_extra"], OPERACIONES)
    assert not any(obtenido.values())


def test_rls_queda_activo_en_todas_las_tablas_incluida_una_desconocida(cluster, base_con_seguridad):
    filas = cluster.consulta(base_con_seguridad,
        "select c.relname || '|' || c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r'")
    estado = dict(f.split("|") for f in filas)
    assert estado, "no se encontraron tablas"
    assert all(v == "true" for v in estado.values()), {k: v for k, v in estado.items() if v != "true"}
    assert "tabla_desconocida" in estado


def test_una_tabla_creada_despues_queda_cerrada_para_la_llave_publica(cluster, base_con_seguridad):
    cluster.psql_ok(base_con_seguridad, "create table public.tabla_nueva (id bigserial primary key, v text); insert into public.tabla_nueva (v) values ('x');")
    sql = ("begin; do $$ declare n bigint; ok boolean := false; begin begin "
           "perform set_config('request.jwt.claims', '{\"role\":\"anon\"}', true); set local role anon; "
           "execute 'select count(*) from public.tabla_nueva' into n; ok := n > 0; "
           "exception when others then ok := false; end; raise notice 'RESULTADO|%', ok; end $$; rollback;")
    _, _, avisos = cluster.psql(base_con_seguridad, sql, parar_en_error=False)
    assert "RESULTADO|f" in avisos


def test_aplicar_dos_veces_es_seguro_y_conserva_el_estado_original(cluster, base):
    cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    # el "estado previo" guarda cómo estaba ANTES de la primera vez (RLS apagado, anon leía)
    filas = cluster.consulta(base, "select tabla || '|' || rls_activo || '|' || anon_leia from seguridad.estado_previo order by 1")
    assert len(filas) == len(TABLAS) + 1
    assert all(f.endswith("|false|true") for f in filas), filas
    # y las políticas no se duplicaron
    n = int(cluster.consulta(base, "select count(*) from pg_policies where schemaname = 'public'")[0])
    esperadas = sum(1 for t in TABLAS for letra in "SIUD" if any(letra in MATRIZ["roles"].get(r, {}).get(t, "") for r in PERFILES_CON_ROL))
    assert n == esperadas


def test_rollback_devuelve_todo_a_como_estaba(cluster, base):
    # Antes: una tabla con su propio RLS y su propia política, que NO deben tocarse.
    cluster.psql_ok(base, """
        alter table public.config enable row level security;
        create policy mi_politica_propia on public.config for select to anon using (true);
    """)
    cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    cluster.psql_ok(base, SQL_REVERTIR.read_text(encoding="utf-8"))
    # ya no hay políticas lobo_*
    assert cluster.consulta(base, "select count(*) from pg_policies where policyname like 'lobo\\_%'") == ["0"]
    # la política propia sigue y config conserva su RLS
    assert cluster.consulta(base, "select policyname from pg_policies where schemaname = 'public'") == ["mi_politica_propia"]
    estado = dict(f.split("|") for f in cluster.consulta(base,
        "select c.relname || '|' || c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r'"))
    assert estado["config"] == "true"
    assert estado["pedidos"] == "false" and estado["egresos"] == "false"
    # y la llave pública vuelve a leer lo que leía (pedidos sin RLS)
    obtenido = _resultados(cluster, base, ["llave_publica"], ["pedidos", "egresos"], ["S", "I"])
    assert all(obtenido.values())


def test_la_llave_publica_no_tiene_politicas_ni_permisos_de_tabla(cluster, base_con_seguridad):
    """Doble cerradura: ni una política que la deje pasar, ni permiso de tabla (el REVOKE)."""
    # Ninguna política menciona a anon ni a "public" (todos)
    assert cluster.consulta(base_con_seguridad,
        "select count(*) from pg_policies where schemaname = 'public' and (roles && array['anon','public']::name[])") == ["0"]
    # Todas las políticas son solo para usuarios con sesión
    assert cluster.consulta(base_con_seguridad,
        "select distinct array_to_string(roles, ',') from pg_policies where schemaname = 'public'") == ["authenticated"]
    # anon no tiene ningún permiso sobre ninguna tabla
    assert cluster.consulta(base_con_seguridad,
        "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' "
        "and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'select,insert,update,delete')") == ["0"]


def test_una_vista_no_es_una_puerta_trasera(cluster, base):
    """En Supabase las vistas se saltan el RLS salvo que sean 'security_invoker'. El SQL las corrige."""
    cluster.psql_ok(base, "create view public.vista_ventas as select id, v from public.pedidos;"
                          "grant select on public.vista_ventas to authenticated;")
    # (simula la vista de Supabase: dueña postgres → se salta el RLS de pedidos)
    cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    sql = ""
    for perfil in ["sin_rol", "caja", "respaldo"]:
        rol_pg, claims = PERFILES[perfil]
        sql += ("begin; do $$ declare n bigint; ok boolean := false; begin begin "
                f"perform set_config('request.jwt.claims', '{json.dumps(claims)}', true); set local role {rol_pg}; "
                "execute 'select count(*) from public.vista_ventas' into n; ok := n > 0; "
                f"exception when others then ok := false; end; raise notice 'VISTA|{perfil}|%', ok; end $$; rollback;")
    _, _, avisos = cluster.psql(base, sql, parar_en_error=False)
    assert "VISTA|sin_rol|f" in avisos            # sin rol: no ve nada por la vista
    assert "VISTA|caja|t" in avisos               # caja (que sí lee pedidos) sigue pudiendo
    assert "VISTA|respaldo|t" in avisos
    # y la verificación final del script lo confirma
    assert cluster.consulta(base,
        "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' "
        "and not coalesce('security_invoker=true' = any(c.reloptions), false)") == ["0"]


def test_la_verificacion_final_da_lo_esperado(cluster, base):
    salida = cluster.psql_ok(base, SQL_APLICAR.read_text(encoding="utf-8"))
    # la última consulta del script: tablas_sin_rls | vistas_sin_proteger | anon_con_permisos | politicas | reglas_ajenas_abiertas
    ultima = [l for l in salida.strip().split("\n") if re.match(r"^\s*\d+(\s*\|\s*\d+){4}\s*$", l)]
    assert ultima, salida
    sin_rls, vistas, anon, politicas, ajenas = [int(x) for x in ultima[-1].split("|")]
    assert (sin_rls, vistas, anon, ajenas) == (0, 0, 0, 0)
    assert politicas == 4 * len(TABLAS)


# ── Reglas viejas "allow all" de la base real ────────────────────────────────
def test_sin_retirarlas_las_reglas_viejas_abririan_tablas_a_caja(cluster, base_con_reglas_viejas):
    """Control negativo: con las reglas viejas y SIN el SQL de seguridad, caja y la llave pública ven las tablas de dueños."""
    obtenido = _resultados(cluster, base_con_reglas_viejas, ["caja", "llave_publica"], ["ingresos_extra", "movimientos_caja"], ["S"])
    assert all(obtenido.values())


def test_la_matriz_se_cumple_aunque_la_base_traiga_reglas_viejas_allow_all(cluster, base_con_reglas_viejas):
    cluster.psql_ok(base_con_reglas_viejas, SQL_APLICAR.read_text(encoding="utf-8"))
    obtenido = _resultados(cluster, base_con_reglas_viejas, list(PERFILES), TABLAS + ["tabla_desconocida"], OPERACIONES)
    diferencias = [f"{p} {o} {t}: obtuvo {'PERMITIDO' if ok else 'negado'}, la matriz dice {'permitido' if _esperado(p, t, o) else 'negado'}"
                   for (p, t, o), ok in sorted(obtenido.items()) if ok != _esperado(p, t, o)]
    assert not diferencias, "\n".join(diferencias)


def test_caja_sigue_sin_ver_las_finanzas_con_las_reglas_viejas(cluster, base_con_reglas_viejas):
    cluster.psql_ok(base_con_reglas_viejas, SQL_APLICAR.read_text(encoding="utf-8"))
    obtenido = _resultados(cluster, base_con_reglas_viejas, ["caja"], ["ingresos_extra", "movimientos_caja", "pedidos_eliminados"], OPERACIONES)
    assert obtenido[("caja", "ingresos_extra", "S")] is False and obtenido[("caja", "movimientos_caja", "S")] is False
    assert obtenido[("caja", "pedidos_eliminados", "S")] is False and obtenido[("caja", "pedidos_eliminados", "D")] is False
    assert obtenido[("caja", "pedidos_eliminados", "I")] is True   # lo único que caja puede hacer ahí: dejar su rastro


def test_las_reglas_retiradas_se_guardan_y_aplicar_dos_veces_no_las_pierde(cluster, base_con_reglas_viejas):
    sql = SQL_APLICAR.read_text(encoding="utf-8")
    cluster.psql_ok(base_con_reglas_viejas, sql)
    cluster.psql_ok(base_con_reglas_viejas, sql)
    guardadas = cluster.consulta(base_con_reglas_viejas, "select tabla || '|' || nombre from seguridad.politicas_previas order by 1")
    assert guardadas == sorted(f"{t}|allow all {t}" for t in TABLAS_CON_REGLA_VIEJA)
    # y ya no queda ninguna regla permisiva que no sea de lobo_*
    assert cluster.consulta(base_con_reglas_viejas,
        "select count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and policyname not like 'lobo\\_%'") == ["0"]


def test_el_rollback_devuelve_las_reglas_viejas_tal_cual(cluster, base_con_reglas_viejas):
    cluster.psql_ok(base_con_reglas_viejas, SQL_APLICAR.read_text(encoding="utf-8"))
    cluster.psql_ok(base_con_reglas_viejas, SQL_REVERTIR.read_text(encoding="utf-8"))
    filas = cluster.consulta(base_con_reglas_viejas,
        "select tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-') "
        "from pg_policies where schemaname = 'public' order by 1")
    assert filas == sorted(f"{t}|allow all {t}|ALL|PERMISSIVE|public|true|true" for t in TABLAS_CON_REGLA_VIEJA)
    # y la llave pública vuelve a leer, como antes
    assert _resultados(cluster, base_con_reglas_viejas, ["llave_publica"], ["pedidos", "ingresos_extra"], ["S"]).values() and \
        all(_resultados(cluster, base_con_reglas_viejas, ["llave_publica"], ["pedidos", "ingresos_extra"], ["S"]).values())


def test_una_regla_restrictiva_ajena_se_respeta(cluster, base_con_reglas_viejas):
    """Una regla RESTRICTIVA solo recorta permisos: no abre nada, así que no se toca (ni se pierde al deshacer)."""
    cluster.psql_ok(base_con_reglas_viejas,
        'create policy "mi_restriccion" on public.pedidos as restrictive for select to authenticated using (true);')
    cluster.psql_ok(base_con_reglas_viejas, SQL_APLICAR.read_text(encoding="utf-8"))
    assert cluster.consulta(base_con_reglas_viejas, "select count(*) from pg_policies where policyname = 'mi_restriccion'") == ["1"]
    cluster.psql_ok(base_con_reglas_viejas, SQL_REVERTIR.read_text(encoding="utf-8"))
    assert cluster.consulta(base_con_reglas_viejas, "select count(*) from pg_policies where policyname = 'mi_restriccion'") == ["1"]


def test_la_verificacion_final_cuenta_las_reglas_ajenas_abiertas(cluster, base_con_reglas_viejas):
    _, salida, _ = cluster.psql(base_con_reglas_viejas, SQL_APLICAR.read_text(encoding="utf-8"))
    filas = [f.strip() for f in salida.splitlines() if re.fullmatch(r"\s*\d+\s*\|\s*\d+\s*\|\s*\d+\s*\|\s*\d+\s*\|\s*\d+\s*", f)]
    assert "reglas_ajenas_abiertas" in salida
    assert filas and re.sub(r"\s+", "", filas[-1]) == f"0|0|0|{4 * len(TABLAS)}|0", salida[-500:]

