import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICE_APPEARANCE,
  resolveDiceAppearance
} from "../src/index.js";

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
      roughness: 0.65,
      metalness: DEFAULT_DICE_APPEARANCE.metalness
    });
  });

  it("rejects invalid material factors and empty colors", () => {
    expect(() => resolveDiceAppearance({ roughness: -0.1 })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ metalness: 1.1 })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ color: "   " })).toThrowError(RangeError);
    expect(() => resolveDiceAppearance({ markingsColor: "" })).toThrowError(RangeError);
  });
});
