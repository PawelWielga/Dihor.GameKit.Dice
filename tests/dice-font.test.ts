import { CanvasTexture, Mesh, MeshStandardMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiceMeshFactory } from "../src/index.js";
import {
  DEFAULT_DICE_FONT_APPEARANCE,
  mergeDiceAppearances,
  resolveDiceFaceLabelMode,
  resolveDiceFontAppearance
} from "../src/appearance/index.js";
import {
  loadDiceFont,
  type DiceFontLoadEnvironment
} from "../src/appearance/DiceFont.js";
import {
  DiceFaceLabelCache,
  getDiceFaceLabelBaseFontSize,
  getDiceFaceLabelBaseline,
  getDiceFaceLabelBumpScale,
  getDiceFaceLabelCanvasSize,
  getDiceFaceLabelPlaneScale,
  getDiceOrientationMarkerIndices,
  usesNumericFaceLabels
} from "../src/three/dice/DiceFaceLabels.js";

describe("dice font appearance", () => {
  it("uses bundled Cinzel 700 and D6 pips by default", () => {
    const resolved = resolveDiceFontAppearance();

    expect(resolved).toEqual(DEFAULT_DICE_FONT_APPEARANCE);
    expect(resolved.family).toBe("Cinzel");
    expect(resolved.weight).toBe(700);
    expect(resolved.size).toBe(1);
    expect(resolveDiceFaceLabelMode(undefined)).toBe("dots");
  });

  it("resolves a custom font and D6 numeric mode", () => {
    const resolved = resolveDiceFontAppearance({
      family: " Roboto Slab ",
      url: " /fonts/RobotoSlab.woff2 ",
      weight: 650,
      size: 1.2
    });

    expect(resolved).toEqual({
      family: "Roboto Slab",
      url: "/fonts/RobotoSlab.woff2",
      weight: 650,
      size: 1.2
    });
    expect(resolveDiceFaceLabelMode({ faceLabelMode: "numbers" })).toBe("numbers");
  });

  it("merges global and per-die font settings without losing face textures", () => {
    const merged = mergeDiceAppearances(
      {
        color: "#112233",
        font: {
          family: "Roboto Slab",
          url: "/fonts/RobotoSlab.woff2",
          weight: 600,
          size: 0.9
        },
        faces: { 1: "/one.png" }
      },
      {
        markingsColor: "#ffffff",
        font: { weight: 700 },
        faces: { 2: "/two.png" }
      }
    );

    expect(merged).toEqual({
      color: "#112233",
      markingsColor: "#ffffff",
      font: {
        family: "Roboto Slab",
        url: "/fonts/RobotoSlab.woff2",
        weight: 700,
        size: 0.9
      },
      faces: {
        1: "/one.png",
        2: "/two.png"
      }
    });
  });

  it("allows per-die font-size overrides through nested appearance merging", () => {
    const merged = mergeDiceAppearances(
      { font: { family: "Georgia", size: 0.85 } },
      { font: { size: 1.3 } }
    );

    expect(merged?.font).toEqual({
      family: "Georgia",
      size: 1.3
    });
  });

  it("falls back to bundled Cinzel when a custom font URL fails", async () => {
    const attempts: string[] = [];
    const environment: DiceFontLoadEnvironment = {
      async load(font) {
        attempts.push(font.family);

        if (font.family === "Broken Font") {
          throw new Error("network failure");
        }
      }
    };

    const resolved = await loadDiceFont(
      {
        family: "Broken Font",
        url: "/fonts/missing.woff2",
        weight: 700,
        size: 1.25
      },
      environment
    );

    expect(resolved).toEqual({
      ...DEFAULT_DICE_FONT_APPEARANCE,
      size: 1.25
    });
    expect(attempts).toEqual(["Broken Font", "Cinzel"]);
  });

  it("rejects invalid font weights, sizes and label modes", () => {
    expect(() => resolveDiceFontAppearance({ weight: 0 })).toThrow(RangeError);
    expect(() => resolveDiceFontAppearance({ size: 0.49 })).toThrow(RangeError);
    expect(() => resolveDiceFontAppearance({ size: 1.51 })).toThrow(RangeError);
    expect(() =>
      resolveDiceFaceLabelMode({ faceLabelMode: "letters" as never })
    ).toThrow(RangeError);
  });
});

