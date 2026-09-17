import { RepeatWrapping, Texture } from "three";
import { describe, expect, it } from "vitest";
import {
  DiceMeshFactory,
  type DiceSides,
  type DiceTextureLoader
} from "../src/index.js";

const REFERENCE_SIDES = [4, 6, 8, 10, 12, 20] as const satisfies readonly DiceSides[];

function positionKey(x: number, y: number, z: number): string {
  return `${x.toFixed(6)}:${y.toFixed(6)}:${z.toFixed(6)}`;
}

function minimumCircularSpan(values: readonly number[]): number {
  const wrapped = values
    .map((value) => ((value % 1) + 1) % 1)
    .sort((left, right) => left - right);

  if (wrapped.length < 2) {
    return 0;
  }

  let largestGap = 0;

  for (let index = 1; index < wrapped.length; index += 1) {
    largestGap = Math.max(largestGap, wrapped[index]! - wrapped[index - 1]!);
  }

  largestGap = Math.max(largestGap, wrapped[0]! + 1 - wrapped[wrapped.length - 1]!);
  return 1 - largestGap;
}

describe("reference geometry quality", () => {
  it("keeps smooth shared normals and does not interpolate across the spherical U seam", () => {
    const factory = new DiceMeshFactory();

    for (const sides of REFERENCE_SIDES) {
      const mesh = factory.create(sides);
      const geometry = mesh.body.geometry;
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const uvs = geometry.getAttribute("uv");
      const normalsByPosition = new Map<string, number[][]>();

      expect(geometry.index).toBeNull();
      expect(positions.count % 3).toBe(0);
      expect(normals.count).toBe(positions.count);
      expect(uvs.count).toBe(positions.count);

      for (let index = 0; index < positions.count; index += 3) {
        const triangleU = [uvs.getX(index), uvs.getX(index + 1), uvs.getX(index + 2)];
        const actualSpan = Math.max(...triangleU) - Math.min(...triangleU);
        expect(actualSpan).toBeLessThanOrEqual(minimumCircularSpan(triangleU) + 1e-5);
      }

      for (let index = 0; index < positions.count; index += 1) {
        const key = positionKey(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index)
        );
        const entries = normalsByPosition.get(key) ?? [];
        entries.push([normals.getX(index), normals.getY(index), normals.getZ(index)]);
        normalsByPosition.set(key, entries);
      }

      const sharedVertices = [...normalsByPosition.values()].filter((entries) => entries.length > 1);
      expect(sharedVertices.length).toBeGreaterThan(0);

      for (const entries of sharedVertices) {
        const reference = entries[0]!;
        for (const normal of entries.slice(1)) {
          expect(Math.abs(normal[0]! - reference[0]!)).toBeLessThan(1e-5);
          expect(Math.abs(normal[1]! - reference[1]!)).toBeLessThan(1e-5);
          expect(Math.abs(normal[2]! - reference[2]!)).toBeLessThan(1e-5);
        }
      }

      mesh.dispose();
    }

    factory.dispose();
  });

  it("enables horizontal texture wrapping required by unwrapped seam UVs", async () => {
    const texture = new Texture();
    const loader: DiceTextureLoader = {
      async load() {
        return texture;
      }
    };
    const factory = new DiceMeshFactory({ textureLoader: loader });
    const mesh = await factory.createAsync(8, {
      appearance: { texture: "/body.png" }
    });

    expect(texture.wrapS).toBe(RepeatWrapping);

    mesh.dispose();
    factory.dispose();
  });
});
