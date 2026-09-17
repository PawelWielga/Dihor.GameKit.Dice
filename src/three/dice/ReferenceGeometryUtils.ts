import {
  Float32BufferAttribute,
  Vector3,
  type BufferGeometry
} from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

function sphericalUv(position: Vector3): readonly [number, number] {
  const radius = Math.max(position.length(), Number.EPSILON);
  const normalizedY = Math.max(-1, Math.min(1, position.y / radius));
  return [
    0.5 + Math.atan2(position.z, position.x) / (Math.PI * 2),
    0.5 - Math.asin(normalizedY) / Math.PI
  ];
}

function addUnwrappedSphericalUvs(geometry: BufferGeometry): BufferGeometry {
  const expanded = geometry.index ? geometry.toNonIndexed() : geometry;

  if (expanded !== geometry) {
    geometry.dispose();
  }

  const positions = expanded.getAttribute("position");
  const uvs: number[] = [];

  for (let index = 0; index < positions.count; index += 3) {
    const triangleUvs: [number, number][] = [];

    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index + corner;
      triangleUvs.push([
        ...sphericalUv(
          new Vector3(
            positions.getX(vertexIndex),
            positions.getY(vertexIndex),
            positions.getZ(vertexIndex)
          )
        )
      ]);
    }

    const minU = Math.min(...triangleUvs.map(([u]) => u));
    const maxU = Math.max(...triangleUvs.map(([u]) => u));

    if (maxU - minU > 0.5) {
      for (const uv of triangleUvs) {
        if (uv[0] < 0.5) {
          uv[0] += 1;
        }
      }
    }

    for (const [u, v] of triangleUvs) {
      uvs.push(u, v);
    }
  }

  expanded.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return expanded;
}

/**
 * Builds a convex visual hull with genuinely shared vertex normals before expanding triangles for
 * seam-safe spherical UVs. U may intentionally exceed 1 around the longitude seam, so body maps
 * use RepeatWrapping on S.
 */
export function createSmoothConvexProfileGeometry(points: readonly Vector3[]): BufferGeometry {
  const hull = new ConvexGeometry([...points]);

  // ConvexGeometry provides facet normals. mergeVertices considers every attribute when welding,
  // so keeping those normals would prevent coincident positions from sharing a smooth normal.
  hull.deleteAttribute("normal");
  const merged = mergeVertices(hull, 1e-6);
  hull.dispose();
  merged.computeVertexNormals();

  const geometry = addUnwrappedSphericalUvs(merged);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
