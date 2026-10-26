#!/usr/bin/env python3
"""Convierte el resultado de sql/consulta_esquema.sql en un SQL que reconstruye la base (sin datos).

Para qué sirve
  Hoy la estructura de la base de El Lobo (tablas, columnas, tipos, llaves, índices…) solo existe dentro de
  Supabase: si ese proyecto se pierde, no hay forma de armar otro igual. Con esto queda escrita en el
  repositorio como `sql/esquema_completo.sql`, y se puede crear un proyecto nuevo y vacío (para restaurar un
  respaldo, para probar, o para el producto del futuro).

Cómo se usa
  1. En Supabase → SQL Editor, corre sql/consulta_esquema.sql y copia la única celda del resultado.
  2. Guárdala en un archivo FUERA del repositorio (por ejemplo esquema.json).
  3. python herramientas/esquema_a_sql.py esquema.json -o sql/esquema_completo.sql

  Acepta la celda tal cual (JSON), el JSON entre comillas, la lista que entrega "Copy as JSON" o el CSV que
  descarga el editor de Supabase. Los avisos (cosas que revisar) salen por pantalla y quedan también
  escritos al inicio del SQL.

Qué hace y qué NO hace
  · Crea tipos, secuencias, tablas, restricciones, índices, funciones, vistas, disparadores, comentarios.
  · Deja TODAS las tablas con RLS activo y sin reglas (cerradas). Las reglas reales las pone
    sql/rls_seguridad.sql; las reglas viejas del origen NO se copian (podían estar abiertas a todo el mundo).
  · No lleva datos (para eso está herramientas/restaurar_respaldo.py).
  · El SQL resultante es seguro de correr dos veces (if not exists / create or replace).
  · Una columna "identity ALWAYS" se crea como "BY DEFAULT" para poder restaurar con los mismos id.

Solo usa la biblioteca estándar de Python.
"""
import argparse
import csv
import io
import json
import re
import sys

PALABRAS_RESERVADAS = set("""
all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create
current_catalog current_date current_role current_time current_timestamp current_user default deferrable desc
distinct do else end except false fetch for foreign from grant group having in initially intersect into lateral
leading limit localtime localtimestamp not null offset on only or order placing primary references returning
select session_user some symmetric table then to trailing true union unique user using variadic when where
window with
""".split())

# Extensiones que un proyecto nuevo de Supabase ya trae: no hace falta pedirlas.
EXTENSIONES_DE_SERIE = {"plpgsql", "pgcrypto", "uuid-ossp", "pg_stat_statements", "pg_graphql",
                        "supabase_vault", "pgjwt", "pgsodium"}

ORDEN_RESTRICCIONES = {"p": 0, "u": 1, "x": 2, "c": 3, "f": 4}
TIPOS_ENTEROS = {"smallint": "smallserial", "integer": "serial", "bigint": "bigserial"}


class EsquemaInvalido(Exception):
    pass


# ── Lectura tolerante del resultado de la consulta ───────────────────────────
def _como_esquema(valor, nivel=0):
    """Devuelve el dict del esquema si `valor` lo es (o lo contiene), o None."""
    if nivel > 4:
        return None
    if isinstance(valor, str):
        try:
            return _como_esquema(json.loads(valor), nivel + 1)
        except ValueError:
            return None
    if isinstance(valor, list):
        for elemento in valor:
            r = _como_esquema(elemento, nivel + 1)
            if r:
                return r
        return None
    if isinstance(valor, dict):
        if "tablas" in valor and "columnas" in valor:
            return valor
        if "esquema" in valor:
            return _como_esquema(valor["esquema"], nivel + 1)
    return None


