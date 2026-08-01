import {
  attachPersistedLoanId,
  createLoanDecisionResult,
  type PersistedApprovedLoanDecisionResult,
} from "../domain/loan-decision-result.js";
import type { LoanDecisionInput } from "../domain/loan-decision-input.js";
import { decideLoan } from "../domain/loan-decision.js";
import type { ApprovedLoanTransactionRunner } from "./approved-loan-transaction.js";

export class LoanNotApprovedForPersistenceError extends Error {
  constructor() {
    super("the loan was not approved for persistence");
    this.name = "LoanNotApprovedForPersistenceError";
  }
}

export class PersistApprovedLoan {
  constructor(private readonly transactions: ApprovedLoanTransactionRunner) {}

  async execute(
    input: LoanDecisionInput,
  ): Promise<PersistedApprovedLoanDecisionResult> {
    return this.transactions.run(async (transaction) => {
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
        throw new LoanNotApprovedForPersistenceError();
      }

      const loanId = await transaction.insertLoan(input, policy.version);
      await transaction.updateExposure(input.uf, {
        totalExposure: concentrationDecision.projectedTotalExposure,
        ufExposure: concentrationDecision.projectedUfExposure,
      });

      return attachPersistedLoanId(decisionResult, loanId);
    });
  }
}
