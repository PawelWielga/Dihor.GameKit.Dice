import type { DiceDefinition } from "./DiceDefinition.js";

export interface DiceTotalRange {
  readonly min: number;
  readonly max: number;
}

/** Returns the inclusive sum range for the supplied dice, excluding any roll modifier. */
export function getDiceTotalRange(
  dice: readonly Pick<DiceDefinition, "sides">[]
): DiceTotalRange {
  if (dice.length === 0) {
    throw new RangeError("Dice total range requires at least one die.");
  }

  return {
    min: dice.length,
    max: dice.reduce((sum, die) => sum + die.sides, 0)
  };
}
