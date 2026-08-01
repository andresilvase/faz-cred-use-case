import { once } from "node:events";
import type { Server } from "node:http";

import {
  createApp,
  type CreateAppOptions,
  type LoanDecisionProcessor,
} from "./interfaces/http/create-app.js";
import {
  NOOP_TECHNICAL_LOGGER,
  type TechnicalLogger,
} from "./infrastructure/logging/technical-logger.js";

export interface HttpServiceConfig {
  readonly port: number;
}

export async function startService(
  config: HttpServiceConfig,
  loanDecisions: LoanDecisionProcessor,
  options: CreateAppOptions = {},
): Promise<Server> {
  const server = createApp(loanDecisions, options).listen(config.port);

  await once(server, "listening");
  (options.logger ?? NOOP_TECHNICAL_LOGGER).info("service.started", {
    port: config.port,
  });

  return server;
}

export async function stopService(
  server: Server,
  logger: TechnicalLogger = NOOP_TECHNICAL_LOGGER,
): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  logger.info("service.stopped");
}
