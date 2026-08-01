import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../../test-support/postgres-test-harness.js";
import { runMigrations } from "./run-migrations.js";
import { PostgresApprovedLoanTransaction } from "./postgres-approved-loan-transaction.js";

describe("PostgresApprovedLoanTransaction retries", () => {
  let harness: PostgresTestHarness;

  beforeAll(async () => {
    harness = await startPostgresTestHarness();
  }, 60_000);

  beforeEach(async () => {
    await harness.reset();
    await runMigrations(harness.pool);
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("retries the complete transaction after a PostgreSQL deadlock", async () => {
    const transactions = new PostgresApprovedLoanTransaction(harness.pool);
    let attempts = 0;

    const result = await transactions.run(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw postgresError("40P01", "forced deadlock");
      }

      return "completed";
    });

    expect(result).toBe("completed");
    expect(attempts).toBe(2);
  });

  it("retries after lock timeout and succeeds when the aggregate is released", async () => {
    const locker = await harness.pool.connect();
    await locker.query("BEGIN");
    await locker.query(`
      SELECT amount_minor_units
      FROM exposure_aggregates
      WHERE aggregate_key = 'TOTAL'
      FOR UPDATE
    `);
    const transactions = new PostgresApprovedLoanTransaction(harness.pool, {
      lockTimeoutMs: 50,
      maxRetries: 2,
      retryDelayMs: 10,
    });
    let attempts = 0;
    let lockReleased = false;
    let markFirstAttemptStarted: (() => void) | undefined;
    const firstAttemptStarted = new Promise<void>((resolve) => {
      markFirstAttemptStarted = resolve;
    });

    try {
      const resultPromise = transactions.run(async (transaction) => {
        attempts += 1;
        markFirstAttemptStarted?.();
        return transaction.lockExposure("GO");
      });

      await firstAttemptStarted;
      await new Promise((resolve) => setTimeout(resolve, 80));
      await locker.query("COMMIT");
      lockReleased = true;

      await expect(resultPromise).resolves.toEqual({
        totalExposure: 0n,
        ufExposure: 0n,
      });
      expect(attempts).toBe(2);
    } finally {
      if (!lockReleased) {
        await locker.query("ROLLBACK");
      }
      locker.release();
    }
  });

  it("does not retry a non-transient PostgreSQL error", async () => {
    const transactions = new PostgresApprovedLoanTransaction(harness.pool);
    let attempts = 0;

    await expect(
      transactions.run(async () => {
        attempts += 1;
        throw postgresError("23505", "forced unique violation");
      }),
    ).rejects.toThrow("forced unique violation");
    expect(attempts).toBe(1);
  });
});

function postgresError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
