import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  ApprovedLoanTransaction,
  ApprovedLoanTransactionRunner,
} from "../../application/approved-loan-transaction.js";
import type { LoanDecisionInput } from "../../domain/loan-decision-input.js";
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
        lockExposure: (uf) => exposureRepository.lockFor(uf),
        loadActivePolicy: () => policyRepository.loadActive(),
        insertLoan: async (input, policyVersion) => {
          const loanId = randomUUID();

          await insertLoan(client, loanId, input, policyVersion);

          return loanId;
        },
        updateExposure: (uf, exposure) =>
          exposureRepository.updateLocked(uf, exposure),
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
