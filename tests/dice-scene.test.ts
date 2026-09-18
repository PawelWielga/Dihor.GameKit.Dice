import { AmbientLight, DirectionalLight, Object3D, PointLight, Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DiceScene } from "../src/index.js";

describe("DiceScene", () => {
  it("aligns the visible floor with the physics plane at world y=0", () => {
    const scene = new DiceScene();
    const floor = scene.scene.getObjectByName("Dihor.GameKit.Dice floor");

    expect(floor?.position.y).toBe(0);
    scene.dispose();
  });

  it("preserves the existing neutral lighting as the default", () => {
    const scene = new DiceScene({ showFloor: false });
    const ambient = scene.scene.getObjectByName("Dihor.GameKit.Dice ambient light") as AmbientLight;
    const key = scene.scene.getObjectByName("Dihor.GameKit.Dice directional light 1") as DirectionalLight;

    expect(ambient).toBeInstanceOf(AmbientLight);
    expect(ambient.color.getHex()).toBe(0xffffff);
    expect(ambient.intensity).toBeCloseTo(1.4);
    expect(key).toBeInstanceOf(DirectionalLight);
    expect(key.color.getHex()).toBe(0xffffff);
    expect(key.intensity).toBeCloseTo(2.2);
    expect(key.position.toArray()).toEqual([4, 8, 5]);
    expect(key.castShadow).toBe(false);
    expect(scene.hasShadowCastingLights).toBe(false);
    scene.dispose();
  });

  it("configures ambient, directional and point lights without rebuilding scene state", () => {
    const scene = new DiceScene({
      showFloor: false,
      lighting: {
        ambient: {
          color: "#223344",
          intensity: 0.35
        },
        lights: [
          {
            type: "directional",
            color: "#ffcc88",
            intensity: 2.8,
            position: { x: -3, y: 7, z: 2 },
            castShadow: true
          },
          {
            type: "point",
            color: "#6699ff",
            intensity: 1.6,
            position: { x: 1, y: 4, z: -2 },
            distance: 12,
            decay: 1.5
          }
        ]
      }
    });
    const ambient = scene.scene.getObjectByName("Dihor.GameKit.Dice ambient light") as AmbientLight;
    const directional = scene.scene.getObjectByName("Dihor.GameKit.Dice directional light 1") as DirectionalLight;
    const point = scene.scene.getObjectByName("Dihor.GameKit.Dice point light 2") as PointLight;

    expect(ambient.color.getHexString()).toBe("223344");
    expect(ambient.intensity).toBeCloseTo(0.35);
    expect(directional.position.toArray()).toEqual([-3, 7, 2]);
    expect(directional.castShadow).toBe(true);
    expect(point).toBeInstanceOf(PointLight);
    expect(point.color.getHexString()).toBe("6699ff");
    expect(point.intensity).toBeCloseTo(1.6);
    expect(point.position.toArray()).toEqual([1, 4, -2]);
    expect(point.distance).toBeCloseTo(12);
    expect(point.decay).toBeCloseTo(1.5);
    expect(scene.hasShadowCastingLights).toBe(true);

    scene.setLighting({
      ambient: { intensity: 0.2 },
      lights: []
    });

    expect(scene.scene.getObjectByName("Dihor.GameKit.Dice directional light 1")).toBeUndefined();
    expect(scene.scene.getObjectByName("Dihor.GameKit.Dice point light 2")).toBeUndefined();
    expect(scene.hasShadowCastingLights).toBe(false);
    scene.dispose();
  });

  it("preserves the default table color and accepts table color configuration", async () => {
    const defaultScene = new DiceScene();
    const defaultFloor = defaultScene.scene.getObjectByName("Dihor.GameKit.Dice floor") as Mesh;
    const defaultMaterial = defaultFloor.material as MeshStandardMaterial;

    expect(defaultMaterial.color.getHex()).toBe(0x292d33);
    defaultScene.dispose();

    const scene = new DiceScene({ table: { color: "#315a43" } });
    const floor = scene.scene.getObjectByName("Dihor.GameKit.Dice floor") as Mesh;
    const material = floor.material as MeshStandardMaterial;

    expect(material.color.getHexString()).toBe("315a43");

    await scene.setTableMaterial({ color: "#74512f", texture: "   " });

    expect(material.color.getHexString()).toBe("74512f");
    expect(material.map).toBeNull();
    scene.dispose();
  });

  it("keeps the legacy floorColor shortcut working", () => {
    const scene = new DiceScene({ floorColor: "#123456" });
    const floor = scene.scene.getObjectByName("Dihor.GameKit.Dice floor") as Mesh;
    const material = floor.material as MeshStandardMaterial;

    expect(material.color.getHexString()).toBe("123456");
    scene.dispose();
  });

  it("preserves the previous default camera framing through orbital defaults", () => {
    const scene = new DiceScene({ showFloor: false });

    expect(scene.camera.position.x).toBeCloseTo(0);
    expect(scene.camera.position.y).toBeCloseTo(5.5);
    expect(scene.camera.position.z).toBeCloseTo(7.5);
    scene.dispose();
  });

  it("treats x=0 and y=0 as an exact top-down view", () => {
    const scene = new DiceScene({
      showFloor: false,
      camera: { x: 0, y: 0, z: 10 }
    });
    const direction = new Vector3();
    scene.camera.getWorldDirection(direction);

    expect(scene.camera.position.x).toBeCloseTo(0);
    expect(scene.camera.position.y).toBeCloseTo(10);
    expect(scene.camera.position.z).toBeCloseTo(0);
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(-1);
    expect(direction.z).toBeCloseTo(0);
    scene.dispose();
  });

  it("updates orbital camera x/y/z without rebuilding the scene", () => {
    const scene = new DiceScene({ showFloor: false });

    scene.setCamera({ x: 90, y: 60, z: 10 });

    expect(scene.camera.position.x).toBeCloseTo(Math.sqrt(75));
    expect(scene.camera.position.y).toBeCloseTo(5);
    expect(scene.camera.position.z).toBeCloseTo(0);

    scene.setCamera({ x: 180 });

    expect(scene.camera.position.x).toBeCloseTo(0);
    expect(scene.camera.position.y).toBeCloseTo(5);
    expect(scene.camera.position.z).toBeCloseTo(-Math.sqrt(75));
    scene.dispose();
  });

  it("updates camera aspect ratio when its viewport changes", () => {
    const scene = new DiceScene({ showFloor: false });

    scene.setSize(1920, 1080);

    expect(scene.camera.aspect).toBeCloseTo(16 / 9);
    scene.dispose();
  });

  it("projects a top-down camera viewport onto the table plane", () => {
    const scene = new DiceScene({
      showFloor: false,
      camera: { x: 0, y: 0, z: 10 }
    });
    scene.setSize(200, 100);

    const boundary = scene.getTableBoundary();
    const xs = boundary.map((point) => point.x);
    const zs = boundary.map((point) => point.z);
    const halfHeight = 10 * Math.tan((45 / 2) * (Math.PI / 180));

    expect(boundary).toHaveLength(4);
    expect(Math.max(...xs)).toBeCloseTo(halfHeight * 2, 4);
    expect(Math.min(...xs)).toBeCloseTo(-halfHeight * 2, 4);
    expect(Math.max(...zs)).toBeCloseTo(halfHeight, 4);
    expect(Math.min(...zs)).toBeCloseTo(-halfHeight, 4);
    scene.dispose();
  });

  it("updates projected table boundaries after camera and viewport changes", () => {
    const scene = new DiceScene({ showFloor: false, camera: { x: 0, y: 20, z: 10 } });
    scene.setSize(800, 800);
    const first = scene.getTableBoundary();

    scene.setCamera({ x: 45, y: 35, z: 12 });
    scene.setSize(1600, 900);
    const second = scene.getTableBoundary();

    expect(second).toHaveLength(4);
    expect(second).not.toEqual(first);
    expect(second.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
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
