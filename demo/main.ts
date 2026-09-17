import {
  DiceOverlay,
  DiceRoller,
  RollPlanner,
  type DiceAppearance,
  type DiceRollRequest,
  type DiceRollResult,
  type RollPlan
} from "../src/index.js";

const SAMPLE_TEXTURE_URL = "https://threejs.org/examples/textures/uv_grid_opengl.jpg";

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

function createAppearance(): DiceAppearance {
  const faces: Partial<Record<number, string>> = {};

  for (let index = 0; index < faceTextureInputs.length; index += 1) {
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
  if (diceType.value !== "6") {
    throw new Error(`The demo currently supports only D6; received D${diceType.value}.`);
  }

  const count = Number.parseInt(diceCount.value, 10);

  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new Error(`Dice count must be between 1 and 3; received ${diceCount.value}.`);
  }

  const numericModifier = Number(modifier.value || "0");

  if (!Number.isFinite(numericModifier)) {
    throw new Error("Modifier must be a finite number.");
  }

  const appearance = createAppearance();
  const rollReason = reason.value.trim();

  return {
    dice: Array.from({ length: count }, () => ({
      sides: 6 as const,
      appearance
    })),
    modifier: numericModifier,
    ...(rollReason ? { reason: rollReason } : {})
  };
}

function formatDiceExpression(result: DiceRollResult): string {
  const values = result.dice.map((die) => String(die.value));
  let expression = values.join(" + ");

  if (result.modifier > 0) {
    expression += ` + ${result.modifier}`;
  } else if (result.modifier < 0) {
    expression += ` - ${Math.abs(result.modifier)}`;
  }

  return values.length > 1 || result.modifier !== 0
    ? `${expression} = ${result.total}`
    : `D6 → ${result.total}`;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (rollButton.disabled) {
    return;
  }

  debugLogicalResult = undefined;
  debugPlan = undefined;
  debugFinalResult = undefined;
  updateDebugPanel();

  rollButton.disabled = true;
  resetButton.disabled = true;
  rollButton.textContent = "Rolling…";
  setStatus("Planning and rolling…", "busy");
  stagePlaceholder.hidden = true;

  try {
    const request = createRequest();
    await nextPaint();
    const result = await overlay.roll(request);
    debugFinalResult = result;
    showResult(result);
    updateDebugPanel();
    setStatus("Roll complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resultValue.textContent = "!";
    resultDice.textContent = "Roll failed";
    resultJson.textContent = JSON.stringify({ error: message }, null, 2);
    updateDebugPanel();
    setStatus("Roll failed", "error");
    console.error("PartyBeam.DiceKit demo roll failed", error);
  } finally {
    rollButton.disabled = false;
    resetButton.disabled = false;
    rollButton.textContent = "Roll dice";
  }
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
