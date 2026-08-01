import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Pool } from "pg";

import { createPostgresPool } from "../infrastructure/database/postgres-connection.js";

const POSTGRES_IMAGE = "postgres:17";

export interface PostgresTestHarness {
  readonly pool: Pool;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export async function startPostgresTestHarness(): Promise<PostgresTestHarness> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("loan_decision_test")
    .withUsername("loan_decision_test")
    .withPassword("loan_decision_test")
    .start();
  const pool = createPostgresPool({
    connectionString: container.getConnectionUri(),
  });

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await stopResources(pool, container);
    throw error;
  }

  let stopped = false;

  return {
    pool,
    reset: async () => {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await stopResources(pool, container);
    },
  };
}

async function stopResources(
  pool: Pool,
  container: StartedPostgreSqlContainer,
): Promise<void> {
  try {
    await pool.end();
  } finally {
    await container.stop();
  }
}
