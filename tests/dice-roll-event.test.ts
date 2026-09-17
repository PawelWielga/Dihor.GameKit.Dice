import { describe, expect, it } from "vitest";
import {
  DICE_ROLL_EVENT_TYPE,
  DICE_ROLL_EVENT_VERSION,
  DICE_ROLL_REPLAY_VERSION,
  RollPlanner,
  createDiceRollEvent,
  createSeededRandomProvider,
  diceRollResultFromEvent,
  type DiceDefinition,
  type DiceRollResult,
  type RollPlan
} from "../src/index.js";

function logicalResult(): DiceRollResult {
  return {
    rollId: "host-roll-42",
    dice: [
      { sides: 8, value: 5 },
      { sides: 20, value: 13 }
    ],
    modifier: 2,
    total: 20,
    reason: "Attack"
  };
}

function replayPlan(result: DiceRollResult): RollPlan {
  return new RollPlanner({
    randomProvider: createSeededRandomProvider("event-test", "physics"),
    maxPlanningTimeMs: 5000
  }).plan(result);
}

describe("DiceRollEvent", () => {
  it("serializes definitions, authoritative values and optional replay plan to JSON", () => {
    const result = logicalResult();
    const definitions: readonly DiceDefinition[] = [
      {
        sides: 8,
        appearance: {
          color: "#7b1e1e",
          markingsColor: "#f5e6c8"
        }
      },
      {
        sides: 20,
        appearance: {
          texture: "/dice/marble.png",
          faces: { 13: "/dice/critical.png" }
        }
      }
    ];
    const plan = replayPlan(result);
    const event = createDiceRollEvent(result, { definitions, plan });
    const restored = JSON.parse(JSON.stringify(event));

    expect(event.type).toBe(DICE_ROLL_EVENT_TYPE);
    expect(event.version).toBe(DICE_ROLL_EVENT_VERSION);
    expect(event.replay?.version).toBe(DICE_ROLL_REPLAY_VERSION);
    expect(event.dice).toEqual([
      {
        sides: 8,
        value: 5,
        appearance: {
          color: "#7b1e1e",
          markingsColor: "#f5e6c8"
        }
      },
      {
        sides: 20,
        value: 13,
        appearance: {
          texture: "/dice/marble.png",
          faces: { 13: "/dice/critical.png" }
        }
      }
    ]);
    expect(restored).toEqual(event);
  });

  it("reconstructs the host result without rolling locally", () => {
    const result = logicalResult();
    const event = createDiceRollEvent(result);

    expect(event.replay).toBeUndefined();
    expect(diceRollResultFromEvent(event)).toEqual(result);
  });

  it("keeps the logical host result authoritative even when replay data is omitted", () => {
    const event = createDiceRollEvent(logicalResult());
    const simplifiedPresentation = event.dice.map((die) => `D${die.sides}: ${die.value}`);

    expect(simplifiedPresentation).toEqual(["D8: 5", "D20: 13"]);
    expect(event.total).toBe(20);
  });

  it("rejects replay plans that do not match the authoritative result", () => {
    const result = logicalResult();
    const validPlan = replayPlan(result);
    const mismatchedPlan: RollPlan = {
      ...validPlan,
      dice: validPlan.dice.map((die, index) =>
        index === 0 ? { ...die, expectedValue: die.expectedValue === 1 ? 2 : 1 } : die
      )
    };

    expect(() => createDiceRollEvent(result, { plan: mismatchedPlan })).toThrowError(RangeError);
  });

  it("rejects definitions and totals that disagree with the logical result", () => {
    const result = logicalResult();

    expect(() =>
      createDiceRollEvent(result, { definitions: [{ sides: 6 }, { sides: 20 }] })
    ).toThrowError(RangeError);
    expect(() => createDiceRollEvent({ ...result, total: 999 })).toThrowError(RangeError);
  });
});
