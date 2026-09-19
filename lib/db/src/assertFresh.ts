import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set to bootstrap the database.");
}

const client = new Client({ connectionString });

try {
  await client.connect();
  const result = await client.query<{ object_type: string; object_name: string }>(`
    SELECT object_type, object_name
    FROM (
      SELECT
        CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized view'
          WHEN 'S' THEN 'sequence'
          WHEN 'f' THEN 'foreign table'
        END AS object_type,
        c.relname AS object_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')

      UNION ALL

      SELECT 'enum' AS object_type, t.typname AS object_name
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typtype = 'e'
    ) objects
    ORDER BY object_type, object_name
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    throw new Error(
      `Database bootstrap is fresh-only; found existing ${result.rows[0].object_type} ` +
        `"public.${result.rows[0].object_name}". ` +
        "Use db:migrate for an existing installation.",
    );
  }

  console.log("Fresh database confirmed.");
} finally {
  await client.end();
}