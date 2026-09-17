/** Source of normalized random samples used by logical dice rolls. */
export interface RandomProvider {
  /** Returns a finite value in the half-open range [0, 1). */
  next(): number;
}
