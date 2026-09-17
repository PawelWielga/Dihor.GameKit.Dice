export type DiceFaceLabelMode = "dots" | "numbers";

export interface DiceFontAppearance {
  /** CSS font-family name. Defaults to the bundled Cinzel font. */
  readonly family?: string;

  /** Optional font file URL (woff2/woff/ttf). Loaded by DiceKit when available in a browser. */
  readonly url?: string;

  /** CSS numeric font weight. Defaults to 700. */
  readonly weight?: number;
}

export interface ResolvedDiceFontAppearance {
  readonly family: string;
  readonly weight: number;
  readonly url?: string;
}

export interface DiceAppearance {
  /** Base color used when no body texture overrides it. */
  readonly color?: string;

  /** Color used by generated pips or numeric markings. */
  readonly markingsColor?: string;

  /** Optional texture applied to the die body. */
  readonly texture?: string;

  /** Optional normal map applied to the die material. */
  readonly normalMap?: string;

  /** Optional roughness map applied to the die material. */
  readonly roughnessMap?: string;

  /** Material roughness in the Three.js-standard 0..1 range. */
  readonly roughness?: number;

  /** Material metalness in the Three.js-standard 0..1 range. */
  readonly metalness?: number;

  /** Typography used by numeric face labels. D6 uses it only in `numbers` mode. */
  readonly font?: DiceFontAppearance;

  /**
   * D6 face-label mode. Other dice always use numeric labels.
   * Defaults to `dots` for backwards compatibility.
   */
  readonly faceLabelMode?: DiceFaceLabelMode;

  /**
   * Optional texture overrides keyed by the physical face value.
   * Missing faces fall back to the standard appearance.
   */
  readonly faces?: Readonly<Partial<Record<number, string>>>;
}

/** Material values required by the renderer after defaults have been applied. */
export interface ResolvedDiceAppearance {
  readonly color: string;
  readonly markingsColor: string;
  readonly roughness: number;
  readonly metalness: number;
}

export const DEFAULT_DICE_FONT_APPEARANCE: ResolvedDiceFontAppearance = Object.freeze({
  family: "Cinzel",
  weight: 700
});

export const DEFAULT_DICE_FACE_LABEL_MODE: DiceFaceLabelMode = "dots";

export const DEFAULT_DICE_APPEARANCE: ResolvedDiceAppearance = Object.freeze({
  color: "#f2f0e6",
  markingsColor: "#191919",
  roughness: 0.72,
  metalness: 0
});

function hasAssetUrl(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

export function hasDiceTextureSources(appearance: DiceAppearance | undefined): boolean {
  if (!appearance) {
    return false;
  }

  if (
    hasAssetUrl(appearance.texture) ||
    hasAssetUrl(appearance.normalMap) ||
    hasAssetUrl(appearance.roughnessMap)
  ) {
    return true;
  }

  return Object.values(appearance.faces ?? {}).some(hasAssetUrl);
}

function resolveColor(name: string, value: string | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (value.trim().length === 0) {
    throw new RangeError(`${name} must be a non-empty color string.`);
  }

  return value;
}

function resolveMaterialFactor(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number in the 0..1 range; received ${String(value)}.`);
  }

  return value;
}

function resolveFontFamily(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_DICE_FONT_APPEARANCE.family;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new RangeError("font.family must be a non-empty string.");
  }

  return trimmed;
}

function resolveFontUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new RangeError("font.url must be a non-empty URL string.");
  }

  return trimmed;
}

function resolveFontWeight(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DICE_FONT_APPEARANCE.weight;
  }

  if (!Number.isFinite(value) || value < 1 || value > 1000) {
    throw new RangeError(
      `font.weight must be a finite number in the 1..1000 range; received ${String(value)}.`
    );
  }

  return value;
}

function mergeOptionalRecords<T>(
  base: Readonly<Partial<Record<number, T>>> | undefined,
  override: Readonly<Partial<Record<number, T>>> | undefined
): Readonly<Partial<Record<number, T>>> | undefined {
  if (!base) {
    return override;
  }

  if (!override) {
    return base;
  }

  return { ...base, ...override };
}

/**
 * Merges a global/default appearance with a per-die override.
 * Nested font and per-face maps are merged instead of replacing the entire object.
 */
export function mergeDiceAppearances(
  base: DiceAppearance | undefined,
  override: DiceAppearance | undefined
): DiceAppearance | undefined {
  if (!base) {
    return override;
  }

  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    font:
      base.font || override.font
        ? {
            ...base.font,
            ...override.font
          }
        : undefined,
    faces: mergeOptionalRecords(base.faces, override.faces)
  };
}

/** Applies material defaults while keeping texture/font fields separate from the material pipeline. */
export function resolveDiceAppearance(appearance: DiceAppearance = {}): ResolvedDiceAppearance {
  return {
    color: resolveColor("color", appearance.color, DEFAULT_DICE_APPEARANCE.color),
    markingsColor: resolveColor(
      "markingsColor",
      appearance.markingsColor,
      DEFAULT_DICE_APPEARANCE.markingsColor
    ),
    roughness: resolveMaterialFactor(
      "roughness",
      appearance.roughness,
      DEFAULT_DICE_APPEARANCE.roughness
    ),
    metalness: resolveMaterialFactor(
      "metalness",
      appearance.metalness,
      DEFAULT_DICE_APPEARANCE.metalness
    )
  };
}

/** Applies typography defaults independently from the material resolver for backwards compatibility. */
export function resolveDiceFontAppearance(
  font: DiceFontAppearance = {}
): ResolvedDiceFontAppearance {
  const url = resolveFontUrl(font.url);

  return {
    family: resolveFontFamily(font.family),
    weight: resolveFontWeight(font.weight),
    ...(url ? { url } : {})
  };
}

export function resolveDiceFaceLabelMode(
  appearance: DiceAppearance | undefined
): DiceFaceLabelMode {
  const value = appearance?.faceLabelMode;

  if (value === undefined) {
    return DEFAULT_DICE_FACE_LABEL_MODE;
  }

  if (value !== "dots" && value !== "numbers") {
    throw new RangeError(`faceLabelMode must be "dots" or "numbers"; received ${String(value)}.`);
  }

  return value;
}
