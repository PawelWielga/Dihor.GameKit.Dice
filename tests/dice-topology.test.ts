import { describe, expect, it } from "vitest";
import {
  SUPPORTED_DICE_SIDES,
  getDiceFace,
  getDiceTopology,
  getDiceValueFromOrientation,
  type DiceTopologyVector3,
  type QuaternionLike
} from "../src/index.js";

function normalize(vector: DiceTopologyVector3): DiceTopologyVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function quaternionFromDirections(
  fromValue: DiceTopologyVector3,
  toValue: DiceTopologyVector3
): QuaternionLike {
  const from = normalize(fromValue);
  const to = normalize(toValue);
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;

  if (dot < -0.999999) {
    const reference = Math.abs(from.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const axis = normalize({
      x: from.y * reference.z - from.z * reference.y,
      y: from.z * reference.x - from.x * reference.z,
      z: from.x * reference.y - from.y * reference.x
    });
    return { ...axis, w: 0 };
  }

  const quaternion = {
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
    w: 1 + dot
  };
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length
  };
}

function xSpan(sides: 4 | 8): number {
  const xs = getDiceTopology(sides).vertices.map((vertex) => vertex.x);
  return Math.max(...xs) - Math.min(...xs);
}

describe("polyhedral dice topologies", () => {
  it("defines one physical face for every value of every supported die", () => {
    for (const sides of SUPPORTED_DICE_SIDES) {
      const topology = getDiceTopology(sides);

      expect(topology.sides).toBe(sides);
      expect(topology.faces).toHaveLength(sides);
      expect(topology.faces.map((face) => face.value)).toEqual(
        Array.from({ length: sides }, (_, index) => index + 1)
      );
      expect(topology.faces.every((face) => face.vertexIndices.length >= 3)).toBe(true);
    }
  });

  it("pins the approved D4 and D8 physical size baselines", () => {
    expect(xSpan(4)).toBeCloseTo(1.14264, 6);
    expect(xSpan(8)).toBeCloseTo(1.725, 6);
  });

  it("reads every possible value from the corresponding physical orientation", () => {
    for (const sides of SUPPORTED_DICE_SIDES) {
      const topology = getDiceTopology(sides);
      const target = topology.resultDirection === "up"
        ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: -1, z: 0 };

      for (let value = 1; value <= sides; value += 1) {
        const face = getDiceFace(sides, value);
        const quaternion = quaternionFromDirections(face.normal, target);
        expect(getDiceValueFromOrientation(sides, quaternion)).toBe(value);
      }
    }
  });

  it("keeps topology instances cached and immutable by convention", () => {
    for (const sides of SUPPORTED_DICE_SIDES) {
      expect(getDiceTopology(sides)).toBe(getDiceTopology(sides));
      expect(Object.isFrozen(getDiceTopology(sides))).toBe(true);
    }
  });
});
