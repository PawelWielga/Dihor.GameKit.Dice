import type { DiceSides } from "../core/index.js";

export interface PhysicsVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PhysicsQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** A point on the table plane used by the invisible physical arena boundary. */
export interface DiceArenaBoundaryPoint {
  readonly x: number;
  readonly z: number;
}

export interface RollInitialState {
  readonly position: PhysicsVector3;
  readonly quaternion: PhysicsQuaternion;
  readonly velocity: PhysicsVector3;
  readonly angularVelocity: PhysicsVector3;
}

export interface DicePhysicsConfig {
  readonly gravity: PhysicsVector3;
  readonly timeStep: number;
  readonly friction: number;
  readonly restitution: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly diceSize: number;
  readonly arenaHalfExtent: number;
  /** Optional convex table-plane polygon. When present it replaces the legacy square arena. */
  readonly arenaBoundary?: readonly DiceArenaBoundaryPoint[];
}

export interface StabilityConfig {
  readonly linearThreshold: number;
  readonly angularThreshold: number;
  readonly consecutiveSteps: number;
  readonly maxSteps: number;
}

export interface RollPlanDie {
  readonly sides: DiceSides;
  readonly expectedValue: number;
  readonly initialState: RollInitialState;
}

export interface RollPlan {
  readonly rollId: string;
  readonly dice: readonly RollPlanDie[];
  readonly physics: DicePhysicsConfig;
  readonly stability: StabilityConfig;
  readonly simulationSteps: number;
}
