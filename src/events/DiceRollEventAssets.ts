import type { DiceAppearance } from "../appearance/index.js";
import { validateDiceRollEvent } from "./DiceRollEvent.js";

export type DiceRollEventAssetKind =
  | "texture"
  | "normalMap"
  | "roughnessMap"
  | "font"
  | "face";

export interface DiceRollEventAssetContext {
  readonly dieIndex: number;
  readonly kind: DiceRollEventAssetKind;
  readonly face?: number;
}

export interface DiceRollEventAssetPolicy {
  /**
   * Allows relative/local paths such as "/assets/dice.png" and "./dice.png".
   * Defaults to true.
   */
  readonly allowRelative?: boolean;

  /**
   * Explicitly allowed web origins, for example "https://cdn.example.com".
   * HTTP(S) assets are rejected unless their origin is listed here.
   */
  readonly allowedOrigins?: readonly string[];

  /**
   * Explicitly allowed non-web URL schemes, for example "data:" or "blob:".
   * HTTP(S) origins are controlled by allowedOrigins instead.
   */
  readonly allowedSchemes?: readonly string[];

  /**
   * Optional application resolver for logical asset IDs or URL rewriting.
   * Returning undefined rejects the asset.
   */
  readonly resolve?: (
    source: string,
    context: DiceRollEventAssetContext
  ) => string | undefined;
}

export const DEFAULT_DICE_ROLL_EVENT_ASSET_POLICY = Object.freeze({
  allowRelative: true,
  allowedOrigins: Object.freeze([] as string[]),
  allowedSchemes: Object.freeze([] as string[])
});

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z\d+.-]*):/;

function normalizeScheme(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new RangeError("DiceRollEvent asset policy contains an empty scheme.");
  }

  return trimmed.endsWith(":") ? trimmed : `${trimmed}:`;
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RangeError(
        `DiceRollEvent allowed origin must use http or https; received ${value}.`
      );
    }

    return url.origin;
  } catch (error) {
    if (error instanceof RangeError) {
      throw error;
    }

    throw new RangeError(`DiceRollEvent asset policy contains an invalid origin: ${value}.`);
  }
}

function resolvePolicy(policy: DiceRollEventAssetPolicy): {
  readonly allowRelative: boolean;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowedSchemes: ReadonlySet<string>;
  readonly resolve?: DiceRollEventAssetPolicy["resolve"];
} {
  return {
    allowRelative: policy.allowRelative ?? DEFAULT_DICE_ROLL_EVENT_ASSET_POLICY.allowRelative,
    allowedOrigins: new Set(
      (policy.allowedOrigins ?? DEFAULT_DICE_ROLL_EVENT_ASSET_POLICY.allowedOrigins).map(
        normalizeOrigin
      )
    ),
    allowedSchemes: new Set(
      (policy.allowedSchemes ?? DEFAULT_DICE_ROLL_EVENT_ASSET_POLICY.allowedSchemes).map(
        normalizeScheme
      )
    ),
    ...(policy.resolve ? { resolve: policy.resolve } : {})
  };
}

function assertAllowedSource(
  source: string,
  context: DiceRollEventAssetContext,
  policy: ReturnType<typeof resolvePolicy>
): string {
  const resolved = policy.resolve ? policy.resolve(source, context) : source;

  if (resolved === undefined || resolved.trim().length === 0) {
    throw new RangeError(
      `DiceRollEvent asset was rejected by the application resolver for die ${context.dieIndex}.`
    );
  }

  const trimmed = resolved.trim();
  const schemeMatch = SCHEME_PATTERN.exec(trimmed);

  if (!schemeMatch && !trimmed.startsWith("//")) {
    if (!policy.allowRelative) {
      throw new RangeError(
        `DiceRollEvent relative asset is not allowed for die ${context.dieIndex}.`
      );
    }

    return trimmed;
  }

  const scheme = schemeMatch?.[1]?.toLowerCase();

  if (scheme === "http" || scheme === "https" || trimmed.startsWith("//")) {
    let url: URL;

    try {
      url = trimmed.startsWith("//")
        ? new URL(trimmed, "https://dice-event.invalid")
        : new URL(trimmed);
    } catch {
      throw new RangeError(
        `DiceRollEvent contains an invalid remote asset URL for die ${context.dieIndex}.`
      );
    }

    if (!policy.allowedOrigins.has(url.origin)) {
      throw new RangeError(
        `DiceRollEvent remote asset origin is not allowed: ${url.origin}.`
      );
    }

    return trimmed;
  }

  const normalizedScheme = normalizeScheme(scheme ?? "");
  if (!policy.allowedSchemes.has(normalizedScheme)) {
    throw new RangeError(
      `DiceRollEvent asset scheme is not allowed: ${normalizedScheme}.`
    );
  }

  return trimmed;
}

function resolveAppearance(
  appearance: DiceAppearance | undefined,
  dieIndex: number,
  policy: ReturnType<typeof resolvePolicy>
): DiceAppearance | undefined {
  if (!appearance) {
    return undefined;
  }

  const texture =
    appearance.texture === undefined
      ? undefined
      : assertAllowedSource(appearance.texture, { dieIndex, kind: "texture" }, policy);
  const normalMap =
    appearance.normalMap === undefined
      ? undefined
      : assertAllowedSource(appearance.normalMap, { dieIndex, kind: "normalMap" }, policy);
  const roughnessMap =
    appearance.roughnessMap === undefined
      ? undefined
      : assertAllowedSource(appearance.roughnessMap, { dieIndex, kind: "roughnessMap" }, policy);
  const fontUrl =
    appearance.font?.url === undefined
      ? undefined
      : assertAllowedSource(appearance.font.url, { dieIndex, kind: "font" }, policy);

  let faces: DiceAppearance["faces"];
  if (appearance.faces) {
    const resolvedFaces: Partial<Record<number, string>> = {};

    for (const [rawFace, source] of Object.entries(appearance.faces)) {
      if (source === undefined) {
        continue;
      }

      const face = Number(rawFace);
      resolvedFaces[face] = assertAllowedSource(
        source,
        { dieIndex, kind: "face", face },
        policy
      );
    }

    faces = resolvedFaces;
  }

  return {
    ...appearance,
    ...(texture === undefined ? {} : { texture }),
    ...(normalMap === undefined ? {} : { normalMap }),
    ...(roughnessMap === undefined ? {} : { roughnessMap }),
    ...(appearance.font
      ? {
          font: {
            ...appearance.font,
            ...(fontUrl === undefined ? {} : { url: fontUrl })
          }
        }
      : {}),
    ...(faces === undefined ? {} : { faces })
  };
}

/**
 * Validates a network event and returns playback appearances after applying a consumer-controlled
 * asset policy. External HTTP(S) origins and non-web schemes are blocked unless explicitly allowed.
 */
export function resolveDiceRollEventAppearances(
  event: unknown,
  policy: DiceRollEventAssetPolicy = {}
): readonly (DiceAppearance | undefined)[] {
  const validated = validateDiceRollEvent(event);
  const resolvedPolicy = resolvePolicy(policy);

  return validated.dice.map((die, dieIndex) =>
    resolveAppearance(die.appearance, dieIndex, resolvedPolicy)
  );
}
