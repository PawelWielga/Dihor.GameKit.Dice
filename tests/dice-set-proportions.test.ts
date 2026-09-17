import { describe, expect, it } from "vitest";
import {
  D6_REFERENCE_EDGE_MM,
  DiceMeshFactory,
  SUPPORTED_DICE_SIDES,
  type DiceSides
} from "../src/index.js";

function maximumVisualExtent(factory: DiceMeshFactory, sides: DiceSides): number {
  const mesh = factory.create(sides, { size: 1 });

  try {
    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;

    if (!bounds) {
      throw new Error(`D${sides} geometry has no bounding box.`);
    }

    return Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z
    );
  } finally {
    mesh.dispose();
  }
}

describe("standard RPG set proportions", () => {
  it("uses a 16 mm D6 as the physical sizing reference", () => {
    expect(D6_REFERENCE_EDGE_MM).toBe(16);
  });

  it("keeps the approved dice at distinct relative sizes instead of normalizing one bounding box", () => {
    const factory = new DiceMeshFactory();

    try {
      const extents = new Map(
        SUPPORTED_DICE_SIDES.map((sides) => [sides, maximumVisualExtent(factory, sides)])
      );

      expect(extents.get(6)).toBeCloseTo(1, 5);

      expect(extents.get(4)).toBeGreaterThan(1.1);
      expect(extents.get(4)).toBeLessThan(1.25);

      expect(extents.get(8)).toBeGreaterThan(1.65);
      expect(extents.get(8)).toBeLessThan(1.8);

      expect(extents.get(10)).toBeGreaterThan(1.25);
      expect(extents.get(10)).toBeLessThan(1.4);

      expect(extents.get(12)).toBeGreaterThan(1.1);
      expect(extents.get(12)).toBeLessThan(1.25);

      expect(extents.get(20)).toBeGreaterThan(1.1);
      expect(extents.get(20)).toBeLessThan(1.25);

      const roundedExtents = [...extents.values()].map((value) => value.toFixed(2));
      expect(new Set(roundedExtents).size).toBeGreaterThanOrEqual(4);
    } finally {
      factory.dispose();
    }
  });
});
