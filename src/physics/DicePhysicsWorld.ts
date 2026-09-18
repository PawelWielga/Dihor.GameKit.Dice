import { Body, Box, Plane, Vec3, World } from "cannon-es";
import {
  getDiceValueFromOrientation,
  type D6FaceValue,
  type DiceSides
} from "../core/index.js";
import { createDiceCollider } from "./dice/index.js";
import type {
  DiceArenaBoundaryPoint,
  DicePhysicsConfig,
  PhysicsQuaternion,
  PhysicsVector3,
  RollInitialState,
  StabilityConfig
} from "./RollModels.js";

export interface DicePhysicsWorldOptions {
  readonly gravity?: PhysicsVector3;
  readonly timeStep?: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly diceSize?: number;
  readonly arenaHalfExtent?: number;
  readonly arenaBoundary?: readonly DiceArenaBoundaryPoint[];
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
  diceSize: 1,
  arenaHalfExtent: 5
};

export const DEFAULT_STABILITY_CONFIG: StabilityConfig = {
  linearThreshold: 0.08,
  angularThreshold: 0.08,
  consecutiveSteps: 10,
  maxSteps: 480
};

const ARENA_BOUNDARY_EPSILON = 1e-4;

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

function resolveArenaBoundary(
  boundary: readonly DiceArenaBoundaryPoint[] | undefined
): readonly DiceArenaBoundaryPoint[] | undefined {
  if (boundary === undefined) {
    return undefined;
  }

  if (boundary.length < 3) {
    throw new RangeError("arenaBoundary must contain at least three points.");
  }

  const resolved = boundary.map((point, index) => ({
    x: requireFinite(`arenaBoundary[${index}].x`, point.x),
    z: requireFinite(`arenaBoundary[${index}].z`, point.z)
  }));

  for (let index = 0; index < resolved.length; index += 1) {
    const current = resolved[index]!;
    const next = resolved[(index + 1) % resolved.length]!;
    if (Math.hypot(next.x - current.x, next.z - current.z) <= Number.EPSILON) {
      throw new RangeError(`arenaBoundary edge ${index} must have non-zero length.`);
    }
  }

  return resolved;
}

function arenaBoundariesEqual(
  left: readonly DiceArenaBoundaryPoint[],
  right: readonly DiceArenaBoundaryPoint[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((point, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      Math.abs(point.x - other.x) <= ARENA_BOUNDARY_EPSILON &&
      Math.abs(point.z - other.z) <= ARENA_BOUNDARY_EPSILON
    );
  });
}

function createSquareArenaBoundary(extent: number): readonly DiceArenaBoundaryPoint[] {
  return [
    { x: -extent, z: -extent },
    { x: extent, z: -extent },
    { x: extent, z: extent },
    { x: -extent, z: extent }
  ];
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
  const diceSize = requirePositive(
    "diceSize",
    options.diceSize ?? DEFAULT_DICE_PHYSICS_CONFIG.diceSize
  );
  const defaultArenaScale =
    DEFAULT_DICE_PHYSICS_CONFIG.arenaHalfExtent / DEFAULT_DICE_PHYSICS_CONFIG.diceSize;

  const arenaBoundary = resolveArenaBoundary(options.arenaBoundary);

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
    diceSize,
    arenaHalfExtent: requirePositive(
      "arenaHalfExtent",
      options.arenaHalfExtent ?? diceSize * defaultArenaScale
    ),
    ...(arenaBoundary ? { arenaBoundary } : {})
  };
}

export function resolveStabilityConfig(options: StabilityOptions = {}): StabilityConfig {
  return {
    linearThreshold: requirePositive(
      "linearThreshold",
      options.linearThreshold ?? DEFAULT_STABILITY_CONFIG.linearThreshold
    ),
    angularThreshold: requirePositive(
      "angularThreshold",
      options.angularThreshold ?? DEFAULT_STABILITY_CONFIG.angularThreshold
    ),
    consecutiveSteps: requirePositiveInteger(
      "consecutiveSteps",
      options.consecutiveSteps ?? DEFAULT_STABILITY_CONFIG.consecutiveSteps
    ),
    maxSteps: requirePositiveInteger(
      "maxSteps",
      options.maxSteps ?? DEFAULT_STABILITY_CONFIG.maxSteps
    )
  };
}

/** Thin cannon-es wrapper used by both hidden planning and visible playback. */
export class DicePhysicsWorld {
  readonly world: World;
  readonly config: DicePhysicsConfig;

  private readonly staticBodies: Body[] = [];
  private readonly arenaWallBodies: Body[] = [];
  private activeArenaBoundary: readonly DiceArenaBoundaryPoint[];
  private disposed = false;

