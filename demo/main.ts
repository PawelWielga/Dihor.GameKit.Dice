import {
  BackgroundRollPlanner,
  DEFAULT_DICE_FONT_APPEARANCE,
  DEFAULT_DICE_SCALE,
  DEFAULT_ENGRAVING_DEPTH,
  DEFAULT_THROW_FORCE,
  MAX_DICE_FONT_SIZE,
  MAX_DICE_SCALE,
  MAX_ENGRAVING_DEPTH,
  MAX_THROW_FORCE,
  MIN_DICE_FONT_SIZE,
  MIN_DICE_SCALE,
  MIN_ENGRAVING_DEPTH,
  MIN_THROW_FORCE,
  DiceOverlay,
  DiceRenderer,
  DiceRoller,
  DirectRollPlanner,
  RollPlanner,
  SUPPORTED_DICE_SIDES,
  getDiceFace,
  getDiceTopology,
  getDiceTotalRange,
  type DiceAppearance,
  type DiceCameraOptions,
  type DiceFaceLabelMode,
  type DiceFontAppearance,
  type DiceLightingOptions,
  type DiceRollRequest,
  type DiceRollResult,
  type DiceSides,
  type DiceTableMaterialOptions,
  type PhysicsQuaternion,
  type RollInitialStateContext,
  type RollPlan
} from "../src/index.js";
import { getDiceFaceLabelBumpScale } from "../src/three/dice/DiceFaceLabels.js";

