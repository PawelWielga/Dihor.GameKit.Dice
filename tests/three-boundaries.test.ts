import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const threeDirectory = fileURLToPath(new URL("../src/three/", import.meta.url));

describe("Three.js architecture boundary", () => {
  it("does not depend directly on cannon-es", () => {
    const sourceFiles = readdirSync(threeDirectory).filter((file) => file.endsWith(".ts"));

    for (const file of sourceFiles) {
      const source = readFileSync(new URL(`../src/three/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["']cannon-es(?:\/[^"']*)?["']/);
    }
  });
});
