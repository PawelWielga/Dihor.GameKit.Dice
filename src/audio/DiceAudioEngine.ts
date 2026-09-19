import type { Body } from "cannon-es";
import impact1Url from "../assets/audio/kenney-casino/dieThrow1.ogg?url";
import impact2Url from "../assets/audio/kenney-casino/dieThrow2.ogg?url";
import impact3Url from "../assets/audio/kenney-casino/dieThrow3.ogg?url";
import roll1Url from "../assets/audio/kenney-casino/dieShuffle1.ogg?url";
import roll2Url from "../assets/audio/kenney-casino/dieShuffle2.ogg?url";
import roll3Url from "../assets/audio/kenney-casino/dieShuffle3.ogg?url";

export interface DiceAudioSampleSet {
  /** Samples used for stronger impacts, such as the first hit against the table. */
  readonly impact?: readonly string[];
  /** Samples used for lighter repeated contacts while dice tumble and roll. */
  readonly roll?: readonly string[];
}

export interface DiceAudioOptions {
  /** Enables collision-driven audio. Defaults to true. */
  readonly enabled?: boolean;
  /** Master gain from 0 to 1. Defaults to 0.7. */
  readonly volume?: number;
  /** Enables left/right positioning from the die X coordinate. Defaults to true. */
  readonly spatial?: boolean;
  /** Minimum impact velocity that can produce a sound. Defaults to 0.35. */
  readonly collisionThreshold?: number;
  /** Velocity at which the stronger impact sample group is used. Defaults to 2.2. */
  readonly strongImpactThreshold?: number;
  /** Minimum delay between sounds emitted by the same die. Defaults to 55 ms. */
  readonly cooldownMs?: number;
  /** Maximum simultaneously playing sample voices. Defaults to 10. */
  readonly maxVoices?: number;
  /** Random playback-rate variation from 0 to 0.2. Defaults to 0.045. */
  readonly pitchVariation?: number;
  /** Optional custom sample URLs. Missing groups fall back to the bundled CC0 sounds. */
  readonly samples?: DiceAudioSampleSet;
}

interface ResolvedDiceAudioOptions {
  readonly enabled: boolean;
  readonly volume: number;
  readonly spatial: boolean;
  readonly collisionThreshold: number;
  readonly strongImpactThreshold: number;
  readonly cooldownMs: number;
  readonly maxVoices: number;
  readonly pitchVariation: number;
  readonly impactSamples: readonly string[];
  readonly rollSamples: readonly string[];
}

export interface DiceCollisionSound {
  readonly kind: "impact" | "roll";
  readonly gain: number;
  readonly pan: number;
}

interface DiceCollisionEvent {
  readonly body: Body;
  readonly contact?: {
    getImpactVelocityAlongNormal(): number;
  };
}

type CollisionListener = (event: DiceCollisionEvent) => void;

const DEFAULT_IMPACT_SAMPLES = [impact1Url, impact2Url, impact3Url] as const;
const DEFAULT_ROLL_SAMPLES = [roll1Url, roll2Url, roll3Url] as const;

const DEFAULT_VOLUME = 0.7;
const DEFAULT_COLLISION_THRESHOLD = 0.35;
const DEFAULT_STRONG_IMPACT_THRESHOLD = 2.2;
const DEFAULT_COOLDOWN_MS = 55;
const DEFAULT_MAX_VOICES = 10;
const DEFAULT_PITCH_VARIATION = 0.045;

function requireRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}; received ${String(value)}.`);
  }

  return value;
}

function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be greater than zero; received ${String(value)}.`);
  }

  return value;
}

function resolveSampleList(
  name: string,
  value: readonly string[] | undefined,
  fallback: readonly string[]
): readonly string[] {
  const samples = value ?? fallback;

  if (samples.length === 0) {
    throw new RangeError(`${name} must contain at least one sample URL.`);
  }

  return samples.map((sample, index) => {
    const resolved = sample.trim();

    if (!resolved) {
      throw new RangeError(`${name}[${index}] must be a non-empty URL.`);
    }

    return resolved;
  });
}

