import {
  SUPPORTED_DICE_SIDES,
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

void SUPPORTED_DICE_SIDES;
void missingFaceTexture;
