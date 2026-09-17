import { Object3D, type Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DiceScene } from "../src/index.js";

describe("DiceScene", () => {
  it("aligns the visible floor with the physics plane at world y=0", () => {
    const scene = new DiceScene();
    const floor = scene.scene.getObjectByName("PartyBeam.DiceKit floor");

    expect(floor?.position.y).toBe(0);
    scene.dispose();
  });

  it("preserves the default table color and accepts table color configuration", async () => {
    const defaultScene = new DiceScene();
    const defaultFloor = defaultScene.scene.getObjectByName("PartyBeam.DiceKit floor") as Mesh;
    const defaultMaterial = defaultFloor.material as MeshStandardMaterial;

    expect(defaultMaterial.color.getHex()).toBe(0x292d33);
    defaultScene.dispose();

    const scene = new DiceScene({ table: { color: "#315a43" } });
    const floor = scene.scene.getObjectByName("PartyBeam.DiceKit floor") as Mesh;
    const material = floor.material as MeshStandardMaterial;

    expect(material.color.getHexString()).toBe("315a43");

    await scene.setTableMaterial({ color: "#74512f", texture: "   " });

    expect(material.color.getHexString()).toBe("74512f");
    expect(material.map).toBeNull();
    scene.dispose();
  });

  it("keeps the legacy floorColor shortcut working", () => {
    const scene = new DiceScene({ floorColor: "#123456" });
    const floor = scene.scene.getObjectByName("PartyBeam.DiceKit floor") as Mesh;
    const material = floor.material as MeshStandardMaterial;

    expect(material.color.getHexString()).toBe("123456");
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
