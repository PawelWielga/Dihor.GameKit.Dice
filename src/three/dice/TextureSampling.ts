import {
  ClampToEdgeWrapping,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  type Material,
  type Texture
} from "three";
import type { DiceMesh } from "./DiceMeshFactory.js";

function materialsOf(material: Material | Material[]): readonly Material[] {
  return Array.isArray(material) ? material : [material];
}

function markRepeat(texture: Texture | null): void {
  if (!texture) {
    return;
  }

  texture.wrapS = RepeatWrapping;
  texture.needsUpdate = true;
}

/**
 * Reference body UVs may cross the longitude seam and therefore need horizontal repeat wrapping.
 * Per-face textures must remain clamped. Face maps are cloned so a URL shared with the body can
 * use different sampler state without mutating the cached/body texture instance.
 */
export function configureReferenceTextureSampling(mesh: DiceMesh): readonly Texture[] {
  for (const material of materialsOf(mesh.body.material)) {
    if (!(material instanceof MeshStandardMaterial)) {
      continue;
    }

    markRepeat(material.map);
    markRepeat(material.normalMap);
    markRepeat(material.roughnessMap);
  }

  const faceClones = new Map<Texture, Texture>();

  for (const child of mesh.object.children) {
    if (child === mesh.body || !(child instanceof Mesh)) {
      continue;
    }

    for (const material of materialsOf(child.material)) {
      if (!(material instanceof MeshStandardMaterial) || !material.map) {
        continue;
      }

      const source = material.map;
      let clone = faceClones.get(source);

      if (!clone) {
        clone = source.clone();
        clone.wrapS = ClampToEdgeWrapping;
        clone.needsUpdate = true;
        faceClones.set(source, clone);
      }

      material.map = clone;
      material.needsUpdate = true;
    }
  }

  return [...faceClones.values()];
}
