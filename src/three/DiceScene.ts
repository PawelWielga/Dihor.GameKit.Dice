import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
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

export interface DiceSceneOptions {
  readonly background?: ColorRepresentation | null;

  /** Legacy color shortcut retained for compatibility. Prefer table.color for new code. */
  readonly floorColor?: ColorRepresentation;

  /** Visible table material configuration. */
  readonly table?: DiceTableMaterialOptions;
  readonly showFloor?: boolean;
}

const DEFAULT_BACKGROUND = 0x111318;
const DEFAULT_FLOOR = 0x292d33;

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeTextureUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/** Owns the Three.js scene graph used by DiceKit, without any physics logic. */
export class DiceScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly content: Group;

  private readonly floorGeometry?: PlaneGeometry;
  private readonly floorMaterial?: MeshStandardMaterial;
  private readonly floorTextureLoader = new TextureLoader();
  private floorTexture?: Texture;
  private floorTextureUrl?: string;
  private floorTextureRequest = 0;
  private floorTextureLoad?: Promise<void>;
  private disposed = false;

  constructor(options: DiceSceneOptions = {}) {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
    this.content = new Group();

    const background = options.background === undefined ? DEFAULT_BACKGROUND : options.background;
    this.scene.background = background === null ? null : new Color(background);

    this.camera.position.set(0, 5.5, 7.5);
    this.camera.lookAt(0, 0, 0);

    this.content.name = "PartyBeam.DiceKit content";
    this.scene.add(this.content);

    const ambientLight = new AmbientLight(0xffffff, 1.4);
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(4, 8, 5);
    this.scene.add(ambientLight, keyLight);

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

  setSize(width: number, height: number): void {
    const safeWidth = normalizeDimension(width);
    const safeHeight = normalizeDimension(height);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
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
    this.scene.clear();
    this.floorGeometry?.dispose();
    this.floorMaterial?.dispose();
  }

  private releaseFloorTexture(): void {
    this.floorTexture?.dispose();
    this.floorTexture = undefined;
  }
}
