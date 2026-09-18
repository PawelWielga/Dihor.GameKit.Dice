import { DiceOverlay } from "../src/index.js";
import { BackgroundRollPlanner } from "../src/advanced.js";

interface CaseResult {
  readonly name: string;
  readonly durationMs: number;
}

const fixturesElement = document.querySelector<HTMLDivElement>("#fixtures");
const outputElement = document.querySelector<HTMLPreElement>("#browser-smoke-result");

if (!fixturesElement || !outputElement) {
  throw new Error("Browser smoke fixture DOM is incomplete.");
}

const fixtures: HTMLDivElement = fixturesElement;
const output: HTMLPreElement = outputElement;
const results: CaseResult[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "fixture";
  fixtures.appendChild(host);
  return host;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function withTimeout<T>(label: string, task: Promise<T>, timeoutMs = 20_000): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  }
}

async function runCase(name: string, action: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await action();
  results.push({ name, durationMs: Math.round(performance.now() - started) });
}

async function run(): Promise<void> {
  assert(typeof Worker === "function", "Web Worker is unavailable.");
  assert(typeof requestAnimationFrame === "function", "requestAnimationFrame is unavailable.");
  assert(typeof ResizeObserver === "function", "ResizeObserver is unavailable.");

  await runCase("D6 presimulation uses Worker and WebGL", async () => {
    const host = createHost();
    let usedWorker = false;
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "error",
      onTiming: (timing) => {
        usedWorker = timing.usedWorker;
      }
    });
    const overlay = new DiceOverlay({
      container: host,
      showOverlay: false,
      planner
    });

    try {
      const result = await withTimeout(
        "D6 presimulated roll",
        overlay.roll({ dice: [{ sides: 6 }] }, { preSimulation: true })
      );
      assert(result.dice.length === 1 && result.dice[0]?.sides === 6, "D6 result is invalid.");
      assert(usedWorker, "Presimulation did not use a Web Worker.");
      assert(host.querySelector("canvas") instanceof HTMLCanvasElement, "WebGL canvas was not mounted.");
    } finally {
      overlay.dispose();
      assert(host.querySelector("canvas") === null, "Canvas was not cleaned up after D6 roll.");
      host.remove();
    }
  });

  await runCase("D20 direct roll survives viewport resize", async () => {
    const host = createHost();
    const overlay = new DiceOverlay({ container: host, showOverlay: false });

    try {
      const pending = overlay.roll({ dice: [{ sides: 20 }] }, { preSimulation: false });
      await nextFrame();
      await nextFrame();

      const canvas = host.querySelector("canvas");
      assert(canvas instanceof HTMLCanvasElement, "D20 canvas was not mounted.");
      const beforeWidth = canvas.width;

      host.style.width = "420px";
      host.style.height = "300px";
      window.dispatchEvent(new Event("resize"));
      await nextFrame();
      await nextFrame();

      assert(canvas.width !== beforeWidth, "Canvas did not resize during active playback.");

      const result = await withTimeout("D20 direct roll", pending);
      assert(result.dice[0]?.sides === 20, "D20 result is invalid.");
      assert((result.dice[0]?.value ?? 0) >= 1 && (result.dice[0]?.value ?? 0) <= 20, "D20 value is out of range.");
    } finally {
      overlay.dispose();
      host.remove();
    }
  });

  await runCase("Mixed dice with texture-backed appearance", async () => {
    const host = createHost();
    const overlay = new DiceOverlay({ container: host, showOverlay: false });
    const texture =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%2388aaff'/%3E%3C/svg%3E";

    try {
      const result = await withTimeout(
        "mixed textured roll",
        overlay.roll(
          {
            dice: [
              { sides: 6, appearance: { texture } },
              { sides: 8 },
              { sides: 10 }
            ]
          },
          { preSimulation: false }
        )
      );

      assert(result.dice.map((die) => die.sides).join(",") === "6,8,10", "Mixed dice sides are invalid.");
      assert(result.dice.every((die) => die.value >= 1 && die.value <= die.sides), "Mixed dice value is out of range.");
    } finally {
      overlay.dispose();
      host.remove();
    }
  });

  await runCase("Cancellation cleans active playback", async () => {
    const host = createHost();
    const overlay = new DiceOverlay({ container: host, showOverlay: false });
    const pending = overlay.roll(
      { dice: Array.from({ length: 6 }, () => ({ sides: 20 as const })) },
      { preSimulation: false }
    );

    await nextFrame();
    overlay.close();

    let rejected = false;
    try {
      await pending;
    } catch {
      rejected = true;
    }

    assert(rejected, "Cancelled roll unexpectedly resolved.");
    assert(host.querySelector("canvas") === null, "Canvas remained mounted after cancellation.");
    overlay.dispose();
    host.remove();
  });
}

run()
  .then(() => {
    document.body.dataset.browserSmokeStatus = "passed";
    output.textContent = JSON.stringify({ status: "passed", results }, null, 2);
  })
  .catch((error: unknown) => {
    document.body.dataset.browserSmokeStatus = "failed";
    output.textContent = JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        results
      },
      null,
      2
    );
  });
