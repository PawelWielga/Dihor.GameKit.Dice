import { SRGBColorSpace, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DiceTextureCache,
  type DiceTextureLoader
} from "../src/three/dice/DiceTextureCache.js";

class FakeTextureLoader implements DiceTextureLoader {
  readonly calls: string[] = [];
  readonly failures = new Set<string>();

  async load(url: string): Promise<Texture> {
    this.calls.push(url);

    if (this.failures.has(url)) {
      throw new Error(`Failed to load ${url}`);
    }

    const texture = new Texture();
    texture.name = url;
    return texture;
  }
}

describe("DiceTextureCache", () => {
  it("reuses a successful texture across sequential leases until cache disposal", async () => {
    const loader = new FakeTextureLoader();
    const cache = new DiceTextureCache(loader);
    const [first, second] = await Promise.all([
      cache.acquire("/shared.png", "color"),
      cache.acquire("/shared.png", "color")
    ]);

    expect(loader.calls).toEqual(["/shared.png"]);
    expect(first?.texture).toBe(second?.texture);
    expect(first?.texture.colorSpace).toBe(SRGBColorSpace);

    const dispose = vi.spyOn(first!.texture, "dispose");
    first?.release();
    second?.release();
    expect(dispose).not.toHaveBeenCalled();

    const third = await cache.acquire("/shared.png", "color");
    expect(loader.calls).toEqual(["/shared.png"]);
    expect(third?.texture).toBe(first?.texture);
    third?.release();

    cache.dispose();
    cache.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("defers disposal of an actively leased texture until the lease is released", async () => {
    const cache = new DiceTextureCache(new FakeTextureLoader());
    const lease = await cache.acquire("/active.png", "color");
    const dispose = vi.spyOn(lease!.texture, "dispose");

    cache.dispose();
    expect(dispose).not.toHaveBeenCalled();

    lease?.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("falls back on load failure and allows a later retry", async () => {
    const loader = new FakeTextureLoader();
    const cache = new DiceTextureCache(loader);
    loader.failures.add("/missing.png");

    await expect(cache.acquire("/missing.png", "color")).resolves.toBeUndefined();

    loader.failures.delete("/missing.png");
    const retried = await cache.acquire("/missing.png", "color");

    expect(loader.calls).toEqual(["/missing.png", "/missing.png"]);
    expect(retried).toBeDefined();
    retried?.release();
    cache.dispose();
  });
});
