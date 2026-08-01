import type { Pool } from "pg";

import { MIGRATIONS, type Migration } from "./migrations.js";

export async function runMigrations(
  pool: Pool,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migration.version],
      );

      if (applied.rowCount === 0) {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [migration.version],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
