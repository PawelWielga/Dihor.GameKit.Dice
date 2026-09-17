import { Body, Plane, Vec3, World } from "cannon-es";
import { getD6TopValue, type D6FaceValue } from "../core/dice/index.js";
import { createD6Collider } from "./dice/index.js";
import type {
  DicePhysicsConfig,
  PhysicsQuaternion,
  PhysicsVector3,
  RollInitialState
} from "./RollModels.js";

export interface DicePhysicsWorldOptions {
  readonly gravity?: PhysicsVector3;
  readonly timeStep?: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly diceSize?: number;
}

export interface StabilityOptions {
  readonly linearThreshold?: number;
  readonly angularThreshold?: number;
  readonly consecutiveSteps?: number;
  readonly maxSteps?: number;
}

export interface StabilityResult {
  readonly stable: boolean;
  readonly steps: number;
}

export const DEFAULT_DICE_PHYSICS_CONFIG: DicePhysicsConfig = {
  gravity: { x: 0, y: -9.82, z: 0 },
  timeStep: 1 / 60,
  friction: 0.35,
  restitution: 0.22,
  linearDamping: 0.12,
  angularDamping: 0.16,
  diceSize: 1
};

function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite; received ${String(value)}.`);
  }

  return value;
}

function requirePositive(name: string, value: number): number {
  requireFinite(name, value);

  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero; received ${String(value)}.`);
  }

  return value;
}

function requirePositiveInteger(name: string, value: number): number {
  requirePositive(name, value);

  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer; received ${String(value)}.`);
  }

  return value;
}

function requireUnitInterval(name: string, value: number): number {
  requireFinite(name, value);

  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be in the range 0..1; received ${String(value)}.`);
  }

  return value;
}

function validateVector(name: string, vector: PhysicsVector3): void {
  requireFinite(`${name}.x`, vector.x);
  requireFinite(`${name}.y`, vector.y);
  requireFinite(`${name}.z`, vector.z);
}

function validateQuaternion(name: string, quaternion: PhysicsQuaternion): void {
  requireFinite(`${name}.x`, quaternion.x);
  requireFinite(`${name}.y`, quaternion.y);
  requireFinite(`${name}.z`, quaternion.z);
  requireFinite(`${name}.w`, quaternion.w);

  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (magnitude <= Number.EPSILON) {
    throw new RangeError(`${name} must be non-zero.`);
  }
}

function resolveConfig(options: DicePhysicsWorldOptions): DicePhysicsConfig {
  const gravity = options.gravity ?? DEFAULT_DICE_PHYSICS_CONFIG.gravity;

  return {
    gravity: {
      x: requireFinite("gravity.x", gravity.x),
      y: requireFinite("gravity.y", gravity.y),
      z: requireFinite("gravity.z", gravity.z)
    },
    timeStep: requirePositive("timeStep", options.timeStep ?? DEFAULT_DICE_PHYSICS_CONFIG.timeStep),
    friction: requireUnitInterval("friction", options.friction ?? DEFAULT_DICE_PHYSICS_CONFIG.friction),
    restitution: requireUnitInterval(
      "restitution",
      options.restitution ?? DEFAULT_DICE_PHYSICS_CONFIG.restitution
    ),
    linearDamping: requireUnitInterval(
      "linearDamping",
      options.linearDamping ?? DEFAULT_DICE_PHYSICS_CONFIG.linearDamping
    ),
    angularDamping: requireUnitInterval(
      "angularDamping",
      options.angularDamping ?? DEFAULT_DICE_PHYSICS_CONFIG.angularDamping
    ),
    diceSize: requirePositive("diceSize", options.diceSize ?? DEFAULT_DICE_PHYSICS_CONFIG.diceSize)
  };
}

/** Thin cannon-es wrapper used by both hidden planning and visible playback. */
export class DicePhysicsWorld {
  readonly world: World;
  readonly config: DicePhysicsConfig;

