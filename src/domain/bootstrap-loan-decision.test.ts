import { describe, expect, it } from "vitest";

import {
  INITIAL_CONCENTRATION_POLICY,
  createConcentrationPolicy,
} from "./concentration-policy.js";
import { createLoanAmount, createUf } from "./loan-decision-input.js";
import { decideDuringBootstrap } from "./bootstrap-loan-decision.js";

describe("decideDuringBootstrap", () => {
  it("approves SP at the initial policy bootstrap limit of R$ 20,000", () => {
    expect(
      decideDuringBootstrap({
        currentTotalExposure: 0n,
        currentUfExposure: 0n,
        requestedAmount: createLoanAmount(2_000_000),
        uf: createUf("SP"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: true,
      projectedTotalExposure: 2_000_000n,
      projectedUfExposure: 2_000_000n,
      bootstrapUfLimit: 2_000_000n,
    });
  });

  it("denies SP above the initial policy bootstrap limit of R$ 20,000", () => {
    expect(
      decideDuringBootstrap({
        currentTotalExposure: 2_000_000n,
        currentUfExposure: 2_000_000n,
        requestedAmount: createLoanAmount(1),
        uf: createUf("SP"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: false,
      projectedTotalExposure: 2_000_001n,
      projectedUfExposure: 2_000_001n,
      bootstrapUfLimit: 2_000_000n,
    });
  });

  it("approves another UF at the initial policy bootstrap limit of R$ 10,000", () => {
    expect(
      decideDuringBootstrap({
        currentTotalExposure: 4_000_000n,
        currentUfExposure: 500_000n,
        requestedAmount: createLoanAmount(500_000),
        uf: createUf("GO"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toEqual({
      approved: true,
      projectedTotalExposure: 4_500_000n,
      projectedUfExposure: 1_000_000n,
      bootstrapUfLimit: 1_000_000n,
    });
  });

  it("denies another UF above the initial policy bootstrap limit of R$ 10,000", () => {
    expect(
      decideDuringBootstrap({
        currentTotalExposure: 4_000_000n,
        currentUfExposure: 1_000_000n,
        requestedAmount: createLoanAmount(1),
        uf: createUf("GO"),
        policy: INITIAL_CONCENTRATION_POLICY,
      })?.approved,
    ).toBe(false);
  });

  it("derives the absolute limit from percentages supplied by another policy", () => {
    const policy = createConcentrationPolicy({
      version: "future-policy",
      minimumPortfolioForPercentageRule: 20_000_000,
      defaultLimitBasisPoints: 2_500,
      stateLimitBasisPoints: { SP: 3_000 },
    });

    expect(
      decideDuringBootstrap({
        currentTotalExposure: 8_000_000n,
        currentUfExposure: 4_000_000n,
        requestedAmount: createLoanAmount(1_000_000),
        uf: createUf("GO"),
        policy,
      }),
    ).toEqual({
      approved: true,
      projectedTotalExposure: 9_000_000n,
      projectedUfExposure: 5_000_000n,
      bootstrapUfLimit: 5_000_000n,
    });
  });

  it("does not apply bootstrap when the request makes the projected total reach the threshold", () => {
    expect(
      decideDuringBootstrap({
        currentTotalExposure: 9_000_000n,
        currentUfExposure: 0n,
        requestedAmount: createLoanAmount(1_000_000),
        uf: createUf("SP"),
        policy: INITIAL_CONCENTRATION_POLICY,
      }),
    ).toBeNull();
  });
});
