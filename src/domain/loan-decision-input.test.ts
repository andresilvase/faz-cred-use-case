import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  MAX_LOAN_AMOUNT_MINOR_UNITS,
  createBorrowerId,
  createLoanDecisionInput,
  createLoanAmount,
  createUf,
} from "./loan-decision-input.js";

const VALID_UFS = [
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

describe("createLoanAmount", () => {
  it.each([1, 25_000, Number.MAX_SAFE_INTEGER])(
    "represents the valid minor-unit amount %s without floating point",
    (amount) => {
      expect(createLoanAmount(amount)).toBe(BigInt(amount));
    },
  );

  it.each([
    ["absent", undefined],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["not finite", Number.POSITIVE_INFINITY],
    ["outside the supported interval", Number.MAX_SAFE_INTEGER + 1],
    ["not a number", "100"],
  ])("rejects an %s amount", (_scenario, amount) => {
    expect(() => createLoanAmount(amount)).toThrow(
      new DomainValidationError(
        "amount",
        `amount must be an integer between 1 and ${MAX_LOAN_AMOUNT_MINOR_UNITS}`,
      ),
    );
  });
});

describe("createUf", () => {
  it("accepts all 27 Brazilian state codes", () => {
    expect(VALID_UFS).toHaveLength(27);

    for (const uf of VALID_UFS) {
      expect(createUf(uf)).toBe(uf);
    }
  });

  it.each([undefined, "XX", "sp", " SP ", ""])(
    "rejects the nonexistent or non-normalized state code %s",
    (uf) => {
      expect(() => createUf(uf)).toThrow(
        new DomainValidationError(
          "uf",
          "uf must be one of the 27 uppercase Brazilian state codes",
        ),
      );
    },
  );
});

describe("createBorrowerId", () => {
  it("accepts a non-empty borrower identifier", () => {
    expect(createBorrowerId("borrower-123")).toBe("borrower-123");
  });

  it.each([undefined, "", "   ", " borrower-123 ", 123])(
    "rejects the absent, empty, or non-normalized borrower identifier %s",
    (borrowerId) => {
      expect(() => createBorrowerId(borrowerId)).toThrow(
        new DomainValidationError(
          "borrowerId",
          "borrowerId must be a non-empty string without surrounding whitespace",
        ),
      );
    },
  );
});

describe("createLoanDecisionInput", () => {
  it("creates a validated domain input without HTTP or database concerns", () => {
    expect(
      createLoanDecisionInput({
        borrowerId: "borrower-123",
        uf: "SP",
        amount: 10_000,
      }),
    ).toEqual({
      borrowerId: "borrower-123",
      uf: "SP",
      amount: 10_000n,
    });
  });
});
