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
        maxAttemptsPerDie: 1,
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
        expect(plan.dice[0]?.initialState.position.y).toBeGreaterThan(1);
      }
    }
  });

  it("uses the same per-roll viewport boundary in hidden planning and replay config", () => {
    const boundary = [
      { x: -6, z: -4 },
      { x: 6, z: -4 },
      { x: 5, z: 4 },
      { x: -5, z: 4 }
    ] as const;
    const planner = new RollPlanner({
      initialStateProvider: settledState,
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: { consecutiveSteps: 4, maxSteps: 120 }
    });

    const plan = planner.plan(result([{ sides: 6, value: 1 }]), { arenaBoundary: boundary });

    expect(plan.physics.arenaBoundary).toEqual(boundary);
  });

  it("applies diceScale consistently to physics size and default slot spacing", () => {
    const slots: number[] = [];
    const planner = new RollPlanner({
      initialStateProvider(context) {
        slots.push(context.slotX);
        return settledState(context);
      },
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: { consecutiveSteps: 4, maxSteps: 120 }
    });

    const plan = planner.plan(
      result([{ sides: 6, value: 1 }, { sides: 6, value: 1 }]),
      { diceScale: 1.5 }
    );

    expect(plan.physics.diceSize).toBeCloseTo(DEFAULT_DICE_PHYSICS_CONFIG.diceSize * 1.5);
    expect(Math.abs(slots[1]! - slots[0]!)).toBeCloseTo(
      DEFAULT_DICE_PHYSICS_CONFIG.diceSize * 2.5 * 1.5
    );
    expect(() => planner.plan(result([{ sides: 6, value: 1 }]), { diceScale: 1.51 }))
      .toThrowError(RangeError);
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

  it("plans the complete supported RPG set in one roll", () => {
    const planner = new RollPlanner({
      initialStateProvider: settledState,
      slotSpacing: 2.6,
      physics: { arenaHalfExtent: 9 },
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: {
        consecutiveSteps: 4,
        maxSteps: 120
      }
    });
    const dice = SUPPORTED_DICE_SIDES.map((sides) => ({ sides, value: 1 }));
    const plan = planner.plan(result(dice, "full-rpg-set"));

    expect(plan.dice).toHaveLength(SUPPORTED_DICE_SIDES.length);
    expect(plan.dice.map((die) => die.sides)).toEqual([...SUPPORTED_DICE_SIDES]);
    expect(plan.dice.map((die) => die.expectedValue)).toEqual(
      SUPPORTED_DICE_SIDES.map(() => 1)
    );
  });

  it("applies per-roll throw force without changing authoritative values, including multiple dice", () => {
    const planner = new RollPlanner({
      initialStateProvider: (context) => {
        const state = settledState(context);
        return {
          ...state,
          velocity: { x: 0.01, y: 0.01, z: 0.01 },
          angularVelocity: { x: 0.01, y: 0.01, z: 0.01 }
        };
      },
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: {
        consecutiveSteps: 4,
        maxSteps: 120
      }
    });
    const authoritative = result([
      { sides: 6, value: 4 },
      { sides: 8, value: 7 }
    ]);

    const defaultPlan = planner.plan(authoritative);
    const strongerPlan = planner.plan(authoritative, { throwForce: 1.5 });

    expect(defaultPlan.dice.map((die) => die.expectedValue)).toEqual([4, 7]);
    expect(strongerPlan.dice.map((die) => die.expectedValue)).toEqual([4, 7]);
    expect(defaultPlan.dice[0]?.initialState.velocity.x).toBeCloseTo(0.01);
    expect(strongerPlan.dice[0]?.initialState.velocity.x).toBeCloseTo(0.015);
    expect(strongerPlan.dice[0]?.initialState.angularVelocity.y).toBeCloseTo(0.01375);
    expect(strongerPlan.dice[1]?.initialState.angularVelocity.z).toBeCloseTo(0.01175);
    expect(strongerPlan.dice[1]?.initialState.angularVelocity.z).toBeLessThan(
      strongerPlan.dice[1]!.initialState.velocity.z
    );
  });

  it("rejects throw force values outside the supported safe range", () => {
    const planner = new RollPlanner({ initialStateProvider: settledState });
    const authoritative = result([{ sides: 6, value: 1 }]);

    expect(() => planner.plan(authoritative, { throwForce: 0.49 })).toThrowError(RangeError);
    expect(() => planner.plan(authoritative, { throwForce: 1.51 })).toThrowError(RangeError);
    expect(() => planner.plan(authoritative, { throwForce: Number.NaN })).toThrowError(RangeError);
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
