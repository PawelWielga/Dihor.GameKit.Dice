import { describe, expect, it } from "vitest";
import {
  createSeededRandomProvider,
  getDiceTopology,
  type DiceSides,
  type DiceTopologyVector3,
  type PhysicsQuaternion,
  type RollInitialStateContext
} from "../src/index.js";
import { createNaturalRollInitialStateProvider } from "../src/physics/NaturalRollPlanner.js";

const POLYHEDRAL_SIDES: readonly Exclude<DiceSides, 6>[] = [4, 8, 10, 12, 20, 100];

function rotateY(vertex: DiceTopologyVector3, quaternion: PhysicsQuaternion): number {
  const tx = 2 * (quaternion.y * vertex.z - quaternion.z * vertex.y);
  const ty = 2 * (quaternion.z * vertex.x - quaternion.x * vertex.z);
  const tz = 2 * (quaternion.x * vertex.y - quaternion.y * vertex.x);
  return vertex.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz);
}

function context(sides: DiceSides, attempt = 1): RollInitialStateContext {
  return {
    attempt,
    dieIndex: 0,
    diceCount: 1,
    sides,
    expectedValue: Math.max(1, Math.floor(sides / 2)),
    slotX: 0,
    diceSize: 1
  };
}

describe("natural polyhedral roll initial states", () => {
  it("starts normal polyhedral candidates well above the table with X/Z tumble", () => {
    for (const sides of POLYHEDRAL_SIDES) {
      const provider = createNaturalRollInitialStateProvider(
        createSeededRandomProvider(`motion-d${sides}`, "physics"),
        {},
        36
      );
      const state = provider(context(sides));
      const topology = getDiceTopology(sides);
      const supportY = -Math.min(
        ...topology.vertices.map((vertex) => rotateY(vertex, state.quaternion))
      );

      expect(state.position.y - supportY, `D${sides} drop height`).toBeGreaterThan(1);
      expect(Math.abs(state.angularVelocity.x), `D${sides} angular X`).toBeGreaterThan(0.05);
      expect(Math.abs(state.angularVelocity.z), `D${sides} angular Z`).toBeGreaterThan(0.05);
    }
  });

  it("gradually falls back to a conservative state on the final retry", () => {
    for (const sides of POLYHEDRAL_SIDES) {
      const provider = createNaturalRollInitialStateProvider(
        createSeededRandomProvider(`fallback-d${sides}`, "physics"),
        {},
        36
      );
      const state = provider(context(sides, 36));
      const topology = getDiceTopology(sides);
      const supportY = -Math.min(
        ...topology.vertices.map((vertex) => rotateY(vertex, state.quaternion))
      );

      expect(Math.abs(state.angularVelocity.x)).toBeLessThan(1e-9);
      expect(Math.abs(state.angularVelocity.y)).toBeLessThan(1e-9);
      expect(Math.abs(state.angularVelocity.z)).toBeLessThan(1e-9);
      expect(state.position.y - supportY).toBeLessThan(0.25);
    }
  });
});
