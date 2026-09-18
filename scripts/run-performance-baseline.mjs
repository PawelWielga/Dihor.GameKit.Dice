import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { Texture } from "three";
import {
  DiceMeshFactory,
  DiceRollPlayer,
  DiceScene,
  DirectRollPlanner,
  MAX_THROW_FORCE,
  RollPlanner,
  createSeededRandomProvider
} from "../dist/advanced.js";

const args = process.argv.slice(2);
const checkBudgets = args.includes("--check");
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
const budgetsUrl = new URL("../benchmarks/performance-budgets.json", import.meta.url);

if (jsonIndex >= 0 && !jsonPath) {
  throw new Error("--json requires an output path.");
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function sampleScenario(scenario) {
  for (let warmup = 0; warmup < scenario.warmupSamples; warmup += 1) {
    for (let batch = 0; batch < scenario.batchSize; batch += 1) {
      await scenario.run();
    }
  }

  const samples = [];

  for (let sample = 0; sample < scenario.samples; sample += 1) {
    const startedAt = performance.now();

    for (let batch = 0; batch < scenario.batchSize; batch += 1) {
      await scenario.run();
    }

    samples.push((performance.now() - startedAt) / scenario.batchSize);
  }

  const sorted = [...samples].sort((left, right) => left - right);
  return {
    id: scenario.id,
    description: scenario.description,
    samples: scenario.samples,
    batchSize: scenario.batchSize,
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    minMs: round(sorted[0] ?? 0),
    maxMs: round(sorted[sorted.length - 1] ?? 0)
  };
}

const fixedRandom = Object.freeze({ next: () => 0.5 });
const directPlanner = new DirectRollPlanner({ randomProvider: fixedRandom });
const directPlannerFastStable = new DirectRollPlanner({
  randomProvider: fixedRandom,
  stability: {
    consecutiveSteps: 4,
    maxSteps: 480
  }
});

const d6Request = Object.freeze({ dice: Object.freeze([{ sides: 6 }]) });
const mixedRequest = Object.freeze({
  dice: Object.freeze([{ sides: 6 }, { sides: 10 }, { sides: 20 }])
});
const threeD10Request = Object.freeze({
  dice: Object.freeze([{ sides: 10 }, { sides: 10 }, { sides: 10 }])
});
const sixDiceRequest = Object.freeze({
  dice: Object.freeze([
    { sides: 4 },
    { sides: 6 },
    { sides: 8 },
    { sides: 10 },
    { sides: 12 },
    { sides: 20 }
  ])
});

function createCpuPlaybackHarness(request, rollId) {
  const scene = new DiceScene({ showFloor: false });
  const plan = directPlannerFastStable.plan(request, rollId);
  let nextHandle = 1;
  let timestampMs = 0;
  const cancelled = new Set();

  const scheduler = {
    request(callback) {
      const handle = nextHandle++;
      queueMicrotask(() => {
        if (cancelled.delete(handle)) {
          return;
        }

        timestampMs += 1000 / 60;
        callback(timestampMs);
      });
      return handle;
    },
    cancel(handle) {
      cancelled.add(handle);
    }
  };

  const player = new DiceRollPlayer(
    {
      diceScene: scene,
      render() {}
    },
    {
      scheduler,
      maxSubStepsPerFrame: 5
    }
  );

  return {
    async run() {
      await player.play(plan);
    },
    dispose() {
      player.dispose();
      scene.dispose();
    }
  };
}

const d6Playback = createCpuPlaybackHarness(d6Request, "bench-playback-d6");
const mixedPlayback = createCpuPlaybackHarness(mixedRequest, "bench-playback-mixed");

const scenarios = [
  {
    id: "direct-d6",
    description: "Create a one-D6 direct physics plan.",
    warmupSamples: 4,
    samples: 16,
    batchSize: 50,
    run() {
      directPlanner.plan(d6Request, "bench-direct-d6");
    }
  },
  {
    id: "direct-mixed-3",
    description: "Create a mixed D6+D10+D20 direct physics plan.",
    warmupSamples: 4,
    samples: 16,
    batchSize: 30,
    run() {
      directPlanner.plan(mixedRequest, "bench-direct-mixed");
    }
  },
  {
    id: "direct-three-d10-max-force",
    description: "Create a three-D10 direct plan at maximum supported throw force.",
    warmupSamples: 4,
    samples: 16,
    batchSize: 30,
    run() {
      directPlanner.plan(threeD10Request, "bench-direct-d10", {
        throwForce: MAX_THROW_FORCE
      });
    }
  },
  {
    id: "direct-six-dice",
    description: "Validate spawn/layout setup for the complete six-die RPG set.",
    warmupSamples: 4,
    samples: 16,
    batchSize: 20,
    run() {
      directPlanner.plan(sixDiceRequest, "bench-direct-six");
    }
  },
  {
    id: "presimulation-d6-seeded",
    description: "Plan one authoritative D6 result using a fixed seeded physics stream.",
    warmupSamples: 1,
    samples: 5,
    batchSize: 1,
    run() {
      const planner = new RollPlanner({
        randomProvider: createSeededRandomProvider(
          "dihor-dice-performance-v1",
          "presimulation"
        ),
        maxPlanningTimeMs: 5000
      });

      planner.plan({
        rollId: "bench-presimulation-d6",
        dice: [{ sides: 6, value: 1 }],
        modifier: 0,
        total: 1
      });
    }
  },
  {
    id: "playback-d6-cpu",
    description: "Run DiceRollPlayer D6 preparation and physics with a deterministic CPU scheduler.",
    warmupSamples: 1,
    samples: 6,
    batchSize: 1,
    run() {
      return d6Playback.run();
    }
  },
  {
    id: "playback-mixed-3-cpu",
    description: "Run mixed three-die DiceRollPlayer preparation and physics without WebGL.",
    warmupSamples: 1,
    samples: 5,
    batchSize: 1,
    run() {
      return mixedPlayback.run();
    }
  },
  {
    id: "mesh-d6-pips",
    description: "Create and dispose a cold D6 pip mesh.",
    warmupSamples: 3,
    samples: 12,
    batchSize: 10,
    run() {
      const factory = new DiceMeshFactory();
      const mesh = factory.createD6();
      mesh.dispose();
      factory.dispose();
    }
  },
  {
    id: "mesh-d20-numeric",
    description: "Create and dispose a cold D20 numeric-marking mesh.",
    warmupSamples: 3,
    samples: 12,
    batchSize: 5,
    run() {
      const factory = new DiceMeshFactory();
      const mesh = factory.create(20);
      mesh.dispose();
      factory.dispose();
    }
  },
  {
    id: "mesh-d10-textured-memory",
    description: "Prepare a D10 with an in-memory texture loader and dispose all resources.",
    warmupSamples: 2,
    samples: 10,
    batchSize: 5,
    async run() {
      const factory = new DiceMeshFactory({
        textureLoader: {
          async load() {
            return new Texture();
          }
        }
      });
      const mesh = await factory.createAsync(10, {
        appearance: {
          texture: "memory://body"
        }
      });
      mesh.dispose();
      factory.dispose();
    }
  }
];

const results = [];
let benchmarkError;

try {
  for (const scenario of scenarios) {
    results.push(await sampleScenario(scenario));
  }
} catch (error) {
  benchmarkError = error;
} finally {
  d6Playback.dispose();
  mixedPlayback.dispose();
}

if (benchmarkError) {
  throw benchmarkError;
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown"
  },
  results
};

console.table(
  results.map((result) => ({
    scenario: result.id,
    medianMs: result.medianMs,
    p95Ms: result.p95Ms,
    minMs: result.minMs,
    maxMs: result.maxMs
  }))
);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Performance report written to ${jsonPath}.`);
}

if (checkBudgets) {
  const budgets = JSON.parse(readFileSync(fileURLToPath(budgetsUrl), "utf8"));
  const failures = [];

  for (const result of results) {
    const budget = budgets.scenarios?.[result.id];

    if (!budget) {
      failures.push(`${result.id}: missing performance budget`);
      continue;
    }

    if (result.medianMs > budget.maxMedianMs) {
      failures.push(
        `${result.id}: median ${result.medianMs} ms exceeds ${budget.maxMedianMs} ms`
      );
    }

    if (result.p95Ms > budget.maxP95Ms) {
      failures.push(
        `${result.id}: p95 ${result.p95Ms} ms exceeds ${budget.maxP95Ms} ms`
      );
    }
  }

  if (failures.length > 0) {
    console.error("\nSevere performance regression guard failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll severe-regression performance budgets passed.");
  }
}
