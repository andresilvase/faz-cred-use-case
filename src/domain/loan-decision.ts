import {
  decideDuringBootstrap,
  type BootstrapLoanDecisionInput,
} from "./bootstrap-loan-decision.js";

const BASIS_POINTS_PER_WHOLE = 10_000n;

export class InvalidExposureSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExposureSnapshotError";
  }
}

export type AppliedConcentrationRule = "BOOTSTRAP" | "PERCENTAGE";

export interface LoanConcentrationDecision {
  readonly approved: boolean;
  readonly appliedRule: AppliedConcentrationRule;
  readonly projectedTotalExposure: bigint;
  readonly projectedUfExposure: bigint;
}

export function decideLoan(
  input: BootstrapLoanDecisionInput,
): LoanConcentrationDecision {
  if (
    input.currentTotalExposure < 0n ||
    input.currentUfExposure < 0n ||
    input.currentUfExposure > input.currentTotalExposure
  ) {
    throw new InvalidExposureSnapshotError(
      "exposures must be non-negative and UF exposure cannot exceed total exposure",
    );
  }

  const bootstrapDecision = decideDuringBootstrap(input);

  if (bootstrapDecision !== null) {
    return {
      approved: bootstrapDecision.approved,
      appliedRule: "BOOTSTRAP",
      projectedTotalExposure: bootstrapDecision.projectedTotalExposure,
      projectedUfExposure: bootstrapDecision.projectedUfExposure,
    };
  }

  const projectedTotalExposure =
    input.currentTotalExposure + input.requestedAmount;
  const projectedUfExposure = input.currentUfExposure + input.requestedAmount;
  const applicableLimit = BigInt(input.policy.limitFor(input.uf));

  return {
    approved:
      projectedUfExposure * BASIS_POINTS_PER_WHOLE <=
      projectedTotalExposure * applicableLimit,
    appliedRule: "PERCENTAGE",
    projectedTotalExposure,
    projectedUfExposure,
  };
}
