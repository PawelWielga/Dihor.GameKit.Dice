import {
  Float32BufferAttribute,
  Mesh,
  Vector3,
  type BufferGeometry
} from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import {
  getDiceTopology,
  type DiceSides,
  type DiceTopology,
  type DiceTopologyFace
} from "../../core/index.js";
import {
  DiceMeshFactory as BaseDiceMeshFactory,
  type DiceMesh,
  type DiceMeshFactoryOptions,
  type DiceMeshOptions
} from "./DiceMeshFactory.js";

const D8_REFERENCE_APEX = 0.5;
const D8_REFERENCE_RING_AXIS = 0.488692;
const D8_REFERENCE_RING_OFFSET = 0.025985;
const D8_REFERENCE_SHOULDER_AXIS = 0.484233;
const D8_REFERENCE_SHOULDER_OFFSET = 0.021526;
const D8_REFERENCE_FACE_PLANE =
  D8_REFERENCE_SHOULDER_AXIS + D8_REFERENCE_SHOULDER_OFFSET * 2;
const D8_OVERLAY_SCALE = D8_REFERENCE_FACE_PLANE / D8_REFERENCE_APEX;

// Express the approved D8 profile as topology-relative ratios so every other polyhedron can use
// the same visual language without copying a model or changing its project-owned face topology.
const REFERENCE_EDGE_TRAVEL = 0.037293;
const REFERENCE_EDGE_BULGE_RATIO = 0.014677;
const REFERENCE_FACE_TRAVEL = 0.074586;
const REFERENCE_FACE_BULGE_RATIO = 0.022278;

interface AxisProfile {
  readonly axis: Vector3;
  readonly firstPerpendicular: Vector3;
  readonly secondPerpendicular: Vector3;
}

interface ReferenceBodyGeometry {
  readonly geometry: BufferGeometry;
  readonly overlayScale: number;
}

const D8_AXES: readonly AxisProfile[] = [
  {
    axis: new Vector3(1, 0, 0),
    firstPerpendicular: new Vector3(0, 1, 0),
    secondPerpendicular: new Vector3(0, 0, 1)
  },
  {
    axis: new Vector3(0, 1, 0),
    firstPerpendicular: new Vector3(1, 0, 0),
    secondPerpendicular: new Vector3(0, 0, 1)
  },
  {
    axis: new Vector3(0, 0, 1),
    firstPerpendicular: new Vector3(1, 0, 0),
    secondPerpendicular: new Vector3(0, 1, 0)
  }
];

function appendD8TipProfile(points: Vector3[], profile: AxisProfile, sign: number): void {
  const shoulderCenter = profile.axis.clone().multiplyScalar(sign * D8_REFERENCE_SHOULDER_AXIS);

  for (const firstSign of [-1, 1]) {
    for (const secondSign of [-1, 1]) {
      points.push(
        shoulderCenter.clone()
          .addScaledVector(
            profile.firstPerpendicular,
            firstSign * D8_REFERENCE_SHOULDER_OFFSET
          )
          .addScaledVector(
            profile.secondPerpendicular,
            secondSign * D8_REFERENCE_SHOULDER_OFFSET
          )
      );
    }
  }

  const ringCenter = profile.axis.clone().multiplyScalar(sign * D8_REFERENCE_RING_AXIS);
  points.push(
    ringCenter.clone().addScaledVector(profile.firstPerpendicular, D8_REFERENCE_RING_OFFSET),
    ringCenter.clone().addScaledVector(profile.firstPerpendicular, -D8_REFERENCE_RING_OFFSET),
    ringCenter.clone().addScaledVector(profile.secondPerpendicular, D8_REFERENCE_RING_OFFSET),
    ringCenter.clone().addScaledVector(profile.secondPerpendicular, -D8_REFERENCE_RING_OFFSET)
  );
  points.push(profile.axis.clone().multiplyScalar(sign * D8_REFERENCE_APEX));
}

