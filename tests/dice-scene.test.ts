import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import { DiceScene } from "../src/index.js";

describe("DiceScene", () => {
  it("aligns the visible floor with the physics plane at world y=0", () => {
    const scene = new DiceScene();
    const floor = scene.scene.getObjectByName("PartyBeam.DiceKit floor");

    expect(floor?.position.y).toBe(0);
    scene.dispose();
  });

  it("updates camera aspect ratio when its viewport changes", () => {
    const scene = new DiceScene({ showFloor: false });

    scene.setSize(1920, 1080);

    expect(scene.camera.aspect).toBeCloseTo(16 / 9);
    scene.dispose();
  });

  it("normalizes invalid dimensions instead of producing a broken projection", () => {
    const scene = new DiceScene({ showFloor: false });

    scene.setSize(Number.NaN, 0);

    expect(scene.camera.aspect).toBe(1);
    scene.dispose();
  });

  it("applies physics-independent transforms to render objects", () => {
    const scene = new DiceScene({ showFloor: false });
    const object = new Object3D();
    scene.add(object);

    scene.applyTransform(object, {
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0, y: 0.5, z: 0, w: 0.5 }
    });

    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.quaternion.toArray()).toEqual([0, 0.5, 0, 0.5]);

    scene.remove(object);
    expect(scene.content.children).not.toContain(object);
    scene.dispose();
    scene.dispose();
  });
});