describe("numeric face label rules", () => {
  it("keeps D6 pips independent from font sizing and enables numbers explicitly", () => {
    expect(usesNumericFaceLabels(6, undefined)).toBe(false);
    expect(usesNumericFaceLabels(6, { font: { size: 1.5 } })).toBe(false);
    expect(usesNumericFaceLabels(6, { faceLabelMode: "numbers" })).toBe(true);
  });

  it("uses numeric labels for every non-D6 supported die", () => {
    for (const sides of [4, 8, 10, 12, 20] as const) {
      expect(usesNumericFaceLabels(sides, undefined)).toBe(true);
    }
  });

  it("marks every 6 and 9 occurrence, including multi-digit values", () => {
    expect(getDiceOrientationMarkerIndices("6")).toEqual([0]);
    expect(getDiceOrientationMarkerIndices("9")).toEqual([0]);
    expect(getDiceOrientationMarkerIndices("19")).toEqual([1]);
    expect(getDiceOrientationMarkerIndices("69")).toEqual([0, 1]);
    expect(getDiceOrientationMarkerIndices("20")).toEqual([]);
  });

  it("uses slightly larger high-resolution face labels", () => {
    expect(getDiceFaceLabelCanvasSize()).toBe(1024);
    expect(getDiceFaceLabelBaseFontSize("6")).toBeGreaterThan(820);
    expect(getDiceFaceLabelBaseFontSize("20")).toBeGreaterThan(660);
    expect(getDiceFaceLabelBaseFontSize("6", 1.2)).toBeCloseTo(
      getDiceFaceLabelBaseFontSize("6") * 1.2
    );
    expect(getDiceFaceLabelBaseFontSize("20", 0.75)).toBeCloseTo(
      getDiceFaceLabelBaseFontSize("20") * 0.75
    );
    expect(getDiceFaceLabelPlaneScale(4)).toBeCloseTo(0.57);
    expect(getDiceFaceLabelPlaneScale(6)).toBeCloseTo(0.84);
    expect(getDiceFaceLabelPlaneScale(8)).toBeCloseTo(0.65);
    expect(getDiceFaceLabelPlaneScale(10)).toBeCloseTo(0.59);
    expect(getDiceFaceLabelPlaneScale(12)).toBeCloseTo(0.7);
    expect(getDiceFaceLabelPlaneScale(20)).toBeCloseTo(0.65);
  });

  it("scales the recessed bump effect by semantic engraving depth", () => {
    expect(getDiceFaceLabelBumpScale()).toBeLessThan(0);
    expect(getDiceFaceLabelBumpScale()).toBeGreaterThan(-0.2);
    expect(getDiceFaceLabelBumpScale(0)).toBe(0);
    expect(getDiceFaceLabelBumpScale(2)).toBeCloseTo(getDiceFaceLabelBumpScale() * 2);
  });

  it("centers numeral bounds independently of orientation dots", () => {
    const canvasSize = getDiceFaceLabelCanvasSize();
    const ascent = 500;
    const descent = 36;
    const baseline = getDiceFaceLabelBaseline(canvasSize, ascent, descent);
    const top = baseline - ascent;
    const bottom = baseline + descent;

    expect((top + bottom) / 2).toBe(canvasSize / 2);
    expect(getDiceOrientationMarkerIndices("6")).toEqual([0]);
    expect(getDiceOrientationMarkerIndices("8")).toEqual([]);
  });
});


