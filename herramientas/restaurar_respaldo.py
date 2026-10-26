#!/usr/bin/env python3
"""Restaura un respaldo de El Lobo (el JSON de Datos → Respaldo completo, o los formatos antiguos del botón Exportar y de la tarea semanal) en un proyecto de Supabase.

Está pensado para UN caso: un proyecto NUEVO y VACÍO (el de pruebas, o el de reemplazo si el original se
pierde). Antes de usarlo, ese proyecto debe tener las tablas: corre ahí sql/esquema_completo.sql.
Guía paso a paso: docs/RESTAURAR.md.

Por seguridad:
  · Por defecto NO escribe nada: solo revisa el respaldo y el destino ("simulacro"). Para cargar de verdad
    hay que agregar --ejecutar.
  · La llave (service_role / secret) se lee de una variable de entorno, nunca de la línea de comandos, y no
    se imprime. Rechaza la llave pública (anon / publishable).
  · Se niega a trabajar sobre el proyecto de producción de El Lobo, salvo que se escriba una frase explícita.
  · Se niega si alguna tabla del destino ya tiene datos: no borra ni mezcla nada. (Si hay que vaciar el
    destino de pruebas, se hace a mano en el SQL Editor; el programa imprime el SQL.)
  · Se niega si el respaldo está incompleto o dañado (archivo cortado, conteos que no cuadran, errores
    registrados por la tarea semanal, tablas desconocidas, filas repetidas).
  · Al terminar compara TODAS las filas del destino contra el respaldo, una por una.

Solo usa la biblioteca estándar de Python (urllib).
Códigos de salida: 0 todo bien · 1 la comparación final encontró diferencias · 2 rechazado por seguridad o
configuración (no se escribió nada) · 3 respaldo inválido · 4 falló la conexión o la carga.
"""
import argparse
import base64
import collections
import decimal
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

REF_PRODUCCION = "arxyfcquvsmfoxmbifne"          # el mismo que SB_URL en el sistema (una prueba lo vigila)
FRASE_PRODUCCION = "RESTAURAR-EN-PRODUCCION"
VARIABLE_LLAVE = "LOBO_LLAVE_SERVICIO"
VARIABLE_URL = "LOBO_URL_DESTINO"

# Las tablas que respalda el sistema, con los «padres» antes que los «hijos» (se corrige con --esquema).
TABLAS_CONOCIDAS = [
    "config", "mesas", "clientes_fiado", "inventario", "pedidos", "abonos_fiado", "cierres_dia", "aperturas_turno",
    "notas_dia", "gastos_dia", "consumos", "egresos", "movimientos_caja", "ingresos_extra",
    "pedidos_eliminados", "pedidos_descuentos",
]
LOTE_ESCRITURA = 500
LOTE_LECTURA = 1000
HOSTS_LOCALES = {"127.0.0.1", "localhost", "::1"}


class Rechazo(Exception):
    def __init__(self, mensaje, codigo=2):
        super().__init__(mensaje)
        self.codigo = codigo


# ── Números exactos ───────────────────────────────────────────────────────────
def _cargar_json(texto):
    """Los decimales se leen como Decimal para no perder precisión al volver a escribirlos."""
    return json.loads(texto, parse_float=decimal.Decimal)


def volcar(valor):
    """json.dumps que respeta los Decimal tal como vinieron (1500.00 sigue siendo 1500.00)."""
    if isinstance(valor, decimal.Decimal):
        return str(valor)
    if isinstance(valor, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + volcar(v) for k, v in valor.items()) + "}"
    if isinstance(valor, list):
        return "[" + ",".join(volcar(v) for v in valor) + "]"
    return json.dumps(valor, ensure_ascii=False)


def canonico(valor):
    """Forma comparable (y hashable) de un valor JSON: 1500, 1500.0 y 1500.00 son lo mismo."""
    if valor is None:
        return ("z",)
    if isinstance(valor, bool):
        return ("b", valor)
    if isinstance(valor, (int, decimal.Decimal, float)):
        d = decimal.Decimal(str(valor)) if isinstance(valor, float) else decimal.Decimal(valor)
        return ("n", format(d.normalize(), "f") if d != 0 else "0")
    if isinstance(valor, str):
        return ("s", valor)
    if isinstance(valor, list):
        return ("l",) + tuple(canonico(v) for v in valor)
    if isinstance(valor, dict):
        return ("d",) + tuple((k, canonico(v)) for k, v in sorted(valor.items()))
    return ("?", repr(valor))


