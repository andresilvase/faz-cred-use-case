import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { Uf } from "../../domain/loan-decision-input.js";

export interface ExposureRebuildResult {
  readonly divergenceFound: boolean;
  readonly totalExposure: bigint;
  readonly ufExposures: Readonly<Partial<Record<Uf, bigint>>>;
}

interface ExposureRow extends QueryResultRow {
  readonly aggregateKey: string;
  readonly amount: string;
}

interface OfficialUfExposureRow extends QueryResultRow {
  readonly uf: Uf;
  readonly amount: string;
}

export class PostgresExposureRebuilder {
  constructor(private readonly pool: Pool) {}

  async rebuild(): Promise<ExposureRebuildResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "LOCK TABLE exposure_aggregates IN ACCESS EXCLUSIVE MODE",
      );
      await client.query("LOCK TABLE loans IN SHARE MODE");

      const storedExposures = await readStoredExposures(client);
      const officialExposures = await readOfficialExposures(client);
      const divergenceFound = !exposuresMatch(
        storedExposures,
        officialExposures,
      );

      await client.query("DELETE FROM exposure_aggregates");
      await client.query(`
        INSERT INTO exposure_aggregates (
          aggregate_key,
          amount_minor_units
        )
        SELECT uf, SUM(amount_minor_units)
        FROM loans
        GROUP BY uf
        UNION ALL
        SELECT 'TOTAL', COALESCE(SUM(amount_minor_units), 0)
        FROM loans
      `);
      await client.query("COMMIT");

      return toRebuildResult(divergenceFound, officialExposures);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function readStoredExposures(client: PoolClient): Promise<ExposureRow[]> {
  const result = await client.query<ExposureRow>(`
    SELECT
      aggregate_key AS "aggregateKey",
      amount_minor_units::text AS amount
    FROM exposure_aggregates
  `);

  return result.rows;
}

async function readOfficialExposures(
  client: PoolClient,
): Promise<OfficialUfExposureRow[]> {
  const result = await client.query<OfficialUfExposureRow>(`
    SELECT uf, SUM(amount_minor_units)::text AS amount
    FROM loans
    GROUP BY uf
  `);

  return result.rows;
}

function exposuresMatch(
  storedExposures: readonly ExposureRow[],
  officialExposures: readonly OfficialUfExposureRow[],
): boolean {
  const expected = new Map<string, bigint>([["TOTAL", 0n]]);

  for (const exposure of officialExposures) {
    const amount = BigInt(exposure.amount);
    expected.set(exposure.uf, amount);
    expected.set("TOTAL", (expected.get("TOTAL") ?? 0n) + amount);
  }

  if (storedExposures.length !== expected.size) {
    return false;
  }

  return storedExposures.every(
    (exposure) =>
      expected.get(exposure.aggregateKey) === BigInt(exposure.amount),
  );
}

function toRebuildResult(
  divergenceFound: boolean,
  officialExposures: readonly OfficialUfExposureRow[],
): ExposureRebuildResult {
  const ufExposures: Partial<Record<Uf, bigint>> = {};
  let totalExposure = 0n;

  for (const exposure of officialExposures) {
    const amount = BigInt(exposure.amount);
    ufExposures[exposure.uf] = amount;
    totalExposure += amount;
  }

  return { divergenceFound, totalExposure, ufExposures };
}
