import {
  CircleGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  hasDiceTextureSources,
  resolveDiceAppearance,
  type DiceAppearance,
  type ResolvedDiceAppearance
} from "../../appearance/index.js";
import {
  D6_FACE_NORMALS,
  D6_FACE_VALUES,
  type D6FaceValue
} from "../../core/dice/index.js";
import type { DiceSides } from "../../core/DiceSides.js";
import {
  DiceTextureCache,
  type DiceTextureLease,
  type DiceTextureLoader
} from "./DiceTextureCache.js";

export interface D6MeshOptions {
  readonly size?: number;
  readonly appearance?: DiceAppearance;
}

export interface DiceMeshFactoryOptions {
  /** Advanced hook useful for custom asset pipelines and tests. */
  readonly textureLoader?: DiceTextureLoader;
}

export interface DiceMesh {
  readonly sides: DiceSides;
  readonly object: Group;
  readonly body: Mesh;
  dispose(): void;
}

interface D6TextureResources {
  readonly body?: DiceTextureLease;
  readonly normal?: DiceTextureLease;
  readonly roughness?: DiceTextureLease;
  readonly faces: ReadonlyMap<D6FaceValue, DiceTextureLease>;
  readonly leases: readonly DiceTextureLease[];
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
  private readonly textureCache: DiceTextureCache;
  private disposed = false;

  constructor(options: DiceMeshFactoryOptions = {}) {
    this.textureCache = new DiceTextureCache(options.textureLoader);
  }

  create(sides: DiceSides, options: D6MeshOptions = {}): DiceMesh {
    this.assertActive();

    if (sides !== 6) {
      throw new RangeError(`DiceMeshFactory does not yet support D${sides}.`);
    }

    return this.createD6(options);
  }

  async createAsync(sides: DiceSides, options: D6MeshOptions = {}): Promise<DiceMesh> {
    this.assertActive();

    if (sides !== 6) {
      throw new RangeError(`DiceMeshFactory does not yet support D${sides}.`);
    }

    return this.createD6Async(options);
  }

  /** Creates a D6 immediately. Texture URLs are intentionally ignored by this synchronous path. */
  createD6(options: D6MeshOptions = {}): DiceMesh {
    this.assertActive();
    const size = validateSize(options.size ?? 1);
    const appearance = resolveDiceAppearance(options.appearance);
    return this.buildD6(size, appearance, options.appearance);
  }

  /** Loads optional texture assets with fallback and then creates a complete D6 mesh. */
  async createD6Async(options: D6MeshOptions = {}): Promise<DiceMesh> {
    this.assertActive();
    const size = validateSize(options.size ?? 1);
    const appearance = resolveDiceAppearance(options.appearance);

    if (!hasDiceTextureSources(options.appearance)) {
      return this.buildD6(size, appearance, options.appearance);
    }

    const textures = await this.loadD6Textures(options.appearance);

    try {
      this.assertActive();
      return this.buildD6(size, appearance, options.appearance, textures);
    } catch (error) {
      for (const lease of textures.leases) {
        lease.release();
      }

      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.textureCache.dispose();
  }

  private async loadD6Textures(appearance: DiceAppearance | undefined): Promise<D6TextureResources> {
    const [body, normal, roughness, faceEntries] = await Promise.all([
      this.textureCache.acquire(appearance?.texture, "color"),
      this.textureCache.acquire(appearance?.normalMap, "data"),
      this.textureCache.acquire(appearance?.roughnessMap, "data"),
      Promise.all(
        D6_FACE_VALUES.map(async (value) => {
          const lease = await this.textureCache.acquire(appearance?.faces?.[value], "color");
          return [value, lease] as const;
        })
      )
    ]);

    const faces = new Map<D6FaceValue, DiceTextureLease>();
    const leases: DiceTextureLease[] = [];

    for (const lease of [body, normal, roughness]) {
      if (lease) {
        leases.push(lease);
      }
    }

    for (const [value, lease] of faceEntries) {
      if (lease) {
        faces.set(value, lease);
        leases.push(lease);
      }
    }

    return { body, normal, roughness, faces, leases };
  }

  private buildD6(
    size: number,
    appearance: ResolvedDiceAppearance,
    requestedAppearance: DiceAppearance | undefined,
    textures?: D6TextureResources
  ): DiceMesh {
    const halfSize = size / 2;
    const bodyGeometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.12);
    const bodyMaterial = new MeshStandardMaterial({
      color:
        textures?.body && requestedAppearance?.color === undefined
          ? "#ffffff"
          : appearance.color,
      map: textures?.body?.texture,
      normalMap: textures?.normal?.texture,
      roughnessMap: textures?.roughness?.texture,
      metalness: appearance.metalness,
      roughness: appearance.roughness
    });
    const pipGeometry = new CircleGeometry(size * 0.055, 16);
    const pipMaterial = new MeshStandardMaterial({
      color: appearance.markingsColor,
      metalness: 0,
      roughness: 0.82
    });
    const faceTextureGeometry = textures?.faces.size
      ? new PlaneGeometry(size * 0.72, size * 0.72)
      : undefined;
    const faceTextureMaterials: MeshStandardMaterial[] = [];

    const object = new Group();
    object.name = "PartyBeam.DiceKit D6";

    const body = new Mesh(bodyGeometry, bodyMaterial);
    body.name = "D6 body";
    body.castShadow = true;
    body.receiveShadow = true;
    object.add(body);

    const pipSpacing = size * 0.22;
    const pipSurfaceDistance = halfSize + size * 0.004;
    const textureSurfaceDistance = halfSize + size * 0.007;

    for (const value of D6_FACE_VALUES) {
      const face = D6_FACE_NORMALS[value];
      const normal = new Vector3(face.x, face.y, face.z);
      const reference = Math.abs(normal.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      const horizontal = new Vector3().crossVectors(reference, normal).normalize();
      const vertical = new Vector3().crossVectors(normal, horizontal).normalize();
      const faceRotation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(horizontal, vertical, normal)
      );
      const faceTexture = textures?.faces.get(value);

      if (faceTexture && faceTextureGeometry) {
        const faceMaterial = new MeshStandardMaterial({
          color: "#ffffff",
          map: faceTexture.texture,
          metalness: appearance.metalness,
          roughness: appearance.roughness,
          transparent: true,
          alphaTest: 0.01
        });
        faceTextureMaterials.push(faceMaterial);

        const texturedFace = new Mesh(faceTextureGeometry, faceMaterial);
        texturedFace.name = `D6 face texture ${value}`;
        texturedFace.position.copy(normal).multiplyScalar(textureSurfaceDistance);
        texturedFace.quaternion.copy(faceRotation);
        object.add(texturedFace);
        continue;
      }

      for (const [horizontalOffset, verticalOffset] of PIP_LAYOUTS[value]) {
        const pip = new Mesh(pipGeometry, pipMaterial);
        pip.name = `D6 pip ${value}`;
        pip.position
          .copy(normal)
          .multiplyScalar(pipSurfaceDistance)
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
        faceTextureGeometry?.dispose();

        for (const material of faceTextureMaterials) {
          material.dispose();
        }

        for (const lease of textures?.leases ?? []) {
          lease.release();
        }
      }
    };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("DiceMeshFactory has been disposed.");
    }
  }
}
