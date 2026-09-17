import type { WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import { DiceRenderer } from "../src/index.js";

class FakeWebGLRenderer {
  readonly domElement = {} as HTMLCanvasElement;
  readonly setPixelRatio = vi.fn();
  readonly setSize = vi.fn();
  readonly render = vi.fn();
  readonly setAnimationLoop = vi.fn();
  readonly dispose = vi.fn();
}

function createContainer(initialWidth: number, initialHeight: number) {
  let width = initialWidth;
  let height = initialHeight;

  const appendChild = vi.fn((child: Node) => child);
  const removeChild = vi.fn((child: Node) => child);
  const container = {
    get clientWidth() {
      return width;
    },
    get clientHeight() {
      return height;
    },
    appendChild,
    removeChild
  } as unknown as HTMLElement;

  return {
    container,
    appendChild,
    removeChild,
    setSize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
    }
  };
}

describe("DiceRenderer", () => {
  it("mounts into a container and resizes the renderer and camera", () => {
    const fakeRenderer = new FakeWebGLRenderer();
    const fakeContainer = createContainer(640, 360);
    const renderer = new DiceRenderer(fakeContainer.container, {
      autoResize: false,
      pixelRatio: 3,
      rendererFactory: () => fakeRenderer as unknown as WebGLRenderer
    });

    expect(fakeContainer.appendChild).toHaveBeenCalledWith(fakeRenderer.domElement);
    expect(fakeRenderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(fakeRenderer.setSize).toHaveBeenLastCalledWith(640, 360, false);
    expect(renderer.diceScene.camera.aspect).toBeCloseTo(16 / 9);

    fakeContainer.setSize(800, 400);
    renderer.resize();

    expect(fakeRenderer.setSize).toHaveBeenLastCalledWith(800, 400, false);
    expect(renderer.diceScene.camera.aspect).toBe(2);
    renderer.dispose();
  });

  it("renders, starts and stops through the underlying WebGL renderer", () => {
    const fakeRenderer = new FakeWebGLRenderer();
    const fakeContainer = createContainer(320, 240);
    const renderer = new DiceRenderer(fakeContainer.container, {
      autoResize: false,
      rendererFactory: () => fakeRenderer as unknown as WebGLRenderer
    });

    renderer.render();
    renderer.start();
    renderer.stop();

    expect(fakeRenderer.render).toHaveBeenCalledWith(
      renderer.diceScene.scene,
      renderer.diceScene.camera
    );
    expect(fakeRenderer.setAnimationLoop).toHaveBeenCalledWith(expect.any(Function));
    expect(fakeRenderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
    renderer.dispose();
  });

  it("can be disposed repeatedly without double-disposing resources", () => {
    const fakeRenderer = new FakeWebGLRenderer();
    const fakeContainer = createContainer(320, 240);
    const renderer = new DiceRenderer(fakeContainer.container, {
      autoResize: false,
      rendererFactory: () => fakeRenderer as unknown as WebGLRenderer
    });

    renderer.dispose();
    renderer.dispose();

    expect(fakeRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(fakeContainer.removeChild).toHaveBeenCalledTimes(1);
  });
});