  constructor(options: DicePhysicsWorldOptions = {}) {
    this.config = resolveConfig(options);
    this.activeArenaBoundary =
      this.config.arenaBoundary ?? createSquareArenaBoundary(this.config.arenaHalfExtent);
    this.world = new World({
      gravity: new Vec3(this.config.gravity.x, this.config.gravity.y, this.config.gravity.z)
    });
    this.world.defaultContactMaterial.friction = this.config.friction;
    this.world.defaultContactMaterial.restitution = this.config.restitution;

    this.createFloor();
    this.createArenaWalls(this.activeArenaBoundary);
  }

  /**
   * Rebuilds only the static arena walls while preserving every dynamic die body and its state.
   * Returns false when the new polygon is meaningfully equivalent to the active boundary.
   */
  updateArenaBoundary(boundary: readonly DiceArenaBoundaryPoint[]): boolean {
    this.assertActive();
    const resolved = resolveArenaBoundary(boundary);

    if (!resolved || arenaBoundariesEqual(this.activeArenaBoundary, resolved)) {
      return false;
    }

    this.removeArenaWalls();
    this.activeArenaBoundary = resolved;
    this.createArenaWalls(resolved);
    return true;
  }

  addDie(sides: DiceSides, initialState: RollInitialState): Body {
    this.assertActive();
    validateVector("position", initialState.position);
    validateQuaternion("quaternion", initialState.quaternion);
    validateVector("velocity", initialState.velocity);
    validateVector("angularVelocity", initialState.angularVelocity);

    const body = new Body({ mass: 1 });
    body.addShape(createDiceCollider(sides, this.config.diceSize));
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

  /** Backward-compatible D6 convenience wrapper. */
  addD6(initialState: RollInitialState): Body {
    return this.addDie(6, initialState);
  }

  step(): void {
    this.assertActive();
    this.world.step(this.config.timeStep);
  }

  getDieValue(sides: DiceSides, body: Body): number {
    return getDiceValueFromOrientation(sides, body.quaternion);
  }

  /** Backward-compatible D6 convenience wrapper. */
  getD6Value(body: Body): D6FaceValue {
    return this.getDieValue(6, body) as D6FaceValue;
  }

  areBodiesStable(
    bodies: readonly Body[],
    linearThreshold = DEFAULT_STABILITY_CONFIG.linearThreshold,
    angularThreshold = DEFAULT_STABILITY_CONFIG.angularThreshold
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

    const stability = resolveStabilityConfig(options);
    let stableSteps = 0;

    for (let step = 1; step <= stability.maxSteps; step += 1) {
      this.step();

      if (
        this.areBodiesStable(
          bodies,
          stability.linearThreshold,
          stability.angularThreshold
        )
      ) {
        stableSteps += 1;

        if (stableSteps >= stability.consecutiveSteps) {
          return { stable: true, steps: step };
        }
      } else {
        stableSteps = 0;
      }
    }

    return { stable: false, steps: stability.maxSteps };
  }

  removeBody(body: Body): void {
    if (!this.disposed && !this.staticBodies.includes(body)) {
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

    this.staticBodies.length = 0;
    this.arenaWallBodies.length = 0;
    this.disposed = true;
  }

  private createFloor(): void {
    const floor = new Body({ mass: 0 });
    floor.addShape(new Plane());
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    this.staticBodies.push(floor);
  }

  private createArenaWalls(boundary: readonly DiceArenaBoundaryPoint[]): void {
    const thickness = this.config.diceSize * 0.25;
    const wallHeight = this.config.diceSize * 10;
    const halfHeight = wallHeight / 2;

    for (let index = 0; index < boundary.length; index += 1) {
      const start = boundary[index]!;
      const end = boundary[(index + 1) % boundary.length]!;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      const center = new Vec3((start.x + end.x) / 2, halfHeight, (start.z + end.z) / 2);
      const yaw = -Math.atan2(dz, dx);

      const wall = this.addStaticBox(
        new Vec3(length / 2 + thickness / 2, halfHeight, thickness / 2),
        center,
        yaw
      );
      this.arenaWallBodies.push(wall);
    }
  }

  private removeArenaWalls(): void {
    for (const wall of this.arenaWallBodies) {
      this.world.removeBody(wall);
      const staticIndex = this.staticBodies.indexOf(wall);

      if (staticIndex >= 0) {
        this.staticBodies.splice(staticIndex, 1);
      }
    }

    this.arenaWallBodies.length = 0;
  }

  private addStaticBox(halfExtents: Vec3, position: Vec3, yaw = 0): Body {
    const body = new Body({ mass: 0 });
    body.addShape(new Box(halfExtents));
    body.position.copy(position);
    body.quaternion.setFromEuler(0, yaw, 0);
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("DicePhysicsWorld has been disposed.");
    }
  }
}
