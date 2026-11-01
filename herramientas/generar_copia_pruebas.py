#!/usr/bin/env python3
"""Fabrica la COPIA DE PRUEBAS del sistema de El Lobo (la «réplica»): el mismo sistema, apuntando a otro proyecto de Supabase.

Para qué sirve
  Para probar cambios (y SQL) sin riesgo para el servicio real: se prueban en la réplica y, cuando funcionan, se
  fusionan a `main` como siempre. La copia sale del MISMO archivo del sistema; solo cambia lo mínimo y se verifica:

    1. La dirección (SB_URL) y la llave PÚBLICA (SB_KEY) del proyecto de pruebas.
    2. Los nombres con que el navegador recuerda cosas (sesión de caja, avisos vistos): así la réplica y producción
       —que viven en el mismo dominio, luiscadlo.github.io— no se pisan la sesión guardada.
    3. El título y un cartel rojo «ENTORNO DE PRUEBAS» (arriba y una franja fija abajo), para no confundirla en el
       mostrador. Además `noindex` (que Google no la publique).

  Qué se niega a hacer (sin escribir nada):
    · Apuntar al proyecto de PRODUCCIÓN (ni por la dirección ni por la llave).
    · Usar una llave que no sea la «anon» pública del mismo proyecto. En particular, la llave de servicio
      (service_role / secret) es secreta: jamás debe ir en una página web.
    · Escribir dentro del repositorio del sistema (la copia se publica desde otro repositorio).
    · Si el resultado todavía menciona algo de producción (dirección, llave o nombre de sesión).

Qué escribe (en la carpeta que le des, p. ej. el clon del repositorio de pruebas)
    index.html · Contabilidad/ElLobo-Sistema Contable.html (la copia) · Menu/Menú diario-El Lobo.html · robots.txt · LEEME.md

  Modo «archivo único» (--archivo-unico): en vez de una carpeta, escribe UN SOLO archivo HTML que lleva el Menú adentro
    (el Menú es una app aparte que el sistema carga desde ../Menu/: un archivo suelto —p. ej. en Descargas— no la
    encuentra y la pestaña Menú saldría con «No se ha podido acceder al archivo»). Es el que se le entrega al dueño.

Uso
  python herramientas/generar_copia_pruebas.py --url https://xxxx.supabase.co --llave-publica eyJ... -o ../Restaurante-El-Lobo-Pruebas
  python herramientas/generar_copia_pruebas.py --url https://xxxx.supabase.co --llave-publica eyJ... --archivo-unico ElLobo_PRUEBAS.html
  (la llave «anon» pública se puede pasar también en la variable LOBO_LLAVE_PUBLICA_PRUEBAS)
"""
import argparse
import base64
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import restaurar_respaldo as rr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
REL_SISTEMA = Path("Contabilidad") / "ElLobo-Sistema Contable.html"
REL_MENU = Path("Menu") / "Menú diario-El Lobo.html"
REL_INDEX = Path("index.html")
VARIABLE_LLAVE_PUBLICA = "LOBO_LLAVE_PUBLICA_PRUEBAS"

# Nombres con que el navegador recuerda cosas, en producción y en la réplica.
CLAVES_ALMACEN = {
    "ellobo.sesion.caja.v1": "ellobo.pruebas.sesion.caja.v1",
    "elLobo_auditoria_vistos": "elLobo_pruebas_auditoria_vistos",
}
TITULO = "<title>El Lobo — Sistema Contable</title>"
TITULO_PRUEBAS = "<title>🧪 PRUEBAS — El Lobo — Sistema Contable</title>"
META_NOINDEX = '<meta name="robots" content="noindex, nofollow">'

CARTEL_ARRIBA = (
    '<div id="aviso-pruebas" role="note" style="background:#b3261e;color:#fff;text-align:center;padding:8px 12px;'
    "font:700 13px/1.3 system-ui,sans-serif;letter-spacing:.3px;\">"
    "🧪 ENTORNO DE PRUEBAS — copia de ensayo. Lo que hagas aquí NO afecta al restaurante real.</div>"
)
FRANJA_ABAJO = (
    '<div id="franja-pruebas" aria-hidden="true" style="position:fixed;left:0;right:0;bottom:0;height:20px;z-index:2147483647;'
    "pointer-events:none;background:rgba(179,38,30,.92);color:#fff;text-align:center;"
    "font:700 11px/20px system-ui,sans-serif;letter-spacing:1.5px;\">PRUEBAS · PRUEBAS · PRUEBAS · PRUEBAS</div>"
    "<style>body{padding-bottom:20px}</style>"
)