describe("numeric face label resource cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installCanvasStub() {
    let created = 0;
    const createCanvas = () => {
      created += 1;
      const canvas: Record<string, unknown> = { width: 0, height: 0 };
      const context = {
        font: "",
        textAlign: "left",
        textBaseline: "alphabetic",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        fillStyle: "#ffffff",
        measureText(character: string) {
          return {
            width: character.length * 500,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: character.length * 500,
            actualBoundingBoxAscent: 650,
            actualBoundingBoxDescent: 120
          };
        },
        clearRect() {},
        fillRect() {},
        fillText() {},
        beginPath() {},
        arc() {},
        fill() {},
        drawImage() {}
      };
      canvas.getContext = () => context;
      return canvas;
    };

    vi.stubGlobal("document", {
      createElement(tag: string) {
        if (tag !== "canvas") {
          throw new Error(`Unexpected element: ${tag}`);
        }
        return createCanvas();
      }
    });

    return { created: () => created };
  }

  it("reuses identical D10 label and bump textures until the factory is disposed", () => {
    const canvases = installCanvasStub();
    const factory = new DiceMeshFactory();
    const first = factory.create(10);
    const firstCanvasCount = canvases.created();
    const second = factory.create(10);
    const third = factory.create(10);

    expect(firstCanvasCount).toBe(20);
    expect(canvases.created()).toBe(firstCanvasCount);

    const firstLabel = first.object.getObjectByName("D10 font label 1") as Mesh;
    const secondLabel = second.object.getObjectByName("D10 font label 1") as Mesh;
    const firstTexture = (firstLabel.material as MeshStandardMaterial).map!;
    const secondTexture = (secondLabel.material as MeshStandardMaterial).map!;
    const disposeTexture = vi.spyOn(firstTexture, "dispose");

    expect(secondTexture).toBe(firstTexture);

    first.dispose();
    expect(disposeTexture).not.toHaveBeenCalled();

    second.dispose();
    third.dispose();
    factory.dispose();
    expect(disposeTexture).toHaveBeenCalledTimes(1);
  });

  it("reuses raster textures when only markings color or engraving depth changes", () => {
    const canvases = installCanvasStub();
    const factory = new DiceMeshFactory();

    const first = factory.create(10, {
      appearance: { markingsColor: "#111111", engravingDepth: 0.5 }
    });
    const firstCanvasCount = canvases.created();
    const second = factory.create(10, {
      appearance: { markingsColor: "#eeeeee", engravingDepth: 1.75 }
    });

    expect(canvases.created()).toBe(firstCanvasCount);

    const firstLabel = first.object.getObjectByName("D10 font label 1") as Mesh;
    const secondLabel = second.object.getObjectByName("D10 font label 1") as Mesh;
    const firstMaterial = firstLabel.material as MeshStandardMaterial;
    const secondMaterial = secondLabel.material as MeshStandardMaterial;

    expect(secondMaterial.map).toBe(firstMaterial.map);
    expect(secondMaterial.bumpMap).toBe(firstMaterial.bumpMap);
    expect(firstMaterial.color.getHexString()).toBe("111111");
    expect(secondMaterial.color.getHexString()).toBe("eeeeee");
    expect(firstMaterial.bumpScale).toBeCloseTo(getDiceFaceLabelBumpScale(0.5));
    expect(secondMaterial.bumpScale).toBeCloseTo(getDiceFaceLabelBumpScale(1.75));

    first.dispose();
    second.dispose();
    factory.dispose();
  });

  it("shares the same value/font raster across different dice sides", () => {
    const canvases = installCanvasStub();
    const factory = new DiceMeshFactory();
    const d10 = factory.create(10);
    const afterD10 = canvases.created();
    const d20 = factory.create(20);

    const d10Label = d10.object.getObjectByName("D10 font label 1") as Mesh;
    const d20Label = d20.object.getObjectByName("D20 font label 1") as Mesh;

    expect((d20Label.material as MeshStandardMaterial).map).toBe(
      (d10Label.material as MeshStandardMaterial).map
    );
    expect(canvases.created()).toBe(afterD10 + 20);

    d10.dispose();
    d20.dispose();
    factory.dispose();
  });

  it("creates a new raster when font family or size changes", () => {
    const canvases = installCanvasStub();
    const factory = new DiceMeshFactory();

    const base = factory.create(10);
    const baseCanvasCount = canvases.created();
    const family = factory.create(10, {
      appearance: { font: { family: "Georgia" } }
    });
    const familyCanvasCount = canvases.created();
    const size = factory.create(10, {
      appearance: { font: { family: "Georgia", size: 1.2 } }
    });

    expect(familyCanvasCount).toBe(baseCanvasCount * 2);
    expect(canvases.created()).toBe(baseCanvasCount * 3);

    base.dispose();
    family.dispose();
    size.dispose();
    factory.dispose();
  });

  it("evicts only unused LRU resources when the cache exceeds its limit", () => {
    const cache = new DiceFaceLabelCache(2);

    function resource() {
      const texture = new CanvasTexture({} as HTMLCanvasElement);
      const bumpTexture = new CanvasTexture({} as HTMLCanvasElement);
      const dispose = vi.fn(() => {
        texture.dispose();
        bumpTexture.dispose();
      });

      return { texture, bumpTexture, dispose };
    }

    const a = resource();
    const b = resource();
    const c = resource();
    const leaseA = cache.acquire("a", () => a)!;
    const leaseB = cache.acquire("b", () => b)!;
    const leaseC = cache.acquire("c", () => c)!;

    expect(cache.size).toBe(3);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).not.toHaveBeenCalled();
    expect(c.dispose).not.toHaveBeenCalled();

    leaseC.release();

    expect(cache.size).toBe(2);
    expect(c.dispose).toHaveBeenCalledTimes(1);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).not.toHaveBeenCalled();

    leaseA.release();
    leaseB.release();
    cache.dispose();

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(c.dispose).toHaveBeenCalledTimes(1);
  });
});
