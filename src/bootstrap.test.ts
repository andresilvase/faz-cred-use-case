import { afterEach, describe, expect, it } from "vitest";

import { startService, stopService } from "./bootstrap.js";

describe("service lifecycle", () => {
  let service: Awaited<ReturnType<typeof startService>> | undefined;
  const events: string[] = [];
  const logger = {
    info: (event: string) => events.push(event),
    warn: () => undefined,
    error: () => undefined,
  };

  afterEach(async () => {
    if (service?.listening) {
      await stopService(service);
    }
  });

  it("starts accepting connections and shuts down cleanly", async () => {
    events.length = 0;
    service = await startService(
      { port: 0 },
      {
        execute: async () => {
          throw new Error("loan decisions are not used in this test");
        },
      },
      { logger },
    );

    expect(service.listening).toBe(true);

    await stopService(service, logger);

    expect(service.listening).toBe(false);
    expect(events).toEqual(["service.started", "service.stopped"]);
  });
});
