import { describe, expect, it, vi } from "vitest";
import {
  BackgroundRollPlanner,
  DirectRollPlanner,
  DEFAULT_DICE_PHYSICS_CONFIG,
  DEFAULT_STABILITY_CONFIG,
  RollPlanningError,
  type PresimulatedRollPlan,
  type RollPlanningWorkerLike
} from "../src/advanced.js";
import type {
  RollPlanningWorkerRequest,
  RollPlanningWorkerResponse
} from "../src/physics/RollPlannerWorkerProtocol.js";

class FakeWorker implements RollPlanningWorkerLike {
  onmessage: ((event: { readonly data: RollPlanningWorkerResponse }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly postMessage = vi.fn((request: RollPlanningWorkerRequest) => {
    const plan: PresimulatedRollPlan = {
      rollId: request.result.rollId,
      dice: request.result.dice.map((die) => ({
        sides: die.sides,
        expectedValue: die.value,
        initialState: {
          position: { x: 0, y: 1, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 }
        }
      })),
      physics: DEFAULT_DICE_PHYSICS_CONFIG,
      stability: DEFAULT_STABILITY_CONFIG,
      simulationSteps: 12,
      preSimulated: true
    };

    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, ok: true, plan } }));
  });
  readonly terminate = vi.fn();
}

const result = {
  rollId: "background-test",
  dice: [{ sides: 10 as const, value: 7 }],
  modifier: 0,
  total: 7
};

function createAuthoritativePlan(): PresimulatedRollPlan {
  return {
    rollId: result.rollId,
    dice: [{
      sides: 10,
      expectedValue: 7,
      initialState: {
        position: { x: 0, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 }
      }
    }],
    physics: DEFAULT_DICE_PHYSICS_CONFIG,
    stability: DEFAULT_STABILITY_CONFIG,
    simulationSteps: 1,
    preSimulated: true
  };
}

