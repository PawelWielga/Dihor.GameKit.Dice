import type { DiceAudioOptions } from "../audio/index.js";
import {
  mergeDiceAppearances,
  type DiceAppearance
} from "../appearance/index.js";
import {
  DiceRoller,
  resolveDiceRollModifier,
  type DiceDefinition,
  type DiceRollRequest,
  type DiceRollResult,
  type DiceSides
} from "../core/index.js";
import {
  BackgroundRollPlanner,
  DEFAULT_DICE_SCALE,
  DirectRollPlanner,
  type DirectRollPlan,
  type FrozenDicePhysicsMode,
  type FrozenRollDieState,
  type PhysicsQuaternion,
  type PhysicsVector3,
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

export interface FrozenDiceAppearance {
  /** Optional body color used only while a die is frozen. */
  readonly color?: string;
  /** Optional body texture URL used only while a die is frozen. */
  readonly textureUrl?: string;
}

export interface DiceFreezeOptions {
  /** Defaults to the overlay-level setting, then to fully-frozen. */
  readonly physicsMode?: FrozenDicePhysicsMode;
  readonly appearance?: FrozenDiceAppearance;
}

export interface DiceOverlayDieResult {
  readonly id: string;
  readonly sides: DiceSides;
  readonly value: number;
  readonly frozen: boolean;
  readonly position: PhysicsVector3;
  readonly rotation: PhysicsQuaternion;
  readonly frozenPhysicsMode?: FrozenDicePhysicsMode;
}

export interface DiceOverlayRollResult extends Omit<DiceRollResult, "dice"> {
  readonly dice: readonly DiceOverlayDieResult[];
}

export interface DiceOverlayRenderer extends DiceRenderTarget {
  dispose(): void;
}

export interface DiceOverlayPlayer {
  /** Optional browser-audio unlock hook. Should be invoked directly from a user gesture when available. */
  unlockAudio?(): Promise<void>;
  play(plan: RollPlan, options?: DiceRollPlaybackOptions): Promise<DiceRollPlaybackResult>;
  /** Rebuilds visible dice materials while preserving their settled transforms. */
  setAppearances?(appearances: readonly (DiceAppearance | undefined)[]): Promise<void>;
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

  /** Default behavior/appearance applied when dice are frozen. */
  readonly freeze?: DiceFreezeOptions;

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

interface OverlayDieState {
  readonly id: string;
  readonly definition: DiceDefinition;
  sides: DiceSides;
  value: number;
  position: PhysicsVector3;
  rotation: PhysicsQuaternion;
  frozen: boolean;
  frozenPhysicsMode?: FrozenDicePhysicsMode;
  frozenAppearance?: FrozenDiceAppearance;
}

interface OverlayRollState {
  rollId: string;
  diceScale: number;
  readonly modifier: number;
  readonly reason?: string;
  readonly dice: OverlayDieState[];
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

function unlockPlayerAudio(player: DiceOverlayPlayer): void {
  try {
    const unlock = player.unlockAudio?.();

    if (unlock) {
      void unlock.catch(() => undefined);
    }
  } catch {
    // Audio policy/integration failures must never fail the dice roll.
  }
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
  private rollState?: OverlayRollState;
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
  ): Promise<DiceOverlayRollResult> {
    this.assertActive();

    if (this.activeRoll) {
      throw new DiceOverlayError("roll", "A dice roll is already in progress.");
    }

    // A normal roll replaces the previous high-level freeze/reroll session.
    this.rollState = undefined;
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
  ): Promise<DiceOverlayRollResult> {
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

    unlockPlayerAudio(surface.player);

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
    let playback: DiceRollPlaybackResult;

    try {
      playback = await surface.player.play(plan, {
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

    this.captureRollState(request, returnedResult, playback, options.diceScale ?? DEFAULT_DICE_SCALE);

    if (this.surface === surface) {
      this.presentResult(surface, returnedResult);
    }
    return this.getCurrentResult();
  }

  private async rollDirect(
    request: DiceRollRequest,
    options: DiceOverlayRollOptions
  ): Promise<DiceOverlayRollResult> {
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

    unlockPlayerAudio(surface.player);

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

    this.captureRollState(request, logicalResult, playback, options.diceScale ?? DEFAULT_DICE_SCALE);

    if (this.surface === surface) {
      this.presentResult(surface, logicalResult);
    }
    return this.getCurrentResult();
  }

  /**
   * Freezes selected dice by stable id. Calling it again for an already frozen die updates
   * its freeze mode/appearance without changing its value or transform.
   */
  async freeze(
    ids: string | readonly string[],
    options: DiceFreezeOptions = {}
  ): Promise<DiceOverlayRollResult> {
    this.assertActive();
    this.assertIdleState();
    const state = this.requireRollState();
    const surface = this.requireSurface();
    const selected = this.resolveDiceByIds(state, ids);
    const resolved = this.resolveFreezeOptions(options);
    const previous = selected.map((die) => ({
      die,
      frozen: die.frozen,
      frozenPhysicsMode: die.frozenPhysicsMode,
      frozenAppearance: die.frozenAppearance
    }));

    this.activeRoll = true;

    try {
      for (const die of selected) {
        die.frozen = true;
        die.frozenPhysicsMode = resolved.physicsMode;
        die.frozenAppearance = resolved.appearance;
      }

      try {
        await this.applyCurrentAppearances(surface, state);
      } catch (error) {
        for (const snapshot of previous) {
          snapshot.die.frozen = snapshot.frozen;
          snapshot.die.frozenPhysicsMode = snapshot.frozenPhysicsMode;
          snapshot.die.frozenAppearance = snapshot.frozenAppearance;
        }
        throw this.wrapError("rendering", error);
      }

      return this.getCurrentResult();
    } finally {
      this.activeRoll = false;
    }
  }

  async unfreeze(id: string): Promise<DiceOverlayRollResult> {
    this.assertActive();
    this.assertIdleState();
    const state = this.requireRollState();
    const surface = this.requireSurface();
    const [die] = this.resolveDiceByIds(state, id);
    const previous = {
      frozen: die!.frozen,
      frozenPhysicsMode: die!.frozenPhysicsMode,
      frozenAppearance: die!.frozenAppearance
    };

    this.activeRoll = true;

    try {
      die!.frozen = false;
      die!.frozenPhysicsMode = undefined;
      die!.frozenAppearance = undefined;

      try {
        await this.applyCurrentAppearances(surface, state);
      } catch (error) {
        die!.frozen = previous.frozen;
        die!.frozenPhysicsMode = previous.frozenPhysicsMode;
        die!.frozenAppearance = previous.frozenAppearance;
        throw this.wrapError("rendering", error);
      }

      return this.getCurrentResult();
    } finally {
      this.activeRoll = false;
    }
  }

  async unfreezeAll(): Promise<DiceOverlayRollResult> {
    this.assertActive();
    this.assertIdleState();
    const state = this.requireRollState();
    const surface = this.requireSurface();
    const previous = state.dice.map((die) => ({
      die,
      frozen: die.frozen,
      frozenPhysicsMode: die.frozenPhysicsMode,
      frozenAppearance: die.frozenAppearance
    }));

    this.activeRoll = true;

    try {
      for (const die of state.dice) {
        die.frozen = false;
        die.frozenPhysicsMode = undefined;
        die.frozenAppearance = undefined;
      }

      try {
        await this.applyCurrentAppearances(surface, state);
      } catch (error) {
        for (const snapshot of previous) {
          snapshot.die.frozen = snapshot.frozen;
          snapshot.die.frozenPhysicsMode = snapshot.frozenPhysicsMode;
          snapshot.die.frozenAppearance = snapshot.frozenAppearance;
        }
        throw this.wrapError("rendering", error);
      }

      return this.getCurrentResult();
    } finally {
      this.activeRoll = false;
    }
  }

  async toggleFreeze(
    id: string,
    options: DiceFreezeOptions = {}
  ): Promise<DiceOverlayRollResult> {
    this.assertActive();
    this.assertIdleState();
    const state = this.requireRollState();
    const [die] = this.resolveDiceByIds(state, id);
    return die!.frozen ? this.unfreeze(id) : this.freeze(id, options);
  }

  /**
   * Rerolls only unfrozen dice while frozen dice remain collision geometry in the same world.
   * expectedDiceTotal, when supplied, targets only the dice being rerolled.
   */
  async rerollUnfrozen(
    options: DiceOverlayRollOptions = {}
  ): Promise<DiceOverlayRollResult> {
    this.assertActive();
    this.assertIdleState();
    const state = this.requireRollState();
    const surface = this.requireSurface();
    const unfrozen = state.dice.filter((die) => !die.frozen);

    if (unfrozen.length === 0) {
      return this.getCurrentResult();
    }

    this.activeRoll = true;
    let phase: DiceOverlayErrorPhase = "roll";

    try {
      unlockPlayerAudio(surface.player);
      const frozenDice = this.createFrozenPlanningState(state);
      const planningOptions: RollPlanningOptions = {
        ...options,
        diceScale: options.diceScale ?? state.diceScale,
        frozenDice,
        arenaBoundary: surface.renderer.diceScene.getTableBoundary()
      };
      const completeRequest: DiceRollRequest = {
        dice: state.dice.map((die) => die.definition),
        modifier: state.modifier,
        ...(state.reason === undefined ? {} : { reason: state.reason })
      };
      let plan: RollPlan;
      let logicalResult: DiceRollResult | undefined;

      this.presentRolling(surface, state.reason);

      if (options.preSimulation === false) {
        phase = "planning";
        const rollId = this.roller.createRollId?.() ?? new DiceRoller().createRollId();
        plan = this.directPlanner.plan(completeRequest, rollId, planningOptions);
      } else {
        const partialRequest: DiceRollRequest = {
          dice: unfrozen.map((die) => die.definition),
          modifier: 0,
          ...(state.reason === undefined ? {} : { reason: state.reason })
        };
        const expectedDiceTotal = options.expectedDiceTotal ?? 0;
        let partialResult: DiceRollResult;

        if (expectedDiceTotal === 0) {
          partialResult = this.roller.roll(partialRequest);
        } else if (this.roller.rollToDiceTotal) {
          partialResult = this.roller.rollToDiceTotal(partialRequest, expectedDiceTotal);
        } else {
          throw new Error("The configured DiceOverlayRoller does not support expectedDiceTotal.");
        }

        let partialIndex = 0;
        const dice = state.dice.map((die) => {
          if (die.frozen) {
            return { sides: die.sides, value: die.value };
          }

          const next = partialResult.dice[partialIndex++];
          if (!next) {
            throw new Error("The reroll result is missing an unfrozen die.");
          }
          return next;
        });

        logicalResult = {
          rollId: partialResult.rollId,
          dice,
          modifier: state.modifier,
          total: dice.reduce((sum, die) => sum + die.value, 0) + state.modifier,
          ...(state.reason === undefined ? {} : { reason: state.reason })
        };
        phase = "planning";
        plan = await this.planner.plan(logicalResult, planningOptions);

        if (plan.preSimulated === false && expectedDiceTotal !== 0) {
          throw new Error(
            "expectedDiceTotal requires presimulation. The configured planner fell back to direct physics."
          );
        }
      }

      phase = "playback";
      const playback = await surface.player.play(plan, {
        appearances: this.getCurrentAppearances(state)
      });

      let finalResult: DiceRollResult;
      if (logicalResult && plan.preSimulated !== false) {
        this.assertPlaybackMatches(logicalResult, playback);
        finalResult = logicalResult;
      } else {
        finalResult = {
          rollId: playback.rollId,
          dice: playback.dice.map((die) => ({ sides: die.sides, value: die.value })),
          modifier: state.modifier,
          total:
            playback.dice.reduce((sum, die) => sum + die.value, 0) +
            state.modifier,
          ...(state.reason === undefined ? {} : { reason: state.reason })
        };
      }

      this.updateRollStateFromPlayback(state, finalResult, playback);
      state.diceScale = planningOptions.diceScale ?? DEFAULT_DICE_SCALE;

      if (this.surface === surface) {
        this.presentResult(surface, finalResult);
      }

      return this.getCurrentResult();
    } catch (error) {
      if (this.surface === surface) {
        if (phase === "playback") {
          this.rollState = undefined;
          surface.resultElement && (surface.resultElement.textContent = "Roll failed");
          surface.player.clear();
        } else {
          this.presentResult(surface, this.getCurrentResult());
        }
      }

      throw this.wrapError(
        error instanceof DiceOverlayError ? error.phase : phase,
        error
      );
    } finally {
      this.activeRoll = false;
    }
  }

  /** Removes current overlay/canvas and cancels an active visible roll. The instance remains reusable. */
  close(): void {
    this.planner.cancel?.();
    const surface = this.surface;

    if (!surface) {
      return;
    }

    this.surface = undefined;
    this.rollState = undefined;
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

  private captureRollState(
    request: DiceRollRequest,
    result: DiceRollResult,
    playback: DiceRollPlaybackResult,
    diceScale: number
  ): void {
    if (request.dice.length !== playback.dice.length || result.dice.length !== playback.dice.length) {
      throw new Error("Visible playback did not return state for every requested die.");
    }

    this.rollState = {
      rollId: result.rollId,
      diceScale,
      modifier: result.modifier,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      dice: playback.dice.map((playedDie, index) => {
        const definition = request.dice[index];
        const logicalDie = result.dice[index];

        if (!definition || !logicalDie) {
          throw new Error(`Missing die state at index ${index}.`);
        }

        return {
          id: `${result.rollId}:die-${index + 1}`,
          definition,
          sides: logicalDie.sides,
          value: logicalDie.value,
          position: { ...playedDie.position },
          rotation: { ...playedDie.rotation },
          frozen: false
        };
      })
    };
  }

  private updateRollStateFromPlayback(
    state: OverlayRollState,
    result: DiceRollResult,
    playback: DiceRollPlaybackResult
  ): void {
    if (state.dice.length !== playback.dice.length || result.dice.length !== state.dice.length) {
      throw new Error("Reroll playback did not return state for every die.");
    }

    state.rollId = result.rollId;

    for (let index = 0; index < state.dice.length; index += 1) {
      const stateDie = state.dice[index]!;
      const logicalDie = result.dice[index]!;
      const playedDie = playback.dice[index]!;
      stateDie.sides = logicalDie.sides;
      stateDie.value = logicalDie.value;
      stateDie.position = { ...playedDie.position };
      stateDie.rotation = { ...playedDie.rotation };
    }
  }

  private getCurrentResult(): DiceOverlayRollResult {
    const state = this.requireRollState();

    return {
      rollId: state.rollId,
      dice: state.dice.map((die) => ({
        id: die.id,
        sides: die.sides,
        value: die.value,
        frozen: die.frozen,
        position: { ...die.position },
        rotation: { ...die.rotation },
        ...(die.frozenPhysicsMode
          ? { frozenPhysicsMode: die.frozenPhysicsMode }
          : {})
      })),
      modifier: state.modifier,
      total: state.dice.reduce((sum, die) => sum + die.value, 0) + state.modifier,
      ...(state.reason === undefined ? {} : { reason: state.reason })
    };
  }

  private createFrozenPlanningState(state: OverlayRollState): FrozenRollDieState[] {
    return state.dice.flatMap((die, dieIndex) => {
      if (!die.frozen) {
        return [];
      }

      return [{
        dieIndex,
        sides: die.sides,
        expectedValue: die.value,
        physicsMode: die.frozenPhysicsMode ?? "fully-frozen",
        position: { ...die.position },
        quaternion: { ...die.rotation }
      }];
    });
  }

  private getCurrentAppearances(
    state: OverlayRollState
  ): readonly (DiceAppearance | undefined)[] {
    return state.dice.map((die) => {
      if (!die.frozen || !die.frozenAppearance) {
        return die.definition.appearance;
      }

      const override: DiceAppearance = {
        ...(die.frozenAppearance.color === undefined
          ? {}
          : { color: die.frozenAppearance.color }),
        ...(die.frozenAppearance.textureUrl === undefined
          ? {}
          : { texture: die.frozenAppearance.textureUrl })
      };
      return mergeDiceAppearances(die.definition.appearance, override);
    });
  }

  private async applyCurrentAppearances(
    surface: OverlaySurface,
    state: OverlayRollState
  ): Promise<void> {
    if (!surface.player.setAppearances) {
      return;
    }

    await surface.player.setAppearances(this.getCurrentAppearances(state));
  }

  private resolveFreezeOptions(options: DiceFreezeOptions): Required<Pick<DiceFreezeOptions, "physicsMode">> & {
    readonly appearance?: FrozenDiceAppearance;
  } {
    const physicsMode = options.physicsMode ?? this.options.freeze?.physicsMode ?? "fully-frozen";

    if (physicsMode !== "fully-frozen" && physicsMode !== "translation-only") {
      throw new RangeError(
        `physicsMode must be "fully-frozen" or "translation-only"; received ${String(physicsMode)}.`
      );
    }

    const appearance =
      this.options.freeze?.appearance || options.appearance
        ? {
            ...this.options.freeze?.appearance,
            ...options.appearance
          }
        : undefined;

    return { physicsMode, ...(appearance ? { appearance } : {}) };
  }

  private resolveDiceByIds(
    state: OverlayRollState,
    ids: string | readonly string[]
  ): OverlayDieState[] {
    const requested = typeof ids === "string" ? [ids] : [...ids];

    if (requested.length === 0) {
      throw new RangeError("At least one die id is required.");
    }

    const unique = new Set(requested);
    if (unique.size !== requested.length) {
      throw new RangeError("Die ids must be unique.");
    }

    return requested.map((id) => {
      const die = state.dice.find((candidate) => candidate.id === id);
      if (!die) {
        throw new RangeError(`Unknown die id: ${id}.`);
      }
      return die;
    });
  }

  private requireRollState(): OverlayRollState {
    if (!this.rollState) {
      throw new DiceOverlayError("roll", "No completed dice roll is available.");
    }
    return this.rollState;
  }

  private requireSurface(): OverlaySurface {
    if (!this.surface) {
      throw new DiceOverlayError("rendering", "No dice surface is currently open.");
    }
    return this.surface;
  }

  private assertIdleState(): void {
    if (this.activeRoll) {
      throw new DiceOverlayError("roll", "A dice roll is already in progress.");
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
