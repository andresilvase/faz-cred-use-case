import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ApprovedLoanTransaction,
  ApprovedLoanTransactionRunner,
  IdempotencyRequest,
} from "../../application/approved-loan-transaction.js";
import type { CompletedLoanDecisionResult } from "../../domain/loan-decision-result.js";
import type {
  BorrowerId,
  LoanDecisionInput,
} from "../../domain/loan-decision-input.js";
import {
  NOOP_TECHNICAL_LOGGER,
  type TechnicalLogger,
} from "../logging/technical-logger.js";
import { PostgresConcentrationPolicyRepository } from "./postgres-concentration-policy-repository.js";
import { PostgresExposureRepository } from "./postgres-exposure-repository.js";

const RETRYABLE_TRANSACTION_CODES = new Set(["40P01", "40001", "55P03"]);
const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 10;

export interface PostgresTransactionOptions {
  readonly lockTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly logger?: TechnicalLogger;
}

export class PostgresApprovedLoanTransaction
  implements ApprovedLoanTransactionRunner
{
  private readonly lockTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly logger: TechnicalLogger;

  constructor(
    private readonly pool: Pool,
    options: PostgresTransactionOptions = {},
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.logger = options.logger ?? NOOP_TECHNICAL_LOGGER;
  }

  async run<T>(
    operation: (transaction: ApprovedLoanTransaction) => Promise<T>,
  ): Promise<T> {
    for (let retryCount = 0; ; retryCount += 1) {
      try {
        return await this.runAttempt(operation);
      } catch (error) {
        if (
          retryCount >= this.maxRetries ||
          !isRetryableTransactionError(error)
        ) {
          this.logger.error("database.transaction_failed", error, {
            attempt: retryCount + 1,
            sqlstate: postgresErrorCode(error),
          });
          throw error;
        }

        this.logger.warn("database.transaction_retry", {
          attempt: retryCount + 1,
          sqlstate: postgresErrorCode(error),
        });
        await wait(this.retryDelayMs * 2 ** retryCount);
      }
    }
  }

  private async runAttempt<T>(
    operation: (transaction: ApprovedLoanTransaction) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient;

    try {
      client = await this.pool.connect();
    } catch (error) {
      this.logger.error("database.connection_failed", error);
      throw error;
    }

    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('lock_timeout', $1, true)", [
        `${this.lockTimeoutMs}ms`,
      ]);
      const exposureRepository = new PostgresExposureRepository(client);
      const policyRepository = new PostgresConcentrationPolicyRepository(
        client,
      );
      const result = await operation({
        findIdempotencyRequest: (borrowerId, idempotencyKey) =>
          logQueryFailure(this.logger, "idempotency.find", () =>
            findIdempotencyRequest(client, borrowerId, idempotencyKey),
          ),
        lockExposure: (uf) =>
          logQueryFailure(this.logger, "exposure.lock", () =>
            exposureRepository.lockFor(uf),
          ),
        loadActivePolicy: () =>
          logQueryFailure(this.logger, "policy.load_active", () =>
            policyRepository.loadActive(),
          ),
        insertLoan: async (input, policyVersion) => {
          const loanId = randomUUID();

          await logQueryFailure(this.logger, "loan.insert", () =>
            insertLoan(client, loanId, input, policyVersion),
          );

          return loanId;
        },
        updateExposure: (uf, exposure) =>
          logQueryFailure(this.logger, "exposure.update", () =>
            exposureRepository.updateLocked(uf, exposure),
          ),
        saveIdempotencyRequest: (request) =>
          logQueryFailure(this.logger, "idempotency.insert", () =>
            saveIdempotencyRequest(client, request),
          ),
      });

      await client.query("COMMIT");

      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function logQueryFailure<T>(
  logger: TechnicalLogger,
  operation: string,
  query: () => Promise<T>,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    logger.error("database.query_failed", error, {
      operation,
      sqlstate: postgresErrorCode(error),
    });
    throw error;
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = postgresErrorCode(error);

  return code !== undefined && RETRYABLE_TRANSACTION_CODES.has(code);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

interface IdempotencyRequestRow extends QueryResultRow {
  readonly borrowerId: BorrowerId;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly decision: "APPROVED" | "DENIED";
  readonly message: string;
  readonly loanId: string | null;
  readonly policyVersion: string;
}

async function findIdempotencyRequest(
  client: PoolClient,
  borrowerId: BorrowerId,
  idempotencyKey: string,
): Promise<IdempotencyRequest | undefined> {
  const result = await client.query<IdempotencyRequestRow>(
    `
      SELECT
        borrower_id AS "borrowerId",
        idempotency_key AS "idempotencyKey",
        request_hash AS "requestHash",
        decision,
        message,
        loan_id::text AS "loanId",
        policy_version AS "policyVersion"
      FROM idempotency_requests
      WHERE borrower_id = $1 AND idempotency_key = $2
    `,
    [borrowerId, idempotencyKey],
  );
  const row = result.rows[0];

  if (row === undefined) {
    return undefined;
  }

  return {
    borrowerId: row.borrowerId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    result: mapIdempotencyResult(row),
  };
}

function mapIdempotencyResult(
  row: IdempotencyRequestRow,
): CompletedLoanDecisionResult {
  if (row.decision === "DENIED") {
    if (row.message !== "O empréstimo foi negado.") {
      throw new Error("denied idempotency request has an invalid message");
    }

    return {
      decision: row.decision,
      message: row.message,
      policyVersion: row.policyVersion,
    };
  }

  if (row.loanId === null) {
    throw new Error("approved idempotency request has no loan id");
  }
  if (row.message !== "O valor solicitado foi aprovado.") {
    throw new Error("approved idempotency request has an invalid message");
  }

  return {
    decision: row.decision,
    message: row.message,
    loanId: row.loanId,
    policyVersion: row.policyVersion,
  };
}

async function saveIdempotencyRequest(
  client: PoolClient,
  request: IdempotencyRequest,
): Promise<void> {
  await client.query(
    `
      INSERT INTO idempotency_requests (
        borrower_id,
        idempotency_key,
        request_hash,
        decision,
        message,
        loan_id,
        policy_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      request.borrowerId,
      request.idempotencyKey,
      request.requestHash,
      request.result.decision,
      request.result.message,
      request.result.decision === "APPROVED" ? request.result.loanId : null,
      request.result.policyVersion,
    ],
  );
}

async function insertLoan(
  client: PoolClient,
  loanId: string,
  input: LoanDecisionInput,
  policyVersion: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO loans (
        id,
        borrower_id,
        uf,
        amount_minor_units,
        policy_version
      ) VALUES ($1, $2, $3, $4::bigint, $5)
    `,
    [
      loanId,
      input.borrowerId,
      input.uf,
      input.amount.toString(),
      policyVersion,
    ],
  );
}
