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
   * Behavior when a planning Worker cannot be created or fails before producing a plan.
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
  worker?: RollPlanningWorkerLike;
  fallbackHandle?: ReturnType<typeof setTimeout>;
}

function resolveFallbackStrategy(
  value: BackgroundRollFallbackStrategy | undefined
): BackgroundRollFallbackStrategy {
  const resolved = value ?? "direct";

  if (resolved !== "direct" && resolved !== "synchronous" && resolved !== "error") {
    throw new RangeError(
      `fallbackStrategy must be "direct", "synchronous" or "error"; received ${String(resolved)}.`
    );
  }

  return resolved;
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

function workerFailureError(error: unknown): RollPlanningError {
  const detail = error instanceof Error ? error.message : String(error);
  return new RollPlanningError(
    detail.length > 0
      ? `Background roll planning worker failed: ${detail}`
      : "Background roll planning worker failed."
  );
}

/**
 * Runs hidden presimulation away from the browser main thread whenever Worker is available.
 * When Worker creation/startup is unavailable, the fallback behavior is explicit and configurable.
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
    this.fallbackStrategy = resolveFallbackStrategy(options.fallbackStrategy);
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

      const stopWorker = (): void => {
        const currentWorker = worker ?? active.worker;

        if (!currentWorker) {
          return;
        }

        currentWorker.onmessage = null;
        currentWorker.onerror = null;
        currentWorker.terminate();
        worker = undefined;
        active.worker = undefined;
      };

      const finish = (plan: RollPlan, usedWorker: boolean): void => {
        if (this.active !== active) {
          return;
        }

        this.active = undefined;
        stopWorker();
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
        stopWorker();
        reject(error);
      };

      const scheduleFallback = (workerError?: Error): void => {
        if (this.active !== active) {
          return;
        }

        stopWorker();

        if (this.fallbackStrategy === "error") {
          fail(
            workerError ??
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
          const message = event.message?.trim();
          scheduleFallback(
            new RollPlanningError(message || "Background roll planning worker failed.")
          );
        };

        try {
          worker.postMessage({ id, result, options });
        } catch (error) {
          scheduleFallback(workerFailureError(error));
        }
        return;
      }

      scheduleFallback();
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
