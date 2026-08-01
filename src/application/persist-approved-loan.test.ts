import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLoanDecisionInput } from "../domain/loan-decision-input.js";
import { PostgresApprovedLoanTransaction } from "../infrastructure/database/postgres-approved-loan-transaction.js";
import { runMigrations } from "../infrastructure/database/run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../test-support/postgres-test-harness.js";
import {
  IdempotencyConflictError,
  PersistApprovedLoan,
} from "./persist-approved-loan.js";

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

    const result = await useCase.execute(input, "create-approved-key");

    if (result.decision !== "APPROVED") {
      throw new Error("expected the loan to be approved");
    }

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

  it("replays an approved decision without duplicating its effects", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    const input = createLoanDecisionInput({
      borrowerId: "borrower-retry-approved",
      uf: "GO",
      amount: 500_000,
    });

    const original = await useCase.execute(input, "approval-key");
    const replay = await useCase.execute(input, "approval-key");

    if (original.decision !== "APPROVED") {
      throw new Error("expected the original decision to be approved");
    }

    expect(replay).toEqual(original);
    await expect(
      harness.pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM loans",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      harness.pool.query<{ amount: string }>(`
        SELECT amount_minor_units::text AS amount
        FROM exposure_aggregates
        WHERE aggregate_key = 'TOTAL'
      `),
    ).resolves.toMatchObject({ rows: [{ amount: "500000" }] });
    await expect(
      harness.pool.query<{
        decision: string;
        loanId: string;
        policyVersion: string;
        requestHash: string;
      }>(`
        SELECT
          decision,
          loan_id::text AS "loanId",
          policy_version AS "policyVersion",
          request_hash AS "requestHash"
        FROM idempotency_requests
      `),
    ).resolves.toMatchObject({
      rows: [
        {
          decision: "APPROVED",
          loanId: original.loanId,
          policyVersion: "1",
          requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ],
    });
  });

  it("replays a denied decision without creating a loan", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    const input = createLoanDecisionInput({
      borrowerId: "borrower-retry-denied",
      uf: "GO",
      amount: 1_000_001,
    });

    const original = await useCase.execute(input, "denial-key");
    const replay = await useCase.execute(input, "denial-key");

    expect(replay).toEqual(original);
    expect(replay.decision).toBe("DENIED");
    await expect(
      harness.pool.query<{ loanCount: number; requestCount: number }>(`
        SELECT
          (SELECT COUNT(*)::int FROM loans) AS "loanCount",
          (SELECT COUNT(*)::int FROM idempotency_requests) AS "requestCount"
      `),
    ).resolves.toMatchObject({
      rows: [{ loanCount: 0, requestCount: 1 }],
    });
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-conflict",
        uf: "GO",
        amount: 400_000,
      }),
      "reused-key",
    );

    await expect(
      useCase.execute(
        createLoanDecisionInput({
          borrowerId: "borrower-conflict",
          uf: "GO",
          amount: 300_000,
        }),
        "reused-key",
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      harness.pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM loans",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("processes distinct intentions when the same borrower uses different keys", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    const input = createLoanDecisionInput({
      borrowerId: "borrower-distinct-intentions",
      uf: "GO",
      amount: 400_000,
    });

    const first = await useCase.execute(input, "first-key");
    const second = await useCase.execute(input, "second-key");

    expect(first.decision).toBe("APPROVED");
    expect(second.decision).toBe("APPROVED");
    await expect(
      harness.pool.query<{ loanCount: number; requestCount: number }>(`
        SELECT
          (SELECT COUNT(*)::int FROM loans) AS "loanCount",
          (SELECT COUNT(*)::int FROM idempotency_requests) AS "requestCount"
      `),
    ).resolves.toMatchObject({
      rows: [{ loanCount: 2, requestCount: 2 }],
    });
  });

  it("scopes the same idempotency key independently for each borrower", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );

    const first = await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-key-scope-a",
        uf: "GO",
        amount: 400_000,
      }),
      "shared-key",
    );
    const second = await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-key-scope-b",
        uf: "GO",
        amount: 400_000,
      }),
      "shared-key",
    );

    expect(first.decision).toBe("APPROVED");
    expect(second.decision).toBe("APPROVED");
    await expect(
      harness.pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM idempotency_requests",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
  });

  it("returns a denied decision without creating a loan or changing prior exposure", async () => {
    const useCase = new PersistApprovedLoan(
      new PostgresApprovedLoanTransaction(harness.pool),
    );
    await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-approved",
        uf: "GO",
        amount: 1_000_000,
      }),
      "prior-approval-key",
    );

    const result = await useCase.execute(
      createLoanDecisionInput({
        borrowerId: "borrower-denied",
        uf: "GO",
        amount: 1,
      }),
      "denied-key",
    );

    expect(result).toEqual({
      decision: "DENIED",
      message: "O empréstimo foi negado.",
      policyVersion: "1",
    });
    await expect(
      harness.pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM loans",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      harness.pool.query<{ aggregateKey: string; amount: string }>(`
        SELECT
          aggregate_key AS "aggregateKey",
          amount_minor_units::text AS amount
        FROM exposure_aggregates
        ORDER BY aggregate_key
      `),
    ).resolves.toMatchObject({
      rows: [
        { aggregateKey: "GO", amount: "1000000" },
        { aggregateKey: "TOTAL", amount: "1000000" },
      ],
    });
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
      "future-policy-key",
    );

    expect(result.policyVersion).toBe("2");
    await expect(
      harness.pool.query<{ policyVersion: string }>(`
        SELECT policy_version AS "policyVersion" FROM loans
      `),
    ).resolves.toMatchObject({ rows: [{ policyVersion: "2" }] });
  });

  it("rolls back the loan, aggregates and idempotency when persisting the response fails", async () => {
    await harness.pool.query(`
      CREATE FUNCTION fail_idempotency_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced idempotency insert failure';
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER force_idempotency_insert_failure
      BEFORE INSERT ON idempotency_requests
      FOR EACH STATEMENT
      EXECUTE FUNCTION fail_idempotency_insert();
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
        "rollback-key",
      ),
    ).rejects.toThrow("forced idempotency insert failure");

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
    await expect(
      harness.pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM idempotency_requests",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    expect(aggregates.rows).toEqual([
      { aggregateKey: "TOTAL", amount: "0" },
    ]);
  });
});
