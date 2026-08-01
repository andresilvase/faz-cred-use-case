import { once } from "node:events";
import type { Server } from "node:http";

import {
  createApp,
  type LoanDecisionProcessor,
} from "./interfaces/http/create-app.js";

export interface HttpServiceConfig {
  readonly port: number;
}

export async function startService(
  config: HttpServiceConfig,
  loanDecisions: LoanDecisionProcessor,
): Promise<Server> {
  const server = createApp(loanDecisions).listen(config.port);

  await once(server, "listening");

  return server;
}

export async function stopService(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
