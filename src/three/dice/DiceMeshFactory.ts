import {
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  hasDiceTextureSources,
  resolveDiceAppearance,
  type DiceAppearance,
  type ResolvedDiceAppearance
} from "../../appearance/index.js";
import {
  D6_FACE_NORMALS,
  D6_FACE_VALUES,
  getDiceTopology,
  type D6FaceValue,
  type DiceSides,
  type DiceTopology,
  type DiceTopologyFace
} from "../../core/index.js";
import {
  DiceTextureCache,
  type DiceTextureLease,
  type DiceTextureLoader
} from "./DiceTextureCache.js";

export interface DiceMeshOptions {
  readonly size?: number;
  readonly appearance?: DiceAppearance;
}

/** Kept as an alias so existing D6 consumers do not need a breaking change. */
export type D6MeshOptions = DiceMeshOptions;

export interface DiceMeshFactoryOptions {
  /** Advanced hook useful for custom asset pipelines and tests. */
  readonly textureLoader?: DiceTextureLoader;
}

export interface DiceMesh {
  readonly sides: DiceSides;
  readonly object: Group;
  readonly body: Mesh;
  dispose(): void;
}

interface DiceTextureResources {
  readonly body?: DiceTextureLease;
  readonly normal?: DiceTextureLease;
  readonly roughness?: DiceTextureLease;
  readonly faces: ReadonlyMap<number, DiceTextureLease>;
  readonly leases: readonly DiceTextureLease[];
}

interface FaceBasis {
  readonly normal: Vector3;
  readonly horizontal: Vector3;
  readonly vertical: Vector3;
  readonly center: Vector3;
}

interface RoundedEdge {
  readonly vertexA: number;
  readonly vertexB: number;
  readonly faces: DiceTopologyFace[];
}

interface RoundedSample {
  readonly position: Vector3;
  readonly normal: Vector3;
}

const PIP_LAYOUTS: Readonly<Record<D6FaceValue, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [-1, 0], [-1, -1], [1, 1], [1, 0], [1, -1]]
};

const DIGIT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "c", "d", "g"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"]
};

function validateSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`Dice size must be a positive finite number; received ${String(size)}.`);
  }

  return size;
}

