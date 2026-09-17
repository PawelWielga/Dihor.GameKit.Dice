import {
  Vector3,
  type BufferGeometry
} from "three";
import {
  getDiceTopology,
  type DiceSides,
  type DiceTopology,
  type DiceTopologyFace
} from "../../core/index.js";
import {
  DiceMeshFactory as ReferenceDiceMeshFactory
} from "./ReferenceDiceMeshFactory.js";
import type {
  DiceMesh,
  DiceMeshFactoryOptions,
  DiceMeshOptions
} from "./DiceMeshFactory.js";
import { createSmoothConvexProfileGeometry } from "./ReferenceGeometryUtils.js";

// Keep D6 visually consistent with the approved D8 profile while preserving the established
// D6 outer size, face mapping, pips and physics collider.
const REFERENCE_EDGE_TRAVEL = 0.037293;
const REFERENCE_EDGE_BULGE_RATIO = 0.014677;
const REFERENCE_FACE_TRAVEL = 0.074586;
const REFERENCE_FACE_BULGE_RATIO = 0.022278;

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function scaledTopologyVertex(topology: DiceTopology, index: number, size: number): Vector3 {
  const vertex = topology.vertices[index];

  if (!vertex) {
    throw new RangeError(`D${topology.sides} topology references missing vertex ${index}.`);
  }

  return new Vector3(vertex.x * size, vertex.y * size, vertex.z * size);
}

function createReferenceProfilePoints(topology: DiceTopology, size: number): Vector3[] {
  const scaledVertices = topology.vertices.map(
    (vertex) => new Vector3(vertex.x * size, vertex.y * size, vertex.z * size)
  );
  const incidentFaces = topology.vertices.map(() => [] as DiceTopologyFace[]);
  const adjacentVertices = topology.vertices.map(() => new Set<number>());
  const normalsByEdge = new Map<string, Vector3[]>();

  for (const face of topology.faces) {
    const faceNormal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();

    for (const vertexIndex of face.vertexIndices) {
      const faces = incidentFaces[vertexIndex];

      if (!faces) {
        throw new RangeError(`D${topology.sides} face ${face.value} references missing vertex ${vertexIndex}.`);
      }

      faces.push(face);
    }

    for (let index = 0; index < face.vertexIndices.length; index += 1) {
      const first = face.vertexIndices[index]!;
      const second = face.vertexIndices[(index + 1) % face.vertexIndices.length]!;
      const firstAdjacent = adjacentVertices[first];
      const secondAdjacent = adjacentVertices[second];

      if (!firstAdjacent || !secondAdjacent) {
        throw new RangeError(`D${topology.sides} face ${face.value} contains an invalid edge.`);
      }

      firstAdjacent.add(second);
      secondAdjacent.add(first);

      const key = edgeKey(first, second);
      const normals = normalsByEdge.get(key);

      if (normals) {
        normals.push(faceNormal.clone());
      } else {
        normalsByEdge.set(key, [faceNormal.clone()]);
      }
    }
  }

  const points: Vector3[] = [];

  for (let vertexIndex = 0; vertexIndex < scaledVertices.length; vertexIndex += 1) {
    const original = scaledVertices[vertexIndex];
    const adjacent = adjacentVertices[vertexIndex];
    const faces = incidentFaces[vertexIndex];

    if (!original || !adjacent || !faces) {
      throw new RangeError(`D${topology.sides} is missing reference-profile data for vertex ${vertexIndex}.`);
    }

    points.push(original.clone());

    for (const neighborIndex of adjacent) {
      const neighbor = scaledVertices[neighborIndex];
      const edgeNormals = normalsByEdge.get(edgeKey(vertexIndex, neighborIndex));

      if (!neighbor || !edgeNormals || edgeNormals.length === 0) {
        throw new RangeError(`D${topology.sides} is missing an adjacent edge profile.`);
      }

      const outward = edgeNormals.reduce(
        (sum, normal) => sum.add(normal),
        new Vector3()
      );

      if (outward.lengthSq() <= Number.EPSILON) {
        throw new RangeError(`D${topology.sides} contains a degenerate edge profile.`);
      }

      outward.normalize();
      const edgeLength = original.distanceTo(neighbor);
      points.push(
        original.clone()
          .lerp(neighbor, REFERENCE_EDGE_TRAVEL)
          .addScaledVector(outward, edgeLength * REFERENCE_EDGE_BULGE_RATIO)
      );
    }

    for (const face of faces) {
      const localIndex = face.vertexIndices.indexOf(vertexIndex);

      if (localIndex < 0) {
        throw new RangeError(`D${topology.sides} face ${face.value} is missing vertex ${vertexIndex}.`);
      }

      const previousIndex = face.vertexIndices[
        (localIndex - 1 + face.vertexIndices.length) % face.vertexIndices.length
      ]!;
      const nextIndex = face.vertexIndices[(localIndex + 1) % face.vertexIndices.length]!;
      const previous = scaledTopologyVertex(topology, previousIndex, size);
      const next = scaledTopologyVertex(topology, nextIndex, size);
      const localEdgeLength =
        (original.distanceTo(previous) + original.distanceTo(next)) / 2;
      const faceCenter = new Vector3(
        face.center.x * size,
        face.center.y * size,
        face.center.z * size
      );
      const faceNormal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();

      points.push(
        original.clone()
          .lerp(faceCenter, REFERENCE_FACE_TRAVEL)
          .addScaledVector(faceNormal, localEdgeLength * REFERENCE_FACE_BULGE_RATIO)
      );
    }
  }

  return points;
}

function normalizeProfileExtent(points: Vector3[], targetExtent: number): void {
  const currentExtent = points.reduce(
    (extent, point) => Math.max(extent, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)),
    0
  );

  if (!Number.isFinite(currentExtent) || currentExtent <= Number.EPSILON) {
    throw new RangeError("D6 reference profile has a degenerate extent.");
  }

  const scale = targetExtent / currentExtent;

  for (const point of points) {
    point.multiplyScalar(scale);
  }
}

function createReferenceD6BodyGeometry(size: number): BufferGeometry {
  const topology = getDiceTopology(6);
  const points = createReferenceProfilePoints(topology, size);

  // The D8-derived bulge samples intentionally extend past the mathematical face planes. For D6
  // normalize them back to the established cube extent so the visible size and collider stay aligned.
  normalizeProfileExtent(points, size / 2);
  return createSmoothConvexProfileGeometry(points);
}

function replaceD6Body(mesh: DiceMesh, size: number): DiceMesh {
  const replacement = createReferenceD6BodyGeometry(size);
  const previousGeometry = mesh.body.geometry;
  mesh.body.geometry = replacement;
  previousGeometry.dispose();

  const baseDispose = mesh.dispose.bind(mesh);
  let disposed = false;

  return {
    sides: mesh.sides,
    object: mesh.object,
    body: mesh.body,
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      replacement.dispose();
      baseDispose();
    }
  };
}

/** Uses the approved D8-derived visual language for D6 as well as the remaining polyhedral dice. */
export class DiceMeshFactory extends ReferenceDiceMeshFactory {
  constructor(options: DiceMeshFactoryOptions = {}) {
    super(options);
  }

  override create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    const mesh = super.create(sides, options);
    return sides === 6 ? replaceD6Body(mesh, options.size ?? 1) : mesh;
  }

  override createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    const pending = super.createAsync(sides, options);
    return sides === 6
      ? pending.then((mesh) => replaceD6Body(mesh, options.size ?? 1))
      : pending;
  }
}
