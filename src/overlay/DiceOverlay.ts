import type { DiceAudioOptions } from "../audio/index.js";
import {
  DiceRoller,
  resolveDiceRollModifier,
  type DiceRollRequest,
  type DiceRollResult
} from "../core/index.js";
import {
  BackgroundRollPlanner,
  DirectRollPlanner,
  type DirectRollPlan,
  type RollPlan,
  type RollPlanningOptions
} from "../physics/index.js";
import {
  DiceRollPlayer,
  type DiceRenderTarget,
  type DiceRollPlaybackOptions,
  type DiceRollPlaybackResult
} from "../player/index.js";
import {
  DiceRenderer,
  type DiceRendererOptions
} from "../three/index.js";

export type DiceOverlayErrorPhase = "roll" | "planning" | "rendering" | "playback";

export class DiceOverlayError extends Error {
  readonly phase: DiceOverlayErrorPhase;

  constructor(phase: DiceOverlayErrorPhase, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiceOverlayError";
    this.phase = phase;
  }
}

export interface DiceOverlayRoller {
  roll(request: DiceRollRequest): DiceRollResult;
  createRollId?(): string;
  rollToDiceTotal?(request: DiceRollRequest, expectedDiceTotal: number): DiceRollResult;
}

export interface DiceOverlayPlanner {
  plan(
    result: DiceRollResult,
    options?: RollPlanningOptions
  ): RollPlan | Promise<RollPlan>;
  cancel?(): void;
  dispose?(): void;
}

export interface DiceOverlayDirectPlanner {
  plan(request: DiceRollRequest, rollId: string, options?: RollPlanningOptions): DirectRollPlan;
}

export interface DiceOverlayRollOptions extends RollPlanningOptions {
  /** Defaults to true. False starts visible physics without hidden presimulation. */
  readonly preSimulation?: boolean;
  /** Presimulated dice sum to force. Zero or undefined means Auto. Ignored in direct mode. */
  readonly expectedDiceTotal?: number;
}

export interface DiceOverlayRenderer extends DiceRenderTarget {
  dispose(): void;
}

export interface DiceOverlayPlayer {
  play(plan: RollPlan, options?: DiceRollPlaybackOptions): Promise<DiceRollPlaybackResult>;
  cancel(): void;
  clear(): void;
  dispose(): void;
}

export type DiceOverlayRendererFactory = (
  container: HTMLElement,
  options: DiceRendererOptions
) => DiceOverlayRenderer;

export type DiceOverlayPlayerFactory = (target: DiceRenderTarget) => DiceOverlayPlayer;

export interface DiceOverlayOptions {
  /** Container receiving the overlay/canvas. Defaults to document.body. */
  readonly container?: HTMLElement;

  /** Set false to mount only the renderer canvas without modal overlay UI. Defaults to true. */
  readonly showOverlay?: boolean;

  /** Fallback title used when the roll request does not provide a reason. */
  readonly title?: string;

  /** Options forwarded to the default DiceRenderer. */
  readonly renderer?: DiceRendererOptions;

  /** Collision-driven visible-roll audio. Enabled with bundled CC0 samples by default. */
  readonly audio?: DiceAudioOptions | false;

  /** Advanced dependency hooks for deterministic tests or custom host integrations. */
  readonly roller?: DiceOverlayRoller;
  readonly planner?: DiceOverlayPlanner;
  readonly directPlanner?: DiceOverlayDirectPlanner;
  readonly rendererFactory?: DiceOverlayRendererFactory;
  readonly playerFactory?: DiceOverlayPlayerFactory;
  readonly document?: Document;
}

interface InertState {
  readonly element: HTMLElement;
  readonly previous: boolean;
}

interface OverlaySurface {
  readonly parent: HTMLElement;
  readonly rendererHost: HTMLElement;
  readonly renderer: DiceOverlayRenderer;
  readonly player: DiceOverlayPlayer;
  readonly root?: HTMLElement;
  readonly titleElement?: HTMLElement;
  readonly resultElement?: HTMLElement;
  readonly inertStates: readonly InertState[];
}

