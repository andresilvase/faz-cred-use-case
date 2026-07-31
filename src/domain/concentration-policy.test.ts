import { describe, expect, it } from "vitest";

import { createUf } from "./loan-decision-input.js";
import {
  INITIAL_CONCENTRATION_POLICY,
  InvalidConcentrationPolicyError,
  createConcentrationPolicy,
} from "./concentration-policy.js";

describe("INITIAL_CONCENTRATION_POLICY", () => {
  it("uses its specific 20% limit for SP", () => {
    expect(INITIAL_CONCENTRATION_POLICY.limitFor(createUf("SP"))).toBe(
      2_000,
    );
  });

  it("falls back to its default 10% limit for another UF", () => {
    expect(INITIAL_CONCENTRATION_POLICY.limitFor(createUf("GO"))).toBe(
      1_000,
    );
  });

  it("carries version 1 and the R$ 100,000 bootstrap threshold", () => {
    expect(INITIAL_CONCENTRATION_POLICY.version).toBe("1");
    expect(
      INITIAL_CONCENTRATION_POLICY.minimumPortfolioForPercentageRule,
    ).toBe(10_000_000n);
  });
});

describe("createConcentrationPolicy", () => {
  it("changes resolved limits when another version supplies percentages", () => {
    const policy = createConcentrationPolicy({
      version: "future-policy",
      minimumPortfolioForPercentageRule: 20_000_000,
      defaultLimitBasisPoints: 2_500,
      stateLimitBasisPoints: { SP: 3_000 },
    });

    expect(policy.version).toBe("future-policy");
    expect(policy.limitFor(createUf("GO"))).toBe(2_500);
    expect(policy.limitFor(createUf("SP"))).toBe(3_000);
  });

  it("rejects a policy without a default percentage limit", () => {
    expect(() =>
      createConcentrationPolicy({
        version: "invalid-policy",
        minimumPortfolioForPercentageRule: 10_000_000,
      }),
    ).toThrow(
      new InvalidConcentrationPolicyError(
        "defaultLimitBasisPoints",
        "defaultLimitBasisPoints must be an integer between 0 and 10000",
      ),
    );
  });

  it.each([-1, 10_001, 10.5])(
    "rejects the out-of-range default percentage %s basis points",
    (defaultLimitBasisPoints) => {
      expect(() =>
        createConcentrationPolicy({
          version: "invalid-policy",
          minimumPortfolioForPercentageRule: 10_000_000,
          defaultLimitBasisPoints,
        }),
      ).toThrow(InvalidConcentrationPolicyError);
    },
  );

  it("rejects an out-of-range state-specific percentage", () => {
    expect(() =>
      createConcentrationPolicy({
        version: "invalid-policy",
        minimumPortfolioForPercentageRule: 10_000_000,
        defaultLimitBasisPoints: 1_000,
        stateLimitBasisPoints: { SP: 10_001 },
      }),
    ).toThrow(
      new InvalidConcentrationPolicyError(
        "stateLimitBasisPoints.SP",
        "stateLimitBasisPoints.SP must be an integer between 0 and 10000",
      ),
    );
  });

  it("accepts percentage boundaries from 0% through 100%", () => {
    const policy = createConcentrationPolicy({
      version: "boundary-policy",
      minimumPortfolioForPercentageRule: 10_000_000,
      defaultLimitBasisPoints: 0,
      stateLimitBasisPoints: { SP: 10_000 },
    });

    expect(policy.limitFor(createUf("GO"))).toBe(0);
    expect(policy.limitFor(createUf("SP"))).toBe(10_000);
  });

  it("rejects a policy without a version", () => {
    expect(() =>
      createConcentrationPolicy({
        minimumPortfolioForPercentageRule: 10_000_000,
        defaultLimitBasisPoints: 1_000,
      }),
    ).toThrow(
      new InvalidConcentrationPolicyError(
        "version",
        "version must be a non-empty string without surrounding whitespace",
      ),
    );
  });

  it("reports an invalid bootstrap threshold as an invalid policy", () => {
    expect(() =>
      createConcentrationPolicy({
        version: "invalid-policy",
        minimumPortfolioForPercentageRule: 0,
        defaultLimitBasisPoints: 1_000,
      }),
    ).toThrow(
      new InvalidConcentrationPolicyError(
        "minimumPortfolioForPercentageRule",
        "minimumPortfolioForPercentageRule must be a positive integer in minor units",
      ),
    );
  });

  it("reports an invalid state code as an invalid policy", () => {
    expect(() =>
      createConcentrationPolicy({
        version: "invalid-policy",
        minimumPortfolioForPercentageRule: 10_000_000,
        defaultLimitBasisPoints: 1_000,
        stateLimitBasisPoints: { XX: 2_000 },
      }),
    ).toThrow(
      new InvalidConcentrationPolicyError(
        "stateLimitBasisPoints.XX",
        "stateLimitBasisPoints.XX must identify a Brazilian UF",
      ),
    );
  });
});
