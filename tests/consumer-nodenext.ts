import {
  DiceOverlay,
  DiceRoller,
  SUPPORTED_DICE_SIDES,
  createDiceRollEvent,
  type DiceAppearance,
  type DiceRollRequest,
  type DiceRollResult,
  type DirectRollPlan,
  type PresimulatedRollPlan,
  type RollPlan
} from "@dihor/gamekit-dice";
import {
  resolveDiceAppearance,
  type ResolvedDiceAppearance
} from "@dihor/gamekit-dice/appearance";
import {
  createSeededRandomProvider,
  getDiceTopology
} from "@dihor/gamekit-dice/core";
import {
  validateDiceRollEvent
} from "@dihor/gamekit-dice/events";
import {
  DiceOverlay as OverlayDiceOverlay,
  DiceOverlayError
} from "@dihor/gamekit-dice/overlay";
import {
  BackgroundRollPlanner,
  DirectRollPlanner,
  DiceRenderer,
  DiceRollPlayer,
  RollPlanner
} from "@dihor/gamekit-dice/advanced";

const request: DiceRollRequest = {
  dice: [
    {
      sides: 20,
      appearance: {
        faces: {
          20: "/textures/critical.png"
        }
      }
    }
  ]
};

const result: DiceRollResult = {
  rollId: "consumer-roll",
  dice: [{ sides: 20, value: 20 }],
  modifier: 0,
  total: 20
};

const appearance: DiceAppearance = request.dice[0]?.appearance ?? {};
const missingFaceTexture: string | undefined = appearance.faces?.[1];
const resolvedAppearance: ResolvedDiceAppearance = resolveDiceAppearance(appearance);
const event = createDiceRollEvent(result, { definitions: request.dice });
const validatedEvent = validateDiceRollEvent(JSON.parse(JSON.stringify(event)));

const roller = new DiceRoller({
  randomProvider: createSeededRandomProvider("consumer-seed", "logic")
});

declare const directPlanner: DirectRollPlanner;
declare const presimulatedPlanner: RollPlanner;
declare const backgroundPlanner: BackgroundRollPlanner;
declare const player: DiceRollPlayer;

const directPlan: DirectRollPlan = directPlanner.plan(request, "consumer-direct");
const presimulatedPlan: PresimulatedRollPlan = presimulatedPlanner.plan(result);
const backgroundPlan: Promise<RollPlan> = backgroundPlanner.plan(result);

createDiceRollEvent(result, { plan: presimulatedPlan });
// @ts-expect-error Direct physical plans are not authoritative replay data.
createDiceRollEvent(result, { plan: directPlan });

void player.play(directPlan);
void player.play(presimulatedPlan);
void DiceOverlay;
void OverlayDiceOverlay;
void DiceOverlayError;
void DiceRenderer;
void SUPPORTED_DICE_SIDES;
void getDiceTopology;
void roller;
void missingFaceTexture;
void resolvedAppearance;
void validatedEvent;
void backgroundPlan;
