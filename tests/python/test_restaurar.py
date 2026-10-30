"""Pruebas del script de restauración (herramientas/restaurar_respaldo.py) contra un Supabase FALSO.

Nada de esto toca un Supabase real: el servidor falso (tests/python/postgrest_falso.py) corre en tu propio
computador, imita la parte REST de Supabase y deja inyectarle fallas. Aquí se prueba que el script:
  · en modo simulacro no escribe NADA,
  · carga bien (en el orden correcto, en tandas, con los mismos id y números exactos) y lo VERIFICA,
  · se niega, sin tocar nada, ante: respaldo dañado/incompleto, destino con datos, llave pública, proyecto de
    producción, tablas o columnas que faltan,
  · detecta una carga corrupta, se detiene ante un error del servidor, y NUNCA imprime la llave.

Correr:  python -m pytest tests/python/test_restaurar.py -q
"""
import base64
import decimal
import io
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from postgrest_falso import ServidorFalso, Tabla  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "herramientas"))
import restaurar_respaldo as rr  # noqa: E402

HTML = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"


def jwt(**carga):
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64(carga)}.firma-de-prueba"


@pytest.fixture(autouse=True)
def _jamas_a_internet(monkeypatch):
    """Red de seguridad: si alguna falla del programa lo dejara conectarse a un proyecto real (por ejemplo, el de
    producción), la prueba se rompe ANTES de salir del computador."""
    original = rr.Cliente.__init__

    def seguro(self, base, *a, **k):
        assert urllib.parse.urlparse(base).hostname in rr.HOSTS_LOCALES, f"¡la prueba intentó conectarse a {base}!"
        original(self, base, *a, **k)
    monkeypatch.setattr(rr.Cliente, "__init__", seguro)


LLAVE = jwt(role="service_role", iss="supabase-demo")
LLAVE_ANON = jwt(role="anon", iss="supabase-demo")


# ── Datos y servidor de ejemplo ───────────────────────────────────────────────
def datos_ejemplo():
    """Un respaldo pequeño pero con de todo: números con decimales, arreglos, JSON anidado, tildes, nulos, id grandes."""
    D = decimal.Decimal
    ped = lambda i, **kw: {"id": i, "fecha": "2026-10-01", "turno": "almuerzo", "mesa": i % 8 + 1, "estado": "pagado", "pedido": f"Plato ñ {i}",  # noqa: E731
                           "monto_total": D("24000.50") + i, "es_fiar": False, "cliente_fiado_id": None, "grupo_pedido": None, **kw}
    return {
        # A propósito, los hijos ANTES que los padres: el script tiene que reordenar.
        "pedidos": [ped(1), ped(2, estado="pendiente", es_fiar=True, cliente_fiado_id=2, monto_total=D("18000.00")), ped(90071992547409, monto_total=D("12345678901234567.89"))],
        "abonos_fiado": [{"id": 1, "fecha": "2026-10-02", "cliente_fiado_id": 1, "monto": D("5000.00"), "cuenta": "transferencia", "nota": 'Abono de "doña" Marta\nlínea 2'}],
        "consumos": [{"fecha": "2026-10-01", "producto_id": 1, "nombre": "Arroz", "cantidad": D("2.500"), "costo": D("10501.25")}],
        "pedidos_descuentos": [{"id": 1, "pedido_ids": [1, 2], "descuento_nuevo": D("2000.00"), "motivo": "Cliente frecuente", "cierre_ajustado": True, "valor_lista": None}],
        "config": [{"clave": "ultimo_respaldo", "valor": {"fecha": "2026-10-01", "conteos": {"pedidos": 3}, "ok": True, "nada": None, "monto": D("0.10")}, "actualizado_en": "2026-10-01T22:00:00+00:00"}],
        "clientes_fiado": [{"id": 1, "nombre": "Doña Marta", "created_at": "2026-09-01T10:00:00+00:00"}, {"id": 2, "nombre": "Don Pedro", "created_at": "2026-09-02T10:00:00+00:00"}],
        "inventario": [{"id": 1, "nombre": "Arroz", "unidad": "kg", "stock": D("12.500"), "minimo": D("5"), "costo": D("4200.50")}],
        "mesas": [{"id": i, "numero": i, "estado": "libre"} for i in range(1, 9)],
        "cierres_dia": [{"id": 1, "fecha": "2026-10-01", "turno": "almuerzo", "efectivo": D("150000.50"), "transferencia": D("80000"), "gastos": D("20000"), "resultado": D("210000.50")}],
        "aperturas_turno": [], "notas_dia": [{"id": 1, "fecha": "2026-10-01", "texto": None}], "gastos_dia": [],
        "egresos": [{"id": 1, "fecha": "2026-10-01", "cat": "Otro", "cuenta": "efectivo", "description": "Gas", "monto": D("45000")}],
        "movimientos_caja": [], "ingresos_extra": [], "pedidos_eliminados": [],
        "configuracion": [{"id": 1, "clave": "mesas", "valor": 10, "vigente_desde": "2026-09-01T15:00:00+00:00", "creado_por": "luis", "creado_en": "2026-09-01T15:00:00+00:00"}],
    }


