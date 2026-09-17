import {
  DiceOverlay,
  DiceRoller,
  RollPlanner,
  SUPPORTED_DICE_SIDES,
  type DiceAppearance,
  type DiceRollRequest,
  type DiceRollResult,
  type DiceSides,
  type RollPlan
} from "../src/index.js";

const SAMPLE_TEXTURE_URL = "https://threejs.org/examples/textures/uv_grid_opengl.jpg";
const COMPARISON_SIDES = [4, 6, 8] as const satisfies readonly DiceSides[];

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

const form = requireElement<HTMLFormElement>("#dice-form");
const diceType = requireElement<HTMLSelectElement>("#dice-type");
const diceCount = requireElement<HTMLSelectElement>("#dice-count");
const modifier = requireElement<HTMLInputElement>("#modifier");
const reason = requireElement<HTMLInputElement>("#reason");
const bodyColor = requireElement<HTMLInputElement>("#body-color");
const markingsColor = requireElement<HTMLInputElement>("#markings-color");
const bodyColorValue = requireElement<HTMLOutputElement>("#body-color-value");
const markingsColorValue = requireElement<HTMLOutputElement>("#markings-color-value");
const globalTexture = requireElement<HTMLInputElement>("#global-texture");
const sampleTextureButton = requireElement<HTMLButtonElement>("#sample-texture-button");
const faceTextureInputs = [1, 2, 3, 4, 5, 6].map((face) =>
  requireElement<HTMLInputElement>(`#face-${face}`)
);
const debugMode = requireElement<HTMLInputElement>("#debug-mode");
const compareButton = requireElement<HTMLButtonElement>("#compare-button");
const rollButton = requireElement<HTMLButtonElement>("#roll-button");
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
let debugLogicalResult: DiceRollResult | undefined;
let debugPlan: RollPlan | undefined;
let debugFinalResult: DiceRollResult | undefined;
let rolling = false;

const overlay = new DiceOverlay({
  container: stage,
  showOverlay: false,
  roller: {
    roll(request) {
      debugLogicalResult = roller.roll(request);
      return debugLogicalResult;
    }
  },
  planner: {
    plan(result) {
      debugPlan = planner.plan(result);
      return debugPlan;
    }
  },
  renderer: {
    alpha: true,
    scene: {
      showFloor: true
    }
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

function updateColorOutputs(): void {
  bodyColorValue.value = bodyColor.value.toUpperCase();
  markingsColorValue.value = markingsColor.value.toUpperCase();
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

  return {
    color: bodyColor.value,
    markingsColor: markingsColor.value,
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
    reason: "D4 / D6 / D8 size comparison"
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
  compareButton.disabled = isRolling;
  resetButton.disabled = isRolling;
  rollButton.textContent = isRolling && !comparison ? "Rolling…" : "Roll dice";
  compareButton.textContent = isRolling && comparison
    ? "Rolling D4 + D6 + D8…"
    : "Roll D4 + D6 + D8 together";
}

async function runRequest(request: DiceRollRequest, comparison = false): Promise<void> {
  if (rolling) {
    return;
  }

  debugLogicalResult = undefined;
  debugPlan = undefined;
  debugFinalResult = undefined;
  updateDebugPanel();
  setRollingState(true, comparison);
  setStatus(comparison ? "Rolling D4, D6 and D8…" : "Planning and rolling…", "busy");
  stagePlaceholder.hidden = true;

  try {
    await nextPaint();
    const result = await overlay.roll(request);
    debugFinalResult = result;
    showResult(result);
    updateDebugPanel();
    setStatus(comparison ? "Size comparison complete" : "Roll complete");
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

bodyColor.addEventListener("input", updateColorOutputs);
markingsColor.addEventListener("input", updateColorOutputs);
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
  },
  { once: true }
);

updateColorOutputs();
updateDebugPanel();
