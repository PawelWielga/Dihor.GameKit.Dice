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
  type ColorRepresentation,
  type Object3D
} from "three";
import type { DiceTransform } from "./DiceTransform.js";

export interface DiceSceneOptions {
  readonly background?: ColorRepresentation | null;
  readonly floorColor?: ColorRepresentation;
  readonly showFloor?: boolean;
}

const DEFAULT_BACKGROUND = 0x111318;
const DEFAULT_FLOOR = 0x292d33;

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Owns the Three.js scene graph used by DiceKit, without any physics logic. */
export class DiceScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly content: Group;

  private readonly floorGeometry?: PlaneGeometry;
  private readonly floorMaterial?: MeshStandardMaterial;
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
      this.floorGeometry = new PlaneGeometry(20, 20);
      this.floorMaterial = new MeshStandardMaterial({
        color: options.floorColor ?? DEFAULT_FLOOR,
        metalness: 0,
        roughness: 0.9
      });

      const floor = new Mesh(this.floorGeometry, this.floorMaterial);
      floor.name = "PartyBeam.DiceKit floor";
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.5;
      this.scene.add(floor);
    }
  }

  setSize(width: number, height: number): void {
    const safeWidth = normalizeDimension(width);
    const safeHeight = normalizeDimension(height);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
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
    this.content.clear();
    this.scene.clear();
    this.floorGeometry?.dispose();
    this.floorMaterial?.dispose();
  }
}
