-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — DESHACER el candado de días (rollback de sql/candado_dias.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- Quita los disparadores «lobo_candado_dias» y las funciones que crearon. Después, caja vuelve a poder
-- cambiar datos de días anteriores (solo la pantalla se lo impide, como antes). NO toca las reglas de acceso
-- de sql/rls_seguridad.sql ni borra datos. Seguro de correr dos veces.
begin;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'lobo_candado_dias' and not g.tgisinternal and n.nspname = 'public'
  loop
    execute format('drop trigger lobo_candado_dias on public.%I', t.relname);
  end loop;
end $$;

drop function if exists seguridad.candado_dias_pedidos();
drop function if exists seguridad.candado_dias();
drop function if exists seguridad.rechazar_dia_cerrado(date);
drop function if exists seguridad.dia_negocio();
drop function if exists seguridad.ahora();

commit;

-- Verificación: candados = 0
select count(*) as candados from pg_trigger where tgname = 'lobo_candado_dias' and not tgisinternal;
