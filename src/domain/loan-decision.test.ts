import { describe, expect, it } from "vitest";

import {
  INITIAL_CONCENTRATION_POLICY,
  createConcentrationPolicy,
} from "./concentration-policy.js";
import { createLoanAmount, createUf } from "./loan-decision-input.js";
import {
  InvalidExposureSnapshotError,
  decideLoan,
} from "./loan-decision.js";

describe("decideLoan", () => {
  it("composes the existing bootstrap rule into the same decision service", () => {
    expect(
      decideLoan({
        currentTotalExposure: 0n,
        currentUfExposure: 0n,
        requestedAmount: createLoanAmount(2_000_000),
        uf: createUf("SP"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: true,
      appliedRule: "BOOTSTRAP",
      projectedTotalExposure: 2_000_000n,
      projectedUfExposure: 2_000_000n,
    });
  });

  it("applies the percentage rule when projected exposure reaches R$ 100,000 exactly", () => {
    expect(
      decideLoan({
        currentTotalExposure: 9_000_000n,
        currentUfExposure: 0n,
        requestedAmount: createLoanAmount(1_000_000),
        uf: createUf("GO"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: true,
      appliedRule: "PERCENTAGE",
      projectedTotalExposure: 10_000_000n,
      projectedUfExposure: 1_000_000n,
    });
  });

  it.each([
    ["below", 900_000n, true],
    ["exactly at", 1_000_000n, true],
    ["above", 1_000_001n, false],
  ])(
    "%s the initial default 10% concentration limit",
    (_scenario, currentUfExposure, approved) => {
      expect(
        decideLoan({
          currentTotalExposure: 19_000_000n,
          currentUfExposure,
          requestedAmount: createLoanAmount(1_000_000),
          uf: createUf("GO"),
          policy: INITIAL_CONCENTRATION_POLICY,
        }),
      ).toMatchObject({ approved, appliedRule: "PERCENTAGE" });
    },
  );

  it.each([
    ["exactly at", 3_000_000n, true],
    ["above", 3_000_001n, false],
  ])(
    "%s the initial SP-specific 20% concentration limit",
    (_scenario, currentUfExposure, approved) => {
      expect(
        decideLoan({
          currentTotalExposure: 19_000_000n,
          currentUfExposure,
          requestedAmount: createLoanAmount(1_000_000),
          uf: createUf("SP"),
          policy: INITIAL_CONCENTRATION_POLICY,
        }),
      ).toMatchObject({ approved, appliedRule: "PERCENTAGE" });
    },
  );

  it("uses a future policy's percentages without changing decision logic", () => {
    const futurePolicy = createConcentrationPolicy({
      version: "future-policy",
      minimumPortfolioForPercentageRule: 10_000_000,
      defaultLimitBasisPoints: 2_500,
      stateLimitBasisPoints: { SP: 3_000 },
    });

    expect(
      decideLoan({
        currentTotalExposure: 19_000_000n,
        currentUfExposure: 4_000_000n,
        requestedAmount: createLoanAmount(1_000_000),
        uf: createUf("GO"),
        policy: futurePolicy,
      }).approved,
    ).toBe(true);
  });

  it("keeps percentage arithmetic exact beyond Number.MAX_SAFE_INTEGER", () => {
    const hugeExposure = 10n ** 100n;

    expect(
      decideLoan({
        currentTotalExposure: hugeExposure * 10n,
        currentUfExposure: hugeExposure,
        requestedAmount: createLoanAmount(1),
        uf: createUf("GO"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: false,
      appliedRule: "PERCENTAGE",
      projectedTotalExposure: hugeExposure * 10n + 1n,
      projectedUfExposure: hugeExposure + 1n,
    });
  });

  it.each([
    ["negative total exposure", -1n, 0n],
    ["negative UF exposure", 0n, -1n],
    ["UF exposure above total exposure", 1n, 2n],
  ])("rejects an invalid snapshot with %s", (_scenario, total, uf) => {
    expect(() =>
      decideLoan({
        currentTotalExposure: total,
        currentUfExposure: uf,
        requestedAmount: createLoanAmount(1),
        uf: createUf("GO"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toThrow(InvalidExposureSnapshotError);
  });
});
