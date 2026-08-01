import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import express, { type ErrorRequestHandler, type Response } from "express";

import { IdempotencyConflictError } from "../../application/persist-approved-loan.js";
import type { CompletedLoanDecisionResult } from "../../domain/loan-decision-result.js";
import { toPublicLoanDecisionResult } from "../../domain/loan-decision-result.js";
import {
  createLoanDecisionInput,
  DomainValidationError,
  type LoanDecisionInput,
} from "../../domain/loan-decision-input.js";
import {
  NOOP_TECHNICAL_LOGGER,
  type TechnicalLogger,
} from "../../infrastructure/logging/technical-logger.js";

export interface LoanDecisionProcessor {
  execute(
    input: LoanDecisionInput,
    idempotencyKey: string,
  ): Promise<CompletedLoanDecisionResult>;
}

export interface CreateAppOptions {
  readonly logger?: TechnicalLogger;
  readonly createCorrelationId?: () => string;
  readonly now?: () => number;
}

export function createApp(
  loanDecisions: LoanDecisionProcessor,
  options: CreateAppOptions = {},
) {
  const app = express();
  const logger = options.logger ?? NOOP_TECHNICAL_LOGGER;
  const createCorrelationId = options.createCorrelationId ?? randomUUID;
  const now = options.now ?? performance.now.bind(performance);

  app.use((request, response, next) => {
    const correlationId = createCorrelationId();
    const startedAt = now();
    response.locals.correlationId = correlationId;
    response.setHeader("X-Correlation-Id", correlationId);
    response.once("finish", () => {
      logger.info("http.request_completed", {
        correlation_id: correlationId,
        method: request.method,
        route: request.path,
        status: response.statusCode,
        duration_ms: Math.max(0, now() - startedAt),
      });
    });
    next();
  });

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
      respondToError(response, error, logger, request.path);
    }
  });

  const jsonParsingErrorHandler: ErrorRequestHandler = (
    error,
    request,
    response,
    _next,
  ) => {
    if (error instanceof SyntaxError) {
      logger.warn("http.validation_failed", {
        correlation_id: correlationIdFrom(response),
        method: request.method,
        route: request.path,
        field: "body",
      });
      response.status(400).json({ error: "Invalid request" });
      return;
    }

    logger.error("http.request_failed", error, {
      correlation_id: correlationIdFrom(response),
      method: request.method,
      route: request.path,
    });
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

function respondToError(
  response: Response,
  error: unknown,
  logger: TechnicalLogger,
  route: string,
): void {
  const commonFields = {
    correlation_id: correlationIdFrom(response),
    method: "POST",
    route,
  };

  if (
    error instanceof DomainValidationError ||
    error instanceof HttpRequestValidationError
  ) {
    logger.warn("http.validation_failed", {
      ...commonFields,
      field:
        error instanceof DomainValidationError ? error.field : "request",
    });
    response.status(400).json({ error: "Invalid request" });
    return;
  }

  if (error instanceof IdempotencyConflictError) {
    logger.warn("http.idempotency_conflict", commonFields);
    response.status(409).json({
      error: "Idempotency key conflicts with a different request",
    });
    return;
  }

  logger.error("http.request_failed", error, commonFields);
  response.status(500).json({ error: "Internal server error" });
}

function correlationIdFrom(response: Response): string {
  const correlationId = response.locals.correlationId;

  return typeof correlationId === "string" ? correlationId : "unknown";
}
