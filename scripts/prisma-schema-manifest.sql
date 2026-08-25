WITH manifest AS (
  SELECT jsonb_build_object(
    'section', 'table',
    'schema', n.nspname,
    'table', c.relname
  )::text AS line
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations'

  UNION ALL

  SELECT jsonb_build_object(
    'section', 'column',
    'schema', n.nspname,
    'table', c.relname,
    'ordinal', a.attnum,
    'column', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'udtSchema', tn.nspname,
    'udt', t.typname,
    'nullable', NOT a.attnotnull,
    'default', pg_get_expr(ad.adbin, ad.adrelid, true),
    'identity', a.attidentity,
    'generated', a.attgenerated
  )::text
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  JOIN pg_namespace tn ON tn.oid = t.typnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations'
    AND a.attnum > 0
    AND NOT a.attisdropped

  UNION ALL

  SELECT jsonb_build_object(
    'section', 'enum',
    'schema', n.nspname,
    'enum', t.typname,
    'values', array_agg(e.enumlabel ORDER BY e.enumsortorder)
  )::text
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
  GROUP BY n.nspname, t.typname

  UNION ALL

  SELECT jsonb_build_object(
    'section', CASE con.contype WHEN 'p' THEN 'primaryKey' ELSE 'uniqueConstraint' END,
    'schema', n.nspname,
    'table', c.relname,
    'columns', array_agg(a.attname ORDER BY keys.ordinality),
    'deferrable', con.condeferrable,
    'initiallyDeferred', con.condeferred
  )::text
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = keys.attnum
  WHERE n.nspname = 'public'
    AND c.relname <> '_prisma_migrations'
    AND con.contype IN ('p', 'u')
  GROUP BY con.oid, con.contype, n.nspname, c.relname, con.condeferrable, con.condeferred

  UNION ALL

  SELECT jsonb_build_object(
    'section', 'foreignKey',
    'schema', n.nspname,
    'table', c.relname,
    'columns', array_agg(a.attname ORDER BY src.ordinality),
    'referencedSchema', rn.nspname,
    'referencedTable', rc.relname,
    'referencedColumns', array_agg(ra.attname ORDER BY src.ordinality),
    'onDelete', CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
    'onUpdate', CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
    'deferrable', con.condeferrable,
    'initiallyDeferred', con.condeferred
  )::text
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class rc ON rc.oid = con.confrelid
  JOIN pg_namespace rn ON rn.oid = rc.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src(attnum, ordinality)
  JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref(attnum, ordinality) ON ref.ordinality = src.ordinality
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = src.attnum
  JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = ref.attnum
  WHERE n.nspname = 'public'
    AND con.contype = 'f'
  GROUP BY con.oid, n.nspname, c.relname, rn.nspname, rc.relname,
    con.confdeltype, con.confupdtype, con.condeferrable, con.condeferred

  UNION ALL

  SELECT jsonb_build_object(
    'section', 'index',
    'schema', n.nspname,
    'table', c.relname,
    'unique', i.indisunique,
    'nullsNotDistinct', i.indnullsnotdistinct,
    'method', am.amname,
    'keys', ARRAY(
      SELECT pg_get_indexdef(i.indexrelid, position, true)
      FROM generate_series(1, i.indnkeyatts) AS position
      ORDER BY position
    ),
    'include', ARRAY(
      SELECT pg_get_indexdef(i.indexrelid, position, true)
      FROM generate_series(i.indnkeyatts + 1, i.indnatts) AS position
      ORDER BY position
    ),
    'predicate', pg_get_expr(i.indpred, i.indrelid, true)
  )::text
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
  WHERE n.nspname = 'public'
    AND c.relname <> '_prisma_migrations'
    AND NOT i.indisprimary
)
SELECT line
FROM manifest
ORDER BY line;
