import type { ConcentrationPolicy } from "../domain/concentration-policy.js";
import type { CompletedLoanDecisionResult } from "../domain/loan-decision-result.js";
import type {
  BorrowerId,
  LoanDecisionInput,
  Uf,
} from "../domain/loan-decision-input.js";

export interface ExposureSnapshot {
  readonly totalExposure: bigint;
  readonly ufExposure: bigint;
}

export interface ApprovedLoanTransaction {
  findIdempotencyRequest(
    borrowerId: BorrowerId,
    idempotencyKey: string,
  ): Promise<IdempotencyRequest | undefined>;
  lockExposure(uf: Uf): Promise<ExposureSnapshot>;
  loadActivePolicy(): Promise<ConcentrationPolicy>;
  insertLoan(input: LoanDecisionInput, policyVersion: string): Promise<string>;
  updateExposure(uf: Uf, exposure: ExposureSnapshot): Promise<void>;
  saveIdempotencyRequest(request: IdempotencyRequest): Promise<void>;
}

export interface IdempotencyRequest {
  readonly borrowerId: BorrowerId;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly result: CompletedLoanDecisionResult;
}

export interface ApprovedLoanTransactionRunner {
  run<T>(
    operation: (transaction: ApprovedLoanTransaction) => Promise<T>,
  ): Promise<T>;
}
