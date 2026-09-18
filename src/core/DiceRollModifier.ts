/** Resolves the optional roll modifier using the shared logical-roll validation rules. */
export function resolveDiceRollModifier(modifier: number | undefined): number {
  const resolved = modifier ?? 0;

  if (!Number.isFinite(resolved)) {
    throw new RangeError(`Dice roll modifier must be finite; received ${String(resolved)}.`);
  }

  return resolved;
}
