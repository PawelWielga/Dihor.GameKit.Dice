import {
  getDiceFace,
  getDiceTopology,
  type RandomProvider
} from "../core/index.js";
import {
  DEFAULT_DICE_PHYSICS_CONFIG,
  type DicePhysicsWorldOptions
} from "./DicePhysicsWorld.js";
import {
  RollPlanner as BaseRollPlanner,
  type RollInitialStateContext,
  type RollInitialStateProvider,
  type RollPlannerOptions
} from "./RollPlanner.js";
import type {
  PhysicsQuaternion,
  PhysicsVector3,
  RollInitialState
} from "./RollModels.js";

const mathRandomProvider: RandomProvider = {
  next: () => Math.random()
};

function normalizeVector(vector: PhysicsVector3): PhysicsVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new RangeError("Cannot normalize an invalid throw direction.");
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function normalizeQuaternion(quaternion: PhysicsQuaternion): PhysicsQuaternion {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new RangeError("Cannot normalize an invalid quaternion.");
  }

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length
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
  from: PhysicsVector3,
  to: PhysicsVector3
): PhysicsQuaternion {
  const a = normalizeVector(from);
  const b = normalizeVector(to);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;

  if (dot < -0.999999) {
    const reference = Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const axis = normalizeVector({
      x: a.y * reference.z - a.z * reference.y,
      y: a.z * reference.x - a.x * reference.z,
      z: a.x * reference.y - a.y * reference.x
    });
    return { ...axis, w: 0 };
  }

  return normalizeQuaternion({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
    w: 1 + dot
  });
}

function quaternionFromAxisAngle(axisValue: PhysicsVector3, angle: number): PhysicsQuaternion {
  const axis = normalizeVector(axisValue);
  const halfAngle = angle / 2;
  const sinHalfAngle = Math.sin(halfAngle);

  return {
    x: axis.x * sinHalfAngle,
    y: axis.y * sinHalfAngle,
    z: axis.z * sinHalfAngle,
    w: Math.cos(halfAngle)
  };
}

function rotatedY(vector: PhysicsVector3, quaternion: PhysicsQuaternion): number {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);
  return vector.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz);
}

function sample(provider: RandomProvider): number {
  const value = provider.next();

  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(
      `RandomProvider.next() must return a finite value in [0, 1); received ${String(value)}.`
    );
  }

  return value;
}

function range(provider: RandomProvider, min: number, max: number): number {
  return min + (max - min) * sample(provider);
}

function naturalFactor(attempt: number, maxAttempts: number): number {
  if (maxAttempts <= 1) {
    return 1;
  }

  const progress = (attempt - 1) / (maxAttempts - 1);

  if (progress <= 0.6) {
    return 1;
  }

  return Math.max(0, 1 - (progress - 0.6) / 0.4);
}

function effectiveAngularTravelTime(
  fallTime: number,
  angularDamping: number
): number {
  if (angularDamping <= Number.EPSILON) {
    return fallTime;
  }

  const retainedPerSecond = Math.max(1 - angularDamping, 1e-6);
  const decayRate = -Math.log(retainedPerSecond);
  return (1 - Math.exp(-decayRate * fallTime)) / decayRate;
}

function createD6State(context: RollInitialStateContext, random: RandomProvider): RollInitialState {
  const size = context.diceSize;

  return {
    position: {
      x: context.slotX,
      y: size * range(random, 2.2, 3.8),
      z: 0
    },
    quaternion: randomQuaternion(random),
    velocity: {
      x: 0,
      y: size * range(random, 0.6, 2.4),
      z: 0
    },
    angularVelocity: {
      x: range(random, -7.5, 7.5),
      y: range(random, -7.5, 7.5),
      z: range(random, -7.5, 7.5)
    }
  };
}

