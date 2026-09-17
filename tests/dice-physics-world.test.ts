import { describe, expect, it } from "vitest";
import { DicePhysicsWorld } from "../src/index.js";

const stableState = {
  position: { x: 0, y: 0.5, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 }
} as const;

describe("DicePhysicsWorld", () => {
  it("detects stable and moving D6 bodies from velocities", () => {
    const world = new DicePhysicsWorld();
    const body = world.addD6(stableState);

    expect(world.areBodiesStable([body])).toBe(true);

    body.velocity.set(1, 0, 0);
    expect(world.areBodiesStable([body])).toBe(false);

    world.dispose();
  });

  it("reads the physical top value from a D6 body orientation", () => {
    const world = new DicePhysicsWorld();
    const body = world.addD6(stableState);

    expect(world.getD6Value(body)).toBe(1);

    body.quaternion.set(1, 0, 0, 0);
    expect(world.getD6Value(body)).toBe(6);

    world.dispose();
  });

  it("simulates until a resting D6 remains stable for consecutive steps", () => {
    const world = new DicePhysicsWorld();
    const body = world.addD6(stableState);
    const result = world.simulateUntilStable([body], {
      consecutiveSteps: 4,
      maxSteps: 120
    });

    expect(result.stable).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(120);
    expect(world.getD6Value(body)).toBe(1);

    world.dispose();
  });
});
