#!/usr/bin/env python3
"""Genera el SQL de seguridad (RLS) de El Lobo a partir de la matriz de permisos.

    python herramientas/generar_rls.py            # escribe sql/rls_seguridad.sql y sql/rollback_rls.sql
    python herramientas/generar_rls.py --check    # no escribe: falla si los archivos no coinciden con la matriz

Fuente única: sql/matriz_permisos.json (tabla × rol × operación). NO se edita el SQL a mano:
se cambia la matriz y se vuelve a generar. La prueba tests/python/test_rls.py aplica el SQL en un
Postgres real y comprueba que se cumple exactamente la matriz.
"""
import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MATRIZ = RAIZ / "sql" / "matriz_permisos.json"
SALIDA_APLICAR = RAIZ / "sql" / "rls_seguridad.sql"
SALIDA_REVERTIR = RAIZ / "sql" / "rollback_rls.sql"

ROLES = ["admin", "caja", "respaldo"]          # valores de app_metadata.rol
OPERACIONES = [("S", "select"), ("I", "insert"), ("U", "update"), ("D", "delete")]


def cargar():
    datos = json.loads(MATRIZ.read_text(encoding="utf-8"))
    tablas = datos["tablas"]
    roles = datos["roles"]
    for rol, permisos in roles.items():
        if rol not in ROLES:
            raise SystemExit(f"Rol desconocido en la matriz: {rol}")
        for tabla, ops in permisos.items():
            if tabla not in tablas:
                raise SystemExit(f"La tabla {tabla} (rol {rol}) no está en la lista de tablas")
            if set(ops) - set("SIUD"):
                raise SystemExit(f"Operaciones inválidas en {rol}/{tabla}: {ops}")
    return tablas, roles


def lista_sql(roles):
    return ", ".join(f"'{r}'" for r in roles)


def total_politicas(tablas, roles):
    return sum(1 for t in tablas for letra, _ in OPERACIONES
               if any(letra in roles.get(r, {}).get(t, "") for r in ROLES))


