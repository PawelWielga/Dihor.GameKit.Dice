import { Mesh, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DiceMeshFactory,
  SUPPORTED_DICE_SIDES,
  type DiceTextureLoader
} from "../src/index.js";

class FakeTextureLoader implements DiceTextureLoader {
  readonly calls: string[] = [];
  readonly failures = new Set<string>();
  readonly textures = new Map<string, Texture>();

  async load(url: string): Promise<Texture> {
    this.calls.push(url);

    if (this.failures.has(url)) {
      throw new Error(`Failed to load ${url}`);
    }

    const texture = new Texture();
    texture.name = url;
    this.textures.set(url, texture);
    return texture;
  }
}

describe("DiceMeshFactory", () => {
  it("creates a rounded D6 with all 21 classic pips", () => {
    const factory = new DiceMeshFactory();
    const mesh = factory.createD6({ size: 2 });
    const pipMeshes = mesh.object.children.filter((child) => child.name.startsWith("D6 pip "));

    expect(mesh.sides).toBe(6);
    expect(mesh.body.name).toBe("D6 body");
    expect(pipMeshes).toHaveLength(21);

    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;
    expect(bounds?.min.x).toBeCloseTo(-1);
    expect(bounds?.max.x).toBeCloseTo(1);

    mesh.dispose();
    factory.dispose();
  });

  it("creates independently generated geometry and markings for every supported die", () => {
    const factory = new DiceMeshFactory();

    for (const sides of SUPPORTED_DICE_SIDES) {
      const mesh = factory.create(sides, { size: 1.5 });
      mesh.body.geometry.computeBoundingBox();
      const bounds = mesh.body.geometry.boundingBox;

      expect(mesh.sides).toBe(sides);
      expect(mesh.body.name).toBe(`D${sides} body`);
      expect(bounds).not.toBeNull();
      expect((bounds?.max.x ?? 0) - (bounds?.min.x ?? 0)).toBeGreaterThan(0);

      if (sides !== 6) {
        expect(mesh.object.getObjectByName(`D${sides} numeric markings`)).toBeDefined();
      }

      mesh.dispose();
    }

    factory.dispose();
  });

  it("applies custom body, markings and material appearance", () => {
    const factory = new DiceMeshFactory();
    const mesh = factory.createD6({
      appearance: {
        color: "#7b1e1e",
        markingsColor: "#f5e6c8",
        roughness: 0.65,
        metalness: 0.15
      }
    });
    const bodyMaterial = mesh.body.material as MeshStandardMaterial;
    const firstPip = mesh.object.children.find((child) => child.name.startsWith("D6 pip ")) as Mesh;
    const pipMaterial = firstPip.material as MeshStandardMaterial;

    expect(bodyMaterial.color.getHexString()).toBe("7b1e1e");
    expect(bodyMaterial.roughness).toBe(0.65);
    expect(bodyMaterial.metalness).toBe(0.15);
    expect(pipMaterial.color.getHexString()).toBe("f5e6c8");

    mesh.dispose();
    factory.dispose();
  });

  it("loads global maps and replaces only successfully textured faces", async () => {
    const loader = new FakeTextureLoader();
    loader.failures.add("/missing-face.png");
    const factory = new DiceMeshFactory({ textureLoader: loader });
    const mesh = await factory.createD6Async({
      appearance: {
        texture: "/body.png",
        normalMap: "/normal.png",
        roughnessMap: "/roughness.png",
        faces: {
          1: "/face-one.png",
          6: "/missing-face.png"
        }
      }
    });
    const bodyMaterial = mesh.body.material as MeshStandardMaterial;

    expect(bodyMaterial.map?.name).toBe("/body.png");
    expect(bodyMaterial.normalMap?.name).toBe("/normal.png");
    expect(bodyMaterial.roughnessMap?.name).toBe("/roughness.png");
    expect(bodyMaterial.color.getHexString()).toBe("ffffff");
    expect(mesh.object.getObjectByName("D6 face texture 1")).toBeDefined();
    expect(mesh.object.getObjectByName("D6 pip 1")).toBeUndefined();
    expect(mesh.object.getObjectByName("D6 face texture 6")).toBeUndefined();
    expect(mesh.object.children.filter((child) => child.name === "D6 pip 6")).toHaveLength(6);

    const bodyTexture = loader.textures.get("/body.png")!;
    const disposeTexture = vi.spyOn(bodyTexture, "dispose");
    mesh.dispose();
    mesh.dispose();
    expect(disposeTexture).not.toHaveBeenCalled();

    factory.dispose();
    factory.dispose();
    expect(disposeTexture).toHaveBeenCalledTimes(1);
  });

  it("keeps per-face textures bound to the same physical face on polyhedral dice", async () => {
    const loader = new FakeTextureLoader();
    const factory = new DiceMeshFactory({ textureLoader: loader });
    const mesh = await factory.createAsync(20, {
      appearance: {
        color: "#264653",
        faces: { 13: "/d20-face-13.png" }
      }
    });

    expect(mesh.object.getObjectByName("D20 face texture 13")).toBeDefined();
    expect(loader.calls).toContain("/d20-face-13.png");

    mesh.dispose();
    factory.dispose();
  });

  it("reuses cached textures across sequential meshes from one factory", async () => {
    const loader = new FakeTextureLoader();
    const factory = new DiceMeshFactory({ textureLoader: loader });

    const first = await factory.createD6Async({ appearance: { texture: "/shared.png" } });
    first.dispose();
    const second = await factory.createD6Async({ appearance: { texture: "/shared.png" } });

    expect(loader.calls.filter((url) => url === "/shared.png")).toHaveLength(1);

    second.dispose();
    factory.dispose();
  });

  it("keeps explicit body color as a tint when a global texture is present", async () => {
    const loader = new FakeTextureLoader();
    const factory = new DiceMeshFactory({ textureLoader: loader });
    const mesh = await factory.createD6Async({
      appearance: {
        color: "#7b1e1e",
        texture: "/body.png"
      }
    });
    const bodyMaterial = mesh.body.material as MeshStandardMaterial;

    expect(bodyMaterial.color.getHexString()).toBe("7b1e1e");
    expect(bodyMaterial.map?.name).toBe("/body.png");

    mesh.dispose();
    factory.dispose();
  });

  it("validates dice size and disposes owned render resources once", () => {
    const factory = new DiceMeshFactory();
    expect(() => factory.createD6({ size: 0 })).toThrowError(RangeError);
    expect(() => factory.create(20, { size: Number.NaN })).toThrowError(RangeError);

    const mesh = factory.createD6();
    const bodyDispose = vi.spyOn(mesh.body.geometry, "dispose");

    mesh.dispose();
    mesh.dispose();

    expect(bodyDispose).toHaveBeenCalledTimes(1);
    factory.dispose();
    expect(() => factory.createD6()).toThrowError("DiceMeshFactory has been disposed.");
  });
});
