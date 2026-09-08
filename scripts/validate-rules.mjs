import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";
import { parse } from "yaml";

const repositoryRoot = process.cwd();

const rulesPath = path.join(repositoryRoot, ".arc", "rules.yml");
const schemaPath = path.join(repositoryRoot, ".arc", "rules.schema.json");

function fail(message) {
    console.error(`[arc-rules] FAILED: ${message}`);
    process.exit(1);
}

function readFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        fail(`${label} not found: ${filePath}`);
    }

    return fs.readFileSync(filePath, "utf8");
}

let rules;
let schema;

try {
    rules = parse(readFile(rulesPath, "Rules file"));
} catch (error) {
    fail(`invalid YAML: ${error.message}`);
}

try {
    schema = JSON.parse(readFile(schemaPath, "Schema file"));
} catch (error) {
    fail(`invalid JSON Schema file: ${error.message}`);
}

const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictRequired: false,
});

const validate = ajv.compile(schema);
const schemaIsValid = validate(rules);

if (!schemaIsValid) {
    console.error("[arc-rules] FAILED: rules.yml does not match the schema");

    for (const error of validate.errors ?? []) {
        const location = error.instancePath || "/";
        console.error(`- ${location}: ${error.message}`);
    }

    process.exit(1);
}

const ruleIds = rules.rules.map(({ id }) => id);
const duplicateIds = [
    ...new Set(ruleIds.filter((id, index) => ruleIds.indexOf(id) !== index)),
];

if (duplicateIds.length > 0) {
    fail(`duplicate rule IDs: ${duplicateIds.join(", ")}`);
}

console.log(
    `[arc-rules] PASSED: ${rules.rules.length} rules validated against schema version ${rules.version}`,
);