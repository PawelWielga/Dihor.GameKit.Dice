import type { DiceAppearance } from "../appearance/index.js";
import {
  SUPPORTED_DICE_SIDES,
  type DiceDefinition,
  type DiceRollResult,
  type DiceSides
} from "../core/index.js";
import type { RollPlan } from "../physics/index.js";

export const DICE_ROLL_EVENT_TYPE = "dice-roll" as const;
export const DICE_ROLL_EVENT_VERSION = 1 as const;
export const DICE_ROLL_REPLAY_VERSION = 1 as const;

export interface DiceRollEventDie {
  readonly sides: DiceSides;
  readonly value: number;
  readonly appearance?: DiceAppearance;
}

export interface DiceRollReplayV1 {
  readonly version: typeof DICE_ROLL_REPLAY_VERSION;
  readonly plan: RollPlan;
}

/**
 * Transport-neutral host-authoritative dice event.
 *
 * This model intentionally contains only JSON-friendly domain and replay data. It does not know
 * about WebSockets, PartyGameKit, Three.js or any other transport/rendering implementation.
 */
export interface DiceRollEvent {
  readonly type: typeof DICE_ROLL_EVENT_TYPE;
  readonly version: typeof DICE_ROLL_EVENT_VERSION;
  readonly rollId: string;
  readonly dice: readonly DiceRollEventDie[];
  readonly modifier: number;
  readonly total: number;
  readonly reason?: string;
  readonly replay?: DiceRollReplayV1;
}

export interface CreateDiceRollEventOptions {
  /** Original die definitions, including optional appearance. Defaults to sides-only definitions. */
  readonly definitions?: readonly DiceDefinition[];

  /** Optional successful host-side plan used by clients that want full physical playback. */
  readonly plan?: RollPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAppearance(appearance: DiceAppearance | undefined): DiceAppearance | undefined {
  if (!appearance) {
    return undefined;
  }

  return {
    ...appearance,
    ...(appearance.faces ? { faces: { ...appearance.faces } } : {})
  };
}

function validateAppearance(
  appearance: unknown,
  sides: DiceSides,
  index: number
): asserts appearance is DiceAppearance | undefined {
  if (appearance === undefined) {
    return;
  }

  if (!isRecord(appearance)) {
    throw new RangeError(`DiceRollEvent appearance at index ${index} must be an object.`);
  }

  for (const field of ["color", "markingsColor", "texture", "normalMap", "roughnessMap"] as const) {
    const value = appearance[field];

    if (value !== undefined && typeof value !== "string") {
      throw new RangeError(`DiceRollEvent appearance.${field} at index ${index} must be a string.`);
    }
  }

  for (const field of ["roughness", "metalness"] as const) {
    const value = appearance[field];

    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new RangeError(
        `DiceRollEvent appearance.${field} at index ${index} must be a finite number in 0..1.`
      );
    }
  }

  const faces = appearance.faces;

  if (faces !== undefined) {
    if (!isRecord(faces)) {
      throw new RangeError(`DiceRollEvent appearance.faces at index ${index} must be an object.`);
    }

    for (const [faceKey, source] of Object.entries(faces)) {
      const face = Number(faceKey);

      if (!Number.isInteger(face) || face < 1 || face > sides || typeof source !== "string") {
        throw new RangeError(
          `DiceRollEvent appearance.faces contains an invalid D${sides} face at index ${index}.`
        );
      }
    }
  }
}

function validateResult(result: DiceRollResult): void {
  if (result.rollId.trim().length === 0) {
    throw new RangeError("DiceRollEvent requires a non-empty rollId.");
  }

  if (result.dice.length === 0) {
    throw new RangeError("DiceRollEvent requires at least one die.");
  }

  if (!Number.isFinite(result.modifier) || !Number.isFinite(result.total)) {
    throw new RangeError("DiceRollEvent modifier and total must be finite.");
  }

  let expectedTotal = result.modifier;

  for (let index = 0; index < result.dice.length; index += 1) {
    const die = result.dice[index];

    if (
      !die ||
      !SUPPORTED_DICE_SIDES.includes(die.sides) ||
      !Number.isInteger(die.value) ||
      die.value < 1 ||
      die.value > die.sides
    ) {
      throw new RangeError(`DiceRollEvent contains an invalid die result at index ${index}.`);
    }

    expectedTotal += die.value;
  }

  if (expectedTotal !== result.total) {
    throw new RangeError(
      `DiceRollEvent total mismatch: expected ${expectedTotal}, received ${result.total}.`
    );
  }
}

function validateDefinitions(
  result: DiceRollResult,
  definitions: readonly DiceDefinition[] | undefined
): void {
  if (!definitions) {
    return;
  }

  if (definitions.length !== result.dice.length) {
    throw new RangeError(
      `DiceRollEvent received ${definitions.length} definitions for ${result.dice.length} results.`
    );
  }

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const die = result.dice[index];

    if (!definition || !die || definition.sides !== die.sides) {
      throw new RangeError(`DiceRollEvent definition does not match result at index ${index}.`);
    }
  }
}

