import { describe, expect, it } from "vitest";

describe("package bootstrap", () => {
  it("loads the public module entry point", async () => {
    const module = await import("../src/index");

    expect(module).toBeDefined();
  });
});
