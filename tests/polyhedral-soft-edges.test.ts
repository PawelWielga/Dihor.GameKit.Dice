import { BufferAttribute, Mesh, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import {
  DiceMeshFactory,
  type DiceSides,
  type DiceTextureLoader
} from "../src/index.js";

const POLYHEDRAL_SIDES: readonly Exclude<DiceSides, 6>[] = [4, 8, 10, 12, 20, 100];

class TextureLoader implements DiceTextureLoader {
  async load(url: string): Promise<Texture> {
    const texture = new Texture();
    texture.name = url;
    return texture;
  }
}

function uniqueNormals(mesh: Mesh): number {
  const normal = mesh.geometry.getAttribute("normal");

  if (!(normal instanceof BufferAttribute)) {
    return 0;
  }

  const values = new Set<string>();

  for (let index = 0; index < normal.count; index += 1) {
    values.add(
      `${normal.getX(index).toFixed(4)},${normal.getY(index).toFixed(4)},${normal.getZ(index).toFixed(4)}`
    );
  }

  return values.size;
}

describe("polyhedral edge softening", () => {
  it("uses blended render normals instead of one flat normal per face", () => {
    const factory = new DiceMeshFactory();

    for (const sides of POLYHEDRAL_SIDES) {
      const mesh = factory.create(sides);
      const material = mesh.body.material as MeshStandardMaterial;

      expect(material.flatShading, `D${sides} flat shading`).toBe(false);
      expect(uniqueNormals(mesh.body), `D${sides} unique normals`).toBeGreaterThan(sides);

      mesh.dispose();
    }

    factory.dispose();
  });

  it("keeps per-face texture overlays while applying the same softened lighting", async () => {
    const factory = new DiceMeshFactory({ textureLoader: new TextureLoader() });
    const mesh = await factory.createAsync(20, {
      appearance: {
        faces: { 13: "/d20-face-13.png" }
      }
    });
    const texturedFace = mesh.object.getObjectByName("D20 face texture 13") as Mesh;
    const material = texturedFace.material as MeshStandardMaterial;

    expect(texturedFace).toBeDefined();
    expect(material.map?.name).toBe("/d20-face-13.png");
    expect(material.flatShading).toBe(false);
    expect(uniqueNormals(texturedFace)).toBeGreaterThan(1);

    mesh.dispose();
    factory.dispose();
  });
});