# ── El respaldo ───────────────────────────────────────────────────────────────
class Respaldo:
    def __init__(self, tablas, formato, generado_en, avisos):
        self.tablas, self.formato, self.generado_en, self.avisos = tablas, formato, generado_en, avisos

    def total_filas(self):
        return sum(len(f) for f in self.tablas.values())


def leer_respaldo(ruta, tablas_validas=None):
    """Lee y valida el archivo. Acepta el formato actual (Datos → Respaldo completo, v1, el mismo del antiguo botón Exportar) y el de la tarea semanal antigua."""
    tablas_validas = set(tablas_validas or TABLAS_CONOCIDAS)
    try:
        with open(ruta, encoding="utf-8-sig") as f:
            texto = f.read()
    except OSError as e:
        raise Rechazo(f"No pude abrir el respaldo «{ruta}»: {e.strerror}", 3)
    except UnicodeDecodeError:
        raise Rechazo("El respaldo no se puede leer como texto (¿está dañado o no es el JSON del respaldo?).", 3)
    try:
        datos = _cargar_json(texto)
    except ValueError as e:
        raise Rechazo(f"El respaldo no es un JSON válido (¿se descargó a medias o se editó?): {e}", 3)
    if not isinstance(datos, dict) or not isinstance(datos.get("tablas"), dict):
        raise Rechazo("El archivo no parece un respaldo de El Lobo: no trae la sección «tablas».", 3)

    errores = datos.get("errores")
    if errores:
        detalle = json.dumps(errores, ensure_ascii=False, default=str)[:400]
        raise Rechazo(f"El respaldo se hizo INCOMPLETO (la tarea registró errores): {detalle}\nNo se restaura un respaldo incompleto: haz uno nuevo.", 3)

    tablas = datos["tablas"]
    desconocidas = sorted(set(tablas) - tablas_validas)
    if desconocidas:
        raise Rechazo(f"El respaldo trae tablas que no conozco: {', '.join(desconocidas)}. "
                      "Si son tablas nuevas del sistema, pasa --esquema con el resultado de sql/consulta_esquema.sql.", 3)
    for nombre, filas in tablas.items():
        if not isinstance(filas, list) or not all(isinstance(f, dict) for f in filas):
            raise Rechazo(f"La tabla «{nombre}» del respaldo no es una lista de filas.", 3)
        claves = {tuple(sorted(f)) for f in filas}
        if len(claves) > 1:
            raise Rechazo(f"Las filas de «{nombre}» no tienen todas las mismas columnas: el archivo fue modificado o está dañado.", 3)
        ids = [f["id"] for f in filas if "id" in f]
        if len(ids) == len(filas) and len(set(map(repr, ids))) != len(ids):
            raise Rechazo(f"La tabla «{nombre}» tiene id repetidos en el respaldo: está dañado.", 3)

    conteos = datos.get("conteos")
    if isinstance(conteos, dict):
        for nombre, n in conteos.items():
            if nombre not in tablas:
                raise Rechazo(f"El respaldo dice que «{nombre}» tiene {n} filas pero la tabla no está en el archivo.", 3)
            if len(tablas[nombre]) != n:
                raise Rechazo(f"«{nombre}»: el respaldo declara {n} filas y el archivo trae {len(tablas[nombre])}. Está dañado o incompleto.", 3)

    avisos = []
    faltan = [t for t in TABLAS_CONOCIDAS if t not in tablas and t in tablas_validas]
    if faltan:
        avisos.append("Este respaldo NO incluye: " + ", ".join(faltan) + " (esas tablas quedarán vacías).")
    formato = "exportar" if ("version" in datos or "conteos" in datos) else "tarea semanal"
    return Respaldo(tablas, formato, datos.get("generado_en"), avisos)


# ── Orden de carga ────────────────────────────────────────────────────────────
def orden_por_llaves(tablas, restricciones=None):
    """Padres antes que hijos. Sin esquema, se usa la lista fija; con esquema, se calcula con las llaves foráneas."""
    base = sorted(tablas, key=lambda t: (TABLAS_CONOCIDAS.index(t) if t in TABLAS_CONOCIDAS else len(TABLAS_CONOCIDAS), t))
    if not restricciones:
        return base, []
    padres = {t: set() for t in base}
    avisos = []
    for k in restricciones:
        if k.get("tipo") == "f" and k.get("tabla") in padres and k.get("tabla_referida") in padres:
            if k["tabla"] == k["tabla_referida"]:
                avisos.append(f"«{k['tabla']}» apunta a sí misma ({k['nombre']}): si falla la carga, hay que ordenar sus filas.")
            else:
                padres[k["tabla"]].add(k["tabla_referida"])
    orden, listos = [], set()
    pendientes = list(base)
    while pendientes:
        siguiente = next((t for t in pendientes if padres[t] <= listos), None)
        if siguiente is None:
            raise Rechazo("Hay un ciclo de llaves foráneas entre: " + ", ".join(pendientes) + ". No se puede cargar por REST.", 2)
        orden.append(siguiente)
        listos.add(siguiente)
        pendientes.remove(siguiente)
    return orden, avisos


