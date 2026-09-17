export type { DiceAppearance } from "./appearance/index.js";
export {
  DiceRoller,
  D6_FACE_NORMALS,
  D6_FACE_VALUES,
  D6_OPPOSITE_FACE,
  SUPPORTED_DICE_SIDES,
  getD6TopValue,
  type D6FaceNormal,
  type D6FaceValue,
  type DiceDefinition,
  type DiceRollerOptions,
  type DiceRollRequest,
  type DiceRollResult,
  type DiceSides,
  type DieResult,
  type QuaternionLike,
  type RandomProvider,
  type RollIdProvider
} from "./core/index.js";
export { createD6Collider } from "./physics/index.js";
export {
  DiceMeshFactory,
  DiceRenderer,
  DiceScene,
  type D6MeshOptions,
  type DiceMesh,
  type DiceQuaternion,
  type DiceRendererOptions,
  type DiceSceneOptions,
  type DiceTransform,
  type DiceVector3,
  type DiceWebGLRendererFactory
} from "./three/index.js";
