import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiceRoller,
  RollPlanner,
  SeededRandomProvider,
  createSeededRandomProvider,
  type DiceRollRequest
} from "../src/index.js";

function samples(provider: SeededRandomProvider, count: number): number[] {
  return Array.from({ length: count }, () => provider.next());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SeededRandomProvider", () => {
  it("produces the same normalized sequence for the same seed and stream", () => {
    const first = samples(new SeededRandomProvider("party-42", "logic"), 12);
    const second = samples(new SeededRandomProvider("party-42", "logic"), 12);

    expect(first).toEqual(second);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("keeps named streams independent", () => {
    const logic = samples(createSeededRandomProvider(12345, "logic"), 8);
    const physics = samples(createSeededRandomProvider(12345, "physics"), 8);

    expect(logic).not.toEqual(physics);
    expect(logic).toEqual(samples(createSeededRandomProvider(12345, "logic"), 8));
    expect(physics).toEqual(samples(createSeededRandomProvider(12345, "physics"), 8));
  });

  it("rejects invalid numeric seeds and empty stream names", () => {
    expect(() => new SeededRandomProvider(Number.NaN)).toThrowError(RangeError);
    expect(() => new SeededRandomProvider(Number.POSITIVE_INFINITY)).toThrowError(RangeError);
    expect(() => new SeededRandomProvider("seed", "")).toThrowError(RangeError);
  });
});

describe("seeded dice pipeline", () => {
  it("generates the same logical values for the same seed and request", () => {
    const request: DiceRollRequest = {
      dice: [{ sides: 4 }, { sides: 6 }, { sides: 8 }, { sides: 20 }, { sides: 100 }],
      modifier: 3,
      reason: "seeded-test"
    };
    const roll = () =>
      new DiceRoller({
        randomProvider: createSeededRandomProvider("session-abc", "logic"),
        rollIdProvider: () => "seeded-roll"
      }).roll(request);

    expect(roll()).toEqual(roll());
  });

  it("generates the same physical plan inputs for the same physics seed", () => {
    const result = {
      rollId: "seeded-plan",
      dice: [
        { sides: 8 as const, value: 5 },
        { sides: 20 as const, value: 13 }
      ],
      modifier: 0,
      total: 18
    };
    const plan = () =>
      new RollPlanner({
        randomProvider: createSeededRandomProvider("session-abc", "physics"),
        maxPlanningTimeMs: 5000
      }).plan(result);

    const first = plan();
    const second = plan();

    expect(first.dice).toEqual(second.dice);
    expect(first.physics).toEqual(second.physics);
    expect(first.stability).toEqual(second.stability);
  });

  it("does not read global Math.random when seeded providers are injected", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("global Math.random must not be used");
    });

    const roller = new DiceRoller({
      randomProvider: createSeededRandomProvider("isolated", "logic"),
      rollIdProvider: () => "isolated-roll"
    });
    const result = roller.roll({ dice: [{ sides: 8 }, { sides: 20 }] });
    const planner = new RollPlanner({
      randomProvider: createSeededRandomProvider("isolated", "physics"),
      maxPlanningTimeMs: 5000
    });

    expect(() => planner.plan(result)).not.toThrow();
  });
});