# ── Destino y llave ───────────────────────────────────────────────────────────
def _jwt(llave):
    partes = llave.split(".")
    if len(partes) != 3:
        return None
    try:
        relleno = "=" * (-len(partes[1]) % 4)
        carga = json.loads(base64.urlsafe_b64decode(partes[1] + relleno))
        return carga if isinstance(carga, dict) else None
    except (ValueError, UnicodeDecodeError):
        return None


def clasificar_llave(llave):
    """Devuelve (clase, proyecto): clase ∈ servicio · publica · desconocida."""
    llave = llave.strip()
    if llave.startswith("sb_secret_"):
        return "servicio", None
    if llave.startswith("sb_publishable_"):
        return "publica", None
    carga = _jwt(llave)
    if carga:
        rol = carga.get("role")
        return ("servicio" if rol == "service_role" else "publica" if rol in ("anon", "authenticated") else "desconocida"), carga.get("ref")
    return "desconocida", None


def validar_destino(url, llave, permitir_produccion=None):
    """Devuelve la URL base limpia. Lanza Rechazo ante cualquier cosa dudosa."""
    if not url:
        raise Rechazo(f"Falta la dirección del proyecto de destino (--url o la variable {VARIABLE_URL}).")
    if not llave:
        raise Rechazo(f"Falta la llave de servicio. Ponla en la variable de entorno {VARIABLE_LLAVE} (no en la línea de comandos).")
    p = urllib.parse.urlparse(url.strip())
    host = (p.hostname or "").lower()
    local = host in HOSTS_LOCALES
    if not (p.scheme == "https" and host.endswith(".supabase.co")) and not (local and p.scheme in ("http", "https")):
        raise Rechazo(f"La dirección «{url}» no parece un proyecto de Supabase (debe ser https://xxxx.supabase.co).")
    clase, ref_llave = clasificar_llave(llave)
    if clase == "publica":
        raise Rechazo("Esa es la llave PÚBLICA (anon/publishable). Para restaurar se necesita la llave de servicio (service_role / secret) "
                      "del proyecto de destino, que se copia de Supabase → Project Settings → API Keys.")
    if clase != "servicio":
        raise Rechazo("La llave no parece una llave de servicio de Supabase (service_role o sb_secret_…).")
    ref_url = host.split(".")[0] if not local else None
    if ref_llave and ref_url and ref_llave != ref_url:
        raise Rechazo(f"La llave es del proyecto «{ref_llave}» pero la dirección es del proyecto «{ref_url}»: no coinciden.")
    if REF_PRODUCCION in (ref_url, ref_llave) and permitir_produccion != FRASE_PRODUCCION:
        raise Rechazo("Ese es el proyecto de PRODUCCIÓN de El Lobo. Este programa solo restaura sobre proyectos nuevos o de pruebas.\n"
                      f"Si de verdad es una recuperación de desastre sobre un proyecto vacío, agrega --permitir-produccion {FRASE_PRODUCCION}")
    return f"{p.scheme}://{p.netloc}"


# ── Cliente REST (solo urllib) ─────────────────────────────────────────────────
def col_rest(nombre):
    return nombre if re.fullmatch(r"[a-z_][a-z0-9_]*", nombre) else '"' + nombre.replace('"', '\\"') + '"'


