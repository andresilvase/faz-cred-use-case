import { describe, expect, it } from "vitest";

import type { LoanConcentrationDecision } from "./loan-decision.js";
import {
  attachPersistedLoanId,
  createLoanDecisionResult,
  toPublicLoanDecisionResult,
} from "./loan-decision-result.js";

const approvedConcentrationDecision: LoanConcentrationDecision = {
  approved: true,
  appliedRule: "BOOTSTRAP",
  projectedTotalExposure: 1_000_000n,
  projectedUfExposure: 1_000_000n,
};

const deniedConcentrationDecision: LoanConcentrationDecision = {
  ...approvedConcentrationDecision,
  approved: false,
};

describe("createLoanDecisionResult", () => {
  it("creates an internal approval with the exact message and policy version", () => {
    expect(
      createLoanDecisionResult(
        approvedConcentrationDecision,
        "policy-version-1",
      ),
    ).toEqual({
      decision: "APPROVED",
      message: "O valor solicitado foi aprovado.",
      policyVersion: "policy-version-1",
    });
  });

  it("creates a denial with the exact message and no loan identifier", () => {
    const result = createLoanDecisionResult(
      deniedConcentrationDecision,
      "policy-version-2",
    );

    expect(result).toEqual({
      decision: "DENIED",
      message: "O empréstimo foi negado.",
      policyVersion: "policy-version-2",
    });
    expect(result).not.toHaveProperty("loanId");
  });
});

describe("completed loan decision result", () => {
  it("includes loan_id publicly only after an approval is persisted", () => {
    const evaluated = createLoanDecisionResult(
      approvedConcentrationDecision,
      "policy-version-1",
    );

    if (evaluated.decision !== "APPROVED") {
      throw new Error("expected an approved result");
    }

    expect(evaluated).not.toHaveProperty("loanId");

    const persisted = attachPersistedLoanId(evaluated, "loan-123");

    expect(persisted).toEqual({
      decision: "APPROVED",
      message: "O valor solicitado foi aprovado.",
      policyVersion: "policy-version-1",
      loanId: "loan-123",
    });
    expect(toPublicLoanDecisionResult(persisted)).toEqual({
      decision: "APPROVED",
      message: "O valor solicitado foi aprovado.",
      loan_id: "loan-123",
    });
  });

  it("keeps policy version internal and loan_id absent from a public denial", () => {
    const denied = createLoanDecisionResult(
      deniedConcentrationDecision,
      "policy-version-2",
    );

    if (denied.decision !== "DENIED") {
      throw new Error("expected a denied result");
    }

    const publicResult = toPublicLoanDecisionResult(denied);

    expect(publicResult).toEqual({
      decision: "DENIED",
      message: "O empréstimo foi negado.",
    });
    expect(publicResult).not.toHaveProperty("policyVersion");
    expect(publicResult).not.toHaveProperty("policy_version");
    expect(publicResult).not.toHaveProperty("loan_id");
  });
});
