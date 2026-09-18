import { describe, expect, it } from "vitest";
import {
  DICE_ROLL_EVENT_LIMITS,
  DICE_ROLL_EVENT_TYPE,
  DICE_ROLL_EVENT_VERSION,
  DICE_ROLL_REPLAY_VERSION,
  RollPlanner,
  createDiceRollEvent,
  createSeededRandomProvider,
  diceRollResultFromEvent,
  validateDiceRollEvent,
  type DiceDefinition,
  type DiceRollResult,
  type PresimulatedRollPlan
} from "../src/advanced.js";

function logicalResult(): DiceRollResult {
  return {
    rollId: "host-roll-42",
    dice: [
      { sides: 8, value: 5 },
      { sides: 20, value: 13 }
    ],
    modifier: 2,
    total: 20,
    reason: "Attack"
  };
}

function replayPlan(result: DiceRollResult): PresimulatedRollPlan {
  return new RollPlanner({
    randomProvider: createSeededRandomProvider("event-test", "physics"),
    maxPlanningTimeMs: 5000
  }).plan(result);
}

function replayPayload(): Record<string, any> {
  const result = logicalResult();
  return JSON.parse(JSON.stringify(createDiceRollEvent(result, { plan: replayPlan(result) })));
}


describe("DiceRollEvent", () => {
  it("serializes definitions, authoritative values and optional replay plan to JSON", () => {
    const result = logicalResult();
    const definitions: readonly DiceDefinition[] = [
      {
        sides: 8,
        appearance: {
          color: "#7b1e1e",
          markingsColor: "#f5e6c8"
        }
      },
      {
        sides: 20,
        appearance: {
          texture: "/dice/marble.png",
          faces: { 13: "/dice/critical.png" }
        }
      }
    ];
    const plan = replayPlan(result);
    const event = createDiceRollEvent(result, { definitions, plan });
    const restored = JSON.parse(JSON.stringify(event));

    expect(event.type).toBe(DICE_ROLL_EVENT_TYPE);
    expect(event.version).toBe(DICE_ROLL_EVENT_VERSION);
    expect(event.replay?.version).toBe(DICE_ROLL_REPLAY_VERSION);
    expect(event.dice).toEqual([
      {
        sides: 8,
        value: 5,
        appearance: {
          color: "#7b1e1e",
          markingsColor: "#f5e6c8"
        }
      },
      {
        sides: 20,
        value: 13,
        appearance: {
          texture: "/dice/marble.png",
          faces: { 13: "/dice/critical.png" }
        }
      }
    ]);
    expect(validateDiceRollEvent(restored)).toEqual(event);
  });

  it("reconstructs the host result without rolling locally", () => {
    const result = logicalResult();
    const event = createDiceRollEvent(result);

    expect(event.replay).toBeUndefined();
    expect(diceRollResultFromEvent(event)).toEqual(result);
  });

  it("keeps the logical host result authoritative even when replay data is omitted", () => {
    const event = createDiceRollEvent(logicalResult());
    const simplifiedPresentation = event.dice.map((die) => `D${die.sides}: ${die.value}`);

    expect(simplifiedPresentation).toEqual(["D8: 5", "D20: 13"]);
    expect(event.total).toBe(20);
  });

  it("rejects replay plans that do not match the authoritative result", () => {
    const result = logicalResult();
    const validPlan = replayPlan(result);
    const mismatchedPlan: PresimulatedRollPlan = {
      ...validPlan,
      dice: validPlan.dice.map((die, index) =>
        index === 0 ? { ...die, expectedValue: die.expectedValue === 1 ? 2 : 1 } : die
      )
    };

    expect(() => createDiceRollEvent(result, { plan: mismatchedPlan })).toThrowError(RangeError);
  });

  it("rejects definitions and totals that disagree with the logical result", () => {
    const result = logicalResult();

    expect(() =>
      createDiceRollEvent(result, { definitions: [{ sides: 6 }, { sides: 20 }] })
    ).toThrowError(RangeError);
    expect(() => createDiceRollEvent({ ...result, total: 999 })).toThrowError(RangeError);
  });

  it("validates unknown transport payloads before clients use them", () => {
    const valid = JSON.parse(JSON.stringify(createDiceRollEvent(logicalResult())));

    expect(validateDiceRollEvent(valid)).toEqual(valid);
    expect(() => validateDiceRollEvent({ ...valid, version: 999 })).toThrowError(RangeError);
    expect(() => validateDiceRollEvent({ ...valid, total: 999 })).toThrowError(RangeError);
    expect(() =>
      validateDiceRollEvent({
        ...valid,
        dice: [{ sides: 7, value: 1 }, valid.dice[1]]
      })
    ).toThrowError(RangeError);
  });

  it("rejects malformed or unsupported replay payloads received over transport", () => {
    const result = logicalResult();
    const event = createDiceRollEvent(result, { plan: replayPlan(result) });
    const payload = JSON.parse(JSON.stringify(event));

    expect(() =>
      validateDiceRollEvent({
        ...payload,
        replay: { ...payload.replay, version: 999 }
      })
    ).toThrowError(RangeError);
    expect(() =>
      validateDiceRollEvent({
        ...payload,
        replay: { version: DICE_ROLL_REPLAY_VERSION, plan: null }
      })
    ).toThrowError(RangeError);
  });

  it("accepts legacy presimulated replay payloads without the discriminator", () => {
    const payload = replayPayload();
    delete payload.replay.plan.preSimulated;

    const validated = validateDiceRollEvent(payload);

    expect(validated.replay?.plan.preSimulated).toBe(true);
  });

  it("rejects direct physical plans received as authoritative replay data", () => {
    const payload = replayPayload();
    payload.replay.plan.preSimulated = false;
    payload.replay.plan.simulationSteps = 0;
    for (const die of payload.replay.plan.dice) {
      die.expectedValue = 0;
    }

    expect(() => validateDiceRollEvent(payload)).toThrowError(/presimulated/i);
  });

  it("rejects missing or malformed replay initial state data", () => {
    const missing = replayPayload();
    delete missing.replay.plan.dice[0].initialState;

    expect(() => validateDiceRollEvent(missing)).toThrowError(RangeError);

    const malformed = replayPayload();
    malformed.replay.plan.dice[0].initialState.position = { x: 0, y: "bad", z: 0 };

    expect(() => validateDiceRollEvent(malformed)).toThrowError(RangeError);
  });

  it("rejects non-finite replay vectors and invalid quaternions before playback", () => {
    const nonFinite = replayPayload();
    nonFinite.replay.plan.dice[0].initialState.velocity.x = Number.POSITIVE_INFINITY;

    expect(() => validateDiceRollEvent(nonFinite)).toThrowError(RangeError);

    const nan = replayPayload();
    nan.replay.plan.dice[0].initialState.angularVelocity.z = Number.NaN;

    expect(() => validateDiceRollEvent(nan)).toThrowError(RangeError);

    const zeroQuaternion = replayPayload();
    zeroQuaternion.replay.plan.dice[0].initialState.quaternion = {
      x: 0,
      y: 0,
      z: 0,
      w: 0
    };

    expect(() => validateDiceRollEvent(zeroQuaternion)).toThrowError(RangeError);
  });

  it("rejects replay physics values that the physics world would reject", () => {
    const invalidTimeStep = replayPayload();
    invalidTimeStep.replay.plan.physics.timeStep = 0;
    expect(() => validateDiceRollEvent(invalidTimeStep)).toThrowError(RangeError);

    const invalidFriction = replayPayload();
    invalidFriction.replay.plan.physics.friction = 1.5;
    expect(() => validateDiceRollEvent(invalidFriction)).toThrowError(RangeError);

    const invalidGravity = replayPayload();
    invalidGravity.replay.plan.physics.gravity.y = Number.NaN;
    expect(() => validateDiceRollEvent(invalidGravity)).toThrowError(RangeError);
  });

  it("rejects replay stability values that playback would reject", () => {
    const invalidMaxSteps = replayPayload();
    invalidMaxSteps.replay.plan.stability.maxSteps = 0;
    expect(() => validateDiceRollEvent(invalidMaxSteps)).toThrowError(RangeError);

    const invalidThreshold = replayPayload();
    invalidThreshold.replay.plan.stability.angularThreshold = -1;
    expect(() => validateDiceRollEvent(invalidThreshold)).toThrowError(RangeError);
  });

  it("validates current engraving, font and D6 face-label appearance fields", () => {
    const result: DiceRollResult = {
      rollId: "appearance-roll",
      dice: [{ sides: 6, value: 1 }],
      modifier: 0,
      total: 1
    };
    const definitions: readonly DiceDefinition[] = [{
      sides: 6,
      appearance: {
        color: "#ffffff",
        markingsColor: "#111111",
        engravingDepth: 1.5,
        font: {
          family: "Georgia",
          url: "/fonts/georgia.woff2",
          weight: 650,
          size: 1.2
        },
        faceLabelMode: "numbers"
      }
    }];
    const event = createDiceRollEvent(result, {
      definitions,
      plan: replayPlan(result)
    });
    const restored = JSON.parse(JSON.stringify(event));

    expect(validateDiceRollEvent(restored)).toEqual(event);

    for (const mutate of [
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.engravingDepth = 3;
      },
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.font.size = 0.1;
      },
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.font.weight = 0;
      },
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.font.family = "   ";
      },
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.font.url = "";
      },
      (payload: Record<string, any>) => {
        payload.dice[0].appearance.faceLabelMode = "symbols";
      }
    ]) {
      const invalid = JSON.parse(JSON.stringify(event)) as Record<string, any>;
      mutate(invalid);
      expect(() => validateDiceRollEvent(invalid)).toThrowError(RangeError);
    }
  });

  it("returns a validated copy instead of trusting nested payload objects", () => {
    const payload = replayPayload();
    payload.untrustedExtra = "ignored";
    payload.replay.plan.untrustedExtra = { executable: true };
    payload.dice[0].appearance = { color: "#ffffff", untrustedExtra: true };

    const validated = validateDiceRollEvent(payload) as unknown as Record<string, any>;

    expect(validated).not.toBe(payload);
    expect(validated.untrustedExtra).toBeUndefined();
    expect(validated.replay.plan.untrustedExtra).toBeUndefined();
    expect(validated.dice[0].appearance.untrustedExtra).toBeUndefined();
  });
  it("enforces top-level resource limits while accepting supported boundaries", () => {
    const sixDicePayload = {
      type: DICE_ROLL_EVENT_TYPE,
      version: DICE_ROLL_EVENT_VERSION,
      rollId: "r".repeat(DICE_ROLL_EVENT_LIMITS.maxRollIdLength),
      dice: Array.from({ length: DICE_ROLL_EVENT_LIMITS.maxDiceCount }, () => ({
        sides: 6,
        value: 1
      })),
      modifier: 0,
      total: DICE_ROLL_EVENT_LIMITS.maxDiceCount,
      reason: "x".repeat(DICE_ROLL_EVENT_LIMITS.maxReasonLength)
    };

    expect(validateDiceRollEvent(sixDicePayload).dice).toHaveLength(
      DICE_ROLL_EVENT_LIMITS.maxDiceCount
    );

    expect(() =>
      validateDiceRollEvent({
        ...sixDicePayload,
        dice: [...sixDicePayload.dice, { sides: 6, value: 1 }],
        total: sixDicePayload.total + 1
      })
    ).toThrowError(/must not exceed/i);

    expect(() =>
      validateDiceRollEvent({
        ...sixDicePayload,
        rollId: "r".repeat(DICE_ROLL_EVENT_LIMITS.maxRollIdLength + 1)
      })
    ).toThrowError(/rollId.*exceed/i);

    expect(() =>
      validateDiceRollEvent({
        ...sixDicePayload,
        reason: "x".repeat(DICE_ROLL_EVENT_LIMITS.maxReasonLength + 1)
      })
    ).toThrowError(/reason.*exceed/i);
  });

  it("enforces replay complexity and arena limits", () => {
    const boundaryPayload = replayPayload();
    boundaryPayload.replay.plan.physics.arenaBoundary = Array.from(
      { length: DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints },
      (_, index) => {
        const angle = (index / DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints) * Math.PI * 2;
        return { x: Math.cos(angle) * 5, z: Math.sin(angle) * 5 };
      }
    );
    expect(validateDiceRollEvent(boundaryPayload).replay?.plan.physics.arenaBoundary).toHaveLength(
      DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints
    );

    const tooManyBoundaryPoints = replayPayload();
    tooManyBoundaryPoints.replay.plan.physics.arenaBoundary = Array.from(
      { length: DICE_ROLL_EVENT_LIMITS.maxArenaBoundaryPoints + 1 },
      (_, index) => ({ x: index, z: index % 2 })
    );
    expect(() => validateDiceRollEvent(tooManyBoundaryPoints)).toThrowError(/arenaBoundary.*exceed/i);

    const farBoundary = replayPayload();
    farBoundary.replay.plan.physics.arenaBoundary = [
      { x: DICE_ROLL_EVENT_LIMITS.maxArenaExtent + 1, z: 0 },
      { x: 0, z: 1 },
      { x: -1, z: 0 }
    ];
    expect(() => validateDiceRollEvent(farBoundary)).toThrowError(/origin/i);

    for (const [field, value] of [
      ["consecutiveSteps", DICE_ROLL_EVENT_LIMITS.maxStabilityConsecutiveSteps + 1],
      ["maxSteps", DICE_ROLL_EVENT_LIMITS.maxStabilityMaxSteps + 1]
    ] as const) {
      const payload = replayPayload();
      payload.replay.plan.stability[field] = value;
      expect(() => validateDiceRollEvent(payload)).toThrowError(/must not exceed/i);
    }

    const tooManySimulationSteps = replayPayload();
    tooManySimulationSteps.replay.plan.simulationSteps =
      DICE_ROLL_EVENT_LIMITS.maxSimulationSteps + 1;
    expect(() => validateDiceRollEvent(tooManySimulationSteps)).toThrowError(/simulationSteps/i);
  });

  it("enforces replay physical magnitude and size limits", () => {
    for (const diceSize of [
      DICE_ROLL_EVENT_LIMITS.minDiceSize / 2,
      DICE_ROLL_EVENT_LIMITS.maxDiceSize + 1
    ]) {
      const payload = replayPayload();
      payload.replay.plan.physics.diceSize = diceSize;
      expect(() => validateDiceRollEvent(payload)).toThrowError(/diceSize/i);
    }

    const extent = replayPayload();
    extent.replay.plan.physics.arenaHalfExtent = DICE_ROLL_EVENT_LIMITS.maxArenaExtent + 1;
    expect(() => validateDiceRollEvent(extent)).toThrowError(/arenaHalfExtent/i);

    const cases = [
      ["position", DICE_ROLL_EVENT_LIMITS.maxPositionMagnitude],
      ["velocity", DICE_ROLL_EVENT_LIMITS.maxVelocityMagnitude],
      ["angularVelocity", DICE_ROLL_EVENT_LIMITS.maxAngularVelocityMagnitude]
    ] as const;

    for (const [field, limit] of cases) {
      const payload = replayPayload();
      payload.replay.plan.dice[0].initialState[field] = { x: limit + 1, y: 0, z: 0 };
      expect(() => validateDiceRollEvent(payload)).toThrowError(/magnitude/i);
    }
  });

  it("limits appearance strings carried by network events", () => {
    const payload = replayPayload();
    payload.dice[0].appearance = {
      texture: "x".repeat(DICE_ROLL_EVENT_LIMITS.maxAppearanceStringLength + 1)
    };
    expect(() => validateDiceRollEvent(payload)).toThrowError(/appearance\.texture.*exceed/i);

    const facePayload = replayPayload();
    facePayload.dice[0].appearance = {
      faces: {
        1: "x".repeat(DICE_ROLL_EVENT_LIMITS.maxAppearanceStringLength + 1)
      }
    };
    expect(() => validateDiceRollEvent(facePayload)).toThrowError(/appearance\.faces/i);

    const fontPayload = replayPayload();
    fontPayload.dice[0].appearance = {
      font: {
        family: "x".repeat(DICE_ROLL_EVENT_LIMITS.maxFontFamilyLength + 1)
      }
    };
    expect(() => validateDiceRollEvent(fontPayload)).toThrowError(/font\.family.*exceed/i);
  });

});
