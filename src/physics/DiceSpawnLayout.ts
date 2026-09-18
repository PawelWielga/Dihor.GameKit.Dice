import { getDiceTopology, type DiceSides } from "../core/index.js";
import type { DiceArenaBoundaryPoint, DicePhysicsConfig } from "./RollModels.js";

export interface DiceSpawnPoint {
  readonly x: number;
  readonly z: number;
}

export interface DiceSpawnLayoutOptions {
  readonly desiredSpacing: number;
  readonly customSpacing: boolean;
}

const WALL_THICKNESS_RATIO = 0.25;
const SPAWN_CLEARANCE_RATIO = 0.02;
const MINIMUM_INTER_DIE_GAP_RATIO = 0.05;
const FIT_EPSILON = 1e-7;

function requirePositiveFinite(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(name + " must be a positive finite number; received " + String(value) + ".");
  }

  return value;
}

function createSquareBoundary(extent: number): readonly DiceArenaBoundaryPoint[] {
  return [
    { x: -extent, z: -extent },
    { x: extent, z: -extent },
    { x: extent, z: extent },
    { x: -extent, z: extent }
  ];
}

function signedArea(boundary: readonly DiceArenaBoundaryPoint[]): number {
  let area = 0;

  for (let index = 0; index < boundary.length; index += 1) {
    const current = boundary[index]!;
    const next = boundary[(index + 1) % boundary.length]!;
    area += current.x * next.z - next.x * current.z;
  }

  return area / 2;
}

function validateConvexBoundary(boundary: readonly DiceArenaBoundaryPoint[]): number {
  if (boundary.length < 3) {
    throw new RangeError("arenaBoundary must contain at least three points.");
  }

  const area = signedArea(boundary);
  if (!Number.isFinite(area) || Math.abs(area) <= FIT_EPSILON) {
    throw new RangeError("arenaBoundary must enclose a non-zero area.");
  }

  const winding = Math.sign(area);
  let observedTurn = 0;

  for (let index = 0; index < boundary.length; index += 1) {
    const a = boundary[index]!;
    const b = boundary[(index + 1) % boundary.length]!;
    const c = boundary[(index + 2) % boundary.length]!;
    const abX = b.x - a.x;
    const abZ = b.z - a.z;
    const bcX = c.x - b.x;
    const bcZ = c.z - b.z;
    const cross = abX * bcZ - abZ * bcX;

    if (Math.abs(cross) <= FIT_EPSILON) {
      continue;
    }

    const turn = Math.sign(cross);
    if (observedTurn === 0) {
      observedTurn = turn;
    } else if (turn !== observedTurn) {
      throw new RangeError(
        "arenaBoundary must be convex for automatic dice spawn placement."
      );
    }
  }

  if (observedTurn !== 0 && observedTurn !== winding) {
    throw new RangeError("arenaBoundary winding is inconsistent.");
  }

  return winding;
}

function polygonCenter(boundary: readonly DiceArenaBoundaryPoint[]): DiceSpawnPoint {
  const sum = boundary.reduce(
    (current, point) => ({ x: current.x + point.x, z: current.z + point.z }),
    { x: 0, z: 0 }
  );

  return {
    x: sum.x / boundary.length,
    z: sum.z / boundary.length
  };
}

function dieBoundingRadius(sides: DiceSides, diceSize: number): number {
  const topology = getDiceTopology(sides);
  return (
    Math.max(
      ...topology.vertices.map((vertex) => Math.hypot(vertex.x, vertex.y, vertex.z))
    ) * diceSize
  );
}

function isPointClear(
  point: DiceSpawnPoint,
  boundary: readonly DiceArenaBoundaryPoint[],
  winding: number,
  clearance: number
): boolean {
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!;
    const end = boundary[(index + 1) % boundary.length]!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);

    if (length <= FIT_EPSILON) {
      throw new RangeError("arenaBoundary edge " + index + " must have non-zero length.");
    }

    const inwardX = winding > 0 ? -dz / length : dz / length;
    const inwardZ = winding > 0 ? dx / length : -dx / length;
    const distance =
      (point.x - start.x) * inwardX +
      (point.z - start.z) * inwardZ;

    if (distance + FIT_EPSILON < clearance) {
      return false;
    }
  }

  return true;
}

