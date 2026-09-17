import { describe, expect, it } from "vitest";
import {
  DiceRoller,
  type DiceRollRequest,
  type RandomProvider
} from "../src/index.js";

class SequenceRandomProvider implements RandomProvider {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  next(): number {
    const value = this.values[this.index];

    if (value === undefined) {
      throw new Error("SequenceRandomProvider ran out of values.");
    }

    this.index += 1;
    return value;
  }
}

describe("DiceRoller", () => {
  it("maps normalized random samples to valid die values", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([0, 0.5, 0.999_999]),
      rollIdProvider: () => "roll-test"
    });

    const result = roller.roll({
      dice: [{ sides: 6 }, { sides: 6 }, { sides: 20 }],
      modifier: 2,
      reason: "Attack"
    });

    expect(result).toEqual({
      rollId: "roll-test",
      dice: [
        { sides: 6, value: 1 },
        { sides: 6, value: 4 },
        { sides: 20, value: 20 }
      ],
      modifier: 2,
      total: 27,
      reason: "Attack"
    });
  });

  it("normalizes a missing modifier to zero", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([0.25]),
      rollIdProvider: () => "roll-zero-modifier"
    });

    const result = roller.roll({ dice: [{ sides: 4 }] });

    expect(result.dice[0]?.value).toBe(2);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(2);
  });

  it("produces predictable results with a custom RandomProvider", () => {
    const request: DiceRollRequest = {
      dice: [{ sides: 8 }, { sides: 10 }]
    };
    const createRoller = () =>
      new DiceRoller({
        randomProvider: new SequenceRandomProvider([0.125, 0.9]),
        rollIdProvider: () => "deterministic-roll"
      });

    expect(createRoller().roll(request)).toEqual(createRoller().roll(request));
  });

  it("rejects rolls without dice", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([]),
      rollIdProvider: () => "unused"
    });

    expect(() => roller.roll({ dice: [] })).toThrowError(RangeError);
  });

  it.each([-0.1, 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid normalized RNG sample %s",
    (sample) => {
      const roller = new DiceRoller({
        randomProvider: new SequenceRandomProvider([sample]),
        rollIdProvider: () => "invalid-rng"
      });

      expect(() => roller.roll({ dice: [{ sides: 6 }] })).toThrowError(RangeError);
    }
  );
});
