import { describe, expect, it, vi } from "vitest";
import {
  DiceRollPlaybackError,
  DiceRollPlayer,
  DiceScene,
  RollPlanner,
  type DiceAnimationScheduler,
  type DiceRenderTarget,
  type RollInitialStateContext,
  type RollPlan
} from "../src/index.js";

class ManualScheduler implements DiceAnimationScheduler {
  private nextHandle = 1;
  private timestampMs = 0;
  private readonly callbacks = new Map<number, (timestampMs: number) => void>();

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  runFrames(count: number, frameMs = 1000 / 60): void {
    for (let frame = 0; frame < count; frame += 1) {
      const entry = this.callbacks.entries().next().value as
        | [number, (timestampMs: number) => void]
        | undefined;

      if (!entry) {
        return;
      }

      const [handle, callback] = entry;
      this.callbacks.delete(handle);
      this.timestampMs += frameMs;
      callback(this.timestampMs);
    }
  }
}

function settledState(context: RollInitialStateContext) {
  return {
    position: { x: context.slotX, y: context.diceSize / 2, z: 0 },
    quaternion:
      context.expectedValue === 6
        ? { x: 1, y: 0, z: 0, w: 0 }
        : { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 }
  } as const;
}

function createPlan(): RollPlan {
  const planner = new RollPlanner({
    initialStateProvider: settledState,
    maxAttemptsPerDie: 1,
    maxCombinedAttempts: 1,
    maxPlanningTimeMs: 5000,
    stability: { consecutiveSteps: 4, maxSteps: 120 }
  });

  return planner.plan({
    rollId: "visible-roll",
    dice: [
      { sides: 6, value: 1 },
      { sides: 6, value: 6 }
    ],
    modifier: 0,
    total: 7
  });
}

function createTarget() {
  const diceScene = new DiceScene({ showFloor: false });
  const render = vi.fn();
  const target: DiceRenderTarget = { diceScene, render };
  return { diceScene, render, target };
}

describe("DiceRollPlayer", () => {
  it("replays a RollPlan with real physics and resolves after stabilization", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, render, target } = createTarget();
    const player = new DiceRollPlayer(target, { scheduler });
    const plan = createPlan();

    const playback = player.play(plan);
    scheduler.runFrames(20);
    const result = await playback;

    expect(result.rollId).toBe("visible-roll");
    expect(result.dice.map((die) => die.value)).toEqual([1, 6]);
    expect(result.simulationSteps).toBeGreaterThan(0);
    expect(render).toHaveBeenCalled();
    expect(diceScene.content.children).toHaveLength(2);

    player.clear();
    expect(diceScene.content.children).toHaveLength(0);
    player.dispose();
    diceScene.dispose();
  });

  it("rejects a physically stable result that does not match the predetermined face", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const player = new DiceRollPlayer(target, { scheduler });
    const validPlan = createPlan();
    const mismatchedPlan: RollPlan = {
      ...validPlan,
      dice: [
        {
          ...validPlan.dice[0]!,
          expectedValue: 6,
          initialState: {
            ...validPlan.dice[0]!.initialState,
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
          }
        }
      ]
    };

    const playback = player.play(mismatchedPlan);
    scheduler.runFrames(20);

    await expect(playback).rejects.toBeInstanceOf(DiceRollPlaybackError);
    expect(diceScene.content.children).toHaveLength(0);

    player.dispose();
    diceScene.dispose();
  });

  it("cancels an active roll and cleans its visible resources", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const player = new DiceRollPlayer(target, { scheduler });

    const playback = player.play(createPlan());
    player.cancel();

    await expect(playback).rejects.toBeInstanceOf(DiceRollPlaybackError);
    expect(diceScene.content.children).toHaveLength(0);

    player.dispose();
    diceScene.dispose();
  });
});
