import {
  CircleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  resolveDiceAppearance,
  type DiceAppearance
} from "../../appearance/index.js";
import {
  D6_FACE_NORMALS,
  D6_FACE_VALUES,
  type D6FaceValue
} from "../../core/dice/index.js";
import type { DiceSides } from "../../core/DiceSides.js";

export interface D6MeshOptions {
  readonly size?: number;
  readonly appearance?: DiceAppearance;
}

export interface DiceMesh {
  readonly sides: DiceSides;
  readonly object: Group;
  readonly body: Mesh;
  dispose(): void;
}

const PIP_LAYOUTS: Readonly<Record<D6FaceValue, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [-1, 0], [-1, -1], [1, 1], [1, 0], [1, -1]]
};

function validateSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`Dice size must be a positive finite number; received ${String(size)}.`);
  }

  return size;
}

/** Factory for render meshes. Additional dice shapes can be added without changing DiceScene. */
export class DiceMeshFactory {
  create(sides: DiceSides, options: D6MeshOptions = {}): DiceMesh {
    if (sides !== 6) {
      throw new RangeError(`DiceMeshFactory does not yet support D${sides}.`);
    }

    return this.createD6(options);
  }

  createD6(options: D6MeshOptions = {}): DiceMesh {
    const size = validateSize(options.size ?? 1);
    const appearance = resolveDiceAppearance(options.appearance);
    const halfSize = size / 2;
    const bodyGeometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.12);
    const bodyMaterial = new MeshStandardMaterial({
      color: appearance.color,
      metalness: appearance.metalness,
      roughness: appearance.roughness
    });
    const pipGeometry = new CircleGeometry(size * 0.055, 16);
    const pipMaterial = new MeshStandardMaterial({
      color: appearance.markingsColor,
      metalness: 0,
      roughness: 0.82
    });

    const object = new Group();
    object.name = "PartyBeam.DiceKit D6";

    const body = new Mesh(bodyGeometry, bodyMaterial);
    body.name = "D6 body";
    body.castShadow = true;
    body.receiveShadow = true;
    object.add(body);

    const sourceNormal = new Vector3(0, 0, 1);
    const pipSpacing = size * 0.22;
    const surfaceDistance = halfSize + size * 0.004;

    for (const value of D6_FACE_VALUES) {
      const face = D6_FACE_NORMALS[value];
      const normal = new Vector3(face.x, face.y, face.z);
      const reference = Math.abs(normal.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      const horizontal = new Vector3().crossVectors(reference, normal).normalize();
      const vertical = new Vector3().crossVectors(normal, horizontal).normalize();
      const faceRotation = new Quaternion().setFromUnitVectors(sourceNormal, normal);

      for (const [horizontalOffset, verticalOffset] of PIP_LAYOUTS[value]) {
        const pip = new Mesh(pipGeometry, pipMaterial);
        pip.name = `D6 pip ${value}`;
        pip.position
          .copy(normal)
          .multiplyScalar(surfaceDistance)
          .addScaledVector(horizontal, horizontalOffset * pipSpacing)
          .addScaledVector(vertical, verticalOffset * pipSpacing);
        pip.quaternion.copy(faceRotation);
        object.add(pip);
      }
    }

    let disposed = false;

    return {
      sides: 6,
      object,
      body,
      dispose() {
        if (disposed) {
          return;
        }

        disposed = true;
        object.clear();
        bodyGeometry.dispose();
        bodyMaterial.dispose();
        pipGeometry.dispose();
        pipMaterial.dispose();
      }
    };
  }
}
