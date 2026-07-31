import { describe, expect, it } from "vitest";

import { loadConfig } from "./load-config.js";

describe("loadConfig", () => {
  it("fails explicitly when PORT is absent", () => {
    expect(() => loadConfig({})).toThrowError(
      "Missing required environment variable: PORT",
    );
  });

  it.each(["0", "65536", "3.14", "not-a-port"])(
    "rejects invalid PORT value %s",
    (port) => {
      expect(() => loadConfig({ PORT: port })).toThrowError(
        "Invalid environment variable PORT: expected an integer between 1 and 65535",
      );
    },
  );

  it("accepts a valid PORT value", () => {
    expect(loadConfig({ PORT: "3000" })).toEqual({ port: 3000 });
  })
});
