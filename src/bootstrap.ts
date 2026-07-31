import { once } from "node:events";
import type { Server } from "node:http";

import type { ServiceConfig } from "./infrastructure/config/load-config.js";
import { createApp } from "./interfaces/http/create-app.js";

export async function startService(config: ServiceConfig): Promise<Server> {
  const server = createApp().listen(config.port);

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
