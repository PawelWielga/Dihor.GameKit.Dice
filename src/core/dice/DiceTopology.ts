import type { DiceSides } from "../DiceSides.js";
import type { QuaternionLike } from "./D6Faces.js";

export interface DiceVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DiceTopologyFace {
  readonly value: number;
  readonly vertexIndices: readonly number[];
  readonly normal: DiceVector3;
  readonly center: DiceVector3;
}

export type DiceResultDirection = "up" | "down";

export interface DiceTopology {
  readonly sides: DiceSides;
  readonly vertices: readonly DiceVector3[];
  readonly faces: readonly DiceTopologyFace[];
  /** Direction used to read the physical result after the die settles. */
  readonly resultDirection: DiceResultDirection;
}

interface Polyhedron {
  readonly vertices: readonly DiceVector3[];
  readonly faces: readonly (readonly number[])[];
}

const EPSILON = 1e-9;
const topologyCache = new Map<DiceSides, DiceTopology>();

function add(a: DiceVector3, b: DiceVector3): DiceVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: DiceVector3, b: DiceVector3): DiceVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector: DiceVector3, factor: number): DiceVector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function dot(a: DiceVector3, b: DiceVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: DiceVector3, b: DiceVector3): DiceVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function magnitude(vector: DiceVector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: DiceVector3): DiceVector3 {
  const length = magnitude(vector);

  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new RangeError("Dice topology contains a zero-length direction.");
  }

  return scale(vector, 1 / length);
}

function average(vectors: readonly DiceVector3[]): DiceVector3 {
  if (vectors.length === 0) {
    throw new RangeError("Cannot average an empty vertex collection.");
  }

  const sum = vectors.reduce<DiceVector3>((current, vector) => add(current, vector), {
    x: 0,
    y: 0,
    z: 0
  });
  return scale(sum, 1 / vectors.length);
}

function normalizeVertices(vertices: readonly DiceVector3[]): readonly DiceVector3[] {
  const centroid = average(vertices);
  const centered = vertices.map((vertex) => subtract(vertex, centroid));
  const maxExtent = centered.reduce(
    (current, vertex) => Math.max(current, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)),
    0
  );

  if (!Number.isFinite(maxExtent) || maxExtent <= EPSILON) {
    throw new RangeError("Dice topology requires a non-degenerate vertex set.");
  }

  const factor = 0.5 / maxExtent;
  return centered.map((vertex) => scale(vertex, factor));
}

function orientFace(
  vertices: readonly DiceVector3[],
  indices: readonly number[]
): { readonly indices: readonly number[]; readonly normal: DiceVector3; readonly center: DiceVector3 } {
  if (indices.length < 3) {
    throw new RangeError("A dice face requires at least three vertices.");
  }

  const faceVertices = indices.map((index) => {
    const vertex = vertices[index];

    if (!vertex) {
      throw new RangeError(`Dice face references missing vertex ${index}.`);
    }

    return vertex;
  });
  const center = average(faceVertices);
  let normal = normalize(
    cross(subtract(faceVertices[1]!, faceVertices[0]!), subtract(faceVertices[2]!, faceVertices[0]!))
  );
  let orientedIndices = [...indices];

  if (dot(normal, center) < 0) {
    orientedIndices = orientedIndices.reverse();
    normal = scale(normal, -1);
  }

  return { indices: orientedIndices, normal, center };
}

function createPolyhedron(
  rawVertices: readonly DiceVector3[],
  rawFaces: readonly (readonly number[])[]
): Polyhedron {
  const vertices = normalizeVertices(rawVertices);
  const faces = rawFaces.map((indices) => orientFace(vertices, indices).indices);
  return { vertices, faces };
}

function createTopology(
  sides: DiceSides,
  polyhedron: Polyhedron,
  resultDirection: DiceResultDirection = "up"
): DiceTopology {
  if (polyhedron.faces.length !== sides) {
    throw new RangeError(
      `D${sides} topology requires ${sides} faces; received ${polyhedron.faces.length}.`
    );
  }

  const faces = polyhedron.faces.map((indices, index) => {
    const oriented = orientFace(polyhedron.vertices, indices);
    return {
      value: index + 1,
      vertexIndices: oriented.indices,
      normal: oriented.normal,
      center: oriented.center
    } satisfies DiceTopologyFace;
  });

  return Object.freeze({
    sides,
    vertices: Object.freeze(polyhedron.vertices.map((vertex) => Object.freeze({ ...vertex }))),
    faces: Object.freeze(
      faces.map((face) =>
        Object.freeze({
          ...face,
          vertexIndices: Object.freeze([...face.vertexIndices]),
          normal: Object.freeze({ ...face.normal }),
          center: Object.freeze({ ...face.center })
        })
      )
    ),
    resultDirection
  });
}

