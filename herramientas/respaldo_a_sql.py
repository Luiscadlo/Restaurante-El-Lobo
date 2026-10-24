#!/usr/bin/env python3
"""Convierte un respaldo de El Lobo (JSON) en archivos SQL para pegar en el SQL Editor de Supabase. SIN llaves.

Para qué sirve
  Es la segunda forma de restaurar (la primera es herramientas/restaurar_respaldo.py, que habla con Supabase
  por internet y necesita la llave de servicio). Esta no necesita ninguna llave ni internet: genera uno o más
  archivos .sql que se pegan, en orden, en Supabase → SQL Editor → Run. Sirve cuando solo se puede usar el
  panel de Supabase.

Qué hace cada archivo
  · Es una sola transacción: o entra todo el archivo, o no entra nada.
  · El primero revisa que el destino esté VACÍO y se detiene con un error si alguna tabla ya tiene datos.
  · Inserta las filas con sus mismos id, tabla por tabla, padres antes que hijos.
  · El último sube los contadores automáticos y muestra una tabla de comprobación (filas esperadas vs reales).

Antes: el destino debe tener las tablas (sql/esquema_completo.sql). Los archivos con datos reales NO se
suben al repositorio (el .gitignore los bloquea: ElLobo_restaurar_*.sql).

Uso
  python herramientas/respaldo_a_sql.py ElLobo_respaldo_completo_2026-10-03.json -o ~/restauracion
  (opcional) --esquema esquema.json   → orden por llaves foráneas y omite columnas calculadas
  (opcional) --max-kb 900             → tamaño máximo de cada archivo (el editor de Supabase no traga archivos enormes)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import restaurar_respaldo as rr  # noqa: E402
from esquema_a_sql import qi, lit  # noqa: E402

FILAS_POR_SENTENCIA = 500


def _etiqueta(texto):
    """Marca de comillas con dólar que no aparece dentro de los datos (así ningún dato puede 'cerrar' el texto)."""
    n = 0
    while True:
        etiqueta = "$lobo" + (str(n) if n else "") + "$"
        if etiqueta not in texto:
            return etiqueta
        n += 1


def sentencias_de_tabla(tabla, filas, omitir=(), filas_por_sentencia=FILAS_POR_SENTENCIA, max_bytes=900_000):
    """Una o más sentencias INSERT para la tabla. Reparte las filas para que ninguna sentencia pase de max_bytes."""
    columnas = [c for c in sorted(filas[0]) if c not in omitir]
    lista = ", ".join(qi(c) for c in columnas)
    salida, i = [], 0
    while i < len(filas):
        n = min(filas_por_sentencia, len(filas) - i)
        while True:
            parte = [{c: f[c] for c in columnas} for f in filas[i:i + n]]
            cuerpo = "[" + ",".join(rr.volcar(f) for f in parte) + "]"
            e = _etiqueta(cuerpo)
            sql = (f"insert into public.{qi(tabla)} ({lista})\n"
                   f"select {lista} from json_populate_recordset(null::public.{qi(tabla)}, {e}{cuerpo}{e}::json);")
            if len(sql.encode("utf-8")) <= max_bytes or n == 1:
                break
            n = max(1, n // 2)
        salida.append(sql)
        i += n
    return salida


def generar(respaldo, orden, omitir=None, max_bytes=900_000):
    """Devuelve la lista de textos (uno por archivo)."""
    omitir = omitir or {}
    tablas = list(orden)
    cabecera = [
        "-- ═══════════════════════════════════════════════════════════════════════════",
        "-- El Lobo — RESTAURAR UN RESPALDO (generado por herramientas/respaldo_a_sql.py)",
        f"-- Respaldo: {respaldo.generado_en or 'sin fecha'} · {len(respaldo.tablas)} tablas · {respaldo.total_filas()} filas",
        "-- Pegar en Supabase → SQL Editor → Run, en orden (archivo 1, 2, 3…). Cada archivo es todo-o-nada.",
        "-- SOLO en un proyecto NUEVO y VACÍO, que ya tenga las tablas (sql/esquema_completo.sql).",
        "-- Contiene datos REALES del negocio: no lo subas al repositorio ni lo compartas.",
        "-- ═══════════════════════════════════════════════════════════════════════════",
    ]
    vacio = [
        "-- Revisión: el destino debe estar vacío (si no, se detiene con un error y no entra nada).",
        "do $$ declare t text; n bigint; begin",
        f"  foreach t in array array[{', '.join(lit(t) for t in tablas)}] loop",
        "    execute format('select count(*) from public.%I', t) into n;",
        "    if n > 0 then",
        "      raise exception 'El destino NO está vacío: public.% ya tiene % filas. No se restaura sobre datos existentes.', t, n;",
        "    end if;",
        "  end loop;",
        "end $$;",
    ]
    bloques = []   # cada bloque es una lista de sentencias que viajan juntas
    for t in tablas:
        if respaldo.tablas[t]:
            bloques.append((f"-- {t}: {len(respaldo.tablas[t])} filas",
                            sentencias_de_tabla(t, respaldo.tablas[t], omitir.get(t, ()), max_bytes=max_bytes - 20_000)))
    final = ["-- Contadores automáticos: que los próximos pedidos no choquen con los restaurados.", rr.sql_secuencias(respaldo) or "-- (sin tablas con id numérico)", ""]
    pares = " union all\n".join(
        f"  select {lit(t)} as tabla, (select count(*) from public.{qi(t)}) as filas, {len(respaldo.tablas[t])} as esperado" for t in tablas)
    comprobacion = ["-- Comprobación: la columna «estado» debe decir OK en todas las filas.",
                    "select tabla, filas, esperado, case when filas = esperado then 'OK' else 'DIFERENTE' end as estado from (",
                    pares, ") x order by tabla;"]

    archivos, actual, tam = [], [], 0
    def cerrar():
        nonlocal actual, tam
        if actual:
            archivos.append(actual)
        actual, tam = [], 0
    for titulo, sentencias in bloques:
        for s in sentencias:
            if tam + len(s.encode("utf-8")) > max_bytes and actual:
                cerrar()
            actual.append((titulo, s))
            tam += len(s.encode("utf-8"))
    cerrar()
    if not archivos:
        archivos = [[]]

    textos = []
    for k, sentencias in enumerate(archivos, 1):
        partes = list(cabecera) + [f"-- Archivo {k} de {len(archivos)}", "begin;"]
        if k == 1:
            partes += vacio
        vistos = set()
        for titulo, s in sentencias:
            if titulo not in vistos:
                partes.append(titulo)
                vistos.add(titulo)
            partes.append(s)
        if k == len(archivos):
            partes += final
        partes.append("commit;")
        if k == len(archivos):
            partes += [""] + comprobacion
        textos.append("\n".join(partes) + "\n")
    return textos


def _dentro_del_repo(carpeta):
    raiz = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    try:
        return os.path.commonpath([os.path.abspath(carpeta), raiz]) == raiz
    except ValueError:      # discos distintos en Windows
        return False


def principal(argv=None, salida=None):
    salida = salida or sys.stdout
    imprimir = lambda *a: print(*a, file=salida)  # noqa: E731
    ap = argparse.ArgumentParser(description="Convierte un respaldo de El Lobo en archivos SQL para el SQL Editor de Supabase (sin llaves).")
    ap.add_argument("respaldo", help="Archivo JSON del respaldo (el de Datos → Respaldo completo; también se aceptan los formatos antiguos)")
    ap.add_argument("-o", "--carpeta", required=True, help="Carpeta donde dejar los .sql (FUERA del repositorio)")
    ap.add_argument("--esquema", help="Resultado de sql/consulta_esquema.sql (opcional)")
    ap.add_argument("--max-kb", type=int, default=900, help="Tamaño máximo de cada archivo en KB (por defecto 900)")
    args = ap.parse_args(argv)
    try:
        restricciones, validas, omitir = None, None, {}
        if args.esquema:
            import esquema_a_sql
            try:
                esquema = esquema_a_sql.cargar_esquema(open(args.esquema, encoding="utf-8").read())
            except (OSError, esquema_a_sql.EsquemaInvalido) as e:
                raise rr.Rechazo(f"No pude usar el esquema «{args.esquema}»: {e}", 2)
            restricciones = esquema["restricciones"]
            validas = set(rr.TABLAS_CONOCIDAS) | {t["nombre"] for t in esquema["tablas"] if t["tipo"] == "r"}
            for c in esquema["columnas"]:
                if c.get("generada"):
                    omitir.setdefault(c["tabla"], set()).add(c["nombre"])
        respaldo = rr.leer_respaldo(args.respaldo, validas)
        orden, avisos = rr.orden_por_llaves(list(respaldo.tablas), restricciones)
        carpeta = os.path.abspath(os.path.expanduser(args.carpeta))
        if _dentro_del_repo(carpeta):
            raise rr.Rechazo("La carpeta de salida está dentro del repositorio, y estos archivos llevan datos reales del negocio (el repo es público). Elige una carpeta fuera.", 2)
        textos = generar(respaldo, orden, omitir, max_bytes=max(50, args.max_kb) * 1024)
        os.makedirs(carpeta, exist_ok=True)
        rutas = []
        for k, texto in enumerate(textos, 1):
            ruta = os.path.join(carpeta, f"ElLobo_restaurar_{k:02d}_de_{len(textos):02d}.sql")
            with open(ruta, "w", encoding="utf-8", newline="\n") as f:
                f.write(texto)
            rutas.append(ruta)
    except rr.Rechazo as e:
        imprimir(f"NO SE HIZO NADA: {e}")
        return e.codigo
    imprimir(f"Respaldo: {len(respaldo.tablas)} tablas, {respaldo.total_filas()} filas. Listo: {len(rutas)} archivo(s) en {carpeta}")
    for r in rutas:
        imprimir(f"  {os.path.basename(r)}  ({os.path.getsize(r) // 1024} KB)")
    for a in respaldo.avisos + avisos:
        imprimir(f"AVISO: {a}")
    imprimir("\nSiguiente: en el proyecto de destino (nuevo y vacío, con sql/esquema_completo.sql ya corrido), abre Supabase → SQL Editor,\n"
             "pega el archivo 1, pulsa Run; luego el 2, etc. El último termina con una tabla que debe decir OK en todas las filas.")
    return 0


if __name__ == "__main__":
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(principal())
