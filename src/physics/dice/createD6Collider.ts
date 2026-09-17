import { Box, Vec3 } from "cannon-es";

/** Creates a stable box collider matching the D6 body envelope, independent of render detail. */
export function createD6Collider(size = 1): Box {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`D6 collider size must be a positive finite number; received ${String(size)}.`);
  }

  const halfExtent = size / 2;
  return new Box(new Vec3(halfExtent, halfExtent, halfExtent));
}
