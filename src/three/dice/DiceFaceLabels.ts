import {
  CanvasTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
  readonly material: MeshBasicMaterial;
  readonly texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly value: number;
}

interface FaceBasis {
  readonly normal: Vector3;
  readonly horizontal: Vector3;
  readonly vertical: Vector3;
  readonly center: Vector3;
  readonly width: number;
  readonly height: number;
}

const LABEL_CANVAS_SIZE = 512;

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

function labelPlaneScale(sides: DiceSides): number {
  switch (sides) {
    case 4:
      return 0.42;
    case 6:
      return 0.62;
    case 8:
      return 0.48;
    case 10:
      return 0.43;
    case 12:
      return 0.52;
    case 20:
      return 0.48;
  }
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

function drawLabel(
  canvas: HTMLCanvasElement,
  value: number,
  color: string,
  font: ResolvedDiceFontAppearance
): boolean {
  const context = canvas.getContext("2d");

  if (!context) {
    return false;
  }

  const label = String(value);
  const markerIndices = new Set(getDiceOrientationMarkerIndices(label));
  const maximumWidth = LABEL_CANVAS_SIZE * 0.78;
  let fontSize = label.length > 1 ? 238 : 300;
  const gapRatio = 0.025;

  const configureFont = () => {
    context.font = `${font.weight} ${fontSize}px ${quoteFontFamily(font.family)}, serif`;
  };

  const measure = () => {
    configureFont();
    const widths = [...label].map((character) => context.measureText(character).width);
    const gap = fontSize * gapRatio;
    return {
      widths,
      gap,
      total:
        widths.reduce((sum, width) => sum + width, 0) +
        Math.max(0, widths.length - 1) * gap
    };
  };

  let metrics = measure();

  if (metrics.total > maximumWidth) {
    fontSize *= maximumWidth / metrics.total;
    metrics = measure();
  }

  context.clearRect(0, 0, LABEL_CANVAS_SIZE, LABEL_CANVAS_SIZE);
  context.fillStyle = color;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  configureFont();

  const hasMarker = markerIndices.size > 0;
  const baseline = hasMarker ? LABEL_CANVAS_SIZE * 0.49 : LABEL_CANVAS_SIZE * 0.55;
  let cursorX = (LABEL_CANVAS_SIZE - metrics.total) / 2;

  for (let index = 0; index < label.length; index += 1) {
    const character = label[index]!;
    const width = metrics.widths[index] ?? 0;
    context.fillText(character, cursorX, baseline);

    if (markerIndices.has(index)) {
      const radius = Math.max(5, fontSize * 0.035);
      const markerY = baseline + fontSize * 0.29;
      context.beginPath();
      context.arc(cursorX + width / 2, markerY, radius, 0, Math.PI * 2);
      context.fill();
    }

    cursorX += width + metrics.gap;
  }

  return true;
}

function createCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_SIZE;
  canvas.height = LABEL_CANVAS_SIZE;
  return canvas;
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

function createLabelSurface(
  sides: DiceSides,
  face: DiceTopologyFace,
  size: number,
  overlayScale: number,
  color: string,
  font: ResolvedDiceFontAppearance
): LabelSurface | undefined {
  const canvas = createCanvas();

  if (!canvas || !drawLabel(canvas, face.value, color, font)) {
    return undefined;
  }

  const topology = getDiceTopology(sides);
  const basis = faceBasis(topology, face, size);
  const planeSize =
    Math.min(basis.width, basis.height) * labelPlaneScale(sides) * overlayScale;
  const geometry = new PlaneGeometry(planeSize, planeSize);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  const material = new MeshBasicMaterial({
    color: "#ffffff",
    map: texture,
    transparent: true,
    depthWrite: false
  });
  material.toneMapped = false;
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
    material,
    texture,
    canvas,
    value: face.value
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
  appearance: DiceAppearance | undefined
): DiceMesh {
  if (!usesNumericFaceLabels(sides, appearance)) {
    return mesh;
  }

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
      resolvedFont
    );

    if (surface) {
      surfaces.push(surface);
    }
  }

  if (surfaces.length === 0) {
    return mesh;
  }

  hideLegacyMarkings(mesh, sides);

  for (const surface of surfaces) {
    mesh.object.add(surface.mesh);
  }

  let disposed = false;
  const baseDispose = mesh.dispose.bind(mesh);

  void loadDiceFont(resolvedFont)
    .then((loadedFont) => {
      if (disposed) {
        return;
      }

      for (const surface of surfaces) {
        if (drawLabel(surface.canvas, surface.value, resolved.markingsColor, loadedFont)) {
          surface.texture.needsUpdate = true;
        }
      }
    })
    .catch(() => {
      // loadDiceFont already handles URL failures; this is only a final safety net.
    });

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
        surface.texture.dispose();
      }

      baseDispose();
    }
  };
}
