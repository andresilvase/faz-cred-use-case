import type { ConcentrationPolicy } from "../domain/concentration-policy.js";
import type {
  LoanDecisionInput,
  Uf,
} from "../domain/loan-decision-input.js";

export interface ExposureSnapshot {
  readonly totalExposure: bigint;
  readonly ufExposure: bigint;
}

export interface ApprovedLoanTransaction {
  lockExposure(uf: Uf): Promise<ExposureSnapshot>;
  loadActivePolicy(): Promise<ConcentrationPolicy>;
  insertLoan(input: LoanDecisionInput, policyVersion: string): Promise<string>;
  updateExposure(uf: Uf, exposure: ExposureSnapshot): Promise<void>;
}

export interface ApprovedLoanTransactionRunner {
  run<T>(
    operation: (transaction: ApprovedLoanTransaction) => Promise<T>,
  ): Promise<T>;
}
