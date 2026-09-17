import {
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader
} from "three";

export type DiceTextureRole = "color" | "data";

/** Injectable texture source used by DiceMeshFactory. */
export interface DiceTextureLoader {
  load(url: string): Promise<Texture>;
}

export interface DiceTextureLease {
  readonly texture: Texture;
  release(): void;
}

interface TextureCacheEntry {
  readonly key: string;
  readonly promise: Promise<Texture | undefined>;
  texture?: Texture;
  references: number;
}

class ThreeDiceTextureLoader implements DiceTextureLoader {
  private readonly loader = new TextureLoader();

  load(url: string): Promise<Texture> {
    return this.loader.loadAsync(url);
  }
}

/**
 * Caches successful texture loads for the lifetime of the cache. Leases track active mesh use,
 * while `dispose()` owns final GPU cleanup. Failed assets are not retained so later rolls can retry.
 */
export class DiceTextureCache {
  private readonly loader: DiceTextureLoader;
  private readonly entries = new Map<string, TextureCacheEntry>();
  private disposed = false;

  constructor(loader: DiceTextureLoader = new ThreeDiceTextureLoader()) {
    this.loader = loader;
  }

  async acquire(url: string | undefined, role: DiceTextureRole): Promise<DiceTextureLease | undefined> {
    if (this.disposed) {
      throw new Error("DiceTextureCache has been disposed.");
    }

    const normalizedUrl = url?.trim();

    if (!normalizedUrl) {
      return undefined;
    }

    const key = `${role}:${normalizedUrl}`;
    let entry = this.entries.get(key);

    if (!entry) {
      let createdEntry!: TextureCacheEntry;
      const promise = Promise.resolve()
        .then(() => this.loader.load(normalizedUrl))
        .then((texture) => {
          if (role === "color") {
            texture.colorSpace = SRGBColorSpace;
          }

          // Reference dice bodies unwrap longitude seams by allowing U to continue past 1.
          // RepeatWrapping preserves that continuation and is harmless for 0..1 face textures.
          texture.wrapS = RepeatWrapping;

          if (this.disposed) {
            texture.dispose();

            if (this.entries.get(key) === createdEntry) {
              this.entries.delete(key);
            }

            return undefined;
          }

          createdEntry.texture = texture;
          return texture;
        })
        .catch(() => {
          if (this.entries.get(key) === createdEntry) {
            this.entries.delete(key);
          }

          return undefined;
        });

      createdEntry = {
        key,
        promise,
        references: 0
      };
      entry = createdEntry;
      this.entries.set(key, entry);
    }

    const texture = await entry.promise;

    if (!texture || this.disposed || this.entries.get(key) !== entry) {
      return undefined;
    }

    entry.references += 1;
    let released = false;

    return {
      texture,
      release: () => {
        if (released) {
          return;
        }

        released = true;
        entry.references = Math.max(0, entry.references - 1);

        if (this.disposed && entry.references === 0 && this.entries.get(entry.key) === entry) {
          entry.texture?.dispose();
          this.entries.delete(entry.key);
        }
      }
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const [key, entry] of this.entries) {
      if (entry.texture && entry.references === 0) {
        entry.texture.dispose();
        this.entries.delete(key);
      }
    }
  }
}