const SAMPLE_TEXTURE_URL = "https://threejs.org/examples/textures/uv_grid_opengl.jpg";
const SAMPLE_TABLE_TEXTURE_URL = SAMPLE_TEXTURE_URL;
const COMPARISON_SIDES = SUPPORTED_DICE_SIDES;
const COMPARISON_SLOT_SPACING = 2.6;
const COMPARISON_LABEL = COMPARISON_SIDES.map((sides) => `D${sides}`).join(" + ");

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Demo element was not found: ${selector}`);
  }

  return element;
}

function optionalValue(input: HTMLInputElement): string | undefined {
  const value = input.value.trim();
  return value.length > 0 ? value : undefined;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function normalizeQuaternion(quaternion: PhysicsQuaternion): PhysicsQuaternion {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length
  };
}

function multiplyQuaternions(left: PhysicsQuaternion, right: PhysicsQuaternion): PhysicsQuaternion {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z
  });
}

function quaternionFromDirections(
  from: { readonly x: number; readonly y: number; readonly z: number },
  to: { readonly x: number; readonly y: number; readonly z: number }
): PhysicsQuaternion {
  const fromLength = Math.hypot(from.x, from.y, from.z);
  const toLength = Math.hypot(to.x, to.y, to.z);
  const a = { x: from.x / fromLength, y: from.y / fromLength, z: from.z / fromLength };
  const b = { x: to.x / toLength, y: to.y / toLength, z: to.z / toLength };
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;

  if (dot < -0.999999) {
    const reference = Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const axis = {
      x: a.y * reference.z - a.z * reference.y,
      y: a.z * reference.x - a.x * reference.z,
      z: a.x * reference.y - a.y * reference.x
    };
    const axisLength = Math.hypot(axis.x, axis.y, axis.z);
    return { x: axis.x / axisLength, y: axis.y / axisLength, z: axis.z / axisLength, w: 0 };
  }

  return normalizeQuaternion({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
    w: 1 + dot
  });
}

function rotatedY(
  vector: { readonly x: number; readonly y: number; readonly z: number },
  quaternion: PhysicsQuaternion
): number {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);
  return vector.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz);
}

function createComparisonInitialState(context: RollInitialStateContext) {
  const topology = getDiceTopology(context.sides);
  const resultFace = getDiceFace(context.sides, context.expectedValue);
  const targetY = topology.resultDirection === "up" ? 1 : -1;
  const aligned = quaternionFromDirections(resultFace.normal, { x: 0, y: targetY, z: 0 });
  const yaw = (context.dieIndex - (context.diceCount - 1) / 2) * 0.35 + (context.attempt - 1) * 0.05;
  const yawQuaternion: PhysicsQuaternion = {
    x: 0,
    y: Math.sin(yaw / 2),
    z: 0,
    w: Math.cos(yaw / 2)
  };
  const quaternion = multiplyQuaternions(yawQuaternion, aligned);
  const supportY = -Math.min(...topology.vertices.map((vertex) => rotatedY(vertex, quaternion))) * context.diceSize;
  const spinDirection = context.dieIndex % 2 === 0 ? 1 : -1;

  return {
    position: {
      x: context.slotX,
      y: supportY + context.diceSize * 1.6,
      z: 0
    },
    quaternion,
    velocity: {
      x: 0,
      y: context.diceSize * 0.12,
      z: 0
    },
    angularVelocity: {
      x: 0,
      y: spinDirection * 2.8,
      z: 0
    }
  };
}

const form = requireElement<HTMLFormElement>("#dice-form");
const diceType = requireElement<HTMLSelectElement>("#dice-type");
const diceCount = requireElement<HTMLSelectElement>("#dice-count");
const modifier = requireElement<HTMLInputElement>("#modifier");
const reason = requireElement<HTMLInputElement>("#reason");
const rollMode = requireElement<HTMLSelectElement>("#roll-mode");
const expectedTotalField = requireElement<HTMLElement>("#expected-total-field");
const expectedTotal = requireElement<HTMLInputElement>("#expected-total");
const expectedTotalRange = requireElement<HTMLOutputElement>("#expected-total-range");
const rollModeHint = requireElement<HTMLElement>("#roll-mode-hint");
const throwForce = requireElement<HTMLInputElement>("#throw-force");
const throwForceValue = requireElement<HTMLOutputElement>("#throw-force-value");
const resetThrowForceButton = requireElement<HTMLButtonElement>("#reset-throw-force-button");
const diceScale = requireElement<HTMLInputElement>("#dice-scale");
const diceScaleValue = requireElement<HTMLOutputElement>("#dice-scale-value");
const resetDiceScaleButton = requireElement<HTMLButtonElement>("#reset-dice-scale-button");
const bodyColor = requireElement<HTMLInputElement>("#body-color");
const markingsColor = requireElement<HTMLInputElement>("#markings-color");
const bodyColorValue = requireElement<HTMLOutputElement>("#body-color-value");
const markingsColorValue = requireElement<HTMLOutputElement>("#markings-color-value");
const tableColor = requireElement<HTMLInputElement>("#table-color");
const tableColorValue = requireElement<HTMLOutputElement>("#table-color-value");
const tableTexture = requireElement<HTMLInputElement>("#table-texture");
const sampleTableTextureButton = requireElement<HTMLButtonElement>("#sample-table-texture-button");
const resetTableButton = requireElement<HTMLButtonElement>("#reset-table-button");
const cameraX = requireElement<HTMLInputElement>("#camera-x");
const cameraY = requireElement<HTMLInputElement>("#camera-y");
const cameraZ = requireElement<HTMLInputElement>("#camera-z");
const cameraXValue = requireElement<HTMLOutputElement>("#camera-x-value");
const cameraYValue = requireElement<HTMLOutputElement>("#camera-y-value");
const cameraZValue = requireElement<HTMLOutputElement>("#camera-z-value");
const resetCameraButton = requireElement<HTMLButtonElement>("#reset-camera-button");
const ambientColor = requireElement<HTMLInputElement>("#ambient-color");
const ambientColorValue = requireElement<HTMLOutputElement>("#ambient-color-value");
const ambientIntensity = requireElement<HTMLInputElement>("#ambient-intensity");
const ambientIntensityValue = requireElement<HTMLOutputElement>("#ambient-intensity-value");
const keyLightColor = requireElement<HTMLInputElement>("#key-light-color");
const keyLightColorValue = requireElement<HTMLOutputElement>("#key-light-color-value");
const keyLightIntensity = requireElement<HTMLInputElement>("#key-light-intensity");
const keyLightIntensityValue = requireElement<HTMLOutputElement>("#key-light-intensity-value");
const keyLightX = requireElement<HTMLInputElement>("#key-light-x");
const keyLightY = requireElement<HTMLInputElement>("#key-light-y");
const keyLightZ = requireElement<HTMLInputElement>("#key-light-z");
const keyLightShadow = requireElement<HTMLInputElement>("#key-light-shadow");
const neutralLightingButton = requireElement<HTMLButtonElement>("#lighting-neutral-button");
const warmLightingButton = requireElement<HTMLButtonElement>("#lighting-warm-button");
const moodyLightingButton = requireElement<HTMLButtonElement>("#lighting-moody-button");
const resetLightingButton = requireElement<HTMLButtonElement>("#reset-lighting-button");
const fontPreset = requireElement<HTMLSelectElement>("#font-preset");
const fontFamily = requireElement<HTMLInputElement>("#font-family");
const fontWeight = requireElement<HTMLInputElement>("#font-weight");
const fontUrl = requireElement<HTMLInputElement>("#font-url");
const fontSize = requireElement<HTMLInputElement>("#font-size");
const fontSizeValue = requireElement<HTMLOutputElement>("#font-size-value");
const resetFontSizeButton = requireElement<HTMLButtonElement>("#reset-font-size-button");
const engravingDepth = requireElement<HTMLInputElement>("#engraving-depth");
const engravingDepthValue = requireElement<HTMLOutputElement>("#engraving-depth-value");
const resetEngravingDepthButton = requireElement<HTMLButtonElement>(
  "#reset-engraving-depth-button"
);
const resetFontButton = requireElement<HTMLButtonElement>("#reset-font-button");
const d6LabelMode = requireElement<HTMLSelectElement>("#d6-label-mode");
const globalTexture = requireElement<HTMLInputElement>("#global-texture");
const sampleTextureButton = requireElement<HTMLButtonElement>("#sample-texture-button");
const faceTextureInputs = [1, 2, 3, 4, 5, 6].map((face) =>
  requireElement<HTMLInputElement>(`#face-${face}`)
);
const debugMode = requireElement<HTMLInputElement>("#debug-mode");
const compareButton = requireElement<HTMLButtonElement>("#compare-button");
const rollButton = requireElement<HTMLButtonElement>("#roll-button");
const mobileRollButton = requireElement<HTMLButtonElement>("#mobile-roll-button");
const resetButton = requireElement<HTMLButtonElement>("#reset-button");
const stage = requireElement<HTMLElement>("#stage");
const stagePlaceholder = requireElement<HTMLElement>("#stage-placeholder");
const status = requireElement<HTMLElement>("#status");
const resultValue = requireElement<HTMLElement>("#result-value");
const resultDice = requireElement<HTMLElement>("#result-dice");
const resultJson = requireElement<HTMLElement>("#result-json");
const debugPanel = requireElement<HTMLElement>("#debug-panel");
const debugJson = requireElement<HTMLElement>("#debug-json");