const createDefaultRenderer: DiceOverlayRendererFactory = (container, options) =>
  new DiceRenderer(container, options);

const createDefaultPlayer = (
  audio: DiceAudioOptions | false | undefined
): DiceOverlayPlayerFactory => (target) => new DiceRollPlayer(target, { audio });

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatResult(result: DiceRollResult): string {
  const values = result.dice.map((die) => String(die.value));
  const modifier = result.modifier;
  let expression = values.join(" + ");

  if (modifier > 0) {
    expression += ` + ${modifier}`;
  } else if (modifier < 0) {
    expression += ` - ${Math.abs(modifier)}`;
  }

  if (values.length > 1 || modifier !== 0) {
    return `${expression} = ${result.total}`;
  }

  return `Result: ${result.total}`;
}

function assignStyles(element: HTMLElement, styles: Readonly<Record<string, string>>): void {
  Object.assign(element.style, styles);
}

/**
 * Framework-agnostic integration layer for the complete logical -> planned -> visible dice roll.
 * `roll()` leaves the finished result visible until `close()` is called or another roll starts.
 */
export class DiceOverlay {
  private readonly options: DiceOverlayOptions;
  private readonly roller: DiceOverlayRoller;
  private readonly planner: DiceOverlayPlanner;
  private readonly directPlanner: DiceOverlayDirectPlanner;
  private readonly rendererFactory: DiceOverlayRendererFactory;
  private readonly playerFactory: DiceOverlayPlayerFactory;

  private surface?: OverlaySurface;
  private activeRoll = false;
  private disposed = false;

  constructor(options: DiceOverlayOptions = {}) {
    this.options = options;
    this.roller = options.roller ?? new DiceRoller();
    this.planner = options.planner ?? new BackgroundRollPlanner();
    this.directPlanner = options.directPlanner ?? new DirectRollPlanner();
    this.rendererFactory = options.rendererFactory ?? createDefaultRenderer;
    this.playerFactory = options.playerFactory ?? createDefaultPlayer(options.audio);
  }

  get isOpen(): boolean {
    return this.surface !== undefined;
  }

  async roll(
    request: DiceRollRequest,
    options: DiceOverlayRollOptions = {}
  ): Promise<DiceRollResult> {
    this.assertActive();

    if (this.activeRoll) {
      throw new DiceOverlayError("roll", "A dice roll is already in progress.");
    }

    this.activeRoll = true;

    try {
      if (options.preSimulation === false) {
        return await this.rollDirect(request, options);
      }

      return await this.rollPreSimulated(request, options);
    } finally {
      this.activeRoll = false;
    }
  }

  private async rollPreSimulated(
    request: DiceRollRequest,
    options: DiceOverlayRollOptions
  ): Promise<DiceRollResult> {
    const expectedDiceTotal = options.expectedDiceTotal ?? 0;
    let logicalResult: DiceRollResult;

    try {
      if (expectedDiceTotal === 0) {
        logicalResult = this.roller.roll(request);
      } else if (this.roller.rollToDiceTotal) {
        logicalResult = this.roller.rollToDiceTotal(request, expectedDiceTotal);
      } else {
        throw new Error("The configured DiceOverlayRoller does not support expectedDiceTotal.");
      }
    } catch (error) {
      throw this.wrapError("roll", error);
    }

    let surface: OverlaySurface;
    try {
      surface = this.ensureSurface();
    } catch (error) {
      throw this.wrapError("rendering", error);
    }

    let plan: RollPlan;
    try {
      this.presentRolling(surface, request.reason ?? logicalResult.reason);
      plan = await this.planner.plan(logicalResult, {
        ...options,
        arenaBoundary: surface.renderer.diceScene.getTableBoundary()
      });

      if (plan.preSimulated === false && expectedDiceTotal !== 0) {
        throw new Error(
          "expectedDiceTotal requires presimulation. The configured planner fell back to direct physics."
        );
      }
    } catch (error) {
      if (this.surface === surface) {
        this.close();
      }
      throw this.wrapError("planning", error);
    }

    let returnedResult = logicalResult;

    try {
      const playback = await surface.player.play(plan, {
        appearances: request.dice.map((die) => die.appearance)
      });

      if (plan.preSimulated === false) {
        returnedResult = {
          rollId: playback.rollId,
          dice: playback.dice,
          modifier: logicalResult.modifier,
          total:
            playback.dice.reduce((sum, die) => sum + die.value, 0) +
            logicalResult.modifier,
          ...(request.reason === undefined ? {} : { reason: request.reason })
        };
      } else {
        this.assertPlaybackMatches(logicalResult, playback);
      }
    } catch (error) {
      if (this.surface === surface) {
        surface.resultElement && (surface.resultElement.textContent = "Roll failed");
        surface.player.clear();
      }
      throw this.wrapError("playback", error);
    }

    if (this.surface === surface) {
      this.presentResult(surface, returnedResult);
    }
    return returnedResult;
  }