def _decodificar_jwt(llave):
    partes = llave.split(".")
    if len(partes) != 3:
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(partes[1] + "=" * (-len(partes[1]) % 4)))
    except (ValueError, UnicodeDecodeError):
        return None


def _constante(html, nombre):
    """Valor de `const NOMBRE = '…';` (debe aparecer exactamente una vez)."""
    hallados = re.findall(r"^const %s = '([^']*)';" % re.escape(nombre), html, flags=re.M)
    if len(hallados) != 1:
        raise rr.Rechazo(f"No encuentro una sola línea «const {nombre} = '…';» en el sistema (hay {len(hallados)}). "
                         "Si cambió la forma de guardarla, hay que actualizar esta herramienta.")
    return hallados[0]


def ref_produccion(html):
    """Proyecto de producción según el propio sistema (y según restaurar_respaldo.py: deben coincidir)."""
    m = re.fullmatch(r"https://([a-z0-9]{20})\.supabase\.co", _constante(html, "SB_URL"))
    if not m:
        raise rr.Rechazo("El SB_URL del sistema no tiene la forma https://xxxx.supabase.co.")
    return m.group(1)


def validar(url, llave, ref_prod):
    """Devuelve (url_limpia, ref). Lanza Rechazo ante cualquier cosa dudosa."""
    url = (url or "").strip().rstrip("/")
    llave = (llave or "").strip()
    if not url:
        raise rr.Rechazo("Falta la dirección del proyecto de pruebas (--url https://xxxx.supabase.co).")
    if not llave:
        raise rr.Rechazo(f"Falta la llave pública «anon» del proyecto de pruebas (--llave-publica o la variable {VARIABLE_LLAVE_PUBLICA}).")
    m = re.fullmatch(r"https://([a-z0-9]{20})\.supabase\.co", url)
    if not m:
        raise rr.Rechazo(f"La dirección «{url}» no parece un proyecto de Supabase (debe ser https://xxxxxxxxxxxxxxxxxxxx.supabase.co, sin nada después).")
    ref_url = m.group(1)

    clase, _ = rr.clasificar_llave(llave)
    if clase == "servicio":
        raise rr.Rechazo("¡Esa es una llave de SERVICIO (secreta)! NUNCA debe ir en una página web: cualquiera que abra la página tendría "
                         "control total del proyecto. Usa la llave pública «anon» (Supabase → Project Settings → API Keys → pestaña "
                         "«Legacy API Keys» → anon public). No la pegues en ningún lado y cámbiala en Supabase si la compartiste.")
    carga = _decodificar_jwt(llave)
    if carga is None:
        raise rr.Rechazo("Esa llave no es la «anon» clásica (debe empezar por «eyJ…» y tener tres partes separadas por puntos). "
                         "Las llaves nuevas «sb_publishable_…» todavía no sirven con este sistema: busca en Supabase → Project Settings → "
                         "API Keys la pestaña «Legacy API Keys» (anon public).")
    if carga.get("role") != "anon":
        raise rr.Rechazo(f"La llave es de rol «{carga.get('role')}», no «anon». Para la copia de pruebas se usa solo la llave «anon» (pública).")
    if carga.get("ref") != ref_url:
        raise rr.Rechazo(f"La llave es del proyecto «{carga.get('ref')}» pero la dirección es la del proyecto «{ref_url}»: no coinciden.")
    exp = carga.get("exp")
    if isinstance(exp, (int, float)) and exp < time.time():
        raise rr.Rechazo("La llave ya venció. Copia la llave vigente desde Supabase.")
    if ref_url in (ref_prod, rr.REF_PRODUCCION):
        raise rr.Rechazo("Esa es la dirección del proyecto de PRODUCCIÓN. La copia de pruebas debe apuntar a OTRO proyecto de Supabase.")
    return url, ref_url


