import { FrontSide, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  DiceMeshFactory,
  getDiceTopology,
  type DiceSides
} from "../src/advanced.js";

const REFERENCE_PROFILE_SIDES = [4, 10, 12, 20] as const satisfies readonly DiceSides[];

describe("D8-derived rounded polyhedral geometry", () => {
  it("applies the approved reference profile to every remaining polyhedral die", () => {
    const factory = new DiceMeshFactory();

    for (const sides of REFERENCE_PROFILE_SIDES) {
      const mesh = factory.create(sides, { size: 1 });
      const topology = getDiceTopology(sides);
      const positions = mesh.body.geometry.getAttribute("position");
      const normals = mesh.body.geometry.getAttribute("normal");
      const uvs = mesh.body.geometry.getAttribute("uv");
      const material = mesh.body.material as MeshStandardMaterial;
      const markings = mesh.object.getObjectByName(`D${sides} numeric markings`) as Mesh;

      expect(positions.count).toBeGreaterThan(topology.vertices.length);
      expect(normals.count).toBe(positions.count);
      expect(uvs.count).toBe(positions.count);
      expect(material.side).toBe(FrontSide);
      expect(material.flatShading).toBe(false);
      expect(markings).toBeDefined();
      expect(markings.scale.x).toBeGreaterThan(1);
      expect(markings.scale.x).toBeCloseTo(markings.scale.y, 8);
      expect(markings.scale.x).toBeCloseTo(markings.scale.z, 8);

      mesh.dispose();
    }

    factory.dispose();
  });

  it("keeps the approved D8 regression profile untouched", () => {
    const factory = new DiceMeshFactory();
    const mesh = factory.create(8, { size: 1 });

    mesh.body.geometry.computeBoundingBox();
    const bounds = mesh.body.geometry.boundingBox;

    expect(bounds?.min.x).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.x).toBeCloseTo(0.8625, 5);
    expect(bounds?.min.y).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.y).toBeCloseTo(0.8625, 5);
    expect(bounds?.min.z).toBeCloseTo(-0.8625, 5);
    expect(bounds?.max.z).toBeCloseTo(0.8625, 5);

    mesh.dispose();
    factory.dispose();
  });
});
