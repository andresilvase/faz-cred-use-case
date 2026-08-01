import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  InvalidConcentrationPolicyError,
  createConcentrationPolicy,
  type ConcentrationPolicy,
} from "../../domain/concentration-policy.js";

export class ActiveConcentrationPolicyNotFoundError extends Error {
  constructor() {
    super("no active concentration policy was found");
    this.name = "ActiveConcentrationPolicyNotFoundError";
  }
}

export class InvalidStoredConcentrationPolicyError extends Error {
  constructor(cause: unknown) {
    super("the active concentration policy stored in PostgreSQL is invalid", {
      cause,
    });
    this.name = "InvalidStoredConcentrationPolicyError";
  }
}

interface StoredPolicyRow extends QueryResultRow {
  readonly version: string;
  readonly minimumPortfolioForPercentageRule: string;
  readonly defaultLimitBasisPoints: number;
  readonly uf: string | null;
  readonly stateLimitBasisPoints: number | null;
}

export class PostgresConcentrationPolicyRepository {
  constructor(private readonly database: Pool | PoolClient) {}

  async loadActive(): Promise<ConcentrationPolicy> {
    const result = await this.database.query<StoredPolicyRow>(`
      SELECT
        policy.version,
        policy.minimum_portfolio_for_percentage_rule::text
          AS "minimumPortfolioForPercentageRule",
        policy.default_limit_basis_points AS "defaultLimitBasisPoints",
        state_limit.uf,
        state_limit.limit_basis_points AS "stateLimitBasisPoints"
      FROM state_policies AS policy
      LEFT JOIN state_policy_limits AS state_limit
        ON state_limit.policy_version = policy.version
      WHERE policy.is_active
      ORDER BY state_limit.uf
    `);

    const firstRow = result.rows[0];

    if (firstRow === undefined) {
      throw new ActiveConcentrationPolicyNotFoundError();
    }

    const stateLimitBasisPoints: Record<string, unknown> = {};

    for (const row of result.rows) {
      if (row.uf !== null) {
        stateLimitBasisPoints[row.uf] = row.stateLimitBasisPoints;
      }
    }

    try {
      return createConcentrationPolicy({
        version: firstRow.version,
        minimumPortfolioForPercentageRule: Number(
          firstRow.minimumPortfolioForPercentageRule,
        ),
        defaultLimitBasisPoints: firstRow.defaultLimitBasisPoints,
        stateLimitBasisPoints,
      });
    } catch (error) {
      if (error instanceof InvalidConcentrationPolicyError) {
        throw new InvalidStoredConcentrationPolicyError(error);
      }

      throw error;
    }
  }
}
