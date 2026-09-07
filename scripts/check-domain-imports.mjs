import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { parse } from "yaml";

const repositoryRoot = process.cwd();
const rulesFile = path.join(repositoryRoot, ".arc", "rules.yml");
const ruleId = "domain-is-independent";

function fail(message) {
    console.error(`[${ruleId}] ${message}`);
    process.exit(1);
}

function readRule() {
    if (!fs.existsSync(rulesFile)) {
        fail(`Rules file not found: ${rulesFile}`);
    }

    const document = parse(fs.readFileSync(rulesFile, "utf8"));
    const rule = document?.rules?.find(({ id }) => id === ruleId);

    if (!rule) {
        fail(`Rule not found in .arc/rules.yml`);
    }

    if (!rule.scope?.paths?.length) {
        fail(`Rule has no scope.paths`);
    }

    if (!rule.constraints) {
        fail(`Rule has no constraints`);
    }

    return rule;
}

function removeTrailingGlob(pattern) {
    return pattern.replace(/\/\*\*$/, "");
}

function collectTypeScriptFiles(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(entryPath));
            continue;
        }

        if (
            entry.isFile() &&
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ) {
            files.push(entryPath);
        }
    }

    return files;
}

function collectImports(sourceFile) {
    const imports = [];

    function visit(node) {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            imports.push({
                specifier: node.moduleSpecifier.text,
                position: node.moduleSpecifier.getStart(sourceFile),
            });
        }

        if (
            ts.isCallExpression(node) &&
            node.arguments.length === 1 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            const isDynamicImport =
                node.expression.kind === ts.SyntaxKind.ImportKeyword;

            const isRequire =
                ts.isIdentifier(node.expression) &&
                node.expression.text === "require";

            if (isDynamicImport || isRequire) {
                imports.push({
                    specifier: node.arguments[0].text,
                    position: node.arguments[0].getStart(sourceFile),
                });
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return imports;
}

function isProcessReference(node) {
    if (ts.isIdentifier(node) && node.text === "process") {
        return true;
    }

    if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        node.name.text === "process"
    ) {
        return true;
    }

    if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "process"
    ) {
        return true;
    }

    return false;
}

function isProcessEnvAccess(node) {
    if (
        ts.isPropertyAccessExpression(node) &&
        isProcessReference(node.expression) &&
        node.name.text === "env"
    ) {
        return true;
    }

    if (
        ts.isElementAccessExpression(node) &&
        isProcessReference(node.expression) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "env"
    ) {
        return true;
    }

    return false;
}

function collectForbiddenExpressions(sourceFile, forbiddenExpressions) {
    const violations = [];

    function visit(node) {
        if (
            forbiddenExpressions.includes("process.env") &&
            isProcessEnvAccess(node)
        ) {
            violations.push({
                expression: "process.env",
                position: node.getStart(sourceFile),
            });
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return violations;
}

function isInside(candidatePath, directoryPath) {
    const relative = path.relative(directoryPath, candidatePath);

    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

function isForbiddenInternalImport(file, specifier, forbiddenPatterns) {
    if (!specifier.startsWith(".")) {
        return false;
    }

    const resolvedImport = path.resolve(path.dirname(file), specifier);

    return forbiddenPatterns.some((pattern) => {
        const forbiddenDirectory = path.resolve(
            repositoryRoot,
            removeTrailingGlob(pattern),
        );

        return isInside(resolvedImport, forbiddenDirectory);
    });
}

function isForbiddenPackage(specifier, forbiddenPackages) {
    return forbiddenPackages.some(
        (packageName) =>
            specifier === packageName || specifier.startsWith(`${packageName}/`),
    );
}

const rule = readRule();

const scopeDirectories = rule.scope.paths.map((pattern) =>
    path.resolve(repositoryRoot, removeTrailingGlob(pattern)),
);

const forbiddenImports = rule.constraints.forbidden_imports ?? [];
const forbiddenPackages = rule.constraints.forbidden_packages ?? [];
const forbiddenExpressions = rule.constraints.forbidden_expressions ?? [];

const sourceFiles = scopeDirectories.flatMap((directory) => {
    if (!fs.existsSync(directory)) {
        fail(`Scope directory not found: ${directory}`);
    }

    return collectTypeScriptFiles(directory);
});

const violations = [];

for (const file of sourceFiles) {
    const contents = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
        file,
        contents,
        ts.ScriptTarget.Latest,
        true,
    );

    for (const importedModule of collectImports(sourceFile)) {
        const forbiddenInternal = isForbiddenInternalImport(
            file,
            importedModule.specifier,
            forbiddenImports,
        );

        const forbiddenPackage = isForbiddenPackage(
            importedModule.specifier,
            forbiddenPackages,
        );

        if (forbiddenInternal || forbiddenPackage) {
            const location = sourceFile.getLineAndCharacterOfPosition(
                importedModule.position,
            );

            violations.push({
                file: path.relative(repositoryRoot, file),
                line: location.line + 1,
                description: `imports forbidden dependency "${importedModule.specifier}"`,
            });
        }
    }

    for (const forbiddenExpression of collectForbiddenExpressions(
        sourceFile,
        forbiddenExpressions,
    )) {
        const location = sourceFile.getLineAndCharacterOfPosition(
            forbiddenExpression.position,
        );

        violations.push({
            file: path.relative(repositoryRoot, file),
            line: location.line + 1,
            description: `uses forbidden expression "${forbiddenExpression.expression}"`,
        });
    }
}

if (violations.length > 0) {
    console.error(`[${ruleId}] FAILED`);

    for (const violation of violations) {
        console.error(
            `- ${violation.file}:${violation.line} ${violation.description}`,
        );
    }

    process.exit(1);
}

console.log(
    `[${ruleId}] PASSED: scanned ${sourceFiles.length} TypeScript files`,
);