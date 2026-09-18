import { describe, expect, it } from "vitest";
import {
  DICE_ROLL_EVENT_TYPE,
  DICE_ROLL_EVENT_VERSION,
  resolveDiceRollEventAppearances
} from "../src/advanced.js";

function eventWithAppearance(appearance: Record<string, unknown>) {
  return {
    type: DICE_ROLL_EVENT_TYPE,
    version: DICE_ROLL_EVENT_VERSION,
    rollId: "asset-policy",
    dice: [{ sides: 6, value: 4, appearance }],
    modifier: 0,
    total: 4
  };
}

describe("DiceRollEvent asset policy", () => {
  it("allows relative/local asset paths by default", () => {
    const event = eventWithAppearance({
      texture: "/assets/dice.png",
      normalMap: "./normal.png",
      faces: { 4: "../faces/four.png" },
      font: { family: "Cinzel", url: "/fonts/cinzel.woff2" }
    });

    expect(resolveDiceRollEventAppearances(event)).toEqual([
      {
        texture: "/assets/dice.png",
        normalMap: "./normal.png",
        faces: { 4: "../faces/four.png" },
        font: { family: "Cinzel", url: "/fonts/cinzel.woff2" }
      }
    ]);
  });

  it("blocks external HTTP(S) origins by default", () => {
    for (const source of [
      "https://example.com/dice.png",
      "http://example.com/dice.png",
      "//example.com/dice.png"
    ]) {
      const event = eventWithAppearance({ texture: source });
      expect(() => resolveDiceRollEventAppearances(event)).toThrowError(/origin is not allowed/i);
    }
  });

  it("allows only explicitly approved HTTP(S) origins", () => {
    const allowed = eventWithAppearance({
      texture: "https://cdn.example.com/dice.png",
      normalMap: "https://cdn.example.com/normal.png"
    });

    expect(
      resolveDiceRollEventAppearances(allowed, {
        allowedOrigins: ["https://cdn.example.com"]
      })
    ).toEqual([
      {
        texture: "https://cdn.example.com/dice.png",
        normalMap: "https://cdn.example.com/normal.png"
      }
    ]);

    const blocked = eventWithAppearance({
      texture: "https://other.example.com/dice.png"
    });

    expect(() =>
      resolveDiceRollEventAppearances(blocked, {
        allowedOrigins: ["https://cdn.example.com"]
      })
    ).toThrowError(/other\.example\.com/i);
  });

  it("requires explicit opt-in for non-web schemes", () => {
    const event = eventWithAppearance({
      texture: "data:image/png;base64,AAAA"
    });

    expect(() => resolveDiceRollEventAppearances(event)).toThrowError(/scheme is not allowed/i);
    expect(
      resolveDiceRollEventAppearances(event, {
        allowedSchemes: ["data"]
      })
    ).toEqual([{ texture: "data:image/png;base64,AAAA" }]);
  });

  it("can resolve logical application asset IDs to local assets", () => {
    const event = eventWithAppearance({
      texture: "theme:marble",
      faces: { 4: "theme:critical" }
    });

    const contexts: string[] = [];
    const appearances = resolveDiceRollEventAppearances(event, {
      resolve: (source, context) => {
        contexts.push(`${context.kind}:${context.face ?? "-"}:${source}`);
        if (source === "theme:marble") {
          return "/themes/marble/die.png";
        }
        if (source === "theme:critical") {
          return "/themes/marble/critical.png";
        }
        return undefined;
      }
    });

    expect(appearances).toEqual([
      {
        texture: "/themes/marble/die.png",
        faces: { 4: "/themes/marble/critical.png" }
      }
    ]);
    expect(contexts).toEqual([
      "texture:-:theme:marble",
      "face:4:theme:critical"
    ]);
  });

  it("can reject every event-provided asset and require resolver-owned assets", () => {
    const relative = eventWithAppearance({ texture: "/assets/dice.png" });

    expect(() =>
      resolveDiceRollEventAppearances(relative, {
        allowRelative: false
      })
    ).toThrowError(/relative asset is not allowed/i);

    expect(() =>
      resolveDiceRollEventAppearances(relative, {
        resolve: () => undefined
      })
    ).toThrowError(/rejected by the application resolver/i);
  });
});