def transformar(html, url, llave, ref_prod):
    """El sistema → la copia de pruebas. Cada cambio debe aplicarse exactamente una vez."""
    llave_prod = _constante(html, "SB_KEY")
    salida = html

    def una_vez(texto, viejo, nuevo, que):
        if texto.count(viejo) != 1:
            raise rr.Rechazo(f"No encuentro exactamente una vez {que} en el sistema (hay {texto.count(viejo)}). Hay que actualizar esta herramienta.")
        return texto.replace(viejo, nuevo)

    salida = una_vez(salida, f"const SB_URL = '{_constante(html, 'SB_URL')}';", f"const SB_URL = '{url}';", "la línea de SB_URL")
    salida = una_vez(salida, f"const SB_KEY = '{llave_prod}';", f"const SB_KEY = '{llave}';", "la línea de SB_KEY")
    # La política de seguridad de la página solo deja hablar con el Supabase del sistema: en la copia, con el de pruebas.
    salida = una_vez(salida, f'content="connect-src {_constante(html, "SB_URL")};', f'content="connect-src {url};', "la política de seguridad (connect-src)")
    for viejo, nuevo in CLAVES_ALMACEN.items():
        salida = una_vez(salida, f"'{viejo}'", f"'{nuevo}'", f"el nombre de almacenamiento «{viejo}»")
    salida = una_vez(salida, TITULO, TITULO_PRUEBAS + "\n" + META_NOINDEX, "el título de la página")
    salida = una_vez(salida, "<body>", "<body>\n" + CARTEL_ARRIBA + FRANJA_ABAJO, "la etiqueta <body>")

    # Que no quede NADA de producción en la copia.
    for rastro, que in ((ref_prod, "el proyecto de producción"), (rr.REF_PRODUCCION, "el proyecto de producción"),
                        (llave_prod, "la llave de producción")):
        if rastro in salida:
            raise rr.Rechazo(f"La copia todavía menciona {que}. No se escribe nada.")
    for viejo in CLAVES_ALMACEN:
        if f"'{viejo}'" in salida:
            raise rr.Rechazo(f"La copia todavía usa el nombre de almacenamiento de producción «{viejo}». No se escribe nada.")
    return salida


def revertir(html, original):
    """Inversa de transformar (solo para comprobar que NADA más cambió): devuelve el sistema original o None."""
    inv = html
    inv = inv.replace("<body>\n" + CARTEL_ARRIBA + FRANJA_ABAJO, "<body>")
    inv = inv.replace(TITULO_PRUEBAS + "\n" + META_NOINDEX, TITULO)
    for viejo, nuevo in CLAVES_ALMACEN.items():
        inv = inv.replace(f"'{nuevo}'", f"'{viejo}'")
    inv = re.sub(r"^const SB_URL = '[^']*';", lambda m: f"const SB_URL = '{_constante(original, 'SB_URL')}';", inv, flags=re.M)
    inv = re.sub(r"^const SB_KEY = '[^']*';", lambda m: f"const SB_KEY = '{_constante(original, 'SB_KEY')}';", inv, flags=re.M)
    inv = re.sub(r'content="connect-src https://[a-z0-9]{20}\.supabase\.co;', lambda m: f'content="connect-src {_constante(original, "SB_URL")};', inv)
    return inv


# ── Modo «archivo único»: el Menú viaja DENTRO del archivo ─────────────────────────────────────────────────────────
RUTA_MENU = "../Menu/Men%C3%BA%20diario-El%20Lobo.html"          # como lo escribe el sistema (carpeta hermana)
MARCA_MENU_INI = "/*MENU-INICIO*/"
MARCA_MENU_FIN = "/*MENU-FIN*/"
ENLACE_MENU = f'<a href="{RUTA_MENU}" target="_blank" rel="noopener" class="btn btn-outline"'
ENLACE_MENU_UNICO = '<a href="#" onclick="return abrirMenuPruebas()" class="btn btn-outline"'
MARCO_MENU = f'<iframe id="menuFrame" src="{RUTA_MENU}" title='
MARCO_MENU_UNICO = '<iframe id="menuFrame" title='
CARGA_MENU = f"<script>document.getElementById('menuFrame').src='{RUTA_MENU}?v='+Date.now();</script>"
PATRON_BLOQUE_MENU = re.compile(r'<script id="menu-incrustado">.*?</script>', re.S)


def _una_vez(texto, viejo, nuevo, que):
    if texto.count(viejo) != 1:
        raise rr.Rechazo(f"No encuentro exactamente una vez {que} en el sistema (hay {texto.count(viejo)}). Hay que actualizar esta herramienta.")
    return texto.replace(viejo, nuevo)


