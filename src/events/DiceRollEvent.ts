import {
  resolveDiceAppearance,
  resolveDiceFaceLabelMode,
  resolveDiceFontAppearance,
  type DiceAppearance,
  type DiceFontAppearance
} from "../appearance/index.js";
import {
  SUPPORTED_DICE_SIDES,
  type DiceDefinition,
  type DiceRollResult,
  type DiceSides
} from "../core/index.js";
import type {
  DiceArenaBoundaryPoint,
  DicePhysicsConfig,
  PhysicsQuaternion,
  PhysicsVector3,
  PresimulatedRollPlan,
  RollInitialState,
  RollPlanDie,
  StabilityConfig
} from "../physics/index.js";

import { DICE_ROLL_EVENT_LIMITS } from "./DiceRollEventLimits.js";

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
  readonly plan: PresimulatedRollPlan;
}

/**
 * Transport-neutral host-authoritative dice event.
 *
 * This model intentionally contains only JSON-friendly domain and replay data. It does not know
 * about WebSockets, Three.js or any other transport/rendering implementation.
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
  readonly plan?: PresimulatedRollPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(name: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RangeError(`${name} must be an object.`);
  }

  return value;
}

function requireFiniteNumber(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }

  return value;
}

function requirePositiveNumber(name: string, value: unknown): number {
  const resolved = requireFiniteNumber(name, value);

  if (resolved <= 0) {
    throw new RangeError(`${name} must be greater than zero.`);
  }

  return resolved;
}

function requireUnitInterval(name: string, value: unknown): number {
  const resolved = requireFiniteNumber(name, value);

  if (resolved < 0 || resolved > 1) {
    throw new RangeError(`${name} must be a finite number in 0..1.`);
  }

  return resolved;
}

function requirePositiveInteger(name: string, value: unknown): number {
  const resolved = requirePositiveNumber(name, value);

  if (!Number.isInteger(resolved)) {
    throw new RangeError(`${name} must be a positive integer.`);
  }

  return resolved;
}

function requirePositiveIntegerAtMost(name: string, value: unknown, maximum: number): number {
  const resolved = requirePositiveInteger(name, value);

  if (resolved > maximum) {
    throw new RangeError(`${name} must be at most ${maximum}; received ${resolved}.`);
  }

  return resolved;
}

function requireNumberInRange(
  name: string,
  value: unknown,
  minimum: number,
  maximum: number
): number {
  const resolved = requireFiniteNumber(name, value);

  if (resolved < minimum || resolved > maximum) {
    throw new RangeError(
      `${name} must be in the range ${minimum}..${maximum}; received ${resolved}.`
    );
  }

  return resolved;
}

function requireBoundedString(name: string, value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new RangeError(`${name} must be a string.`);
  }

  if (value.length > maximumLength) {
    throw new RangeError(
      `${name} must be at most ${maximumLength} characters; received ${value.length}.`
    );
  }

  return value;
}

function requireOptionalString(
  name: string,
  value: unknown,
  maximumLength = DICE_ROLL_EVENT_LIMITS.maxStyleStringLength
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireBoundedString(name, value, maximumLength);
}

function cloneAppearance(appearance: DiceAppearance | undefined): DiceAppearance | undefined {
  if (!appearance) {
    return undefined;
  }

  return {
    ...appearance,
    ...(appearance.font ? { font: { ...appearance.font } } : {}),
    ...(appearance.faces ? { faces: { ...appearance.faces } } : {})
  };
}

function validateFontFromUnknown(
  value: unknown,
  diceIndex: number
): DiceFontAppearance | undefined {
  if (value === undefined) {
    return undefined;
  }

  const font = requireRecord(`DiceRollEvent appearance.font at index ${diceIndex}`, value);
  const family = requireOptionalString(
    `DiceRollEvent appearance.font.family at index ${diceIndex}`,
    font.family
  );
  const url = requireOptionalString(
    `DiceRollEvent appearance.font.url at index ${diceIndex}`,
    font.url,
    DICE_ROLL_EVENT_LIMITS.maxAssetReferenceLength
  );
  const weight =
    font.weight === undefined
      ? undefined
      : requireFiniteNumber(
          `DiceRollEvent appearance.font.weight at index ${diceIndex}`,
          font.weight
        );
  const size =
    font.size === undefined
      ? undefined
      : requireFiniteNumber(
          `DiceRollEvent appearance.font.size at index ${diceIndex}`,
          font.size
        );

  const validated: DiceFontAppearance = {
    ...(family === undefined ? {} : { family }),
    ...(url === undefined ? {} : { url }),
    ...(weight === undefined ? {} : { weight }),
    ...(size === undefined ? {} : { size })
  };

  // Keep the event validator aligned with the renderer's public font constraints.
  resolveDiceFontAppearance(validated);
  return validated;
}

function validateAppearanceFromUnknown(
  appearance: unknown,
  sides: DiceSides,
  index: number
): DiceAppearance | undefined {
  if (appearance === undefined) {
    return undefined;
  }

  const raw = requireRecord(`DiceRollEvent appearance at index ${index}`, appearance);
  const color = requireOptionalString(
    `DiceRollEvent appearance.color at index ${index}`,
    raw.color
  );
  const markingsColor = requireOptionalString(
    `DiceRollEvent appearance.markingsColor at index ${index}`,
    raw.markingsColor
  );
  const texture = requireOptionalString(
    `DiceRollEvent appearance.texture at index ${index}`,
    raw.texture,
    DICE_ROLL_EVENT_LIMITS.maxAssetReferenceLength
  );
  const normalMap = requireOptionalString(
    `DiceRollEvent appearance.normalMap at index ${index}`,
    raw.normalMap,
    DICE_ROLL_EVENT_LIMITS.maxAssetReferenceLength
  );
  const roughnessMap = requireOptionalString(
    `DiceRollEvent appearance.roughnessMap at index ${index}`,
    raw.roughnessMap,
    DICE_ROLL_EVENT_LIMITS.maxAssetReferenceLength
  );
  const roughness =
    raw.roughness === undefined
      ? undefined
      : requireFiniteNumber(`DiceRollEvent appearance.roughness at index ${index}`, raw.roughness);
  const metalness =
    raw.metalness === undefined
      ? undefined
      : requireFiniteNumber(`DiceRollEvent appearance.metalness at index ${index}`, raw.metalness);
  const engravingDepth =
    raw.engravingDepth === undefined
      ? undefined
      : requireFiniteNumber(
          `DiceRollEvent appearance.engravingDepth at index ${index}`,
          raw.engravingDepth
        );
  const font = validateFontFromUnknown(raw.font, index);

  let faceLabelMode: DiceAppearance["faceLabelMode"];
  if (raw.faceLabelMode !== undefined) {
    if (typeof raw.faceLabelMode !== "string") {
      throw new RangeError(
        `DiceRollEvent appearance.faceLabelMode at index ${index} must be a string.`
      );
    }

    faceLabelMode = raw.faceLabelMode as DiceAppearance["faceLabelMode"];
  }

  let faces: Readonly<Partial<Record<number, string>>> | undefined;
  if (raw.faces !== undefined) {
    const rawFaces = requireRecord(`DiceRollEvent appearance.faces at index ${index}`, raw.faces);
    const validatedFaces: Partial<Record<number, string>> = {};

    for (const [faceKey, source] of Object.entries(rawFaces)) {
      const face = Number(faceKey);

      if (!Number.isInteger(face) || face < 1 || face > sides || typeof source !== "string") {
        throw new RangeError(
          `DiceRollEvent appearance.faces contains an invalid D${sides} face at index ${index}.`
        );
      }

      validatedFaces[face] = requireBoundedString(
        `DiceRollEvent appearance.faces[${face}] at index ${index}`,
        source,
        DICE_ROLL_EVENT_LIMITS.maxAssetReferenceLength
      );
    }

    faces = validatedFaces;
  }

  const validated: DiceAppearance = {
    ...(color === undefined ? {} : { color }),
    ...(markingsColor === undefined ? {} : { markingsColor }),
    ...(engravingDepth === undefined ? {} : { engravingDepth }),
    ...(texture === undefined ? {} : { texture }),
    ...(normalMap === undefined ? {} : { normalMap }),
    ...(roughnessMap === undefined ? {} : { roughnessMap }),
    ...(roughness === undefined ? {} : { roughness }),
    ...(metalness === undefined ? {} : { metalness }),
    ...(font === undefined ? {} : { font }),
    ...(faceLabelMode === undefined ? {} : { faceLabelMode }),
    ...(faces === undefined ? {} : { faces })
  };

  // Reuse the public appearance resolvers so event validation cannot silently accept values
  // that the renderer would reject later.
  resolveDiceAppearance(validated);
  resolveDiceFontAppearance(validated.font);
  resolveDiceFaceLabelMode(validated);
  return validated;
}

function validateVectorFromUnknown(
  name: string,
  value: unknown,
  maximumMagnitude = Number.POSITIVE_INFINITY
): PhysicsVector3 {
  const vector = requireRecord(name, value);
  const validated: PhysicsVector3 = {
    x: requireFiniteNumber(`${name}.x`, vector.x),
    y: requireFiniteNumber(`${name}.y`, vector.y),
    z: requireFiniteNumber(`${name}.z`, vector.z)
  };

  const magnitude = Math.hypot(validated.x, validated.y, validated.z);
  if (magnitude > maximumMagnitude) {
    throw new RangeError(
      `${name} magnitude must be at most ${maximumMagnitude}; received ${magnitude}.`
    );
  }

  return validated;
}

function validateQuaternionFromUnknown(name: string, value: unknown): PhysicsQuaternion {
  const quaternion = requireRecord(name, value);
  const validated: PhysicsQuaternion = {
    x: requireFiniteNumber(`${name}.x`, quaternion.x),
    y: requireFiniteNumber(`${name}.y`, quaternion.y),
    z: requireFiniteNumber(`${name}.z`, quaternion.z),
    w: requireFiniteNumber(`${name}.w`, quaternion.w)
  };

  if (Math.hypot(validated.x, validated.y, validated.z, validated.w) <= Number.EPSILON) {
    throw new RangeError(`${name} must be non-zero.`);
  }

  return validated;
}

function validateArenaBoundaryFromUnknown(value: unknown): readonly DiceArenaBoundaryPoint[] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new RangeError("DiceRollEvent replay plan physics.arenaBoundary must contain at least three points.");
  }

  if (value.length > DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints) {
    throw new RangeError(
      `DiceRollEvent replay plan physics.arenaBoundary must contain at most ${DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints} points.`
    );
  }

  const boundary = value.map((rawPoint, index) => {
    const point = requireRecord(
      `DiceRollEvent replay plan physics.arenaBoundary[${index}]`,
      rawPoint
    );

    const validated = {
      x: requireFiniteNumber(
        `DiceRollEvent replay plan physics.arenaBoundary[${index}].x`,
        point.x
      ),
      z: requireFiniteNumber(
        `DiceRollEvent replay plan physics.arenaBoundary[${index}].z`,
        point.z
      )
    };

    const magnitude = Math.hypot(validated.x, validated.z);
    if (magnitude > DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryCoordinateMagnitude) {
      throw new RangeError(
        `DiceRollEvent replay plan physics.arenaBoundary[${index}] magnitude must be at most ${DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryCoordinateMagnitude}.`
      );
    }

    return validated;
  });

  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!;
    const next = boundary[(index + 1) % boundary.length]!;

    if (Math.hypot(next.x - current.x, next.z - current.z) <= Number.EPSILON) {
      throw new RangeError(
        `DiceRollEvent replay plan physics.arenaBoundary edge ${index} must have non-zero length.`
      );
    }
  }

  return boundary;
}

function validatePhysicsFromUnknown(value: unknown): DicePhysicsConfig {
  const physics = requireRecord("DiceRollEvent replay plan physics", value);
  const arenaBoundary =
    physics.arenaBoundary === undefined
      ? undefined
      : validateArenaBoundaryFromUnknown(physics.arenaBoundary);

  return {
    gravity: validateVectorFromUnknown(
      "DiceRollEvent replay plan physics.gravity",
      physics.gravity,
      DICE_ROLL_EVENT_LIMITS.maxGravityMagnitude
    ),
    timeStep: requirePositiveNumber(
      "DiceRollEvent replay plan physics.timeStep",
      physics.timeStep
    ),
    friction: requireUnitInterval(
      "DiceRollEvent replay plan physics.friction",
      physics.friction
    ),
    restitution: requireUnitInterval(
      "DiceRollEvent replay plan physics.restitution",
      physics.restitution
    ),
    linearDamping: requireUnitInterval(
      "DiceRollEvent replay plan physics.linearDamping",
      physics.linearDamping
    ),
    angularDamping: requireUnitInterval(
      "DiceRollEvent replay plan physics.angularDamping",
      physics.angularDamping
    ),
    diceSize: requireNumberInRange(
      "DiceRollEvent replay plan physics.diceSize",
      physics.diceSize,
      DICE_ROLL_EVENT_LIMITS.minDiceSize,
      DICE_ROLL_EVENT_LIMITS.maxDiceSize
    ),
    arenaHalfExtent: requireNumberInRange(
      "DiceRollEvent replay plan physics.arenaHalfExtent",
      physics.arenaHalfExtent,
      Number.MIN_VALUE,
      DICE_ROLL_EVENT_LIMITS.maxArenaHalfExtent
    ),
    ...(arenaBoundary === undefined ? {} : { arenaBoundary })
  };
}

function validateStabilityFromUnknown(value: unknown): StabilityConfig {
  const stability = requireRecord("DiceRollEvent replay plan stability", value);

  return {
    linearThreshold: requirePositiveNumber(
      "DiceRollEvent replay plan stability.linearThreshold",
      stability.linearThreshold
    ),
    angularThreshold: requirePositiveNumber(
      "DiceRollEvent replay plan stability.angularThreshold",
      stability.angularThreshold
    ),
    consecutiveSteps: requirePositiveIntegerAtMost(
      "DiceRollEvent replay plan stability.consecutiveSteps",
      stability.consecutiveSteps,
      DICE_ROLL_EVENT_LIMITS.maxStabilityConsecutiveSteps
    ),
    maxSteps: requirePositiveIntegerAtMost(
      "DiceRollEvent replay plan stability.maxSteps",
      stability.maxSteps,
      DICE_ROLL_EVENT_LIMITS.maxStabilitySteps
    )
  };
}

function validateInitialStateFromUnknown(value: unknown, index: number): RollInitialState {
  const state = requireRecord(
    `DiceRollEvent replay plan dice[${index}].initialState`,
    value
  );

  return {
    position: validateVectorFromUnknown(
      `DiceRollEvent replay plan dice[${index}].initialState.position`,
      state.position,
      DICE_ROLL_EVENT_LIMITS.maxPositionMagnitude
    ),
    quaternion: validateQuaternionFromUnknown(
      `DiceRollEvent replay plan dice[${index}].initialState.quaternion`,
      state.quaternion
    ),
    velocity: validateVectorFromUnknown(
      `DiceRollEvent replay plan dice[${index}].initialState.velocity`,
      state.velocity,
      DICE_ROLL_EVENT_LIMITS.maxVelocityMagnitude
    ),
    angularVelocity: validateVectorFromUnknown(
      `DiceRollEvent replay plan dice[${index}].initialState.angularVelocity`,
      state.angularVelocity,
      DICE_ROLL_EVENT_LIMITS.maxAngularVelocityMagnitude
    )
  };
}

function validateReplayPlanFromUnknown(value: unknown): PresimulatedRollPlan {
  const plan = requireRecord("DiceRollEvent replay plan", value);

  const rollId = requireBoundedString(
    "DiceRollEvent replay plan rollId",
    plan.rollId,
    DICE_ROLL_EVENT_LIMITS.maxRollIdLength
  );
  if (rollId.trim().length === 0) {
    throw new RangeError("DiceRollEvent replay plan requires a non-empty rollId.");
  }

  if (!Array.isArray(plan.dice) || plan.dice.length === 0) {
    throw new RangeError("DiceRollEvent replay plan requires at least one die.");
  }

  if (plan.dice.length > DICE_ROLL_EVENT_LIMITS.maxDiceCount) {
    throw new RangeError(
      `DiceRollEvent replay plan supports at most ${DICE_ROLL_EVENT_LIMITS.maxDiceCount} dice.`
    );
  }

  // Replay v1 historically omitted this flag for presimulated plans, so absence stays valid.
  // A direct physical plan is never authoritative replay data.
  if (plan.preSimulated !== undefined && plan.preSimulated !== true) {
    throw new RangeError("DiceRollEvent replay plan must be presimulated.");
  }

  const dice: RollPlanDie[] = plan.dice.map((rawDie, index) => {
    const die = requireRecord(`DiceRollEvent replay plan die at index ${index}`, rawDie);
    const sides = die.sides;

    if (
      typeof sides !== "number" ||
      !SUPPORTED_DICE_SIDES.includes(sides as DiceSides)
    ) {
      throw new RangeError(
        `DiceRollEvent replay plan contains unsupported dice sides at index ${index}.`
      );
    }

    const expectedValue = die.expectedValue;
    if (
      typeof expectedValue !== "number" ||
      !Number.isInteger(expectedValue) ||
      expectedValue < 1 ||
      expectedValue > sides
    ) {
      throw new RangeError(
        `DiceRollEvent replay plan contains an invalid expected value at index ${index}.`
      );
    }

    return {
      sides: sides as DiceSides,
      expectedValue,
      initialState: validateInitialStateFromUnknown(die.initialState, index)
    };
  });

  const simulationSteps = requireFiniteNumber(
    "DiceRollEvent replay plan simulationSteps",
    plan.simulationSteps
  );

  if (
    !Number.isInteger(simulationSteps) ||
    simulationSteps < 1 ||
    simulationSteps > DICE_ROLL_EVENT_LIMITS.maxSimulationSteps
  ) {
    throw new RangeError(
      `DiceRollEvent replay plan simulationSteps must be an integer in 1..${DICE_ROLL_EVENT_LIMITS.maxSimulationSteps}.`
    );
  }

  return {
    rollId,
    dice,
    physics: validatePhysicsFromUnknown(plan.physics),
    stability: validateStabilityFromUnknown(plan.stability),
    simulationSteps,
    preSimulated: true
  };
}

function validateResult(result: DiceRollResult): void {
  requireBoundedString(
    "DiceRollEvent rollId",
    result.rollId,
    DICE_ROLL_EVENT_LIMITS.maxRollIdLength
  );

  if (result.rollId.trim().length === 0) {
    throw new RangeError("DiceRollEvent requires a non-empty rollId.");
  }

  if (result.dice.length === 0) {
    throw new RangeError("DiceRollEvent requires at least one die.");
  }

  if (result.dice.length > DICE_ROLL_EVENT_LIMITS.maxDiceCount) {
    throw new RangeError(
      `DiceRollEvent supports at most ${DICE_ROLL_EVENT_LIMITS.maxDiceCount} dice.`
    );
  }

  if (result.reason !== undefined) {
    requireBoundedString(
      "DiceRollEvent reason",
      result.reason,
      DICE_ROLL_EVENT_LIMITS.maxReasonLength
    );
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

function validatePlan(result: DiceRollResult, plan: PresimulatedRollPlan | undefined): void {
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

function validateReplayFromUnknown(
  result: DiceRollResult,
  replay: unknown
): DiceRollReplayV1 | undefined {
  if (replay === undefined) {
    return undefined;
  }

  const rawReplay = requireRecord("DiceRollEvent replay", replay);

  if (rawReplay.version !== DICE_ROLL_REPLAY_VERSION) {
    throw new RangeError("Unsupported DiceRollEvent replay version.");
  }

  const plan = validateReplayPlanFromUnknown(rawReplay.plan);
  validatePlan(result, plan);

  return {
    version: DICE_ROLL_REPLAY_VERSION,
    plan
  };
}

/**
 * Validates an unknown transport payload and narrows it to the current DiceRollEvent contract.
 * This is intended for JSON.parse(...) output received from a network or another trust boundary.
 */
