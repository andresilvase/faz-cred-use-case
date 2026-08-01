import { PersistApprovedLoan } from "./application/persist-approved-loan.js";
import { startService, stopService } from "./bootstrap.js";
import { loadConfig } from "./infrastructure/config/load-config.js";
import { PostgresApprovedLoanTransaction } from "./infrastructure/database/postgres-approved-loan-transaction.js";
import { createPostgresPool } from "./infrastructure/database/postgres-connection.js";
import { runMigrations } from "./infrastructure/database/run-migrations.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createPostgresPool({ connectionString: config.databaseUrl });
  let server: Awaited<ReturnType<typeof startService>>;

  try {
    await runMigrations(pool);
    server = await startService(
      config,
      new PersistApprovedLoan(new PostgresApprovedLoanTransaction(pool)),
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
      await stopService(server);
      await pool.end();
    } catch (error) {
      console.error("Failed to shut down the service", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error("Failed to start the service", error);
  process.exitCode = 1;
});
