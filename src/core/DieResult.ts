import type { DiceSides } from "./DiceSides";

/** Logical result of one die. Result ordering matches request ordering. */
export interface DieResult {
  readonly sides: DiceSides;
  readonly value: number;
}
