import { describe, expect, it, vi } from "vitest";
import {
  BackgroundRollPlanner,
  DEFAULT_DICE_PHYSICS_CONFIG,
  DEFAULT_STABILITY_CONFIG,
  DiceOverlay,
  DiceOverlayError,
  DiceRoller,
  DiceScene,
  type DiceAppearance,
  type DiceOverlayPlanner,
  type DiceOverlayPlayer,
  type DiceOverlayRenderer,
  type DiceRollPlaybackOptions,
  type DiceRollPlaybackResult,
  type DiceRollRequest,
  type DirectRollPlan,
  type PresimulatedRollPlan,
  type RollPlan,
  type RollPlanningWorkerLike
} from "../src/advanced.js";

class FakeDocument {
  readonly body: FakeElement;

  constructor() {
    this.body = new FakeElement(this);
  }

  createElement(): FakeElement {
    return new FakeElement(this);
  }
}

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly ownerDocument: FakeDocument;
  parentNode: FakeElement | null = null;
  textContent: string | null = null;
  inert = false;
  clientWidth = 1280;
  clientHeight = 720;

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);

    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }

    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeRenderer implements DiceOverlayRenderer {
  readonly diceScene = new DiceScene({ showFloor: false });
  readonly render = vi.fn();
  readonly dispose = vi.fn(() => this.diceScene.dispose());
}

class FakePlayer implements DiceOverlayPlayer {
  readonly unlockAudio = vi.fn(async () => undefined);
  appearanceGate?: Promise<void>;
  readonly setAppearances = vi.fn(
    async (_appearances: readonly (DiceAppearance | undefined)[]) => {
      if (this.appearanceGate) {
        await this.appearanceGate;
      }
    }
  );
  readonly cancel = vi.fn();
  readonly clear = vi.fn();
  readonly dispose = vi.fn();
  readonly calls: Array<{ plan: RollPlan; options?: DiceRollPlaybackOptions }> = [];
  mismatch = false;
  failNext = false;
  directValues: number[] = [];

  async play(plan: RollPlan, options?: DiceRollPlaybackOptions): Promise<DiceRollPlaybackResult> {
    this.calls.push({ plan, options });

    if (this.failNext) {
      this.failNext = false;
      throw new Error("playback failed");
    }

    return {
      rollId: plan.rollId,
      dice: plan.dice.map((die, index) => ({
        sides: die.sides,
        value: plan.preSimulated === false
          ? (this.directValues[index] ?? 1)
          : this.mismatch && index === 0
            ? (die.expectedValue === 1 ? 2 : 1)
            : die.expectedValue,
        position: { ...die.initialState.position },
        rotation: { ...die.initialState.quaternion }
      })),
      simulationSteps: 12
    };
  }
}

