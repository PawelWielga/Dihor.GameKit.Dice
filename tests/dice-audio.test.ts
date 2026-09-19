import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiceAudioEngine,
  resolveDiceAudioOptions,
  resolveDiceCollisionSound
} from "../src/audio/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dice audio", () => {
  it("maps light, strong and spatial collisions to bounded sound cues", () => {
    expect(resolveDiceCollisionSound(0.2, 0, 5)).toBeUndefined();

    expect(resolveDiceCollisionSound(1.2, -2.5, 5)).toBeUndefined();

    const rolling = resolveDiceCollisionSound(1.2, -2.5, 5, {
      samples: { roll: ["/roll.ogg"] }
    });
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

    expect(resolveDiceAudioOptions().rollSamples).toEqual([]);
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

  it("keeps prepare pending until all samples finish loading and decoding", async () => {
    const fetchResolvers: Array<() => void> = [];
    const decodeAudioData = vi.fn(async (_data: ArrayBuffer) => ({}) as AudioBuffer);
    const close = vi.fn(async () => undefined);

    class FakeAudioContext {
      state: AudioContextState = "suspended";
      readonly destination = {} as AudioDestinationNode;

      decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
        return decodeAudioData(data);
      }

      resume(): Promise<void> {
        this.state = "running";
        return Promise.resolve();
      }

      close(): Promise<void> {
        this.state = "closed";
        return close();
      }
    }

    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          fetchResolvers.push(() =>
            resolve({
              ok: true,
              arrayBuffer: async () => new ArrayBuffer(8)
            } as Response)
          );
        })
    );

    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", fetchMock);

    const engine = new DiceAudioEngine();
    let prepared = false;
    const preparationPromise = engine.prepare();

    expect(preparationPromise).toBeDefined();

    const preparation = preparationPromise!.then(() => {
      prepared = true;
    });

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prepared).toBe(false);

    for (const resolveFetch of fetchResolvers) {
      resolveFetch();
    }

    await preparation;

    expect(prepared).toBe(true);
    expect(decodeAudioData).toHaveBeenCalledTimes(3);

    engine.dispose();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended AudioContext when explicitly unlocked", async () => {
    const resume = vi.fn(async () => undefined);

    class FakeAudioContext {
      state: AudioContextState = "suspended";
      readonly destination = {} as AudioDestinationNode;

      async decodeAudioData(): Promise<AudioBuffer> {
        return {} as AudioBuffer;
      }

      async resume(): Promise<void> {
        this.state = "running";
        await resume();
      }

      async close(): Promise<void> {
        this.state = "closed";
      }
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8)
      } as Response))
    );

    const engine = new DiceAudioEngine();

    await engine.unlock();

    expect(resume).toHaveBeenCalledTimes(1);

    await engine.prepare();
    engine.dispose();
  });

  it("is a safe no-op when Web Audio is unavailable", async () => {
    vi.stubGlobal("AudioContext", undefined);

    const engine = new DiceAudioEngine();

    expect(engine.prepare()).toBeUndefined();
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(() => engine.attach([], 5)).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});
