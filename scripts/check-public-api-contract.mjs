import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function collectExports(sourcePath) {
  const absolutePath = resolve(rootDirectory, sourcePath);
  const sourceText = readFileSync(absolutePath, "utf8");
  const exports = [];
  const namedReExport =
    /export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+["'][^"']+["'];/g;

  let remainingSource = sourceText;
  let match;

  while ((match = namedReExport.exec(sourceText)) !== null) {
    const statementIsTypeOnly = match[1] !== undefined;
    const items = match[2].split(",");

    for (const rawItem of items) {
      let item = rawItem.trim();

      if (item.length === 0) {
        continue;
      }

      const itemIsTypeOnly = item.startsWith("type ");
      if (itemIsTypeOnly) {
        item = item.slice("type ".length).trim();
      }

      const aliasParts = item.split(/\s+as\s+/);
      if (aliasParts.length > 2 || aliasParts.some((part) => part.trim().length === 0)) {
        throw new Error(`${sourcePath}: unsupported named export syntax: ${rawItem.trim()}`);
      }

      const publicName = (aliasParts[1] ?? aliasParts[0]).trim();

      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(publicName)) {
        throw new Error(`${sourcePath}: unsupported public export name: ${publicName}`);
      }

      const kind = statementIsTypeOnly || itemIsTypeOnly ? "type" : "value";
      exports.push(`${publicName}:${kind}`);
    }

    const start = match.index;
    const end = start + match[0].length;
    remainingSource =
      remainingSource.slice(0, start) +
      " ".repeat(match[0].length) +
      remainingSource.slice(end);
  }

  if (/\bexport\s+/.test(remainingSource)) {
    throw new Error(
      `${sourcePath}: public entry points must use explicit named re-exports; wildcard, default and local exports are not allowed.`
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
