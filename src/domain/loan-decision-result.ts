import type { LoanConcentrationDecision } from "./loan-decision.js";

export interface EvaluatedApprovedLoanDecisionResult {
  readonly decision: "APPROVED";
  readonly message: "O valor solicitado foi aprovado.";
  readonly policyVersion: string;
}

export interface DeniedLoanDecisionResult {
  readonly decision: "DENIED";
  readonly message: "O empréstimo foi negado.";
  readonly policyVersion: string;
}

export type EvaluatedLoanDecisionResult =
  | EvaluatedApprovedLoanDecisionResult
  | DeniedLoanDecisionResult;

export interface PersistedApprovedLoanDecisionResult
  extends EvaluatedApprovedLoanDecisionResult {
  readonly loanId: string;
}

export type CompletedLoanDecisionResult =
  | PersistedApprovedLoanDecisionResult
  | DeniedLoanDecisionResult;

export type PublicLoanDecisionResult =
  | {
      readonly decision: "APPROVED";
      readonly message: "O valor solicitado foi aprovado.";
      readonly loan_id: string;
    }
  | {
      readonly decision: "DENIED";
      readonly message: "O empréstimo foi negado.";
    };

export function createLoanDecisionResult(
  concentrationDecision: LoanConcentrationDecision,
  policyVersion: string,
): EvaluatedLoanDecisionResult {
  if (!concentrationDecision.approved) {
    return {
      decision: "DENIED",
      message: "O empréstimo foi negado.",
      policyVersion,
    };
  }

  return {
    decision: "APPROVED",
    message: "O valor solicitado foi aprovado.",
    policyVersion,
  };
}

export function attachPersistedLoanId(
  result: EvaluatedApprovedLoanDecisionResult,
  loanId: string,
): PersistedApprovedLoanDecisionResult {
  return { ...result, loanId };
}

export function toPublicLoanDecisionResult(
  result: CompletedLoanDecisionResult,
): PublicLoanDecisionResult {
  if (result.decision === "DENIED") {
    return {
      decision: result.decision,
      message: result.message,
    };
  }

  return {
    decision: result.decision,
    message: result.message,
    loan_id: result.loanId,
  };
}
