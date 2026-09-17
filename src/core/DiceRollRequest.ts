import type { DiceDefinition } from "./DiceDefinition.js";

/** Input accepted by the logical dice rolling pipeline. */
export interface DiceRollRequest {
  /** Each entry represents one physical die and may have its own appearance. */
  readonly dice: readonly DiceDefinition[];

  /** Numeric modifier added to the sum of all dice. Defaults to zero. */
  readonly modifier?: number;

  /** Optional human-readable reason shown by integrations such as DiceOverlay. */
  readonly reason?: string;
}
