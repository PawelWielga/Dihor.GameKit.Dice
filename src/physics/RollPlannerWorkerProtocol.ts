import type { DiceRollResult } from "../core/index.js";
import type { RollPlan } from "./RollModels.js";
import type { RollPlanningOptions } from "./RollPlanner.js";

export interface RollPlanningWorkerRequest {
  readonly id: number;
  readonly result: DiceRollResult;
  readonly options: RollPlanningOptions;
}

export interface RollPlanningWorkerFailure {
  readonly name: string;
  readonly message: string;
}

export type RollPlanningWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly plan: RollPlan;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: RollPlanningWorkerFailure;
    };