function createGrid(
  count: number,
  columns: number,
  spacing: number,
  center: DiceSpawnPoint
): readonly DiceSpawnPoint[] {
  const rows = Math.ceil(count / columns);
  const points: DiceSpawnPoint[] = [];
  let remaining = count;

  for (let row = 0; row < rows; row += 1) {
    const rowCount = Math.min(columns, remaining);
    const z = center.z + (row - (rows - 1) / 2) * spacing;

    for (let column = 0; column < rowCount; column += 1) {
      points.push({
        x: center.x + (column - (rowCount - 1) / 2) * spacing,
        z
      });
    }

    remaining -= rowCount;
  }

  return points;
}

function preferredColumnCounts(count: number): readonly number[] {
  if (count <= 4) {
    return Array.from({ length: count }, (_, index) => count - index);
  }

  const preferred = Math.ceil(count / 2);
  return [
    preferred,
    ...Array.from({ length: count }, (_, index) => count - index).filter(
      (columns) => columns !== preferred
    )
  ];
}

function layoutFits(
  points: readonly DiceSpawnPoint[],
  boundary: readonly DiceArenaBoundaryPoint[],
  winding: number,
  clearance: number
): boolean {
  return points.every((point) => isPointClear(point, boundary, winding, clearance));
}

/**
 * Resolves centered spawn slots that keep the full die collider clear of every physical arena wall.
 * Default spacing may be reduced when needed; an explicit custom spacing is either preserved
 * exactly or rejected with a clear error.
 */
export function resolveDiceSpawnLayout(
  sides: readonly DiceSides[],
  physics: DicePhysicsConfig,
  options: DiceSpawnLayoutOptions
): readonly DiceSpawnPoint[] {
  if (sides.length === 0) {
    return [];
  }

  const desiredSpacing = requirePositiveFinite("desiredSpacing", options.desiredSpacing);
  const boundary =
    physics.arenaBoundary ?? createSquareBoundary(physics.arenaHalfExtent);
  const winding = validateConvexBoundary(boundary);
  const center = polygonCenter(boundary);
  const maximumRadius = Math.max(
    ...sides.map((dieSides) => dieBoundingRadius(dieSides, physics.diceSize))
  );
  const wallHalfThickness = physics.diceSize * WALL_THICKNESS_RATIO / 2;
  const clearance =
    maximumRadius +
    wallHalfThickness +
    physics.diceSize * SPAWN_CLEARANCE_RATIO;
  const minimumSpacing =
    maximumRadius * 2 +
    physics.diceSize * MINIMUM_INTER_DIE_GAP_RATIO;
  const columns = preferredColumnCounts(sides.length);

  if (sides.length === 1) {
    if (!isPointClear(center, boundary, winding, clearance)) {
      throw new RangeError(
        "The configured arena is too small to place even one die without intersecting a wall."
      );
    }

    return [center];
  }

  if (options.customSpacing && desiredSpacing + FIT_EPSILON < minimumSpacing) {
    throw new RangeError(
      "slotSpacing " + desiredSpacing + " is too small for dice of size " + physics.diceSize +
      "; at least " + minimumSpacing + " is required to avoid initial overlap."
    );
  }

  for (const columnCount of columns) {
    const points = createGrid(sides.length, columnCount, desiredSpacing, center);
    if (layoutFits(points, boundary, winding, clearance)) {
      return points;
    }
  }

  if (options.customSpacing) {
    throw new RangeError(
      "slotSpacing " + desiredSpacing + " does not fit " + sides.length +
      " dice inside the configured arena."
    );
  }

  if (minimumSpacing > desiredSpacing + FIT_EPSILON) {
    throw new RangeError(
      "The configured arena is too small for the requested dice without initial overlap."
    );
  }

  let best: readonly DiceSpawnPoint[] | undefined;
  let bestSpacing = Number.NEGATIVE_INFINITY;

  for (const columnCount of columns) {
    const minimumPoints = createGrid(sides.length, columnCount, minimumSpacing, center);
    if (!layoutFits(minimumPoints, boundary, winding, clearance)) {
      continue;
    }

    let low = minimumSpacing;
    let high = desiredSpacing;

    for (let iteration = 0; iteration < 18; iteration += 1) {
      const candidate = (low + high) / 2;
      const points = createGrid(sides.length, columnCount, candidate, center);

      if (layoutFits(points, boundary, winding, clearance)) {
        low = candidate;
      } else {
        high = candidate;
      }
    }

    if (low > bestSpacing) {
      bestSpacing = low;
      best = createGrid(sides.length, columnCount, low, center);
    }
  }

  if (!best) {
    throw new RangeError(
      "The configured arena is too small to place " + sides.length +
      " dice without intersecting walls."
    );
  }

  return best;
}
