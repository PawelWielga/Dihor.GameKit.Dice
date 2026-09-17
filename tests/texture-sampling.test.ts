import {
  ClampToEdgeWrapping,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Texture
} from "three";
import { describe, expect, it } from "vitest";
import {
  DiceMeshFactory,
  type DiceMesh,
  type DiceTextureLoader
} from "../src/index.js";

function standardMaterial(mesh: Mesh): MeshStandardMaterial {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

  if (!(material instanceof MeshStandardMaterial)) {
    throw new TypeError(`Expected MeshStandardMaterial on ${mesh.name}.`);
  }

  return material;
}

function faceTextureMesh(mesh: DiceMesh, value: number): Mesh {
  const child = mesh.object.children.find(
    (candidate) => candidate instanceof Mesh && candidate.name === `D${mesh.sides} face texture ${value}`
  );

  if (!(child instanceof Mesh)) {
    throw new Error(`Missing D${mesh.sides} face texture ${value}.`);
  }

  return child;
}

describe("reference dice texture sampling", () => {
  it("keeps body textures repeating while same-URL face textures stay clamped", async () => {
    const source = new Texture();
    let loadCalls = 0;
    const loader: DiceTextureLoader = {
      async load() {
        loadCalls += 1;
        return source;
      }
    };
    const factory = new DiceMeshFactory({ textureLoader: loader });
    const appearance = {
      texture: "/shared.png",
      faces: { 1: "/shared.png" }
    };

    const d8 = await factory.createAsync(8, { appearance });
    const d6 = await factory.createAsync(6, { appearance });

    for (const mesh of [d8, d6]) {
      const bodyMap = standardMaterial(mesh.body).map;
      const faceMap = standardMaterial(faceTextureMesh(mesh, 1)).map;

      expect(bodyMap).toBe(source);
      expect(bodyMap?.wrapS).toBe(RepeatWrapping);
      expect(faceMap).toBeDefined();
      expect(faceMap).not.toBe(bodyMap);
      expect(faceMap?.wrapS).toBe(ClampToEdgeWrapping);
    }

    expect(loadCalls).toBe(1);

    d8.dispose();
    d6.dispose();
    factory.dispose();
  });
});