export function resolveDiceAudioOptions(
  options: DiceAudioOptions = {}
): ResolvedDiceAudioOptions {
  const collisionThreshold = requireRange(
    "collisionThreshold",
    options.collisionThreshold ?? DEFAULT_COLLISION_THRESHOLD,
    0,
    100
  );
  const strongImpactThreshold = requirePositive(
    "strongImpactThreshold",
    options.strongImpactThreshold ?? DEFAULT_STRONG_IMPACT_THRESHOLD
  );

  if (strongImpactThreshold <= collisionThreshold) {
    throw new RangeError(
      `strongImpactThreshold must be greater than collisionThreshold; received ${strongImpactThreshold} <= ${collisionThreshold}.`
    );
  }

  const maxVoices = options.maxVoices ?? DEFAULT_MAX_VOICES;
  if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > 32) {
    throw new RangeError(
      `maxVoices must be an integer between 1 and 32; received ${String(maxVoices)}.`
    );
  }

  return {
    enabled: options.enabled ?? true,
    volume: requireRange("volume", options.volume ?? DEFAULT_VOLUME, 0, 1),
    spatial: options.spatial ?? true,
    collisionThreshold,
    strongImpactThreshold,
    cooldownMs: requireRange("cooldownMs", options.cooldownMs ?? DEFAULT_COOLDOWN_MS, 0, 1000),
    maxVoices,
    pitchVariation: requireRange(
      "pitchVariation",
      options.pitchVariation ?? DEFAULT_PITCH_VARIATION,
      0,
      0.2
    ),
    impactSamples: resolveSampleList(
      "samples.impact",
      options.samples?.impact,
      DEFAULT_IMPACT_SAMPLES
    ),
    rollSamples: resolveSampleList(
      "samples.roll",
      options.samples?.roll,
      DEFAULT_ROLL_SAMPLES
    )
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pure collision-to-sound mapping kept separate from browser audio playback for deterministic tests. */
export function resolveDiceCollisionSound(
  impactVelocity: number,
  x: number,
  arenaHalfExtent: number,
  options: DiceAudioOptions = {}
): DiceCollisionSound | undefined {
  const resolved = resolveDiceAudioOptions(options);
  const impact = Math.abs(impactVelocity);

  if (!resolved.enabled || impact < resolved.collisionThreshold) {
    return undefined;
  }

  const fullScaleImpact = Math.max(
    resolved.strongImpactThreshold * 2,
    resolved.collisionThreshold + 0.001
  );
  const normalized = clamp(
    (impact - resolved.collisionThreshold) /
      (fullScaleImpact - resolved.collisionThreshold),
    0,
    1
  );
  const gain = resolved.volume * (0.18 + normalized * 0.82);
  const safeArenaHalfExtent =
    Number.isFinite(arenaHalfExtent) && arenaHalfExtent > 0 ? arenaHalfExtent : 1;

  return {
    kind: impact >= resolved.strongImpactThreshold ? "impact" : "roll",
    gain,
    pan: resolved.spatial ? clamp(x / safeArenaHalfExtent, -1, 1) : 0
  };
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };

  return scope.AudioContext ?? scope.webkitAudioContext;
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

/**
 * Browser-only audio companion for visible dice playback.
 *
 * It is deliberately best-effort: unavailable/blocked Web Audio or failed sample loading
 * never turns a successful dice roll into an error.
 */
export class DiceAudioEngine {
  private readonly options: ResolvedDiceAudioOptions;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly listeners: Array<{ body: Body; listener: CollisionListener }> = [];
  private readonly lastSoundAt = new Map<number, number>();
  private readonly activeVoices = new Set<AudioBufferSourceNode>();

  private context?: AudioContext;
  private arenaHalfExtent = 1;
  private disposed = false;

  constructor(options: DiceAudioOptions = {}) {
    this.options = resolveDiceAudioOptions(options);

    if (this.options.enabled) {
      this.ensureContext();
    }
  }

  attach(bodies: readonly Body[], arenaHalfExtent: number): void {
    this.detach();

    if (!this.options.enabled || this.disposed || bodies.length === 0) {
      return;
    }

    if (!this.ensureContext()) {
      return;
    }

    this.arenaHalfExtent =
      Number.isFinite(arenaHalfExtent) && arenaHalfExtent > 0 ? arenaHalfExtent : 1;

    for (const body of bodies) {
      const listener: CollisionListener = (event) => this.onCollision(body, event);
      body.addEventListener("collide", listener);
      this.listeners.push({ body, listener });
    }
  }

  detach(): void {
    for (const { body, listener } of this.listeners) {
      body.removeEventListener("collide", listener);
    }

    this.listeners.length = 0;
    this.lastSoundAt.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.detach();

    for (const voice of this.activeVoices) {
      try {
        voice.stop();
      } catch {
        // Voice may already have ended. Audio cleanup must remain best-effort.
      }
    }
    this.activeVoices.clear();

    const context = this.context;
    this.context = undefined;
    this.disposed = true;

    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context || this.disposed || !this.options.enabled) {
      return this.context;
    }

    const AudioContextClass = resolveAudioContextConstructor();

    if (!AudioContextClass) {
      return undefined;
    }

    try {
      this.context = new AudioContextClass();
      void this.preloadSamples(this.context);
      return this.context;
    } catch {
      return undefined;
    }
  }

  private async preloadSamples(context: AudioContext): Promise<void> {
    const urls = [...new Set([...this.options.impactSamples, ...this.options.rollSamples])];

    await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetch(url);

          if (!response.ok) {
            return;
          }

          const data = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(data.slice(0));

          if (!this.disposed && this.context === context) {
            this.buffers.set(url, buffer);
          }
        } catch {
          // Missing/blocked audio assets are non-fatal by design.
        }
      })
    );
  }

  private onCollision(body: Body, event: DiceCollisionEvent): void {
    const other = event.body;

    // cannon-es dispatches dynamic-vs-dynamic collisions on both bodies.
    if (other?.mass > 0 && body.id > other.id) {
      return;
    }

    let impactVelocity = 0;

    try {
      impactVelocity = event.contact?.getImpactVelocityAlongNormal() ?? 0;
    } catch {
      return;
    }

    const sound = resolveDiceCollisionSound(
      impactVelocity,
      body.position.x,
      this.arenaHalfExtent,
      {
        enabled: this.options.enabled,
        volume: this.options.volume,
        spatial: this.options.spatial,
        collisionThreshold: this.options.collisionThreshold,
        strongImpactThreshold: this.options.strongImpactThreshold,
        cooldownMs: this.options.cooldownMs,
        maxVoices: this.options.maxVoices,
        pitchVariation: this.options.pitchVariation,
        samples: {
          impact: this.options.impactSamples,
          roll: this.options.rollSamples
        }
      }
    );

    if (!sound) {
      return;
    }

    const currentTime = nowMs();
    const previousTime = this.lastSoundAt.get(body.id) ?? Number.NEGATIVE_INFINITY;

    if (currentTime - previousTime < this.options.cooldownMs) {
      return;
    }

    const pool =
      sound.kind === "impact" ? this.options.impactSamples : this.options.rollSamples;
    const sampleUrl = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];

    if (!sampleUrl || !this.buffers.has(sampleUrl)) {
      return;
    }

    this.lastSoundAt.set(body.id, currentTime);
    this.play(sampleUrl, sound);
  }

  private play(sampleUrl: string, sound: DiceCollisionSound): void {
    const context = this.context;
    const buffer = this.buffers.get(sampleUrl);

    if (!context || !buffer || this.disposed) {
      return;
    }

    try {
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }

      while (this.activeVoices.size >= this.options.maxVoices) {
        const oldest = this.activeVoices.values().next().value as
          | AudioBufferSourceNode
          | undefined;

        if (!oldest) {
          break;
        }

        this.activeVoices.delete(oldest);
        try {
          oldest.stop();
        } catch {
          // Already-ended voices can be discarded.
        }
      }

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value =
        1 + (Math.random() * 2 - 1) * this.options.pitchVariation;
      gain.gain.value = sound.gain;

      source.connect(gain);

      if (this.options.spatial && typeof context.createStereoPanner === "function") {
        const panner = context.createStereoPanner();
        panner.pan.value = sound.pan;
        gain.connect(panner);
        panner.connect(context.destination);
      } else {
        gain.connect(context.destination);
      }

      source.onended = () => {
        this.activeVoices.delete(source);
        source.disconnect();
        gain.disconnect();
      };

      this.activeVoices.add(source);
      source.start();
    } catch {
      // Browser audio policy or a transient Web Audio error must never fail the roll.
    }
  }
}
