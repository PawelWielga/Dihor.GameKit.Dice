import type { DiceRollRequest, DiceRollResult } from "../core/index.js";
import { DirectRollPlanner } from "./DirectRollPlanner.js";
import { RollPlanner, RollPlanningError, type RollPlanningOptions } from "./RollPlanner.js";
import type { RollPlan } from "./RollModels.js";
import type {
  RollPlanningWorkerRequest,
  RollPlanningWorkerResponse
} from "./RollPlannerWorkerProtocol.js";

export interface RollPlanningWorkerLike {
  onmessage: ((event: { readonly data: RollPlanningWorkerResponse }) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: RollPlanningWorkerRequest): void;
  terminate(): void;
}

export type RollPlanningWorkerFactory = () => RollPlanningWorkerLike | undefined;

export type BackgroundRollFallbackStrategy = "direct" | "synchronous" | "error";

export interface BackgroundRollPlanningTiming {
  readonly durationMs: number;
  readonly usedWorker: boolean;
}

export interface BackgroundRollPlannerOptions {
  /**
   * Behavior when a planning Worker cannot be created.
   * Defaults to "direct" so interactive browser consumers never unexpectedly block the UI thread.
   */
  readonly fallbackStrategy?: BackgroundRollFallbackStrategy;
  /** Used only by the explicit "synchronous" fallback. */
  readonly fallbackPlanner?: RollPlanner;
  /** Used only by the "direct" fallback. */
  readonly directPlanner?: DirectRollPlanner;
  /** Injection point for tests or non-browser Worker implementations. */
  readonly workerFactory?: RollPlanningWorkerFactory;
  readonly nowProvider?: () => number;
  readonly onTiming?: (timing: BackgroundRollPlanningTiming) => void;
}

interface ActivePlanning {
  readonly id: number;
  readonly reject: (reason: Error) => void;
  readonly startedAt: number;
  readonly worker?: RollPlanningWorkerLike;
  fallbackHandle?: ReturnType<typeof setTimeout>;
}

function createBrowserPlanningWorker(): RollPlanningWorkerLike | undefined {
  if (typeof Worker !== "function") {
    return undefined;
  }

  try {
    return new Worker(new URL("./RollPlannerWorker.ts", import.meta.url), {
      type: "module",
      name: "dihor-gamekit-dice-planner"
    }) as unknown as RollPlanningWorkerLike;
  } catch {
    return undefined;
  }
}

function toDirectRequest(result: DiceRollResult): DiceRollRequest {
  return {
    dice: result.dice.map((die) => ({ sides: die.sides })),
    modifier: result.modifier,
    ...(result.reason === undefined ? {} : { reason: result.reason })
  };
}

/**
 * Runs hidden presimulation away from the browser main thread whenever Worker is available.
 * When Worker creation is unavailable, the fallback behavior is explicit and configurable.
 */
export class BackgroundRollPlanner {
  private readonly fallbackStrategy: BackgroundRollFallbackStrategy;
  private readonly fallbackPlanner: RollPlanner;
  private readonly directPlanner: DirectRollPlanner;
  private readonly workerFactory: RollPlanningWorkerFactory;
  private readonly nowProvider: () => number;
  private readonly onTiming?: (timing: BackgroundRollPlanningTiming) => void;
  private active?: ActivePlanning;
  private nextId = 1;
  private disposed = false;

  constructor(options: BackgroundRollPlannerOptions = {}) {
    this.fallbackStrategy = options.fallbackStrategy ?? "direct";
    this.fallbackPlanner = options.fallbackPlanner ?? new RollPlanner();
    this.directPlanner = options.directPlanner ?? new DirectRollPlanner();
    this.workerFactory = options.workerFactory ?? createBrowserPlanningWorker;
    this.nowProvider = options.nowProvider ?? (() => performance.now());
    this.onTiming = options.onTiming;
  }

  plan(result: DiceRollResult, options: RollPlanningOptions = {}): Promise<RollPlan> {
    if (this.disposed) {
      return Promise.reject(new Error("BackgroundRollPlanner has been disposed."));
    }

    if (this.active) {
      return Promise.reject(new RollPlanningError("A roll plan is already being prepared."));
    }

    const id = this.nextId++;
    const startedAt = this.nowProvider();
    let worker: RollPlanningWorkerLike | undefined;

    try {
      worker = this.workerFactory();
    } catch {
      worker = undefined;
    }

    return new Promise<RollPlan>((resolve, reject) => {
      const active: ActivePlanning = { id, reject, startedAt, ...(worker ? { worker } : {}) };
      this.active = active;

      const finish = (plan: RollPlan, usedWorker: boolean): void => {
        if (this.active !== active) {
          return;
        }

        this.active = undefined;
        worker?.terminate();
        this.onTiming?.({
          durationMs: Math.max(0, this.nowProvider() - startedAt),
          usedWorker
        });
        resolve(plan);
      };

      const fail = (error: Error): void => {
        if (this.active !== active) {
          return;
        }

        this.active = undefined;
        worker?.terminate();
        reject(error);
      };

      if (worker) {
        worker.onmessage = (event) => {
          const response = event.data;

          if (response.id !== id) {
            return;
          }

          if (response.ok) {
            finish(response.plan, true);
          } else {
            fail(new RollPlanningError(response.error.message));
          }
        };
        worker.onerror = (event) => {
          fail(new RollPlanningError(event.message ?? "Background roll planning worker failed."));
        };
        worker.postMessage({ id, result, options });
        return;
      }

      if (this.fallbackStrategy === "error") {
        fail(
          new RollPlanningError(
            "Background roll planning requires a Web Worker; no Worker could be created."
          )
        );
        return;
      }

      active.fallbackHandle = setTimeout(() => {
        if (this.active !== active) {
          return;
        }

        try {
          if (this.fallbackStrategy === "direct") {
            finish(
              this.directPlanner.plan(toDirectRequest(result), result.rollId, options),
              false
            );
          } else {
            finish(this.fallbackPlanner.plan(result, options), false);
          }
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new RollPlanningError(`Background roll planning failed: ${String(error)}.`)
          );
        }
      }, 0);
    });
  }

  cancel(): void {
    const active = this.active;

    if (!active) {
      return;
    }

    this.active = undefined;
    if (active.fallbackHandle !== undefined) {
      clearTimeout(active.fallbackHandle);
    }
    active.worker?.terminate();
    active.reject(new RollPlanningError("Roll planning was cancelled."));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.cancel();
    this.disposed = true;
  }
}
