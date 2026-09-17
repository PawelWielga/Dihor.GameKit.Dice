import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DICE_PHYSICS_CONFIG,
  DEFAULT_STABILITY_CONFIG,
  DiceOverlay,
  DiceOverlayError,
  DiceRoller,
  DiceScene,
  type DiceOverlayPlanner,
  type DiceOverlayPlayer,
  type DiceOverlayRenderer,
  type DiceRollPlaybackOptions,
  type DiceRollPlaybackResult,
  type RollPlan
} from "../src/index.js";

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
  readonly cancel = vi.fn();
  readonly clear = vi.fn();
  readonly dispose = vi.fn();
  readonly calls: Array<{ plan: RollPlan; options?: DiceRollPlaybackOptions }> = [];
  mismatch = false;

  async play(plan: RollPlan, options?: DiceRollPlaybackOptions): Promise<DiceRollPlaybackResult> {
    this.calls.push({ plan, options });

    return {
      rollId: plan.rollId,
      dice: plan.dice.map((die, index) => ({
        sides: 6 as const,
        value: this.mismatch && index === 0 ? (die.expectedValue === 1 ? 2 : 1) : die.expectedValue
      })),
      simulationSteps: 12
    };
  }
}

function createPlan(result: ReturnType<DiceRoller["roll"]>): RollPlan {
  const zero = { x: 0, y: 0, z: 0 } as const;

  return {
    rollId: result.rollId,
    dice: result.dice.map((die, index) => ({
      sides: 6 as const,
      expectedValue: die.value as 1 | 2 | 3 | 4 | 5 | 6,
      initialState: {
        position: { x: index * 2, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: zero,
        angularVelocity: zero
      }
    })),
    physics: DEFAULT_DICE_PHYSICS_CONFIG,
    stability: DEFAULT_STABILITY_CONFIG,
    simulationSteps: 12
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

    expect(result).toEqual({
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

    const root = findByAttribute(documentRef.body, "data-partybeam-dice-overlay");
    expect(root).toBeDefined();
    expect(findByAttribute(root!, "data-partybeam-dice-title")?.textContent).toBe("Attack roll");
    expect(findByAttribute(root!, "data-partybeam-dice-result")?.textContent).toBe("2 + 5 = 7");

    overlay.close();
    expect(overlay.isOpen).toBe(false);
    expect(game.inert).toBe(false);
    expect(findByAttribute(documentRef.body, "data-partybeam-dice-overlay")).toBeUndefined();
    expect(players[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(renderers[0]?.dispose).toHaveBeenCalledTimes(1);

    await overlay.roll({ dice: [{ sides: 6 }] });
    expect(players).toHaveLength(2);
    expect(findByAttribute(documentRef.body, "data-partybeam-dice-overlay")).toBeDefined();

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
    expect(findByAttribute(documentRef.body, "data-partybeam-dice-overlay")).toBeUndefined();

    overlay.close();
  });

  it("propagates planning failures without mounting a renderer", async () => {
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
    expect(rendererFactory).not.toHaveBeenCalled();
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
    const root = findByAttribute(documentRef.body, "data-partybeam-dice-overlay");
    expect(findByAttribute(root!, "data-partybeam-dice-result")?.textContent).toBe("Roll failed");
    expect(player.clear).toHaveBeenCalledTimes(1);

    overlay.close();
    expect(documentRef.body.children).toHaveLength(0);
  });
});