const roller = new DiceRoller();
const planner = new RollPlanner();
const backgroundPlanner = new BackgroundRollPlanner({ fallbackPlanner: planner });
const directPlanner = new DirectRollPlanner();
const comparisonPlanner = new RollPlanner({
  initialStateProvider: createComparisonInitialState,
  slotSpacing: COMPARISON_SLOT_SPACING,
  maxAttemptsPerDie: 6,
  maxCombinedAttempts: 1,
  maxPlanningTimeMs: 5000,
  physics: {
    arenaHalfExtent: 9,
    friction: 0.6,
    restitution: 0.06,
    linearDamping: 0.25,
    angularDamping: 0.28
  }
});
let debugLogicalResult: DiceRollResult | undefined;
let debugPlan: RollPlan | undefined;
let debugFinalResult: DiceRollResult | undefined;
let rolling = false;
let comparisonMode = false;
let demoRenderer: DiceRenderer | undefined;
let renderedFontSize = DEFAULT_DICE_FONT_APPEARANCE.size;

function createCameraOptions(): DiceCameraOptions {
  return {
    x: Number(cameraX.value),
    y: Number(cameraY.value),
    z: Number(cameraZ.value)
  };
}

function updateCameraOutputs(): void {
  cameraXValue.value = `${Number(cameraX.value).toFixed(0)}°`;
  cameraYValue.value = `${Number(cameraY.value).toFixed(0)}°`;
  cameraZValue.value = Number(cameraZ.value).toFixed(1);
}

function configureCamera(comparison: boolean): void {
  const renderer = demoRenderer;
  const camera = renderer?.diceScene.camera;

  if (!renderer || !camera) {
    return;
  }

  if (comparison) {
    // Use a distant narrow-FOV view so all six dice can be compared with minimal perspective bias.
    camera.position.set(0, 70, 95);
    camera.up.set(0, 1, 0);
    camera.fov = 7.5;
    camera.far = 250;
    camera.lookAt(0, 0.65, 0);
  } else {
    camera.fov = 45;
    camera.far = 100;
    renderer.diceScene.setCamera(createCameraOptions());
  }

  camera.updateProjectionMatrix();
  renderer.render();
}