def respaldo_json(tablas, **extra):
    """Escribe el archivo como el botón Exportar (con los números exactos, para poder probar la precisión)."""
    cuerpo = {"version": 1, "generado_en": "2026-10-04T03:00:00.000Z", "fecha": "2026-10-03",
              "conteos": {t: len(f) for t, f in tablas.items()}, "tablas": tablas}
    cuerpo.update(extra)
    return rr.volcar(cuerpo)


def tablas_del_servidor(tablas_datos, **cambios):
    """El destino: las mismas tablas, vacías, con las llaves foráneas del sistema."""
    llaves = {"pedidos": [("cliente_fiado_id", "clientes_fiado", "id")], "abonos_fiado": [("cliente_fiado_id", "clientes_fiado", "id")],
              "consumos": [("producto_id", "inventario", "id")]}
    t = {}
    for nombre, filas in tablas_datos.items():
        columnas = sorted({c for f in filas for c in f}) or ["id"]
        t[nombre] = Tabla(columnas, pk="clave" if nombre == "config" else "id", llaves=llaves.get(nombre))
    t["consumos"].pk = "fecha"   # esta tabla no usa id: la llave única no importa para las pruebas
    t.update(cambios)
    return t


@pytest.fixture
def datos():
    return datos_ejemplo()


@pytest.fixture
def archivo(tmp_path, datos):
    ruta = tmp_path / "ElLobo_respaldo_completo_2026-10-03.json"
    ruta.write_text(respaldo_json(datos), encoding="utf-8")
    return ruta


@pytest.fixture
def servidor(datos):
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        yield s


def correr(monkeypatch, *argumentos, llave=LLAVE):
    if llave is None:
        monkeypatch.delenv(rr.VARIABLE_LLAVE, raising=False)
    else:
        monkeypatch.setenv(rr.VARIABLE_LLAVE, llave)
    monkeypatch.delenv(rr.VARIABLE_URL, raising=False)
    salida = io.StringIO()
    codigo = rr.principal([str(a) for a in argumentos], salida=salida)
    texto = salida.getvalue()
    assert LLAVE not in texto and LLAVE_ANON not in texto, "¡la llave apareció en la pantalla!"
    return codigo, texto


# ── Simulacro ─────────────────────────────────────────────────────────────────
def test_simulacro_sin_destino_solo_revisa_el_archivo(monkeypatch, archivo):
    codigo, texto = correr(monkeypatch, archivo)
    assert codigo == 0 and "SIMULACRO sin conexión" in texto
    assert "17 tablas" in texto and "pedidos" in texto


