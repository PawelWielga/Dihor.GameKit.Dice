import { describe, expect, it } from "vitest";
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

  it("uses a negative bump scale so numeric markings read as recessed", () => {
    expect(getDiceFaceLabelBumpScale()).toBeLessThan(0);
    expect(getDiceFaceLabelBumpScale()).toBeGreaterThan(-0.2);
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
