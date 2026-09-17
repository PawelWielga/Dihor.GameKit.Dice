export const SUPPORTED_DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

export type DiceSides = (typeof SUPPORTED_DICE_SIDES)[number];
