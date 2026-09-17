import { DoubleSide, Mesh, WebGLRenderer, type WebGLRendererParameters } from "three";
import { DiceScene, type DiceSceneOptions } from "./DiceScene.js";

export type DiceWebGLRendererFactory = (parameters: WebGLRendererParameters) => WebGLRenderer;

export interface DiceRendererOptions {
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  readonly pixelRatio?: number;
  readonly autoResize?: boolean;
  readonly rendererFactory?: DiceWebGLRendererFactory;
  readonly scene?: DiceSceneOptions;
}

const createWebGLRenderer: DiceWebGLRendererFactory = (parameters) => new WebGLRenderer(parameters);

function normalizePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(value, 2);
}

/** Mounts and drives the DiceKit Three.js scene inside a caller-provided DOM container. */
export class DiceRenderer {
  readonly diceScene: DiceScene;

  private readonly container: HTMLElement;
  private readonly webglRenderer: WebGLRenderer;
  private resizeObserver?: ResizeObserver;
  private windowResizeHandler?: () => void;
  private canvasAttached = false;
  private disposed = false;

  constructor(container: HTMLElement, options: DiceRendererOptions = {}) {
    if (!container || typeof container.appendChild !== "function") {
      throw new TypeError("DiceRenderer requires a valid HTMLElement container.");
    }

    this.container = container;
    this.diceScene = new DiceScene(options.scene);
    this.webglRenderer = (options.rendererFactory ?? createWebGLRenderer)({
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false
    });

    const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    this.webglRenderer.setPixelRatio(normalizePixelRatio(options.pixelRatio ?? devicePixelRatio));

    this.container.appendChild(this.webglRenderer.domElement);
    this.canvasAttached = true;
    this.resize();

    if (options.autoResize !== false) {
      this.attachResizeHandling();
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.webglRenderer.domElement;
  }

  get renderer(): WebGLRenderer {
    return this.webglRenderer;
  }

  resize(): void {
    if (this.disposed) {
      return;
    }

    const width = Math.max(1, this.container.clientWidth || 1);
    const height = Math.max(1, this.container.clientHeight || 1);

    this.diceScene.setSize(width, height);
    this.webglRenderer.setSize(width, height, false);
  }

  render(): void {
    if (this.disposed) {
      return;
    }

    // Temporary dev diagnostic: if the D8 artifact is caused by a reversed triangle,
    // rendering both sides will make the missing/dark wedge disappear. Remove once verified.
    this.diceScene.content.traverse((object) => {
      if (object.name !== "D8 body" || !(object instanceof Mesh)) {
        return;
      }

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.side = DoubleSide;
      }
    });

    this.webglRenderer.render(this.diceScene.scene, this.diceScene.camera);
  }

  start(): void {
    if (this.disposed) {
      throw new Error("Cannot start a disposed DiceRenderer.");
    }

    this.webglRenderer.setAnimationLoop(() => this.render());
  }

  stop(): void {
    if (this.disposed) {
      return;
    }

    this.webglRenderer.setAnimationLoop(null);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stop();
    this.resizeObserver?.disconnect();

    if (this.windowResizeHandler && typeof window !== "undefined") {
      window.removeEventListener("resize", this.windowResizeHandler);
    }

    this.diceScene.dispose();
    this.webglRenderer.dispose();

    if (this.canvasAttached) {
      this.container.removeChild(this.webglRenderer.domElement);
      this.canvasAttached = false;
    }

    this.disposed = true;
  }

  private attachResizeHandling(): void {
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      return;
    }

    if (typeof window !== "undefined") {
      this.windowResizeHandler = () => this.resize();
      window.addEventListener("resize", this.windowResizeHandler);
    }
  }
}