def test_simulacro_con_destino_no_escribe_nada(monkeypatch, archivo, servidor):
    codigo, texto = correr(monkeypatch, archivo, "--url", servidor.url)
    assert codigo == 0 and "SIMULACRO terminado" in texto and "No se escribió nada" in texto
    assert set(servidor.metodos) == {"GET"}
    assert all(not t.filas for t in servidor.tablas.values())


def test_el_simulacro_no_puede_escribir_ni_por_error(servidor):
    cliente = rr.Cliente(servidor.url, LLAVE, solo_lectura=True)
    with pytest.raises(AssertionError):
        cliente.pedir("POST", "/rest/v1/mesas", b"[]")


# ── Restauración completa ─────────────────────────────────────────────────────
def test_restaura_todo_en_orden_y_verifica(monkeypatch, archivo, servidor, datos):
    codigo, texto = correr(monkeypatch, archivo, "--url", servidor.url, "--ejecutar", "--lote", 2)
    assert codigo == 0, texto
    assert "Verificación completa: todo quedó idéntico" in texto and "DIFERENCIA" not in texto
    for tabla, filas in datos.items():
        guardadas = servidor.filas(tabla)
        assert len(guardadas) == len(filas), tabla
    # Los id originales se conservan y los números quedan exactos (sin pasar por decimales binarios).
    pedidos = {f["id"]: f for f in servidor.filas("pedidos")}
    assert pedidos[90071992547409]["monto_total"] == decimal.Decimal("12345678901234567.89")
    assert servidor.filas("config")[0]["valor"]["monto"] == decimal.Decimal("0.10")
    assert servidor.filas("pedidos_descuentos")[0]["pedido_ids"] == [1, 2]
    assert servidor.filas("notas_dia")[0]["texto"] is None
    # El SQL de contadores se imprime para las tablas con id numérico.
    assert "pg_get_serial_sequence('public.pedidos', 'id')" in texto
    ultimo = texto.split("ÚLTIMO PASO")[1]
    assert not re.search(r"public\.config\b", ultimo)                     # config no tiene id…
    assert "pg_get_serial_sequence('public.configuracion', 'id')" in ultimo   # …configuracion sí: su contador tiene que seguir al día


def test_carga_en_tandas(monkeypatch, archivo, servidor):
    correr(monkeypatch, archivo, "--url", servidor.url, "--ejecutar", "--lote", 2)
    envios_mesas = [p for p in servidor.peticiones if p[0] == "POST" and p[1].endswith("/mesas")]
    assert len(envios_mesas) == 4                                          # 8 mesas, de 2 en 2
    assert all(p[3].startswith(b"[") and json.loads(p[3]) for p in envios_mesas)
    assert all(p[2].get("Prefer") == "return=minimal" for p in envios_mesas)


def test_respeta_el_orden_de_las_llaves_aunque_el_archivo_venga_al_reves(monkeypatch, archivo, servidor):
    correr(monkeypatch, archivo, "--url", servidor.url, "--ejecutar")
    tablas_en_orden = [re.search(r"/rest/v1/(\w+)", p[1]).group(1) for p in servidor.peticiones if p[0] == "POST"]
    assert tablas_en_orden.index("clientes_fiado") < tablas_en_orden.index("pedidos")
    assert tablas_en_orden.index("inventario") < tablas_en_orden.index("consumos")


def test_formato_de_la_tarea_semanal(monkeypatch, tmp_path, datos):
    sin_dos = {k: v for k, v in datos.items() if k not in ("pedidos_descuentos", "pedidos_eliminados")}
    ruta = tmp_path / "tarea.json"
    ruta.write_text(json.dumps({"generado_en": "2026-10-04T03:00:00Z", "tablas": json.loads(respaldo_json(sin_dos))["tablas"], "errores": []}), encoding="utf-8")
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        codigo, texto = correr(monkeypatch, ruta, "--url", s.url, "--ejecutar")
    assert codigo == 0, texto
    assert "formato «tarea semanal»" in texto and "NO incluye: pedidos_eliminados, pedidos_descuentos" in texto


