import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as typescriptModule from "typescript";

const ts = typescriptModule.default ?? typescriptModule;

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(rootDirectory, "tests/public-api-contract.json");

const entryPoints = {
  root: { packagePath: ".", source: "src/index.ts" },
  appearance: { packagePath: "./appearance", source: "src/appearance/index.ts" },
  core: { packagePath: "./core", source: "src/core/index.ts" },
  events: { packagePath: "./events", source: "src/events/index.ts" },
  overlay: { packagePath: "./overlay", source: "src/overlay/index.ts" },
  advanced: { packagePath: "./advanced", source: "src/advanced.ts" }
};

function sortNames(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function hasModifier(statement, kind) {
  if (!ts.canHaveModifiers(statement)) {
    return false;
  }

  return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind);
}

function collectExports(sourcePath) {
  const absolutePath = resolve(rootDirectory, sourcePath);
  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const exports = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        throw new Error(
          `${sourcePath}: public entry points must use explicit named exports; wildcard exports are not allowed.`
        );
      }

      for (const element of statement.exportClause.elements) {
        const kind = statement.isTypeOnly || element.isTypeOnly ? "type" : "value";
        exports.push(`${element.name.text}:${kind}`);
      }

      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }

    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      throw new Error(`${sourcePath}: default exports are not supported by the public API contract.`);
    }

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (!statement.name) {
        throw new Error(`${sourcePath}: exported declaration is missing a public name.`);
      }

      exports.push(`${statement.name.text}:value`);
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      exports.push(`${statement.name.text}:type`);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error(
            `${sourcePath}: destructured public variable exports are not supported by the contract checker.`
          );
        }

        exports.push(`${declaration.name.text}:value`);
      }

      continue;
    }

    throw new Error(
      `${sourcePath}: unsupported public export declaration kind ${ts.SyntaxKind[statement.kind]}.`
    );
  }

  return sortNames(exports);
}

function collectContract() {
  return Object.fromEntries(
    Object.entries(entryPoints).map(([name, entry]) => [name, collectExports(entry.source)])
  );
}

function assertPackageEntryPoints() {
  const packageJson = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8"));
  const actualPaths = sortNames(Object.keys(packageJson.exports ?? {}));
  const expectedPaths = sortNames(
    Object.values(entryPoints).map((entry) => entry.packagePath)
  );

  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      [
        "package.json public entry points differ from the API contract configuration.",
        `Expected: ${expectedPaths.join(", ")}`,
        `Actual:   ${actualPaths.join(", ")}`,
        "Update scripts/check-public-api-contract.mjs and the contract snapshot intentionally."
      ].join("\n")
    );
  }
}

assertPackageEntryPoints();

const actual = collectContract();

if (process.argv.includes("--write")) {
  writeFileSync(contractPath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log("Updated tests/public-api-contract.json.");
  process.exit(0);
}

const expected = JSON.parse(readFileSync(contractPath, "utf8"));

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error("Public API contract changed unexpectedly.");
  console.error("");
  console.error("Current exports:");
  console.error(JSON.stringify(actual, null, 2));
  console.error("");
  console.error(
    "If this change is intentional, run npm run update:api-contract and review the snapshot diff."
  );
  process.exit(1);
}

console.log("Public API contract is unchanged.");
