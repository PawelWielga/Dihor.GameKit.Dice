import type { DiceRollResult, DieResult, RandomProvider } from "../core/index.js";
import type { D6FaceValue } from "../core/dice/index.js";
import {
  DEFAULT_DICE_PHYSICS_CONFIG,
  DicePhysicsWorld,
  resolveStabilityConfig,
  type DicePhysicsWorldOptions,
  type StabilityOptions
} from "./DicePhysicsWorld.js";
import type {
  DicePhysicsConfig,
  PhysicsQuaternion,
  RollInitialState,
  RollPlan,
  RollPlanDie,
  StabilityConfig
} from "./RollModels.js";

export interface RollInitialStateContext {
  readonly attempt: number;
  readonly dieIndex: number;
  readonly diceCount: number;
  readonly expectedValue: D6FaceValue;
  readonly slotX: number;
  readonly diceSize: number;
}

export type RollInitialStateProvider = (context: RollInitialStateContext) => RollInitialState;

export interface RollPlannerOptions {
  readonly randomProvider?: RandomProvider;
  readonly initialStateProvider?: RollInitialStateProvider;
  readonly physics?: DicePhysicsWorldOptions;
  readonly stability?: StabilityOptions;
  readonly maxAttemptsPerDie?: number;
  readonly maxCombinedAttempts?: number;
  readonly maxPlanningTimeMs?: number;
  readonly nowProvider?: () => number;
  readonly slotSpacing?: number;
}

export class RollPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollPlanningError";
  }
}

const mathRandomProvider: RandomProvider = {
  next: () => Math.random()
};

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a positive integer; received ${String(value)}.`);
  }

  return value;
}

function requirePositiveFinite(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number; received ${String(value)}.`);
  }

  return value;
}

/** Finds replayable physical initial states for logical D6 results without changing those results. */
export class RollPlanner {
  private readonly randomProvider: RandomProvider;
  private readonly initialStateProvider: RollInitialStateProvider;
  private readonly physicsOptions: DicePhysicsWorldOptions;
  private readonly stabilityConfig: StabilityConfig;
  private readonly maxAttemptsPerDie: number;
  private readonly maxCombinedAttempts: number;
  private readonly maxPlanningTimeMs: number;
  private readonly nowProvider: () => number;
  private readonly slotSpacing: number;

  constructor(options: RollPlannerOptions = {}) {
    this.randomProvider = options.randomProvider ?? mathRandomProvider;
    this.initialStateProvider =
      options.initialStateProvider ?? ((context) => this.createRandomInitialState(context));
    this.physicsOptions = options.physics ?? {};
    this.stabilityConfig = resolveStabilityConfig(options.stability);
    this.maxAttemptsPerDie = requirePositiveInteger(
      "maxAttemptsPerDie",
      options.maxAttemptsPerDie ?? 36
    );
    this.maxCombinedAttempts = requirePositiveInteger(
      "maxCombinedAttempts",
      options.maxCombinedAttempts ?? 2
    );
    this.maxPlanningTimeMs = requirePositiveFinite(
      "maxPlanningTimeMs",
      options.maxPlanningTimeMs ?? 2000
    );
    this.nowProvider = options.nowProvider ?? (() => Date.now());
    const configuredDiceSize = options.physics?.diceSize ?? DEFAULT_DICE_PHYSICS_CONFIG.diceSize;
    this.slotSpacing = requirePositiveFinite(
      "slotSpacing",
      options.slotSpacing ?? configuredDiceSize * 2.5
    );
  }

  plan(result: DiceRollResult): RollPlan {
    const expectedDice = this.validateResult(result);
    const startedAt = this.nowProvider();
    let lastFailure = "No matching physical plan was found.";

    for (let combinedAttempt = 1; combinedAttempt <= this.maxCombinedAttempts; combinedAttempt += 1) {
      this.assertWithinDeadline(startedAt);
      const plannedDice: RollPlanDie[] = [];

      for (let dieIndex = 0; dieIndex < expectedDice.length; dieIndex += 1) {
        const expectedDie = expectedDice[dieIndex];

        if (!expectedDie) {
          throw new RollPlanningError(`Missing die result at index ${dieIndex}.`);
        }

        const expectedValue = expectedDie.value as D6FaceValue;
        const slotX = this.slotX(dieIndex, expectedDice.length);
        const initialState = this.findInitialState(
          expectedValue,
          dieIndex,
          expectedDice.length,
          slotX,
          startedAt
        );

        plannedDice.push({
          sides: 6,
          expectedValue,
          initialState
        });
      }

      const verification = this.verifyCombinedPlan(plannedDice);

      if (verification.matches) {
        return {
          rollId: result.rollId,
          dice: plannedDice,
          physics: verification.physics,
          stability: this.stabilityConfig,
          simulationSteps: verification.steps
        };
      }

      lastFailure = verification.reason;
    }

    throw new RollPlanningError(lastFailure);
  }