def cargar_esquema(texto):
    texto = texto.lstrip("﻿").strip()
    if not texto:
        raise EsquemaInvalido("El archivo está vacío.")
    esquema = None
    try:
        esquema = _como_esquema(json.loads(texto))
    except ValueError:
        pass
    if esquema is None:
        # CSV descargado desde el editor de Supabase: encabezado "esquema" y una celda con el JSON.
        try:
            filas = list(csv.reader(io.StringIO(texto)))
            if len(filas) >= 2 and "esquema" in [c.strip().lower() for c in filas[0]]:
                esquema = _como_esquema(filas[1][[c.strip().lower() for c in filas[0]].index("esquema")])
        except (csv.Error, IndexError):
            pass
    if esquema is None:
        raise EsquemaInvalido(
            "No reconozco el contenido. Debe ser el resultado de sql/consulta_esquema.sql (una celda llamada "
            "«esquema» con un JSON que tiene «tablas» y «columnas»). Vuelve a copiarlo completo.")
    for clave in ("tablas", "columnas", "restricciones"):
        if not isinstance(esquema.get(clave), list):
            raise EsquemaInvalido(f"Al resultado le falta «{clave}»: parece que se copió incompleto.")
    if not esquema["tablas"]:
        raise EsquemaInvalido("El esquema no trae ninguna tabla: ¿se corrió la consulta en el proyecto correcto?")
    return esquema


# ── Utilidades de SQL ─────────────────────────────────────────────────────────
def qi(nombre):
    """Cita un identificador solo si hace falta."""
    if re.fullmatch(r"[a-z_][a-z0-9_]*", nombre) and nombre not in PALABRAS_RESERVADAS:
        return nombre
    return '"' + nombre.replace('"', '""') + '"'


def lit(texto):
    return "'" + str(texto).replace("'", "''") + "'"


def tabla_q(nombre):
    return f"public.{qi(nombre)}"


def _sin_punto_y_coma(sql):
    return sql.strip().rstrip(";").rstrip()


def _bloque_existe(condicion_existe, sentencia):
    """Ejecuta `sentencia` solo si no existe lo que describe `condicion_existe` (hace el SQL repetible)."""
    return f"do $$ begin\n  if not exists ({condicion_existe}) then\n    {sentencia};\n  end if;\nend $$;"