def test_el_orden_de_carga_usa_las_llaves_del_esquema_si_se_da(monkeypatch, archivo, datos, tmp_path):
    # Un esquema donde, además, «cierres_dia» depende de «inventario»: el orden debe respetarlo.
    esquema = {"tablas": [{"nombre": t, "tipo": "r"} for t in datos], "columnas": [],
               "restricciones": [{"tabla": "cierres_dia", "nombre": "x", "tipo": "f", "tabla_referida": "inventario", "definicion": ""},
                                 {"tabla": "pedidos", "nombre": "y", "tipo": "f", "tabla_referida": "clientes_fiado", "definicion": ""}]}
    ruta_esquema = tmp_path / "esquema.json"
    ruta_esquema.write_text(json.dumps(esquema), encoding="utf-8")
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        codigo, _ = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar", "--esquema", ruta_esquema)
        orden = [re.search(r"/rest/v1/(\w+)", p[1]).group(1) for p in s.peticiones if p[0] == "POST"]
    assert codigo == 0 and orden.index("inventario") < orden.index("cierres_dia")


def test_las_columnas_calculadas_no_se_envian(monkeypatch, tmp_path, datos):
    datos["inventario"][0]["area"] = decimal.Decimal("25.0")
    ruta = tmp_path / "r.json"
    ruta.write_text(respaldo_json(datos), encoding="utf-8")
    esquema = {"tablas": [{"nombre": t, "tipo": "r"} for t in datos], "restricciones": [],
               "columnas": [{"tabla": "inventario", "nombre": "area", "generada": "s"}]}
    ruta_esquema = tmp_path / "esquema.json"
    ruta_esquema.write_text(json.dumps(esquema), encoding="utf-8")
    tablas = tablas_del_servidor(datos)
    tablas["inventario"].generadas = {"area"}
    with ServidorFalso(LLAVE, tablas) as s:
        # El servidor falso rechaza cualquier envío que incluya «area»; la verificación igual compara bien porque no la guarda.
        correr(monkeypatch, ruta, "--url", s.url, "--ejecutar", "--esquema", ruta_esquema)
        envio = next(p for p in s.peticiones if p[0] == "POST" and p[1].endswith("/inventario"))
    assert "area" not in json.loads(envio[3])[0]


# ── Respaldo dañado o incompleto: se rechaza sin tocar el destino ─────────────
def _rechazado(monkeypatch, ruta, servidor, codigo_esperado, fragmento):
    codigo, texto = correr(monkeypatch, ruta, "--url", servidor.url, "--ejecutar")
    assert codigo == codigo_esperado, texto
    assert fragmento in texto, texto
    assert servidor.peticiones == [], "no debió ni conectarse al destino"
    assert "NO SE HIZO NADA" in texto


def test_rechaza_archivo_cortado(monkeypatch, tmp_path, datos, servidor):
    ruta = tmp_path / "cortado.json"
    ruta.write_text(respaldo_json(datos)[:-300], encoding="utf-8")
    _rechazado(monkeypatch, ruta, servidor, 3, "no es un JSON válido")


def test_rechaza_archivo_inexistente_o_que_no_es_un_respaldo(monkeypatch, tmp_path, servidor):
    _rechazado(monkeypatch, tmp_path / "no_existe.json", servidor, 3, "No pude abrir")
    otro = tmp_path / "otro.json"
    otro.write_text('{"hola": 1}', encoding="utf-8")
    _rechazado(monkeypatch, otro, servidor, 3, "no trae la sección «tablas»")
    lista = tmp_path / "lista.json"
    lista.write_text("[1, 2, 3]", encoding="utf-8")
    _rechazado(monkeypatch, lista, servidor, 3, "no parece un respaldo")


