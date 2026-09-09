import { loadRules } from "./lib/load-rules.mjs";

try {
    const rules = loadRules();

    console.log(
        `[arc-rules] PASSED: ${rules.rules.length} rules validated against schema version ${rules.version}`,
    );
} catch (error) {
    console.error(`[arc-rules] FAILED: ${error.message}`);
    process.exit(1);
}