import { describe, expect, it } from "vitest";
import {
  SUPPORTED_DICE_SIDES,
  type DiceAppearance,
  type DiceRollRequest,
  type DiceRollResult
} from "../src/index.js";

describe("public domain API", () => {
  it("exposes the planned standard dice sides", () => {
    expect(SUPPORTED_DICE_SIDES).toEqual([4, 6, 8, 10, 12, 20]);
  });

  it("allows every die in one request to define its own appearance", () => {
    const request: DiceRollRequest = {
      dice: [
        {
          sides: 6,
          appearance: {
            color: "#7b1e1e",
            markingsColor: "#f5e6c8"
          }
        },
        {
          sides: 20,
          appearance: {
            color: "#16304a",
            faces: {
              20: "/textures/critical.png"
            }
          }
        }
      ],
      modifier: 1,
      reason: "Attack"
    };

    expect(request.dice).toHaveLength(2);
    expect(request.dice[0]?.appearance?.color).toBe("#7b1e1e");
    expect(request.dice[1]?.appearance?.faces?.[20]).toBe("/textures/critical.png");
  });

  it("models missing face texture overrides as undefined", () => {
    const appearance: DiceAppearance = {
      faces: {
        20: "/textures/critical.png"
      }
    };

    const missingFace: string | undefined = appearance.faces?.[1];

    expect(missingFace).toBeUndefined();
  });

  it("defines an authoritative result contract with roll id and normalized modifier", () => {
    const result: DiceRollResult = {
      rollId: "roll-1",
      dice: [
        { sides: 6, value: 4 },
        { sides: 20, value: 17 }
      ],
      modifier: 1,
      total: 22,
      reason: "Attack"
    };

    expect(result.rollId).toBe("roll-1");
    expect(result.total).toBe(22);
  });
});