def test_rechaza_si_los_conteos_no_cuadran(monkeypatch, tmp_path, datos, servidor):
    ruta = tmp_path / "r.json"
    cuerpo = json.loads(respaldo_json(datos))
    cuerpo["conteos"]["pedidos"] = 99
    ruta.write_text(json.dumps(cuerpo), encoding="utf-8")
    _rechazado(monkeypatch, ruta, servidor, 3, "declara 99 filas y el archivo trae 3")


def test_rechaza_un_respaldo_hecho_con_errores(monkeypatch, tmp_path, datos, servidor):
    ruta = tmp_path / "r.json"
    ruta.write_text(json.dumps({"generado_en": "x", "tablas": json.loads(respaldo_json(datos))["tablas"], "errores": {"egresos": "HTTP 401"}}), encoding="utf-8")
    _rechazado(monkeypatch, ruta, servidor, 3, "INCOMPLETO")


def test_rechaza_tablas_desconocidas(monkeypatch, tmp_path, datos, servidor):
    datos["tabla_inventada"] = [{"id": 1}]
    ruta = tmp_path / "r.json"
    ruta.write_text(respaldo_json(datos), encoding="utf-8")
    _rechazado(monkeypatch, ruta, servidor, 3, "tablas que no conozco: tabla_inventada")


def test_rechaza_id_repetidos_y_filas_con_columnas_distintas(monkeypatch, tmp_path, datos, servidor):
    repetidos = {**datos, "mesas": datos["mesas"] + [dict(datos["mesas"][0])]}
    ruta = tmp_path / "rep.json"
    ruta.write_text(json.dumps({"tablas": json.loads(respaldo_json(repetidos))["tablas"]}), encoding="utf-8")
    _rechazado(monkeypatch, ruta, servidor, 3, "id repetidos")
    raras = {**datos, "mesas": datos["mesas"][:2] + [{"id": 99, "numero": 99}]}
    ruta2 = tmp_path / "raras.json"
    ruta2.write_text(json.dumps({"tablas": json.loads(respaldo_json(raras))["tablas"]}), encoding="utf-8")
    _rechazado(monkeypatch, ruta2, servidor, 3, "no tienen todas las mismas columnas")


# ── Seguridad del destino y de la llave ───────────────────────────────────────
def test_rechaza_si_el_destino_ya_tiene_datos_y_ofrece_el_sql_para_vaciarlo(monkeypatch, archivo, servidor):
    servidor.tablas["mesas"].filas.append({"id": 1, "numero": 1, "estado": "libre"})
    codigo, texto = correr(monkeypatch, archivo, "--url", servidor.url, "--ejecutar")
    assert codigo == 2 and "El destino NO está vacío: mesas (1)" in texto
    assert "truncate table public.config" in texto and "restart identity cascade" in texto
    assert "POST" not in servidor.metodos


@pytest.mark.parametrize("llave,fragmento", [
    (LLAVE_ANON, "llave PÚBLICA"),
    ("sb_publishable_abcdefghijk", "llave PÚBLICA"),
    ("una-llave-cualquiera", "no parece una llave de servicio"),
    (jwt(role="authenticated"), "llave PÚBLICA"),
    ("", "Falta la llave de servicio"),
    (None, "Falta la llave de servicio"),
])
def test_rechaza_llaves_que_no_son_de_servicio(monkeypatch, archivo, servidor, llave, fragmento):
    codigo, texto = correr(monkeypatch, archivo, "--url", servidor.url, "--ejecutar", llave=llave)
    assert codigo == 2 and fragmento in texto
    assert servidor.peticiones == []


def test_rechaza_destinos_que_no_son_supabase(monkeypatch, archivo):
    for url in ("https://example.com", "http://algo.supabase.co", "ftp://x.supabase.co", "https://supabase.co.malo.com"):
        codigo, texto = correr(monkeypatch, archivo, "--url", url, "--ejecutar")
        assert codigo == 2 and "no parece un proyecto de Supabase" in texto, url


