import { describe, expect, it, vi } from "vitest";
import {
  BackgroundRollPlanner,
  DEFAULT_DICE_PHYSICS_CONFIG,
  DEFAULT_STABILITY_CONFIG,
  RollPlanningError,
  type PresimulatedRollPlan,
  type RollPlanningWorkerLike
} from "../src/index.js";
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
});
