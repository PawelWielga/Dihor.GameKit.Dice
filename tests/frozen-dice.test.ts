import { describe, expect, it, vi } from "vitest";
import {
  DirectRollPlanner,
  RollPlanner,
  type FrozenRollDieState,
  type RollInitialStateContext
} from "../src/advanced.js";

const frozenState: FrozenRollDieState = {
  dieIndex: 0,
  sides: 6,
  expectedValue: 1,
  physicsMode: "translation-only",
  position: { x: -3, y: 0.5, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 }
};

function settledState(context: RollInitialStateContext) {
  return {
    position: { x: context.slotX, y: context.diceSize / 2, z: context.slotZ },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 }
  } as const;
}

describe("frozen dice planning", () => {
  it("presimulates only unfrozen dice while keeping frozen dice in the combined plan", () => {
    const initialStateProvider = vi.fn(settledState);
    const planner = new RollPlanner({
      initialStateProvider,
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1,
      maxPlanningTimeMs: 5000,
      stability: { consecutiveSteps: 4, maxSteps: 120 }
    });

    const plan = planner.plan(
      {
        rollId: "partial-reroll",
        dice: [
          { sides: 6, value: 1 },
          { sides: 6, value: 1 }
        ],
        modifier: 0,
        total: 2
      },
      { frozenDice: [frozenState] }
    );

    expect(initialStateProvider).toHaveBeenCalledTimes(1);
    expect(initialStateProvider).toHaveBeenCalledWith(
      expect.objectContaining({ dieIndex: 1, expectedValue: 1 })
    );
    expect(plan.dice[0]).toMatchObject({
      sides: 6,
      expectedValue: 1,
      frozenPhysicsMode: "translation-only",
      initialState: {
        position: frozenState.position,
        quaternion: frozenState.quaternion,
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 }
      }
    });
    expect(plan.dice[1]?.frozenPhysicsMode).toBeUndefined();
  });

  it("preserves frozen transforms in direct plans and throws only unfrozen dice", () => {
    const planner = new DirectRollPlanner({
      randomProvider: { next: () => 0.5 }
    });

    const plan = planner.plan(
      {
        dice: [{ sides: 6 }, { sides: 6 }]
      },
      "direct-reroll",
      { frozenDice: [{ ...frozenState, physicsMode: "fully-frozen" }] }
    );

    expect(plan.dice[0]).toMatchObject({
      sides: 6,
      expectedValue: 0,
      frozenPhysicsMode: "fully-frozen",
      initialState: {
        position: frozenState.position,
        quaternion: frozenState.quaternion,
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 }
      }
    });
    expect(plan.dice[1]?.frozenPhysicsMode).toBeUndefined();
    expect(plan.dice[1]?.initialState.velocity.y).toBeGreaterThan(0);
  });

  it("rejects frozen descriptors that do not match the logical die", () => {
    const planner = new RollPlanner({
      initialStateProvider: settledState,
      maxAttemptsPerDie: 1,
      maxCombinedAttempts: 1
    });

    expect(() =>
      planner.plan(
        {
          rollId: "bad-frozen",
          dice: [{ sides: 6, value: 2 }],
          modifier: 0,
          total: 2
        },
        { frozenDice: [frozenState] }
      )
    ).toThrowError(RangeError);
  });
});
