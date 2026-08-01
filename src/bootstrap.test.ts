import { afterEach, describe, expect, it } from "vitest";

import { startService, stopService } from "./bootstrap.js";

describe("service lifecycle", () => {
  let service: Awaited<ReturnType<typeof startService>> | undefined;

  afterEach(async () => {
    if (service?.listening) {
      await stopService(service);
    }
  });

  it("starts accepting connections and shuts down cleanly", async () => {
    service = await startService(
      { port: 0 },
      {
        execute: async () => {
          throw new Error("loan decisions are not used in this test");
        },
      },
    );

    expect(service.listening).toBe(true);

    await stopService(service);

    expect(service.listening).toBe(false);
  });
});
