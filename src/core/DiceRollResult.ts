import type { DieResult } from "./DieResult.js";

/** Authoritative logical result returned by a completed dice roll. */
export interface DiceRollResult {
  readonly rollId: string;
  readonly dice: readonly DieResult[];
  readonly modifier: number;
  readonly total: number;
  readonly reason?: string;
}