function addSphericalUvs(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute("position");
  const uvs: number[] = [];

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const radius = Math.max(Math.hypot(x, y, z), Number.EPSILON);
    const normalizedY = Math.max(-1, Math.min(1, y / radius));
    const u = 0.5 + Math.atan2(z, x) / (Math.PI * 2);
    const v = 0.5 - Math.asin(normalizedY) / Math.PI;
    uvs.push(u, v);
  }

  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}

function createConvexProfileGeometry(points: readonly Vector3[]): BufferGeometry {
  const hull = new ConvexGeometry(points);
  const geometry = mergeVertices(hull, 1e-6);
  hull.dispose();
  geometry.computeVertexNormals();
  addSphericalUvs(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createReferenceD8BodyGeometry(size: number): BufferGeometry {
  const topology = getDiceTopology(8);
  const targetExtent = topology.vertices.reduce(
    (extent, vertex) => Math.max(extent, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)),
    0
  ) * size;
  const scale = targetExtent / D8_REFERENCE_APEX;
  const points: Vector3[] = [];

  for (const profile of D8_AXES) {
    appendD8TipProfile(points, profile, 1);
    appendD8TipProfile(points, profile, -1);
  }

  for (const point of points) {
    point.multiplyScalar(scale);
  }

  return createConvexProfileGeometry(points);
}

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

    // Preserve the mathematical tip. The extra samples around it turn the sharp transition into
    // a small convex shoulder/ring, matching the approved D8 silhouette.
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

function calculateOverlayScale(
  topology: DiceTopology,
  size: number,
  points: readonly Vector3[]
): number {
  let overlayScale = 1;

  for (const face of topology.faces) {
    const normal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();
    const center = new Vector3(
      face.center.x * size,
      face.center.y * size,
      face.center.z * size
    );
    const basePlane = center.dot(normal);

    if (basePlane <= Number.EPSILON) {
      continue;
    }

    let supportPlane = basePlane;

    for (const point of points) {
      supportPlane = Math.max(supportPlane, point.dot(normal));
    }

    overlayScale = Math.max(overlayScale, supportPlane / basePlane);
  }

  return overlayScale;
}

function createReferenceBodyGeometry(
  sides: Exclude<DiceSides, 6>,
  size: number
): ReferenceBodyGeometry {
  if (sides === 8) {
    return {
      geometry: createReferenceD8BodyGeometry(size),
      overlayScale: D8_OVERLAY_SCALE
    };
  }

  const topology = getDiceTopology(sides);
  const points = createReferenceProfilePoints(topology, size);
  return {
    geometry: createConvexProfileGeometry(points),
    overlayScale: calculateOverlayScale(topology, size, points)
  };
}

function replaceReferenceBody(
  mesh: DiceMesh,
  sides: Exclude<DiceSides, 6>,
  size: number
): DiceMesh {
  const replacement = createReferenceBodyGeometry(sides, size);
  mesh.body.geometry = replacement.geometry;

  // The visual hull extends slightly beyond the original mathematical face planes. Move numeric
  // markings and optional per-face textures with those planes while keeping their face identity.
  for (const child of mesh.object.children) {
    if (child !== mesh.body && child instanceof Mesh) {
      child.scale.setScalar(replacement.overlayScale);
    }
  }

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
      replacement.geometry.dispose();
      baseDispose();
    }
  };
}

/**
 * Public mesh factory using the approved D8 rounded profile as the visual reference for every
 * polyhedral die. Logical topology and cannon-es colliders remain project-owned and unchanged.
 */
export class DiceMeshFactory extends BaseDiceMeshFactory {
  constructor(options: DiceMeshFactoryOptions = {}) {
    super(options);
  }

  override create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    const mesh = super.create(sides, options);

    if (sides === 6) {
      return mesh;
    }

    return replaceReferenceBody(mesh, sides, options.size ?? 1);
  }

  override createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    const pending = super.createAsync(sides, options);

    if (sides === 6) {
      return pending;
    }

    return pending.then((mesh) => replaceReferenceBody(mesh, sides, options.size ?? 1));
  }
}
