"""Pruebas de «Restaurar desde un respaldo» y «Empezar de cero» (sql/restaurar_respaldo.sql) contra un Postgres de verdad.

Se arma una base desechable que imita a Supabase, con el ESQUEMA REAL de El Lobo (sql/esquema_completo.sql), las
reglas de acceso (sql/rls_seguridad.sql), el candado de días y las dos funciones nuevas; nunca toca tu Supabase.
Qué comprueban:
  · El administrador restaura un respaldo y TODO queda igual al archivo: mismos id, mismos números exactos, textos
    difíciles intactos, contadores de id al día (el siguiente pedido no choca), aunque en producción las tablas
    generen el id solas («identity ALWAYS»).
  · Es TODO-O-NADA: archivo dañado, conteos que no cuadran, tabla ajena o faltante, fila que la base rechaza → la base
    queda EXACTAMENTE como estaba.
  · Solo el rol admin: caja, respaldo, un token sin rol y la llave pública no pueden (y la palabra RESTAURAR /
    BORRAR TODO también se exige en la base, no solo en la pantalla).
  · Empezar de cero borra el trabajo, conserva las mesas (libres) y el inventario (salvo que se pida lo contrario).
  · Queda una bitácora que ni el sistema ni caja pueden leer ni tocar.
  · Cabe en los 8 segundos que Supabase le da a una llamada, con un respaldo grande.
  · Es seguro correrlo dos veces y el rollback lo quita por completo.

Si no hay PostgreSQL instalado, se saltan solas.   Correr:  python -m pytest tests/python/test_restaurar_desde_sistema.py -q
"""
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pgtemporal import ClusterTemporal  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
ESQUEMA = RAIZ / "sql" / "esquema_completo.sql"
RLS = RAIZ / "sql" / "rls_seguridad.sql"
CANDADO = RAIZ / "sql" / "candado_dias.sql"
RESTAURAR = RAIZ / "sql" / "restaurar_respaldo.sql"
ROLLBACK = RAIZ / "sql" / "rollback_restaurar.sql"
HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"

TABLAS = ['pedidos', 'egresos', 'inventario', 'consumos', 'gastos_dia', 'mesas', 'cierres_dia', 'aperturas_turno',
          'notas_dia', 'movimientos_caja', 'ingresos_extra', 'pedidos_eliminados', 'clientes_fiado', 'abonos_fiado',
          'pedidos_descuentos', 'config']
TEXTO_DIFICIL = "Línea 1\nLínea 2 con 'comillas', \"dobles\", $$ dólares $$, barra \\ y \\n, tilde ñ, emoji 😀, tab\t."

pytestmark = pytest.mark.skipif(not (ESQUEMA.exists() and RESTAURAR.exists()), reason="Falta el SQL")


# ── Utilidades ────────────────────────────────────────────────────────────
def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


def fila_pedido(i, fecha="2026-10-05", **extra):
    f = {"id": i, "created_at": f"{fecha}T17:00:0{i % 10}+00:00", "fecha": fecha, "hora": "12:30:00", "turno": "almuerzo",
         "pedido": f"Almuerzo {i}", "detalle": TEXTO_DIFICIL if i % 2 else None, "metodo": "efectivo", "cantidad": 1,
         "monto_unit": 14000, "monto_almuerzo": 14000, "monto_domicilio": 0, "monto_total": 14000.5,
         "estado": "pagado", "monto_efectivo": 14000.5, "monto_transferencia": 0, "es_fiar": False, "mesa": None,
         "cliente_fiado_id": None, "descuento": 0}
    f.update(extra)
    return f


