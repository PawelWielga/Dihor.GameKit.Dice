import { ConvexPolyhedron, type Shape, Vec3 } from "cannon-es";
import { getDiceTopology, type DiceSides } from "../../core/index.js";
import { createD6Collider } from "./createD6Collider.js";

function validateSize(sides: DiceSides, size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(
      `D${sides} collider size must be a positive finite number; received ${String(size)}.`
    );
  }

  return size;
}

/** Creates a simple stable collider from the same physical topology used by rendering and result mapping. */
export function createDiceCollider(sides: DiceSides, size = 1): Shape {
  validateSize(sides, size);

  if (sides === 6) {
    return createD6Collider(size);
  }

  const topology = getDiceTopology(sides);
  const vertices = topology.vertices.map(
    (vertex) => new Vec3(vertex.x * size, vertex.y * size, vertex.z * size)
  );
  const faces = topology.faces.map((face) => [...face.vertexIndices]);

  return new ConvexPolyhedron({ vertices, faces });
}
