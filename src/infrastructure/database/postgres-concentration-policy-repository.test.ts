import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createUf } from "../../domain/loan-decision-input.js";
import {
  ActiveConcentrationPolicyNotFoundError,
  InvalidStoredConcentrationPolicyError,
  PostgresConcentrationPolicyRepository,
} from "./postgres-concentration-policy-repository.js";
import { runMigrations } from "./run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../../test-support/postgres-test-harness.js";

describe("PostgresConcentrationPolicyRepository", () => {
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

  it("loads the seeded initial active policy", async () => {
    const repository = new PostgresConcentrationPolicyRepository(harness.pool);

    const policy = await repository.loadActive();

    expect(policy.version).toBe("1");
    expect(policy.minimumPortfolioForPercentageRule).toBe(10_000_000n);
    expect(policy.limitFor(createUf("GO"))).toBe(1_000);
    expect(policy.limitFor(createUf("SP"))).toBe(2_000);
  });

  it("loads a new active version with its default and state-specific limits", async () => {
    await harness.pool.query(`
      BEGIN;
      UPDATE state_policies SET is_active = false WHERE version = '1';
      INSERT INTO state_policies (
        version,
        minimum_portfolio_for_percentage_rule,
        default_limit_basis_points,
        is_active
      ) VALUES ('2', 20000000, 2500, true);
      INSERT INTO state_policy_limits (
        policy_version,
        uf,
        limit_basis_points
      ) VALUES ('2', 'SP', 3000);
      COMMIT;
    `);
    const repository = new PostgresConcentrationPolicyRepository(harness.pool);

    const policy = await repository.loadActive();

    expect(policy.version).toBe("2");
    expect(policy.minimumPortfolioForPercentageRule).toBe(20_000_000n);
    expect(policy.limitFor(createUf("GO"))).toBe(2_500);
    expect(policy.limitFor(createUf("SP"))).toBe(3_000);
  });

  it("reports explicitly when no active policy exists", async () => {
    await harness.pool.query("UPDATE state_policies SET is_active = false");
    const repository = new PostgresConcentrationPolicyRepository(harness.pool);

    await expect(repository.loadActive()).rejects.toThrow(
      new ActiveConcentrationPolicyNotFoundError(),
    );
  });

  it("reports explicitly when stored policy data cannot form a domain policy", async () => {
    await harness.pool.query(`
      ALTER TABLE state_policies
        DROP CONSTRAINT state_policies_minimum_portfolio_valid;
      UPDATE state_policies
        SET minimum_portfolio_for_percentage_rule = 0
        WHERE is_active;
    `);
    const repository = new PostgresConcentrationPolicyRepository(harness.pool);

    await expect(repository.loadActive()).rejects.toThrow(
      InvalidStoredConcentrationPolicyError,
    );
  });

  it("prevents more than one policy from being active", async () => {
    await expect(
      harness.pool.query(`
        INSERT INTO state_policies (
          version,
          minimum_portfolio_for_percentage_rule,
          default_limit_basis_points,
          is_active
        ) VALUES ('2', 20000000, 2500, true)
      `),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects invalid persisted percentages", async () => {
    await expect(
      harness.pool.query(`
        INSERT INTO state_policy_limits (
          policy_version,
          uf,
          limit_basis_points
        ) VALUES ('1', 'GO', 10001)
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