def generar_aplicar(tablas, roles):
    L = []
    w = L.append
    w("-- ═══════════════════════════════════════════════════════════════════════════")
    w("-- El Lobo — SEGURIDAD: usuarios con rol + reglas de acceso (RLS) en Supabase")
    w("-- ═══════════════════════════════════════════════════════════════════════════")
    w("-- GENERADO por herramientas/generar_rls.py desde sql/matriz_permisos.json.")
    w("-- NO editar a mano: se cambia la matriz y se vuelve a generar.")
    w("-- Guía de uso: docs/DESPLIEGUE_SEGURIDAD.md  ·  Para deshacer: sql/rollback_rls.sql")
    w("--")
    w("-- Qué hace (todo en una sola transacción: si algo falla, no queda nada a medias):")
    w("--   0. Guarda cómo estaba cada tabla (para poder deshacer exactamente).")
    w("--   1. Crea la función que lee el rol del token (app_metadata.rol — el usuario NO puede")
    w("--      cambiarlo; user_metadata sí podría, por eso NO se usa).")
    w("--   2. Activa RLS en TODAS las tablas de 'public': sin política = cerrado.")
    w("--   3. Le quita a la llave pública (anon) todo acceso a las tablas.")
    w("--   3b. Retira las reglas viejas que dejaban pasar a todos (p. ej. «allow all …»): se SUMAN a las")
    w("--      nuevas y las anularían. Las guarda en seguridad.politicas_previas para poder deshacer.")
    w("--   4. Crea las políticas por tabla y operación (admin / caja / respaldo).")
    w("--")
    w("-- Seguro de volver a correr (idempotente).")
    w("begin;")
    w("")
    w("-- 0. Estado anterior (solo se guarda la primera vez que se corre este script)")
    w("create schema if not exists seguridad;")
    w("create table if not exists seguridad.estado_previo (")
    w("  tabla text primary key,")
    w("  rls_activo boolean not null,")
    w("  anon_leia boolean not null,")
    w("  guardado_en timestamptz not null default now()")
    w(");")
    w("insert into seguridad.estado_previo (tabla, rls_activo, anon_leia)")
    w("select c.relname, c.relrowsecurity, has_table_privilege('anon', c.oid, 'select')")
    w("from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("where n.nspname = 'public' and c.relkind in ('r', 'p')")
    w("on conflict (tabla) do nothing;")
    w("create table if not exists seguridad.politicas_previas (")
    w("  tabla text not null,")
    w("  nombre text not null,")
    w("  comando text not null,")
    w("  roles text[] not null,")
    w("  usando text,")
    w("  con_chequeo text,")
    w("  guardado_en timestamptz not null default now(),")
    w("  primary key (tabla, nombre)")
    w(");")
    w("")
    w("-- 1. Rol del usuario, leído de su token firmado")
    w("create or replace function seguridad.rol_app() returns text")
    w("language sql stable as $$")
    w("  select coalesce(auth.jwt() -> 'app_metadata' ->> 'rol', '')")
    w("$$;")
    w("grant usage on schema seguridad to authenticated;")
    w("grant execute on function seguridad.rol_app() to authenticated;")
    w("")
    w("-- 2. RLS activo en TODAS las tablas de public (incluidas las que no estén en la lista de abajo)")
    w("do $$")
    w("declare t record;")
    w("begin")
    w("  for t in")
    w("    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("    where n.nspname = 'public' and c.relkind in ('r', 'p')")
    w("  loop")
    w("    execute format('alter table public.%I enable row level security', t.relname);")
    w("  end loop;")
    w("end $$;")
    w("")
    w("-- 2b. Las VISTAS de Supabase, por defecto, se saltan el RLS. Se pasan a 'security_invoker' para que")
    w("--     respeten las reglas de quien consulta (si no hay vistas en public, esto no hace nada).")
    w("do $$")
    w("declare v record;")
    w("begin")
    w("  for v in")
    w("    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("    where n.nspname = 'public' and c.relkind = 'v'")
    w("  loop")
    w("    if current_setting('server_version_num')::int >= 150000 then")
    w("      execute format('alter view public.%I set (security_invoker = true)', v.relname);")
    w("    else")
    w("      raise exception 'La vista public.% se saltaría las reglas y esta versión de Postgres no permite corregirlo; revísala antes de seguir', v.relname;")
    w("    end if;")
    w("  end loop;")
    w("end $$;")
    w("")
    w("-- 3. La llave pública (anon) ya no abre ninguna tabla; las tablas nuevas tampoco")
    w("revoke all on all tables in schema public from anon;")
    w("revoke all on all sequences in schema public from anon;")
    w("alter default privileges in schema public revoke all on tables from anon;")
    w("alter default privileges in schema public revoke all on sequences from anon;")
    w("-- Los usuarios con sesión (authenticated) conservan los permisos de tabla; el filtro lo hacen")
    w("-- las políticas de abajo (sin política que los deje pasar, no ven ni tocan nada).")
    w("grant select, insert, update, delete on all tables in schema public to authenticated;")
    w("grant usage, select on all sequences in schema public to authenticated;")
    w("")
    w("-- 3b. Reglas viejas PERMISIVAS que no son de lobo_*: en Postgres las reglas permisivas se suman")
    w("--     (basta con que UNA deje pasar), así que una «allow all» vieja anularía las nuevas para caja o")
    w("--     cualquier usuario con sesión. Se guardan (solo la primera vez) y se retiran. Las RESTRICTIVAS")
    w("--     solo recortan permisos: se dejan como están.")
    w("insert into seguridad.politicas_previas (tabla, nombre, comando, roles, usando, con_chequeo)")
    w("select tablename, policyname, cmd, roles::text[], qual, with_check")
    w("from pg_policies")
    w("where schemaname = 'public' and permissive = 'PERMISSIVE' and policyname not like 'lobo\\_%'")
    w("on conflict (tabla, nombre) do nothing;")
    w("do $$")
    w("declare p record;")
    w("begin")
    w("  for p in")
    w("    select tablename, policyname from pg_policies")
    w("    where schemaname = 'public' and permissive = 'PERMISSIVE' and policyname not like 'lobo\\_%'")
    w("  loop")
    w("    execute format('drop policy %I on public.%I', p.policyname, p.tablename);")
    w("  end loop;")
    w("end $$;")
    w("")
    w("-- 4. Políticas (una por tabla y operación). Nombre: lobo_<tabla>_<operación>")
    for tabla in tablas:
        w(f"-- {tabla}")
        for letra, op in OPERACIONES:
            nombre = f"lobo_{tabla}_{op}"
            w(f'drop policy if exists "{nombre}" on public.{tabla};')
            quienes = [r for r in ROLES if letra in roles.get(r, {}).get(tabla, "")]
            if not quienes:
                continue
            cond = f"(select seguridad.rol_app()) in ({lista_sql(quienes)})"
            if op == "select":
                w(f'create policy "{nombre}" on public.{tabla} for select to authenticated using ({cond});')
            elif op == "insert":
                w(f'create policy "{nombre}" on public.{tabla} for insert to authenticated with check ({cond});')
            elif op == "update":
                w(f'create policy "{nombre}" on public.{tabla} for update to authenticated using ({cond}) with check ({cond});')
            else:
                w(f'create policy "{nombre}" on public.{tabla} for delete to authenticated using ({cond});')
    w("")
    w("commit;")
    w("")
    w("-- Verificación (el editor de Supabase muestra este resultado). Lo esperado:")
    w("--   tablas_sin_rls = 0 · vistas_sin_proteger = 0 · anon_con_permisos = 0 · politicas = %d · reglas_ajenas_abiertas = 0" % total_politicas(tablas, roles))
    w("select")
    w("  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) as tablas_sin_rls,")
    w("  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("     where n.nspname = 'public' and c.relkind = 'v'")
    w("       and not coalesce('security_invoker=true' = any(c.reloptions), false)) as vistas_sin_proteger,")
    w("  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace")
    w("     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')")
    w("       and has_table_privilege('anon', c.oid, 'select,insert,update,delete')) as anon_con_permisos,")
    w("  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'lobo\\_%') as politicas,")
    w("  (select count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and policyname not like 'lobo\\_%') as reglas_ajenas_abiertas;")
    return "\n".join(L) + "\n"


def generar_revertir():
    return """-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la seguridad (rollback de sql/rls_seguridad.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- GENERADO por herramientas/generar_rls.py. Úsalo SOLO si algo sale mal y hay que volver
-- al estado anterior (la llave pública vuelve a abrir las tablas: es lo que había antes).
--
-- · Borra las políticas "lobo_*".
-- · Vuelve a crear las reglas viejas que el SQL de seguridad retiró (seguridad.politicas_previas).
-- · Deja RLS de cada tabla como estaba (según seguridad.estado_previo) y devuelve a anon
--   el acceso en las tablas que lo tenían.
-- · Las tablas creadas DESPUÉS de aplicar la seguridad se quedan con RLS activo (más seguro).
-- · Deja los usuarios de Supabase Auth como están.
begin;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and policyname like 'lobo\\_%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

do $$
declare p record;
begin
  for p in select * from seguridad.politicas_previas loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = p.tabla and c.relkind in ('r', 'p')
    ) and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = p.tabla and policyname = p.nombre
    ) then
      execute format(
        'create policy %I on public.%I as permissive for %s to %s%s%s',
        p.nombre, p.tabla, p.comando,
        (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(p.roles) r),
        case when p.usando is not null then format(' using (%s)', p.usando) else '' end,
        case when p.con_chequeo is not null then format(' with check (%s)', p.con_chequeo) else '' end
      );
    end if;
  end loop;
end $$;

do $$
declare e record;
begin
  for e in select tabla, rls_activo, anon_leia from seguridad.estado_previo loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = e.tabla and c.relkind in ('r', 'p')
    ) then
      execute format(
        'alter table public.%I %s row level security',
        e.tabla, case when e.rls_activo then 'enable' else 'disable' end
      );
      if e.anon_leia then
        execute format('grant all on public.%I to anon', e.tabla);
      end if;
    end if;
  end loop;
end $$;

grant all on all sequences in schema public to anon;
alter default privileges in schema public grant all on tables to anon;
alter default privileges in schema public grant all on sequences to anon;

commit;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="solo comprueba que los archivos están al día")
    args = ap.parse_args()
    tablas, roles = cargar()
    esperado = {SALIDA_APLICAR: generar_aplicar(tablas, roles), SALIDA_REVERTIR: generar_revertir()}
    if args.check:
        mal = [str(ruta.relative_to(RAIZ)) for ruta, texto in esperado.items()
               if not ruta.exists() or ruta.read_text(encoding="utf-8") != texto]
        if mal:
            print("Desactualizados (corre: python herramientas/generar_rls.py): " + ", ".join(mal))
            return 1
        print("OK: el SQL coincide con la matriz.")
        return 0
    for ruta, texto in esperado.items():
        ruta.write_text(texto, encoding="utf-8")
        print("Escrito", ruta.relative_to(RAIZ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
