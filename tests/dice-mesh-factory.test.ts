import { Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { DiceMeshFactory } from "../src/index.js";

describe("DiceMeshFactory", () => {
  it("creates a rounded D6 with all 21 classic pips", () => {
    const mesh = new DiceMeshFactory().createD6({ size: 2 });
    const pipMeshes = mesh.object.children.filter((child) => child.name.startsWith("D6 pip "));

    expect(mesh.sides).toBe(6);
    expect(mesh.body.name).toBe("D6 body");
    expect(pipMeshes).toHaveLength(21);

    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;
    expect(bounds?.min.x).toBeCloseTo(-1);
    expect(bounds?.max.x).toBeCloseTo(1);

    mesh.dispose();
  });

  it("applies custom body, markings and material appearance", () => {
    const mesh = new DiceMeshFactory().createD6({
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
  });

  it("rejects unsupported dice until their geometry is implemented", () => {
    const factory = new DiceMeshFactory();
    expect(() => factory.create(20)).toThrowError(RangeError);
  });

  it("validates D6 size and disposes owned render resources once", () => {
    const factory = new DiceMeshFactory();
    expect(() => factory.createD6({ size: 0 })).toThrowError(RangeError);

    const mesh = factory.createD6();
    const bodyDispose = vi.spyOn(mesh.body.geometry, "dispose");

    mesh.dispose();
    mesh.dispose();

    expect(bodyDispose).toHaveBeenCalledTimes(1);
  });
});