export function validateDiceRollEvent(event: unknown): DiceRollEvent {
  const rawEvent = requireRecord("DiceRollEvent payload", event);

  if (rawEvent.type !== DICE_ROLL_EVENT_TYPE) {
    throw new RangeError(`Unsupported DiceRollEvent type: ${String(rawEvent.type)}.`);
  }

  if (rawEvent.version !== DICE_ROLL_EVENT_VERSION) {
    throw new RangeError(`Unsupported DiceRollEvent version: ${String(rawEvent.version)}.`);
  }

  const rollId = requireBoundedString(
    "DiceRollEvent rollId",
    rawEvent.rollId,
    DICE_ROLL_EVENT_LIMITS.maxRollIdLength
  );
  if (rollId.trim().length === 0) {
    throw new RangeError("DiceRollEvent requires a non-empty rollId.");
  }

  if (!Array.isArray(rawEvent.dice) || rawEvent.dice.length === 0) {
    throw new RangeError("DiceRollEvent requires at least one die.");
  }

  if (rawEvent.dice.length > DICE_ROLL_EVENT_LIMITS.maxDiceCount) {
    throw new RangeError(
      `DiceRollEvent supports at most ${DICE_ROLL_EVENT_LIMITS.maxDiceCount} dice.`
    );
  }

  const modifier = requireFiniteNumber("DiceRollEvent modifier", rawEvent.modifier);
  const total = requireFiniteNumber("DiceRollEvent total", rawEvent.total);

  const reason =
    rawEvent.reason === undefined
      ? undefined
      : requireBoundedString(
          "DiceRollEvent reason",
          rawEvent.reason,
          DICE_ROLL_EVENT_LIMITS.maxReasonLength
        );

  const dice = rawEvent.dice.map((rawDie, index) => {
    const die = requireRecord(`DiceRollEvent die at index ${index}`, rawDie);
    const sides = die.sides;
    const value = die.value;

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
    const appearance = validateAppearanceFromUnknown(die.appearance, typedSides, index);

    return {
      sides: typedSides,
      value,
      ...(appearance === undefined ? {} : { appearance })
    } satisfies DiceRollEventDie;
  });

  const result: DiceRollResult = {
    rollId,
    dice: dice.map((die) => ({ sides: die.sides, value: die.value })),
    modifier,
    total,
    ...(reason === undefined ? {} : { reason })
  };

  validateResult(result);
  const replay = validateReplayFromUnknown(result, rawEvent.replay);

  return {
    type: DICE_ROLL_EVENT_TYPE,
    version: DICE_ROLL_EVENT_VERSION,
    rollId: result.rollId,
    dice,
    modifier: result.modifier,
    total: result.total,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(replay === undefined ? {} : { replay })
  };
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
