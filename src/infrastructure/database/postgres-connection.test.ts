import { afterEach, describe, expect, it } from "vitest";

import { createPostgresPool } from "./postgres-connection.js";

describe("createPostgresPool", () => {
  const pools: ReturnType<typeof createPostgresPool>[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it("configures verified TLS and identifies the application", () => {
    const pool = createPostgresPool({
      connectionString: "postgresql://localhost/loan_decision",
      sslMode: "verify-full",
      sslCa: "trusted-ca",
    });
    pools.push(pool);

    expect(pool.options.application_name).toBe("loan-decision-service");
    expect(pool.options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "trusted-ca",
    });
  });

  it("can explicitly disable TLS for trusted local environments", () => {
    const pool = createPostgresPool({
      connectionString: "postgresql://localhost/loan_decision",
      sslMode: "disable",
    });
    pools.push(pool);

    expect(pool.options.ssl).toBe(false);
  });
});