  private findInitialState(
    expectedValue: D6FaceValue,
    dieIndex: number,
    diceCount: number,
    slotX: number,
    startedAt: number
  ): RollInitialState {
    for (let attempt = 1; attempt <= this.maxAttemptsPerDie; attempt += 1) {
      this.assertWithinDeadline(startedAt);
      const probeWorld = new DicePhysicsWorld(this.physicsOptions);

      try {
        const state = this.initialStateProvider({
          attempt,
          dieIndex,
          diceCount,
          expectedValue,
          slotX,
          diceSize: probeWorld.config.diceSize
        });
        const body = probeWorld.addD6(state);
        const simulation = probeWorld.simulateUntilStable([body], this.stabilityConfig);

        if (simulation.stable && probeWorld.getD6Value(body) === expectedValue) {
          return state;
        }
      } finally {
        probeWorld.dispose();
      }
    }

    throw new RollPlanningError(
      `Unable to find a physical D6 plan for value ${expectedValue} after ${this.maxAttemptsPerDie} attempts.`
    );
  }

  private verifyCombinedPlan(plannedDice: readonly RollPlanDie[]): {
    readonly matches: boolean;
    readonly reason: string;
    readonly steps: number;
    readonly physics: DicePhysicsConfig;
  } {
    const world = new DicePhysicsWorld(this.physicsOptions);

    try {
      const bodies = plannedDice.map((die) => world.addD6(die.initialState));
      const simulation = world.simulateUntilStable(bodies, this.stabilityConfig);

      if (!simulation.stable) {
        return {
          matches: false,
          reason: "Combined D6 simulation did not stabilize within the configured step limit.",
          steps: simulation.steps,
          physics: world.config
        };
      }

      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        const expectedDie = plannedDice[index];

        if (!body || !expectedDie || world.getD6Value(body) !== expectedDie.expectedValue) {
          return {
            matches: false,
            reason: `Combined D6 simulation changed the expected result at index ${index}.`,
            steps: simulation.steps,
            physics: world.config
          };
        }
      }

      return {
        matches: true,
        reason: "",
        steps: simulation.steps,
        physics: world.config
      };
    } finally {
      world.dispose();
    }
  }

  private validateResult(result: DiceRollResult): readonly DieResult[] {
    if (result.dice.length < 1 || result.dice.length > 3) {
      throw new RangeError("RollPlanner currently supports between one and three dice.");
    }

    for (let index = 0; index < result.dice.length; index += 1) {
      const die = result.dice[index];

      if (!die) {
        throw new RangeError(`Roll result contains no die at index ${index}.`);
      }

      if (die.sides !== 6) {
        throw new RangeError(`RollPlanner currently supports D6 only; received D${die.sides}.`);
      }

      if (!Number.isInteger(die.value) || die.value < 1 || die.value > 6) {
        throw new RangeError(`Invalid D6 value at index ${index}: ${String(die.value)}.`);
      }
    }

    return result.dice;
  }

  private createRandomInitialState(context: RollInitialStateContext): RollInitialState {
    const size = context.diceSize;

    return {
      position: {
        x: context.slotX,
        y: size * this.randomRange(2.2, 3.8),
        z: 0
      },
      quaternion: this.randomQuaternion(),
      velocity: {
        x: 0,
        y: size * this.randomRange(0.6, 2.4),
        z: 0
      },
      angularVelocity: {
        x: this.randomRange(-7.5, 7.5),
        y: this.randomRange(-7.5, 7.5),
        z: this.randomRange(-7.5, 7.5)
      }
    };
  }

  private randomQuaternion(): PhysicsQuaternion {
    const u1 = this.randomSample();
    const u2 = this.randomSample();
    const u3 = this.randomSample();
    const root1 = Math.sqrt(1 - u1);
    const root2 = Math.sqrt(u1);
    const theta1 = 2 * Math.PI * u2;
    const theta2 = 2 * Math.PI * u3;

    return {
      x: root1 * Math.sin(theta1),
      y: root1 * Math.cos(theta1),
      z: root2 * Math.sin(theta2),
      w: root2 * Math.cos(theta2)
    };
  }

  private randomRange(min: number, max: number): number {
    return min + (max - min) * this.randomSample();
  }

  private randomSample(): number {
    const sample = this.randomProvider.next();

    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError(
        `RandomProvider.next() must return a finite value in [0, 1); received ${String(sample)}.`
      );
    }

    return sample;
  }

  private slotX(index: number, count: number): number {
    return (index - (count - 1) / 2) * this.slotSpacing;
  }

  private assertWithinDeadline(startedAt: number): void {
    const elapsed = this.nowProvider() - startedAt;

    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > this.maxPlanningTimeMs) {
      throw new RollPlanningError(
        `Roll planning exceeded the configured ${this.maxPlanningTimeMs} ms time limit.`
      );
    }
  }
}
