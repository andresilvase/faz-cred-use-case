import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../infrastructure/database/run-migrations.js";

import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgres-test-harness.js";

describe("PostgresTestHarness", () => {
  let harness: PostgresTestHarness;

  beforeAll(async () => {
    harness = await startPostgresTestHarness();
  }, 60_000);

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("starts a disposable PostgreSQL and accepts connections", async () => {
    const result = await harness.pool.query<{ value: number }>(
      "SELECT 1::int AS value",
    );

    expect(result.rows).toEqual([{ value: 1 }]);
  });

  it("resets the database to an empty schema between tests", async () => {
    const tables = await harness.pool.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    expect(tables.rows).toEqual([{ count: 0 }]);
  });

  it("applies migrations to an empty database and reapplies them safely", async () => {
    await runMigrations(harness.pool);
    await runMigrations(harness.pool);

    const migratedTable = await harness.pool.query<{ name: string | null }>(
      "SELECT to_regclass('public.migration_probe')::text AS name",
    );
    const appliedMigrations = await harness.pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM schema_migrations",
    );

    expect(migratedTable.rows).toEqual([{ name: "migration_probe" }]);
    expect(appliedMigrations.rows).toEqual([{ count: 1 }]);
  });

  it("rolls back every migration change when a migration fails", async () => {
    await expect(
      runMigrations(harness.pool, [
        {
          version: "test_create_table",
          sql: "CREATE TABLE should_rollback (id integer PRIMARY KEY)",
        },
        {
          version: "test_invalid_sql",
          sql: "THIS IS NOT VALID SQL",
        },
      ]),
    ).rejects.toThrow();

    const tables = await harness.pool.query<{
      migrationTable: string | null;
      createdTable: string | null;
    }>(`
      SELECT
        to_regclass('public.schema_migrations')::text AS "migrationTable",
        to_regclass('public.should_rollback')::text AS "createdTable"
    `);

    expect(tables.rows).toEqual([
      { migrationTable: null, createdTable: null },
    ]);
  });
});
