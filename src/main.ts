import { PersistApprovedLoan } from "./application/persist-approved-loan.js";
import { startService, stopService } from "./bootstrap.js";
import { loadConfig } from "./infrastructure/config/load-config.js";
import { PostgresApprovedLoanTransaction } from "./infrastructure/database/postgres-approved-loan-transaction.js";
import { createPostgresPool } from "./infrastructure/database/postgres-connection.js";
import { runMigrations } from "./infrastructure/database/run-migrations.js";
import { JsonTechnicalLogger } from "./infrastructure/logging/technical-logger.js";

let logger = new JsonTechnicalLogger();

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  logger = new JsonTechnicalLogger({
    includeErrorStack: config.nodeEnvironment !== "production",
  });
  const databaseConnectionOptions = {
    sslMode: config.databaseSslMode,
    ...(config.databaseSslCa === undefined
      ? {}
      : { sslCa: config.databaseSslCa }),
    logger,
  } as const;
  const migrationPool = createPostgresPool({
    connectionString: config.migrationDatabaseUrl,
    ...databaseConnectionOptions,
  });

  try {
    await runMigrations(migrationPool);
  } finally {
    await migrationPool.end();
  }

  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    ...databaseConnectionOptions,
  });
  let server: Awaited<ReturnType<typeof startService>>;

  try {
    server = await startService(
      config,
      new PersistApprovedLoan(
        new PostgresApprovedLoanTransaction(pool, { logger }),
      ),
      { logger },
    );
  } catch (error) {
    await pool.end();
    throw error;
  }

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await stopService(server, logger);
    } catch (error) {
      logger.error("service.shutdown_failed", error);
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (error) {
      logger.error("database.shutdown_failed", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  logger.error("service.start_failed", error);
  process.exitCode = 1;
});
