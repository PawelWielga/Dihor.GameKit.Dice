import {
  SUPPORTED_DICE_SIDES,
  createDiceRollEvent,
  validateDiceRollEvent,
  type DiceAppearance,
  type DiceRollRequest
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

const appearance: DiceAppearance = request.dice[0]?.appearance ?? {};
const missingFaceTexture: string | undefined = appearance.faces?.[1];
const event = createDiceRollEvent({
  rollId: "consumer-roll",
  dice: [{ sides: 20, value: 20 }],
  modifier: 0,
  total: 20
}, { definitions: request.dice });
const validatedEvent = validateDiceRollEvent(JSON.parse(JSON.stringify(event)));

void SUPPORTED_DICE_SIDES;
void missingFaceTexture;
void validatedEvent;
