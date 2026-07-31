import {
  createLoanAmount,
  createUf,
  type LoanAmount,
  type Uf,
} from "./loan-decision-input.js";

export class InvalidConcentrationPolicyError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidConcentrationPolicyError";
  }
}

declare const percentageBasisPointsBrand: unique symbol;

export type PercentageBasisPoints = number & {
  readonly [percentageBasisPointsBrand]: true;
};

export interface ConcentrationPolicy {
  readonly version: string;
  readonly minimumPortfolioForPercentageRule: LoanAmount;
  limitFor(uf: Uf): PercentageBasisPoints;
}

export interface ConcentrationPolicyCandidate {
  readonly version?: unknown;
  readonly minimumPortfolioForPercentageRule?: unknown;
  readonly defaultLimitBasisPoints?: unknown;
  readonly stateLimitBasisPoints?: Readonly<Record<string, unknown>>;
}

function createPercentageBasisPoints(
  value: unknown,
  field: string,
): PercentageBasisPoints {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new InvalidConcentrationPolicyError(
      field,
      `${field} must be an integer between 0 and 10000`,
    );
  }

  return value as PercentageBasisPoints;
}

function createPolicyVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new InvalidConcentrationPolicyError(
      "version",
      "version must be a non-empty string without surrounding whitespace",
    );
  }

  return value;
}

function createMinimumPortfolio(value: unknown): LoanAmount {
  try {
    return createLoanAmount(value);
  } catch {
    throw new InvalidConcentrationPolicyError(
      "minimumPortfolioForPercentageRule",
      "minimumPortfolioForPercentageRule must be a positive integer in minor units",
    );
  }
}

function createPolicyUf(value: string): Uf {
  try {
    return createUf(value);
  } catch {
    throw new InvalidConcentrationPolicyError(
      `stateLimitBasisPoints.${value}`,
      `stateLimitBasisPoints.${value} must identify a Brazilian UF`,
    );
  }
}

export function createConcentrationPolicy(
  candidate: ConcentrationPolicyCandidate,
): ConcentrationPolicy {
  const version = createPolicyVersion(candidate.version);
  const minimumPortfolioForPercentageRule = createMinimumPortfolio(
    candidate.minimumPortfolioForPercentageRule,
  );
  const defaultLimit = createPercentageBasisPoints(
    candidate.defaultLimitBasisPoints,
    "defaultLimitBasisPoints",
  );
  const stateLimits = new Map<Uf, PercentageBasisPoints>();

  for (const [uf, limit] of Object.entries(
    candidate.stateLimitBasisPoints ?? {},
  )) {
    stateLimits.set(
      createPolicyUf(uf),
      createPercentageBasisPoints(limit, `stateLimitBasisPoints.${uf}`),
    );
  }

  return {
    version,
    minimumPortfolioForPercentageRule,
    limitFor: (uf) => stateLimits.get(uf) ?? defaultLimit,
  };
}

export const INITIAL_CONCENTRATION_POLICY = createConcentrationPolicy({
  version: "1",
  minimumPortfolioForPercentageRule: 10_000_000,
  defaultLimitBasisPoints: 1_000,
  stateLimitBasisPoints: { SP: 2_000 },
});
