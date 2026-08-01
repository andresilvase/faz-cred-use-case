import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createUf } from "../../domain/loan-decision-input.js";
import { PostgresExposureRepository } from "./postgres-exposure-repository.js";
import { runMigrations } from "./run-migrations.js";
import {
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "../../test-support/postgres-test-harness.js";

describe("PostgresExposureRepository", () => {
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

  it("locks an empty portfolio and creates the missing UF aggregate", async () => {
    const client = await harness.pool.connect();

    try {
      await client.query("BEGIN");
      const repository = new PostgresExposureRepository(client);

      const exposure = await repository.lockFor(createUf("GO"));

      expect(exposure).toEqual({ totalExposure: 0n, ufExposure: 0n });
      await client.query("COMMIT");
    } finally {
      client.release();
    }

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

    expect(aggregates.rows).toEqual([
      { aggregateKey: "GO", amount: "0" },
      { aggregateKey: "TOTAL", amount: "0" },
    ]);
  });

  it("reads and updates TOTAL and UF in the same transaction", async () => {
    const client = await harness.pool.connect();

    try {
      await client.query("BEGIN");
      const repository = new PostgresExposureRepository(client);
      await repository.lockFor(createUf("GO"));

      await repository.updateLocked(createUf("GO"), {
        totalExposure: 1_500n,
        ufExposure: 500n,
      });
      await client.query("COMMIT");

      await client.query("BEGIN");
      await expect(repository.lockFor(createUf("GO"))).resolves.toEqual({
        totalExposure: 1_500n,
        ufExposure: 500n,
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("rolls back aggregate creation and updates without residual changes", async () => {
    const client = await harness.pool.connect();

    try {
      await client.query("BEGIN");
      const repository = new PostgresExposureRepository(client);
      await repository.lockFor(createUf("SP"));
      await repository.updateLocked(createUf("SP"), {
        totalExposure: 2_000n,
        ufExposure: 2_000n,
      });

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

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

    expect(aggregates.rows).toEqual([
      { aggregateKey: "TOTAL", amount: "0" },
    ]);
  });

  it("acquires the TOTAL lock before any UF lock", async () => {
    const firstClient = await harness.pool.connect();
    const secondClient = await harness.pool.connect();

    try {
      await firstClient.query("BEGIN");
      await secondClient.query("BEGIN");
      await secondClient.query("SET LOCAL lock_timeout = '100ms'");
      const firstRepository = new PostgresExposureRepository(firstClient);
      const secondRepository = new PostgresExposureRepository(secondClient);
      await firstRepository.lockFor(createUf("GO"));

      await expect(
        secondRepository.lockFor(createUf("SP")),
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await firstClient.query("ROLLBACK");
      await secondClient.query("ROLLBACK");
      firstClient.release();
      secondClient.release();
    }
  });
});
