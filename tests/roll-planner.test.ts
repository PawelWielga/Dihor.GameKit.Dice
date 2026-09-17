import { describe, expect, it } from "vitest";
import {
  RollPlanner,
  RollPlanningError,
  type DiceRollResult,
  type RollInitialStateContext
} from "../src/index.js";

function settledState(context: RollInitialStateContext) {
  const halfSize = context.diceSize / 2;
  const isSix = context.expectedValue === 6;

  return {
    position: { x: context.slotX, y: halfSize, z: 0 },
    quaternion: isSix
      ? { x: 1, y: 0, z: 0, w: 0 }
      : { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 }
  } as const;
}

function result(values: readonly (1 | 6)[]): DiceRollResult {
  const dice = values.map((value) => ({ sides: 6 as const, value }));

  return {
    rollId: "roll-plan-test",
    dice,
    modifier: 0,
    total: values.reduce<number>((sum, value) => sum + value, 0)
  };
}

describe("RollPlanner", () => {
  it("finds and verifies replayable physical plans for one to three D6 dice", () => {
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

    const plan = planner.plan(result([1, 6, 1]));

    expect(plan.rollId).toBe("roll-plan-test");
    expect(plan.dice.map((die) => die.expectedValue)).toEqual([1, 6, 1]);
    expect(plan.dice.map((die) => die.initialState.position.x)).toEqual([-2.5, 0, 2.5]);
    expect(plan.simulationSteps).toBeGreaterThan(0);
    expect(plan.physics.timeStep).toBeGreaterThan(0);
    expect(plan.physics.arenaHalfExtent).toBe(5);
    expect(plan.stability.consecutiveSteps).toBe(4);
  });

  it("fails in a bounded way when the supplied physical states cannot reach the result", () => {
    const planner = new RollPlanner({
      initialStateProvider: (context) => ({
        ...settledState({ ...context, expectedValue: 1 }),
        position: { x: context.slotX, y: context.diceSize / 2, z: 0 }
      }),
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: {
        consecutiveSteps: 4,
        maxSteps: 120
      }
    });

    expect(() => planner.plan(result([6]))).toThrowError(RollPlanningError);
  });

  it("rejects unsupported dice counts and non-D6 results before simulation", () => {
    const planner = new RollPlanner({
      initialStateProvider: settledState
    });

    expect(() =>
      planner.plan({ rollId: "empty", dice: [], modifier: 0, total: 0 })
    ).toThrowError(RangeError);
    expect(() =>
      planner.plan({
        rollId: "d20",
        dice: [{ sides: 20, value: 7 }],
        modifier: 0,
        total: 7
      })
    ).toThrowError(RangeError);
  });
});