function randomQuaternion(random: RandomProvider): PhysicsQuaternion {
  const u1 = sample(random);
  const u2 = sample(random);
  const u3 = sample(random);
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

function createPolyhedralState(
  context: RollInitialStateContext,
  random: RandomProvider,
  physics: DicePhysicsWorldOptions,
  maxAttempts: number
): RollInitialState {
  const size = context.diceSize;
  const topology = getDiceTopology(context.sides);
  const resultFace = getDiceFace(context.sides, context.expectedValue);
  const targetY = topology.resultDirection === "up" ? 1 : -1;
  const aligned = quaternionFromDirections(resultFace.normal, { x: 0, y: targetY, z: 0 });
  const yaw = range(random, 0, Math.PI * 2);
  const yawQuaternion = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
  const restingOrientation = multiplyQuaternions(yawQuaternion, aligned);
  const motionFactor = naturalFactor(context.attempt, maxAttempts);

  const baseAngle = range(random, Math.PI / 6, Math.PI / 3);
  const quadrant = Math.floor(sample(random) * 4);
  const azimuth = baseAngle + quadrant * (Math.PI / 2);
  const tumbleAxis = normalizeVector({
    x: Math.cos(azimuth),
    y: range(random, -0.22, 0.22) * motionFactor,
    z: Math.sin(azimuth)
  });
  const naturalPhase = context.sides === 100
    ? range(random, 0.38, 0.58)
    : context.sides >= 20
      ? range(random, 0.7, 1.05)
      : range(random, 0.85, 1.25);
  const phase = naturalPhase * motionFactor;
  const preTilt = quaternionFromAxisAngle(tumbleAxis, -phase);
  const quaternion = multiplyQuaternions(preTilt, restingOrientation);
  const supportY = -Math.min(
    ...topology.vertices.map((vertex) => rotatedY(vertex, quaternion))
  ) * size;

  const safeDrop = size * (context.sides === 100 ? 0.04 : 0.2);
  const naturalDrop = size * (context.sides === 100
    ? range(random, 1.8, 2.3)
    : range(random, 2.0, 2.8));
  const dropHeight = safeDrop + (naturalDrop - safeDrop) * motionFactor;
  const gravityY = Math.max(
    Math.abs(physics.gravity?.y ?? DEFAULT_DICE_PHYSICS_CONFIG.gravity.y),
    0.1
  );
  const fallTime = Math.sqrt((2 * dropHeight) / gravityY);
  const angularDamping = physics.angularDamping ?? DEFAULT_DICE_PHYSICS_CONFIG.angularDamping;
  const travelTime = Math.max(
    effectiveAngularTravelTime(fallTime, angularDamping),
    1e-3
  );
  const travelFraction = context.sides === 100 ? 0.76 : 0.8;
  const angularSpeed = phase <= Number.EPSILON
    ? 0
    : (phase * travelFraction) / travelTime;

  return {
    position: {
      x: context.slotX,
      y: supportY + dropHeight,
      z: 0
    },
    quaternion,
    velocity: {
      x: size * range(random, -0.12, 0.12) * motionFactor,
      y: 0,
      z: size * range(random, -0.28, 0.28) * motionFactor
    },
    angularVelocity: {
      x: tumbleAxis.x * angularSpeed,
      y: tumbleAxis.y * angularSpeed,
      z: tumbleAxis.z * angularSpeed
    }
  };
}

/**
 * Creates the default initial-state strategy used by the public RollPlanner.
 * Early candidates visibly tumble from well above the table. Later retries gradually become more
 * conservative so difficult shapes such as D100 still have a bounded path to the expected face.
 */
export function createNaturalRollInitialStateProvider(
  random: RandomProvider = mathRandomProvider,
  physics: DicePhysicsWorldOptions = {},
  maxAttempts = 36
): RollInitialStateProvider {
  return (context) =>
    context.sides === 6
      ? createD6State(context, random)
      : createPolyhedralState(context, random, physics, maxAttempts);
}

/** Public RollPlanner with natural-looking default polyhedral throw candidates. */
export class RollPlanner extends BaseRollPlanner {
  constructor(options: RollPlannerOptions = {}) {
    if (options.initialStateProvider) {
      super(options);
      return;
    }

    const randomProvider = options.randomProvider ?? mathRandomProvider;
    const maxAttempts = options.maxAttemptsPerDie ?? 36;

    super({
      ...options,
      randomProvider,
      initialStateProvider: createNaturalRollInitialStateProvider(
        randomProvider,
        options.physics,
        maxAttempts
      )
    });
  }
}