def _literal_js(texto):
    """El texto como cadena de JavaScript segura DENTRO de un <script> (y también JSON válido, para poder recuperarlo)."""
    s = json.dumps(texto, ensure_ascii=False)
    return (s.replace("</", "<\\/")            # que ningún «</script>» del Menú cierre el bloque
             .replace("<!--", "<\\u0021--")     # ni abra un comentario HTML
             .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def _bloque_menu(menu):
    return ('<script id="menu-incrustado">\n'
            "// PRUEBAS: el Menú viaja dentro de este archivo (suelto no existe la carpeta ../Menu/).\n"
            "(function () {\n"
            f"  var MENU = {MARCA_MENU_INI}{_literal_js(menu)}{MARCA_MENU_FIN};\n"
            "  document.getElementById('menuFrame').srcdoc = MENU;\n"
            "  window.abrirMenuPruebas = function () {\n"
            "    // Una ventana en blanco hereda el origen de este archivo (un «blob:» no: ahí el navegador negaría el localStorage).\n"
            "    var w = window.open('', '_blank');\n"
            "    if (w) { w.document.open(); w.document.write(MENU); w.document.close(); }\n"
            "    return false;\n"
            "  };\n"
            "})();\n"
            "</script>")


def incrustar_menu(copia, menu):
    """La copia de pruebas + el Menú adentro: el marco lo muestra con `srcdoc` y el botón «Abrir en pestaña aparte» lo abre desde memoria."""
    salida = _una_vez(copia, ENLACE_MENU, ENLACE_MENU_UNICO, "el enlace «Abrir en pestaña aparte» del Menú")
    salida = _una_vez(salida, MARCO_MENU, MARCO_MENU_UNICO, "el marco (iframe) del Menú")
    return _una_vez(salida, CARGA_MENU, _bloque_menu(menu), "la línea que carga el Menú")


def desincrustar_menu(unica):
    """Inversa de incrustar_menu (para comprobar que NADA más cambió): devuelve (la copia sin el Menú adentro, el Menú recuperado)."""
    bloques = PATRON_BLOQUE_MENU.findall(unica)
    if len(bloques) != 1:
        raise rr.Rechazo(f"Esperaba un solo bloque del Menú incrustado y hay {len(bloques)}.")
    bloque = bloques[0]
    ini, fin = bloque.find(MARCA_MENU_INI), bloque.find(MARCA_MENU_FIN)
    if ini < 0 or fin < ini:
        raise rr.Rechazo("No encuentro dónde empieza y termina el Menú incrustado.")
    menu = json.loads(bloque[ini + len(MARCA_MENU_INI):fin])
    inv = unica.replace(bloque, CARGA_MENU)
    inv = inv.replace(ENLACE_MENU_UNICO, ENLACE_MENU).replace(MARCO_MENU_UNICO, MARCO_MENU)
    return inv, menu


LEEME = """# El Lobo — copia de PRUEBAS (réplica)

**No es el sistema real.** Es una copia de ensayo que apunta a un proyecto de Supabase aparte (con datos de ensayo).
Sirve para probar cambios sin riesgo para el restaurante.

- Se genera sola desde el sistema real con `herramientas/generar_copia_pruebas.py` del repositorio
  `Luiscadlo/Restaurante-El-Lobo`. **No se edita a mano**: lo que se cambie aquí se pierde la próxima vez.
- Solo difiere del sistema real en: la dirección y la llave pública del proyecto de pruebas, los nombres con que el
  navegador recuerda la sesión, el título y el cartel rojo «PRUEBAS».
- Aquí no hay datos ni llaves secretas: la llave que contiene es la «anon» pública, igual que el sistema real.
"""


def generar(carpeta, url, llave, origen=None):
    """Escribe el sitio de pruebas en `carpeta`. Devuelve la lista de archivos escritos."""
    origen = Path(origen) if origen else RAIZ
    carpeta = Path(carpeta).expanduser().resolve()
    if carpeta == RAIZ or RAIZ in carpeta.parents or carpeta in RAIZ.parents:
        raise rr.Rechazo("La carpeta de salida no puede estar dentro (ni contener) el repositorio del sistema: la copia de pruebas se publica "
                         "desde OTRO repositorio. Elige una carpeta afuera.")
    html = (origen / REL_SISTEMA).read_text(encoding="utf-8")
    ref_prod = ref_produccion(html)
    url, _ = validar(url, llave, ref_prod)
    copia = transformar(html, url, llave.strip(), ref_prod)
    if revertir(copia, html) != html:
        raise rr.Rechazo("La copia cambió algo más que lo previsto. No se escribe nada.")

    escritos = []
    destino = carpeta / REL_SISTEMA
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(copia, encoding="utf-8", newline="")
    escritos.append(destino)
    for rel in (REL_MENU, REL_INDEX):
        fuente = origen / rel
        if not fuente.exists():
            raise rr.Rechazo(f"Falta {rel} en el sistema.")
        d = carpeta / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fuente, d)
        escritos.append(d)
    (carpeta / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (carpeta / "LEEME.md").write_text(LEEME, encoding="utf-8")
    escritos += [carpeta / "robots.txt", carpeta / "LEEME.md"]
    return escritos


def generar_archivo_unico(archivo, url, llave, origen=None):
    """Escribe la copia de pruebas como UN SOLO archivo HTML, con el Menú incrustado. Devuelve la ruta escrita."""
    origen = Path(origen) if origen else RAIZ
    archivo = Path(archivo).expanduser().resolve()
    if archivo.suffix.lower() != ".html":
        raise rr.Rechazo(f"El archivo de salida debe terminar en .html (me dieron «{archivo.name}»).")
    if archivo == RAIZ or RAIZ in archivo.parents:
        raise rr.Rechazo("El archivo de salida no puede quedar dentro del repositorio del sistema: la copia de pruebas no se publica desde ahí. "
                         "Elige una carpeta afuera.")
    html = (origen / REL_SISTEMA).read_text(encoding="utf-8")
    ref_prod = ref_produccion(html)
    url, _ = validar(url, llave, ref_prod)
    copia = transformar(html, url, llave.strip(), ref_prod)
    if revertir(copia, html) != html:
        raise rr.Rechazo("La copia cambió algo más que lo previsto. No se escribe nada.")
    fuente_menu = origen / REL_MENU
    if not fuente_menu.exists():
        raise rr.Rechazo(f"Falta {REL_MENU} en el sistema.")
    menu = fuente_menu.read_bytes().decode("utf-8")      # tal cual (sin cambiar los saltos de línea)
    for rastro, que in ((ref_prod, "el proyecto de producción"), (rr.REF_PRODUCCION, "el proyecto de producción"),
                        (_constante(html, "SB_KEY"), "la llave de producción")):
        if rastro in menu:
            raise rr.Rechazo(f"El Menú menciona {que}: no debería. No se escribe nada.")
    unica = incrustar_menu(copia, menu)
    inv, menu_recuperado = desincrustar_menu(unica)
    if inv != copia or menu_recuperado != menu:
        raise rr.Rechazo("Al incrustar el Menú cambió algo más que lo previsto. No se escribe nada.")
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text(unica, encoding="utf-8", newline="")
    return archivo


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fabrica la copia de pruebas (réplica) del sistema de El Lobo.")
    ap.add_argument("--url", required=True, help="Dirección del proyecto de pruebas: https://xxxx.supabase.co")
    ap.add_argument("--llave-publica", default=os.environ.get(VARIABLE_LLAVE_PUBLICA), help="Llave «anon» pública del proyecto de pruebas")
    salida = ap.add_mutually_exclusive_group(required=True)
    salida.add_argument("-o", "--carpeta", help="Carpeta donde escribir el sitio de pruebas (FUERA de este repositorio)")
    salida.add_argument("--archivo-unico", metavar="ARCHIVO.html",
                        help="En vez de una carpeta, escribe UN solo archivo HTML con el Menú incrustado (FUERA de este repositorio)")
    args = ap.parse_args(argv)
    try:
        if args.archivo_unico:
            escritos = [generar_archivo_unico(args.archivo_unico, args.url, args.llave_publica)]
        else:
            escritos = generar(args.carpeta, args.url, args.llave_publica)
    except rr.Rechazo as e:
        print(f"RECHAZADO: {e}", file=sys.stderr)
        return e.codigo
    print("Copia de pruebas generada:")
    for e in escritos:
        print("  ", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
