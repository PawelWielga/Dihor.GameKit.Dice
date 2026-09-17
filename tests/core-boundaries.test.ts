import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const coreDirectory = fileURLToPath(new URL("../src/core/", import.meta.url));

describe("core architecture boundary", () => {
  it("does not import Three.js or cannon-es", () => {
    const sourceFiles = readdirSync(coreDirectory).filter((file) => file.endsWith(".ts"));

    for (const file of sourceFiles) {
      const source = readFileSync(new URL(`../src/core/${file}`, import.meta.url), "utf8");

      expect(source).not.toMatch(/from\s+["']three(?:\/[^"']*)?["']/);
      expect(source).not.toMatch(/from\s+["']cannon-es(?:\/[^"']*)?["']/);
    }
  });

  it("uses explicit .js extensions for relative imports and exports in public source files", () => {
    const sourceFiles = ["index.ts"];

    for (const directory of ["core", "appearance"]) {
      for (const file of readdirSync(new URL(`../src/${directory}/`, import.meta.url))) {
        if (file.endsWith(".ts")) {
          sourceFiles.push(`${directory}/${file}`);
        }
      }
    }

    for (const file of sourceFiles) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      const relativeSpecifiers = source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g);

      for (const match of relativeSpecifiers) {
        expect(match[1], `${file}: ${match[1]}`).toMatch(/\.js$/);
      }
    }
  });
});
