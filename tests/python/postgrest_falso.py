"""Un Supabase falso (la parte REST) para probar herramientas/restaurar_respaldo.py sin tocar nada real.

Imita lo justo de PostgREST: lee con select / order / limit / offset y el encabezado Content-Range, inserta
listas de filas, valida columnas, llaves únicas y llaves foráneas, exige la llave en los encabezados y
responde con los mismos códigos de error que el de verdad (404 PGRST205, 400 42703 / PGRST204, 409 23505 / 23503,
401). Además permite inyectar fallas para probar cómo reacciona el programa.
"""
import decimal
import http.server
import json
import threading
import urllib.parse


def _volcar(v):
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k) + ":" + _volcar(x) for k, x in v.items()) + "}"
    if isinstance(v, list):
        return "[" + ",".join(_volcar(x) for x in v) + "]"
    return json.dumps(v)


class Tabla:
    def __init__(self, columnas, pk="id", llaves=None, generadas=()):
        self.columnas, self.pk, self.llaves, self.generadas = list(columnas), pk, llaves or [], set(generadas)
        self.filas = []


class ServidorFalso:
    def __init__(self, llave, tablas):
        self.llave, self.tablas = llave, tablas
        self.peticiones = []          # (método, ruta, encabezados, cuerpo)
        self.posts = 0
        self.fallar_en_post = None    # n.º de POST (1, 2, …) que responde 500
        self.eco_llave_en_error = False
        self.despues_de_cargar = None  # función(servidor) que altera lo guardado, para simular corrupción
        servidor = self

        class Manejador(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _responder(self, estado, cuerpo=b"", cabeceras=None):
                self.send_response(estado)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(cuerpo)))
                for k, v in (cabeceras or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(cuerpo)

            def _error(self, estado, codigo, mensaje, extra=""):
                if servidor.eco_llave_en_error:
                    mensaje += f" (clave recibida: {servidor.llave})"
                self._responder(estado, json.dumps({"code": codigo, "message": mensaje, "details": extra or None, "hint": None}).encode())

            def _autorizado(self):
                ok = self.headers.get("apikey") == servidor.llave and self.headers.get("Authorization") == f"Bearer {servidor.llave}"
                if not ok:
                    self._error(401, "PGRST301", "JWT inválido")
                return ok

            def _tabla(self, ruta):
                partes = urllib.parse.urlparse(ruta)
                nombre = urllib.parse.unquote(partes.path.removeprefix("/rest/v1/")).strip('"')
                return nombre, urllib.parse.parse_qs(partes.query, keep_blank_values=True)

            def do_GET(self):
                servidor.peticiones.append(("GET", self.path, dict(self.headers), b""))
                if not self._autorizado():
                    return
                nombre, q = self._tabla(self.path)
                t = servidor.tablas.get(nombre)
                if t is None:
                    return self._error(404, "PGRST205", f"Could not find the table 'public.{nombre}' in the schema cache")
                seleccion = q.get("select", ["*"])[0]
                columnas = t.columnas if seleccion == "*" else [c.strip().strip('"') for c in seleccion.split(",")]
                for c in columnas:
                    if c not in t.columnas:
                        return self._error(400, "42703", f"column {nombre}.{c} does not exist")
                filas = list(t.filas)
                if q.get("order", [""])[0]:
                    def clave(f, c):
                        v = f.get(c)
                        return (v is None, v if isinstance(v, (int, decimal.Decimal, str)) else json.dumps(v, default=str))
                    for c in reversed([x.split(".")[0].strip('"') for x in q["order"][0].split(",")]):
                        filas.sort(key=lambda f, c=c: clave(f, c))
                total = len(filas)
                desplazamiento = int(q.get("offset", ["0"])[0])
                limite = int(q["limit"][0]) if "limit" in q else None
                pagina = filas[desplazamiento:desplazamiento + limite] if limite is not None else filas[desplazamiento:]
                cuerpo = ("[" + ",".join(_volcar({c: f.get(c) for c in columnas}) for f in pagina) + "]").encode()
                rango = f"{desplazamiento}-{desplazamiento + len(pagina) - 1}/{total}" if pagina else f"*/{total}"
                completo = len(pagina) == total
                self._responder(200 if completo else 206, cuerpo, {"Content-Range": rango})

            def do_POST(self):
                largo = int(self.headers.get("Content-Length", "0"))
                cuerpo = self.rfile.read(largo)
                servidor.peticiones.append(("POST", self.path, dict(self.headers), cuerpo))
                if not self._autorizado():
                    return
                servidor.posts += 1
                if servidor.fallar_en_post == servidor.posts:
                    return self._error(500, "XX000", "Error interno simulado")
                nombre, _ = self._tabla(self.path)
                t = servidor.tablas.get(nombre)
                if t is None:
                    return self._error(404, "PGRST205", f"Could not find the table 'public.{nombre}' in the schema cache")
                filas = json.loads(cuerpo, parse_float=decimal.Decimal)
                existentes = {repr(f.get(t.pk)) for f in t.filas}
                nuevas = []
                for f in filas:
                    for c in f:
                        if c not in t.columnas:
                            return self._error(400, "PGRST204", f"Could not find the '{c}' column of '{nombre}' in the schema cache")
                        if c in t.generadas:
                            return self._error(400, "428C9", f"cannot insert a non-DEFAULT value into column \"{c}\"")
                    if repr(f.get(t.pk)) in existentes:
                        return self._error(409, "23505", f'duplicate key value violates unique constraint "{nombre}_pkey"')
                    existentes.add(repr(f.get(t.pk)))
                    for col, ref_tabla, ref_col in t.llaves:
                        if f.get(col) is not None and not any(r.get(ref_col) == f[col] for r in servidor.tablas[ref_tabla].filas):
                            return self._error(409, "23503", f'insert or update on table "{nombre}" violates foreign key constraint',
                                               f"Key ({col})=({f[col]}) is not present in table \"{ref_tabla}\".")
                    nuevas.append(f)
                t.filas += nuevas
                if servidor.despues_de_cargar:
                    servidor.despues_de_cargar(servidor)
                self._responder(201)

        self.http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
        self.url = f"http://127.0.0.1:{self.http.server_port}"
        self.hilo = threading.Thread(target=self.http.serve_forever, daemon=True)

    def __enter__(self):
        self.hilo.start()
        return self

    def __exit__(self, *a):
        self.http.shutdown()
        self.http.server_close()

    @property
    def metodos(self):
        return [m for m, *_ in self.peticiones]

    def filas(self, tabla):
        return self.tablas[tabla].filas