function createD4(): DiceTopology {
  const vertices: DiceVector3[] = [
    { x: 1, y: 1, z: 1 },
    { x: -1, y: -1, z: 1 },
    { x: -1, y: 1, z: -1 },
    { x: 1, y: -1, z: -1 }
  ];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3]
  ];

  // A tetrahedron settles on a face rather than an opposite parallel face, so its value is read
  // from the physical face touching the table. This gives every D4 value an unambiguous stable state.
  return createTopology(4, createPolyhedron(vertices, faces), "down");
}

function createD6(): DiceTopology {
  const vertices: DiceVector3[] = [
    { x: -1, y: -1, z: -1 },
    { x: 1, y: -1, z: -1 },
    { x: 1, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 },
    { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: -1, y: 1, z: 1 }
  ];

  // Preserve the established PartyBeam D6 mapping: +Y, +Z, +X, -X, -Z, -Y.
  const faces = [
    [3, 2, 6, 7],
    [4, 5, 6, 7],
    [1, 5, 6, 2],
    [0, 3, 7, 4],
    [0, 1, 2, 3],
    [0, 4, 5, 1]
  ];

  return createTopology(6, createPolyhedron(vertices, faces));
}

function createD8(): DiceTopology {
  const vertices: DiceVector3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
  ];
  const faces = [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5]
  ];

  return createTopology(8, createPolyhedron(vertices, faces));
}

function createIcosahedron(): Polyhedron {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices: DiceVector3[] = [
    { x: -1, y: phi, z: 0 },
    { x: 1, y: phi, z: 0 },
    { x: -1, y: -phi, z: 0 },
    { x: 1, y: -phi, z: 0 },
    { x: 0, y: -1, z: phi },
    { x: 0, y: 1, z: phi },
    { x: 0, y: -1, z: -phi },
    { x: 0, y: 1, z: -phi },
    { x: phi, y: 0, z: -1 },
    { x: phi, y: 0, z: 1 },
    { x: -phi, y: 0, z: -1 },
    { x: -phi, y: 0, z: 1 }
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];

  return createPolyhedron(vertices, faces);
}

function orderAroundAxis(
  vertices: readonly DiceVector3[],
  indices: readonly number[],
  axisValue: DiceVector3
): readonly number[] {
  const axis = normalize(axisValue);
  const center = average(indices.map((index) => vertices[index]!));
  const reference = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const horizontal = normalize(cross(reference, axis));
  const vertical = cross(axis, horizontal);

  return [...indices].sort((leftIndex, rightIndex) => {
    const left = subtract(vertices[leftIndex]!, center);
    const right = subtract(vertices[rightIndex]!, center);
    const leftAngle = Math.atan2(dot(left, vertical), dot(left, horizontal));
    const rightAngle = Math.atan2(dot(right, vertical), dot(right, horizontal));
    return leftAngle - rightAngle;
  });
}

/** Creates the geometric dual of a centered convex polyhedron. */
function createDual(source: Polyhedron): Polyhedron {
  const sourceFaces = source.faces.map((indices) => orientFace(source.vertices, indices));
  const dualVertices = sourceFaces.map((face) => {
    const planeDistance = dot(face.normal, face.center);

    if (planeDistance <= EPSILON) {
      throw new RangeError("Cannot dualize a face whose plane crosses the topology origin.");
    }

    return scale(face.normal, 1 / planeDistance);
  });

  const dualFaces = source.vertices.map((vertex, vertexIndex) => {
    const incidentFaces: number[] = [];

    for (let faceIndex = 0; faceIndex < sourceFaces.length; faceIndex += 1) {
      if (sourceFaces[faceIndex]!.indices.includes(vertexIndex)) {
        incidentFaces.push(faceIndex);
      }
    }

    return orderAroundAxis(dualVertices, incidentFaces, vertex);
  });

  return createPolyhedron(dualVertices, dualFaces);
}

