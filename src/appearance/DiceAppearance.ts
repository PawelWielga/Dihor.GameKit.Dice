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

export const DEFAULT_DICE_APPEARANCE: ResolvedDiceAppearance = Object.freeze({
  color: "#f2f0e6",
  markingsColor: "#191919",
  roughness: 0.72,
  metalness: 0
});

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

/**
 * Applies DiceKit material defaults while keeping texture-related fields separate for the
 * texture pipeline. Centralizing these defaults also leaves room for future theme/preset merging.
 */
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
