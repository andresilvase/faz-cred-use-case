import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { parse } from "yaml";

export function loadRules(repositoryRoot = process.cwd()) {
    const rulesPath = path.join(repositoryRoot, ".arc", "rules.yml");
    const schemaPath = path.join(repositoryRoot, ".arc", "rules.schema.json");

    if (!fs.existsSync(rulesPath)) {
        throw new Error(`Rules file not found: ${rulesPath}`);
    }

    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found: ${schemaPath}`);
    }

    let rules;
    let schema;

    try {
        rules = parse(fs.readFileSync(rulesPath, "utf8"));
    } catch (error) {
        throw new Error(`Invalid rules YAML: ${error.message}`);
    }

    try {
        schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    } catch (error) {
        throw new Error(`Invalid rules schema: ${error.message}`);
    }

    const ajv = new Ajv({
        allErrors: true,
        strict: true,
        strictRequired: false,
    });

    const validate = ajv.compile(schema);

    if (!validate(rules)) {
        const details = (validate.errors ?? [])
            .map((error) => {
                const location = error.instancePath || "/";
                return `${location}: ${error.message}`;
            })
            .join("\n");

        throw new Error(`rules.yml does not match the schema:\n${details}`);
    }

    const ruleIds = rules.rules.map(({ id }) => id);
    const duplicateIds = [
        ...new Set(ruleIds.filter((id, index) => ruleIds.indexOf(id) !== index)),
    ];

    if (duplicateIds.length > 0) {
        throw new Error(`Duplicate rule IDs: ${duplicateIds.join(", ")}`);
    }

    return rules;
}