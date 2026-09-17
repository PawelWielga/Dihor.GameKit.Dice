import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const eventsDirectory = new URL("../src/events/", import.meta.url);

describe("events architecture boundary", () => {
  it("does not import rendering, overlay or transport implementations", () => {
    const sourceFiles = readdirSync(eventsDirectory).filter((file) => file.endsWith(".ts"));

    for (const file of sourceFiles) {
      const source = readFileSync(new URL(`../src/events/${file}`, import.meta.url), "utf8");

      expect(source).not.toMatch(/from\s+["']three(?:\/[^"']*)?["']/);
      expect(source).not.toMatch(/from\s+["']\.\.\/three\//);
      expect(source).not.toMatch(/from\s+["']\.\.\/overlay\//);
      expect(source).not.toMatch(/from\s+["'][^"']*(?:websocket|partygamekit)[^"']*["']/i);
    }
  });

  it("uses explicit .js extensions for relative imports and exports", () => {
    const sourceFiles = readdirSync(eventsDirectory).filter((file) => file.endsWith(".ts"));

    for (const file of sourceFiles) {
      const source = readFileSync(new URL(`../src/events/${file}`, import.meta.url), "utf8");
      const relativeSpecifiers = source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g);

      for (const match of relativeSpecifiers) {
        expect(match[1], `${file}: ${match[1]}`).toMatch(/\.js$/);
      }
    }
  });
});
