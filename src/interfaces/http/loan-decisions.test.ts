import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PersistApprovedLoan } from "../../application/persist-approved-loan.js";
import { PostgresApprovedLoanTransaction } from "../../infrastructure/database/postgres-approved-loan-transaction.js";
import { runMigrations } from "../../infrastructure/database/run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../../test-support/postgres-test-harness.js";
import { createApp } from "./create-app.js";

describe("POST /loan-decisions", () => {
  let harness: PostgresTestHarness;
  let server: Server;
  let baseUrl: string;
  const logRecords: Record<string, unknown>[] = [];
  const logger = {
    info: (event: string, fields: Record<string, unknown> = {}) => {
      logRecords.push({ level: "info", event, ...fields });
    },
    warn: (event: string, fields: Record<string, unknown> = {}) => {
      logRecords.push({ level: "warn", event, ...fields });
    },
    error: (
      event: string,
      error: unknown,
      fields: Record<string, unknown> = {},
    ) => {
      logRecords.push({ level: "error", event, error, ...fields });
    },
  };

  beforeAll(async () => {
    harness = await startPostgresTestHarness();
    server = createApp(
      new PersistApprovedLoan(
        new PostgresApprovedLoanTransaction(harness.pool, { logger }),
      ),
      {
        logger,
        createCorrelationId: () => "test-correlation-id",
      },
    ).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  beforeEach(async () => {
    logRecords.length = 0;
    await harness.reset();
    await runMigrations(harness.pool);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await harness.stop();
  });

  it("returns the public approval contract without the policy version", async () => {
    const response = await fetch(`${baseUrl}/loan-decisions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "http-approval-key",
      },
      body: JSON.stringify({
        borrower_id: "borrower-http-approved",
        uf: "GO",
        amount: 500_000,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Correlation-Id")).toBe(
      "test-correlation-id",
    );
    expect(await response.json()).toEqual({
      decision: "APPROVED",
      message: "O valor solicitado foi aprovado.",
      loan_id: expect.any(String),
    });
    expect(logRecords).toContainEqual({
      level: "info",
      event: "http.request_completed",
      correlation_id: "test-correlation-id",
      method: "POST",
      route: "/loan-decisions",
      status: 200,
      duration_ms: expect.any(Number),
    });
  });

  it("returns the public denial contract with status 200", async () => {
    const response = await postLoanDecision(
      baseUrl,
      {
        borrower_id: "borrower-http-denied",
        uf: "GO",
        amount: 1_000_001,
      },
      "http-denial-key",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decision: "DENIED",
      message: "O empréstimo foi negado.",
    });
  });

  it.each([
    ["missing fields", {}],
    ["invalid borrower", { borrower_id: "", uf: "GO", amount: 1 }],
    [
      "invalid UF",
      { borrower_id: "borrower-invalid-uf", uf: "XX", amount: 1 },
    ],
    [
      "zero amount",
      { borrower_id: "borrower-invalid-amount", uf: "GO", amount: 0 },
    ],
    [
      "negative amount",
      { borrower_id: "borrower-negative-amount", uf: "GO", amount: -1 },
    ],
    [
      "fractional amount",
      { borrower_id: "borrower-fractional-amount", uf: "GO", amount: 1.5 },
    ],
    ["non-object body", null],
  ])("returns 400 for %s", async (_scenario, body) => {
    const response = await postLoanDecision(
      baseUrl,
      body,
      "invalid-input-key",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request",
    });
  });

  it("returns 400 when Idempotency-Key is missing", async () => {
    const response = await postLoanDecision(baseUrl, {
      borrower_id: "borrower-missing-key",
      uf: "GO",
      amount: 1,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request",
    });
  });

  it("logs validation failures without sensitive request data", async () => {
    const response = await postLoanDecision(
      baseUrl,
      {
        borrower_id: " sensitive-borrower ",
        uf: "GO",
        amount: 1,
      },
      "sensitive-idempotency-key",
    );

    expect(response.status).toBe(400);
    expect(logRecords).toContainEqual({
      level: "warn",
      event: "http.validation_failed",
      correlation_id: "test-correlation-id",
      method: "POST",
      route: "/loan-decisions",
      field: "borrowerId",
    });
    const serializedLogs = JSON.stringify(logRecords);
    expect(serializedLogs).not.toContain("sensitive-borrower");
    expect(serializedLogs).not.toContain("sensitive-idempotency-key");
  });

  it.each(["", "   "])(
    "returns 400 when Idempotency-Key is invalid",
    async (idempotencyKey) => {
      const response = await postLoanDecision(
        baseUrl,
        {
          borrower_id: "borrower-invalid-key",
          uf: "GO",
          amount: 1,
        },
        idempotencyKey,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid request",
      });
    },
  );

  it("returns 400 for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/loan-decisions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "malformed-json-key",
      },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request",
    });
  });

  it("returns 409 when a key is reused with a different payload", async () => {
    await postLoanDecision(
      baseUrl,
      {
        borrower_id: "borrower-http-conflict",
        uf: "GO",
        amount: 400_000,
      },
      "http-conflict-key",
    );

    const response = await postLoanDecision(
      baseUrl,
      {
        borrower_id: "borrower-http-conflict",
        uf: "GO",
        amount: 300_000,
      },
      "http-conflict-key",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency key conflicts with a different request",
    });
  });

  it("returns a generic 500 without exposing database details", async () => {
    await harness.pool.query("DROP TABLE exposure_aggregates");

    const response = await postLoanDecision(
      baseUrl,
      {
        borrower_id: "borrower-http-db-error",
        uf: "GO",
        amount: 1,
      },
      "http-db-error-key",
    );

    expect(response.status).toBe(500);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ error: "Internal server error" });
    expect(responseBody).not.toContain("exposure_aggregates");
    expect(responseBody).not.toContain("PostgreSQL");
    expect(logRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          event: "database.query_failed",
        }),
        expect.objectContaining({
          level: "error",
          event: "database.transaction_failed",
        }),
        expect.objectContaining({
          level: "error",
          event: "http.request_failed",
          correlation_id: "test-correlation-id",
        }),
      ]),
    );
  });
});

async function postLoanDecision(
  baseUrl: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return fetch(`${baseUrl}/loan-decisions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
