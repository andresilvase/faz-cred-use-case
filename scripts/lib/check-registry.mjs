const processCheck = (executable, args) => ({
    kind: "process",
    executable,
    args,
});

const vitestCheck = (...testFiles) =>
    processCheck("npx", ["--no-install", "vitest", "run", ...testFiles]);

export const checkRegistry = new Map([
    [
        "concentration-policy-tests",
        vitestCheck(
            "src/domain/concentration-policy.test.ts",
            "src/domain/loan-decision.test.ts",
        ),
    ],
    [
        "bootstrap-boundary-tests",
        vitestCheck(
            "src/domain/bootstrap-loan-decision.test.ts",
            "src/domain/loan-decision.test.ts",
        ),
    ],
    [
        "denied-decision-side-effects-tests",
        vitestCheck("src/application/persist-approved-loan.test.ts"),
    ],
    [
        "approval-atomicity-tests",
        vitestCheck(
            "src/application/persist-approved-loan.test.ts",
            "src/infrastructure/database/postgres-approved-loan-transaction.test.ts",
        ),
    ],
    [
        "idempotency-tests",
        vitestCheck(
            "src/application/persist-approved-loan.test.ts",
            "src/interfaces/http/loan-decisions.test.ts",
        ),
    ],
    [
        "concurrent-decision-policy-tests",
        vitestCheck("src/application/loan-decision-concurrency.test.ts"),
    ],
    [
        "exposure-source-of-truth-tests",
        vitestCheck(
            "src/infrastructure/database/postgres-exposure-rebuilder.test.ts",
            "src/infrastructure/database/postgres-exposure-repository.test.ts",
        ),
    ],
    [
        "domain-imports",
        processCheck(process.execPath, ["scripts/check-domain-imports.mjs"]),
    ],
    [
        "sensitive-logging-tests",
        vitestCheck("src/infrastructure/logging/technical-logger.test.ts"),
    ],
    [
        "gitleaks",
        {
            kind: "external",
            job: "Secret scan",
        },
    ],
]);

export function isKnownCheck(checkId) {
    return checkRegistry.has(checkId);
}

export function getCheck(checkId) {
    const check = checkRegistry.get(checkId);

    if (!check) {
        throw new Error(`Unknown enforcement check: ${checkId}`);
    }

    return check;
}