const overlay = new DiceOverlay({
  container: stage,
  showOverlay: false,
  roller: {
    roll(request) {
      debugLogicalResult = roller.roll(request);
      return debugLogicalResult;
    },
    createRollId() {
      return roller.createRollId();
    },
    rollToDiceTotal(request, expectedDiceTotal) {
      debugLogicalResult = roller.rollToDiceTotal(request, expectedDiceTotal);
      return debugLogicalResult;
    }
  },
  planner: {
    async plan(result, options) {
      debugPlan = comparisonMode
        ? comparisonPlanner.plan(result, options)
        : await backgroundPlanner.plan(result, options);
      return debugPlan;
    },
    cancel() {
      backgroundPlanner.cancel();
    },
    dispose() {
      backgroundPlanner.dispose();
    }
  },
  directPlanner: {
    plan(request, rollId, options) {
      debugPlan = directPlanner.plan(request, rollId, options);
      return debugPlan;
    }
  },
  renderer: {
    alpha: true,
    scene: {
      showFloor: true
    }
  },
  rendererFactory(container, options) {
    const renderer = new DiceRenderer(container, {
      ...options,
      scene: {
        ...options.scene,
        table: createTableMaterial(),
        camera: createCameraOptions(),
        lighting: createLightingOptions()
      }
    });
    demoRenderer = renderer;
    configureCamera(comparisonMode);
    return renderer;
  }
});