  private async rollDirect(
    request: DiceRollRequest,
    options: DiceOverlayRollOptions
  ): Promise<DiceRollResult> {
    let modifier: number;
    try {
      modifier = resolveDiceRollModifier(request.modifier);
    } catch (error) {
      throw this.wrapError("roll", error);
    }

    let surface: OverlaySurface;
    try {
      surface = this.ensureSurface();
    } catch (error) {
      throw this.wrapError("rendering", error);
    }

    let plan: RollPlan;
    try {
      const rollId = this.roller.createRollId?.() ?? new DiceRoller().createRollId();
      plan = this.directPlanner.plan(request, rollId, {
        ...options,
        arenaBoundary: surface.renderer.diceScene.getTableBoundary()
      });
      this.presentRolling(surface, request.reason);
    } catch (error) {
      if (this.surface === surface) {
        this.close();
      }
      throw this.wrapError("planning", error);
    }

    let playback: DiceRollPlaybackResult;
    try {
      playback = await surface.player.play(plan, {
        appearances: request.dice.map((die) => die.appearance)
      });
    } catch (error) {
      if (this.surface === surface) {
        surface.resultElement && (surface.resultElement.textContent = "Roll failed");
        surface.player.clear();
      }
      throw this.wrapError("playback", error);
    }

    const logicalResult: DiceRollResult = {
      rollId: playback.rollId,
      dice: playback.dice,
      modifier,
      total: playback.dice.reduce((sum, die) => sum + die.value, 0) + modifier,
      ...(request.reason === undefined ? {} : { reason: request.reason })
    };

    if (this.surface === surface) {
      this.presentResult(surface, logicalResult);
    }
    return logicalResult;
  }

  /** Removes current overlay/canvas and cancels an active visible roll. The instance remains reusable. */
  close(): void {
    this.planner.cancel?.();
    const surface = this.surface;

    if (!surface) {
      return;
    }

    this.surface = undefined;
    surface.player.dispose();
    surface.renderer.dispose();
    this.restoreInert(surface.inertStates);

    if (surface.root?.parentNode === surface.parent) {
      surface.parent.removeChild(surface.root);
    }
  }

