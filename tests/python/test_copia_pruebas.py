"""Pruebas de la herramienta que fabrica la copia de pruebas (herramientas/generar_copia_pruebas.py).

Se prueba que la copia:
  · cambia SOLO lo previsto (dirección y llave públicas, nombres de almacenamiento, título, carteles) y que, al
    deshacer esos cambios, vuelve a quedar IDÉNTICA al sistema real;
  · no deja ningún rastro de producción (dirección, llave, nombres con que el navegador recuerda la sesión);
  · se niega, sin escribir nada, ante: llave de servicio o secreta, llave de otro rol / de otro proyecto / vencida / con
    otro formato, dirección rara, proyecto de producción, y carpeta de salida dentro del repositorio del sistema.

Correr:  python -m pytest tests/python/test_copia_pruebas.py -q
"""
import base64
import json
import re
import sys
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "herramientas"))
import generar_copia_pruebas as gp  # noqa: E402
import restaurar_respaldo as rr  # noqa: E402

SISTEMA = RAIZ / "Contabilidad" / "ElLobo-Sistema Contable.html"
REF = "abcdefghijklmnopqrst"          # un proyecto de pruebas inventado (20 letras)
URL = f"https://{REF}.supabase.co"


def jwt(**carga):
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64(carga)}.firma-de-prueba"


LLAVE = jwt(role="anon", ref=REF, exp=int(time.time()) + 10**8)


@pytest.fixture()
def afuera(tmp_path):
    """Una carpeta de salida FUERA del repositorio."""
    return tmp_path / "sitio-pruebas"


def correr(afuera, url=URL, llave=LLAVE, **kw):
    return gp.generar(afuera, url, llave, **kw)


def sistema():
    return SISTEMA.read_text(encoding="utf-8")


# ── Lo que sí se hace ─────────────────────────────────────────────────────────
def test_la_copia_apunta_al_proyecto_de_pruebas_y_nada_mas_cambia(afuera):
    correr(afuera)
    copia = (afuera / gp.REL_SISTEMA).read_text(encoding="utf-8")
    assert f"const SB_URL = '{URL}';" in copia
    assert f"const SB_KEY = '{LLAVE}';" in copia
    # Al deshacer los cambios previstos queda IDÉNTICA al sistema real (nada más cambió).
    assert gp.revertir(copia, sistema()) == sistema()


def test_no_queda_ningun_rastro_de_produccion(afuera):
    correr(afuera)
    copia = (afuera / gp.REL_SISTEMA).read_text(encoding="utf-8")
    assert rr.REF_PRODUCCION not in copia
    assert gp._constante(sistema(), "SB_KEY") not in copia
    for viejo in gp.CLAVES_ALMACEN:
        assert f"'{viejo}'" not in copia
    for nuevo in gp.CLAVES_ALMACEN.values():
        assert copia.count(f"'{nuevo}'") == 1


def test_titulo_carteles_y_noindex(afuera):
    correr(afuera)
    copia = (afuera / gp.REL_SISTEMA).read_text(encoding="utf-8")
    assert "<title>🧪 PRUEBAS — El Lobo — Sistema Contable</title>" in copia
    assert 'id="aviso-pruebas"' in copia and 'id="franja-pruebas"' in copia
    assert '<meta name="robots" content="noindex, nofollow">' in copia
    assert "Disallow: /" in (afuera / "robots.txt").read_text(encoding="utf-8")


def test_el_menu_y_la_entrada_se_copian_tal_cual(afuera):
    correr(afuera)
    for rel in (gp.REL_MENU, gp.REL_INDEX):
        assert (afuera / rel).read_bytes() == (RAIZ / rel).read_bytes()
    assert "copia de PRUEBAS" in (afuera / "LEEME.md").read_text(encoding="utf-8")