function createPlan(result: ReturnType<DiceRoller["roll"]>): PresimulatedRollPlan {
  const zero = { x: 0, y: 0, z: 0 } as const;

  return {
    rollId: result.rollId,
    dice: result.dice.map((die, index) => ({
      sides: die.sides,
      expectedValue: die.value,
      initialState: {
        position: { x: index * 2, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: zero,
        angularVelocity: zero
      }
    })),
    physics: DEFAULT_DICE_PHYSICS_CONFIG,
    stability: DEFAULT_STABILITY_CONFIG,
    simulationSteps: 12,
    preSimulated: true
  };
}

function createDirectFallbackPlan(result: ReturnType<DiceRoller["roll"]>): DirectRollPlan {
  const zero = { x: 0, y: 0, z: 0 } as const;

  return {
    rollId: result.rollId,
    dice: result.dice.map((die, index) => ({
      sides: die.sides,
      expectedValue: 0,
      initialState: {
        position: { x: index * 2, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: zero,
        angularVelocity: zero
      }
    })),
    physics: DEFAULT_DICE_PHYSICS_CONFIG,
    stability: DEFAULT_STABILITY_CONFIG,
    simulationSteps: 0,
    preSimulated: false
  };
}

function findByAttribute(root: FakeElement, attribute: string): FakeElement | undefined {
  if (root.attributes.has(attribute)) {
    return root;
  }

  for (const child of root.children) {
    const found = findByAttribute(child, attribute);

    if (found) {
      return found;
    }
  }

  return undefined;
}

function createRoller(): DiceRoller {
  const values = [0.2, 0.8];
  let index = 0;

  return new DiceRoller({
    randomProvider: {
      next: () => values[index++] ?? 0
    },
    rollIdProvider: () => "overlay-roll"
  });
}

describe("DiceOverlay", () => {
  it("runs the authoritative pipeline, presents the result and restores the background on close", async () => {
    const documentRef = new FakeDocument();
    const game = documentRef.createElement();
    documentRef.body.appendChild(game);
    const players: FakePlayer[] = [];
    const renderers: FakeRenderer[] = [];
    const planner: DiceOverlayPlanner = { plan: createPlan };
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner,
      rendererFactory: () => {
        const renderer = new FakeRenderer();
        renderers.push(renderer);
        return renderer;
      },
      playerFactory: () => {
        const player = new FakePlayer();
        players.push(player);
        return player;
      }
    });

    const request = {
      dice: [
        { sides: 6 as const, appearance: { color: "#7b1e1e" } },
        { sides: 6 as const, appearance: { texture: "/bone.png" } }
      ],
      reason: "Attack roll"
    };
    const result = await overlay.roll(request);

    expect(result).toMatchObject({
      rollId: "overlay-roll",
      dice: [
        { sides: 6, value: 2 },
        { sides: 6, value: 5 }
      ],
      modifier: 0,
      total: 7,
      reason: "Attack roll"
    });
    expect(overlay.isOpen).toBe(true);
    expect(game.inert).toBe(true);
    expect(players[0]?.calls).toHaveLength(1);
    expect(players[0]?.calls[0]?.options?.appearances).toEqual([
      { color: "#7b1e1e" },
      { texture: "/bone.png" }
    ]);

    const root = findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay");
    expect(root).toBeDefined();
    expect(findByAttribute(root!, "data-dihor-gamekit-dice-title")?.textContent).toBe("Attack roll");
    expect(findByAttribute(root!, "data-dihor-gamekit-dice-result")?.textContent).toBe("2 + 5 = 7");

    overlay.close();
    expect(overlay.isOpen).toBe(false);
    expect(game.inert).toBe(false);
    expect(findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay")).toBeUndefined();
    expect(players[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(renderers[0]?.dispose).toHaveBeenCalledTimes(1);

    await overlay.roll({ dice: [{ sides: 6 }] });
    expect(players).toHaveLength(2);
    expect(findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay")).toBeDefined();

    overlay.dispose();
  });

  it("unlocks audio before awaiting presimulation planning", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const planner: DiceOverlayPlanner = {
      async plan(result) {
        expect(player.unlockAudio).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        return createPlan(result);
      }
    };
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner,
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    await overlay.roll({ dice: [{ sides: 6 }] });

    expect(player.unlockAudio).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it("supports renderer-only mode without creating modal UI or inerting the host", async () => {
    const documentRef = new FakeDocument();
    const host = documentRef.createElement();
    documentRef.body.appendChild(host);
    const player = new FakePlayer();
    let receivedHost: HTMLElement | undefined;
    const overlay = new DiceOverlay({
      container: host as unknown as HTMLElement,
      showOverlay: false,
      roller: new DiceRoller({ randomProvider: { next: () => 0 }, rollIdProvider: () => "raw" }),
      planner: { plan: createPlan },
      rendererFactory: (container) => {
        receivedHost = container;
        return new FakeRenderer();
      },
      playerFactory: () => player
    });

    const result = await overlay.roll({ dice: [{ sides: 6 }] });

    expect(result.dice[0]?.value).toBe(1);
    expect(receivedHost).toBe(host as unknown as HTMLElement);
    expect(host.inert).toBe(false);
    expect(findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay")).toBeUndefined();

    overlay.close();
  });

  it("forwards throw force to planning without changing the logical roll result", async () => {
    const documentRef = new FakeDocument();
    const planningOptions: unknown[] = [];
    const planner: DiceOverlayPlanner = {
      plan(result, options) {
        planningOptions.push(options);
        return createPlan(result);
      }
    };
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: new DiceRoller({ randomProvider: { next: () => 0 }, rollIdProvider: () => "force" }),
      planner,
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => new FakePlayer()
    });

    const result = await overlay.roll({ dice: [{ sides: 6 }] }, { throwForce: 1.35 });

    expect(result.dice[0]?.value).toBe(1);
    expect(planningOptions).toHaveLength(1);
    expect(planningOptions[0]).toMatchObject({ throwForce: 1.35 });
    expect((planningOptions[0] as { arenaBoundary?: unknown[] }).arenaBoundary).toHaveLength(4);
    overlay.dispose();
  });

  it("rejects non-authoritative direct fallbacks in presimulated mode", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    player.directValues = [4, 2];
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner: {
        plan: (result) => createDirectFallbackPlan(result)
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    await expect(
      overlay.roll({
        dice: [{ sides: 6 }, { sides: 6 }],
        modifier: 3,
        reason: "Fallback"
      })
    ).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "planning"
    } satisfies Partial<DiceOverlayError>);

    expect(player.calls).toHaveLength(0);
    expect(overlay.isOpen).toBe(false);
  });

  it("keeps an authoritative value after a background Worker runtime failure", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const fallbackPlanner = { plan: createPlan };
    const worker: RollPlanningWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(() => {
        worker.onerror?.({ message: "Worker startup failed" });
      }),
      terminate: vi.fn()
    };
    const planner = new BackgroundRollPlanner({
      workerFactory: () => worker,
      fallbackPlanner: fallbackPlanner as never
    });
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: new DiceRoller({
        randomProvider: { next: () => 0.65 },
        rollIdProvider: () => "authoritative-7"
      }),
      planner,
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const result = await overlay.roll({ dice: [{ sides: 10 }] });

    expect(result).toMatchObject({
      rollId: "authoritative-7",
      dice: [{ sides: 10, value: 7 }],
      modifier: 0,
      total: 7
    });
    expect(player.calls[0]?.plan.preSimulated).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it("rejects forced totals when presimulation falls back to direct physics", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner: {
        plan: (result) => createDirectFallbackPlan(result)
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    await expect(
      overlay.roll(
        { dice: [{ sides: 6 }, { sides: 6 }] },
        { expectedDiceTotal: 7 }
      )
    ).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "planning"
    } satisfies Partial<DiceOverlayError>);

    expect(player.calls).toHaveLength(0);
    expect(overlay.isOpen).toBe(false);
  });

  it("supports direct physical mode without creating an authoritative result first", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    player.directValues = [2, 5];
    const roll = vi.fn(() => {
      throw new Error("logical roller must not run in direct mode");
    });
    const plannerPlan = vi.fn();
    const directPlans: DirectRollPlan[] = [];
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: { roll, createRollId: () => "direct-roll" },
      planner: { plan: plannerPlan },
      directPlanner: {
        plan(request, rollId) {
          const zero = { x: 0, y: 0, z: 0 } as const;
          const plan: DirectRollPlan = {
            rollId,
            dice: request.dice.map((die, index) => ({
              sides: die.sides,
              expectedValue: 0,
              initialState: {
                position: { x: index * 2, y: 1, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                velocity: zero,
                angularVelocity: zero
              }
            })),
            physics: DEFAULT_DICE_PHYSICS_CONFIG,
            stability: DEFAULT_STABILITY_CONFIG,
            simulationSteps: 0,
            preSimulated: false
          };
          directPlans.push(plan);
          return plan;
        }
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const result = await overlay.roll(
      { dice: [{ sides: 6 }, { sides: 6 }], modifier: 2 },
      { preSimulation: false, expectedDiceTotal: 12 }
    );

    expect(roll).not.toHaveBeenCalled();
    expect(plannerPlan).not.toHaveBeenCalled();
    expect(directPlans[0]?.simulationSteps).toBe(0);
    expect(player.unlockAudio).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      rollId: "direct-roll",
      dice: [{ sides: 6, value: 2 }, { sides: 6, value: 5 }],
      modifier: 2,
      total: 9
    });
    overlay.dispose();
  });

  it("rejects invalid direct modifiers before rendering, planning or playback and remains reusable", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    player.directValues = [4];
    const rendererFactory = vi.fn(() => new FakeRenderer());
    const playerFactory = vi.fn(() => player);
    const directPlan = vi.fn((request: { dice: readonly { sides: 4 | 6 | 8 | 10 | 12 | 20 }[] }, rollId: string): DirectRollPlan => {
      const zero = { x: 0, y: 0, z: 0 } as const;

      return {
        rollId,
        dice: request.dice.map((die, index) => ({
          sides: die.sides,
          expectedValue: 0,
          initialState: {
            position: { x: index * 2, y: 1, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            velocity: zero,
            angularVelocity: zero
          }
        })),
        physics: DEFAULT_DICE_PHYSICS_CONFIG,
        stability: DEFAULT_STABILITY_CONFIG,
        simulationSteps: 0,
        preSimulated: false
      };
    });
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: {
        roll: vi.fn(() => {
          throw new Error("logical roller must not run in direct mode");
        }),
        createRollId: () => "direct-validation"
      },
      planner: { plan: vi.fn() },
      directPlanner: { plan: directPlan },
      rendererFactory,
      playerFactory
    });

    for (const modifier of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      await expect(
        overlay.roll(
          { dice: [{ sides: 6 }], modifier },
          { preSimulation: false }
        )
      ).rejects.toMatchObject({
        name: "DiceOverlayError",
        phase: "roll"
      } satisfies Partial<DiceOverlayError>);

      expect(overlay.isOpen).toBe(false);
      expect(findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay")).toBeUndefined();
    }

    expect(directPlan).not.toHaveBeenCalled();
    expect(rendererFactory).not.toHaveBeenCalled();
    expect(playerFactory).not.toHaveBeenCalled();
    expect(player.calls).toHaveLength(0);

    const valid = await overlay.roll(
      { dice: [{ sides: 6 }], modifier: 1 },
      { preSimulation: false }
    );

    expect(valid.total).toBe(5);
    expect(directPlan).toHaveBeenCalledTimes(1);
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(playerFactory).toHaveBeenCalledTimes(1);
    expect(player.calls).toHaveLength(1);

    overlay.dispose();
  });

  it("uses a requested dice total only in presimulated mode", async () => {
    const documentRef = new FakeDocument();
    const roller = new DiceRoller({
      randomProvider: { next: () => 0 },
      rollIdProvider: () => "forced-overlay"
    });
    const plannedResults: number[] = [];
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller,
      planner: {
        plan(result) {
          plannedResults.push(result.dice.reduce((sum, die) => sum + die.value, 0));
          return createPlan(result);
        }
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => new FakePlayer()
    });

    const result = await overlay.roll(
      { dice: [{ sides: 6 }, { sides: 6 }] },
      { preSimulation: true, expectedDiceTotal: 12 }
    );

    expect(plannedResults).toEqual([12]);
    expect(result.total).toBe(12);
    overlay.dispose();
  });

  it("forwards table material configuration to the renderer", async () => {
    const documentRef = new FakeDocument();
    let receivedTable: unknown;
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      renderer: {
        scene: {
          table: {
            color: "#315a43",
            texture: "/textures/felt.jpg"
          }
        }
      },
      roller: new DiceRoller({ randomProvider: { next: () => 0 }, rollIdProvider: () => "table" }),
      planner: { plan: createPlan },
      rendererFactory: (_container, options) => {
        receivedTable = options.scene?.table;
        return new FakeRenderer();
      },
      playerFactory: () => new FakePlayer()
    });

    await overlay.roll({ dice: [{ sides: 6 }] });

    expect(receivedTable).toEqual({
      color: "#315a43",
      texture: "/textures/felt.jpg"
    });
    overlay.dispose();
  });

  it("propagates planning failures and cleans up the temporary renderer", async () => {
    const documentRef = new FakeDocument();
    const rendererFactory = vi.fn(() => new FakeRenderer());
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner: {
        plan: () => {
          throw new Error("planner exhausted attempts");
        }
      },
      rendererFactory
    });

    const promise = overlay.roll({ dice: [{ sides: 6 }, { sides: 6 }] });

    await expect(promise).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "planning"
    } satisfies Partial<DiceOverlayError>);
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(documentRef.body.children).toHaveLength(0);
  });

  it("detects playback mismatches and keeps a controlled failure state until close", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    player.mismatch = true;
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: new DiceRoller({ randomProvider: { next: () => 0 }, rollIdProvider: () => "mismatch" }),
      planner: { plan: createPlan },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const promise = overlay.roll({ dice: [{ sides: 6 }], reason: "Check" });

    await expect(promise).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "playback"
    } satisfies Partial<DiceOverlayError>);
    const root = findByAttribute(documentRef.body, "data-dihor-gamekit-dice-overlay");
    expect(findByAttribute(root!, "data-dihor-gamekit-dice-result")?.textContent).toBe("Roll failed");
    expect(player.clear).toHaveBeenCalledTimes(1);

    overlay.close();
    expect(documentRef.body.children).toHaveLength(0);
  });

  it("keeps stable die ids while rerolling only unfrozen dice", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const planningCalls: Array<{ result: ReturnType<DiceRoller["roll"]>; options: unknown }> = [];
    const rollRequests: DiceRollRequest[] = [];
    let rollNumber = 0;
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: {
        roll(request) {
          rollRequests.push(request);
          rollNumber += 1;
          const values = rollNumber === 1 ? [2, 5, 3] : [6, 1];
          const dice = request.dice.map((die, index) => ({
            sides: die.sides,
            value: values[index] ?? 1
          }));
          const modifier = request.modifier ?? 0;
          return {
            rollId: rollNumber === 1 ? "freeze-first" : "freeze-reroll",
            dice,
            modifier,
            total: dice.reduce((sum, die) => sum + die.value, 0) + modifier,
            ...(request.reason === undefined ? {} : { reason: request.reason })
          };
        },
        createRollId: () => "direct-unused"
      },
      planner: {
        plan(result, options) {
          planningCalls.push({ result, options });
          return createPlan(result);
        }
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const first = await overlay.roll({
      dice: [
        {
          sides: 6,
          appearance: {
            color: "#eeeeee",
            markingsColor: "#222222",
            texture: "/original.png"
          }
        },
        { sides: 6, appearance: { color: "#112233" } },
        { sides: 6 }
      ],
      modifier: 2,
      reason: "Keep one"
    }, { diceScale: 1.4 });
    const originalIds = first.dice.map((die) => die.id);

    expect(new Set(originalIds).size).toBe(3);

    const frozen = await overlay.freeze(first.dice[0]!.id, {
      physicsMode: "translation-only",
      appearance: {
        color: "#4da3ff",
        textureUrl: "/frozen.png"
      }
    });

    expect(frozen.dice[0]).toMatchObject({
      id: originalIds[0],
      value: 2,
      frozen: true,
      frozenPhysicsMode: "translation-only"
    });
    expect(player.setAppearances).toHaveBeenLastCalledWith([
      expect.objectContaining({
        color: "#4da3ff",
        markingsColor: "#222222",
        texture: "/frozen.png"
      }),
      { color: "#112233" },
      undefined
    ]);

    const rerolled = await overlay.rerollUnfrozen();

    expect(rollRequests).toHaveLength(2);
    expect(rollRequests[1]?.dice).toHaveLength(2);
    expect(planningCalls[1]?.options).toMatchObject({
      diceScale: 1.4,
      frozenDice: [
        expect.objectContaining({
          dieIndex: 0,
          expectedValue: 2,
          physicsMode: "translation-only"
        })
      ]
    });
    expect(rerolled.dice.map((die) => die.id)).toEqual(originalIds);
    expect(rerolled.dice.map((die) => die.value)).toEqual([2, 6, 1]);
    expect(rerolled.total).toBe(11);
    expect(rerolled.dice[0]?.frozen).toBe(true);

    const unfrozen = await overlay.unfreeze(first.dice[0]!.id);
    expect(unfrozen.dice[0]?.frozen).toBe(false);
    expect(player.setAppearances).toHaveBeenLastCalledWith([
      {
        color: "#eeeeee",
        markingsColor: "#222222",
        texture: "/original.png"
      },
      { color: "#112233" },
      undefined
    ]);

    overlay.dispose();
  });

  it("rejects direct planner fallback during presimulated partial rerolls", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    let planningCall = 0;
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner: {
        plan(result) {
          planningCall += 1;
          return planningCall === 1
            ? createPlan(result)
            : createDirectFallbackPlan(result);
        }
      },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const first = await overlay.roll({ dice: [{ sides: 6 }, { sides: 6 }] });
    await overlay.freeze(first.dice[0]!.id);

    await expect(overlay.rerollUnfrozen()).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "planning"
    } satisfies Partial<DiceOverlayError>);

    expect(player.calls).toHaveLength(1);

    const preserved = await overlay.unfreeze(first.dice[0]!.id);
    expect(preserved.dice.map((die) => die.value)).toEqual(
      first.dice.map((die) => die.value)
    );
    expect(preserved.dice[0]?.frozen).toBe(false);

    overlay.dispose();
  });

  it("serializes freeze appearance updates with roll and reroll operations", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    let releaseAppearance!: () => void;
    player.appearanceGate = new Promise<void>((resolve) => {
      releaseAppearance = resolve;
    });
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: createRoller(),
      planner: { plan: createPlan },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const first = await overlay.roll({ dice: [{ sides: 6 }, { sides: 6 }] });
    const freezing = overlay.freeze(first.dice[0]!.id, {
      appearance: { textureUrl: "/slow-frozen.png" }
    });

    await expect(overlay.rerollUnfrozen()).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "roll"
    } satisfies Partial<DiceOverlayError>);
    await expect(overlay.roll({ dice: [{ sides: 6 }] })).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "roll"
    } satisfies Partial<DiceOverlayError>);

    releaseAppearance();
    const frozen = await freezing;
    expect(frozen.dice[0]?.frozen).toBe(true);

    player.appearanceGate = undefined;
    await expect(overlay.rerollUnfrozen()).resolves.toMatchObject({
      dice: [
        expect.objectContaining({ frozen: true }),
        expect.objectContaining({ frozen: false })
      ]
    });

    overlay.dispose();
  });

  it("invalidates frozen state when a partial reroll playback fails", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: new DiceRoller({
        randomProvider: { next: () => 0 },
        rollIdProvider: (() => {
          let index = 0;
          return () => `reroll-failure-${++index}`;
        })()
      }),
      planner: { plan: createPlan },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const first = await overlay.roll({ dice: [{ sides: 6 }, { sides: 6 }] });
    await overlay.freeze(first.dice[0]!.id);
    player.failNext = true;

    await expect(overlay.rerollUnfrozen()).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "playback"
    } satisfies Partial<DiceOverlayError>);
    expect(player.clear).toHaveBeenCalledTimes(1);

    await expect(overlay.freeze(first.dice[0]!.id)).rejects.toMatchObject({
      name: "DiceOverlayError",
      phase: "roll"
    } satisfies Partial<DiceOverlayError>);

    overlay.dispose();
  });

  it("uses fully-frozen as the default freeze mode", async () => {
    const documentRef = new FakeDocument();
    const player = new FakePlayer();
    const overlay = new DiceOverlay({
      document: documentRef as unknown as Document,
      roller: new DiceRoller({
        randomProvider: { next: () => 0 },
        rollIdProvider: () => "default-freeze"
      }),
      planner: { plan: createPlan },
      rendererFactory: () => new FakeRenderer(),
      playerFactory: () => player
    });

    const first = await overlay.roll({ dice: [{ sides: 6 }] });
    const frozen = await overlay.freeze(first.dice[0]!.id);

    expect(frozen.dice[0]?.frozenPhysicsMode).toBe("fully-frozen");

    overlay.dispose();
  });
});