describe("BackgroundRollPlanner", () => {
  it("delegates planning to a worker and resolves asynchronously", async () => {
    const worker = new FakeWorker();
    const planner = new BackgroundRollPlanner({ workerFactory: () => worker });
    let resolved = false;

    const pending = planner.plan(result, { throwForce: 1.5 }).then((plan) => {
      resolved = true;
      return plan;
    });

    expect(resolved).toBe(false);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0]?.[0].options.throwForce).toBe(1.5);

    const plan = await pending;
    expect(plan.rollId).toBe("background-test");
    expect(plan.dice[0]?.expectedValue).toBe(7);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    planner.dispose();
  });

  it("cancels active worker planning and rejects the pending request", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => undefined);
    const planner = new BackgroundRollPlanner({ workerFactory: () => worker });

    const pending = planner.plan(result);
    planner.cancel();

    await expect(pending).rejects.toBeInstanceOf(RollPlanningError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    planner.dispose();
  });

  it("reports whether timing used a background worker", async () => {
    const worker = new FakeWorker();
    const timings: Array<{ durationMs: number; usedWorker: boolean }> = [];
    let now = 10;
    const planner = new BackgroundRollPlanner({
      workerFactory: () => worker,
      nowProvider: () => (now += 5),
      onTiming: (timing) => timings.push(timing)
    });

    await planner.plan(result);

    expect(timings).toEqual([{ durationMs: 5, usedWorker: true }]);
    planner.dispose();
  });

  it("preserves the authoritative result by default when Worker creation is unavailable", async () => {
    const fallbackPlan = createAuthoritativePlan();
    const fallbackPlanner = { plan: vi.fn(() => fallbackPlan) };
    const planner = new BackgroundRollPlanner({
      workerFactory: () => undefined,
      fallbackPlanner: fallbackPlanner as never
    });

    const plan = await planner.plan(result);

    expect(plan).toBe(fallbackPlan);
    expect(plan.preSimulated).toBe(true);
    expect(plan.dice[0]?.expectedValue).toBe(7);
    expect(fallbackPlanner.plan).toHaveBeenCalledWith(result, {});
    planner.dispose();
  });

  it("still supports an explicit direct fallback for low-level consumers", async () => {
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "direct",
      workerFactory: () => undefined,
      directPlanner: new DirectRollPlanner({
        randomProvider: { next: () => 0.5 }
      })
    });

    const plan = await planner.plan(result);

    expect(plan.preSimulated).toBe(false);
    expect(plan.dice[0]?.expectedValue).toBe(0);
    planner.dispose();
  });

  it("preserves the authoritative result when a created Worker fails at runtime", async () => {
    const worker = new FakeWorker();
    const fallbackPlan = createAuthoritativePlan();
    const fallbackPlanner = { plan: vi.fn(() => fallbackPlan) };
    const timings: Array<{ durationMs: number; usedWorker: boolean }> = [];
    worker.postMessage.mockImplementation(() => {
      worker.onerror?.({ message: "" });
    });
    const planner = new BackgroundRollPlanner({
      workerFactory: () => worker,
      fallbackPlanner: fallbackPlanner as never,
      onTiming: (timing) => timings.push(timing)
    });

    const plan = await planner.plan(result);

    expect(plan).toBe(fallbackPlan);
    expect(plan.preSimulated).toBe(true);
    expect(plan.dice[0]?.expectedValue).toBe(7);
    expect(fallbackPlanner.plan).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(timings).toHaveLength(1);
    expect(timings[0]?.usedWorker).toBe(false);
    planner.dispose();
  });

  it("uses synchronous fallback when a created Worker fails at runtime", async () => {
    const fallbackPlan: PresimulatedRollPlan = {
      rollId: result.rollId,
      dice: [{
        sides: 10,
        expectedValue: 7,
        initialState: {
          position: { x: 0, y: 1, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 }
        }
      }],
      physics: DEFAULT_DICE_PHYSICS_CONFIG,
      stability: DEFAULT_STABILITY_CONFIG,
      simulationSteps: 1,
      preSimulated: true
    };
    const fallbackPlanner = {
      plan: vi.fn(() => fallbackPlan)
    };
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      worker.onerror?.({ message: "Worker startup failed" });
    });
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "synchronous",
      workerFactory: () => worker,
      fallbackPlanner: fallbackPlanner as never
    });

    const plan = await planner.plan(result);

    expect(plan).toBe(fallbackPlan);
    expect(fallbackPlanner.plan).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    planner.dispose();
  });

  it("preserves Worker runtime failures with the explicit error fallback", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      worker.onerror?.({ message: "Worker startup failed" });
    });
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "error",
      workerFactory: () => worker
    });

    await expect(planner.plan(result)).rejects.toThrowError(/Worker startup failed/i);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    planner.dispose();
  });

  it("preserves authoritative values when postMessage throws and remains reusable", async () => {
    const worker = new FakeWorker();
    const fallbackPlanner = { plan: vi.fn(() => createAuthoritativePlan()) };
    worker.postMessage.mockImplementation(() => {
      throw new Error("DataCloneError");
    });
    const planner = new BackgroundRollPlanner({
      workerFactory: () => worker,
      fallbackPlanner: fallbackPlanner as never
    });

    const firstPlan = await planner.plan(result);
    const secondPlan = await planner.plan(result);

    expect(firstPlan.preSimulated).toBe(true);
    expect(secondPlan.preSimulated).toBe(true);
    expect(firstPlan.dice[0]?.expectedValue).toBe(7);
    expect(secondPlan.dice[0]?.expectedValue).toBe(7);
    expect(fallbackPlanner.plan).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(2);
    planner.dispose();
  });

  it("supports an explicit synchronous fallback", async () => {
    const fallbackPlan: PresimulatedRollPlan = {
      rollId: result.rollId,
      dice: [{
        sides: 10,
        expectedValue: 7,
        initialState: {
          position: { x: 0, y: 1, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 }
        }
      }],
      physics: DEFAULT_DICE_PHYSICS_CONFIG,
      stability: DEFAULT_STABILITY_CONFIG,
      simulationSteps: 1,
      preSimulated: true
    };
    const fallbackPlanner = {
      plan: vi.fn(() => fallbackPlan)
    };
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "synchronous",
      workerFactory: () => undefined,
      fallbackPlanner: fallbackPlanner as never
    });

    const plan = await planner.plan(result);

    expect(plan).toBe(fallbackPlan);
    expect(fallbackPlanner.plan).toHaveBeenCalledTimes(1);
    planner.dispose();
  });

  it("fails clearly with the explicit error fallback", async () => {
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "error",
      workerFactory: () => undefined
    });

    await expect(planner.plan(result)).rejects.toThrowError(/requires a Web Worker/i);
    planner.dispose();
  });

  it("applies fallback behavior when the Worker factory throws during creation", async () => {
    const planner = new BackgroundRollPlanner({
      fallbackStrategy: "error",
      workerFactory: () => {
        throw new Error("Worker construction failed");
      }
    });

    await expect(planner.plan(result)).rejects.toThrowError(/requires a Web Worker/i);
    planner.dispose();
  });

  it("can cancel deferred direct fallback before main-thread work starts", async () => {
    vi.useFakeTimers();
    try {
      const planner = new BackgroundRollPlanner({
        fallbackStrategy: "direct",
        workerFactory: () => undefined,
        directPlanner: new DirectRollPlanner({
          randomProvider: { next: () => 0.5 }
        })
      });

      const pending = planner.plan(result);
      planner.cancel();
      await expect(pending).rejects.toThrowError(/cancelled/i);
      await vi.runAllTimersAsync();
      planner.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("can cancel deferred synchronous fallback before it blocks the main thread", async () => {
    vi.useFakeTimers();
    try {
      const fallbackPlanner = { plan: vi.fn() };
      const planner = new BackgroundRollPlanner({
        fallbackStrategy: "synchronous",
        workerFactory: () => undefined,
        fallbackPlanner: fallbackPlanner as never
      });

      const pending = planner.plan(result);
      planner.cancel();
      await expect(pending).rejects.toThrowError(/cancelled/i);
      await vi.runAllTimersAsync();
      expect(fallbackPlanner.plan).not.toHaveBeenCalled();
      planner.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
