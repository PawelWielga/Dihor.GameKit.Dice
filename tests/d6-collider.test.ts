import { Box } from "cannon-es";
import { describe, expect, it } from "vitest";
import { createD6Collider } from "../src/index.js";

describe("D6 collider", () => {
  it("uses a simple box independent of rounded render geometry", () => {
    const collider = createD6Collider(2);

    expect(collider).toBeInstanceOf(Box);
    expect(collider.halfExtents.x).toBe(1);
    expect(collider.halfExtents.y).toBe(1);
    expect(collider.halfExtents.z).toBe(1);
  });

  it("rejects invalid collider sizes", () => {
    expect(() => createD6Collider(0)).toThrowError(RangeError);
    expect(() => createD6Collider(Number.NaN)).toThrowError(RangeError);
  });
});
