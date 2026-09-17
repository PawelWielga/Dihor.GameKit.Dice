import type { D6FaceValue } from "../core/dice/index.js";

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
}

export interface StabilityConfig {
  readonly linearThreshold: number;
  readonly angularThreshold: number;
  readonly consecutiveSteps: number;
  readonly maxSteps: number;
}

export interface RollPlanDie {
  readonly sides: 6;
  readonly expectedValue: D6FaceValue;
  readonly initialState: RollInitialState;
}

export interface RollPlan {
  readonly rollId: string;
  readonly dice: readonly RollPlanDie[];
  readonly physics: DicePhysicsConfig;
  readonly stability: StabilityConfig;
  readonly simulationSteps: number;
}