class Cliente:
    def __init__(self, base, llave, solo_lectura=True, tiempo=90):
        self.base, self.llave, self.solo_lectura, self.tiempo = base, llave, solo_lectura, tiempo
        host = (urllib.parse.urlparse(base).hostname or "").lower()
        # Un servidor local no debe pasar por el proxy del entorno.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if host in HOSTS_LOCALES else urllib.request.build_opener()
        self.escrituras = 0

    def redactar(self, texto):
        return str(texto).replace(self.llave, "«llave»") if self.llave else str(texto)

    def pedir(self, metodo, ruta, cuerpo=None, extra=None):
        if metodo != "GET" and self.solo_lectura:
            raise AssertionError("Intento de escribir en modo simulacro")
        cab = {"apikey": self.llave, "Authorization": f"Bearer {self.llave}", "Accept": "application/json",
               "User-Agent": "lobo-restaurar/1"}
        if cuerpo is not None:
            cab["Content-Type"] = "application/json"
        cab.update(extra or {})
        req = urllib.request.Request(self.base + ruta, data=cuerpo, headers=cab, method=metodo)
        if metodo != "GET":
            self.escrituras += 1
        try:
            with self.opener.open(req, timeout=self.tiempo) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), e.read()
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            raise Rechazo(self.redactar(f"No pude conectarme a {self.base}: {getattr(e, 'reason', e)}"), 4)


def _mensaje_servidor(cliente, cuerpo):
    try:
        d = json.loads(cuerpo)
        if isinstance(d, dict):
            return cliente.redactar(" · ".join(str(d[k]) for k in ("code", "message", "details", "hint") if d.get(k)))
    except ValueError:
        pass
    return cliente.redactar(cuerpo.decode("utf-8", "replace")[:300])


def total_de(cabeceras):
    cr = {k.lower(): v for k, v in cabeceras.items()}.get("content-range", "")
    m = re.search(r"/(\d+)$", cr)
    return int(m.group(1)) if m else None


def revisar_tabla(cliente, tabla, columnas):
    """Mira (sin escribir) que la tabla exista, que tenga las columnas del respaldo y cuántas filas trae. Devuelve el total."""
    sel = ",".join(col_rest(c) for c in columnas) if columnas else "*"
    estado, cab, cuerpo = cliente.pedir("GET", f"/rest/v1/{col_rest(tabla)}?select={urllib.parse.quote(sel)}&limit=1", extra={"Prefer": "count=exact"})
    msg = _mensaje_servidor(cliente, cuerpo)
    if estado in (401, 403):
        raise Rechazo(f"El destino rechazó la llave en «{tabla}» ({estado}). ¿Es la llave de servicio del proyecto correcto? {msg}")
    if estado == 404 or "PGRST205" in msg:
        raise Rechazo(f"La tabla «{tabla}» no existe en el destino. Corre antes sql/esquema_completo.sql en ese proyecto "
                      f"(si ya lo hiciste, espera un minuto o ejecuta «notify pgrst, 'reload schema';»). {msg}")
    if estado == 400 or "PGRST204" in msg or "42703" in msg:
        raise Rechazo(f"A la tabla «{tabla}» del destino le faltan columnas que trae el respaldo. Vuelve a generar sql/esquema_completo.sql desde el esquema actual. {msg}")
    if estado not in (200, 206):
        raise Rechazo(f"No pude revisar «{tabla}» en el destino (HTTP {estado}). {msg}", 4)
    total = total_de(cab)
    if total is None:
        total = len(json.loads(cuerpo))
    return total


def cargar_tabla(cliente, tabla, filas, lote, omitir=()):
    """Inserta en tandas. `omitir`: columnas calculadas por la base (generated ... stored), que no se pueden escribir."""
    for i in range(0, len(filas), lote):
        parte = [{k: v for k, v in f.items() if k not in omitir} for f in filas[i:i + lote]] if omitir else filas[i:i + lote]
        cuerpo = ("[" + ",".join(volcar(f) for f in parte) + "]").encode("utf-8")
        estado, _, resp = cliente.pedir("POST", f"/rest/v1/{col_rest(tabla)}", cuerpo, {"Prefer": "return=minimal"})
        if estado not in (200, 201, 204):
            raise Rechazo(f"Falló la carga de «{tabla}» (filas {i + 1}–{i + len(parte)}): HTTP {estado}. {_mensaje_servidor(cliente, resp)}", 4)


