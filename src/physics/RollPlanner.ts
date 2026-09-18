import {
  getDiceFace,
  getDiceTopology,
  type DiceRollResult,
  type DiceSides,
  type DieResult,
  type RandomProvider
} from "../core/index.js";
import {
  DEFAULT_DICE_PHYSICS_CONFIG,
  DicePhysicsWorld,
  resolveStabilityConfig,
  type DicePhysicsWorldOptions,
  type StabilityOptions
} from "./DicePhysicsWorld.js";
import { resolveDiceSpawnLayout, type DiceSpawnPoint } from "./DiceSpawnLayout.js";
import type {
  DiceArenaBoundaryPoint,
  DicePhysicsConfig,
  PhysicsQuaternion,
  RollInitialState,
  RollPlan,
  RollPlanDie,
  StabilityConfig
} from "./RollModels.js";

export const MIN_THROW_FORCE = 0.5;
export const DEFAULT_THROW_FORCE = 1;
export const MAX_THROW_FORCE = 1.5;
export const MIN_DICE_SCALE = 0.5;
export const DEFAULT_DICE_SCALE = 1;
export const MAX_DICE_SCALE = 1.5;
export const MAX_DICE_PER_ROLL = 6;

export interface RollPlanningOptions {
  /** Multiplier applied to initial linear and angular velocity. Defaults to 1. */
  readonly throwForce?: number;
  /** Relative visual + physical size multiplier. Defaults to 1. */
  readonly diceScale?: number;
  /** Camera/table viewport polygon used as invisible physical walls for this roll. */
  readonly arenaBoundary?: readonly DiceArenaBoundaryPoint[];
}

export interface RollInitialStateContext {
  readonly attempt: number;
  readonly dieIndex: number;
  readonly diceCount: number;
  readonly sides: DiceSides;
  readonly expectedValue: number;
  readonly slotX: number;
  readonly slotZ: number;
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

function resolveThrowForce(value: number | undefined): number {
  const resolved = value ?? DEFAULT_THROW_FORCE;

  if (!Number.isFinite(resolved) || resolved < MIN_THROW_FORCE || resolved > MAX_THROW_FORCE) {
    throw new RangeError(
      `throwForce must be between ${MIN_THROW_FORCE} and ${MAX_THROW_FORCE}; received ${String(resolved)}.`
    );
  }

  return resolved;
}

function resolveDiceScale(value: number | undefined): number {
  const resolved = value ?? DEFAULT_DICE_SCALE;

  if (!Number.isFinite(resolved) || resolved < MIN_DICE_SCALE || resolved > MAX_DICE_SCALE) {
    throw new RangeError(
      `diceScale must be between ${MIN_DICE_SCALE} and ${MAX_DICE_SCALE}; received ${String(resolved)}.`
    );
  }

  return resolved;
}

function normalizeQuaternion(quaternion: PhysicsQuaternion): PhysicsQuaternion {
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    throw new RangeError("Cannot normalize an invalid quaternion.");
  }

  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
}

function multiplyQuaternions(left: PhysicsQuaternion, right: PhysicsQuaternion): PhysicsQuaternion {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z
  });
}

function quaternionFromDirections(
  from: { readonly x: number; readonly y: number; readonly z: number },
  to: { readonly x: number; readonly y: number; readonly z: number }
): PhysicsQuaternion {
  const fromLength = Math.hypot(from.x, from.y, from.z);
  const toLength = Math.hypot(to.x, to.y, to.z);

  if (fromLength <= Number.EPSILON || toLength <= Number.EPSILON) {
    throw new RangeError("Result-facing directions must be non-zero.");
  }

  const a = { x: from.x / fromLength, y: from.y / fromLength, z: from.z / fromLength };
  const b = { x: to.x / toLength, y: to.y / toLength, z: to.z / toLength };
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;

  if (dot < -0.999999) {
    const reference = Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const axis = {
      x: a.y * reference.z - a.z * reference.y,
      y: a.z * reference.x - a.x * reference.z,
      z: a.x * reference.y - a.y * reference.x
    };
    const axisLength = Math.hypot(axis.x, axis.y, axis.z);
    return {
      x: axis.x / axisLength,
      y: axis.y / axisLength,
      z: axis.z / axisLength,
      w: 0
    };
  }

  return normalizeQuaternion({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
    w: 1 + dot
  });
}

function rotatedY(
  vector: { readonly x: number; readonly y: number; readonly z: number },
  quaternion: PhysicsQuaternion
): number {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);
  return vector.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz);
}

