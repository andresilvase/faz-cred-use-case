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
    expect(
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://localhost/loan_decision",
        MIGRATION_DATABASE_URL: "postgresql://localhost/loan_decision_migrations",
        DATABASE_SSL_MODE: "verify-full",
        DATABASE_SSL_CA: "trusted-ca",
        NODE_ENV: "development",
      }),
    ).toEqual({
      port: 3000,
      databaseUrl: "postgresql://localhost/loan_decision",
      migrationDatabaseUrl:
        "postgresql://localhost/loan_decision_migrations",
      databaseSslMode: "verify-full",
      databaseSslCa: "trusted-ca",
      nodeEnvironment: "development",
    });
  });

  it("fails explicitly when DATABASE_URL is absent", () => {
    expect(() => loadConfig({ PORT: "3000" })).toThrowError(
      "Missing required environment variable: DATABASE_URL",
    );
  });

  it("requires an explicit TLS mode", () => {
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://localhost/loan_decision",
        MIGRATION_DATABASE_URL: "postgresql://localhost/loan_decision_migrations",
      }),
    ).toThrowError("Missing required environment variable: DATABASE_SSL_MODE");
  });

  it("rejects an invalid TLS mode", () => {
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://localhost/loan_decision",
        MIGRATION_DATABASE_URL: "postgresql://localhost/loan_decision_migrations",
        DATABASE_SSL_MODE: "prefer",
      }),
    ).toThrowError(
      "Invalid environment variable DATABASE_SSL_MODE: expected disable or verify-full",
    );
  });

  it("requires separate migration credentials", () => {
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://localhost/loan_decision",
      }),
    ).toThrowError(
      "Missing required environment variable: MIGRATION_DATABASE_URL",
    );
  });
});
