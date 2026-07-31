export class DomainValidationError extends Error {
  constructor(
    readonly field: "amount" | "uf" | "borrowerId",
    message: string,
  ) {
    super(message);
    this.name = "DomainValidationError";
  }
}

declare const loanAmountBrand: unique symbol;

export type LoanAmount = bigint & { readonly [loanAmountBrand]: true };

export const MAX_LOAN_AMOUNT_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function createLoanAmount(value: unknown): LoanAmount {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new DomainValidationError(
      "amount",
      `amount must be an integer between 1 and ${MAX_LOAN_AMOUNT_MINOR_UNITS}`,
    );
  }

  return BigInt(value) as LoanAmount;
}

const BRAZILIAN_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type Uf = (typeof BRAZILIAN_UFS)[number];

const brazilianUfs: ReadonlySet<string> = new Set(BRAZILIAN_UFS);

export function createUf(value: unknown): Uf {
  if (typeof value !== "string" || !brazilianUfs.has(value)) {
    throw new DomainValidationError(
      "uf",
      "uf must be one of the 27 uppercase Brazilian state codes",
    );
  }

  return value as Uf;
}

declare const borrowerIdBrand: unique symbol;

export type BorrowerId = string & { readonly [borrowerIdBrand]: true };

export function createBorrowerId(value: unknown): BorrowerId {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new DomainValidationError(
      "borrowerId",
      "borrowerId must be a non-empty string without surrounding whitespace",
    );
  }

  return value as BorrowerId;
}

export interface LoanDecisionInput {
  readonly borrowerId: BorrowerId;
  readonly uf: Uf;
  readonly amount: LoanAmount;
}

export interface LoanDecisionInputCandidate {
  readonly borrowerId?: unknown;
  readonly uf?: unknown;
  readonly amount?: unknown;
}

export function createLoanDecisionInput(
  candidate: LoanDecisionInputCandidate,
): LoanDecisionInput {
  return {
    borrowerId: createBorrowerId(candidate.borrowerId),
    uf: createUf(candidate.uf),
    amount: createLoanAmount(candidate.amount),
  };
}