function validatePlan(result: DiceRollResult, plan: RollPlan | undefined): void {
  if (!plan) {
    return;
  }

  if (plan.rollId !== result.rollId) {
    throw new RangeError("DiceRollEvent replay plan rollId does not match the logical result.");
  }

  if (plan.dice.length !== result.dice.length) {
    throw new RangeError("DiceRollEvent replay plan dice count does not match the logical result.");
  }

  for (let index = 0; index < plan.dice.length; index += 1) {
    const plannedDie = plan.dice[index];
    const resultDie = result.dice[index];

    if (
      !plannedDie ||
      !resultDie ||
      plannedDie.sides !== resultDie.sides ||
      plannedDie.expectedValue !== resultDie.value
    ) {
      throw new RangeError(`DiceRollEvent replay plan does not match result at index ${index}.`);
    }
  }
}

function validateReplayFromUnknown(result: DiceRollResult, replay: unknown): void {
  if (replay === undefined) {
    return;
  }

  if (!isRecord(replay) || replay.version !== DICE_ROLL_REPLAY_VERSION) {
    throw new RangeError(`Unsupported DiceRollEvent replay version.`);
  }

  const plan = replay.plan;

  if (!isRecord(plan) || !Array.isArray(plan.dice) || typeof plan.rollId !== "string") {
    throw new RangeError("DiceRollEvent replay plan is malformed.");
  }

  validatePlan(result, plan as unknown as RollPlan);
}

/**
 * Validates an unknown transport payload and narrows it to the current DiceRollEvent contract.
 * This is intended for JSON.parse(...) output received from a network or another trust boundary.
 */
export function validateDiceRollEvent(event: unknown): DiceRollEvent {
  if (!isRecord(event)) {
    throw new RangeError("DiceRollEvent payload must be an object.");
  }

  if (event.type !== DICE_ROLL_EVENT_TYPE) {
    throw new RangeError(`Unsupported DiceRollEvent type: ${String(event.type)}.`);
  }

  if (event.version !== DICE_ROLL_EVENT_VERSION) {
    throw new RangeError(`Unsupported DiceRollEvent version: ${String(event.version)}.`);
  }

  if (typeof event.rollId !== "string" || event.rollId.trim().length === 0) {
    throw new RangeError("DiceRollEvent requires a non-empty rollId.");
  }

  if (!Array.isArray(event.dice) || event.dice.length === 0) {
    throw new RangeError("DiceRollEvent requires at least one die.");
  }

  if (
    typeof event.modifier !== "number" ||
    !Number.isFinite(event.modifier) ||
    typeof event.total !== "number" ||
    !Number.isFinite(event.total)
  ) {
    throw new RangeError("DiceRollEvent modifier and total must be finite numbers.");
  }

  if (event.reason !== undefined && typeof event.reason !== "string") {
    throw new RangeError("DiceRollEvent reason must be a string when provided.");
  }

  const dice = event.dice.map((rawDie, index) => {
    if (!isRecord(rawDie)) {
      throw new RangeError(`DiceRollEvent die at index ${index} must be an object.`);
    }

    const sides = rawDie.sides;
    const value = rawDie.value;

    if (
      typeof sides !== "number" ||
      !SUPPORTED_DICE_SIDES.includes(sides as DiceSides) ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > sides
    ) {
      throw new RangeError(`DiceRollEvent contains an invalid die result at index ${index}.`);
    }

    const typedSides = sides as DiceSides;
    validateAppearance(rawDie.appearance, typedSides, index);

    return {
      sides: typedSides,
      value,
      ...(rawDie.appearance === undefined ? {} : { appearance: rawDie.appearance })
    } satisfies DiceRollEventDie;
  });

  const result: DiceRollResult = {
    rollId: event.rollId,
    dice: dice.map((die) => ({ sides: die.sides, value: die.value })),
    modifier: event.modifier,
    total: event.total,
    ...(event.reason === undefined ? {} : { reason: event.reason })
  };

  validateResult(result);
  validateReplayFromUnknown(result, event.replay);

  return event as unknown as DiceRollEvent;
}

/** Creates a versioned host-authoritative event from a logical result and optional replay data. */
export function createDiceRollEvent(
  result: DiceRollResult,
  options: CreateDiceRollEventOptions = {}
): DiceRollEvent {
  validateResult(result);
  validateDefinitions(result, options.definitions);
  validatePlan(result, options.plan);

  const dice = result.dice.map((die, index) => {
    const definition = options.definitions?.[index];
    const appearance = cloneAppearance(definition?.appearance);

    return {
      sides: die.sides,
      value: die.value,
      ...(appearance ? { appearance } : {})
    } satisfies DiceRollEventDie;
  });

  return {
    type: DICE_ROLL_EVENT_TYPE,
    version: DICE_ROLL_EVENT_VERSION,
    rollId: result.rollId,
    dice,
    modifier: result.modifier,
    total: result.total,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(options.plan
      ? {
          replay: {
            version: DICE_ROLL_REPLAY_VERSION,
            plan: options.plan
          }
        }
      : {})
  };
}

/**
 * Reconstructs the authoritative logical result on a client without rolling again.
 * The optional replay data is presentation-only and never changes these values.
 */
export function diceRollResultFromEvent(event: unknown): DiceRollResult {
  const validatedEvent = validateDiceRollEvent(event);

  return {
    rollId: validatedEvent.rollId,
    dice: validatedEvent.dice.map((die) => ({ sides: die.sides, value: die.value })),
    modifier: validatedEvent.modifier,
    total: validatedEvent.total,
    ...(validatedEvent.reason === undefined ? {} : { reason: validatedEvent.reason })
  };
}
