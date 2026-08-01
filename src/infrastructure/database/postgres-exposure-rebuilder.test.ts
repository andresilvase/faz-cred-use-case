import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PersistApprovedLoan } from "../../application/persist-approved-loan.js";
import { createLoanDecisionInput } from "../../domain/loan-decision-input.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../../test-support/postgres-test-harness.js";
import { PostgresApprovedLoanTransaction } from "./postgres-approved-loan-transaction.js";
import { PostgresExposureRebuilder } from "./postgres-exposure-rebuilder.js";
import { runMigrations } from "./run-migrations.js";

describe("PostgresExposureRebuilder", () => {
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

  it("rebuilds an empty portfolio with only the zero TOTAL aggregate", async () => {
    const rebuilder = new PostgresExposureRebuilder(harness.pool);

    const result = await rebuilder.rebuild();

    expect(result).toEqual({
      divergenceFound: false,
      totalExposure: 0n,
      ufExposures: {},
    });
    await expect(readAggregates(harness)).resolves.toEqual([
      { aggregateKey: "TOTAL", amount: "0" },
    ]);
  });

  it("reproduces aggregates for multiple UFs from the official loans", async () => {
    await createApprovedLoans(harness);
    const rebuilder = new PostgresExposureRebuilder(harness.pool);

    const result = await rebuilder.rebuild();

    expect(result).toEqual({
      divergenceFound: false,
      totalExposure: 1_200_000n,
      ufExposures: {
        BA: 300_000n,
        GO: 400_000n,
        SP: 500_000n,
      },
    });
    await expect(readAggregates(harness)).resolves.toEqual([
      { aggregateKey: "BA", amount: "300000" },
      { aggregateKey: "GO", amount: "400000" },
      { aggregateKey: "SP", amount: "500000" },
      { aggregateKey: "TOTAL", amount: "1200000" },
    ]);
    await expect(readOfficialTotal(harness)).resolves.toBe("1200000");
  });

  it("detects and corrects divergent aggregates from loans", async () => {
    await createApprovedLoans(harness);
    await harness.pool.query(`
      UPDATE exposure_aggregates
      SET amount_minor_units = CASE aggregate_key
        WHEN 'TOTAL' THEN 999999
        WHEN 'GO' THEN 1
        ELSE amount_minor_units
      END;
      INSERT INTO exposure_aggregates (aggregate_key, amount_minor_units)
      VALUES ('RJ', 123);
    `);
    const rebuilder = new PostgresExposureRebuilder(harness.pool);

    const result = await rebuilder.rebuild();

    expect(result.divergenceFound).toBe(true);
    expect(result.totalExposure).toBe(1_200_000n);
    await expect(readAggregates(harness)).resolves.toEqual([
      { aggregateKey: "BA", amount: "300000" },
      { aggregateKey: "GO", amount: "400000" },
      { aggregateKey: "SP", amount: "500000" },
      { aggregateKey: "TOTAL", amount: "1200000" },
    ]);
    await expect(readOfficialTotal(harness)).resolves.toBe("1200000");
  });

  it("reproduces a non-empty portfolio after all aggregates are discarded", async () => {
    await createApprovedLoans(harness);
    await harness.pool.query("DELETE FROM exposure_aggregates");
    const rebuilder = new PostgresExposureRebuilder(harness.pool);

    const result = await rebuilder.rebuild();

    expect(result.divergenceFound).toBe(true);
    await expect(readAggregates(harness)).resolves.toEqual([
      { aggregateKey: "BA", amount: "300000" },
      { aggregateKey: "GO", amount: "400000" },
      { aggregateKey: "SP", amount: "500000" },
      { aggregateKey: "TOTAL", amount: "1200000" },
    ]);
  });
});

async function createApprovedLoans(harness: PostgresTestHarness): Promise<void> {
  const useCase = new PersistApprovedLoan(
    new PostgresApprovedLoanTransaction(harness.pool),
  );

  await useCase.execute(
    createLoanDecisionInput({
      borrowerId: "rebuilder-borrower-go",
      uf: "GO",
      amount: 400_000,
    }),
    "rebuilder-key-go",
  );
  await useCase.execute(
    createLoanDecisionInput({
      borrowerId: "rebuilder-borrower-ba",
      uf: "BA",
      amount: 300_000,
    }),
    "rebuilder-key-ba",
  );
  await useCase.execute(
    createLoanDecisionInput({
      borrowerId: "rebuilder-borrower-sp",
      uf: "SP",
      amount: 500_000,
    }),
    "rebuilder-key-sp",
  );
}

async function readAggregates(harness: PostgresTestHarness) {
  const result = await harness.pool.query<{
    aggregateKey: string;
    amount: string;
  }>(`
    SELECT
      aggregate_key AS "aggregateKey",
      amount_minor_units::text AS amount
    FROM exposure_aggregates
    ORDER BY aggregate_key
  `);

  return result.rows;
}

async function readOfficialTotal(
  harness: PostgresTestHarness,
): Promise<string> {
  const result = await harness.pool.query<{ amount: string }>(`
    SELECT COALESCE(SUM(amount_minor_units), 0)::text AS amount
    FROM loans
  `);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error("official total was not returned");
  }

  return row.amount;
}