def respaldo_ejemplo(n_pedidos=5, **cambios):
    """Un respaldo como el que hace el sistema: {version, generado_en, fecha, conteos, tablas}."""
    t = {
        # El pedido 3 es un fiado de la cliente 1 y el consumo 1 es del producto 1: obligan a cargar primero a los «padres».
        "pedidos": [fila_pedido(i, **({"es_fiar": True, "estado": "pendiente", "cliente_fiado_id": 1, "metodo": None,
                                       "monto_efectivo": 0} if i == 3 else {})) for i in range(1, n_pedidos + 1)],
        "egresos": [{"id": 1, "fecha": "2026-10-02", "cat": "carnes", "monto": 120000, "description": "pollo", "cuenta": "efectivo", "turno": None},
                    {"id": 2, "fecha": "2026-10-03", "cat": "gas", "monto": 55000.25, "description": None, "cuenta": "efectivo", "turno": "cena"}],
        "inventario": [{"id": 1, "nombre": "Arroz", "unidad": "kg", "stock": 10.5, "minimo": 2, "costo": 3200}],
        "consumos": [{"id": 1, "producto_id": 1, "nombre": "Arroz", "cantidad": 1.5, "fecha": "2026-10-04", "costo": 4800}],
        "gastos_dia": [{"id": 1, "fecha": "2026-10-05", "turno": "almuerzo", "nombre": "Hielo", "monto": 6000, "categoria": "otro"},
                       {"id": 2, "fecha": "2026-10-05", "turno": "cena", "nombre": "Gas", "monto": 40000, "categoria": "otro"}],
        "mesas": [{"numero": n, "estado": "ocupada" if n == 2 else "libre", "updated_at": "2026-10-05T12:00:00+00:00"} for n in (1, 2, 3)],
        "cierres_dia": [{"id": 1, "fecha": "2026-10-05", "turno": "almuerzo", "efectivo": 70000.5, "transferencia": 0, "gastos": 6000, "resultado": 64000.5, "manual": False},
                        {"id": 2, "fecha": "2026-10-05", "turno": "cena", "efectivo": 90000, "transferencia": 15000, "gastos": 40000, "resultado": 65000, "manual": False}],
        "aperturas_turno": [{"id": 1, "fecha": "2026-10-05", "turno": "almuerzo", "caja_inicial": 100000, "venta_desayuno": 0}],
        "notas_dia": [{"id": 1, "fecha": "2026-10-05", "texto": TEXTO_DIFICIL}],
        "movimientos_caja": [{"id": 1, "fecha": "2026-10-05", "tipo": "aporte", "descripcion": "base", "monto": 50000, "cuenta": "efectivo", "cuenta_destino": None}],
        "ingresos_extra": [{"id": 1, "fecha": "2026-10-05", "descripcion": "venta de hielo", "monto": 8000, "cuenta": "efectivo"}],
        "pedidos_eliminados": [{"id": 1, "pedido_id": 77, "fecha": "2026-10-04", "hora": "13:00", "turno": "almuerzo", "pedido": "Almuerzo", "monto_total": 14000, "motivo": "eliminado"}],
        "clientes_fiado": [{"id": 1, "nombre": "Ana", "telefono": "300"}, {"id": 2, "nombre": "Luis", "telefono": None}],
        "abonos_fiado": [{"id": 1, "cliente_fiado_id": 1, "fecha": "2026-10-05", "monto": 5000, "cuenta": "efectivo", "nota": None, "turno": "almuerzo"}],
        "pedidos_descuentos": [{"id": 1, "grupo_pedido": "g1", "pedido_ids": "1,2", "fecha": "2026-10-05", "valor_lista": 28000, "descuento_nuevo": 2000, "motivo": "cliente frecuente"}],
        "config": [{"clave": "ultimo_respaldo", "valor": {"fecha": "2026-10-04", "conteos": {"pedidos": 5}}, "actualizado_en": "2026-10-04T03:00:00+00:00"}],
    }
    t.update(cambios.pop("tablas", {}))
    r = {"version": 1, "generado_en": "2026-10-05T23:00:00.000Z", "fecha": "2026-10-05", "tablas": t}
    r["conteos"] = {k: len(v) for k, v in t.items()}
    r.update(cambios)
    return r


def sembrar_base_actual(cluster, db):
    """Datos «de hoy» distintos a los del respaldo (para ver que se REEMPLAZAN, sin mezclarse)."""
    cluster.psql_ok(db, """
        insert into public.pedidos (id, fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total, estado) values
          (900, '2026-10-20', '13:00', 'almuerzo', 'Hoy 1', 1, 1, 1, 'pagado'), (901, '2026-10-20', '13:05', 'cena', 'Hoy 2', 2, 2, 2, 'pendiente');
        insert into public.mesas (numero, estado) values (1, 'ocupada'), (2, 'libre'), (3, 'libre'), (4, 'libre'), (5, 'libre');
        insert into public.clientes_fiado (id, nombre) values (50, 'Cliente de hoy');
        insert into public.inventario (id, nombre) values (60, 'Sal');
        insert into public.config (clave, valor) values ('ultimo_respaldo', '{"fecha":"2026-10-20"}');
        insert into public.notas_dia (fecha, texto) values ('2026-10-20', 'nota de hoy');
    """)


def _hay_safeupdate():
    """Supabase carga en sus conexiones de la API la extensión «pg-safeupdate»: un UPDATE o DELETE SIN WHERE se rechaza
    («UPDATE requires a WHERE clause»). Si esa librería está compilada en este PostgreSQL, las llamadas la usan igual."""
    pg_config = shutil.which("pg_config") or next(iter(sorted(Path("/usr/lib/postgresql").glob("*/bin/pg_config"), reverse=True)), None)
    if not pg_config:
        return False
    carpeta = subprocess.run([str(pg_config), "--pkglibdir"], capture_output=True, text=True).stdout.strip()
    return bool(carpeta) and (Path(carpeta) / "safeupdate.so").exists()


SAFEUPDATE = _hay_safeupdate()