def test_rechaza_la_url_de_produccion_sin_la_frase(monkeypatch, archivo):
    produccion = f"https://{rr.REF_PRODUCCION}.supabase.co"
    # Sin la frase nunca llega a conectarse (si lo hiciera, esta prueba no puede salir bien).
    codigo, texto = correr(monkeypatch, archivo, "--url", produccion, "--ejecutar", llave=jwt(role="service_role", ref=rr.REF_PRODUCCION))
    assert codigo == 2 and "PRODUCCIÓN" in texto and rr.FRASE_PRODUCCION in texto
    codigo, texto = correr(monkeypatch, archivo, "--url", produccion, "--ejecutar", "--permitir-produccion", "frase equivocada", llave=jwt(role="service_role", ref=rr.REF_PRODUCCION))
    assert codigo == 2 and "PRODUCCIÓN" in texto


def test_validar_destino_pura():
    produccion = f"https://{rr.REF_PRODUCCION}.supabase.co"
    llave_prod = jwt(role="service_role", ref=rr.REF_PRODUCCION)
    with pytest.raises(rr.Rechazo, match="PRODUCCIÓN"):
        rr.validar_destino(produccion, llave_prod)
    with pytest.raises(rr.Rechazo, match="PRODUCCIÓN"):
        rr.validar_destino("http://127.0.0.1:5000", llave_prod)               # llave de producción en cualquier destino
    assert rr.validar_destino(produccion, llave_prod, rr.FRASE_PRODUCCION) == produccion  # con la frase exacta, sí
    prueba = "https://abcdefghijklmnopqrst.supabase.co"
    assert rr.validar_destino(prueba + "/", jwt(role="service_role", ref="abcdefghijklmnopqrst")) == prueba
    assert rr.validar_destino(prueba, "sb_secret_abc") == prueba
    with pytest.raises(rr.Rechazo, match="no coinciden"):
        rr.validar_destino(prueba, jwt(role="service_role", ref="otroproyectoxxxxxxxxx"))


def test_la_llave_no_se_acepta_por_linea_de_comandos(archivo):
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "restaurar_respaldo.py"), str(archivo), "--llave", "secreto"], capture_output=True, text=True)
    assert r.returncode == 2 and "secreto" not in r.stdout


def test_la_url_de_produccion_coincide_con_la_del_sistema():
    assert f"const SB_URL = 'https://{rr.REF_PRODUCCION}.supabase.co'" in HTML.read_text(encoding="utf-8")


def test_las_tablas_conocidas_son_las_que_respalda_el_sistema():
    html = HTML.read_text(encoding="utf-8")
    lista = re.search(r"const TABLAS_RESPALDO = \[(.*?)\];", html, re.S).group(1)
    assert set(re.findall(r"'(\w+)'", lista)) == set(rr.TABLAS_CONOCIDAS)


# ── Tabla o columna que falta en el destino ───────────────────────────────────
def test_pide_correr_el_esquema_si_falta_una_tabla(monkeypatch, archivo, datos):
    tablas = tablas_del_servidor(datos)
    del tablas["egresos"]
    with ServidorFalso(LLAVE, tablas) as s:
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
        assert codigo == 2 and "«egresos» no existe en el destino" in texto and "esquema_completo.sql" in texto
        assert "POST" not in s.metodos


def test_pide_regenerar_el_esquema_si_falta_una_columna(monkeypatch, archivo, datos):
    tablas = tablas_del_servidor(datos)
    tablas["pedidos"].columnas.remove("es_fiar")
    with ServidorFalso(LLAVE, tablas) as s:
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
        assert codigo == 2 and "le faltan columnas" in texto and "es_fiar" in texto
        assert "POST" not in s.metodos


def test_llave_equivocada_para_ese_proyecto(monkeypatch, archivo, datos):
    with ServidorFalso(jwt(role="service_role", iss="otro"), tablas_del_servidor(datos)) as s:
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
        assert codigo == 2 and "rechazó la llave" in texto


