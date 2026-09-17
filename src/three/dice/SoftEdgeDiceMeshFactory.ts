import {
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3
} from "three";
import {
  DiceMeshFactory as BaseDiceMeshFactory,
  type DiceMesh,
  type DiceMeshOptions
} from "./DiceMeshFactory.js";
import type { DiceSides } from "../../core/index.js";

function edgeSoftness(sides: Exclude<DiceSides, 6>): number {
  if (sides === 4) {
    return 0.3;
  }

  if (sides === 100) {
    return 0.62;
  }

  return 0.44;
}

function softenMeshNormals(mesh: Mesh, softness: number): void {
  const position = mesh.geometry.getAttribute("position");
  const normal = mesh.geometry.getAttribute("normal");

  if (!(position instanceof BufferAttribute) || !(normal instanceof BufferAttribute)) {
    return;
  }

  const faceNormal = new Vector3();
  const radialNormal = new Vector3();
  const blended = new Vector3();

  for (let index = 0; index < position.count; index += 1) {
    radialNormal.set(position.getX(index), position.getY(index), position.getZ(index));

    if (radialNormal.lengthSq() <= Number.EPSILON) {
      continue;
    }

    radialNormal.normalize();
    faceNormal.set(normal.getX(index), normal.getY(index), normal.getZ(index)).normalize();
    blended
      .copy(faceNormal)
      .multiplyScalar(1 - softness)
      .addScaledVector(radialNormal, softness)
      .normalize();
    normal.setXYZ(index, blended.x, blended.y, blended.z);
  }

  normal.needsUpdate = true;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  for (const material of materials) {
    if (material instanceof MeshStandardMaterial) {
      material.flatShading = false;
      material.needsUpdate = true;
    }
  }
}

function softenPolyhedralMesh(mesh: DiceMesh): DiceMesh {
  if (mesh.sides === 6) {
    return mesh;
  }

  const softness = edgeSoftness(mesh.sides);
  softenMeshNormals(mesh.body, softness);

  for (const child of mesh.object.children) {
    if (
      child instanceof Mesh &&
      child.name.startsWith(`D${mesh.sides} face texture `)
    ) {
      softenMeshNormals(child, softness);
    }
  }

  return mesh;
}

/**
 * DiceMeshFactory variant used by the public API. It keeps the project-owned polyhedral positions
 * and UVs intact while blending render normals toward the die center near vertices. Physics still
 * uses the original collider topology, so only lighting across visual edges changes.
 */
export class DiceMeshFactory extends BaseDiceMeshFactory {
  override create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    return softenPolyhedralMesh(super.create(sides, options));
  }

  override async createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    return softenPolyhedralMesh(await super.createAsync(sides, options));
  }
}