function setStatus(message: string, state?: "busy" | "error"): void {
  status.textContent = message;

  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

function isPreSimulatedMode(): boolean {
  return rollMode.value === "presimulated";
}

function currentDiceDefinitions(): DiceRollRequest["dice"] {
  const sides = Number.parseInt(diceType.value, 10) as DiceSides;
  const count = Number.parseInt(diceCount.value, 10);
  return Array.from({ length: count }, () => ({ sides }));
}

function updateRollModeControls(): void {
  const preSimulation = isPreSimulatedMode();
  const { min, max } = getDiceTotalRange(currentDiceDefinitions());

  expectedTotalField.hidden = !preSimulation;
  expectedTotal.disabled = !preSimulation;
  expectedTotal.min = "0";
  expectedTotal.max = String(max);
  expectedTotalRange.value = `0 = Auto · ${min}..${max}`;
  rollModeHint.textContent = preSimulation
    ? `Presimulated mode: 0 = Auto, or force a dice total from ${min} to ${max}.`
    : "Direct physical mode: visible physics starts immediately and decides the result after settling.";

  const value = Number(expectedTotal.value);
  expectedTotal.setCustomValidity(
    value === 0 || (Number.isInteger(value) && value >= min && value <= max)
      ? ""
      : `Enter 0 (Auto) or a value from ${min} to ${max}.`
  );
}

function readExpectedDiceTotal(): number {
  if (!isPreSimulatedMode()) {
    return 0;
  }

  updateRollModeControls();
  if (!expectedTotal.checkValidity()) {
    throw new Error(expectedTotal.validationMessage);
  }

  return Number(expectedTotal.value);
}

function readThrowForce(): number {
  const value = Number(throwForce.value);

  if (!Number.isFinite(value) || value < MIN_THROW_FORCE || value > MAX_THROW_FORCE) {
    throw new Error(
      `Throw force must be between ${MIN_THROW_FORCE} and ${MAX_THROW_FORCE}; received ${throwForce.value}.`
    );
  }

  return value;
}

function updateThrowForceOutput(): void {
  throwForceValue.value = `${readThrowForce().toFixed(2)}×`;
}

function readDiceScale(): number {
  const value = Number(diceScale.value);

  if (!Number.isFinite(value) || value < MIN_DICE_SCALE || value > MAX_DICE_SCALE) {
    throw new Error(
      `Dice size must be between ${MIN_DICE_SCALE} and ${MAX_DICE_SCALE}; received ${diceScale.value}.`
    );
  }

  return value;
}

function updateDiceScaleOutput(): void {
  diceScaleValue.value = `${readDiceScale().toFixed(2)}×`;
}

function updateColorOutputs(): void {
  bodyColorValue.value = bodyColor.value.toUpperCase();
  markingsColorValue.value = markingsColor.value.toUpperCase();
}

function updateTableColorOutput(): void {
  tableColorValue.value = tableColor.value.toUpperCase();
}

function createTableMaterial(): DiceTableMaterialOptions {
  const texture = optionalValue(tableTexture);

  return {
    color: tableColor.value,
    ...(texture ? { texture } : {})
  };
}

function applyTableMaterial(): void {
  const renderer = demoRenderer;

  if (!renderer) {
    return;
  }

  const update = renderer.diceScene.setTableMaterial(createTableMaterial());
  renderer.render();
  void update.then(() => {
    if (demoRenderer === renderer) {
      renderer.render();
    }
  });
}

function applyCamera(): void {
  updateCameraOutputs();

  if (!comparisonMode) {
    configureCamera(false);
  }
}

function readFiniteLightingValue(input: HTMLInputElement, label: string): number {
  const value = Number(input.value);

  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number; received ${input.value}.`);
  }

  return value;
}

function updateLightingOutputs(): void {
  ambientColorValue.value = ambientColor.value.toUpperCase();
  ambientIntensityValue.value = readFiniteLightingValue(ambientIntensity, "Ambient intensity").toFixed(2);
  keyLightColorValue.value = keyLightColor.value.toUpperCase();
  keyLightIntensityValue.value = readFiniteLightingValue(keyLightIntensity, "Key light intensity").toFixed(2);
}

function createLightingOptions(): DiceLightingOptions {
  return {
    ambient: {
      color: ambientColor.value,
      intensity: readFiniteLightingValue(ambientIntensity, "Ambient intensity")
    },
    lights: [
      {
        type: "directional",
        color: keyLightColor.value,
        intensity: readFiniteLightingValue(keyLightIntensity, "Key light intensity"),
        position: {
          x: readFiniteLightingValue(keyLightX, "Key light X"),
          y: readFiniteLightingValue(keyLightY, "Key light Y"),
          z: readFiniteLightingValue(keyLightZ, "Key light Z")
        },
        castShadow: keyLightShadow.checked
      }
    ]
  };
}

function applyLighting(): void {
  updateLightingOutputs();
  const renderer = demoRenderer;

  if (!renderer) {
    return;
  }

  renderer.diceScene.setLighting(createLightingOptions());
  renderer.render();
}

type LightingPreset = "neutral" | "warm" | "moody";

function setLightingPreset(preset: LightingPreset): void {
  if (preset === "neutral") {
    ambientColor.value = "#ffffff";
    ambientIntensity.value = "1.4";
    keyLightColor.value = "#ffffff";
    keyLightIntensity.value = "2.2";
    keyLightX.value = "4";
    keyLightY.value = "8";
    keyLightZ.value = "5";
    keyLightShadow.checked = false;
  } else if (preset === "warm") {
    ambientColor.value = "#6b4a32";
    ambientIntensity.value = "0.85";
    keyLightColor.value = "#ffb36b";
    keyLightIntensity.value = "3";
    keyLightX.value = "-4";
    keyLightY.value = "7";
    keyLightZ.value = "4";
    keyLightShadow.checked = true;
  } else {
    ambientColor.value = "#18203a";
    ambientIntensity.value = "0.3";
    keyLightColor.value = "#7896ff";
    keyLightIntensity.value = "2.4";
    keyLightX.value = "5";
    keyLightY.value = "4";
    keyLightZ.value = "-3";
    keyLightShadow.checked = true;
  }

  applyLighting();
}

function syncFontControls(): void {
  const custom = fontPreset.value === "custom";
  fontFamily.disabled = !custom;
  fontWeight.disabled = !custom;
  fontUrl.disabled = !custom;
}

function readFontSize(): number {
  const size = Number(fontSize.value);

  if (!Number.isFinite(size) || size < MIN_DICE_FONT_SIZE || size > MAX_DICE_FONT_SIZE) {
    throw new Error(
      `Font size must be between ${MIN_DICE_FONT_SIZE} and ${MAX_DICE_FONT_SIZE}; received ${fontSize.value}.`
    );
  }

  return size;
}

function updateFontSizeOutput(): void {
  fontSizeValue.value = `${readFontSize().toFixed(2)}×`;
}

function applyFontSizePreview(): void {
  updateFontSizeOutput();
  const renderer = demoRenderer;

  if (!renderer) {
    return;
  }

  const previewScale = readFontSize() / renderedFontSize;

  renderer.diceScene.content.traverse((object) => {
    if (object.name.includes(" font label ")) {
      object.scale.setScalar(previewScale);
    }
  });
  renderer.render();
}

function readEngravingDepth(): number {
  const depth = Number(engravingDepth.value);

  if (
    !Number.isFinite(depth) ||
    depth < MIN_ENGRAVING_DEPTH ||
    depth > MAX_ENGRAVING_DEPTH
  ) {
    throw new Error(
      `Engraving depth must be between ${MIN_ENGRAVING_DEPTH} and ${MAX_ENGRAVING_DEPTH}; received ${engravingDepth.value}.`
    );
  }

  return depth;
}

function updateEngravingDepthOutput(): void {
  engravingDepthValue.value = `${readEngravingDepth().toFixed(2)}×`;
}

function applyEngravingDepthPreview(): void {
  updateEngravingDepthOutput();
  const renderer = demoRenderer;

  if (!renderer) {
    return;
  }

  const bumpScale = getDiceFaceLabelBumpScale(readEngravingDepth());

  renderer.diceScene.content.traverse((object) => {
    if (!object.name.includes(" font label ")) {
      return;
    }

    const material = (object as unknown as { material?: unknown }).material;

    if (
      material &&
      !Array.isArray(material) &&
      typeof material === "object" &&
      "bumpScale" in material
    ) {
      (material as { bumpScale: number }).bumpScale = bumpScale;
    }
  });
  renderer.render();
}

function createFontAppearance(): DiceFontAppearance | undefined {
  const size = readFontSize();

  switch (fontPreset.value) {
    case "default":
      return size === DEFAULT_DICE_FONT_APPEARANCE.size ? undefined : { size };
    case "georgia":
      return { family: "Georgia", weight: 700, size };
    case "trebuchet":
      return { family: "Trebuchet MS", weight: 700, size };
    case "custom": {
      const family = fontFamily.value.trim();
      const url = optionalValue(fontUrl);
      const weight = Number(fontWeight.value || "700");

      if (!Number.isFinite(weight) || weight < 1 || weight > 1000) {
        throw new Error(`Font weight must be between 1 and 1000; received ${fontWeight.value}.`);
      }

      if (!family && !url) {
        return size === DEFAULT_DICE_FONT_APPEARANCE.size ? undefined : { size };
      }

      return {
        family: family || "PartyBeam Custom Dice Font",
        weight,
        size,
        ...(url ? { url } : {})
      };
    }
    default:
      throw new Error(`Unknown font preset: ${fontPreset.value}.`);
  }
}

function selectedD6LabelMode(): DiceFaceLabelMode {
  if (d6LabelMode.value !== "dots" && d6LabelMode.value !== "numbers") {
    throw new Error(`Unknown D6 label mode: ${d6LabelMode.value}.`);
  }

  return d6LabelMode.value;
}

function createAppearance(sides: DiceSides): DiceAppearance {
  const faces: Partial<Record<number, string>> = {};

  for (let index = 0; index < faceTextureInputs.length && index < sides; index += 1) {
    const value = optionalValue(faceTextureInputs[index]!);

    if (value) {
      faces[index + 1] = value;
    }
  }

  const texture = optionalValue(globalTexture);
  const font = createFontAppearance();

  return {
    color: bodyColor.value,
    markingsColor: markingsColor.value,
    engravingDepth: readEngravingDepth(),
    ...(font ? { font } : {}),
    ...(sides === 6 ? { faceLabelMode: selectedD6LabelMode() } : {}),
    ...(texture ? { texture } : {}),
    ...(Object.keys(faces).length > 0 ? { faces } : {})
  };
}

function createRequest(): DiceRollRequest {
  const numericSides = Number.parseInt(diceType.value, 10);

  if (!SUPPORTED_DICE_SIDES.includes(numericSides as DiceSides)) {
    throw new Error(`Unsupported dice type D${diceType.value}.`);
  }

  const sides = numericSides as DiceSides;
  const count = Number.parseInt(diceCount.value, 10);

  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new Error(`Dice count must be between 1 and 3; received ${diceCount.value}.`);
  }

  const numericModifier = Number(modifier.value || "0");

  if (!Number.isFinite(numericModifier)) {
    throw new Error("Modifier must be a finite number.");
  }

  const appearance = createAppearance(sides);
  const rollReason = reason.value.trim();

  return {
    dice: Array.from({ length: count }, () => ({
      sides,
      appearance
    })),
    modifier: numericModifier,
    ...(rollReason ? { reason: rollReason } : {})
  };
}

function createComparisonRequest(): DiceRollRequest {
  return {
    dice: COMPARISON_SIDES.map((sides) => ({
      sides,
      appearance: createAppearance(sides)
    })),
    modifier: 0,
    reason: "D4 / D6 / D8 aligned size comparison"
  };
}

function formatDiceExpression(result: DiceRollResult): string {
  const diceLabels = result.dice.map((die) => `D${die.sides} → ${die.value}`);

  if (diceLabels.length === 1 && result.modifier === 0) {
    return diceLabels[0] ?? `Result → ${result.total}`;
  }

  let expression = diceLabels.join(" · ");

  if (result.modifier > 0) {
    expression += ` · +${result.modifier}`;
  } else if (result.modifier < 0) {
    expression += ` · -${Math.abs(result.modifier)}`;
  }

  return `${expression} · total ${result.total}`;
}

function showResult(result: DiceRollResult): void {
  resultValue.textContent = String(result.total);
  resultDice.textContent = formatDiceExpression(result);
  resultJson.textContent = JSON.stringify(result, null, 2);
}

function updateDebugPanel(): void {
  debugPanel.hidden = !debugMode.checked;

  if (!debugMode.checked) {
    return;
  }

  debugJson.textContent = JSON.stringify(
    {
      logicalResult: debugLogicalResult ?? null,
      rollPlan: debugPlan ?? null,
      finalResult: debugFinalResult ?? null
    },
    null,
    2
  );
}

function setRollingState(isRolling: boolean, comparison = false): void {
  rolling = isRolling;
  rollButton.disabled = isRolling;
  mobileRollButton.disabled = isRolling;
  compareButton.disabled = isRolling;
  resetButton.disabled = isRolling;
  const rollLabel = isRolling && !comparison ? "Rolling…" : "Roll dice";
  rollButton.textContent = rollLabel;
  mobileRollButton.textContent = rollLabel;
  compareButton.textContent = isRolling && comparison
    ? `Aligning ${COMPARISON_LABEL}…`
    : `Roll ${COMPARISON_LABEL} together`;
}

async function runRequest(request: DiceRollRequest, comparison = false): Promise<void> {
  if (rolling) {
    return;
  }

  comparisonMode = comparison;
  configureCamera(comparisonMode);
  debugLogicalResult = undefined;
  debugPlan = undefined;
  debugFinalResult = undefined;
  updateDebugPanel();
  setRollingState(true, comparison);
  const preSimulation = comparison || isPreSimulatedMode();
  setStatus(
    comparison
      ? `Rolling aligned ${COMPARISON_LABEL}…`
      : preSimulation
        ? "Planning in background, then rolling…"
        : "Rolling immediately; result comes from physics…",
    "busy"
  );
  stagePlaceholder.hidden = true;

  try {
    await nextPaint();
    renderedFontSize = readFontSize();
    const result = await overlay.roll(request, {
      throwForce: readThrowForce(),
      diceScale: readDiceScale(),
      preSimulation,
      expectedDiceTotal: comparison ? 0 : readExpectedDiceTotal()
    });
    debugFinalResult = result;
    showResult(result);
    updateDebugPanel();
    setStatus(comparison ? "Aligned size comparison complete" : "Roll complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resultValue.textContent = "!";
    resultDice.textContent = "Roll failed";
    resultJson.textContent = JSON.stringify({ error: message }, null, 2);
    updateDebugPanel();
    setStatus("Roll failed", "error");
    console.error("PartyBeam.DiceKit demo roll failed", error);
  } finally {
    setRollingState(false);
  }
}

function resetOutput(): void {
  overlay.close();
  demoRenderer = undefined;
  comparisonMode = false;
  stagePlaceholder.hidden = false;
  resultValue.textContent = "–";
  resultDice.textContent = "No roll yet";
  resultJson.textContent = "Waiting for the first roll…";
  debugLogicalResult = undefined;
  debugPlan = undefined;
  debugFinalResult = undefined;
  debugJson.textContent = "Enable a roll to inspect the pipeline.";
  setStatus("Ready to roll");
}

rollMode.addEventListener("change", updateRollModeControls);
expectedTotal.addEventListener("input", updateRollModeControls);
diceType.addEventListener("change", updateRollModeControls);
diceCount.addEventListener("change", updateRollModeControls);
throwForce.addEventListener("input", updateThrowForceOutput);
resetThrowForceButton.addEventListener("click", () => {
  throwForce.value = String(DEFAULT_THROW_FORCE);
  updateThrowForceOutput();
});
diceScale.addEventListener("input", updateDiceScaleOutput);
resetDiceScaleButton.addEventListener("click", () => {
  diceScale.value = String(DEFAULT_DICE_SCALE);
  updateDiceScaleOutput();
});
bodyColor.addEventListener("input", updateColorOutputs);
markingsColor.addEventListener("input", updateColorOutputs);
tableColor.addEventListener("input", () => {
  updateTableColorOutput();
  applyTableMaterial();
});
tableTexture.addEventListener("change", applyTableMaterial);
sampleTableTextureButton.addEventListener("click", () => {
  tableTexture.value = SAMPLE_TABLE_TEXTURE_URL;
  applyTableMaterial();
});
resetTableButton.addEventListener("click", () => {
  tableColor.value = "#292d33";
  tableTexture.value = "";
  updateTableColorOutput();
  applyTableMaterial();
});
for (const cameraInput of [cameraX, cameraY, cameraZ]) {
  cameraInput.addEventListener("input", applyCamera);
}
resetCameraButton.addEventListener("click", () => {
  cameraX.value = "0";
  cameraY.value = "53.75";
  cameraZ.value = "9.3";
  applyCamera();
});
for (const lightingInput of [
  ambientColor,
  ambientIntensity,
  keyLightColor,
  keyLightIntensity,
  keyLightX,
  keyLightY,
  keyLightZ,
  keyLightShadow
]) {
  lightingInput.addEventListener("input", applyLighting);
  lightingInput.addEventListener("change", applyLighting);
}
neutralLightingButton.addEventListener("click", () => setLightingPreset("neutral"));
warmLightingButton.addEventListener("click", () => setLightingPreset("warm"));
moodyLightingButton.addEventListener("click", () => setLightingPreset("moody"));
resetLightingButton.addEventListener("click", () => setLightingPreset("neutral"));
fontPreset.addEventListener("change", syncFontControls);
fontSize.addEventListener("input", applyFontSizePreview);
engravingDepth.addEventListener("input", applyEngravingDepthPreview);
resetFontSizeButton.addEventListener("click", () => {
  fontSize.value = String(DEFAULT_DICE_FONT_APPEARANCE.size);
  applyFontSizePreview();
});
resetEngravingDepthButton.addEventListener("click", () => {
  engravingDepth.value = String(DEFAULT_ENGRAVING_DEPTH);
  applyEngravingDepthPreview();
});
resetFontButton.addEventListener("click", () => {
  fontPreset.value = "default";
  fontFamily.value = "";
  fontWeight.value = "700";
  fontUrl.value = "";
  fontSize.value = String(DEFAULT_DICE_FONT_APPEARANCE.size);
  syncFontControls();
  applyFontSizePreview();
});
sampleTextureButton.addEventListener("click", () => {
  globalTexture.value = SAMPLE_TEXTURE_URL;
  globalTexture.focus();
});
debugMode.addEventListener("change", updateDebugPanel);
resetButton.addEventListener("click", resetOutput);
compareButton.addEventListener("click", () => {
  void runRequest(createComparisonRequest(), true);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void runRequest(createRequest());
});

window.addEventListener(
  "pagehide",
  () => {
    overlay.dispose();
    demoRenderer = undefined;
  },
  { once: true }
);

updateThrowForceOutput();
updateDiceScaleOutput();
updateColorOutputs();
updateTableColorOutput();
updateCameraOutputs();
updateLightingOutputs();
updateRollModeControls();
updateFontSizeOutput();
updateEngravingDepthOutput();
syncFontControls();
updateDebugPanel();
