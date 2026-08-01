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
import { PostgresConcentrationPolicyRepository } from "./postgres-concentration-policy-repository.js";
import { PostgresExposureRepository } from "./postgres-exposure-repository.js";

export class PostgresApprovedLoanTransaction
  implements ApprovedLoanTransactionRunner
{
  constructor(private readonly pool: Pool) {}

  async run<T>(
    operation: (transaction: ApprovedLoanTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const exposureRepository = new PostgresExposureRepository(client);
      const policyRepository = new PostgresConcentrationPolicyRepository(
        client,
      );
      const result = await operation({
        findIdempotencyRequest: (borrowerId, idempotencyKey) =>
          findIdempotencyRequest(client, borrowerId, idempotencyKey),
        lockExposure: (uf) => exposureRepository.lockFor(uf),
        loadActivePolicy: () => policyRepository.loadActive(),
        insertLoan: async (input, policyVersion) => {
          const loanId = randomUUID();

          await insertLoan(client, loanId, input, policyVersion);

          return loanId;
        },
        updateExposure: (uf, exposure) =>
          exposureRepository.updateLocked(uf, exposure),
        saveIdempotencyRequest: (request) =>
          saveIdempotencyRequest(client, request),
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
