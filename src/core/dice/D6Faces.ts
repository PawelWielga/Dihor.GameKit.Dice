export type D6FaceValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface D6FaceNormal {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const D6_FACE_VALUES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Canonical local-space face normals for D6 dice.
 * Opposite faces preserve the classic sum-to-seven arrangement.
 */
export const D6_FACE_NORMALS: Readonly<Record<D6FaceValue, D6FaceNormal>> = {
  1: { x: 0, y: 1, z: 0 },
  2: { x: 0, y: 0, z: 1 },
  3: { x: 1, y: 0, z: 0 },
  4: { x: -1, y: 0, z: 0 },
  5: { x: 0, y: 0, z: -1 },
  6: { x: 0, y: -1, z: 0 }
};

export const D6_OPPOSITE_FACE: Readonly<Record<D6FaceValue, D6FaceValue>> = {
  1: 6,
  2: 5,
  3: 4,
  4: 3,
  5: 2,
  6: 1
};

/** Returns the value of the physical face pointing most strongly toward world-space +Y. */
export function getD6TopValue(quaternion: QuaternionLike): D6FaceValue {
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    throw new RangeError("D6 orientation requires a finite, non-zero quaternion.");
  }

  const x = quaternion.x / magnitude;
  const y = quaternion.y / magnitude;
  const z = quaternion.z / magnitude;
  const w = quaternion.w / magnitude;

  const rotationRowY = {
    x: 2 * (x * y + w * z),
    y: 1 - 2 * (x * x + z * z),
    z: 2 * (y * z - w * x)
  };

  let bestValue: D6FaceValue = 1;
  let bestUpDot = Number.NEGATIVE_INFINITY;

  for (const value of D6_FACE_VALUES) {
    const normal = D6_FACE_NORMALS[value];
    const upDot =
      rotationRowY.x * normal.x + rotationRowY.y * normal.y + rotationRowY.z * normal.z;

    if (upDot > bestUpDot) {
      bestUpDot = upDot;
      bestValue = value;
    }
  }

  return bestValue;
}
