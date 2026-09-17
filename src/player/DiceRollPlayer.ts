import type { Body } from "cannon-es";
import type { D6FaceValue } from "../core/dice/index.js";
import {
  DicePhysicsWorld,
  resolveStabilityConfig,
  type RollPlan,
  type StabilityConfig
} from "../physics/index.js";
import {
  DiceMeshFactory,
  type DiceMesh,
  type DiceScene
} from "../three/index.js";

export interface DiceRenderTarget {
  readonly diceScene: DiceScene;
  render(): void;
}

export interface DiceAnimationScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export interface DiceRollPlayerOptions {
  readonly meshFactory?: DiceMeshFactory;
  readonly scheduler?: DiceAnimationScheduler;
  readonly maxSubStepsPerFrame?: number;
}

export interface DiceRollPlaybackDieResult {
  readonly sides: 6;
  readonly value: D6FaceValue;
}

export interface DiceRollPlaybackResult {
  readonly rollId: string;
  readonly dice: readonly DiceRollPlaybackDieResult[];
  readonly simulationSteps: number;
}

export class DiceRollPlaybackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiceRollPlaybackError";
  }
}

interface PlaybackSession {
  readonly plan: RollPlan;
  readonly world: DicePhysicsWorld;
  readonly bodies: readonly Body[];
  readonly meshes: readonly DiceMesh[];
  readonly stability: StabilityConfig;
  readonly scheduler: DiceAnimationScheduler;
  readonly resolve: (result: DiceRollPlaybackResult) => void;
  readonly reject: (reason: DiceRollPlaybackError) => void;
  frameHandle?: number;
  lastTimestampMs?: number;
  accumulatorSeconds: number;
  simulationSteps: number;
  stableSteps: number;
}

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a positive integer; received ${String(value)}.`);
  }

  return value;
}

function createBrowserScheduler(): DiceAnimationScheduler {
  if (
    typeof globalThis.requestAnimationFrame !== "function" ||
    typeof globalThis.cancelAnimationFrame !== "function"
  ) {
    throw new DiceRollPlaybackError(
      "DiceRollPlayer requires requestAnimationFrame or an injected animation scheduler."
    );
  }

  return {
    request: (callback) => globalThis.requestAnimationFrame(callback),
    cancel: (handle) => globalThis.cancelAnimationFrame(handle)
  };
}

function toPlaybackError(error: unknown): DiceRollPlaybackError {
  if (error instanceof DiceRollPlaybackError) {
    return error;
  }

  if (error instanceof Error) {
    return new DiceRollPlaybackError(error.message, { cause: error });
  }

  return new DiceRollPlaybackError(`Dice roll playback failed: ${String(error)}.`);
}

/** Replays a RollPlan with real cannon-es physics and synchronizes D6 meshes into a DiceScene. */
export class DiceRollPlayer {
  private readonly target: DiceRenderTarget;
  private readonly meshFactory: DiceMeshFactory;
  private readonly scheduler?: DiceAnimationScheduler;
  private readonly maxSubStepsPerFrame: number;

  private activeSession?: PlaybackSession;
  private visibleMeshes: DiceMesh[] = [];
  private disposed = false;

  constructor(target: DiceRenderTarget, options: DiceRollPlayerOptions = {}) {
    this.target = target;
    this.meshFactory = options.meshFactory ?? new DiceMeshFactory();
    this.scheduler = options.scheduler;
    this.maxSubStepsPerFrame = requirePositiveInteger(
      "maxSubStepsPerFrame",
      options.maxSubStepsPerFrame ?? 5
    );
  }

  async play(plan: RollPlan): Promise<DiceRollPlaybackResult> {
    this.assertActive();

    if (this.activeSession) {
      throw new DiceRollPlaybackError("A dice roll is already playing.");
    }

    this.validatePlan(plan);
    this.clearVisibleMeshes();

    const scheduler = this.scheduler ?? createBrowserScheduler();
    const world = new DicePhysicsWorld(plan.physics);
    const meshes: DiceMesh[] = [];

    try {
      const bodies = plan.dice.map((die) => world.addD6(die.initialState));

      for (const die of plan.dice) {
        const mesh = this.meshFactory.createD6({ size: plan.physics.diceSize });
        meshes.push(mesh);
        this.target.diceScene.add(mesh.object);
      }

      this.visibleMeshes = meshes;
      this.syncMeshes(bodies, meshes);
      this.target.render();

      return await new Promise<DiceRollPlaybackResult>((resolve, reject) => {
        const session: PlaybackSession = {
          plan,
          world,
          bodies,
          meshes,
          stability: resolveStabilityConfig(plan.stability),
          scheduler,
          resolve,
          reject,
          accumulatorSeconds: 0,
          simulationSteps: 0,
          stableSteps: 0
        };

        this.activeSession = session;
        this.scheduleFrame(session);
      });
    } catch (error) {
      if (this.activeSession?.world === world) {
        this.activeSession = undefined;
      }

      world.dispose();
      this.removeAndDisposeMeshes(meshes);
      this.visibleMeshes = [];
      throw error;
    }
  }

  cancel(): void {
    if (!this.activeSession) {
      return;
    }

    this.failSession(this.activeSession, new DiceRollPlaybackError("Dice roll playback was cancelled."));
  }

  clear(): void {
    this.cancel();
    this.clearVisibleMeshes();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clear();
    this.disposed = true;
  }

  private scheduleFrame(session: PlaybackSession): void {
    session.frameHandle = session.scheduler.request((timestampMs) => {
      try {
        this.onFrame(session, timestampMs);
      } catch (error) {
        this.failSession(session, toPlaybackError(error));
      }
    });
  }

  private onFrame(session: PlaybackSession, timestampMs: number): void {
    if (this.activeSession !== session) {
      return;
    }

    if (!Number.isFinite(timestampMs)) {
      this.failSession(session, new DiceRollPlaybackError("Animation scheduler returned an invalid timestamp."));
      return;
    }

    if (session.lastTimestampMs === undefined) {
      session.lastTimestampMs = timestampMs;
      this.target.render();
      this.scheduleFrame(session);
      return;
    }

    const deltaSeconds = Math.max(0, (timestampMs - session.lastTimestampMs) / 1000);
    session.lastTimestampMs = timestampMs;
    const maxAccumulatedSeconds = session.plan.physics.timeStep * this.maxSubStepsPerFrame;
    session.accumulatorSeconds += Math.min(deltaSeconds, maxAccumulatedSeconds);

    let subSteps = 0;

    while (
      session.accumulatorSeconds + Number.EPSILON >= session.plan.physics.timeStep &&
      subSteps < this.maxSubStepsPerFrame
    ) {
      session.world.step();
      session.simulationSteps += 1;
      subSteps += 1;
      session.accumulatorSeconds = Math.max(
        0,
        session.accumulatorSeconds - session.plan.physics.timeStep
      );

      if (
        session.world.areBodiesStable(
          session.bodies,
          session.stability.linearThreshold,
          session.stability.angularThreshold
        )
      ) {
        session.stableSteps += 1;
      } else {
        session.stableSteps = 0;
      }

      if (session.stableSteps >= session.stability.consecutiveSteps) {
        this.syncMeshes(session.bodies, session.meshes);
        this.target.render();
        this.finishSession(session);
        return;
      }

      if (session.simulationSteps >= session.stability.maxSteps) {
        this.failSession(
          session,
          new DiceRollPlaybackError(
            `Visible dice simulation did not stabilize within ${session.stability.maxSteps} steps.`
          )
        );
        return;
      }
    }

    this.syncMeshes(session.bodies, session.meshes);
    this.target.render();
    this.scheduleFrame(session);
  }

  private finishSession(session: PlaybackSession): void {
    const observed = session.bodies.map((body) => session.world.getD6Value(body));

    for (let index = 0; index < observed.length; index += 1) {
      const actualValue = observed[index];
      const expectedDie = session.plan.dice[index];

      if (actualValue === undefined || !expectedDie || actualValue !== expectedDie.expectedValue) {
        this.failSession(
          session,
          new DiceRollPlaybackError(
            `Visible D6 result mismatch at index ${index}: expected ${expectedDie?.expectedValue ?? "unknown"}, received ${actualValue ?? "unknown"}.`
          )
        );
        return;
      }
    }

    this.cancelScheduledFrame(session);
    session.world.dispose();
    this.activeSession = undefined;
    session.resolve({
      rollId: session.plan.rollId,
      dice: observed.map((value) => ({ sides: 6, value })),
      simulationSteps: session.simulationSteps
    });
  }

  private failSession(session: PlaybackSession, error: DiceRollPlaybackError): void {
    if (this.activeSession !== session) {
      return;
    }

    this.cancelScheduledFrame(session);
    session.world.dispose();
    this.removeAndDisposeMeshes(session.meshes);
    this.visibleMeshes = [];
    this.activeSession = undefined;
    session.reject(error);
  }

  private cancelScheduledFrame(session: PlaybackSession): void {
    if (session.frameHandle !== undefined) {
      session.scheduler.cancel(session.frameHandle);
      session.frameHandle = undefined;
    }
  }

  private syncMeshes(bodies: readonly Body[], meshes: readonly DiceMesh[]): void {
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      const mesh = meshes[index];

      if (!body || !mesh) {
        continue;
      }

      this.target.diceScene.applyTransform(mesh.object, {
        position: {
          x: body.position.x,
          y: body.position.y,
          z: body.position.z
        },
        quaternion: {
          x: body.quaternion.x,
          y: body.quaternion.y,
          z: body.quaternion.z,
          w: body.quaternion.w
        }
      });
    }
  }

  private validatePlan(plan: RollPlan): void {
    if (plan.dice.length < 1 || plan.dice.length > 3) {
      throw new RangeError("DiceRollPlayer currently supports between one and three dice.");
    }

    requirePositiveInteger("simulationSteps", plan.simulationSteps);
    resolveStabilityConfig(plan.stability);

    for (let index = 0; index < plan.dice.length; index += 1) {
      const die = plan.dice[index];

      if (!die) {
        throw new RangeError(`Roll plan contains no die at index ${index}.`);
      }

      if (
        die.sides !== 6 ||
        !Number.isInteger(die.expectedValue) ||
        die.expectedValue < 1 ||
        die.expectedValue > 6
      ) {
        throw new RangeError(`Unsupported or invalid D6 plan at index ${index}.`);
      }
    }
  }

  private clearVisibleMeshes(): void {
    this.removeAndDisposeMeshes(this.visibleMeshes);
    this.visibleMeshes = [];
  }

  private removeAndDisposeMeshes(meshes: readonly DiceMesh[]): void {
    for (const mesh of meshes) {
      this.target.diceScene.remove(mesh.object);
      mesh.dispose();
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new DiceRollPlaybackError("DiceRollPlayer has been disposed.");
    }
  }
}