def test_sin_conexion(monkeypatch, archivo):
    codigo, texto = correr(monkeypatch, archivo, "--url", "http://127.0.0.1:1", "--ejecutar")
    assert codigo == 4 and "No pude conectarme" in texto


# ── Fallas durante la carga ───────────────────────────────────────────────────
def test_detecta_una_carga_corrupta(monkeypatch, archivo, datos):
    def corromper(s):
        if s.filas("pedidos") and not getattr(s, "_hecho", False):
            s._hecho = True
            s.tablas["pedidos"].filas[0]["monto_total"] = decimal.Decimal("1.00")     # un valor cambia
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        s.despues_de_cargar = corromper
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
    assert codigo == 1 and "LA VERIFICACIÓN FALLÓ" in texto
    assert re.search(r"pedidos\s+DIFERENCIA", texto) and "falta / distinta" in texto and "sobra / distinta" in texto


def test_detecta_una_fila_perdida(monkeypatch, archivo, datos):
    def perder(s):
        if len(s.filas("mesas")) == 8 and not getattr(s, "_hecho", False):
            s._hecho = True
            s.tablas["mesas"].filas.pop()
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        s.despues_de_cargar = perder
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
    assert codigo == 1 and re.search(r"mesas\s+DIFERENCIA: respaldo 8 · destino 7 · faltan 1", texto)


def test_se_detiene_ante_un_error_del_servidor_y_no_sigue(monkeypatch, archivo, datos):
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        s.fallar_en_post = 3
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
        assert s.posts == 3                                                  # no insiste ni sigue con las demás tablas
    assert codigo == 4 and "SE DETUVO" in texto and "HTTP 500" in texto
    assert "no lo uses" in texto and "truncate table" in texto


def test_un_conflicto_de_llaves_se_informa_con_la_tabla(monkeypatch, archivo, datos):
    tablas = tablas_del_servidor(datos)
    tablas["pedidos"].filas = []   # vacío para pasar la revisión...
    with ServidorFalso(LLAVE, tablas) as s:
        # ...pero una llave foránea apunta a un cliente que no existe: se quita el cliente 2 del respaldo.
        sin_cliente = {**datos, "clientes_fiado": [datos["clientes_fiado"][0]]}
        ruta = Path(archivo).with_name("sin_cliente.json")
        ruta.write_text(respaldo_json(sin_cliente), encoding="utf-8")
        codigo, texto = correr(monkeypatch, ruta, "--url", s.url, "--ejecutar")
    assert codigo == 4 and "Falló la carga de «pedidos»" in texto and "23503" in texto


def test_la_llave_nunca_se_imprime_aunque_el_servidor_la_repita(monkeypatch, archivo, datos):
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        s.fallar_en_post = 2
        s.eco_llave_en_error = True
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")     # correr() ya vigila que no aparezca
        assert codigo == 4 and "«llave»" in texto
        # Y la llave solo viaja en los encabezados, nunca en la dirección.
        assert all(LLAVE not in ruta for _, ruta, _, _ in s.peticiones)


def test_la_verificacion_lee_todas_las_paginas(monkeypatch, archivo, datos):
    """Con tandas de lectura pequeñas, un cambio escondido en la ÚLTIMA página también se detecta."""
    monkeypatch.setattr(rr, "LOTE_LECTURA", 3)

    def cambiar_ultima(s):
        if len(s.filas("mesas")) == 8 and not getattr(s, "_hecho", False):
            s._hecho = True
            s.tablas["mesas"].filas[7]["estado"] = "ocupada"                # la fila 8 está en la 3.ª página
    with ServidorFalso(LLAVE, tablas_del_servidor(datos)) as s:
        s.despues_de_cargar = cambiar_ultima
        codigo, texto = correr(monkeypatch, archivo, "--url", s.url, "--ejecutar")
        paginas = [p for p in s.peticiones if p[0] == "GET" and "/mesas?" in p[1] and "offset=" in p[1]]
    assert codigo == 1 and re.search(r"mesas\s+DIFERENCIA", texto)
    assert len(paginas) == 3


