import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type ColorRepresentation,
  type Object3D
} from "three";
import type { DiceTransform } from "./DiceTransform.js";

export interface DiceTableMaterialOptions {
  /** Base color used by the table material. When a texture is provided it acts as a tint. */
  readonly color?: ColorRepresentation;

  /** Optional color texture URL for the visible table surface. */
  readonly texture?: string;
}

/**
 * Orbital camera controls around the center of the dice table.
 *
 * These values are intentionally not world-space Cartesian coordinates:
 * - x rotates around the vertical table axis in degrees,
 * - y tilts away from the top-down view in degrees,
 * - z controls distance from the table center.
 *
 * x=0 and y=0 always means a camera directly above the table, looking straight down.
 */
export interface DiceCameraOptions {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface DiceLightPosition {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface DiceAmbientLightOptions {
  readonly color?: string | number;
  readonly intensity?: number;
}

export interface DiceDirectionalLightOptions {
  readonly type: "directional";
  readonly color?: string | number;
  readonly intensity?: number;
  readonly position?: DiceLightPosition;
  readonly castShadow?: boolean;
}

export interface DicePointLightOptions {
  readonly type: "point";
  readonly color?: string | number;
  readonly intensity?: number;
  readonly position?: DiceLightPosition;
  readonly distance?: number;
  readonly decay?: number;
  readonly castShadow?: boolean;
}

export type DiceSceneLightOptions =
  | DiceDirectionalLightOptions
  | DicePointLightOptions;

export interface DiceLightingOptions {
  readonly ambient?: DiceAmbientLightOptions;
  readonly lights?: readonly DiceSceneLightOptions[];
}

export interface DiceSceneOptions {
  readonly background?: ColorRepresentation | null;

  /** Legacy color shortcut retained for compatibility. Prefer table.color for new code. */
  readonly floorColor?: ColorRepresentation;

  /** Visible table material configuration. */
  readonly table?: DiceTableMaterialOptions;

  /** Orbital camera controls. */
  readonly camera?: DiceCameraOptions;

  /** Declarative lighting configuration. Missing values preserve the neutral defaults. */
  readonly lighting?: DiceLightingOptions;
  readonly showFloor?: boolean;
}

const DEFAULT_BACKGROUND = 0x111318;
const DEFAULT_FLOOR = 0x292d33;
const DEFAULT_AMBIENT_COLOR = 0xffffff;
const DEFAULT_AMBIENT_INTENSITY = 1.4;
const DEFAULT_KEY_LIGHT_COLOR = 0xffffff;
const DEFAULT_KEY_LIGHT_INTENSITY = 2.2;
const DEFAULT_KEY_LIGHT_POSITION = { x: 4, y: 8, z: 5 } as const;
const DEFAULT_POINT_LIGHT_POSITION = { x: 0, y: 5, z: 0 } as const;
const DEFAULT_POINT_LIGHT_DECAY = 2;
const DEFAULT_CAMERA_X = 0;
const DEFAULT_CAMERA_Y = Math.atan2(7.5, 5.5) * (180 / Math.PI);
const DEFAULT_CAMERA_Z = Math.hypot(5.5, 7.5);
const MAX_CAMERA_TILT = 89.9;
const MIN_CAMERA_DISTANCE = 0.1;

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeTextureUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return Math.max(0, finiteOr(value, fallback));
}

function resolveLightPosition(
  position: DiceLightPosition | undefined,
  fallback: Readonly<{ x: number; y: number; z: number }>
): { x: number; y: number; z: number } {
  return {
    x: finiteOr(position?.x, fallback.x),
    y: finiteOr(position?.y, fallback.y),
    z: finiteOr(position?.z, fallback.z)
  };
}

/** Owns the Three.js scene graph used by DiceKit, without any physics logic. */
export class DiceScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly content: Group;

  private readonly lighting = new Group();
  private shadowCastingLights = false;
  private readonly floorGeometry?: PlaneGeometry;
  private readonly floorMaterial?: MeshStandardMaterial;
  private readonly floorTextureLoader = new TextureLoader();
  private floorTexture?: Texture;
  private floorTextureUrl?: string;
  private floorTextureRequest = 0;
  private floorTextureLoad?: Promise<void>;
  private cameraOrbit = {
    x: DEFAULT_CAMERA_X,
    y: DEFAULT_CAMERA_Y,
    z: DEFAULT_CAMERA_Z
  };
  private disposed = false;

