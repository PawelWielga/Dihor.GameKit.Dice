import type { DiceAppearance } from "../appearance/DiceAppearance";
import type { DiceSides } from "./DiceSides";

/** Describes one physical die participating in a roll. */
export interface DiceDefinition {
  readonly sides: DiceSides;
  readonly appearance?: DiceAppearance;
}
