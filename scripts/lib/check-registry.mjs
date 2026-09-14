export const knownCheckIds = new Set([
    "concentration-policy-tests",
    "bootstrap-boundary-tests",
    "denied-decision-side-effects-tests",
    "approval-atomicity-tests",
    "idempotency-tests",
    "concurrent-decision-policy-tests",
    "exposure-source-of-truth-tests",
    "domain-imports",
    "sensitive-logging-tests",
    "gitleaks",
]);

export function isKnownCheck(checkId) {
    return knownCheckIds.has(checkId);
}