  constructor(options: DiceSceneOptions = {}) {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
    this.content = new Group();

    const background = options.background === undefined ? DEFAULT_BACKGROUND : options.background;
    this.scene.background = background === null ? null : new Color(background);
    this.setCamera(options.camera);

    this.content.name = "PartyBeam.DiceKit content";
    this.scene.add(this.content);

    this.lighting.name = "PartyBeam.DiceKit lighting";
    this.scene.add(this.lighting);
    this.setLighting(options.lighting);

    if (options.showFloor !== false) {
      const initialTableColor = options.table?.color ?? options.floorColor ?? DEFAULT_FLOOR;

      this.floorGeometry = new PlaneGeometry(20, 20);
      this.floorMaterial = new MeshStandardMaterial({
        color: initialTableColor,
        metalness: 0,
        roughness: 0.9
      });

      const floor = new Mesh(this.floorGeometry, this.floorMaterial);
      floor.name = "PartyBeam.DiceKit floor";
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = true;
      this.scene.add(floor);

      if (normalizeTextureUrl(options.table?.texture)) {
        void this.setTableMaterial({
          color: initialTableColor,
          texture: options.table?.texture
        });
      }
    }
  }

  get hasShadowCastingLights(): boolean {
    return this.shadowCastingLights;
  }

  /**
   * Replaces scene lighting without touching dice meshes, camera state or physics.
   * An omitted configuration restores the neutral DiceKit lighting defaults.
   */
  setLighting(options: DiceLightingOptions = {}): void {
    if (this.disposed) {
      return;
    }

    this.lighting.clear();

    const ambient = new AmbientLight(
      options.ambient?.color ?? DEFAULT_AMBIENT_COLOR,
      nonNegativeOr(options.ambient?.intensity, DEFAULT_AMBIENT_INTENSITY)
    );
    ambient.name = "PartyBeam.DiceKit ambient light";
    this.lighting.add(ambient);

    const configuredLights = options.lights ?? [{
      type: "directional" as const,
      color: DEFAULT_KEY_LIGHT_COLOR,
      intensity: DEFAULT_KEY_LIGHT_INTENSITY,
      position: DEFAULT_KEY_LIGHT_POSITION
    }];

    let hasShadowCastingLights = false;

    for (let index = 0; index < configuredLights.length; index += 1) {
      const config = configuredLights[index]!;

      if (config.type === "directional") {
        const position = resolveLightPosition(config.position, DEFAULT_KEY_LIGHT_POSITION);
        const light = new DirectionalLight(
          config.color ?? DEFAULT_KEY_LIGHT_COLOR,
          nonNegativeOr(config.intensity, DEFAULT_KEY_LIGHT_INTENSITY)
        );
        light.name = `PartyBeam.DiceKit directional light ${index + 1}`;
        light.position.set(position.x, position.y, position.z);
        light.castShadow = config.castShadow ?? false;
        this.lighting.add(light);
        hasShadowCastingLights ||= light.castShadow;
        continue;
      }

      const position = resolveLightPosition(config.position, DEFAULT_POINT_LIGHT_POSITION);
      const light = new PointLight(
        config.color ?? DEFAULT_KEY_LIGHT_COLOR,
        nonNegativeOr(config.intensity, DEFAULT_KEY_LIGHT_INTENSITY),
        nonNegativeOr(config.distance, 0),
        nonNegativeOr(config.decay, DEFAULT_POINT_LIGHT_DECAY)
      );
      light.name = `PartyBeam.DiceKit point light ${index + 1}`;
      light.position.set(position.x, position.y, position.z);
      light.castShadow = config.castShadow ?? false;
      this.lighting.add(light);
      hasShadowCastingLights ||= light.castShadow;
    }

    this.shadowCastingLights = hasShadowCastingLights;
  }