function faceBasis(face: DiceTopologyFace, size: number): FaceBasis {
  const normal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();
  const center = new Vector3(face.center.x * size, face.center.y * size, face.center.z * size);
  const reference = Math.abs(normal.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const horizontal = new Vector3().crossVectors(reference, normal).normalize();
  const vertical = new Vector3().crossVectors(normal, horizontal).normalize();
  return { normal, horizontal, vertical, center };
}

function createSoftenedVertexNormals(topology: DiceTopology): readonly Vector3[] {
  const normals = topology.vertices.map(() => new Vector3());

  for (const face of topology.faces) {
    const faceNormal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();

    for (const vertexIndex of face.vertexIndices) {
      normals[vertexIndex]?.add(faceNormal);
    }
  }

  return normals.map((normal) => normal.normalize());
}

function createTopologyGeometry(
  topology: DiceTopology,
  size: number,
  values?: ReadonlySet<number>,
  surfaceOffset = 0,
  edgeSoftness = 0
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const softenedVertexNormals = edgeSoftness > 0
    ? createSoftenedVertexNormals(topology)
    : undefined;

  for (const face of topology.faces) {
    if (values && !values.has(face.value)) {
      continue;
    }

    const basis = faceBasis(face, size);
    const vertices = face.vertexIndices.map((index) => {
      const vertex = topology.vertices[index];

      if (!vertex) {
        throw new RangeError(`D${topology.sides} face ${face.value} references missing vertex ${index}.`);
      }

      return new Vector3(vertex.x * size, vertex.y * size, vertex.z * size)
        .addScaledVector(basis.normal, surfaceOffset);
    });
    const projected = vertices.map((vertex) => {
      const relative = vertex.clone().sub(basis.center);
      return {
        x: relative.dot(basis.horizontal),
        y: relative.dot(basis.vertical)
      };
    });
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    const width = Math.max(maxX - minX, Number.EPSILON);
    const height = Math.max(maxY - minY, Number.EPSILON);

    for (let triangle = 1; triangle < vertices.length - 1; triangle += 1) {
      for (const localIndex of [0, triangle, triangle + 1]) {
        const vertex = vertices[localIndex]!;
        const point = projected[localIndex]!;
        const topologyVertexIndex = face.vertexIndices[localIndex]!;
        const softenedNormal = softenedVertexNormals?.[topologyVertexIndex];
        const renderNormal = softenedNormal
          ? basis.normal.clone().lerp(softenedNormal, edgeSoftness).normalize()
          : basis.normal;
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(renderNormal.x, renderNormal.y, renderNormal.z);
        uvs.push((point.x - minX) / width, (point.y - minY) / height);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function roundedPolyhedronProfile(sides: Exclude<DiceSides, 6>): {
  readonly bevelRatio: number;
  readonly segments: number;
} {
  switch (sides) {
    case 4:
      return { bevelRatio: 0.22, segments: 6 };
    case 8:
      return { bevelRatio: 0.24, segments: 6 };
    case 10:
      return { bevelRatio: 0.2, segments: 6 };
    case 12:
      return { bevelRatio: 0.18, segments: 6 };
    case 20:
      return { bevelRatio: 0.16, segments: 6 };
    case 100:
      return { bevelRatio: 0.075, segments: 4 };
  }
}

function quadraticBezier(start: Vector3, control: Vector3, end: Vector3, t: number): Vector3 {
  const inverse = 1 - t;
  return start.clone()
    .multiplyScalar(inverse * inverse)
    .addScaledVector(control, 2 * inverse * t)
    .addScaledVector(end, t * t);
}

function appendOrientedTriangle(
  positions: number[],
  normals: number[],
  uvs: number[],
  points: readonly [Vector3, Vector3, Vector3],
  vertexNormals: readonly [Vector3, Vector3, Vector3],
  vertexUvs: readonly [readonly [number, number], readonly [number, number], readonly [number, number]],
  expectedNormal: Vector3
): void {
  const firstEdge = points[1].clone().sub(points[0]);
  const secondEdge = points[2].clone().sub(points[0]);
  const windingNormal = new Vector3().crossVectors(firstEdge, secondEdge);
  const order = windingNormal.dot(expectedNormal) >= 0
    ? [0, 1, 2] as const
    : [0, 2, 1] as const;

  for (const index of order) {
    const point = points[index];
    const normal = vertexNormals[index];
    const uv = vertexUvs[index];
    positions.push(point.x, point.y, point.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(uv[0], uv[1]);
  }
}

function createRoundedPolyhedralBodyGeometry(
  topology: DiceTopology,
  sides: Exclude<DiceSides, 6>,
  size: number
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const { bevelRatio, segments } = roundedPolyhedronProfile(sides);
  const softenedVertexNormals = createSoftenedVertexNormals(topology);
  const insetByFace = new Map<number, Map<number, Vector3>>();
  const edges = new Map<string, RoundedEdge>();

  for (const face of topology.faces) {
    const basis = faceBasis(face, size);
    const faceInsets = new Map<number, Vector3>();
    const originalVertices = face.vertexIndices.map((index) => {
      const vertex = topology.vertices[index];

      if (!vertex) {
        throw new RangeError(`D${topology.sides} face ${face.value} references missing vertex ${index}.`);
      }

      return new Vector3(vertex.x * size, vertex.y * size, vertex.z * size);
    });
    const insetVertices = originalVertices.map((vertex, localIndex) => {
      const inset = vertex.clone().lerp(basis.center, bevelRatio);
      faceInsets.set(face.vertexIndices[localIndex]!, inset);
      return inset;
    });
    insetByFace.set(face.value, faceInsets);

    const projected = insetVertices.map((vertex) => {
      const relative = vertex.clone().sub(basis.center);
      return {
        x: relative.dot(basis.horizontal),
        y: relative.dot(basis.vertical)
      };
    });
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    const width = Math.max(maxX - minX, Number.EPSILON);
    const height = Math.max(maxY - minY, Number.EPSILON);

    for (let triangle = 1; triangle < insetVertices.length - 1; triangle += 1) {
      for (const localIndex of [0, triangle, triangle + 1]) {
        const vertex = insetVertices[localIndex]!;
        const point = projected[localIndex]!;
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(basis.normal.x, basis.normal.y, basis.normal.z);
        uvs.push((point.x - minX) / width, (point.y - minY) / height);
      }
    }

    for (let index = 0; index < face.vertexIndices.length; index += 1) {
      const first = face.vertexIndices[index]!;
      const second = face.vertexIndices[(index + 1) % face.vertexIndices.length]!;
      const vertexA = Math.min(first, second);
      const vertexB = Math.max(first, second);
      const key = `${vertexA}:${vertexB}`;
      const existing = edges.get(key);

      if (existing) {
        existing.faces.push(face);
      } else {
        edges.set(key, { vertexA, vertexB, faces: [face] });
      }
    }
  }

  const capSections = new Map<number, RoundedSample[][]>();

  for (const edge of edges.values()) {
    if (edge.faces.length !== 2) {
      continue;
    }

    const [faceA, faceB] = edge.faces;
    if (!faceA || !faceB) {
      continue;
    }

    const faceAInsets = insetByFace.get(faceA.value);
    const faceBInsets = insetByFace.get(faceB.value);
    const insetA0 = faceAInsets?.get(edge.vertexA);
    const insetA1 = faceAInsets?.get(edge.vertexB);
    const insetB0 = faceBInsets?.get(edge.vertexA);
    const insetB1 = faceBInsets?.get(edge.vertexB);
    const topologyVertexA = topology.vertices[edge.vertexA];
    const topologyVertexB = topology.vertices[edge.vertexB];

    if (!insetA0 || !insetA1 || !insetB0 || !insetB1 || !topologyVertexA || !topologyVertexB) {
      continue;
    }

    const originalA = new Vector3(topologyVertexA.x * size, topologyVertexA.y * size, topologyVertexA.z * size);
    const originalB = new Vector3(topologyVertexB.x * size, topologyVertexB.y * size, topologyVertexB.z * size);
    const normalA = new Vector3(faceA.normal.x, faceA.normal.y, faceA.normal.z).normalize();
    const normalB = new Vector3(faceB.normal.x, faceB.normal.y, faceB.normal.z).normalize();
    const samplesA: RoundedSample[] = [];
    const samplesB: RoundedSample[] = [];

    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const normal = normalA.clone().lerp(normalB, t).normalize();
      samplesA.push({
        position: quadraticBezier(insetA0, originalA, insetB0, t),
        normal
      });
      samplesB.push({
        position: quadraticBezier(insetA1, originalB, insetB1, t),
        normal: normal.clone()
      });
    }

    for (let step = 0; step < segments; step += 1) {
      const a0 = samplesA[step]!;
      const b0 = samplesB[step]!;
      const a1 = samplesA[step + 1]!;
      const b1 = samplesB[step + 1]!;
      const expectedNormal = a0.normal.clone().add(a1.normal).add(b0.normal).add(b1.normal).normalize();
      const v0 = step / segments;
      const v1 = (step + 1) / segments;

      appendOrientedTriangle(
        positions,
        normals,
        uvs,
        [a0.position, b0.position, b1.position],
        [a0.normal, b0.normal, b1.normal],
        [[0, v0], [1, v0], [1, v1]],
        expectedNormal
      );
      appendOrientedTriangle(
        positions,
        normals,
        uvs,
        [a0.position, b1.position, a1.position],
        [a0.normal, b1.normal, a1.normal],
        [[0, v0], [1, v1], [0, v1]],
        expectedNormal
      );
    }

    const capA = capSections.get(edge.vertexA) ?? [];
    capA.push(samplesA);
    capSections.set(edge.vertexA, capA);
    const capB = capSections.get(edge.vertexB) ?? [];
    capB.push(samplesB);
    capSections.set(edge.vertexB, capB);
  }

  for (const [vertexIndex, sections] of capSections) {
    const topologyVertex = topology.vertices[vertexIndex];
    const vertexNormal = softenedVertexNormals[vertexIndex];

    if (!topologyVertex || !vertexNormal) {
      continue;
    }

    const original = new Vector3(topologyVertex.x * size, topologyVertex.y * size, topologyVertex.z * size);
    const center = original.clone().multiplyScalar(1 - bevelRatio * 0.42);

    for (const section of sections) {
      for (let step = 0; step < section.length - 1; step += 1) {
        const first = section[step]!;
        const second = section[step + 1]!;
        const expectedNormal = vertexNormal.clone().add(first.normal).add(second.normal).normalize();

        appendOrientedTriangle(
          positions,
          normals,
          uvs,
          [center, first.position, second.position],
          [vertexNormal, first.normal, second.normal],
          [[0.5, 0.5], [0, step / segments], [1, (step + 1) / segments]],
          expectedNormal
        );
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function pushQuad(
  positions: number[],
  normals: number[],
  basis: FaceBasis,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  surfaceOffset: number
): void {
  const corners: readonly (readonly [number, number])[] = [
    [-width / 2, height / 2],
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2]
  ];
  const points = corners.map(([x, y]) =>
    basis.center
      .clone()
      .addScaledVector(basis.horizontal, centerX + x)
      .addScaledVector(basis.vertical, centerY + y)
      .addScaledVector(basis.normal, surfaceOffset)
  );

  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = points[index]!;
    positions.push(point.x, point.y, point.z);
    normals.push(basis.normal.x, basis.normal.y, basis.normal.z);
  }
}

function addDigitSegments(
  positions: number[],
  normals: number[],
  basis: FaceBasis,
  digit: string,
  centerX: number,
  unit: number,
  surfaceOffset: number
): void {
  const segments = DIGIT_SEGMENTS[digit] ?? [];
  const digitWidth = unit;
  const digitHeight = unit * 1.58;
  const thickness = unit * 0.2;
  const horizontalWidth = digitWidth * 0.78;
  const verticalHeight = digitHeight * 0.43;
  const glyphCenterX = digit === "1" ? centerX - digitWidth * 0.38 : centerX;

  for (const segment of segments) {
    switch (segment) {
      case "a":
        pushQuad(positions, normals, basis, glyphCenterX, digitHeight / 2, horizontalWidth, thickness, surfaceOffset);
        break;
      case "g":
        pushQuad(positions, normals, basis, glyphCenterX, 0, horizontalWidth, thickness, surfaceOffset);
        break;
      case "d":
        pushQuad(positions, normals, basis, glyphCenterX, -digitHeight / 2, horizontalWidth, thickness, surfaceOffset);
        break;
      case "f":
        pushQuad(positions, normals, basis, glyphCenterX - digitWidth * 0.38, digitHeight * 0.25, thickness, verticalHeight, surfaceOffset);
        break;
      case "b":
        pushQuad(positions, normals, basis, glyphCenterX + digitWidth * 0.38, digitHeight * 0.25, thickness, verticalHeight, surfaceOffset);
        break;
      case "e":
        pushQuad(positions, normals, basis, glyphCenterX - digitWidth * 0.38, -digitHeight * 0.25, thickness, verticalHeight, surfaceOffset);
        break;
      case "c":
        pushQuad(positions, normals, basis, glyphCenterX + digitWidth * 0.38, -digitHeight * 0.25, thickness, verticalHeight, surfaceOffset);
        break;
    }
  }
}

function createNumericMarkingsGeometry(
  topology: DiceTopology,
  size: number,
  texturedValues: ReadonlySet<number>
): BufferGeometry | undefined {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const face of topology.faces) {
    if (texturedValues.has(face.value)) {
      continue;
    }

    const basis = faceBasis(face, size);
    const localPoints = face.vertexIndices.map((index) => {
      const vertex = topology.vertices[index]!;
      const relative = new Vector3(vertex.x * size, vertex.y * size, vertex.z * size).sub(basis.center);
      return {
        x: relative.dot(basis.horizontal),
        y: relative.dot(basis.vertical)
      };
    });
    const width = Math.max(...localPoints.map((point) => point.x)) - Math.min(...localPoints.map((point) => point.x));
    const height = Math.max(...localPoints.map((point) => point.y)) - Math.min(...localPoints.map((point) => point.y));
    const digits = String(face.value);
    const availableUnit = Math.min(
      width / Math.max(digits.length * 1.28, 1),
      height / 1.9
    );
    const unit = availableUnit * (topology.sides >= 100 ? 0.46 : 0.52);

    if (!Number.isFinite(unit) || unit <= Number.EPSILON) {
      continue;
    }

    const gap = unit * 0.12;
    const totalWidth = digits.length * unit + Math.max(0, digits.length - 1) * gap;
    const startX = -totalWidth / 2 + unit / 2;

    for (let index = 0; index < digits.length; index += 1) {
      addDigitSegments(
        positions,
        normals,
        basis,
        digits[index]!,
        startX + index * (unit + gap),
        unit,
        size * 0.007
      );
    }
  }

  if (positions.length === 0) {
    return undefined;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return geometry;
}

/** Factory for render meshes. All standard dice use project-owned geometry and shared topology data. */
export class DiceMeshFactory {
  private readonly textureCache: DiceTextureCache;
  private disposed = false;

  constructor(options: DiceMeshFactoryOptions = {}) {
    this.textureCache = new DiceTextureCache(options.textureLoader);
  }

  create(sides: DiceSides, options: DiceMeshOptions = {}): DiceMesh {
    this.assertActive();
    const size = validateSize(options.size ?? 1);
    const appearance = resolveDiceAppearance(options.appearance);

    return sides === 6
      ? this.buildD6(size, appearance, options.appearance)
      : this.buildPolyhedral(sides, size, appearance, options.appearance);
  }

  async createAsync(sides: DiceSides, options: DiceMeshOptions = {}): Promise<DiceMesh> {
    this.assertActive();
    const size = validateSize(options.size ?? 1);
    const appearance = resolveDiceAppearance(options.appearance);

    if (!hasDiceTextureSources(options.appearance)) {
      return sides === 6
        ? this.buildD6(size, appearance, options.appearance)
        : this.buildPolyhedral(sides, size, appearance, options.appearance);
    }

    const textures = await this.loadTextures(sides, options.appearance);

    try {
      this.assertActive();
      return sides === 6
        ? this.buildD6(size, appearance, options.appearance, textures)
        : this.buildPolyhedral(sides, size, appearance, options.appearance, textures);
    } catch (error) {
      for (const lease of textures.leases ?? []) {
        lease.release();
      }

      throw error;
    }
  }

  createD6(options: D6MeshOptions = {}): DiceMesh {
    return this.create(6, options);
  }

  async createD6Async(options: D6MeshOptions = {}): Promise<DiceMesh> {
    return this.createAsync(6, options);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.textureCache.dispose();
  }

  private async loadTextures(
    sides: DiceSides,
    appearance: DiceAppearance | undefined
  ): Promise<DiceTextureResources> {
    const requestedFaces = Object.entries(appearance?.faces ?? {})
      .map(([value, source]) => [Number(value), source] as const)
      .filter(([value, source]) =>
        Number.isInteger(value) && value >= 1 && value <= sides && typeof source === "string" && source.trim().length > 0
      );
    const [body, normal, roughness, faceEntries] = await Promise.all([
      this.textureCache.acquire(appearance?.texture, "color"),
      this.textureCache.acquire(appearance?.normalMap, "data"),
      this.textureCache.acquire(appearance?.roughnessMap, "data"),
      Promise.all(
        requestedFaces.map(async ([value, source]) => {
          const lease = await this.textureCache.acquire(source, "color");
          return [value, lease] as const;
        })
      )
    ]);

    const faces = new Map<number, DiceTextureLease>();
    const leases: DiceTextureLease[] = [];

    for (const lease of [body, normal, roughness]) {
      if (lease) {
        leases.push(lease);
      }
    }

    for (const [value, lease] of faceEntries) {
      if (lease) {
        faces.set(value, lease);
        leases.push(lease);
      }
    }

    return { body, normal, roughness, faces, leases };
  }

  private buildD6(
    size: number,
    appearance: ResolvedDiceAppearance,
    requestedAppearance: DiceAppearance | undefined,
    textures?: DiceTextureResources
  ): DiceMesh {
    const halfSize = size / 2;
    const bodyGeometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.12);
    const bodyMaterial = new MeshStandardMaterial({
      color:
        textures?.body && requestedAppearance?.color === undefined
          ? "#ffffff"
          : appearance.color,
      map: textures?.body?.texture,
      normalMap: textures?.normal?.texture,
      roughnessMap: textures?.roughness?.texture,
      metalness: appearance.metalness,
      roughness: appearance.roughness
    });
    const pipGeometry = new CircleGeometry(size * 0.055, 16);
    const pipMaterial = new MeshStandardMaterial({
      color: appearance.markingsColor,
      metalness: 0,
      roughness: 0.82
    });
    const faceTextureGeometry = textures?.faces.size
      ? new PlaneGeometry(size * 0.72, size * 0.72)
      : undefined;
    const faceTextureMaterials: MeshStandardMaterial[] = [];

    const object = new Group();
    object.name = "PartyBeam.DiceKit D6";

    const body = new Mesh(bodyGeometry, bodyMaterial);
    body.name = "D6 body";
    body.castShadow = true;
    body.receiveShadow = true;
    object.add(body);

    const pipSpacing = size * 0.22;
    const pipSurfaceDistance = halfSize + size * 0.004;
    const textureSurfaceDistance = halfSize + size * 0.007;

    for (const value of D6_FACE_VALUES) {
      const face = D6_FACE_NORMALS[value];
      const normal = new Vector3(face.x, face.y, face.z);
      const reference = Math.abs(normal.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      const horizontal = new Vector3().crossVectors(reference, normal).normalize();
      const vertical = new Vector3().crossVectors(normal, horizontal).normalize();
      const faceRotation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(horizontal, vertical, normal)
      );
      const faceTexture = textures?.faces.get(value);

      if (faceTexture && faceTextureGeometry) {
        const faceMaterial = new MeshStandardMaterial({
          color: "#ffffff",
          map: faceTexture.texture,
          metalness: appearance.metalness,
          roughness: appearance.roughness,
          transparent: true,
          alphaTest: 0.01
        });
        faceTextureMaterials.push(faceMaterial);

        const texturedFace = new Mesh(faceTextureGeometry, faceMaterial);
        texturedFace.name = `D6 face texture ${value}`;
        texturedFace.position.copy(normal).multiplyScalar(textureSurfaceDistance);
        texturedFace.quaternion.copy(faceRotation);
        object.add(texturedFace);
        continue;
      }

      for (const [horizontalOffset, verticalOffset] of PIP_LAYOUTS[value]) {
        const pip = new Mesh(pipGeometry, pipMaterial);
        pip.name = `D6 pip ${value}`;
        pip.position
          .copy(normal)
          .multiplyScalar(pipSurfaceDistance)
          .addScaledVector(horizontal, horizontalOffset * pipSpacing)
          .addScaledVector(vertical, verticalOffset * pipSpacing);
        pip.quaternion.copy(faceRotation);
        object.add(pip);
      }
    }

    let disposed = false;

    return {
      sides: 6,
      object,
      body,
      dispose() {
        if (disposed) {
          return;
        }

        disposed = true;
        object.clear();
        bodyGeometry.dispose();
        bodyMaterial.dispose();
        pipGeometry.dispose();
        pipMaterial.dispose();
        faceTextureGeometry?.dispose();

        for (const material of faceTextureMaterials) {
          material.dispose();
        }

        for (const lease of textures?.leases ?? []) {
          lease.release();
        }
      }
    };
  }

  private buildPolyhedral(
    sides: Exclude<DiceSides, 6>,
    size: number,
    appearance: ResolvedDiceAppearance,
    requestedAppearance: DiceAppearance | undefined,
    textures?: DiceTextureResources
  ): DiceMesh {
    const topology = getDiceTopology(sides);
    const bodyGeometry = createRoundedPolyhedralBodyGeometry(topology, sides, size);
    const bodyMaterial = new MeshStandardMaterial({
      color:
        textures?.body && requestedAppearance?.color === undefined
          ? "#ffffff"
          : appearance.color,
      map: textures?.body?.texture,
      normalMap: textures?.normal?.texture,
      roughnessMap: textures?.roughness?.texture,
      metalness: appearance.metalness,
      roughness: appearance.roughness,
      flatShading: false
    });
    const object = new Group();
    object.name = `PartyBeam.DiceKit D${sides}`;
    const body = new Mesh(bodyGeometry, bodyMaterial);
    body.name = `D${sides} body`;
    body.castShadow = true;
    body.receiveShadow = true;
    object.add(body);

    const faceTextureGeometries: BufferGeometry[] = [];
    const faceTextureMaterials: MeshStandardMaterial[] = [];
    const texturedValues = new Set(textures?.faces.keys() ?? []);

    for (const [value, lease] of textures?.faces ?? []) {
      const geometry = createTopologyGeometry(topology, size, new Set([value]), size * 0.008, 0.72);
      const material = new MeshStandardMaterial({
        color: "#ffffff",
        map: lease.texture,
        metalness: appearance.metalness,
        roughness: appearance.roughness,
        transparent: true,
        alphaTest: 0.01,
        flatShading: false
      });
      const faceMesh = new Mesh(geometry, material);
      faceMesh.name = `D${sides} face texture ${value}`;
      object.add(faceMesh);
      faceTextureGeometries.push(geometry);
      faceTextureMaterials.push(material);
    }

    const markingsGeometry = createNumericMarkingsGeometry(topology, size, texturedValues);
    const markingsMaterial = markingsGeometry
      ? new MeshStandardMaterial({
          color: appearance.markingsColor,
          metalness: 0,
          roughness: 0.82,
          flatShading: true
        })
      : undefined;

    if (markingsGeometry && markingsMaterial) {
      const markings = new Mesh(markingsGeometry, markingsMaterial);
      markings.name = `D${sides} numeric markings`;
      object.add(markings);
    }

    let disposed = false;

    return {
      sides,
      object,
      body,
      dispose() {
        if (disposed) {
          return;
        }

        disposed = true;
        object.clear();
        bodyGeometry.dispose();
        bodyMaterial.dispose();
        markingsGeometry?.dispose();
        markingsMaterial?.dispose();

        for (const geometry of faceTextureGeometries) {
          geometry.dispose();
        }

        for (const material of faceTextureMaterials) {
          material.dispose();
        }

        for (const lease of textures?.leases ?? []) {
          lease.release();
        }
      }
    };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("DiceMeshFactory has been disposed.");
    }
  }
}
