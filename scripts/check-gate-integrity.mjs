import { execFileSync } from "node:child_process";

const [, , baseSha, headSha = "HEAD"] = process.argv;

if (!baseSha) {
    console.error(
        "Usage: node scripts/check-gate-integrity.mjs <base-sha> [head-sha]",
    );
    process.exit(2);
}

const output = execFileSync(
    "git",
    ["diff", "--name-only", `${baseSha}...${headSha}`],
    { encoding: "utf8" },
);

const changedFiles = output.split("\n").filter(Boolean);

const protectedPatterns = [
    /^\.arc\//,
    /^\.github\/workflows\/arc-gate\.yml$/,
    /^scripts\/validate-rules\.mjs$/,
    /^scripts\/check-domain-imports\.mjs$/,
    /^scripts\/check-gate-integrity\.mjs$/,
];

const protectedFiles = changedFiles.filter((file) =>
    protectedPatterns.some((pattern) => pattern.test(file)),
);

if (protectedFiles.length === 0) {
    console.log("Gate integrity: no gate machinery changed.");
    process.exit(0);
}

console.log("Gate integrity: gate machinery changed:");
for (const file of protectedFiles) {
    console.log(`- ${file}`);
}

console.log("\nExplicit review of these changes is required.");

// Report-only for now. It must not block the PR yet.
process.exit(0);