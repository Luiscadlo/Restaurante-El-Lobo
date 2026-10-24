-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER la seguridad (rollback de sql/rls_seguridad.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- GENERADO por herramientas/generar_rls.py. Úsalo SOLO si algo sale mal y hay que volver
-- al estado anterior (la llave pública vuelve a abrir las tablas: es lo que había antes).
--
-- · Borra las políticas "lobo_*".
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
    where schemaname = 'public' and policyname like 'lobo\_%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
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