def test_es_repetible_y_pisa_solo_lo_suyo(afuera):
    correr(afuera)
    (afuera / ".git").mkdir()
    (afuera / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    primero = (afuera / gp.REL_SISTEMA).read_bytes()
    correr(afuera)
    assert (afuera / gp.REL_SISTEMA).read_bytes() == primero
    assert (afuera / ".git" / "HEAD").exists()


def test_acepta_la_direccion_con_barra_final(afuera):
    correr(afuera, url=URL + "/")
    assert f"const SB_URL = '{URL}';" in (afuera / gp.REL_SISTEMA).read_text(encoding="utf-8")


def test_acepta_la_llave_con_espacios_o_salto_de_linea_de_copiar_y_pegar(afuera):
    correr(afuera, llave=f"  {LLAVE}\n")
    assert f"const SB_KEY = '{LLAVE}';" in (afuera / gp.REL_SISTEMA).read_text(encoding="utf-8")


def test_el_sistema_real_sigue_siendo_el_que_vigila_restaurar(afuera):
    assert gp.ref_produccion(sistema()) == rr.REF_PRODUCCION


# ── Lo que se rechaza (y no se escribe NADA) ──────────────────────────────────
def rechazado(afuera, texto, **kw):
    with pytest.raises(rr.Rechazo) as e:
        correr(afuera, **kw)
    assert texto.lower() in str(e.value).lower(), str(e.value)
    assert not afuera.exists(), "no debía escribir nada"


def test_rechaza_la_llave_de_servicio(afuera):
    rechazado(afuera, "SERVICIO", llave=jwt(role="service_role", ref=REF, exp=int(time.time()) + 10**8))
    rechazado(afuera, "SERVICIO", llave="sb_secret_abc123")


def test_rechaza_llaves_que_no_son_la_anon_clasica(afuera):
    rechazado(afuera, "anon", llave="sb_publishable_abc123")
    rechazado(afuera, "anon", llave="esto-no-es-una-llave")
    rechazado(afuera, "rol «authenticated»", llave=jwt(role="authenticated", ref=REF, exp=int(time.time()) + 10**8))


def test_rechaza_llave_de_otro_proyecto_o_vencida(afuera):
    rechazado(afuera, "no coinciden", llave=jwt(role="anon", ref="zzzzzzzzzzzzzzzzzzzz", exp=int(time.time()) + 10**8))
    rechazado(afuera, "venció", llave=jwt(role="anon", ref=REF, exp=int(time.time()) - 5))


def test_rechaza_produccion_por_la_direccion_o_por_la_llave(afuera):
    llave_prod = gp._constante(sistema(), "SB_KEY")
    rechazado(afuera, "debe apuntar a OTRO proyecto", url=f"https://{rr.REF_PRODUCCION}.supabase.co", llave=llave_prod)
    # llave de producción con una dirección de pruebas: tampoco (la llave es de otro proyecto)
    rechazado(afuera, "no coinciden", llave=llave_prod)
    # llave «de pruebas» pero la dirección de producción
    rechazado(afuera, "no coinciden", url=f"https://{rr.REF_PRODUCCION}.supabase.co")


def sistema_con_otro_proyecto(tmp_path, ref):
    """Una copia del sistema cuyo SB_URL es de OTRO proyecto (para probar las dos fuentes de «cuál es producción»)."""
    falso = tmp_path / "falso"
    (falso / "Contabilidad").mkdir(parents=True)
    (falso / "Menu").mkdir()
    html = sistema().replace(f"https://{rr.REF_PRODUCCION}.supabase.co", f"https://{ref}.supabase.co")
    (falso / gp.REL_SISTEMA).write_text(html, encoding="utf-8")
    (falso / gp.REL_MENU).write_text("menu", encoding="utf-8")
    (falso / gp.REL_INDEX).write_text("index", encoding="utf-8")
    return falso


def test_produccion_es_la_del_propio_sistema_y_tambien_la_que_vigila_restaurar(tmp_path, afuera):
    """Las dos fuentes cuentan: lo que dice el SB_URL del sistema que se copia y la constante de restaurar_respaldo.py."""
    otro = "zzzzzzzzzzzzzzzzzzzz"
    falso = sistema_con_otro_proyecto(tmp_path, otro)
    rechazado(afuera, "debe apuntar a OTRO proyecto", url=f"https://{otro}.supabase.co",
              llave=jwt(role="anon", ref=otro, exp=int(time.time()) + 10**8), origen=falso)
    rechazado(afuera, "debe apuntar a OTRO proyecto", url=f"https://{rr.REF_PRODUCCION}.supabase.co",
              llave=jwt(role="anon", ref=rr.REF_PRODUCCION, exp=int(time.time()) + 10**8), origen=falso)


@pytest.mark.parametrize("url", ["", "http://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
                                 "https://ejemplo.com", "https://corto.supabase.co", "abcdefghijklmnopqrst.supabase.co"])
def test_rechaza_direcciones_raras(afuera, url):
    with pytest.raises(rr.Rechazo):
        correr(afuera, url=url)
    assert not afuera.exists()


def test_rechaza_falta_de_llave(afuera):
    rechazado(afuera, "Falta la llave", llave="")


def test_rechaza_falta_de_direccion(afuera):
    rechazado(afuera, "Falta la dirección", url="")


def test_rechaza_escribir_dentro_del_repositorio():
    for dentro in (RAIZ / "pruebas-x", RAIZ, RAIZ.parent):
        with pytest.raises(rr.Rechazo, match="repositorio"):
            correr(dentro)
    assert not (RAIZ / "pruebas-x").exists()


def test_rechaza_si_el_sistema_cambio_de_forma(tmp_path, afuera):
    """Si algún día alguien cambia cómo se declara SB_URL/SB_KEY, la herramienta avisa en vez de generar algo a medias."""
    falso = tmp_path / "falso"
    (falso / "Contabilidad").mkdir(parents=True)
    (falso / "Menu").mkdir()
    html = sistema().replace("const SB_URL = ", "const SB_URL_VIEJA = ", 1)
    (falso / gp.REL_SISTEMA).write_text(html, encoding="utf-8")
    (falso / gp.REL_MENU).write_text("menu", encoding="utf-8")
    (falso / gp.REL_INDEX).write_text("index", encoding="utf-8")
    with pytest.raises(rr.Rechazo, match="SB_URL"):
        correr(afuera, origen=falso)
    assert not afuera.exists()


def test_rechaza_si_el_sistema_declara_dos_veces_la_direccion(tmp_path, afuera):
    """Dos líneas «const SB_URL» serían ambiguas (¿cuál manda?): no se adivina."""
    falso = tmp_path / "falso"
    (falso / "Contabilidad").mkdir(parents=True)
    (falso / "Menu").mkdir()
    html = sistema().replace("const SB_URL = ", "const SB_URL = 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co';\nconst SB_URL = ", 1)
    (falso / gp.REL_SISTEMA).write_text(html, encoding="utf-8")
    (falso / gp.REL_MENU).write_text("menu", encoding="utf-8")
    (falso / gp.REL_INDEX).write_text("index", encoding="utf-8")
    with pytest.raises(rr.Rechazo, match="SB_URL"):
        correr(afuera, origen=falso)
    assert not afuera.exists()


def test_rechaza_si_la_copia_conservara_algo_de_produccion(tmp_path, afuera):
    """Un rastro de producción escondido en otro lugar del sistema (por ejemplo un comentario) frena la copia."""
    falso = tmp_path / "falso"
    (falso / "Contabilidad").mkdir(parents=True)
    (falso / "Menu").mkdir()
    html = sistema().replace("</head>", f"<!-- respaldo viejo en {rr.REF_PRODUCCION} -->\n</head>", 1)
    (falso / gp.REL_SISTEMA).write_text(html, encoding="utf-8")
    (falso / gp.REL_MENU).write_text("menu", encoding="utf-8")
    (falso / gp.REL_INDEX).write_text("index", encoding="utf-8")
    with pytest.raises(rr.Rechazo, match="producción"):
        correr(afuera, origen=falso)
    assert not afuera.exists()


# ── Por la línea de comandos ──────────────────────────────────────────────────
def test_linea_de_comandos(afuera, capsys, monkeypatch):
    monkeypatch.delenv(gp.VARIABLE_LLAVE_PUBLICA, raising=False)
    assert gp.main(["--url", URL, "--llave-publica", LLAVE, "-o", str(afuera)]) == 0
    assert (afuera / gp.REL_SISTEMA).exists()
    assert "Copia de pruebas generada" in capsys.readouterr().out


def test_linea_de_comandos_rechazo_sale_con_codigo_2(afuera, capsys):
    assert gp.main(["--url", f"https://{rr.REF_PRODUCCION}.supabase.co", "--llave-publica", gp._constante(sistema(), "SB_KEY"), "-o", str(afuera)]) == 2
    assert "RECHAZADO" in capsys.readouterr().err
    assert not afuera.exists()


def test_la_llave_tambien_se_puede_pasar_por_variable(afuera, monkeypatch):
    monkeypatch.setenv(gp.VARIABLE_LLAVE_PUBLICA, LLAVE)
    assert gp.main(["--url", URL, "-o", str(afuera)]) == 0