def llamar(cluster, db, rol, sentencia, claims=None, rol_pg="authenticated", timeout=None):
    """Corre UNA llamada como ese rol (con su token) en una transacción que se confirma si sale bien.
    Devuelve ('ok', json) o ('error', sqlstate, detalle, mensaje)."""
    if claims is None:
        claims = {"role": rol_pg, "email": f"{rol or 'nadie'}@elobo.test", "app_metadata": ({"rol": rol} if rol else {})}
    guion = ("\\set VERBOSITY verbose\n" + ("load 'safeupdate';\n" if SAFEUPDATE else "") + "begin;\n"
             f"do $c$ begin perform set_config('request.jwt.claims', {lit(json.dumps(claims))}, true); end $c$;\n"
             f"set local role {rol_pg};\n" + (f"set local statement_timeout = '{timeout}';\n" if timeout else "")
             + sentencia + "\ncommit;\n")
    cmd = cluster.prefijo + [cluster.psql_bin, "-X", "-q", "-A", "-t", "-h", str(cluster.dir), "-p", str(cluster.puerto), "-U", "postgres",
                             "-d", db, "-v", "ON_ERROR_STOP=1", "-f", "-"]
    r = subprocess.run(cmd, input=guion, capture_output=True, text=True, timeout=300)
    if r.returncode == 0:
        return ("ok", json.loads(r.stdout.strip().splitlines()[-1]))
    m = re.search(r"ERROR:\s+(\w{5}):\s+(.*)", r.stderr)
    d = re.search(r"DETAIL:\s+(.*)", r.stderr)
    return ("error", m.group(1) if m else "?", d.group(1).strip() if d else "", (m.group(2) if m else r.stderr).strip())


def restaurar(cluster, db, respaldo, rol="admin", palabra="RESTAURAR", **kw):
    cuerpo = json.dumps(respaldo, ensure_ascii=False)
    assert "$restauracion$" not in cuerpo
    return llamar(cluster, db, rol, f"select public.lobo_restaurar_respaldo($restauracion${cuerpo}$restauracion$::jsonb, {lit(palabra)})::text;", **kw)


def cero(cluster, db, rol="admin", palabra="BORRAR TODO", borrar_inventario=None, **kw):
    extra = "" if borrar_inventario is None else f", {'true' if borrar_inventario else 'false'}"
    return llamar(cluster, db, rol, f"select public.lobo_empezar_de_cero({lit(palabra)}{extra})::text;", **kw)


def conteos(cluster, db):
    return {t: int(cluster.valor(db, f"select count(*) from public.{t}")) for t in TABLAS}


def foto(cluster, db):
    """Todo el contenido de la base (para comprobar que NO cambió nada)."""
    return {t: cluster.valor(db, f"select coalesce(json_agg(x order by to_json(x)::text), '[]') from public.{t} x") for t in TABLAS}


_n = [0]


