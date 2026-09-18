import { Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DiceMeshFactory,
  DicePhysicsWorld,
  DiceRollPlaybackError,
  DiceRollPlayer,
  DiceScene,
  RollPlanner,
  type DiceAnimationScheduler,
  type DiceRenderTarget,
  type DiceTextureLoader,
  type DirectRollPlan,
  type PresimulatedRollPlan,
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

class ImmediateTextureLoader implements DiceTextureLoader {
  async load(url: string): Promise<Texture> {
    const texture = new Texture();
    texture.name = url;
    return texture;
  }
}

class DeferredTextureLoader implements DiceTextureLoader {
  readonly requestedUrls: string[] = [];
  private resolvePending?: (texture: Texture) => void;

  load(url: string): Promise<Texture> {
    this.requestedUrls.push(url);

    return new Promise<Texture>((resolve) => {
      this.resolvePending = resolve;
    });
  }

  resolve(texture: Texture): void {
    if (!this.resolvePending) {
      throw new Error("No deferred texture load is pending.");
    }

    const resolve = this.resolvePending;
    this.resolvePending = undefined;
    resolve(texture);
  }
}

async function flushMicrotasks(count = 24): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
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

function createPlan(diceScale = 1): PresimulatedRollPlan {
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
  }, { diceScale });
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

  it("keeps the active physical arena synchronized with camera and viewport changes", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    diceScene.setSize(800, 800);
    const player = new DiceRollPlayer(target, { scheduler });
    const basePlan = createPlan();
    const plan: RollPlan = {
      ...basePlan,
      physics: {
        ...basePlan.physics,
        arenaBoundary: diceScene.getTableBoundary()
      }
    };
    const updateArenaBoundary = vi.spyOn(DicePhysicsWorld.prototype, "updateArenaBoundary");

    const playback = player.play(plan);
    scheduler.runFrames(1);
    updateArenaBoundary.mockClear();

    diceScene.setCamera({ x: 35, y: 42, z: 12 });
    diceScene.setSize(1200, 700);
    const expectedBoundary = diceScene.getTableBoundary();
    scheduler.runFrames(1);

    expect(updateArenaBoundary).toHaveBeenCalledTimes(1);
    expect(updateArenaBoundary).toHaveBeenLastCalledWith(expectedBoundary);

    scheduler.runFrames(20);
    await playback;

    updateArenaBoundary.mockRestore();
    player.dispose();
    diceScene.dispose();
  });

  it("passes independent appearance settings to each die in one playback", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const meshFactory = new DiceMeshFactory();
    const createD6 = vi.spyOn(meshFactory, "createD6");
    const player = new DiceRollPlayer(target, { scheduler, meshFactory });
    const plan = createPlan(1.25);
    const appearances = [
      { color: "#7b1e1e", markingsColor: "#f5e6c8" },
      { color: "#183153", markingsColor: "#f8fafc", roughness: 0.4, metalness: 0.2 }
    ] as const;

    const playback = player.play(plan, { appearances });

    expect(createD6).toHaveBeenNthCalledWith(1, {
      size: plan.physics.diceSize,
      appearance: appearances[0]
    });
    expect(createD6).toHaveBeenNthCalledWith(2, {
      size: plan.physics.diceSize,
      appearance: appearances[1]
    });

    scheduler.runFrames(20);
    await playback;

    player.dispose();
    diceScene.dispose();
  });

  it("uses the async mesh path only for dice that need texture assets", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const meshFactory = new DiceMeshFactory({ textureLoader: new ImmediateTextureLoader() });
    const createD6 = vi.spyOn(meshFactory, "createD6");
    const createD6Async = vi.spyOn(meshFactory, "createD6Async");
    const player = new DiceRollPlayer(target, { scheduler, meshFactory });
    const plan = createPlan();
    const appearances = [
      { texture: "/body.png", faces: { 1: "/one.png" } },
      { color: "#183153" }
    ] as const;

    const playback = player.play(plan, { appearances });
    await flushMicrotasks();

    expect(createD6Async).toHaveBeenCalledWith({
      size: plan.physics.diceSize,
      appearance: appearances[0]
    });
    expect(createD6).toHaveBeenCalledWith({
      size: plan.physics.diceSize,
      appearance: appearances[1]
    });
    expect(diceScene.content.children).toHaveLength(2);

    scheduler.runFrames(20);
    await playback;

    player.dispose();
    diceScene.dispose();
  });

  it("rejects immediately when cancelled during deferred texture preparation", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const loader = new DeferredTextureLoader();
    const meshFactory = new DiceMeshFactory({ textureLoader: loader });
    const player = new DiceRollPlayer(target, { scheduler, meshFactory });
    const plan = createPlan();

    const playback = player.play(plan, {
      appearances: [{ texture: "/slow-body.png" }]
    });
    await flushMicrotasks();

    expect(loader.requestedUrls).toEqual(["/slow-body.png"]);

    player.cancel();
    await expect(playback).rejects.toBeInstanceOf(DiceRollPlaybackError);
    expect(diceScene.content.children).toHaveLength(0);

    const nextPlayback = player.play(plan);
    scheduler.runFrames(20);
    await expect(nextPlayback).resolves.toMatchObject({ rollId: "visible-roll" });
    player.clear();
    expect(diceScene.content.children).toHaveLength(0);

    const lateTexture = new Texture();
    const disposeTexture = vi.spyOn(lateTexture, "dispose");
    loader.resolve(lateTexture);
    await flushMicrotasks();

    expect(diceScene.content.children).toHaveLength(0);

    meshFactory.dispose();
    expect(disposeTexture).toHaveBeenCalledTimes(1);

    player.dispose();
    diceScene.dispose();
  });

  it("rejects immediately when disposed during deferred texture preparation", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const loader = new DeferredTextureLoader();
    const meshFactory = new DiceMeshFactory({ textureLoader: loader });
    const player = new DiceRollPlayer(target, { scheduler, meshFactory });

    const playback = player.play(createPlan(), {
      appearances: [{ texture: "/slow-dispose.png" }]
    });
    await flushMicrotasks();

    player.dispose();
    await expect(playback).rejects.toBeInstanceOf(DiceRollPlaybackError);
    expect(diceScene.content.children).toHaveLength(0);

    const lateTexture = new Texture();
    const disposeTexture = vi.spyOn(lateTexture, "dispose");
    loader.resolve(lateTexture);
    await flushMicrotasks();

    expect(diceScene.content.children).toHaveLength(0);
    meshFactory.dispose();
    expect(disposeTexture).toHaveBeenCalledTimes(1);

    diceScene.dispose();
  });

  it("returns observed face values for a direct non-presimulated plan", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const player = new DiceRollPlayer(target, { scheduler });
    const presimulated = createPlan();
    const directPlan: DirectRollPlan = {
      ...presimulated,
      dice: presimulated.dice.map((die) => ({ ...die, expectedValue: 0 })),
      simulationSteps: 0,
      preSimulated: false
    };

    const playback = player.play(directPlan);
    scheduler.runFrames(20);
    const result = await playback;

    expect(result.dice.map((die) => die.value)).toEqual([1, 6]);
    player.dispose();
    diceScene.dispose();
  });

  it("rejects a physically stable result that does not match the predetermined face", async () => {
    const scheduler = new ManualScheduler();
    const { diceScene, target } = createTarget();
    const player = new DiceRollPlayer(target, { scheduler });
    const validPlan = createPlan();
    const mismatchedPlan: PresimulatedRollPlan = {
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
