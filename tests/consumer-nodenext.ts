import {
  BackgroundRollPlanner,
  DirectRollPlanner,
  DiceRollPlayer,
  RollPlanner,
  SUPPORTED_DICE_SIDES,
  createDiceRollEvent,
  validateDiceRollEvent,
  type DiceAppearance,
  type DiceRollRequest,
  type DiceRollResult,
  type DirectRollPlan,
  type PresimulatedRollPlan
} from "@partybeam/dice-kit";

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
const event = createDiceRollEvent(result, { definitions: request.dice });
const validatedEvent = validateDiceRollEvent(JSON.parse(JSON.stringify(event)));

declare const directPlanner: DirectRollPlanner;
declare const presimulatedPlanner: RollPlanner;
declare const backgroundPlanner: BackgroundRollPlanner;
declare const player: DiceRollPlayer;

const directPlan: DirectRollPlan = directPlanner.plan(request, "consumer-direct");
const presimulatedPlan: PresimulatedRollPlan = presimulatedPlanner.plan(result);
const backgroundPlan: Promise<PresimulatedRollPlan> = backgroundPlanner.plan(result);

createDiceRollEvent(result, { plan: presimulatedPlan });
// @ts-expect-error Direct physical plans are not authoritative replay data.
createDiceRollEvent(result, { plan: directPlan });

void player.play(directPlan);
void player.play(presimulatedPlan);
void SUPPORTED_DICE_SIDES;
void missingFaceTexture;
void validatedEvent;
void backgroundPlan;
