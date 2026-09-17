import { describe, expect, it } from "vitest";
import {
  RollPlanner,
  RollPlanningError,
  SUPPORTED_DICE_SIDES,
  getDiceFace,
  getDiceTopology,
  type DiceRollResult,
  type DiceTopologyVector3,
  type PhysicsQuaternion,
  type RollInitialStateContext
} from "../src/index.js";

function normalize(vector: DiceTopologyVector3): DiceTopologyVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function quaternionFromDirections(
  fromValue: DiceTopologyVector3,
  toValue: DiceTopologyVector3
): PhysicsQuaternion {
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

function rotateY(vertex: DiceTopologyVector3, quaternion: PhysicsQuaternion): number {
  const tx = 2 * (quaternion.y * vertex.z - quaternion.z * vertex.y);
  const ty = 2 * (quaternion.z * vertex.x - quaternion.x * vertex.z);
  const tz = 2 * (quaternion.x * vertex.y - quaternion.y * vertex.x);
  return vertex.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz);
}

function settledState(context: RollInitialStateContext) {
  const topology = getDiceTopology(context.sides);
  const face = getDiceFace(context.sides, context.expectedValue);
  const target = topology.resultDirection === "up"
    ? { x: 0, y: 1, z: 0 }
    : { x: 0, y: -1, z: 0 };
  const quaternion = quaternionFromDirections(face.normal, target);
  const minY = Math.min(...topology.vertices.map((vertex) => rotateY(vertex, quaternion)));

  return {
    position: {
      x: context.slotX,
      y: -minY * context.diceSize + 0.001,
      z: 0
    },
    quaternion,
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 }
  } as const;
}

function result(
  dice: DiceRollResult["dice"],
  rollId = "roll-plan-test"
): DiceRollResult {
  return {
    rollId,
    dice,
    modifier: 0,
    total: dice.reduce((sum, die) => sum + die.value, 0)
  };
}

describe("RollPlanner", () => {
  it("finds and verifies replayable physical plans for every supported die type", () => {
    for (const sides of SUPPORTED_DICE_SIDES) {
      const expectedValue = Math.max(1, Math.floor(sides / 2));
      const planner = new RollPlanner({
        initialStateProvider: settledState,
        maxAttemptsPerDie: 1,
        maxCombinedAttempts: 1,
        maxPlanningTimeMs: 5000,
        stability: {
          consecutiveSteps: 4,
          maxSteps: 120
        }
      });
      const plan = planner.plan(result([{ sides, value: expectedValue }], `d${sides}`));

      expect(plan.rollId).toBe(`d${sides}`);
      expect(plan.dice).toHaveLength(1);
      expect(plan.dice[0]?.sides).toBe(sides);
      expect(plan.dice[0]?.expectedValue).toBe(expectedValue);
      expect(plan.simulationSteps).toBeGreaterThan(0);
    }
  });

  it("finds physical plans with the default initial-state strategy for every supported die type", () => {
    const randomProvider = { next: () => 0.5 };

    for (const sides of SUPPORTED_DICE_SIDES) {
      const expectedValue = sides === 6 ? 1 : Math.max(1, Math.floor(sides / 2));
      const planner = new RollPlanner({
        randomProvider,
        maxAttemptsPerDie: sides === 100 ? 36 : 1,
        maxCombinedAttempts: 1,
        maxPlanningTimeMs: 5000,
        stability: {
          consecutiveSteps: 4,
          maxSteps: 480
        }
      });
      const plan = planner.plan(result([{ sides, value: expectedValue }], `default-d${sides}`));

      expect(plan.dice[0]?.sides).toBe(sides);
      expect(plan.dice[0]?.expectedValue).toBe(expectedValue);
      expect(plan.simulationSteps).toBeGreaterThan(0);

      if (sides !== 6) {
        expect(plan.dice[0]?.initialState.position.y).toBeGreaterThan(sides === 100 ? 0.5 : 1);
      }
    }
  });

  it("supports mixed dice in the same planned roll", () => {
    const planner = new RollPlanner({
      initialStateProvider: settledState,
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: {
        consecutiveSteps: 4,
        maxSteps: 120
      }
    });
    const plan = planner.plan(
      result([
        { sides: 6, value: 4 },
        { sides: 8, value: 7 },
        { sides: 20, value: 13 }
      ])
    );

    expect(plan.dice.map((die) => [die.sides, die.expectedValue])).toEqual([
      [6, 4],
      [8, 7],
      [20, 13]
    ]);
    expect(plan.dice.map((die) => die.initialState.position.x)).toEqual([-2.5, 0, 2.5]);
  });

  it("fails in a bounded way when the supplied physical states cannot reach the result", () => {
    const planner = new RollPlanner({
      initialStateProvider: (context) => settledState({ ...context, expectedValue: 1 }),
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: {
        consecutiveSteps: 4,
        maxSteps: 120
      }
    });

    expect(() => planner.plan(result([{ sides: 6, value: 6 }]))).toThrowError(RollPlanningError);
  });

  it("rejects unsupported dice counts and invalid values before simulation", () => {
    const planner = new RollPlanner({ initialStateProvider: settledState });

    expect(() =>
      planner.plan({ rollId: "empty", dice: [], modifier: 0, total: 0 })
    ).toThrowError(RangeError);
    expect(() =>
      planner.plan({
        rollId: "invalid-d20",
        dice: [{ sides: 20, value: 21 }],
        modifier: 0,
        total: 21
      })
    ).toThrowError(RangeError);
  });
});
