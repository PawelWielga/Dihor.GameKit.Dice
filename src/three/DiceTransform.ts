export interface DiceVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DiceQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Framework- and physics-engine-independent transform consumed by the Three.js layer. */
export interface DiceTransform {
  readonly position: DiceVector3;
  readonly quaternion: DiceQuaternion;
}
