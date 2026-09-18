import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DiceMeshFactory, getDiceTopology } from "../src/advanced.js";

describe("D8-derived rounded D6 geometry", () => {
  it("keeps the established D6 size and pips while using the shared rounded profile", () => {
    const factory = new DiceMeshFactory();
    const mesh = factory.createD6({ size: 2 });
    const topology = getDiceTopology(6);
    const positions = mesh.body.geometry.getAttribute("position");
    const normals = mesh.body.geometry.getAttribute("normal");
    const uvs = mesh.body.geometry.getAttribute("uv");
    const pipMeshes = mesh.object.children.filter((child) => child.name.startsWith("D6 pip "));

    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;

    expect(positions.count).toBeGreaterThan(topology.vertices.length);
    expect(normals.count).toBe(positions.count);
    expect(uvs.count).toBe(positions.count);
    expect((mesh.body.material as MeshStandardMaterial).flatShading).toBe(false);
    expect(bounds?.min.x).toBeCloseTo(-1, 5);
    expect(bounds?.max.x).toBeCloseTo(1, 5);
    expect(bounds?.min.y).toBeCloseTo(-1, 5);
    expect(bounds?.max.y).toBeCloseTo(1, 5);
    expect(bounds?.min.z).toBeCloseTo(-1, 5);
    expect(bounds?.max.z).toBeCloseTo(1, 5);
    expect(pipMeshes).toHaveLength(21);

    mesh.dispose();
    factory.dispose();
  });
});
