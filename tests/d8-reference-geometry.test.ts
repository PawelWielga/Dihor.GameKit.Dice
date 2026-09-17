import { FrontSide, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DiceMeshFactory } from "../src/index.js";

describe("reference-rounded D8 geometry", () => {
  it("keeps the approved D8 extent while using a multi-vertex rounded tip profile", () => {
    const factory = new DiceMeshFactory();
    const mesh = factory.create(8, { size: 1 });

    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;
    const positions = mesh.body.geometry.getAttribute("position");
    const uvs = mesh.body.geometry.getAttribute("uv");
    const material = mesh.body.material as MeshStandardMaterial;

    expect(bounds?.min.x).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.x).toBeCloseTo(0.8625, 5);
    expect(bounds?.min.y).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.y).toBeCloseTo(0.8625, 5);
    expect(bounds?.min.z).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.z).toBeCloseTo(0.8625, 5);
    expect(positions.count).toBeGreaterThan(30);
    expect(uvs.count).toBe(positions.count);
    expect(material.side).toBe(FrontSide);

    const markings = mesh.object.getObjectByName("D8 numeric markings") as Mesh;
    expect(markings).toBeDefined();
    expect(markings.scale.x).toBeGreaterThan(1);

    mesh.dispose();
    factory.dispose();
  });
});
