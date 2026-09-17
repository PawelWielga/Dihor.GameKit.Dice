import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiceRoller,
  getDiceTotalRange,
  type DiceDefinition,
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("can build an authoritative mixed-dice result for an exact dice total", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([0.5, 0.25]),
      rollIdProvider: () => "forced-total"
    });

    const result = roller.rollToDiceTotal(
      { dice: [{ sides: 6 }, { sides: 8 }, { sides: 20 }], modifier: 2 },
      19
    );

    expect(result.dice.reduce((sum, die) => sum + die.value, 0)).toBe(19);
    expect(result.total).toBe(21);
    expect(result.rollId).toBe("forced-total");
  });

  it("rejects an exact dice total outside the current dice range", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([]),
      rollIdProvider: () => "unused"
    });

    expect(() =>
      roller.rollToDiceTotal({ dice: [{ sides: 10 }, { sides: 10 }, { sides: 10 }] }, 2)
    ).toThrowError(RangeError);
    expect(() =>
      roller.rollToDiceTotal({ dice: [{ sides: 10 }, { sides: 10 }, { sides: 10 }] }, 31)
    ).toThrowError(RangeError);
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

  it("calculates the dynamic valid dice-total range for mixed dice", () => {
    expect(getDiceTotalRange([{ sides: 6 }, { sides: 8 }, { sides: 20 }])).toEqual({
      min: 3,
      max: 34
    });
  });

  it("rejects rolls without dice", () => {
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([]),
      rollIdProvider: () => "unused"
    });

    expect(() => roller.roll({ dice: [] })).toThrowError(RangeError);
  });

  it("rejects sparse dice arrays", () => {
    const sparseDice = new Array<DiceDefinition>(1);
    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([]),
      rollIdProvider: () => "unused"
    });

    expect(() => roller.roll({ dice: sparseDice })).toThrowError(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite modifier %s",
    (modifier) => {
      const roller = new DiceRoller({
        randomProvider: new SequenceRandomProvider([]),
        rollIdProvider: () => "unused"
      });

      expect(() => roller.roll({ dice: [{ sides: 6 }], modifier })).toThrowError(RangeError);
    }
  );

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

  it("keeps fallback roll IDs unique when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(123_456);
    vi.spyOn(Math, "random").mockReturnValueOnce(0.123_456).mockReturnValueOnce(0.654_321);

    const roller = new DiceRoller({
      randomProvider: new SequenceRandomProvider([0, 0])
    });

    const first = roller.roll({ dice: [{ sides: 6 }] });
    const second = roller.roll({ dice: [{ sides: 6 }] });

    expect(first.rollId).not.toBe(second.rollId);
    expect(first.rollId).toContain("roll-");
    expect(second.rollId).toContain("roll-");
  });
});
