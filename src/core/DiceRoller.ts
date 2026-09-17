import type { DiceRollRequest } from "./DiceRollRequest.js";
import type { DiceRollResult } from "./DiceRollResult.js";
import type { DiceSides } from "./DiceSides.js";
import type { RandomProvider } from "./RandomProvider.js";

/** Generates a unique identifier for one logical roll. */
export type RollIdProvider = () => string;

export interface DiceRollerOptions {
  readonly randomProvider?: RandomProvider;
  readonly rollIdProvider?: RollIdProvider;
}

const mathRandomProvider: RandomProvider = {
  next: () => Math.random()
};

let fallbackRollIdSequence = 0;
let fallbackRollIdInstanceEntropy: string | undefined;

function createFallbackEntropy(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.getRandomValues === "function") {
    const values = new Uint32Array(2);
    cryptoApi.getRandomValues(values);
    return `${values[0]?.toString(36) ?? "0"}${values[1]?.toString(36) ?? "0"}`;
  }

  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function createDefaultRollId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  fallbackRollIdInstanceEntropy ??= createFallbackEntropy();
  fallbackRollIdSequence += 1;

  return `roll-${Date.now().toString(36)}-${fallbackRollIdInstanceEntropy}-${fallbackRollIdSequence.toString(36)}`;
}

/** Generates authoritative logical dice results without rendering or physics. */
export class DiceRoller {
  private readonly randomProvider: RandomProvider;
  private readonly rollIdProvider: RollIdProvider;

  constructor(options: DiceRollerOptions = {}) {
    this.randomProvider = options.randomProvider ?? mathRandomProvider;
    this.rollIdProvider = options.rollIdProvider ?? createDefaultRollId;
  }

  createRollId(): string {
    return this.rollIdProvider();
  }

  roll(request: DiceRollRequest): DiceRollResult {
    this.validateDice(request.dice);
    const modifier = this.resolveModifier(request.modifier);
    const dice = request.dice.map(({ sides }) => ({
      sides,
      value: this.rollDie(sides)
    }));

    return this.createResult(request, dice, modifier);
  }

  /**
   * Produces an authoritative result whose dice sum matches the requested value.
   * The modifier is applied afterwards and is not part of expectedDiceTotal.
   */
  rollToDiceTotal(request: DiceRollRequest, expectedDiceTotal: number): DiceRollResult {
    this.validateDice(request.dice);
    const modifier = this.resolveModifier(request.modifier);
    const minTotal = request.dice.length;
    const maxTotal = request.dice.reduce((sum, die) => sum + die.sides, 0);

    if (
      !Number.isInteger(expectedDiceTotal) ||
      expectedDiceTotal < minTotal ||
      expectedDiceTotal > maxTotal
    ) {
      throw new RangeError(
        `expectedDiceTotal must be an integer in the ${minTotal}..${maxTotal} range; received ${String(expectedDiceTotal)}.`
      );
    }

    let remaining = expectedDiceTotal;
    const dice = request.dice.map(({ sides }, index) => {
      const remainingDice = request.dice.slice(index + 1);
      const remainingMin = remainingDice.length;
      const remainingMax = remainingDice.reduce((sum, die) => sum + die.sides, 0);
      const minValue = Math.max(1, remaining - remainingMax);
      const maxValue = Math.min(sides, remaining - remainingMin);
      const value = this.rollRange(minValue, maxValue);
      remaining -= value;
      return { sides, value };
    });

    return this.createResult(request, dice, modifier);
  }

  private createResult(
    request: DiceRollRequest,
    dice: DiceRollResult["dice"],
    modifier: number
  ): DiceRollResult {
    const total = dice.reduce((sum, die) => sum + die.value, 0) + modifier;

    return {
      rollId: this.createRollId(),
      dice,
      modifier,
      total,
      ...(request.reason === undefined ? {} : { reason: request.reason })
    };
  }

  private resolveModifier(modifier: number | undefined): number {
    const resolved = modifier ?? 0;

    if (!Number.isFinite(resolved)) {
      throw new RangeError(`Dice roll modifier must be finite; received ${String(resolved)}.`);
    }

    return resolved;
  }

  private validateDice(dice: DiceRollRequest["dice"]): void {
    if (dice.length === 0) {
      throw new RangeError("A dice roll requires at least one die.");
    }

    for (let index = 0; index < dice.length; index += 1) {
      if (!(index in dice) || dice[index] === undefined) {
        throw new RangeError(`Dice roll contains no die at index ${index}.`);
      }
    }
  }

  private rollDie(sides: DiceSides): number {
    return this.rollRange(1, sides);
  }

  private rollRange(min: number, max: number): number {
    if (min === max) {
      return min;
    }

    const sample = this.randomProvider.next();

    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError(
        `RandomProvider.next() must return a finite value in [0, 1); received ${String(sample)}.`
      );
    }

    return min + Math.floor(sample * (max - min + 1));
  }
}
