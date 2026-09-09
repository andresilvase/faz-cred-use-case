import { execFileSync } from "node:child_process";
import { minimatch } from "minimatch";
import { loadRules } from "./lib/load-rules.mjs";

const [, , baseSha, headSha = "HEAD"] = process.argv;

if (!baseSha) {
    console.error("Usage: node scripts/run-arc-gate.mjs <base-sha> [head-sha]");
    process.exit(2);
}

let rulesDocument;

try {
    rulesDocument = loadRules();
} catch (error) {
    console.error(`[arc-gate] FAILED: ${error.message}`);
    process.exit(1);
}

const changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", `${baseSha}...${headSha}`],
    { encoding: "utf8" },
)
    .split("\n")
    .filter(Boolean);

const activatedRules = rulesDocument.rules
    .map((rule) => {
        const patterns = rule.triggers?.paths ?? [];
        const matchedFiles = changedFiles.filter((file) =>
            patterns.some((pattern) => minimatch(file, pattern, { dot: true })),
        );

        return { rule, matchedFiles };
    })
    .filter(({ matchedFiles }) => matchedFiles.length > 0);

console.log(`Changed files: ${changedFiles.length}`);
console.log(`Activated rules: ${activatedRules.length}`);

for (const { rule, matchedFiles } of activatedRules) {
    console.log(`\n[${rule.severity.toUpperCase()}] ${rule.id}`);
    console.log(`Status: SELECTED`);
    console.log(`Statement: ${rule.statement.trim()}`);
    console.log(
        `Reason: ${matchedFiles.length} changed file(s) matched the rule triggers.`,
    );
    console.log("Trigger-matched files:");

    for (const file of matchedFiles) {
        console.log(`  - ${file}`);
    }
}

console.log(
    "\nSelection only: enforcement commands have not been executed.",
);