function createAntiprism(sides: number): Polyhedron {
  const halfHeight = 0.5;
  const vertices: DiceVector3[] = [];

  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides;
    vertices.push({ x: Math.cos(angle), y: halfHeight, z: Math.sin(angle) });
  }

  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides + Math.PI / sides;
    vertices.push({ x: Math.cos(angle), y: -halfHeight, z: Math.sin(angle) });
  }

  const faces: number[][] = [
    Array.from({ length: sides }, (_, index) => index),
    Array.from({ length: sides }, (_, index) => sides + index)
  ];

  for (let index = 0; index < sides; index += 1) {
    const previous = (index - 1 + sides) % sides;
    const next = (index + 1) % sides;
    faces.push([index, sides + index, sides + previous]);
    faces.push([sides + index, next, index]);
  }

  return createPolyhedron(vertices, faces);
}

function createD10(): DiceTopology {
  // The dual of a pentagonal antiprism is a ten-faced trapezohedron, matching the familiar D10 form.
  return createTopology(10, createDual(createAntiprism(5)));
}

function createD12(): DiceTopology {
  // A dodecahedron is the dual of the icosahedron used for D20.
  return createTopology(12, createDual(createIcosahedron()));
}

function createD20(): DiceTopology {
  return createTopology(20, createIcosahedron());
}

function createD100(): DiceTopology {
  const ringSides = 50;
  const vertices: DiceVector3[] = [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }
  ];

  for (let index = 0; index < ringSides; index += 1) {
    const angle = (2 * Math.PI * index) / ringSides;
    vertices.push({ x: Math.cos(angle), y: 0, z: Math.sin(angle) });
  }

  const faces: number[][] = [];

  for (let index = 0; index < ringSides; index += 1) {
    const next = (index + 1) % ringSides;
    faces.push([0, 2 + index, 2 + next]);
    faces.push([1, 2 + next, 2 + index]);
  }

  return createTopology(100, createPolyhedron(vertices, faces));
}

function buildTopology(sides: DiceSides): DiceTopology {
  switch (sides) {
    case 4:
      return createD4();
    case 6:
      return createD6();
    case 8:
      return createD8();
    case 10:
      return createD10();
    case 12:
      return createD12();
    case 20:
      return createD20();
    case 100:
      return createD100();
  }
}

export function getDiceTopology(sides: DiceSides): DiceTopology {
  const cached = topologyCache.get(sides);

  if (cached) {
    return cached;
  }

  const topology = buildTopology(sides);
  topologyCache.set(sides, topology);
  return topology;
}

export function getDiceFace(sides: DiceSides, value: number): DiceTopologyFace {
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new RangeError(`D${sides} value must be an integer in 1..${sides}; received ${String(value)}.`);
  }

  const face = getDiceTopology(sides).faces[value - 1];

  if (!face) {
    throw new RangeError(`D${sides} topology does not contain value ${value}.`);
  }

  return face;
}

/** Reads a die value from its final physical orientation. */
export function getDiceValueFromOrientation(sides: DiceSides, quaternion: QuaternionLike): number {
  const magnitudeValue = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(magnitudeValue) || magnitudeValue <= Number.EPSILON) {
    throw new RangeError(`D${sides} orientation requires a finite, non-zero quaternion.`);
  }

  const x = quaternion.x / magnitudeValue;
  const y = quaternion.y / magnitudeValue;
  const z = quaternion.z / magnitudeValue;
  const w = quaternion.w / magnitudeValue;
  const rotationRowY = {
    x: 2 * (x * y + w * z),
    y: 1 - 2 * (x * x + z * z),
    z: 2 * (y * z - w * x)
  };
  const topology = getDiceTopology(sides);
  const directionFactor = topology.resultDirection === "up" ? 1 : -1;
  let bestValue = 1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const face of topology.faces) {
    const worldY =
      rotationRowY.x * face.normal.x +
      rotationRowY.y * face.normal.y +
      rotationRowY.z * face.normal.z;
    const score = worldY * directionFactor;

    if (score > bestScore) {
      bestScore = score;
      bestValue = face.value;
    }
  }

  return bestValue;
}