def descargar_tabla(cliente, tabla, filas_respaldo, lote):
    """Baja todas las filas del destino, en orden estable."""
    cols = sorted(filas_respaldo[0]) if filas_respaldo else []
    if "id" in cols:
        orden = "id"
    elif "clave" in cols:
        orden = "clave"
    else:
        orden = ",".join(col_rest(c) for c in cols if not isinstance(filas_respaldo[0][c], (dict, list))) or "*"
    sel = urllib.parse.quote(",".join(col_rest(c) for c in cols)) if cols else "*"
    salida, desplazamiento = [], 0
    while True:
        ruta = f"/rest/v1/{col_rest(tabla)}?select={sel}" + (f"&order={urllib.parse.quote(orden)}" if orden != "*" else "") + f"&limit={lote}&offset={desplazamiento}"
        estado, _, cuerpo = cliente.pedir("GET", ruta)
        if estado not in (200, 206):
            raise Rechazo(f"No pude releer «{tabla}» para verificar (HTTP {estado}). {_mensaje_servidor(cliente, cuerpo)}", 4)
        parte = _cargar_json(cuerpo)
        salida += parte
        if len(parte) < lote:
            return salida
        desplazamiento += len(parte)


def comparar(filas_respaldo, filas_destino):
    """Devuelve (faltan, sobran) como listas de ejemplos; vacías si son idénticas (sin importar el orden)."""
    a = collections.Counter(canonico(f) for f in filas_respaldo)
    b = collections.Counter(canonico(f) for f in filas_destino)
    faltan, sobran = a - b, b - a
    muestra = lambda cont, filas: [next(f for f in filas if canonico(f) == k) for k in list(cont)[:3]]  # noqa: E731
    return muestra(faltan, filas_respaldo), muestra(sobran, filas_destino), sum(faltan.values()), sum(sobran.values())


# ── SQL de apoyo ──────────────────────────────────────────────────────────────
def sql_secuencias(respaldo):
    """Tras cargar con id propios, hay que subir los contadores automáticos: si no, el próximo pedido chocaría con uno viejo."""
    lineas = []
    for tabla in sorted(respaldo.tablas):
        filas = respaldo.tablas[tabla]
        if filas and all(isinstance(f.get("id"), int) and not isinstance(f.get("id"), bool) for f in filas):
            t = f"public.{col_rest(tabla)}"
            lineas.append(f"select setval(pg_get_serial_sequence('{t}', 'id'), max(id)) from {t} having max(id) is not null;")
    return "\n".join(lineas)


def sql_vaciar(tablas):
    return "truncate table " + ", ".join(f"public.{col_rest(t)}" for t in tablas) + " restart identity cascade;"