/** Finds replayable physical initial states for authoritative logical dice results. */
export class RollPlanner {
  private readonly randomProvider: RandomProvider;
  private readonly initialStateProvider: RollInitialStateProvider;
  private readonly physicsOptions: DicePhysicsWorldOptions;
  private readonly stabilityConfig: StabilityConfig;
  private readonly maxAttemptsPerDie: number;
  private readonly maxCombinedAttempts: number;
  private readonly maxPlanningTimeMs: number;
  private readonly nowProvider: () => number;
  private readonly configuredSlotSpacing?: number;

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
    this.configuredSlotSpacing =
      options.slotSpacing === undefined
        ? undefined
        : requirePositiveFinite("slotSpacing", options.slotSpacing);
  }

  plan(result: DiceRollResult, options: RollPlanningOptions = {}): RollPlan {
    const throwForce = resolveThrowForce(options.throwForce);
    const diceScale = resolveDiceScale(options.diceScale);
    const baseDiceSize = this.physicsOptions.diceSize ?? DEFAULT_DICE_PHYSICS_CONFIG.diceSize;
    const physicsOptions: DicePhysicsWorldOptions = {
      ...this.physicsOptions,
      diceSize: baseDiceSize * diceScale,
      ...(options.arenaBoundary ? { arenaBoundary: options.arenaBoundary } : {})
    };
    const expectedDice = this.validateResult(result);
    const resolvedWorld = new DicePhysicsWorld(physicsOptions);
    const physics = resolvedWorld.config;
    resolvedWorld.dispose();
    const desiredSpacing = this.configuredSlotSpacing === undefined
      ? physics.diceSize * 2.5
      : this.configuredSlotSpacing * diceScale;
    const spawnPoints = resolveDiceSpawnLayout(
      expectedDice.map((die) => die.sides),
      physics,
      {
        desiredSpacing,
        customSpacing: this.configuredSlotSpacing !== undefined
      }
    );
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

        const spawnPoint = spawnPoints[dieIndex];

        if (!spawnPoint) {
          throw new RollPlanningError(`Missing spawn point at index ${dieIndex}.`);
        }

        const initialState = this.findInitialState(
          expectedDie.sides,
          expectedDie.value,
          dieIndex,
          expectedDice.length,
          spawnPoint,
          startedAt,
          throwForce,
          physics
        );

        plannedDice.push({
          sides: expectedDie.sides,
          expectedValue: expectedDie.value,
          initialState
        });
      }

      const verification = this.verifyCombinedPlan(plannedDice, physics);

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
    sides: DiceSides,
    expectedValue: number,
    dieIndex: number,
    diceCount: number,
    spawnPoint: DiceSpawnPoint,
    startedAt: number,
    throwForce: number,
    physicsOptions: DicePhysicsWorldOptions
  ): RollInitialState {
    for (let attempt = 1; attempt <= this.maxAttemptsPerDie; attempt += 1) {
      this.assertWithinDeadline(startedAt);
      const probeWorld = new DicePhysicsWorld(physicsOptions);

      try {
        const state = this.applyThrowForce(
          this.initialStateProvider({
            attempt,
            dieIndex,
            diceCount,
            sides,
            expectedValue,
            slotX: spawnPoint.x,
            slotZ: spawnPoint.z,
            diceSize: probeWorld.config.diceSize
          }),
          throwForce
        );
        const body = probeWorld.addDie(sides, state);
        const simulation = probeWorld.simulateUntilStable([body], this.stabilityConfig);

        if (simulation.stable && probeWorld.getDieValue(sides, body) === expectedValue) {
          return state;
        }
      } finally {
        probeWorld.dispose();
      }
    }

    throw new RollPlanningError(
      `Unable to find a physical D${sides} plan for value ${expectedValue} after ${this.maxAttemptsPerDie} attempts.`
    );
  }

  private verifyCombinedPlan(
    plannedDice: readonly RollPlanDie[],
    physicsOptions: DicePhysicsWorldOptions
  ): {
    readonly matches: boolean;
    readonly reason: string;
    readonly steps: number;
    readonly physics: DicePhysicsConfig;
  } {
    const world = new DicePhysicsWorld(physicsOptions);

    try {
      const bodies = plannedDice.map((die) => world.addDie(die.sides, die.initialState));
      const simulation = world.simulateUntilStable(bodies, this.stabilityConfig);

      if (!simulation.stable) {
        return {
          matches: false,
          reason: "Combined dice simulation did not stabilize within the configured step limit.",
          steps: simulation.steps,
          physics: world.config
        };
      }

      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        const expectedDie = plannedDice[index];

        if (
          !body ||
          !expectedDie ||
          world.getDieValue(expectedDie.sides, body) !== expectedDie.expectedValue
        ) {
          return {
            matches: false,
            reason: `Combined dice simulation changed the expected result at index ${index}.`,
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
    if (result.dice.length < 1 || result.dice.length > MAX_DICE_PER_ROLL) {
      throw new RangeError(
        `RollPlanner currently supports between one and ${MAX_DICE_PER_ROLL} dice.`
      );
    }

    for (let index = 0; index < result.dice.length; index += 1) {
      const die = result.dice[index];

      if (!die) {
        throw new RangeError(`Roll result contains no die at index ${index}.`);
      }

      if (!Number.isInteger(die.value) || die.value < 1 || die.value > die.sides) {
        throw new RangeError(
          `Invalid D${die.sides} value at index ${index}: ${String(die.value)}.`
        );
      }
    }

    return result.dice;
  }

  private applyThrowForce(state: RollInitialState, throwForce: number): RollInitialState {
    if (throwForce === DEFAULT_THROW_FORCE) {
      return state;
    }

    const forceDelta = throwForce - DEFAULT_THROW_FORCE;
    const tumbleScale = DEFAULT_THROW_FORCE + forceDelta * 0.35;
    const yawScale = DEFAULT_THROW_FORCE + forceDelta * 0.75;

    return {
      ...state,
      velocity: {
        x: state.velocity.x * throwForce,
        y: state.velocity.y * throwForce,
        z: state.velocity.z * throwForce
      },
      angularVelocity: {
        // Strong throws keep their extra translational energy without destroying the
        // target-face bias through equally aggressive uncontrolled X/Z tumble.
        x: state.angularVelocity.x * tumbleScale,
        y: state.angularVelocity.y * yawScale,
        z: state.angularVelocity.z * tumbleScale
      }
    };
  }

  private createRandomInitialState(context: RollInitialStateContext): RollInitialState {
    const size = context.diceSize;

    if (context.sides === 6) {
      return {
        position: {
          x: context.slotX,
          y: size * this.randomRange(2.2, 3.8),
          z: context.slotZ
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

    const topology = getDiceTopology(context.sides);
    const resultFace = getDiceFace(context.sides, context.expectedValue);
    const targetY = topology.resultDirection === "up" ? 1 : -1;
    const aligned = quaternionFromDirections(resultFace.normal, { x: 0, y: targetY, z: 0 });
    const yaw = this.randomRange(0, Math.PI * 2);
    const yawQuaternion = {
      x: 0,
      y: Math.sin(yaw / 2),
      z: 0,
      w: Math.cos(yaw / 2)
    };
    const quaternion = multiplyQuaternions(yawQuaternion, aligned);
    const supportY = -Math.min(...topology.vertices.map((vertex) => rotatedY(vertex, quaternion))) * size;

    // Keep the requested face as a useful planning bias, but launch the die high enough and
    // with cross-axis spin so the visible replay behaves like a throw instead of a tiny final drop.
    // Later attempts progressively reduce tumble energy, giving high-sided dice a reliable path
    // to the authoritative result without snapping or changing face identities after simulation.
    const attemptEnergy = Math.max(0.04, 1 - (context.attempt - 1) * 0.08);
    const tumbleLimit = (context.sides >= 20 ? 4.0 : 5.8) * attemptEnergy;
    const yawLimit = 5.5;
    const lateralLimit = size * 0.58 * attemptEnergy;
    const dropHeight = size * this.randomRange(1.65, 2.75);

    return {
      position: {
        x: context.slotX,
        y: supportY + dropHeight,
        z: context.slotZ
      },
      quaternion,
      velocity: {
        x: this.randomRange(-lateralLimit, lateralLimit),
        y: size * this.randomRange(0.15, 0.85),
        z: this.randomRange(-lateralLimit, lateralLimit)
      },
      angularVelocity: {
        x: this.randomRange(-tumbleLimit, tumbleLimit),
        y: this.randomRange(-yawLimit, yawLimit),
        z: this.randomRange(-tumbleLimit, tumbleLimit)
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

  private assertWithinDeadline(startedAt: number): void {
    const elapsed = this.nowProvider() - startedAt;

    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > this.maxPlanningTimeMs) {
      throw new RollPlanningError(
        `Roll planning exceeded the configured ${this.maxPlanningTimeMs} ms time limit.`
      );
    }
  }
}
