import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLoanDecisionInput } from "../domain/loan-decision-input.js";
import { PostgresApprovedLoanTransaction } from "../infrastructure/database/postgres-approved-loan-transaction.js";
import { runMigrations } from "../infrastructure/database/run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../test-support/postgres-test-harness.js";
import { PersistApprovedLoan } from "./persist-approved-loan.js";

describe("concurrent loan decisions", () => {
  let harness: PostgresTestHarness;
  let useCase: PersistApprovedLoan;

  beforeAll(async () => {
    harness = await startPostgresTestHarness();
  }, 60_000);

  beforeEach(async () => {
    await harness.reset();
    await runMigrations(harness.pool);
    useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("approves only the allowed request when two decisions target the same UF", async () => {
    const results = await Promise.all([
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-concurrent-go-a",
          uf: "GO",
          amount: 600_000,
        }),
        "concurrent-go-key-a",
      ),
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-concurrent-go-b",
          uf: "GO",
          amount: 600_000,
        }),
        "concurrent-go-key-b",
      ),
    ]);

    expect(results.map((result) => result.decision).sort()).toEqual([
      "APPROVED",
      "DENIED",
    ]);
    await expect(portfolioSnapshot(harness)).resolves.toEqual({
      loanCount: 1,
      officialTotal: "600000",
      aggregateTotal: "600000",
      aggregates: [
        { aggregateKey: "GO", amount: "600000" },
        { aggregateKey: "TOTAL", amount: "600000" },
      ],
    });
  });

  it("serializes different UFs through TOTAL without losing exposure", async () => {
    const results = await Promise.all([
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-concurrent-go",
          uf: "GO",
          amount: 400_000,
        }),
        "concurrent-total-key-go",
      ),
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-concurrent-ba",
          uf: "BA",
          amount: 400_000,
        }),
        "concurrent-total-key-ba",
      ),
    ]);

    expect(results.map((result) => result.decision)).toEqual([
      "APPROVED",
      "APPROVED",
    ]);
    await expect(portfolioSnapshot(harness)).resolves.toEqual({
      loanCount: 2,
      officialTotal: "800000",
      aggregateTotal: "800000",
      aggregates: [
        { aggregateKey: "BA", amount: "400000" },
        { aggregateKey: "GO", amount: "400000" },
        { aggregateKey: "TOTAL", amount: "800000" },
      ],
    });
  });
});

async function portfolioSnapshot(harness: PostgresTestHarness): Promise<{
  loanCount: number;
  officialTotal: string;
  aggregateTotal: string;
  aggregates: { aggregateKey: string; amount: string }[];
}> {
  const result = await harness.pool.query<{
    loanCount: number;
    officialTotal: string;
    aggregateTotal: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM loans) AS "loanCount",
      (SELECT COALESCE(SUM(amount_minor_units), 0)::text FROM loans)
        AS "officialTotal",
      (SELECT amount_minor_units::text FROM exposure_aggregates
        WHERE aggregate_key = 'TOTAL') AS "aggregateTotal"
  `);
  const aggregates = await harness.pool.query<{
    aggregateKey: string;
    amount: string;
  }>(`
    SELECT
      aggregate_key AS "aggregateKey",
      amount_minor_units::text AS amount
    FROM exposure_aggregates
    ORDER BY aggregate_key
  `);
  const snapshot = result.rows[0];

  if (snapshot === undefined) {
    throw new Error("portfolio snapshot was not returned");
  }

  return { ...snapshot, aggregates: aggregates.rows };
}
