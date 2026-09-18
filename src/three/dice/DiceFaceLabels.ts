import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3
} from "three";
import {
  resolveDiceAppearance,
  resolveDiceFaceLabelMode,
  resolveDiceFontAppearance,
  type DiceAppearance,
  type ResolvedDiceFontAppearance
} from "../../appearance/index.js";
import { loadDiceFont } from "../../appearance/DiceFont.js";
import {
  getDiceTopology,
  type DiceSides,
  type DiceTopologyFace
} from "../../core/index.js";
import type { DiceMesh } from "./DiceMeshFactory.js";

interface LabelSurface {
  readonly mesh: Mesh;
  readonly geometry: PlaneGeometry;
  readonly material: MeshStandardMaterial;
}

interface CachedLabelResource {
  readonly texture: CanvasTexture;
  readonly bumpTexture: CanvasTexture;
  dispose(): void;
}

/**
 * Factory-owned cache for generated numeric label and bump textures.
 * Meshes own only their geometry/material; cached textures stay valid until the cache is disposed.
 */
export class DiceFaceLabelCache {
  private readonly entries = new Map<string, CachedLabelResource>();
  private disposed = false;

  get size(): number {
    return this.entries.size;
  }

  getOrCreate(
    key: string,
    create: () => CachedLabelResource | undefined
  ): CachedLabelResource | undefined {
    if (this.disposed) {
      throw new Error("DiceFaceLabelCache has been disposed.");
    }

    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }

    const resource = create();
    if (resource) {
      this.entries.set(key, resource);
    }
    return resource;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const resource of this.entries.values()) {
      resource.dispose();
    }
    this.entries.clear();
  }
}

interface FaceBasis {
  readonly normal: Vector3;
  readonly horizontal: Vector3;
  readonly vertical: Vector3;
  readonly center: Vector3;
  readonly width: number;
  readonly height: number;
}

interface CharacterLayout {
  readonly character: string;
  readonly width: number;
  readonly marker: boolean;
  readonly x: number;
  readonly centerX: number;
}

interface LabelMetrics {
  readonly characters: readonly CharacterLayout[];
  readonly gap: number;
  readonly totalWidth: number;
  readonly textBounds: {
    readonly left: number;
    readonly right: number;
    readonly width: number;
    readonly ascent: number;
    readonly descent: number;
    readonly height: number;
  };
}

const LABEL_CANVAS_SIZE = 1024;
const BUMP_CANVAS_SIZE = 256;
const LABEL_MAXIMUM_WIDTH_RATIO = 0.94;
const LABEL_MAXIMUM_HEIGHT_RATIO = 0.82;
const LABEL_GAP_RATIO = 0.02;
const ORIENTATION_MARKER_GAP_RATIO = 0.075;
const ORIENTATION_MARKER_RADIUS_RATIO = 0.026;
const ORIENTATION_MARKER_MIN_RADIUS = 10;
const ENGRAVED_BUMP_SCALE = -0.075;
const ENGRAVED_ROUGHNESS = 0.72;