  /** Permanently releases the overlay. Create a new instance for later rolls. */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.close();
    this.planner.dispose?.();
    this.disposed = true;
  }

  private ensureSurface(): OverlaySurface {
    if (this.surface) {
      return this.surface;
    }

    const showOverlay = this.options.showOverlay !== false;
    const documentRef = this.resolveDocument(showOverlay);
    const parent = this.options.container ?? documentRef?.body;

    if (!parent) {
      throw new Error("DiceOverlay requires a container or document.body.");
    }

    let root: HTMLElement | undefined;
    let rendererHost = parent;
    let titleElement: HTMLElement | undefined;
    let resultElement: HTMLElement | undefined;
    let inertStates: InertState[] = [];

    if (showOverlay) {
      if (!documentRef) {
        throw new Error("DiceOverlay UI requires a DOM Document.");
      }

      root = documentRef.createElement("div");
      root.setAttribute("data-dihor-gamekit-dice-overlay", "");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      assignStyles(root, {
        position: this.options.container ? "absolute" : "fixed",
        inset: "0",
        zIndex: "2147483000",
        display: "flex",
        flexDirection: "column",
        background: "rgba(8, 12, 20, 0.88)",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        pointerEvents: "auto",
        overflow: "hidden"
      });

      titleElement = documentRef.createElement("div");
      titleElement.setAttribute("data-dihor-gamekit-dice-title", "");
      assignStyles(titleElement, {
        padding: "20px 24px 8px",
        fontSize: "clamp(20px, 3vw, 36px)",
        fontWeight: "700",
        textAlign: "center"
      });
      root.appendChild(titleElement);

      rendererHost = documentRef.createElement("div");
      rendererHost.setAttribute("data-dihor-gamekit-dice-renderer", "");
      assignStyles(rendererHost, {
        flex: "1 1 auto",
        minHeight: "0",
        width: "100%",
        position: "relative"
      });
      root.appendChild(rendererHost);

      resultElement = documentRef.createElement("div");
      resultElement.setAttribute("data-dihor-gamekit-dice-result", "");
      resultElement.setAttribute("aria-live", "polite");
      assignStyles(resultElement, {
        minHeight: "48px",
        padding: "8px 24px 24px",
        fontSize: "clamp(18px, 2.5vw, 30px)",
        fontWeight: "600",
        textAlign: "center"
      });
      root.appendChild(resultElement);

      parent.appendChild(root);
      inertStates = this.makeBackgroundInert(parent, root);
    }

    let renderer: DiceOverlayRenderer | undefined;

    try {
      renderer = this.rendererFactory(rendererHost, this.options.renderer ?? {});
      const player = this.playerFactory(renderer);
      const surface: OverlaySurface = {
        parent,
        rendererHost,
        renderer,
        player,
        root,
        titleElement,
        resultElement,
        inertStates
      };
      this.surface = surface;
      return surface;
    } catch (error) {
      renderer?.dispose();
      this.restoreInert(inertStates);

      if (root?.parentNode === parent) {
        parent.removeChild(root);
      }

      throw error;
    }
  }

  private resolveDocument(required: boolean): Document | undefined {
    if (this.options.document) {
      return this.options.document;
    }

    if (this.options.container?.ownerDocument) {
      return this.options.container.ownerDocument;
    }

    if (typeof document !== "undefined") {
      return document;
    }

    if (required || !this.options.container) {
      return undefined;
    }

    return undefined;
  }

  private makeBackgroundInert(parent: HTMLElement, root: HTMLElement): InertState[] {
    const states: InertState[] = [];

    for (const child of Array.from(parent.children)) {
      if (child === root || !("inert" in child)) {
        continue;
      }

      const element = child as HTMLElement;
      states.push({ element, previous: element.inert });
      element.inert = true;
    }

    return states;
  }

  private restoreInert(states: readonly InertState[]): void {
    for (const state of states) {
      state.element.inert = state.previous;
    }
  }

  private presentRolling(surface: OverlaySurface, reason: string | undefined): void {
    if (surface.titleElement) {
      surface.titleElement.textContent = reason?.trim() || this.options.title || "Dice roll";
    }

    if (surface.resultElement) {
      surface.resultElement.textContent = "Rolling…";
    }
  }

  private presentResult(surface: OverlaySurface, result: DiceRollResult): void {
    if (surface.resultElement) {
      surface.resultElement.textContent = formatResult(result);
    }
  }

  private assertPlaybackMatches(
    logicalResult: DiceRollResult,
    playback: DiceRollPlaybackResult
  ): void {
    const sameDice =
      playback.dice.length === logicalResult.dice.length &&
      playback.dice.every((die, index) => die.value === logicalResult.dice[index]?.value);

    if (playback.rollId !== logicalResult.rollId || !sameDice) {
      throw new Error("Visible playback result does not match the authoritative logical roll.");
    }
  }

  private wrapError(phase: DiceOverlayErrorPhase, error: unknown): DiceOverlayError {
    if (error instanceof DiceOverlayError) {
      return error;
    }

    return new DiceOverlayError(
      phase,
      `Dice overlay ${phase} failed: ${describeError(error)}`,
      { cause: error }
    );
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new DiceOverlayError("roll", "DiceOverlay has been disposed.");
    }
  }
}
