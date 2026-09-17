import { describe, expect, it } from "vitest";
import {
  DicePhysicsWorld,
  RollPlanner,
  createSeededRandomProvider,
  type RollPlan
} from "../src/index.js";

function replayPlan(plan: RollPlan): readonly number[] {
  const world = new DicePhysicsWorld(plan.physics);

  try {
    const bodies = plan.dice.map((die) => world.addDie(die.sides, die.initialState));
    const simulation = world.simulateUntilStable(bodies, plan.stability);

    expect(simulation.stable).toBe(true);

    return bodies.map((body, index) => {
      const die = plan.dice[index]!;
      return world.getDieValue(die.sides, body);
    });
  } finally {
    world.dispose();
  }
}

describe("RollPlan replay", () => {
  it("survives JSON serialization and replays without generating new random inputs", () => {
    const planner = new RollPlanner({
      randomProvider: createSeededRandomProvider("replay-session", "physics"),
      maxPlanningTimeMs: 5000
    });
    const original = planner.plan({
      rollId: "saved-roll",
      dice: [
        { sides: 8, value: 6 },
        { sides: 20, value: 14 }
      ],
      modifier: 0,
      total: 20
    });
    const serialized = JSON.stringify(original);
    const restored = JSON.parse(serialized) as RollPlan;

    expect(restored).toEqual(original);
    expect(serialized).not.toContain("frame");
    expect(replayPlan(restored)).toEqual(restored.dice.map((die) => die.expectedValue));
  });
});
