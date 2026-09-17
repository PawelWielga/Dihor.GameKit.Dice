import type { RandomProvider } from "./RandomProvider.js";

export type RandomSeed = string | number;

const UINT32_RANGE = 0x1_0000_0000;
const NON_ZERO_FALLBACK_STATE = 0x6d2b79f5;

function normalizeSeed(seed: RandomSeed): string {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`Random seed must be finite; received ${String(seed)}.`);
    }

    return `number:${Object.is(seed, -0) ? "-0" : String(seed)}`;
  }

  return `string:${seed}`;
}

/** Small deterministic UTF-16 FNV-1a hash used only to initialize the PRNG state. */
function hashSeed(seed: RandomSeed, stream: string): number {
  let hash = 0x811c9dc5;
  const input = `${normalizeSeed(seed)}\u0000stream:${stream}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash === 0 ? NON_ZERO_FALLBACK_STATE : hash;
}

/**
 * Deterministic RandomProvider based on xorshift32.
 *
 * Equal seed + stream values produce the same sample sequence across JavaScript runtimes.
 * Separate stream names let callers keep logical rolls independent from physical planning.
 */
export class SeededRandomProvider implements RandomProvider {
  private state: number;

  constructor(seed: RandomSeed, stream = "default") {
    if (stream.length === 0) {
      throw new RangeError("Random stream name must not be empty.");
    }

    this.state = hashSeed(seed, stream);
  }

  next(): number {
    let state = this.state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.state = state >>> 0 || NON_ZERO_FALLBACK_STATE;
    return this.state / UINT32_RANGE;
  }
}

export function createSeededRandomProvider(
  seed: RandomSeed,
  stream = "default"
): SeededRandomProvider {
  return new SeededRandomProvider(seed, stream);
}