  setSize(width: number, height: number): void {
    const safeWidth = normalizeDimension(width);
    const safeHeight = normalizeDimension(height);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Updates the orbital camera without rebuilding the renderer.
   * x=0/y=0 is an exact top-down view. Missing values preserve the current axis value.
   */
  setCamera(options: DiceCameraOptions = {}): void {
    if (this.disposed) {
      return;
    }

    const x = finiteOr(options.x, this.cameraOrbit.x);
    const y = clamp(finiteOr(options.y, this.cameraOrbit.y), 0, MAX_CAMERA_TILT);
    const z = Math.max(MIN_CAMERA_DISTANCE, finiteOr(options.z, this.cameraOrbit.z));
    this.cameraOrbit = { x, y, z };

    const azimuth = x * (Math.PI / 180);
    const tilt = y * (Math.PI / 180);
    const horizontalRadius = z * Math.sin(tilt);

    this.camera.position.set(
      horizontalRadius * Math.sin(azimuth),
      z * Math.cos(tilt),
      horizontalRadius * Math.cos(azimuth)
    );

    // At the exact pole Three.js cannot use world Y as the up vector because it is
    // parallel to the view direction. A fixed -Z up vector keeps x irrelevant at y=0.
    if (horizontalRadius < 1e-10) {
      this.camera.up.set(0, 0, -1);
    } else {
      this.camera.up.set(0, 1, 0);
    }

    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Updates the visible table material without rebuilding the renderer.
   * Failed texture loads fall back to the configured base color.
   */
  setTableMaterial(options: DiceTableMaterialOptions = {}): Promise<void> {
    if (this.disposed || !this.floorMaterial) {
      return Promise.resolve();
    }

    const textureUrl = normalizeTextureUrl(options.texture);
    const fallbackColor = textureUrl ? 0xffffff : DEFAULT_FLOOR;
    this.floorMaterial.color.set(options.color ?? fallbackColor);

    if (textureUrl === this.floorTextureUrl) {
      return this.floorTextureLoad ?? Promise.resolve();
    }

    this.floorTextureUrl = textureUrl;
    const request = ++this.floorTextureRequest;
    this.releaseFloorTexture();
    this.floorMaterial.map = null;
    this.floorMaterial.needsUpdate = true;

    if (!textureUrl) {
      this.floorTextureLoad = undefined;
      return Promise.resolve();
    }

    const load = this.floorTextureLoader
      .loadAsync(textureUrl)
      .then((texture) => {
        texture.colorSpace = SRGBColorSpace;

        if (
          this.disposed ||
          request !== this.floorTextureRequest ||
          this.floorTextureUrl !== textureUrl ||
          !this.floorMaterial
        ) {
          texture.dispose();
          return;
        }

        this.floorTexture = texture;
        this.floorMaterial.map = texture;
        this.floorMaterial.needsUpdate = true;
      })
      .catch(() => {
        if (
          !this.disposed &&
          request === this.floorTextureRequest &&
          this.floorTextureUrl === textureUrl &&
          this.floorMaterial
        ) {
          this.floorTextureUrl = undefined;
          this.floorMaterial.map = null;
          this.floorMaterial.needsUpdate = true;
        }
      })
      .finally(() => {
        if (request === this.floorTextureRequest) {
          this.floorTextureLoad = undefined;
        }
      });

    this.floorTextureLoad = load;
    return load;
  }

  add(object: Object3D): void {
    this.content.add(object);
  }

  remove(object: Object3D): void {
    this.content.remove(object);
  }

  applyTransform(object: Object3D, transform: DiceTransform): void {
    object.position.set(transform.position.x, transform.position.y, transform.position.z);
    object.quaternion.set(
      transform.quaternion.x,
      transform.quaternion.y,
      transform.quaternion.z,
      transform.quaternion.w
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.floorTextureRequest += 1;
    this.releaseFloorTexture();
    this.content.clear();
    this.lighting.clear();
    this.shadowCastingLights = false;
    this.scene.clear();
    this.floorGeometry?.dispose();
    this.floorMaterial?.dispose();
  }

  private releaseFloorTexture(): void {
    this.floorTexture?.dispose();
    this.floorTexture = undefined;
  }
}
