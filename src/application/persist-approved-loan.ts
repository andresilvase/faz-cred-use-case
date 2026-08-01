import { createHash } from "node:crypto";

import {
  attachPersistedLoanId,
  createLoanDecisionResult,
  type CompletedLoanDecisionResult,
} from "../domain/loan-decision-result.js";
import type { LoanDecisionInput } from "../domain/loan-decision-input.js";
import { decideLoan } from "../domain/loan-decision.js";
import type { ApprovedLoanTransactionRunner } from "./approved-loan-transaction.js";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used with a different payload");
    this.name = "IdempotencyConflictError";
  }
}

export class PersistApprovedLoan {
  constructor(private readonly transactions: ApprovedLoanTransactionRunner) {}

  async execute(
    input: LoanDecisionInput,
    idempotencyKey: string,
  ): Promise<CompletedLoanDecisionResult> {
    const requestHash = hashLoanDecisionInput(input);

    return this.transactions.run(async (transaction) => {
      const existingRequest = await transaction.findIdempotencyRequest(
        input.borrowerId,
        idempotencyKey,
      );

      if (existingRequest !== undefined) {
        if (existingRequest.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }

        return existingRequest.result;
      }

      const exposure = await transaction.lockExposure(input.uf);
      const policy = await transaction.loadActivePolicy();
      const concentrationDecision = decideLoan({
        currentTotalExposure: exposure.totalExposure,
        currentUfExposure: exposure.ufExposure,
        requestedAmount: input.amount,
        uf: input.uf,
        policy,
      });
      const decisionResult = createLoanDecisionResult(
        concentrationDecision,
        policy.version,
      );

      if (decisionResult.decision !== "APPROVED") {
        await transaction.saveIdempotencyRequest({
          borrowerId: input.borrowerId,
          idempotencyKey,
          requestHash,
          result: decisionResult,
        });
        return decisionResult;
      }

      const loanId = await transaction.insertLoan(input, policy.version);
      await transaction.updateExposure(input.uf, {
        totalExposure: concentrationDecision.projectedTotalExposure,
        ufExposure: concentrationDecision.projectedUfExposure,
      });

      const persistedResult = attachPersistedLoanId(decisionResult, loanId);
      await transaction.saveIdempotencyRequest({
        borrowerId: input.borrowerId,
        idempotencyKey,
        requestHash,
        result: persistedResult,
      });

      return persistedResult;
    });
  }
}

function hashLoanDecisionInput(input: LoanDecisionInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        borrowerId: input.borrowerId,
        uf: input.uf,
        amount: input.amount.toString(),
      }),
    )
    .digest("hex");
}