# ── Programa principal ────────────────────────────────────────────────────────
def principal(argv=None, salida=None):
    salida = salida or sys.stdout
    imprimir = lambda *a: print(*a, file=salida)  # noqa: E731
    ap = argparse.ArgumentParser(
        description="Restaura un respaldo de El Lobo en un proyecto de Supabase NUEVO y VACÍO. Sin --ejecutar solo simula.",
        epilog=f"La llave de servicio va en la variable de entorno {VARIABLE_LLAVE}. La dirección, en --url o {VARIABLE_URL}.")
    ap.add_argument("respaldo", help="Archivo JSON del respaldo (el de Datos → Respaldo completo; también se aceptan los formatos antiguos)")
    ap.add_argument("--url", default=os.environ.get(VARIABLE_URL), help="Dirección del proyecto de destino: https://xxxx.supabase.co")
    ap.add_argument("--ejecutar", action="store_true", help="Cargar de verdad. Sin esto, solo se revisa (simulacro).")
    ap.add_argument("--esquema", help="Resultado de sql/consulta_esquema.sql (opcional: calcula el orden con las llaves foráneas)")
    ap.add_argument("--permitir-produccion", metavar="FRASE", help="Solo para recuperación de desastre (ver el mensaje de rechazo)")
    ap.add_argument("--lote", type=int, default=LOTE_ESCRITURA, help=f"Filas por envío (por defecto {LOTE_ESCRITURA})")
    args = ap.parse_args(argv)
    cliente = None
    try:
        restricciones, tablas_validas, generadas = None, None, {}
        orden = []
        if args.esquema:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import esquema_a_sql
            try:
                esquema = esquema_a_sql.cargar_esquema(open(args.esquema, encoding="utf-8").read())
            except (OSError, esquema_a_sql.EsquemaInvalido) as e:
                raise Rechazo(f"No pude usar el esquema «{args.esquema}»: {e}", 2)
            restricciones = esquema["restricciones"]
            tablas_validas = set(TABLAS_CONOCIDAS) | {t["nombre"] for t in esquema["tablas"] if t["tipo"] == "r"}
            for c in esquema["columnas"]:
                if c.get("generada"):
                    generadas.setdefault(c["tabla"], set()).add(c["nombre"])
        respaldo = leer_respaldo(args.respaldo, tablas_validas)
        orden, avisos_orden = orden_por_llaves(list(respaldo.tablas), restricciones)

        imprimir(f"Respaldo: formato «{respaldo.formato}», generado {respaldo.generado_en or 'sin fecha'}, "
                 f"{len(respaldo.tablas)} tablas, {respaldo.total_filas()} filas.")
        for t in orden:
            imprimir(f"  {t:<22} {len(respaldo.tablas[t]):>7} filas")
        for a in respaldo.avisos + avisos_orden:
            imprimir(f"AVISO: {a}")

        if not args.url:
            imprimir("\nSIMULACRO sin conexión: solo revisé el archivo, y está bien. Para revisar también el destino, agrega --url.")
            return 0
        llave = os.environ.get(VARIABLE_LLAVE, "").strip()
        base = validar_destino(args.url, llave, args.permitir_produccion)
        cliente = Cliente(base, llave, solo_lectura=not args.ejecutar)

        imprimir(f"\nRevisando el destino ({base}) sin escribir nada…")
        con_datos = []
        for t in orden:
            filas = respaldo.tablas[t]
            total = revisar_tabla(cliente, t, sorted(filas[0]) if filas else [])
            if total:
                con_datos.append((t, total))
        if con_datos:
            raise Rechazo("El destino NO está vacío: " + ", ".join(f"{t} ({n})" for t, n in con_datos) + ".\n"
                          "No mezclo ni borro datos. Usa un proyecto nuevo o, si es un proyecto de PRUEBAS, vacíalo en su SQL Editor con:\n  "
                          + sql_vaciar(orden))
        imprimir("  El destino tiene todas las tablas, con las columnas necesarias, y está vacío.")

        if not args.ejecutar:
            imprimir("\nSIMULACRO terminado: todo en orden para restaurar. No se escribió nada.\n"
                     "Para cargar de verdad, repite el mismo comando agregando --ejecutar.")
            return 0

        imprimir("\nCargando…")
        for t in orden:
            if respaldo.tablas[t]:
                cargar_tabla(cliente, t, respaldo.tablas[t], max(1, args.lote), generadas.get(t, ()))
            imprimir(f"  {t:<22} {len(respaldo.tablas[t]):>7} filas cargadas")

        imprimir("\nVerificando fila por fila contra el respaldo…")
        malas = 0
        for t in orden:
            filas = respaldo.tablas[t]
            total = revisar_tabla(cliente, t, sorted(filas[0]) if filas else [])
            destino = descargar_tabla(cliente, t, filas, LOTE_LECTURA) if filas or total else []
            faltan, sobran, nf, ns = comparar(filas, destino)
            if total != len(filas) or nf or ns:
                malas += 1
                imprimir(f"  {t:<22} DIFERENCIA: respaldo {len(filas)} · destino {total} · faltan {nf} · sobran {ns}")
                for ejemplo in faltan:
                    imprimir("      falta / distinta: " + cliente.redactar(volcar(ejemplo))[:300])
                for ejemplo in sobran:
                    imprimir("      sobra / distinta: " + cliente.redactar(volcar(ejemplo))[:300])
            else:
                imprimir(f"  {t:<22} OK ({len(filas)} filas idénticas)")
        if malas:
            imprimir(f"\nLA VERIFICACIÓN FALLÓ en {malas} tabla(s). No uses ese proyecto. Vacíalo (SQL de arriba) y repite, o avisa a Claude con esta salida.")
            return 1

        imprimir("\nVerificación completa: todo quedó idéntico al respaldo.")
        secuencias = sql_secuencias(respaldo)
        if secuencias:
            imprimir("\nÚLTIMO PASO (en el SQL Editor del destino): sube los contadores automáticos para que los pedidos nuevos no choquen con los restaurados:\n\n" + secuencias)
        imprimir("\nSiguiente: corre sql/rls_seguridad.sql en el destino (reglas de acceso) y crea los usuarios (docs/DESPLIEGUE_SEGURIDAD.md).")
        return 0
    except Rechazo as e:
        mensaje = cliente.redactar(e) if cliente else str(e)
        imprimir(f"\nNO SE HIZO NADA: {mensaje}" if not (cliente and cliente.escrituras) else f"\nSE DETUVO: {mensaje}")
        if cliente and cliente.escrituras:
            imprimir("Puede que el destino haya quedado con datos a medias: no lo uses. Si es un proyecto de PRUEBAS, vacíalo en su SQL Editor y repite:\n  "
                     + sql_vaciar(orden))
        return e.codigo


if __name__ == "__main__":
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(principal())
