import { describe, expect, it } from "vitest";
import { getDiceTopology } from "../src/index.js";

function extent(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe("D10 proportions", () => {
  it("keeps the D10 broad enough to match the rest of the dice set", () => {
    const topology = getDiceTopology(10);
    const width = extent(topology.vertices.map((vertex) => vertex.x));
    const height = extent(topology.vertices.map((vertex) => vertex.y));
    const depth = extent(topology.vertices.map((vertex) => vertex.z));

    expect(height).toBeCloseTo(1.3, 5);
    expect(width).toBeGreaterThan(1.1);
    expect(depth).toBeGreaterThan(1.05);
    expect(height / width).toBeGreaterThan(1.05);
    expect(height / width).toBeLessThan(1.2);
  });
});
