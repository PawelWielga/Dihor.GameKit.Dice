import { describe, expect, it } from "vitest";
import {
  DiceAudioEngine,
  resolveDiceAudioOptions,
  resolveDiceCollisionSound
} from "../src/audio/index.js";

describe("dice audio", () => {
  it("maps light, strong and spatial collisions to bounded sound cues", () => {
    expect(resolveDiceCollisionSound(0.2, 0, 5)).toBeUndefined();

    const rolling = resolveDiceCollisionSound(1.2, -2.5, 5);
    expect(rolling).toMatchObject({ kind: "roll", pan: -0.5 });
    expect(rolling!.gain).toBeGreaterThan(0);
    expect(rolling!.gain).toBeLessThanOrEqual(0.7);

    const impact = resolveDiceCollisionSound(5, 20, 5);
    expect(impact).toMatchObject({ kind: "impact", pan: 1 });
    expect(impact!.gain).toBeCloseTo(0.7);
  });

  it("supports disabling spatialization and audio entirely", () => {
    expect(
      resolveDiceCollisionSound(3, 4, 5, { spatial: false, volume: 0.5 })
    ).toMatchObject({ kind: "impact", pan: 0 });

    expect(resolveDiceCollisionSound(3, 0, 5, { enabled: false })).toBeUndefined();
  });

  it("validates public audio configuration", () => {
    const custom = resolveDiceAudioOptions({
      volume: 0.4,
      collisionThreshold: 0.5,
      strongImpactThreshold: 3,
      cooldownMs: 80,
      maxVoices: 6,
      pitchVariation: 0.02,
      samples: {
        impact: ["/impact.ogg"],
        roll: ["/roll.ogg"]
      }
    });

    expect(custom.volume).toBe(0.4);
    expect(custom.impactSamples).toEqual(["/impact.ogg"]);
    expect(custom.rollSamples).toEqual(["/roll.ogg"]);

    expect(() => resolveDiceAudioOptions({ volume: 2 })).toThrowError(RangeError);
    expect(() =>
      resolveDiceAudioOptions({
        collisionThreshold: 2,
        strongImpactThreshold: 1
      })
    ).toThrowError(RangeError);
    expect(() =>
      resolveDiceAudioOptions({
        samples: { impact: [] }
      })
    ).toThrowError(RangeError);
  });

  it("is a safe no-op when Web Audio is unavailable", () => {
    const engine = new DiceAudioEngine();
    expect(() => engine.attach([], 5)).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});
