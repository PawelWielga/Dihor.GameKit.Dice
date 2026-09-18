/**
 * Operational envelope accepted for untrusted DiceRollEvent v1 payloads.
 *
 * These limits are intentionally wider than the normal planner defaults while still bounding
 * network-driven CPU, memory and physics work before playback begins.
 */
export const DICE_ROLL_EVENT_LIMITS = Object.freeze({
  maxDiceCount: 6,
  maxRollIdLength: 128,
  maxReasonLength: 512,
  maxStyleStringLength: 256,
  maxAssetReferenceLength: 2048,
  maxArenaBoundaryPoints: 64,
  maxArenaBoundaryCoordinateMagnitude: 100,
  minDiceSize: 0.1,
  maxDiceSize: 10,
  maxArenaHalfExtent: 100,
  maxGravityMagnitude: 100,
  maxPositionMagnitude: 100,
  maxVelocityMagnitude: 100,
  maxAngularVelocityMagnitude: 100,
  maxStabilityConsecutiveSteps: 240,
  maxStabilitySteps: 3600,
  maxSimulationSteps: 3600
} as const);
