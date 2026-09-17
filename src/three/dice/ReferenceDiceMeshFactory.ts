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
  type DiceSides
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

interface AxisProfile {
  readonly axis: Vector3;
  readonly firstPerpendicular: Vector3;
  readonly secondPerpendicular: Vector3;
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

  const hull = new ConvexGeometry(points);
  const geometry = mergeVertices(hull, 1e-6);
  hull.dispose();
  geometry.computeVertexNormals();
  addSphericalUvs(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function replaceD8Body(mesh: DiceMesh, size: number): DiceMesh {
  const replacement = createReferenceD8BodyGeometry(size);
  mesh.body.geometry = replacement;

  // The reference D8 keeps the approved apex-to-apex size, while its flat face planes sit
  // slightly farther from the origin than the mathematical octahedron. Move markings and
  // optional face overlays with those planes so they remain visible and physically associated
  // with the same face.
  for (const child of mesh.object.children) {
    if (child !== mesh.body && child instanceof Mesh) {
      child.scale.setScalar(D8_OVERLAY_SCALE);
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
      replacement.dispose();
      baseDispose();
    }
  };
}

/**
 * Public mesh factory with a reference-profile D8 body. The logical D8 topology and cannon-es
 * collider remain project-owned and unchanged; only the Three.js render geometry is replaced.
 */
export class DiceMeshFactory extends BaseDiceMeshFactory {
  constructor(options: DiceMeshFactoryOptions = {}) {
    super(options);
  }

  override create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    const mesh = super.create(sides, options);
    return sides === 8 ? replaceD8Body(mesh, options.size ?? 1) : mesh;
  }

  override createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    const pending = super.createAsync(sides, options);
    return sides === 8
      ? pending.then((mesh) => replaceD8Body(mesh, options.size ?? 1))
      : pending;
  }
}
