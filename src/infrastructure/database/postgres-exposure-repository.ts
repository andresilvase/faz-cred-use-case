import type { PoolClient, QueryResultRow } from "pg";

import type { Uf } from "../../domain/loan-decision-input.js";

export class ExposureAggregateNotFoundError extends Error {
  constructor(aggregateKey: string) {
    super(`exposure aggregate ${aggregateKey} was not found`);
    this.name = "ExposureAggregateNotFoundError";
  }
}

export interface ExposureSnapshot {
  readonly totalExposure: bigint;
  readonly ufExposure: bigint;
}

interface ExposureRow extends QueryResultRow {
  readonly amount: string;
}

export class PostgresExposureRepository {
  constructor(private readonly client: PoolClient) {}

  async lockFor(uf: Uf): Promise<ExposureSnapshot> {
    const totalExposure = await this.lockAggregate("TOTAL");

    await this.client.query(
      `
        INSERT INTO exposure_aggregates (aggregate_key)
        VALUES ($1)
        ON CONFLICT (aggregate_key) DO NOTHING
      `,
      [uf],
    );

    const ufExposure = await this.lockAggregate(uf);

    return { totalExposure, ufExposure };
  }

  async updateLocked(uf: Uf, exposure: ExposureSnapshot): Promise<void> {
    const result = await this.client.query(
      `
        UPDATE exposure_aggregates
        SET
          amount_minor_units = CASE aggregate_key
            WHEN 'TOTAL' THEN $2::bigint
            ELSE $3::bigint
          END,
          updated_at = now()
        WHERE aggregate_key IN ('TOTAL', $1)
      `,
      [uf, exposure.totalExposure.toString(), exposure.ufExposure.toString()],
    );

    if (result.rowCount !== 2) {
      throw new ExposureAggregateNotFoundError(`TOTAL/${uf}`);
    }
  }

  private async lockAggregate(aggregateKey: string): Promise<bigint> {
    const result = await this.client.query<ExposureRow>(
      `
        SELECT amount_minor_units::text AS amount
        FROM exposure_aggregates
        WHERE aggregate_key = $1
        FOR UPDATE
      `,
      [aggregateKey],
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new ExposureAggregateNotFoundError(aggregateKey);
    }

    return BigInt(row.amount);
  }
}
