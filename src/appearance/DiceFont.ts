import bundledCinzelUrl from "@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url";
import {
  DEFAULT_DICE_FONT_APPEARANCE,
  type ResolvedDiceFontAppearance
} from "./DiceAppearance.js";

export interface DiceFontLoadEnvironment {
  load(font: ResolvedDiceFontAppearance, source: string): Promise<void>;
}

const loadedFonts = new Map<string, Promise<void>>();

function fontKey(font: ResolvedDiceFontAppearance, source: string): string {
  return `${font.family}\u0000${font.weight}\u0000${source}`;
}

function fontSource(source: string): string {
  return `url(${JSON.stringify(source)})`;
}

function createBrowserEnvironment(): DiceFontLoadEnvironment | undefined {
  if (
    typeof document === "undefined" ||
    document.fonts === undefined ||
    typeof FontFace === "undefined"
  ) {
    return undefined;
  }

  return {
    async load(font, source) {
      const key = fontKey(font, source);
      const cached = loadedFonts.get(key);

      if (cached) {
        await cached;
        return;
      }

      const pending = (async () => {
        const face = new FontFace(font.family, fontSource(source), {
          style: "normal",
          weight: String(font.weight)
        });
        const loaded = await face.load();
        const fontSet = document.fonts as FontFaceSet & {
          add(font: FontFace): FontFaceSet;
        };
        fontSet.add(loaded);
      })();

      loadedFonts.set(key, pending);

      try {
        await pending;
      } catch (error) {
        loadedFonts.delete(key);
        throw error;
      }
    }
  };
}

async function loadBundledDefault(
  environment: DiceFontLoadEnvironment,
  size = DEFAULT_DICE_FONT_APPEARANCE.size
): Promise<ResolvedDiceFontAppearance> {
  const fallback: ResolvedDiceFontAppearance = {
    ...DEFAULT_DICE_FONT_APPEARANCE,
    size
  };

  try {
    await environment.load(fallback, bundledCinzelUrl);
  } catch {
    // A browser that cannot register the bundled font can still render with its CSS fallback.
  }

  return fallback;
}

/**
 * Loads the requested dice font when it points at a URL. A failed custom URL deterministically
 * falls back to the bundled Cinzel font and never rejects the dice-rendering pipeline.
 *
 * The optional environment keeps fallback behavior deterministic and directly unit-testable.
 */
export async function loadDiceFont(
  font: ResolvedDiceFontAppearance,
  environment: DiceFontLoadEnvironment | undefined = createBrowserEnvironment()
): Promise<ResolvedDiceFontAppearance> {
  if (!environment) {
    return font;
  }

  if (font.url) {
    try {
      await environment.load(font, font.url);
      return font;
    } catch {
      return loadBundledDefault(environment, font.size);
    }
  }

  if (font.family === DEFAULT_DICE_FONT_APPEARANCE.family) {
    await loadBundledDefault(environment, font.size);
  }

  // A family without URL is intentionally trusted to have been registered by the host document.
  return font;
}

/** Test helper; production consumers do not need to manage the browser font cache. */
export function clearDiceFontCache(): void {
  loadedFonts.clear();
}

// Start loading the bundled default as soon as the browser imports DiceKit. Rendering never waits
// for this promise; the canvas label layer refreshes itself once the font becomes available.
void loadDiceFont(DEFAULT_DICE_FONT_APPEARANCE);
