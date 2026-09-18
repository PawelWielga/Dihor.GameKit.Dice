import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICE_APPEARANCE,
  hasDiceTextureSources,
  resolveDiceAppearance
} from "../src/advanced.js";

describe("DiceAppearance", () => {
  it("provides a readable default appearance", () => {
    expect(resolveDiceAppearance()).toEqual(DEFAULT_DICE_APPEARANCE);
  });

  it("merges partial appearance overrides with defaults", () => {
    expect(
      resolveDiceAppearance({
        color: "#7b1e1e",
        roughness: 0.65
      })
    ).toEqual({
      color: "#7b1e1e",
      markingsColor: DEFAULT_DICE_APPEARANCE.markingsColor,
      engravingDepth: DEFAULT_DICE_APPEARANCE.engravingDepth,
      roughness: 0.65,
      metalness: DEFAULT_DICE_APPEARANCE.metalness
    });
  });

  it("detects global and per-face texture sources", () => {
    expect(hasDiceTextureSources(undefined)).toBe(false);
    expect(hasDiceTextureSources({ color: "#ffffff" })).toBe(false);
    expect(hasDiceTextureSources({ texture: "/body.png" })).toBe(true);
    expect(hasDiceTextureSources({ normalMap: "/normal.png" })).toBe(true);
    expect(hasDiceTextureSources({ faces: { 6: "/critical.png" } })).toBe(true);
    expect(hasDiceTextureSources({ texture: "   ", faces: { 1: "" } })).toBe(false);
  });

  it("supports configurable engraving depth including a flat zero value", () => {
    expect(resolveDiceAppearance({ engravingDepth: 0 }).engravingDepth).toBe(0);
    expect(resolveDiceAppearance({ engravingDepth: 1.6 }).engravingDepth).toBe(1.6);
    expect(() => resolveDiceAppearance({ engravingDepth: -0.01 })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ engravingDepth: 2.01 })).toThrowError(RangeError);
  });

  it("rejects invalid material factors and empty colors", () => {
    expect(() => resolveDiceAppearance({ roughness: -0.1 })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ metalness: 1.1 })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ color: "   " })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ markingsColor: "" })).toThrowError(RangeError);
  });
});