def test_el_proxy_del_entorno_no_se_usa_con_servidores_locales(monkeypatch, archivo, servidor):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")                  # un proxy que no existe
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    codigo, texto = correr(monkeypatch, archivo, "--url", servidor.url)
    assert codigo == 0, texto


# ── Utilidades ────────────────────────────────────────────────────────────────
def test_numeros_equivalentes_se_comparan_iguales():
    D = decimal.Decimal
    assert rr.canonico(1500) == rr.canonico(D("1500.00")) == rr.canonico(1500.0) == rr.canonico(D("1.5E+3"))
    assert rr.canonico(D("0.10")) == rr.canonico(0.1)
    assert rr.canonico(D("0.0")) == rr.canonico(0)
    assert rr.canonico("1500") != rr.canonico(1500)
    assert rr.canonico(True) != rr.canonico(1)
    assert rr.canonico(None) != rr.canonico("")
    assert rr.canonico({"a": [1, D("2.0")]}) == rr.canonico({"a": [D("1.0"), 2]})
    assert rr.canonico([1, 2]) != rr.canonico([2, 1])


def test_volcar_conserva_los_decimales_exactos():
    original = '{"a": 1500.00, "b": [0.10, 12345678901234567.89], "c": "ñ\\"x", "d": null, "e": true, "f": 1.5E+3}'
    ida_y_vuelta = rr._cargar_json(rr.volcar(rr._cargar_json(original)))
    assert rr.volcar(rr._cargar_json(original)) == '{"a":1500.00,"b":[0.10,12345678901234567.89],"c":"ñ\\"x","d":null,"e":true,"f":1.5E+3}'
    assert ida_y_vuelta == rr._cargar_json(original)


def test_orden_por_llaves():
    f = lambda hijo, padre: {"tipo": "f", "tabla": hijo, "tabla_referida": padre, "nombre": f"{hijo}_fk"}  # noqa: E731
    orden, avisos = rr.orden_por_llaves(["pedidos", "inventario", "consumos", "clientes_fiado"], [f("consumos", "inventario"), f("pedidos", "clientes_fiado")])
    assert orden.index("inventario") < orden.index("consumos") and orden.index("clientes_fiado") < orden.index("pedidos")
    assert rr.orden_por_llaves(["pedidos", "clientes_fiado"])[0] == ["clientes_fiado", "pedidos"]
    _, avisos = rr.orden_por_llaves(["a", "b"], [f("a", "a")])
    assert "apunta a sí misma" in avisos[0]
    with pytest.raises(rr.Rechazo, match="ciclo"):
        rr.orden_por_llaves(["a", "b"], [f("a", "b"), f("b", "a")])


def test_sql_de_contadores_y_de_vaciado(datos):
    respaldo = rr.Respaldo(datos, "exportar", None, [])
    sql = rr.sql_secuencias(respaldo)
    assert "select setval(pg_get_serial_sequence('public.pedidos', 'id'), max(id)) from public.pedidos having max(id) is not null;" in sql
    assert not re.search(r"public\.config\b", sql) and "aperturas_turno" not in sql   # sin id numérico o sin filas
    assert "select setval(pg_get_serial_sequence('public.configuracion', 'id'), max(id)) from public.configuracion having max(id) is not null;" in sql
    assert rr.sql_vaciar(["a", "b"]) == "truncate table public.a, public.b restart identity cascade;"


def test_la_herramienta_por_linea_de_comandos(tmp_path, archivo, servidor):
    import os
    entorno = {**os.environ, rr.VARIABLE_LLAVE: LLAVE, rr.VARIABLE_URL: servidor.url}
    r = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "restaurar_respaldo.py"), str(archivo), "--ejecutar"], capture_output=True, text=True, env=entorno)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Verificación completa" in r.stdout and LLAVE not in r.stdout + r.stderr
