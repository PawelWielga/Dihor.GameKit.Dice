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

  roll(request: DiceRollRequest): DiceRollResult {
    this.validateDice(request.dice);

    const modifier = request.modifier ?? 0;

    if (!Number.isFinite(modifier)) {
      throw new RangeError(`Dice roll modifier must be finite; received ${String(modifier)}.`);
    }

    const dice = request.dice.map(({ sides }) => ({
      sides,
      value: this.rollDie(sides)
    }));
    const total = dice.reduce((sum, die) => sum + die.value, 0) + modifier;

    return {
      rollId: this.rollIdProvider(),
      dice,
      modifier,
      total,
      ...(request.reason === undefined ? {} : { reason: request.reason })
    };
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
    const sample = this.randomProvider.next();

    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError(
        `RandomProvider.next() must return a finite value in [0, 1); received ${String(sample)}.`
      );
    }

    return Math.floor(sample * sides) + 1;
  }
}
