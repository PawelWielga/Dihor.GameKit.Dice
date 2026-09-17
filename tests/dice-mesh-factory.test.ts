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