@pytest.fixture(scope="module")
def cluster():
    c = ClusterTemporal()
    try:
        c.psql_ok("postgres", "create database plantilla_restaurar;")
        c.preparar_supabase_falso("plantilla_restaurar")
        c.psql_ok("plantilla_restaurar", ESQUEMA.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_restaurar", RLS.read_text(encoding="utf-8"))
        c.psql_ok("plantilla_restaurar", CANDADO.read_text(encoding="utf-8"))
        # Supabase da permiso de ejecutar a anon / authenticated en toda función que se cree en public: el SQL tiene que quitárselo a anon.
        c.psql_ok("plantilla_restaurar", "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;")
        c.psql_ok("plantilla_restaurar", RESTAURAR.read_text(encoding="utf-8"))
        yield c
    finally:
        c.detener()


@pytest.fixture()
def db(cluster):
    _n[0] += 1
    nombre = cluster.base_nueva(f"rest_{_n[0]}", plantilla="plantilla_restaurar")
    sembrar_base_actual(cluster, nombre)
    return nombre


# ── 1. Restaurar ──────────────────────────────────────────────────────────
def test_el_admin_restaura_y_todo_queda_igual_al_archivo(cluster, db):
    r = respaldo_ejemplo()
    res = restaurar(cluster, db, r)
    assert res[0] == "ok", res
    out = res[1]
    assert out["ok"] is True and out["accion"] == "restaurar"
    assert out["antes"]["pedidos"] == 2 and out["despues"]["pedidos"] == 5
    assert sorted(out["restauradas"]) == sorted(TABLAS) and out["sin_cambios"] == []
    assert conteos(cluster, db) == r["conteos"]
    # Lo de «hoy» ya no está (se REEMPLAZÓ, no se mezcló) y lo del archivo sí, con los mismos id.
    assert cluster.valor(db, "select count(*) from public.pedidos where id in (900, 901)") == "0"
    assert cluster.valor(db, "select string_agg(id::text, ',' order by id) from public.pedidos") == "1,2,3,4,5"
    assert cluster.valor(db, "select count(*) from public.clientes_fiado where nombre = 'Cliente de hoy'") == "0"
    assert cluster.valor(db, "select count(*) from public.notas_dia where texto = 'nota de hoy'") == "0"


def test_los_numeros_los_textos_dificiles_y_los_nulos_quedan_exactos(cluster, db):
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    assert cluster.valor(db, "select monto_total::text from public.pedidos where id = 1") == "14000.5"
    assert cluster.valor(db, "select monto::text from public.egresos where id = 2") == "55000.25"
    assert cluster.valor(db, "select detalle from public.pedidos where id = 1") == TEXTO_DIFICIL
    assert cluster.valor(db, "select detalle is null from public.pedidos where id = 2") == "t"
    assert cluster.valor(db, "select texto from public.notas_dia where id = 1") == TEXTO_DIFICIL
    assert cluster.valor(db, "select valor->>'fecha' from public.config where clave = 'ultimo_respaldo'") == "2026-10-04"
    assert cluster.valor(db, "select estado from public.mesas where numero = 2") == "ocupada"
    assert cluster.valor(db, "select hora::text from public.pedidos where id = 1") == "12:30:00"


def test_los_contadores_de_id_quedan_al_dia(cluster, db):
    assert restaurar(cluster, db, respaldo_ejemplo(n_pedidos=5))[0] == "ok"
    # El siguiente pedido sin id explícito no puede chocar con los restaurados (debe ser 6).
    cluster.psql_ok(db, "insert into public.pedidos (fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total) values ('2026-10-06', '12:00', 'almuerzo', 'nuevo', 1, 1, 1);")
    assert cluster.valor(db, "select max(id) from public.pedidos") == "6"
    cluster.psql_ok(db, "insert into public.clientes_fiado (nombre) values ('Nueva');")
    assert cluster.valor(db, "select max(id) from public.clientes_fiado") == "3"


def test_tambien_con_tablas_que_generan_el_id_siempre_como_en_produccion(cluster, db):
    # En producción las tablas eran «identity ALWAYS»: un insert con id explícito normal fallaría.
    cluster.psql_ok(db, "alter table public.pedidos alter column id set generated always; alter table public.abonos_fiado alter column id set generated always;")
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    assert cluster.valor(db, "select string_agg(id::text, ',' order by id) from public.pedidos") == "1,2,3,4,5"
    cluster.psql_ok(db, "insert into public.pedidos (fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total) values ('2026-10-06', '12:00', 'almuerzo', 'nuevo', 1, 1, 1);")
    assert cluster.valor(db, "select max(id) from public.pedidos") == "6"


def test_una_columna_calculada_que_viene_en_el_archivo_no_se_escribe_y_la_base_la_recalcula(cluster, db):
    cluster.psql_ok(db, "alter table public.egresos add column doble numeric generated always as (monto * 2) stored;")
    t = respaldo_ejemplo()["tablas"]["egresos"]
    for f in t:
        f["doble"] = 999999                                   # un respaldo hecho con esa columna la traería
    assert restaurar(cluster, db, respaldo_ejemplo(tablas={"egresos": t}))[0] == "ok"
    assert cluster.valor(db, "select doble::text from public.egresos where id = 1") == "240000"


def test_una_base_vacia_se_restaura_igual(cluster, db):
    assert cero(cluster, db, borrar_inventario=True)[0] == "ok"
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    assert conteos(cluster, db) == respaldo_ejemplo()["conteos"]


def test_restaurar_dos_veces_el_mismo_respaldo_no_duplica_nada(cluster, db):
    r = respaldo_ejemplo()
    assert restaurar(cluster, db, r)[0] == "ok"
    assert restaurar(cluster, db, r)[0] == "ok"
    assert conteos(cluster, db) == r["conteos"]


def test_columnas_que_faltan_toman_su_valor_por_defecto_y_las_ajenas_se_ignoran(cluster, db):
    fila = {"id": 1, "fecha": "2026-10-05", "hora": "12:00", "turno": "almuerzo", "pedido": "Viejo", "monto_unit": 1, "monto_almuerzo": 1,
            "monto_total": 1, "columna_que_ya_no_existe": "x"}     # sin created_at ni estado: usan su valor por defecto
    r = respaldo_ejemplo(tablas={"pedidos": [fila]})
    assert restaurar(cluster, db, r)[0] == "ok"
    assert cluster.valor(db, "select created_at is not null from public.pedidos where id = 1") == "t"
    assert cluster.valor(db, "select estado from public.pedidos where id = 1") == "pendiente"


def test_un_respaldo_viejo_sin_config_ni_descuentos_los_deja_como_estan(cluster, db):
    t = respaldo_ejemplo()["tablas"]
    t.pop("config"), t.pop("pedidos_descuentos")
    r = {"version": 1, "generado_en": "2026-09-01T00:00:00Z", "fecha": "2026-09-01", "tablas": t, "conteos": {k: len(v) for k, v in t.items()}}
    cluster.psql_ok(db, "insert into public.pedidos_descuentos (id, grupo_pedido) values (77, 'g-hoy');")
    res = restaurar(cluster, db, r)
    assert res[0] == "ok", res
    assert sorted(res[1]["sin_cambios"]) == ["config", "pedidos_descuentos"]
    assert cluster.valor(db, "select count(*) from public.config where clave = 'ultimo_respaldo' and valor->>'fecha' = '2026-10-20'") == "1"
    assert cluster.valor(db, "select count(*) from public.pedidos_descuentos where id = 77") == "1"
    assert cluster.valor(db, "select count(*) from public.pedidos") == "5"


def test_el_candado_de_dias_no_estorba_al_admin_ni_a_fechas_viejas(cluster, db):
    # El respaldo trae días pasados; el candado solo limita a caja.
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    assert cluster.valor(db, "select count(*) from public.cierres_dia where fecha = '2026-10-05'") == "2"


# ── 2. Todo o nada ────────────────────────────────────────────────────────
def casos_malos():
    ok = respaldo_ejemplo()
    d = json.loads(json.dumps(ok))
    c = {}
    c["version distinta"] = {**d, "version": 2}
    c["sin tablas"] = {k: v for k, v in d.items() if k != "tablas"}
    c["sin conteos"] = {k: v for k, v in d.items() if k != "conteos"}
    c["conteo declarado distinto"] = {**d, "conteos": {**d["conteos"], "pedidos": 99}}
    c["conteo faltante"] = {**d, "conteos": {k: v for k, v in d["conteos"].items() if k != "egresos"}}
    c["tabla ajena"] = {**d, "tablas": {**d["tablas"], "usuarios": []}, "conteos": {**d["conteos"], "usuarios": 0}}
    c["tabla obligatoria faltante"] = {**d, "tablas": {k: v for k, v in d["tablas"].items() if k != "pedidos"}}
    c["tabla que no es lista"] = {**d, "tablas": {**d["tablas"], "egresos": {"a": 1}}}
    c["fila que no es objeto"] = {**d, "tablas": {**d["tablas"], "egresos": [1, 2]}}
    c["no es un objeto"] = [1, 2, 3]
    # La base rechaza una fila a mitad de la carga (abonos_fiado.cuenta solo admite efectivo/transferencia) → todo se deshace
    mala = json.loads(json.dumps(d))
    mala["tablas"]["abonos_fiado"][0]["cuenta"] = "cheque"
    c["fila que la base rechaza"] = mala
    sin_col = json.loads(json.dumps(d))
    sin_col["tablas"]["clientes_fiado"] = [{"columna_ajena": 1}]
    sin_col["conteos"]["clientes_fiado"] = 1
    c["ninguna columna conocida"] = sin_col
    return c


@pytest.mark.parametrize("nombre", list(casos_malos()))
def test_un_archivo_malo_se_rechaza_y_la_base_queda_exactamente_igual(cluster, db, nombre):
    antes = foto(cluster, db)
    res = restaurar(cluster, db, casos_malos()[nombre])
    assert res[0] == "error", f"{nombre}: debía rechazarse y salió {res}"
    assert foto(cluster, db) == antes, f"{nombre}: la base cambió aunque la restauración falló"


MOTIVOS = {"version distinta": "respaldo_invalido", "sin tablas": "respaldo_invalido", "sin conteos": "respaldo_invalido",
           "conteo declarado distinto": "respaldo_conteo", "conteo faltante": "respaldo_conteo", "tabla ajena": "respaldo_tabla_desconocida",
           "tabla obligatoria faltante": "respaldo_tabla_faltante", "tabla que no es lista": "respaldo_invalido",
           "fila que no es objeto": "respaldo_invalido", "no es un objeto": "respaldo_invalido", "ninguna columna conocida": "respaldo_invalido"}


@pytest.mark.parametrize("nombre", list(MOTIVOS))
def test_cada_rechazo_trae_su_propio_motivo_claro(cluster, db, nombre):
    res = restaurar(cluster, db, casos_malos()[nombre])
    assert res[0] == "error" and res[1] == "22023", res
    assert res[2] == MOTIVOS[nombre], f"{nombre}: el motivo era {res[2]!r}: {res[3]}"
    assert "No se cambió nada" in res[3]


def test_una_fila_que_no_es_un_objeto_se_rechaza_por_eso_y_no_por_otra_causa(cluster, db):
    # Sin esta revisión el archivo igual se rechazaría más adelante («ninguna columna conocida»), con el mismo código:
    # se exige el mensaje propio, que es el que entiende quien lo lee.
    res = restaurar(cluster, db, casos_malos()["fila que no es objeto"])
    assert res[0] == "error" and res[2] == "respaldo_invalido" and "filas que no son válidas" in res[3], res


@pytest.mark.parametrize("tabla", [t for t in TABLAS if t not in ("config", "pedidos_descuentos")])
def test_a_cada_tabla_obligatoria_le_hace_falta_estar_en_el_archivo(cluster, db, tabla):
    r = respaldo_ejemplo()
    del r["tablas"][tabla], r["conteos"][tabla]
    antes = foto(cluster, db)
    res = restaurar(cluster, db, r)
    assert res[0] == "error" and res[2] == "respaldo_tabla_faltante" and tabla in res[3], res
    assert foto(cluster, db) == antes


def test_si_la_base_descarta_filas_al_cargar_la_verificacion_lo_detecta_y_se_deshace_todo(cluster, db):
    # Un disparador que «se traga» las filas de egresos: el archivo dice 2 y quedarían 0.
    cluster.psql_ok(db, """
        create function public.t_descarta() returns trigger language plpgsql as $$ begin return null; end $$;
        create trigger t_descarta before insert on public.egresos for each row execute function public.t_descarta();
    """)
    antes = foto(cluster, db)
    res = restaurar(cluster, db, respaldo_ejemplo())
    assert res[0] == "error" and res[1] == "XX000" and res[2] == "restaurar_verificacion" and "egresos" in res[3], res
    assert foto(cluster, db) == antes


def test_las_funciones_corren_con_los_permisos_del_dueno_y_con_el_camino_de_busqueda_fijo(cluster, db):
    filas = cluster.consulta(db, "select p.proname || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '-') "
                                 "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                 "where n.nspname = 'public' and p.proname in ('lobo_restaurar_respaldo', 'lobo_empezar_de_cero') order by 1")
    assert filas == ["lobo_empezar_de_cero|true|search_path=pg_catalog, public", "lobo_restaurar_respaldo|true|search_path=pg_catalog, public"]


def test_ni_anon_ni_public_pueden_ejecutarlas_y_authenticated_si(cluster, db):
    for f in ("lobo_restaurar_respaldo", "lobo_empezar_de_cero"):
        assert cluster.valor(db, f"select has_function_privilege('anon', p.oid, 'execute')::text from pg_proc p where p.proname = '{f}'") == "false", f
        assert cluster.valor(db, f"select has_function_privilege('authenticated', p.oid, 'execute')::text from pg_proc p where p.proname = '{f}'") == "true", f
        assert cluster.valor(db, f"select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname = '{f}' and a.grantee = 0") == "0", f


def test_la_bitacora_tiene_la_seguridad_por_fila_activada(cluster, db):
    assert cluster.valor(db, "select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace "
                             "where n.nspname = 'seguridad' and c.relname = 'restauraciones'") == "true"


def test_ningun_update_ni_delete_del_sql_va_sin_where():
    # Supabase rechaza desde la app un UPDATE/DELETE sin WHERE («UPDATE requires a WHERE clause»): así falló «Empezar de cero»
    # en la primera prueba real. Esta revisión corre siempre, aunque este PostgreSQL no tenga la librería (la de abajo).
    texto = re.sub(r"--[^\n]*", "", RESTAURAR.read_text(encoding="utf-8"))
    sentencias = [m.group(0) for m in re.finditer(r"(?im)^\s*(?:update\s+[\w.\"]+\s+set|delete\s+from\s+[\w.\"]+)[^;]*;", texto)]
    assert sentencias, "la revisión no encontró ni un UPDATE: la expresión está mal"
    for s in sentencias:
        assert re.search(r"\bwhere\b", s, re.I), f"sin WHERE: {s.strip()}"


@pytest.mark.skipif(not SAFEUPDATE, reason="este PostgreSQL no tiene compilada la librería safeupdate (pg-safeupdate)")
def test_la_prueba_imita_el_seguro_de_supabase_contra_update_sin_where(cluster, db):
    # Si esta falla, las demás pruebas dejaron de imitar a Supabase en este punto.
    res = llamar(cluster, db, "admin", "update public.mesas set estado = 'libre';\nselect '{}';")
    assert res[0] == "error" and "UPDATE requires a WHERE clause" in res[3], res
    assert llamar(cluster, db, "admin", "update public.mesas set estado = 'libre' where true;\nselect '{}';")[0] == "ok"


def test_el_sql_le_avisa_a_la_api_que_hay_funciones_nuevas():
    assert "notify pgrst, 'reload schema';" in RESTAURAR.read_text(encoding="utf-8")


def test_los_rechazos_dicen_por_que_y_que_no_se_cambio_nada(cluster, db):
    res = restaurar(cluster, db, casos_malos()["conteo declarado distinto"])
    assert res[0] == "error" and res[2] == "respaldo_conteo" and "No se cambió nada" in res[3] and "pedidos" in res[3]
    res = restaurar(cluster, db, casos_malos()["tabla ajena"])
    assert res[2] == "respaldo_tabla_desconocida" and "usuarios" in res[3]
    res = restaurar(cluster, db, casos_malos()["tabla obligatoria faltante"])
    assert res[2] == "respaldo_tabla_faltante" and "pedidos" in res[3]


def test_si_falla_a_mitad_tambien_se_deshace_el_vaciado_previo(cluster, db):
    antes = foto(cluster, db)
    assert conteos(cluster, db)["pedidos"] == 2
    res = restaurar(cluster, db, casos_malos()["fila que la base rechaza"])
    assert res[0] == "error"
    assert foto(cluster, db) == antes and conteos(cluster, db)["pedidos"] == 2


# ── 3. Quién puede ────────────────────────────────────────────────────────
@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_solo_el_admin_puede_restaurar(cluster, db, rol):
    antes = foto(cluster, db)
    res = restaurar(cluster, db, respaldo_ejemplo(), rol=rol)
    assert res[0] == "error" and res[1] == "42501" and res[2] == "restaurar_solo_admin", res
    assert foto(cluster, db) == antes


def test_la_llave_publica_anon_no_puede_ni_llamar_la_funcion(cluster, db):
    antes = foto(cluster, db)
    res = restaurar(cluster, db, respaldo_ejemplo(), rol=None, rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and res[1] == "42501" and "permission denied" in res[3], res
    assert foto(cluster, db) == antes


def test_un_token_que_se_hace_pasar_por_admin_en_user_metadata_no_sirve(cluster, db):
    antes = foto(cluster, db)
    claims = {"role": "authenticated", "app_metadata": {"rol": "caja"}, "user_metadata": {"rol": "admin"}}
    res = restaurar(cluster, db, respaldo_ejemplo(), rol="caja", claims=claims)
    assert res[0] == "error" and res[2] == "restaurar_solo_admin"
    assert foto(cluster, db) == antes


@pytest.mark.parametrize("palabra", ["", "restaurar", "Restaurar", "RESTAURAR ", "BORRAR TODO", "si"])
def test_sin_la_palabra_exacta_no_se_restaura_aunque_sea_admin(cluster, db, palabra):
    antes = foto(cluster, db)
    res = restaurar(cluster, db, respaldo_ejemplo(), palabra=palabra)
    assert res[0] == "error" and res[2] == "restaurar_sin_confirmacion", res
    assert foto(cluster, db) == antes


def test_sin_palabra_nula_tampoco(cluster, db):
    antes = foto(cluster, db)
    res = llamar(cluster, db, "admin", "select public.lobo_restaurar_respaldo('{}'::jsonb, null)::text;")
    assert res[0] == "error" and res[2] == "restaurar_sin_confirmacion"
    assert foto(cluster, db) == antes


# ── 4. Empezar de cero ────────────────────────────────────────────────────
def test_empezar_de_cero_borra_el_trabajo_y_conserva_mesas_libres_e_inventario(cluster, db):
    # La base de ejemplo trae pedidos con id explícito (900, 901) y el contador sin usar: primero se «gasta» el contador,
    # para que el reinicio sea observable (si no, el siguiente pedido sería el 1 aunque el contador no se reiniciara).
    cluster.psql_ok(db, "insert into public.pedidos (fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total) values ('2026-10-05', '12:00', 'almuerzo', 'previo', 1, 1, 1);")
    assert cluster.valor(db, "select max(id) from public.pedidos where pedido = 'previo'") == "1"
    res = cero(cluster, db)
    assert res[0] == "ok", res
    c = conteos(cluster, db)
    for t in TABLAS:
        if t in ("mesas", "inventario"):
            continue
        assert c[t] == 0, f"{t} debía quedar vacía y tiene {c[t]}"
    assert c["mesas"] == 5 and c["inventario"] == 1
    assert cluster.valor(db, "select count(*) from public.mesas where estado <> 'libre'") == "0"
    assert res[1]["antes"]["pedidos"] == 3 and res[1]["despues"]["pedidos"] == 0       # los 2 de la base de ejemplo + el «previo»
    # Los contadores empiezan de nuevo
    cluster.psql_ok(db, "insert into public.pedidos (fecha, hora, turno, pedido, monto_unit, monto_almuerzo, monto_total) values ('2026-10-06', '12:00', 'almuerzo', 'nuevo', 1, 1, 1);")
    assert cluster.valor(db, "select max(id) from public.pedidos") == "1"


def test_empezar_de_cero_puede_borrar_tambien_el_inventario(cluster, db):
    assert cero(cluster, db, borrar_inventario=True)[0] == "ok"
    c = conteos(cluster, db)
    assert c["inventario"] == 0 and c["mesas"] == 5


def test_la_bitacora_distingue_empezar_de_cero_con_y_sin_inventario(cluster, db):
    assert cero(cluster, db)[0] == "ok"
    assert cero(cluster, db, borrar_inventario=False)[0] == "ok"
    assert cero(cluster, db, borrar_inventario=True)[0] == "ok"
    assert cluster.consulta(db, "select accion from seguridad.restauraciones order by id") == [
        "empezar_de_cero", "empezar_de_cero", "empezar_de_cero_con_inventario"]


@pytest.mark.parametrize("rol", ["caja", "respaldo", None])
def test_empezar_de_cero_es_solo_del_admin(cluster, db, rol):
    antes = foto(cluster, db)
    res = cero(cluster, db, rol=rol)
    assert res[0] == "error" and res[1] == "42501" and res[2] == "cero_solo_admin", res
    assert foto(cluster, db) == antes


def test_empezar_de_cero_con_la_llave_publica_no_se_puede(cluster, db):
    antes = foto(cluster, db)
    res = cero(cluster, db, rol=None, rol_pg="anon", claims={"role": "anon"})
    assert res[0] == "error" and "permission denied" in res[3]
    assert foto(cluster, db) == antes


@pytest.mark.parametrize("palabra", ["", "borrar todo", "BORRAR", "RESTAURAR", "BORRAR TODO "])
def test_empezar_de_cero_exige_la_palabra_exacta(cluster, db, palabra):
    antes = foto(cluster, db)
    res = cero(cluster, db, palabra=palabra)
    assert res[0] == "error" and res[2] == "cero_sin_confirmacion", res
    assert foto(cluster, db) == antes


# ── 5. Bitácora ───────────────────────────────────────────────────────────
def test_cada_restauracion_deja_rastro_con_quien_y_cuantas_filas(cluster, db):
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    assert cero(cluster, db)[0] == "ok"
    filas = cluster.consulta(db, "select accion || '|' || quien || '|' || (conteos_antes->>'pedidos') || '|' || (conteos_despues->>'pedidos') || '|' || coalesce(respaldo_generado_en, '-') from seguridad.restauraciones order by id")
    assert filas == ["restaurar|admin@elobo.test|2|5|2026-10-05T23:00:00.000Z", "empezar_de_cero|admin@elobo.test|5|0|-"]


def test_un_intento_rechazado_no_deja_rastro_falso(cluster, db):
    restaurar(cluster, db, respaldo_ejemplo(), rol="caja")
    restaurar(cluster, db, casos_malos()["conteo declarado distinto"])
    assert cluster.valor(db, "select count(*) from seguridad.restauraciones") == "0"


@pytest.mark.parametrize("rol_pg", ["authenticated", "anon"])
def test_nadie_desde_la_api_puede_leer_ni_tocar_la_bitacora(cluster, db, rol_pg):
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    for sentencia in ["select count(*)::text from seguridad.restauraciones;", "delete from seguridad.restauraciones returning 'x';",
                      "update seguridad.restauraciones set quien = 'otro' returning 'x';"]:
        res = llamar(cluster, db, "admin", sentencia, rol_pg=rol_pg, claims={"role": rol_pg, "app_metadata": {"rol": "admin"}})
        assert res[0] == "error", f"{rol_pg} pudo hacer: {sentencia} → {res}"
    assert cluster.valor(db, "select count(*) from seguridad.restauraciones") == "1"


# ── 6. Tamaño y tiempo ────────────────────────────────────────────────────
def test_un_respaldo_grande_cabe_en_los_8_segundos_que_supabase_da_a_una_llamada(cluster, db):
    n = 12000     # ≈ 3 veces los pedidos de El Lobo en su primer año
    r = respaldo_ejemplo(n_pedidos=n)
    t0 = time.time()
    res = restaurar(cluster, db, r, timeout="8s")
    seg = time.time() - t0
    assert res[0] == "ok", res
    assert conteos(cluster, db)["pedidos"] == n
    print(f"\n  restaurar {n} pedidos: {seg:.1f} s en total (incluye enviar el archivo)")
    assert seg < 8, f"tardó {seg:.1f} s"


# ── 7. Instalación y rollback ─────────────────────────────────────────────
def test_correr_el_sql_dos_veces_es_seguro_y_pide_la_seguridad_antes(cluster):
    cluster.base_nueva("rest_dos_veces", plantilla="plantilla_restaurar")
    cluster.psql_ok("rest_dos_veces", RESTAURAR.read_text(encoding="utf-8"))
    sin_seguridad = cluster.base_nueva("rest_sin_seguridad")          # sin haber corrido rls_seguridad.sql
    codigo, _, avisos = cluster.psql(sin_seguridad, RESTAURAR.read_text(encoding="utf-8"), parar_en_error=True)
    assert codigo != 0 and "rls_seguridad.sql" in avisos
    assert cluster.valor(sin_seguridad, "select count(*) from pg_proc where proname = 'lobo_restaurar_respaldo'") == "0"


def test_el_rollback_quita_las_funciones_y_conserva_la_bitacora(cluster, db):
    assert restaurar(cluster, db, respaldo_ejemplo())[0] == "ok"
    cluster.psql_ok(db, ROLLBACK.read_text(encoding="utf-8"))
    assert cluster.valor(db, "select count(*) from pg_proc where proname in ('lobo_restaurar_respaldo', 'lobo_empezar_de_cero')") == "0"
    assert cluster.valor(db, "select count(*) from seguridad.restauraciones") == "1"
    cluster.psql_ok(db, ROLLBACK.read_text(encoding="utf-8"))      # y también es seguro correrlo dos veces
    res = restaurar(cluster, db, respaldo_ejemplo())
    assert res[0] == "error"


def test_las_llaves_foraneas_estan_todas_cubiertas_por_el_orden_de_carga():
    """Si algún día se agrega una llave foránea nueva, el orden de carga de la función debe contemplarla."""
    esquema = ESQUEMA.read_text(encoding="utf-8")
    fks = re.findall(r"alter table public\.(\w+) add constraint \w+ FOREIGN KEY \(\w+\) REFERENCES (\w+)\(", esquema)
    assert sorted(fks) == [("abonos_fiado", "clientes_fiado"), ("consumos", "inventario"), ("pedidos", "clientes_fiado")]
    sql = RESTAURAR.read_text(encoding="utf-8")
    orden = re.findall(r"'([a-z_]+)'", re.search(r"c_tablas constant text\[\] := array\[(.*?)\];", sql, re.S).group(1))
    for hijo, padre in fks:
        assert orden.index(padre) < orden.index(hijo), f"{padre} debe cargarse antes que {hijo}"


def test_la_lista_de_tablas_es_la_misma_que_la_del_respaldo_del_sistema():
    html = HTML.read_text(encoding="utf-8")
    m = re.search(r"const TABLAS_RESPALDO = \[(.*?)\];", html, re.S)
    del_sistema = re.findall(r"'([a-z_]+)'", m.group(1))
    assert sorted(del_sistema) == sorted(TABLAS)
    sql = RESTAURAR.read_text(encoding="utf-8")
    for bloque in re.findall(r"c_tablas constant text\[\] := array\[(.*?)\];", sql, re.S):
        assert sorted(re.findall(r"'([a-z_]+)'", bloque)) == sorted(TABLAS)
    matriz = json.loads((RAIZ / "sql" / "matriz_permisos.json").read_text(encoding="utf-8"))
    assert sorted(matriz["tablas"]) == sorted(TABLAS)
