import { RollPlanner } from "./RollPlanner.js";
import type {
  RollPlanningWorkerRequest,
  RollPlanningWorkerResponse
} from "./RollPlannerWorkerProtocol.js";

interface PlanningWorkerScope {
  onmessage: ((event: { readonly data: RollPlanningWorkerRequest }) => void) | null;
  postMessage(message: RollPlanningWorkerResponse): void;
}

const scope = globalThis as unknown as PlanningWorkerScope;
const planner = new RollPlanner();

scope.onmessage = (event) => {
  const request = event.data;

  try {
    const plan = planner.plan(request.result, request.options);
    scope.postMessage({ id: request.id, ok: true, plan });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
};
