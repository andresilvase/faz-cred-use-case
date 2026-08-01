import express, { type ErrorRequestHandler, type Response } from "express";

import { IdempotencyConflictError } from "../../application/persist-approved-loan.js";
import type { CompletedLoanDecisionResult } from "../../domain/loan-decision-result.js";
import { toPublicLoanDecisionResult } from "../../domain/loan-decision-result.js";
import {
  createLoanDecisionInput,
  DomainValidationError,
  type LoanDecisionInput,
} from "../../domain/loan-decision-input.js";

export interface LoanDecisionProcessor {
  execute(
    input: LoanDecisionInput,
    idempotencyKey: string,
  ): Promise<CompletedLoanDecisionResult>;
}

export function createApp(loanDecisions: LoanDecisionProcessor) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/loan-decisions", async (request, response) => {
    try {
      const input = parseLoanDecisionBody(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.get("Idempotency-Key"),
      );
      const result = await loanDecisions.execute(input, idempotencyKey);

      response.status(200).json(toPublicLoanDecisionResult(result));
    } catch (error) {
      respondToError(response, error);
    }
  });

  const jsonParsingErrorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "Invalid request" });
      return;
    }

    response.status(500).json({ error: "Internal server error" });
  };
  app.use(jsonParsingErrorHandler);

  return app;
}

class HttpRequestValidationError extends Error {}

function parseLoanDecisionBody(body: unknown): LoanDecisionInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpRequestValidationError();
  }

  const candidate = body as Record<string, unknown>;

  return createLoanDecisionInput({
    borrowerId: candidate.borrower_id,
    uf: candidate.uf,
    amount: candidate.amount,
  });
}

function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value === "" || value !== value.trim()) {
    throw new HttpRequestValidationError();
  }

  return value;
}

function respondToError(response: Response, error: unknown): void {
  if (
    error instanceof DomainValidationError ||
    error instanceof HttpRequestValidationError
  ) {
    response.status(400).json({ error: "Invalid request" });
    return;
  }

  if (error instanceof IdempotencyConflictError) {
    response.status(409).json({
      error: "Idempotency key conflicts with a different request",
    });
    return;
  }

  response.status(500).json({ error: "Internal server error" });
}
