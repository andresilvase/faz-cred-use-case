import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLoanDecisionInput } from "../domain/loan-decision-input.js";
import { PostgresApprovedLoanTransaction } from "../infrastructure/database/postgres-approved-loan-transaction.js";
import { runMigrations } from "../infrastructure/database/run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../test-support/postgres-test-harness.js";
import { PersistApprovedLoan } from "./persist-approved-loan.js";

describe("PersistApprovedLoan", () => {
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

  it("creates one approved loan and updates matching exposures atomically", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    const input = createLoanDecisionInput({
      borrowerId: "borrower-123",
      uf: "GO",
      amount: 1_000_000,
    });

    const result = await useCase.execute(input);

    expect(result).toMatchObject({
      decision: "APPROVED",
      message: "O valor solicitado foi aprovado.",
      policyVersion: "1",
    });
    expect(result.loanId).toEqual(expect.any(String));

    const loans = await harness.pool.query<{
      id: string;
      borrowerId: string;
      uf: string;
      amount: string;
      policyVersion: string;
    }>(`
      SELECT
        id::text,
        borrower_id AS "borrowerId",
        uf,
        amount_minor_units::text AS amount,
        policy_version AS "policyVersion"
      FROM loans
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

    expect(loans.rows).toEqual([
      {
        id: result.loanId,
        borrowerId: "borrower-123",
        uf: "GO",
        amount: "1000000",
        policyVersion: "1",
      },
    ]);
    expect(aggregates.rows).toEqual([
      { aggregateKey: "GO", amount: "1000000" },
      { aggregateKey: "TOTAL", amount: "1000000" },
    ]);
  });

  it("reads a new active policy inside the transaction and persists its version", async () => {
    await harness.pool.query(`
      BEGIN;
      UPDATE state_policies SET is_active = false WHERE version = '1';
      INSERT INTO state_policies (
        version,
        minimum_portfolio_for_percentage_rule,
        default_limit_basis_points,
        is_active
      ) VALUES ('2', 10000000, 2500, true);
      COMMIT;
    `);
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );

    const result = await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-future-policy",
        uf: "GO",
        amount: 2_000_000,
      }),
    );

    expect(result.policyVersion).toBe("2");
    await expect(
      harness.pool.query<{ policyVersion: string }>(`
        SELECT policy_version AS "policyVersion" FROM loans
      `),
    ).resolves.toMatchObject({ rows: [{ policyVersion: "2" }] });
  });

  it("rolls back the loan and aggregates when updating exposure fails after insert", async () => {
    await harness.pool.query(`
      CREATE FUNCTION fail_exposure_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced exposure update failure';
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER force_exposure_update_failure
      BEFORE UPDATE ON exposure_aggregates
      FOR EACH STATEMENT
      EXECUTE FUNCTION fail_exposure_update();
    `);
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );

    await expect(
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-rollback",
          uf: "GO",
          amount: 1_000_000,
        }),
      ),
    ).rejects.toThrow("forced exposure update failure");

    const loans = await harness.pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM loans",
    );
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

    expect(loans.rows).toEqual([{ count: 0 }]);
    expect(aggregates.rows).toEqual([
      { aggregateKey: "TOTAL", amount: "0" },
    ]);
  });
});
