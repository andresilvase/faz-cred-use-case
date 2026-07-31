import { startService, stopService } from "./bootstrap.js";
import { loadConfig } from "./infrastructure/config/load-config.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = await startService(config);

  const shutdown = async (): Promise<void> => {
    try {
      await stopService(server);
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
