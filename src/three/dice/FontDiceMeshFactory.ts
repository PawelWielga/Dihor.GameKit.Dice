import {
  mergeDiceAppearances,
  type DiceAppearance
} from "../../appearance/index.js";
import type { DiceSides } from "../../core/index.js";
import {
  DiceMeshFactory as VisualDiceMeshFactory
} from "./UnifiedDiceMeshFactory.js";
import { applyDiceFaceLabels, DiceFaceLabelCache } from "./DiceFaceLabels.js";
import type {
  DiceMesh,
  DiceMeshFactoryOptions as BaseDiceMeshFactoryOptions,
  DiceMeshOptions
} from "./DiceMeshFactory.js";

export interface DiceMeshFactoryOptions extends BaseDiceMeshFactoryOptions {
  /**
   * Global appearance defaults applied to every die created by this factory.
   * Per-die `DiceMeshOptions.appearance` values override these fields.
   */
  readonly appearance?: DiceAppearance;
}

/**
 * Final public factory layer. It keeps the approved visual geometry intact and adds configurable
 * font-backed face labels plus global/per-die appearance merging.
 */
export class DiceMeshFactory extends VisualDiceMeshFactory {
  private readonly defaultAppearance?: DiceAppearance;
  private readonly faceLabelCache = new DiceFaceLabelCache();

  constructor(options: DiceMeshFactoryOptions = {}) {
    super({ textureLoader: options.textureLoader });
    this.defaultAppearance = options.appearance;
  }

  override create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    const resolvedOptions = this.resolveOptions(options);
    const mesh = super.create(sides, resolvedOptions);

    return applyDiceFaceLabels(
      mesh,
      sides,
      resolvedOptions.size ?? 1,
      resolvedOptions.appearance,
      this.faceLabelCache
    );
  }

  override createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    const resolvedOptions = this.resolveOptions(options);

    return super
      .createAsync(sides, resolvedOptions)
      .then((mesh) =>
        applyDiceFaceLabels(
          mesh,
          sides,
          resolvedOptions.size ?? 1,
          resolvedOptions.appearance,
          this.faceLabelCache
        )
      );
  }

  override dispose(): void {
    this.faceLabelCache.dispose();
    super.dispose();
  }

  private resolveOptions(options: DiceMeshOptions): DiceMeshOptions {
    return {
      ...options,
      appearance: mergeDiceAppearances(this.defaultAppearance, options.appearance)
    };
  }
}
