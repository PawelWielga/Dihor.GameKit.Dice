import {
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
 * Shares in-flight/active texture loads and disposes the Three.js texture after the last mesh
 * releases it. Failed assets are not retained so a later roll may retry the URL.
 */
export class DiceTextureCache {
  private readonly loader: DiceTextureLoader;
  private readonly entries = new Map<string, TextureCacheEntry>();

  constructor(loader: DiceTextureLoader = new ThreeDiceTextureLoader()) {
    this.loader = loader;
  }

  async acquire(url: string | undefined, role: DiceTextureRole): Promise<DiceTextureLease | undefined> {
    const normalizedUrl = url?.trim();

    if (!normalizedUrl) {
      return undefined;
    }

    const key = `${role}:${normalizedUrl}`;
    let entry = this.entries.get(key);

    if (!entry) {
      let createdEntry!: TextureCacheEntry;
      const promise = this.loader
        .load(normalizedUrl)
        .then((texture) => {
          if (role === "color") {
            texture.colorSpace = SRGBColorSpace;
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

    if (!texture || this.entries.get(key) !== entry) {
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
        entry.references -= 1;

        if (entry.references <= 0 && this.entries.get(entry.key) === entry) {
          this.entries.delete(entry.key);
          entry.texture?.dispose();
        }
      }
    };
  }
}
