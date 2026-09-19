import { describe, expect, it } from "vitest";
import { DicePhysicsWorld } from "../src/advanced.js";

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

  it("updates arena walls without recreating or mutating existing dice bodies", () => {
    const initialBoundary = [
      { x: -5, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: 5 },
      { x: -5, z: 5 }
    ] as const;
    const nextBoundary = [
      { x: -6, z: -4 },
      { x: 6, z: -4 },
      { x: 5, z: 4 },
      { x: -5, z: 4 }
    ] as const;
    const world = new DicePhysicsWorld({ arenaBoundary: initialBoundary });
    const body = world.addD6({
      ...stableState,
      velocity: { x: 0.4, y: 0.2, z: -0.3 },
      angularVelocity: { x: 0.1, y: -0.2, z: 0.3 }
    });
    const initialPosition = body.position.clone();
    const initialQuaternion = body.quaternion.clone();
    const initialVelocity = body.velocity.clone();
    const initialAngularVelocity = body.angularVelocity.clone();
    const staticBefore = world.world.bodies.filter((candidate) => candidate.mass === 0);

    expect(world.updateArenaBoundary(nextBoundary)).toBe(true);

    const staticAfter = world.world.bodies.filter((candidate) => candidate.mass === 0);
    expect(world.world.bodies).toContain(body);
    expect(world.world.bodies).toHaveLength(6);
    expect(staticAfter).toHaveLength(5);
    expect(staticAfter[0]).toBe(staticBefore[0]);
    expect(staticAfter.slice(1)).not.toEqual(staticBefore.slice(1));
    expect([body.position.x, body.position.y, body.position.z]).toEqual([
      initialPosition.x,
      initialPosition.y,
      initialPosition.z
    ]);
    expect([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]).toEqual([
      initialQuaternion.x,
      initialQuaternion.y,
      initialQuaternion.z,
      initialQuaternion.w
    ]);
    expect([body.velocity.x, body.velocity.y, body.velocity.z]).toEqual([
      initialVelocity.x,
      initialVelocity.y,
      initialVelocity.z
    ]);
    expect([body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z]).toEqual([
      initialAngularVelocity.x,
      initialAngularVelocity.y,
      initialAngularVelocity.z
    ]);

    const unchangedStaticBodies = [...staticAfter];
    expect(
      world.updateArenaBoundary(
        nextBoundary.map((point) => ({ x: point.x + 1e-6, z: point.z - 1e-6 }))
      )
    ).toBe(false);
    expect(world.world.bodies.filter((candidate) => candidate.mass === 0)).toEqual(
      unchangedStaticBodies
    );

    world.dispose();
  });

  it("detects stable and moving D6 bodies from velocities", () => {
    const world = new DicePhysicsWorld();
    const body = world.addD6(stableState);

    expect(world.areBodiesStable([body])).toBe(true);

    body.velocity.set(1, 0, 0);
    expect(world.areBodiesStable([body])).toBe(false);

    world.dispose();
  });

  it("keeps fully frozen dice immovable even when initial velocities are supplied", () => {
    const world = new DicePhysicsWorld({ gravity: { x: 0, y: 0, z: 0 } });
    const body = world.addD6(
      {
        ...stableState,
        position: { x: -1, y: 0.5, z: 0.25 },
        velocity: { x: 4, y: 2, z: -3 },
        angularVelocity: { x: 3, y: -4, z: 5 }
      },
      { frozenPhysicsMode: "fully-frozen" }
    );
    const position = body.position.clone();
    const quaternion = body.quaternion.clone();

    for (let step = 0; step < 30; step += 1) {
      world.step();
    }

    expect(body.mass).toBe(0);
    expect(body.velocity.lengthSquared()).toBe(0);
    expect(body.angularVelocity.lengthSquared()).toBe(0);
    expect([body.position.x, body.position.y, body.position.z]).toEqual([
      position.x,
      position.y,
      position.z
    ]);
    expect([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]).toEqual([
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w
    ]);

    world.dispose();
  });

  it("allows translation-only frozen dice to move without rotating", () => {
    const world = new DicePhysicsWorld({
      gravity: { x: 0, y: 0, z: 0 },
      linearDamping: 0,
      angularDamping: 0
    });
    const body = world.addD6(
      {
        ...stableState,
        position: { x: -2, y: 2, z: 0 },
        velocity: { x: 2, y: 0, z: 0 },
        angularVelocity: { x: 6, y: 4, z: -3 }
      },
      { frozenPhysicsMode: "translation-only" }
    );
    const initialX = body.position.x;
    const quaternion = body.quaternion.clone();

    for (let step = 0; step < 10; step += 1) {
      world.step();
    }

    expect(body.mass).toBe(1);
    expect(body.fixedRotation).toBe(true);
    expect(body.position.x).toBeGreaterThan(initialX);
    expect(body.angularVelocity.lengthSquared()).toBe(0);
    expect([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]).toEqual([
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w
    ]);

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
