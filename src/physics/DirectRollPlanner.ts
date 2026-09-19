import type { DiceRollRequest, RandomProvider } from "../core/index.js";
import {
  DicePhysicsWorld,
  resolveStabilityConfig,
  type DicePhysicsWorldOptions,
  type StabilityOptions
} from "./DicePhysicsWorld.js";
import { resolveDiceSpawnLayout, type DiceSpawnPoint } from "./DiceSpawnLayout.js";
import {
  DEFAULT_DICE_SCALE,
  DEFAULT_THROW_FORCE,
  MAX_DICE_PER_ROLL,
  MAX_DICE_SCALE,
  MIN_DICE_SCALE,
  MAX_THROW_FORCE,
  MIN_THROW_FORCE,
  type RollPlanningOptions
} from "./RollPlanner.js";
import type {
  FrozenRollDieState,
  PhysicsQuaternion,
  DirectRollPlan,
  RollInitialState,
  StabilityConfig
} from "./RollModels.js";

export interface DirectRollPlannerOptions {
  readonly randomProvider?: RandomProvider;
  readonly physics?: DicePhysicsWorldOptions;
  readonly stability?: StabilityOptions;
  readonly slotSpacing?: number;
}

const mathRandomProvider: RandomProvider = {
  next: () => Math.random()
};

function requireThrowForce(value: number | undefined): number {
  const resolved = value ?? DEFAULT_THROW_FORCE;
  if (!Number.isFinite(resolved) || resolved < MIN_THROW_FORCE || resolved > MAX_THROW_FORCE) {
    throw new RangeError(
      `throwForce must be between ${MIN_THROW_FORCE} and ${MAX_THROW_FORCE}; received ${String(resolved)}.`
    );
  }
  return resolved;
}

function requireDiceScale(value: number | undefined): number {
  const resolved = value ?? DEFAULT_DICE_SCALE;
  if (!Number.isFinite(resolved) || resolved < MIN_DICE_SCALE || resolved > MAX_DICE_SCALE) {
    throw new RangeError(
      `diceScale must be between ${MIN_DICE_SCALE} and ${MAX_DICE_SCALE}; received ${String(resolved)}.`
    );
  }
  return resolved;
}

