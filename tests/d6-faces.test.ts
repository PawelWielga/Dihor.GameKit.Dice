import { describe, expect, it } from "vitest";
import {
  D6_FACE_NORMALS,
  D6_FACE_VALUES,
  D6_OPPOSITE_FACE,
  getD6TopValue
} from "../src/advanced.js";

describe("D6 face mapping", () => {
  it("uses the classic opposite-face sum of seven", () => {
    for (const value of D6_FACE_VALUES) {
      expect(value + D6_OPPOSITE_FACE[value]).toBe(7);
    }
  });

  it("assigns every value to a unique axis-aligned physical normal", () => {
    const normals = D6_FACE_VALUES.map((value) => JSON.stringify(D6_FACE_NORMALS[value]));
    expect(new Set(normals).size).toBe(6);
  });

  it("detects the top face from physical orientation", () => {
    const halfSqrt = Math.SQRT1_2;

    expect(getD6TopValue({ x: 0, y: 0, z: 0, w: 1 })).toBe(1);
    expect(getD6TopValue({ x: 1, y: 0, z: 0, w: 0 })).toBe(6);
    expect(getD6TopValue({ x: halfSqrt, y: 0, z: 0, w: halfSqrt })).toBe(5);
    expect(getD6TopValue({ x: 0, y: 0, z: halfSqrt, w: halfSqrt })).toBe(3);
  });

  it("rejects invalid quaternions", () => {
    expect(() => getD6TopValue({ x: 0, y: 0, z: 0, w: 0 })).toThrowError(RangeError);
    expect(() => getD6TopValue({ x: Number.NaN, y: 0, z: 0, w: 1 })).toThrowError(RangeError);
  });
});
