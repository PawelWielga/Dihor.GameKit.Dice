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
  readonly faces?: Readonly<Record<number, string>>;
}