function requirePositiveFinite(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number; received ${String(value)}.`);
  }
  return value;
}

function resolveFrozenDice(
  frozenDice: readonly FrozenRollDieState[] | undefined,
  request: DiceRollRequest
): ReadonlyMap<number, FrozenRollDieState> {
  const resolved = new Map<number, FrozenRollDieState>();

  for (const frozen of frozenDice ?? []) {
    if (!Number.isInteger(frozen.dieIndex) || frozen.dieIndex < 0 || frozen.dieIndex >= request.dice.length) {
      throw new RangeError(
        `frozenDice dieIndex must reference an existing die; received ${String(frozen.dieIndex)}.`
      );
    }

    if (resolved.has(frozen.dieIndex)) {
      throw new RangeError(`frozenDice contains duplicate dieIndex ${frozen.dieIndex}.`);
    }

    const definition = request.dice[frozen.dieIndex];

    if (!definition || definition.sides !== frozen.sides) {
      throw new RangeError(`frozenDice[${frozen.dieIndex}] must match the requested die sides.`);
    }

    if (frozen.physicsMode !== "fully-frozen" && frozen.physicsMode !== "translation-only") {
      throw new RangeError(
        `Unsupported frozen dice physics mode: ${String(frozen.physicsMode)}.`
      );
    }

    resolved.set(frozen.dieIndex, frozen);
  }

  return resolved;
}

/**
 * Creates a visible-physics plan without running hidden simulation.
 * expectedValue is intentionally set to 0 and ignored by DiceRollPlayer for direct plans.
 */
export class DirectRollPlanner {
  private readonly randomProvider: RandomProvider;
  private readonly physicsOptions: DicePhysicsWorldOptions;
  private readonly stability: StabilityConfig;
  private readonly configuredSlotSpacing?: number;

  constructor(options: DirectRollPlannerOptions = {}) {
    this.randomProvider = options.randomProvider ?? mathRandomProvider;
    this.physicsOptions = options.physics ?? {};
    this.stability = resolveStabilityConfig(options.stability);
    this.configuredSlotSpacing =
      options.slotSpacing === undefined
        ? undefined
        : requirePositiveFinite("slotSpacing", options.slotSpacing);
  }

  plan(
    request: DiceRollRequest,
    rollId: string,
    options: RollPlanningOptions = {}
  ): DirectRollPlan {
    if (request.dice.length < 1 || request.dice.length > MAX_DICE_PER_ROLL) {
      throw new RangeError(
        `DirectRollPlanner supports between one and ${MAX_DICE_PER_ROLL} dice.`
      );
    }

    const throwForce = requireThrowForce(options.throwForce);
    const diceScale = requireDiceScale(options.diceScale);
    const frozenDice = resolveFrozenDice(options.frozenDice, request);
    const baseDiceSize = this.physicsOptions.diceSize ?? 1;
    const world = new DicePhysicsWorld({
      ...this.physicsOptions,
      diceSize: baseDiceSize * diceScale,
      ...(options.arenaBoundary ? { arenaBoundary: options.arenaBoundary } : {})
    });
    const physics = world.config;
    world.dispose();

    const desiredSpacing = this.configuredSlotSpacing === undefined
      ? physics.diceSize * 2.5
      : this.configuredSlotSpacing * diceScale;
    const spawnPoints = resolveDiceSpawnLayout(
      request.dice.map((definition) => definition.sides),
      physics,
      {
        desiredSpacing,
        customSpacing: this.configuredSlotSpacing !== undefined
      }
    );
    const dice = request.dice.map((definition, index) => {
      const spawnPoint = spawnPoints[index];

      if (!spawnPoint) {
        throw new RangeError(`Missing spawn point at index ${index}.`);
      }

      const frozen = frozenDice.get(index);

      return {
        sides: definition.sides,
        expectedValue: 0 as const,
        initialState: frozen
          ? {
              position: { ...frozen.position },
              quaternion: { ...frozen.quaternion },
              velocity: { x: 0, y: 0, z: 0 },
              angularVelocity: { x: 0, y: 0, z: 0 }
            }
          : this.createInitialState(
              spawnPoint,
              physics.diceSize,
              throwForce
            ),
        ...(frozen ? { frozenPhysicsMode: frozen.physicsMode } : {})
      };
    });

    return {
      rollId,
      dice,
      physics,
      stability: this.stability,
      simulationSteps: 0,
      preSimulated: false
    };
  }

  private createInitialState(
    spawnPoint: DiceSpawnPoint,
    size: number,
    throwForce: number
  ): RollInitialState {
    return {
      position: {
        x: spawnPoint.x,
        y: size * this.randomRange(2.2, 3.2),
        z: spawnPoint.z
      },
      quaternion: this.randomQuaternion(),
      velocity: {
        x: size * this.randomRange(-0.8, 0.8) * throwForce,
        y: size * this.randomRange(0.8, 2.0) * throwForce,
        z: size * this.randomRange(-0.8, 0.8) * throwForce
      },
      angularVelocity: {
        x: this.randomRange(-7, 7) * throwForce,
        y: this.randomRange(-7, 7) * throwForce,
        z: this.randomRange(-7, 7) * throwForce
      }
    };
  }

  private randomQuaternion(): PhysicsQuaternion {
    const u1 = this.randomSample();
    const u2 = this.randomSample();
    const u3 = this.randomSample();
    const root1 = Math.sqrt(1 - u1);
    const root2 = Math.sqrt(u1);
    const theta1 = Math.PI * 2 * u2;
    const theta2 = Math.PI * 2 * u3;

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
}