function faceBasis(
  topology: ReturnType<typeof getDiceTopology>,
  face: DiceTopologyFace,
  size: number
): FaceBasis {
  const normal = new Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();
  const center = new Vector3(face.center.x * size, face.center.y * size, face.center.z * size);
  const reference = Math.abs(normal.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const horizontal = new Vector3().crossVectors(reference, normal).normalize();
  const vertical = new Vector3().crossVectors(normal, horizontal).normalize();
  const projected = face.vertexIndices.map((index) => {
    const vertex = topology.vertices[index];

    if (!vertex) {
      throw new RangeError(`Face ${face.value} references missing topology vertex ${index}.`);
    }

    const relative = new Vector3(vertex.x * size, vertex.y * size, vertex.z * size).sub(center);
    return {
      x: relative.dot(horizontal),
      y: relative.dot(vertical)
    };
  });

  return {
    normal,
    horizontal,
    vertical,
    center,
    width:
      Math.max(...projected.map((point) => point.x)) -
      Math.min(...projected.map((point) => point.x)),
    height:
      Math.max(...projected.map((point) => point.y)) -
      Math.min(...projected.map((point) => point.y))
  };
}

export function getDiceFaceLabelPlaneScale(sides: DiceSides): number {
  switch (sides) {
    case 4:
      return 0.57;
    case 6:
      return 0.84;
    case 8:
      return 0.65;
    case 10:
      return 0.59;
    case 12:
      return 0.7;
    case 20:
      return 0.65;
  }
}

/** Base canvas font size before fitting unusually wide/tall custom fonts to the face. */
export function getDiceFaceLabelBaseFontSize(label: string, size = 1): number {
  return (label.length > 1 ? 700 : 870) * size;
}

export function getDiceFaceLabelCanvasSize(): number {
  return LABEL_CANVAS_SIZE;
}

export function getDiceFaceLabelBaseline(
  canvasSize: number,
  ascent: number,
  descent: number
): number {
  return canvasSize / 2 + (ascent - descent) / 2;
}

export function getDiceFaceLabelBumpScale(engravingDepth = 1): number {
  return engravingDepth === 0 ? 0 : ENGRAVED_BUMP_SCALE * engravingDepth;
}

function quoteFontFamily(family: string): string {
  return JSON.stringify(family);
}

export function getDiceOrientationMarkerIndices(label: string): readonly number[] {
  const indices: number[] = [];

  for (let index = 0; index < label.length; index += 1) {
    const character = label[index];

    if (character === "6" || character === "9") {
      indices.push(index);
    }
  }

  return indices;
}

export function usesNumericFaceLabels(
  sides: DiceSides,
  appearance: DiceAppearance | undefined
): boolean {
  return sides !== 6 || resolveDiceFaceLabelMode(appearance) === "numbers";
}

function resolveMetric(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function configureLabelContext(
  context: CanvasRenderingContext2D,
  font: ResolvedDiceFontAppearance,
  fontSize: number
): void {
  context.font = `${font.weight} ${fontSize}px ${quoteFontFamily(font.family)}, serif`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

function measureLabel(
  context: CanvasRenderingContext2D,
  label: string,
  markerIndices: ReadonlySet<number>,
  font: ResolvedDiceFontAppearance,
  fontSize: number
): LabelMetrics {
  configureLabelContext(context, font, fontSize);
  const gap = fontSize * LABEL_GAP_RATIO;
  const characters = [...label].map((character, index) => {
    const metrics = context.measureText(character);
    return {
      character,
      width: metrics.width,
      left: resolveMetric(metrics.actualBoundingBoxLeft, 0),
      right: resolveMetric(metrics.actualBoundingBoxRight, metrics.width),
      ascent: resolveMetric(metrics.actualBoundingBoxAscent, fontSize * 0.72),
      descent: resolveMetric(metrics.actualBoundingBoxDescent, fontSize * 0.2),
      marker: markerIndices.has(index)
    };
  });

  let cursorX = 0;
  const positionedCharacters: CharacterLayout[] = [];
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let ascent = 0;
  let descent = 0;

  for (const metrics of characters) {
    const characterLeft = cursorX - metrics.left;
    const characterRight = cursorX + metrics.right;
    left = Math.min(left, characterLeft);
    right = Math.max(right, characterRight);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    positionedCharacters.push({
      character: metrics.character,
      width: metrics.width,
      marker: metrics.marker,
      x: cursorX,
      centerX: (characterLeft + characterRight) / 2
    });
    cursorX += metrics.width + gap;
  }

  const totalWidth = cursorX - (characters.length > 0 ? gap : 0);

  return {
    characters: positionedCharacters,
    gap,
    totalWidth,
    textBounds: {
      left,
      right,
      width: right - left,
      ascent,
      descent,
      height: ascent + descent
    }
  };
}

function drawLabel(
  canvas: HTMLCanvasElement,
  value: number,
  font: ResolvedDiceFontAppearance
): boolean {
  const context = canvas.getContext("2d");

  if (!context) {
    return false;
  }

  const label = String(value);
  const markerIndices = new Set(getDiceOrientationMarkerIndices(label));
  const maximumWidth = LABEL_CANVAS_SIZE * LABEL_MAXIMUM_WIDTH_RATIO;
  const maximumHeight = LABEL_CANVAS_SIZE * LABEL_MAXIMUM_HEIGHT_RATIO;
  let fontSize = getDiceFaceLabelBaseFontSize(label, font.size);
  let metrics = measureLabel(context, label, markerIndices, font, fontSize);

  const widthScale = maximumWidth / metrics.textBounds.width;
  const heightScale = maximumHeight / metrics.textBounds.height;
  const scale = Math.min(widthScale, heightScale, 1);

  if (scale < 1) {
    fontSize *= scale;
    metrics = measureLabel(context, label, markerIndices, font, fontSize);
  }

  context.clearRect(0, 0, LABEL_CANVAS_SIZE, LABEL_CANVAS_SIZE);
  configureLabelContext(context, font, fontSize);
  context.fillStyle = "#ffffff";

  const baseline = getDiceFaceLabelBaseline(
    LABEL_CANVAS_SIZE,
    metrics.textBounds.ascent,
    metrics.textBounds.descent
  );
  const textOffsetX = (LABEL_CANVAS_SIZE - metrics.textBounds.width) / 2 - metrics.textBounds.left;

  for (const character of metrics.characters) {
    const drawX = textOffsetX + character.x;
    context.fillText(character.character, drawX, baseline);

    if (character.marker) {
      const radius = Math.max(
        ORIENTATION_MARKER_MIN_RADIUS,
        fontSize * ORIENTATION_MARKER_RADIUS_RATIO
      );
      const markerY =
        baseline + metrics.textBounds.descent + fontSize * ORIENTATION_MARKER_GAP_RATIO;
      context.beginPath();
      context.arc(textOffsetX + character.centerX, markerY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  return true;
}

function createCanvas(size = LABEL_CANVAS_SIZE): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Downsamples the white alpha mask onto an opaque black canvas. This creates a compact
 * grayscale height map with naturally anti-aliased edges for the recessed bump effect.
 */
function syncBumpCanvas(
  sourceCanvas: HTMLCanvasElement,
  bumpCanvas: HTMLCanvasElement
): boolean {
  const context = bumpCanvas.getContext("2d");

  if (!context) {
    return false;
  }

  context.clearRect(0, 0, bumpCanvas.width, bumpCanvas.height);
  context.fillStyle = "#000000";
  context.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
    0,
    0,
    bumpCanvas.width,
    bumpCanvas.height
  );
  return true;
}

function texturedFaceValues(
  sides: DiceSides,
  appearance: DiceAppearance | undefined
): ReadonlySet<number> {
  const values = new Set<number>();

  for (const [rawValue, source] of Object.entries(appearance?.faces ?? {})) {
    const value = Number(rawValue);

    if (
      Number.isInteger(value) &&
      value >= 1 &&
      value <= sides &&
      typeof source === "string" &&
      source.trim().length > 0
    ) {
      values.add(value);
    }
  }

  return values;
}

function existingOverlayScale(mesh: DiceMesh, sides: DiceSides): number {
  if (sides === 6) {
    return 1;
  }

  const existing = mesh.object.children.find(
    (child) => child instanceof Mesh && child.name === `D${sides} numeric markings`
  );

  return existing instanceof Mesh ? existing.scale.x : 1;
}

function hideLegacyMarkings(mesh: DiceMesh, sides: DiceSides): void {
  for (const child of mesh.object.children) {
    if (!(child instanceof Mesh)) {
      continue;
    }

    if (sides === 6) {
      if (child.name.startsWith("D6 pip ")) {
        child.visible = false;
      }
    } else if (child.name === `D${sides} numeric markings`) {
      child.visible = false;
    }
  }
}

function labelCacheKey(
  sides: DiceSides,
  value: number,
  color: string,
  font: ResolvedDiceFontAppearance,
  engravingDepth: number
): string {
  return JSON.stringify([
    sides,
    value,
    font.family,
    font.weight,
    font.size,
    font.url ?? "",
    color,
    engravingDepth
  ]);
}

function createLabelResource(
  value: number,
  font: ResolvedDiceFontAppearance
): CachedLabelResource | undefined {
  const canvas = createCanvas();
  const bumpCanvas = createCanvas(BUMP_CANVAS_SIZE);

  if (
    !canvas ||
    !bumpCanvas ||
    !drawLabel(canvas, value, font) ||
    !syncBumpCanvas(canvas, bumpCanvas)
  ) {
    return undefined;
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const bumpTexture = new CanvasTexture(bumpCanvas);
  bumpTexture.minFilter = LinearMipmapLinearFilter;
  bumpTexture.magFilter = LinearFilter;
  bumpTexture.generateMipmaps = true;
  bumpTexture.needsUpdate = true;

  let disposed = false;

  void loadDiceFont(font)
    .then((loadedFont) => {
      if (
        !disposed &&
        drawLabel(canvas, value, loadedFont) &&
        syncBumpCanvas(canvas, bumpCanvas)
      ) {
        texture.needsUpdate = true;
        bumpTexture.needsUpdate = true;
      }
    })
    .catch(() => {
      // loadDiceFont already handles URL failures; this is only a final safety net.
    });

  return {
    texture,
    bumpTexture,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      texture.dispose();
      bumpTexture.dispose();
    }
  };
}

function createLabelSurface(
  sides: DiceSides,
  face: DiceTopologyFace,
  size: number,
  overlayScale: number,
  color: string,
  font: ResolvedDiceFontAppearance,
  engravingDepth: number,
  cache: DiceFaceLabelCache
): LabelSurface | undefined {
  const resource = cache.getOrCreate(
    labelCacheKey(sides, face.value, color, font, engravingDepth),
    () => createLabelResource(face.value, font)
  );

  if (!resource) {
    return undefined;
  }

  const topology = getDiceTopology(sides);
  const basis = faceBasis(topology, face, size);
  const planeSize =
    Math.min(basis.width, basis.height) * getDiceFaceLabelPlaneScale(sides) * overlayScale;
  const geometry = new PlaneGeometry(planeSize, planeSize);

  const material = new MeshStandardMaterial({
    color,
    map: resource.texture,
    bumpMap: resource.bumpTexture,
    bumpScale: getDiceFaceLabelBumpScale(engravingDepth),
    metalness: 0,
    roughness: ENGRAVED_ROUGHNESS,
    transparent: true,
    depthWrite: false
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const mesh = new Mesh(geometry, material);
  mesh.name = `D${sides} font label ${face.value}`;
  mesh.renderOrder = 10;

  const center = basis.center.multiplyScalar(overlayScale);
  const surfaceOffset = size * 0.012 * overlayScale;
  mesh.position.copy(center).addScaledVector(basis.normal, surfaceOffset);
  mesh.quaternion.copy(
    new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(basis.horizontal, basis.vertical, basis.normal)
    )
  );

  return {
    mesh,
    geometry,
    material
  };
}

/**
 * Replaces legacy generated numeric markings with font-backed canvas labels.
 * D6 is changed only when `faceLabelMode` is `numbers`; pips remain the default.
 */
export function applyDiceFaceLabels(
  mesh: DiceMesh,
  sides: DiceSides,
  size: number,
  appearance: DiceAppearance | undefined,
  sharedCache?: DiceFaceLabelCache
): DiceMesh {
  if (!usesNumericFaceLabels(sides, appearance)) {
    return mesh;
  }

  const cache = sharedCache ?? new DiceFaceLabelCache();

  const resolved = resolveDiceAppearance(appearance);
  const resolvedFont = resolveDiceFontAppearance(appearance?.font);
  const topology = getDiceTopology(sides);
  const texturedValues = texturedFaceValues(sides, appearance);
  const overlayScale = existingOverlayScale(mesh, sides);
  const surfaces: LabelSurface[] = [];

  for (const face of topology.faces) {
    if (texturedValues.has(face.value)) {
      continue;
    }

    const surface = createLabelSurface(
      sides,
      face,
      size,
      overlayScale,
      resolved.markingsColor,
      resolvedFont,
      resolved.engravingDepth,
      cache
    );

    if (surface) {
      surfaces.push(surface);
    }
  }

  if (surfaces.length === 0) {
    if (!sharedCache) {
      cache.dispose();
    }
    return mesh;
  }

  hideLegacyMarkings(mesh, sides);

  for (const surface of surfaces) {
    mesh.object.add(surface.mesh);
  }

  let disposed = false;
  const baseDispose = mesh.dispose.bind(mesh);

  return {
    sides: mesh.sides,
    object: mesh.object,
    body: mesh.body,
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;

      for (const surface of surfaces) {
        mesh.object.remove(surface.mesh);
        surface.geometry.dispose();
        surface.material.dispose();
      }

      if (!sharedCache) {
        cache.dispose();
      }

      baseDispose();
    }
  };
}
