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

function createDefaultRollId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  fallbackRollIdSequence += 1;
  return `roll-${Date.now().toString(36)}-${fallbackRollIdSequence.toString(36)}`;
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
    if (request.dice.length === 0) {
      throw new RangeError("A dice roll requires at least one die.");
    }

    const modifier = request.modifier ?? 0;
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
