import type { ConcentrationPolicy } from "./concentration-policy.js";
import type { LoanAmount, Uf } from "./loan-decision-input.js";

const BASIS_POINTS_PER_WHOLE = 10_000n;

export interface BootstrapLoanDecisionInput {
  readonly currentTotalExposure: bigint;
  readonly currentUfExposure: bigint;
  readonly requestedAmount: LoanAmount;
  readonly uf: Uf;
  readonly policy: ConcentrationPolicy;
}

export interface BootstrapLoanDecision {
  readonly approved: boolean;
  readonly projectedTotalExposure: bigint;
  readonly projectedUfExposure: bigint;
  readonly bootstrapUfLimit: bigint;
}

export function decideDuringBootstrap({
  currentTotalExposure,
  currentUfExposure,
  requestedAmount,
  uf,
  policy,
}: BootstrapLoanDecisionInput): BootstrapLoanDecision | null {
  const projectedTotalExposure = currentTotalExposure + requestedAmount;

  if (
    projectedTotalExposure >= policy.minimumPortfolioForPercentageRule
  ) {
    return null;
  }

  const projectedUfExposure = currentUfExposure + requestedAmount;
  const bootstrapUfLimit =
    (policy.minimumPortfolioForPercentageRule * BigInt(policy.limitFor(uf))) /
    BASIS_POINTS_PER_WHOLE;

  return {
    approved: projectedUfExposure <= bootstrapUfLimit,
    projectedTotalExposure,
    projectedUfExposure,
    bootstrapUfLimit,
  };
}
