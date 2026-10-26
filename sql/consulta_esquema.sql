-- ═══════════════════════════════════════════════════════════════════════════
-- El Lobo — CONSULTA DE ESQUEMA (SOLO LECTURA: no crea, no cambia ni borra nada)
-- ═══════════════════════════════════════════════════════════════════════════
-- Para qué: saber exactamente cómo está armada la base de datos HOY (tablas, columnas, tipos,
-- llaves, índices, reglas, funciones, disparadores…) y, a partir de eso, generar el archivo
-- sql/esquema_completo.sql con el que se puede reconstruir la base en un proyecto nuevo.
--
-- Cómo usarla (2 minutos):
--   1. Supabase → SQL Editor → New query.
--   2. Pega TODO este archivo y pulsa Run.
--   3. El resultado es UNA sola celda de texto (columna "esquema"). Cópiala completa
--      (en la celda: clic derecho → Copy, o el botón "Copy as JSON"/"Download CSV" de la tabla de
--      resultados) y pégasela a Claude, o guárdala en un archivo "esquema.json" FUERA del repositorio.
--
-- Qué NO incluye: ningún dato de tus tablas (ni un pedido, ni un cliente), solo la estructura.
-- Solo mira el esquema "public".
select jsonb_pretty(jsonb_build_object(
  'generado_en', now(),
  'postgres', version(),

  -- Tablas (r), tablas particionadas (p), vistas (v) y vistas materializadas (m) con su RLS
  'tablas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', c.relname,
      'tipo', c.relkind,
      'rls_activo', c.relrowsecurity,
      'rls_forzado', c.relforcerowsecurity,
      'comentario', obj_description(c.oid, 'pg_class'),
      'opciones', c.reloptions,
      'definicion_vista', case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) end
    ) order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  ),

  -- Columnas (en el orden en que existen)
  'columnas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', c.relname,
      'posicion', a.attnum,
      'nombre', a.attname,
      'tipo', format_type(a.atttypid, a.atttypmod),
      'obligatoria', a.attnotnull,
      'por_defecto', pg_get_expr(d.adbin, d.adrelid),
      'identidad', nullif(a.attidentity::text, ''),       -- 'a' siempre · 'd' por defecto
      'generada', nullif(a.attgenerated::text, ''),
      'comentario', col_description(c.oid, a.attnum)
    ) order by c.relname, a.attnum), '[]'::jsonb)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  ),

  -- Restricciones: llave primaria (p), única (u), foránea (f), check (c), exclusión (x)
  'restricciones', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', c.relname,
      'nombre', k.conname,
      'tipo', k.contype,
      'definicion', pg_get_constraintdef(k.oid, true),
      'tabla_referida', case when k.contype = 'f' then (select relname from pg_class where oid = k.confrelid) end
    ) order by c.relname, k.contype, k.conname), '[]'::jsonb)
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),

  -- Índices (los de llaves primarias y únicas ya salen en "restricciones", pero se listan todos)
  'indices', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', tablename, 'nombre', indexname, 'definicion', indexdef
    ) order by tablename, indexname), '[]'::jsonb)
    from pg_indexes where schemaname = 'public'
  ),

  -- Secuencias (para los números automáticos de "id") y a qué columna pertenece cada una
  -- (vinculo: 'a' = serial / 'i' = identidad; vacío = secuencia suelta)
  'secuencias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', s.sequencename, 'tipo', s.data_type, 'inicio', s.start_value, 'incremento', s.increment_by,
      'minimo', s.min_value, 'maximo', s.max_value, 'ultimo_valor', s.last_value,
      'tabla', o.relname, 'columna', o.attname, 'vinculo', o.deptype
    ) order by s.sequencename), '[]'::jsonb)
    from pg_sequences s
    left join lateral (
      select c.relname, a.attname, d.deptype
      from pg_class sc
      join pg_namespace sn on sn.oid = sc.relnamespace and sn.nspname = s.schemaname
      join pg_depend d on d.objid = sc.oid and d.classid = 'pg_class'::regclass
                      and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      join pg_class c on c.oid = d.refobjid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = d.refobjsubid
      where sc.relname = s.sequencename and sc.relkind = 'S'
      limit 1
    ) o on true
    where s.schemaname = 'public'
  ),

  -- Reglas de acceso (RLS) tal como están hoy
  'politicas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', tablename, 'nombre', policyname, 'permisiva', permissive, 'roles', roles,
      'operacion', cmd, 'using', qual, 'with_check', with_check
    ) order by tablename, policyname), '[]'::jsonb)
    from pg_policies where schemaname = 'public'
  ),

  -- Tipos propios: listas de opciones (enum) y dominios (un tipo con reglas)
  'tipos_enum', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', t.typname,
      'valores', (select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), '[]'::jsonb) from pg_enum e where e.enumtypid = t.oid)
    ) order by t.typname), '[]'::jsonb)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ),
  'dominios', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', t.typname,
      'tipo_base', format_type(t.typbasetype, t.typtypmod),
      'obligatorio', t.typnotnull,
      'por_defecto', t.typdefault,
      'restricciones', (select coalesce(jsonb_agg(jsonb_build_object('nombre', k.conname, 'definicion', pg_get_constraintdef(k.oid, true)) order by k.conname), '[]'::jsonb)
                        from pg_constraint k where k.contypid = t.oid)
    ) order by t.typname), '[]'::jsonb)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'd'
  ),

  -- Funciones propias en public (y si corren con permisos de su dueño: security definer)
  'funciones', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', p.proname,
      'argumentos', pg_get_function_identity_arguments(p.oid),
      'tipo', p.prokind,
      'security_definer', p.prosecdef,
      'definicion', pg_get_functiondef(p.oid)
    ) order by p.proname), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
  ),

  -- Disparadores (triggers) propios, sin los internos de llaves foráneas
  'disparadores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', c.relname, 'nombre', t.tgname, 'definicion', pg_get_triggerdef(t.oid, true)
    ) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ),

  -- Qué roles pueden hacer qué sobre cada tabla (anon, authenticated, service_role)
  'permisos_de_tabla', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabla', table_name, 'rol', grantee, 'privilegio', privilege_type
    ) order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
  ),

  -- Tablas publicadas en tiempo real (Realtime), si las hay
  'publicaciones', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'publicacion', pubname, 'tabla', tablename
    ) order by pubname, tablename), '[]'::jsonb)
    from pg_publication_tables where schemaname = 'public'
  ),

  -- Extensiones instaladas
  'extensiones', (
    select coalesce(jsonb_agg(jsonb_build_object('nombre', extname, 'version', extversion) order by extname), '[]'::jsonb)
    from pg_extension
  )
)) as esquema;