# ── Generación ─────────────────────────────────────────────────────────────────
def generar(esquema):
    avisos = []
    tablas = {t["nombre"]: t for t in esquema["tablas"]}
    reales = {n: t for n, t in tablas.items() if t["tipo"] == "r"}
    vistas = [t for t in esquema["tablas"] if t["tipo"] == "v"]
    for t in esquema["tablas"]:
        if t["tipo"] == "p":
            avisos.append(f"La tabla «{t['nombre']}» es particionada: no se copia (se debe armar a mano).")
        elif t["tipo"] == "m":
            avisos.append(f"«{t['nombre']}» es una vista materializada: no se copia (se debe armar a mano).")

    cols = {}
    for c in esquema["columnas"]:
        cols.setdefault(c["tabla"], []).append(c)
    for lista in cols.values():
        lista.sort(key=lambda c: c["posicion"])

    secuencias = esquema.get("secuencias") or []
    por_columna = {(s["tabla"], s["columna"]): s for s in secuencias if s.get("tabla") and s.get("vinculo")}
    sueltas, ajenas = [], []   # sueltas: sin dueño · ajenas: de una columna serial con otro nombre

    partes = []

    # 0 · Extensiones
    ext = [e for e in (esquema.get("extensiones") or []) if e["nombre"] not in EXTENSIONES_DE_SERIE]
    if ext:
        partes.append("-- 0 · Extensiones (confirma en Supabase → Database → Extensions si alguna no se puede crear aquí)")
        for e in ext:
            partes.append(f"create extension if not exists {qi(e['nombre'])} with schema extensions;")
        partes.append("")

    # 1 · Tipos
    tipos = []
    for e in esquema.get("tipos_enum") or []:
        valores = ", ".join(lit(v) for v in e["valores"])
        tipos.append(_bloque_existe(
            f"select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace "
            f"where n.nspname = 'public' and t.typname = {lit(e['nombre'])}",
            f"create type public.{qi(e['nombre'])} as enum ({valores})"))
    for d in esquema.get("dominios") or []:
        definicion = f"create domain public.{qi(d['nombre'])} as {d['tipo_base']}"
        if d.get("por_defecto") is not None:
            definicion += f" default {d['por_defecto']}"
        if d.get("obligatorio"):
            definicion += " not null"
        for k in d.get("restricciones") or []:
            definicion += f" constraint {qi(k['nombre'])} {k['definicion']}"
        tipos.append(_bloque_existe(
            f"select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace "
            f"where n.nspname = 'public' and t.typname = {lit(d['nombre'])}", definicion))
    if tipos:
        partes += ["-- 1 · Tipos propios (listas de opciones y dominios)"] + tipos + [""]

    # 2 · Tablas (primero se deciden las secuencias para saber cuáles hay que crear aparte)
    defs_tablas = []
    for nombre in sorted(reales):
        lineas = []
        for c in cols.get(nombre, []):
            tipo, extra = c["tipo"], ""
            por_defecto = c.get("por_defecto")
            implicito_no_nulo = False
            if c.get("generada") == "s":
                extra = f" generated always as ({por_defecto}) stored"
            elif c.get("identidad"):
                implicito_no_nulo = True
                s = por_columna.get((nombre, c["nombre"]))
                opciones = ""
                if s and (str(s.get("inicio")) != "1" or str(s.get("incremento")) != "1"):
                    opciones = f" (start with {s['inicio']} increment by {s['incremento']})"
                if c["identidad"] == "a":
                    avisos.append(f"{nombre}.{c['nombre']} era «identity ALWAYS»: se crea «BY DEFAULT» para poder restaurar con los mismos id.")
                extra = f" generated by default as identity{opciones}"
            elif por_defecto and (m := re.fullmatch(r"nextval\('(?:public\.)?\"?([^'\"]+)\"?'::regclass\)", por_defecto)):
                seq = m.group(1)
                s = por_columna.get((nombre, c["nombre"]))
                if s and s["nombre"] == seq == f"{nombre}_{c['nombre']}_seq" and tipo in TIPOS_ENTEROS:
                    tipo = TIPOS_ENTEROS[tipo]
                    implicito_no_nulo = True
                else:
                    extra = f" default {por_defecto}"
                    (ajenas if s and s["nombre"] == seq else sueltas).append((seq, nombre, c["nombre"]))
            elif por_defecto is not None:
                extra = f" default {por_defecto}"
            if c.get("obligatoria") and not implicito_no_nulo:
                extra += " not null"
            lineas.append(f"  {qi(c['nombre'])} {tipo}{extra}")
        if not lineas:
            avisos.append(f"La tabla «{nombre}» no trae columnas en el resultado.")
            continue
        defs_tablas.append(f"create table if not exists {tabla_q(nombre)} (\n" + ",\n".join(lineas) + "\n);")

    # Secuencias que no son un serial normal (sueltas, o de una columna con otro nombre)
    nombres_seq_usadas = {seq for seq, _, _ in sueltas + ajenas}
    seq_sql = []
    for s in secuencias:
        if s["nombre"] in nombres_seq_usadas or (not s.get("vinculo") and not s.get("tabla")):
            opciones = f"as {s['tipo']} start with {s['inicio']} increment by {s['incremento']} minvalue {s['minimo']} maxvalue {s['maximo']}"
            seq_sql.append(f"create sequence if not exists public.{qi(s['nombre'])} {opciones};")
            if not s.get("vinculo") and s["nombre"] not in nombres_seq_usadas:
                avisos.append(f"La secuencia «{s['nombre']}» no pertenece a ninguna columna: se copia suelta.")
    if seq_sql:
        partes += ["-- 2 · Secuencias sueltas"] + seq_sql + [""]
    partes += ["-- 3 · Tablas"] + defs_tablas + [""]
    if ajenas:
        partes += ["-- Secuencias de columnas serial con nombre distinto al habitual"]
        partes += [f"alter sequence public.{qi(seq)} owned by {tabla_q(t)}.{qi(c)};" for seq, t, c in ajenas] + [""]

    # 4 · Restricciones
    restr = [k for k in esquema["restricciones"] if k["tabla"] in reales and k["tipo"] in ORDEN_RESTRICCIONES]
    for k in esquema["restricciones"]:
        if k["tipo"] not in ORDEN_RESTRICCIONES and k["tipo"] not in ("n", "t"):
            avisos.append(f"Restricción «{k['nombre']}» de tipo «{k['tipo']}» no se copia.")
    restr.sort(key=lambda k: (ORDEN_RESTRICCIONES[k["tipo"]], k["tabla"], k["nombre"]))
    sql_restr = [_bloque_existe(
        f"select 1 from pg_constraint where conname = {lit(k['nombre'])} and conrelid = {lit(tabla_q(k['tabla']))}::regclass",
        f"alter table {tabla_q(k['tabla'])} add constraint {qi(k['nombre'])} {k['definicion']}") for k in restr]
    if sql_restr:
        partes += ["-- 4 · Llaves, únicas, checks y llaves foráneas"] + sql_restr + [""]

    # 5 · Índices (los que respaldan una llave o única ya salieron arriba)
    respaldan = {k["nombre"] for k in esquema["restricciones"] if k["tipo"] in ("p", "u", "x")}
    sql_idx = []
    for i in esquema.get("indices") or []:
        if i["nombre"] in respaldan or i["tabla"] not in reales:
            continue
        definicion = re.sub(r"^CREATE (UNIQUE )?INDEX ", lambda m: f"CREATE {m.group(1) or ''}INDEX IF NOT EXISTS ", i["definicion"], count=1)
        sql_idx.append(_sin_punto_y_coma(definicion) + ";")
    if sql_idx:
        partes += ["-- 5 · Índices"] + sql_idx + [""]

    # 6 · Funciones
    sql_fun = []
    for f in esquema.get("funciones") or []:
        sql_fun.append(_sin_punto_y_coma(f["definicion"]) + ";")
        if f.get("security_definer"):
            avisos.append(f"La función «{f['nombre']}» es SECURITY DEFINER (corre con permisos de su dueño): revisa quién puede ejecutarla.")
    if sql_fun:
        partes += ["-- 6 · Funciones"] + sql_fun + [""]

    # 7 · Vistas
    sql_vistas = []
    for v in vistas:
        opciones = ", ".join(v.get("opciones") or [])
        con = f" with ({opciones})" if opciones else ""
        sql_vistas.append(f"create or replace view {tabla_q(v['nombre'])}{con} as\n{_sin_punto_y_coma(v['definicion_vista'])};")
    if sql_vistas:
        partes += ["-- 7 · Vistas"] + sql_vistas + [""]

    # 8 · Disparadores
    sql_trg = []
    for d in esquema.get("disparadores") or []:
        sql_trg.append(f"drop trigger if exists {qi(d['nombre'])} on {tabla_q(d['tabla'])};")
        sql_trg.append(_sin_punto_y_coma(d["definicion"]) + ";")
    if sql_trg:
        partes += ["-- 8 · Disparadores"] + sql_trg + [""]

    # 9 · Comentarios
    sql_com = []
    for t in esquema["tablas"]:
        if t.get("comentario") and t["tipo"] in ("r", "v"):
            sql_com.append(f"comment on {'view' if t['tipo'] == 'v' else 'table'} {tabla_q(t['nombre'])} is {lit(t['comentario'])};")
    for c in esquema["columnas"]:
        if c.get("comentario") and c["tabla"] in reales:
            sql_com.append(f"comment on column {tabla_q(c['tabla'])}.{qi(c['nombre'])} is {lit(c['comentario'])};")
    if sql_com:
        partes += ["-- 9 · Comentarios"] + sql_com + [""]

    # 10 · Seguridad: todo cerrado hasta que se corra sql/rls_seguridad.sql
    partes += ["-- 10 · Seguridad: RLS activo y SIN reglas = cerrado para todos (menos service_role).",
               "--      Las reglas reales las pone sql/rls_seguridad.sql (correrlo después de esto)."]
    partes += [f"alter table {tabla_q(n)} enable row level security;" for n in sorted(reales)]
    partes.append("")
    politicas = esquema.get("politicas") or []
    if politicas:
        nombres = sorted({p["nombre"] for p in politicas})
        avisos.append(f"Las reglas de acceso (policies) del origen NO se copiaron ({len(politicas)}: {', '.join(nombres[:6])}{'…' if len(nombres) > 6 else ''}); las pone sql/rls_seguridad.sql.")

    # 11 · Publicaciones (Realtime)
    pubs = esquema.get("publicaciones") or []
    if pubs:
        partes.append("-- 11 · Tablas publicadas en tiempo real (Realtime)")
        for p in pubs:
            if p["tabla"] not in reales:
                continue
            partes.append(
                "do $$ begin\n"
                f"  if exists (select 1 from pg_publication where pubname = {lit(p['publicacion'])})\n"
                f"     and not exists (select 1 from pg_publication_tables where pubname = {lit(p['publicacion'])} and schemaname = 'public' and tablename = {lit(p['tabla'])}) then\n"
                f"    alter publication {qi(p['publicacion'])} add table {tabla_q(p['tabla'])};\n"
                "  end if;\nend $$;")
        partes.append("")

    # 12 · Verificación
    partes += [
        "-- 12 · Verificación: cada «real» debe ser igual a «esperado».",
        "select",
        f"  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') as tablas_real, {len(reales)} as tablas_esperado,",
        f"  (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped) as columnas_real, {sum(len(cols.get(n, [])) for n in reales)} as columnas_esperado,",
        f"  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tablas_sin_rls_real, 0 as tablas_sin_rls_esperado;",
    ]

    resumen = (f"tablas: {len(reales)} · columnas: {sum(len(cols.get(n, [])) for n in reales)} · restricciones: {len(restr)} · "
               f"índices: {len(sql_idx)} · funciones: {len(sql_fun)} · vistas: {len(vistas)} · disparadores: {len(sql_trg) // 2}")
    origen = (esquema.get("postgres") or "").split(",")[0]
    cabecera = [
        "-- ═══════════════════════════════════════════════════════════════════════════",
        "-- El Lobo — ESQUEMA COMPLETO (estructura de la base, SIN datos)",
        "-- ═══════════════════════════════════════════════════════════════════════════",
        "-- Generado por herramientas/esquema_a_sql.py a partir de sql/consulta_esquema.sql.",
        f"-- Origen: {origen or 'desconocido'} · consulta corrida el {esquema.get('generado_en', '?')}",
        f"-- Contenido: {resumen}.",
        "--",
        "-- Para qué: crear la base de El Lobo en un proyecto de Supabase NUEVO Y VACÍO (restaurar un respaldo,",
        "--   hacer pruebas). NO lo corras en el proyecto de producción: ya tiene todo esto.",
        "-- Cómo: Supabase → SQL Editor → pegar todo → Run. Es seguro correrlo dos veces.",
        "-- Después: 1) sql/rls_seguridad.sql (reglas de acceso) · 2) herramientas/restaurar_respaldo.py (datos).",
        "-- No lo edites a mano: se vuelve a generar (ver docs/RESTAURAR.md).",
    ]
    if avisos:
        cabecera += ["--", "-- AVISOS (cosas que conviene revisar):"] + [f"--   · {a}" for a in dict.fromkeys(avisos)]
    cabecera += ["", "set check_function_bodies = off;", "set search_path = public, extensions;", ""]
    return "\n".join(cabecera + partes) + "\n", list(dict.fromkeys(avisos)), resumen


def principal(argv=None):
    ap = argparse.ArgumentParser(description="Convierte el resultado de sql/consulta_esquema.sql en sql/esquema_completo.sql")
    ap.add_argument("entrada", help="Archivo con la celda «esquema» (o - para leer de la entrada estándar)")
    ap.add_argument("-o", "--salida", help="Archivo SQL de salida (por defecto, la pantalla)")
    args = ap.parse_args(argv)
    try:
        texto = sys.stdin.read() if args.entrada == "-" else open(args.entrada, encoding="utf-8").read()
    except OSError as e:
        print(f"No pude leer «{args.entrada}»: {e.strerror}", file=sys.stderr)
        return 2
    try:
        sql, avisos, resumen = generar(cargar_esquema(texto))
    except EsquemaInvalido as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    if args.salida:
        with open(args.salida, "w", encoding="utf-8", newline="\n") as f:
            f.write(sql)
        print(f"Listo: {args.salida} ({resumen}).", file=sys.stderr)
    else:
        sys.stdout.write(sql)
    for a in avisos:
        print(f"Aviso: {a}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(principal())
