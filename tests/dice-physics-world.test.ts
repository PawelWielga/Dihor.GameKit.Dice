import { describe, expect, it } from "vitest";
import { DicePhysicsWorld } from "../src/index.js";

const stableState = {
  position: { x: 0, y: 0.5, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 }
} as const;

describe("DicePhysicsWorld", () => {
  it("creates a floor and four physical arena walls", () => {
    const world = new DicePhysicsWorld();
    expect(world.world.bodies).toHaveLength(5);
    world.dispose();
  });

  it("creates invisible walls from an arbitrary viewport polygon", () => {
    const boundary = [
      { x: -4, z: -2 },
      { x: 5, z: -3 },
      { x: 4, z: 3 },
      { x: -3, z: 2 }
    ] as const;
    const world = new DicePhysicsWorld({ arenaBoundary: boundary });

    expect(world.config.arenaBoundary).toEqual(boundary);
    expect(world.world.bodies).toHaveLength(5);
    expect(world.world.bodies.slice(1).some((body) => Math.abs(body.quaternion.y) > 1e-3)).toBe(true);

    world.dispose();
  });

  it("rejects malformed viewport polygons", () => {
    expect(
      () => new DicePhysicsWorld({ arenaBoundary: [{ x: 0, z: 0 }, { x: 1, z: 0 }] })
    ).toThrowError(RangeError);
  });

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