  private readonly floorBody: Body;
  private disposed = false;

  constructor(options: DicePhysicsWorldOptions = {}) {
    this.config = resolveConfig(options);
    this.world = new World({
      gravity: new Vec3(this.config.gravity.x, this.config.gravity.y, this.config.gravity.z)
    });
    this.world.defaultContactMaterial.friction = this.config.friction;
    this.world.defaultContactMaterial.restitution = this.config.restitution;

    this.floorBody = new Body({ mass: 0 });
    this.floorBody.addShape(new Plane());
    this.floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.floorBody);
  }

  addD6(initialState: RollInitialState): Body {
    this.assertActive();
    validateVector("position", initialState.position);
    validateQuaternion("quaternion", initialState.quaternion);
    validateVector("velocity", initialState.velocity);
    validateVector("angularVelocity", initialState.angularVelocity);

    const body = new Body({ mass: 1 });
    body.addShape(createD6Collider(this.config.diceSize));
    body.position.set(
      initialState.position.x,
      initialState.position.y,
      initialState.position.z
    );
    body.quaternion.set(
      initialState.quaternion.x,
      initialState.quaternion.y,
      initialState.quaternion.z,
      initialState.quaternion.w
    );
    body.quaternion.normalize();
    body.velocity.set(initialState.velocity.x, initialState.velocity.y, initialState.velocity.z);
    body.angularVelocity.set(
      initialState.angularVelocity.x,
      initialState.angularVelocity.y,
      initialState.angularVelocity.z
    );
    body.linearDamping = this.config.linearDamping;
    body.angularDamping = this.config.angularDamping;

    this.world.addBody(body);
    return body;
  }

  step(): void {
    this.assertActive();
    this.world.step(this.config.timeStep);
  }

  getD6Value(body: Body): D6FaceValue {
    return getD6TopValue(body.quaternion);
  }

  areBodiesStable(
    bodies: readonly Body[],
    linearThreshold = 0.08,
    angularThreshold = 0.08
  ): boolean {
    requirePositive("linearThreshold", linearThreshold);
    requirePositive("angularThreshold", angularThreshold);

    const linearThresholdSquared = linearThreshold * linearThreshold;
    const angularThresholdSquared = angularThreshold * angularThreshold;

    return bodies.every(
      (body) =>
        body.velocity.lengthSquared() <= linearThresholdSquared &&
        body.angularVelocity.lengthSquared() <= angularThresholdSquared
    );
  }

  simulateUntilStable(
    bodies: readonly Body[],
    options: StabilityOptions = {}
  ): StabilityResult {
    if (bodies.length === 0) {
      throw new RangeError("Stability simulation requires at least one body.");
    }

    const linearThreshold = requirePositive(
      "linearThreshold",
      options.linearThreshold ?? 0.08
    );
    const angularThreshold = requirePositive(
      "angularThreshold",
      options.angularThreshold ?? 0.08
    );
    const consecutiveSteps = requirePositiveInteger(
      "consecutiveSteps",
      options.consecutiveSteps ?? 10
    );
    const maxSteps = requirePositiveInteger("maxSteps", options.maxSteps ?? 480);

    let stableSteps = 0;

    for (let step = 1; step <= maxSteps; step += 1) {
      this.step();

      if (this.areBodiesStable(bodies, linearThreshold, angularThreshold)) {
        stableSteps += 1;

        if (stableSteps >= consecutiveSteps) {
          return { stable: true, steps: step };
        }
      } else {
        stableSteps = 0;
      }
    }

    return { stable: false, steps: maxSteps };
  }

  removeBody(body: Body): void {
    if (!this.disposed && body !== this.floorBody) {
      this.world.removeBody(body);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const body of [...this.world.bodies]) {
      this.world.removeBody(body);
    }

    this.disposed = true;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("DicePhysicsWorld has been disposed.");
    }
  }
}
