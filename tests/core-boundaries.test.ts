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
});
