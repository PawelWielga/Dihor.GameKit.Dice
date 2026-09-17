import type { DiceAppearance } from "../appearance/DiceAppearance.js";
import type { DiceSides } from "./DiceSides.js";

/** Describes one physical die participating in a roll. */
export interface DiceDefinition {
  readonly sides: DiceSides;
  readonly appearance?: DiceAppearance;
}
