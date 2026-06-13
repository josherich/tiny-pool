import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createWorld,
  FIXED_DT,
  physicsConfig,
  computeSubSteps,
  applyRollingFriction,
  PHYS_BALL_RADIUS,
  type Ball
} from './pool_physics';

const BALL_RADIUS_PHYS = PHYS_BALL_RADIUS;

/** Create a single ball in the given world. */
function createBall(
  world: RAPIER.World,
  physX: number,
  physZ: number,
  type: string,
  number: number
): Ball {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(physX, BALL_RADIUS_PHYS, physZ)
    .setLinearDamping(physicsConfig.LINEAR_DAMPING)
    .setAngularDamping(physicsConfig.ANGULAR_DAMPING)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS_PHYS)
    .setRestitution(physicsConfig.BALL_RESTITUTION)
    .setFriction(physicsConfig.BALL_FRICTION)
    .setMass(physicsConfig.BALL_MASS)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

  const collider = world.createCollider(colliderDesc, body);
  return { body, collider, type, number };
}

/**
 * Create a minimal world with just a cue ball and one target ball.
 * The target ball is placed at a given offset from the cue ball.
 */
function createTwoBallSetup(targetOffsetX: number, targetOffsetZ: number) {
  const world = createWorld(RAPIER);
  const cuePhysX = 60;  // center of table in physics units
  const cuePhysZ = 70;
  const cueBall = createBall(world, cuePhysX, cuePhysZ, 'cue', 0);
  const targetBall = createBall(
    world,
    cuePhysX + targetOffsetX,
    cuePhysZ + targetOffsetZ,
    'solid',
    1
  );
  return { world, balls: [cueBall, targetBall], cuePhysX, cuePhysZ };
}

/**
 * Simulate a shot on a two-ball setup using adaptive sub-stepping (matching
 * the live game loop) and return the target ball's velocity direction
 * immediately after the first collision.
 */
function simulateAndGetTargetDeflection(
  world: RAPIER.World,
  balls: Ball[],
  aimAngle: number,
  power: number
): { deflectionAngle: number; targetSpeed: number } | null {
  const cueBall = balls[0];
  const targetBall = balls[1];

  // Apply impulse (same formula as pool_engine.ts applyShot)
  const impulseStrength = power * 8;
  const impulseX = Math.cos(aimAngle) * impulseStrength;
  const impulseZ = Math.sin(aimAngle) * impulseStrength;
  cueBall.body.applyImpulse({ x: impulseX, y: 0, z: impulseZ }, true);

  const maxSteps = Math.round((1 / FIXED_DT) * 5); // 5 seconds max
  for (let step = 0; step < maxSteps; step++) {
    const subSteps = computeSubSteps(balls, FIXED_DT);
    const subDt = FIXED_DT / subSteps;
    world.timestep = subDt;

    for (let s = 0; s < subSteps; s++) {
      world.step();

      // Check if target ball started moving (collision happened)
      const tv = targetBall.body.linvel();
      const targetSpeed = Math.sqrt(tv.x * tv.x + tv.z * tv.z);
      if (targetSpeed > 0.1) {
        return {
          deflectionAngle: Math.atan2(tv.z, tv.x),
          targetSpeed
        };
      }
    }

    applyRollingFriction(balls, FIXED_DT);
  }

  return null;
}

/**
 * Compute the theoretical deflection angle for the target ball given a
 * cue ball aimed at `aimAngle` hitting a target at offset (dx, dz).
 *
 * The target deflects along the line connecting the two ball centers at
 * the moment of contact (the collision normal).
 */
function theoreticalDeflectionAngle(
  targetOffsetX: number,
  targetOffsetZ: number
): number {
  // The collision normal points from cue ball center to target ball center
  // at the moment of impact. For an ideal (zero-radius timestep) collision,
  // the target deflects along this normal.
  const dist = Math.sqrt(targetOffsetX ** 2 + targetOffsetZ ** 2);
  return Math.atan2(targetOffsetZ / dist, targetOffsetX / dist);
}

beforeAll(async () => {
  await RAPIER.init();
  // Warmup world
  const w = createWorld(RAPIER);
  w.free();
});

// --- computeSubSteps Unit Tests ---

describe('computeSubSteps', () => {
  it('should return 1 when all balls are stationary', () => {
    const world = createWorld(RAPIER);
    const ball = createBall(world, 60, 70, 'cue', 0);
    expect(computeSubSteps([ball], FIXED_DT)).toBe(1);
    world.free();
  });

  it('should return 1 for slow-moving balls', () => {
    const world = createWorld(RAPIER);
    const ball = createBall(world, 60, 70, 'cue', 0);
    // Set a slow velocity: 1 physics unit/s
    ball.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
    // distance per step = 1 * (1/240) ≈ 0.00417
    // maxDistPerStep = 2.4 * 0.5 = 1.2
    // needed = ceil(0.00417 / 1.2) = 1
    expect(computeSubSteps([ball], FIXED_DT)).toBe(1);
    world.free();
  });

  it('should subdivide for fast-moving balls', () => {
    const world = createWorld(RAPIER);
    const ball = createBall(world, 60, 70, 'cue', 0);
    // Max power shot: impulse = 9 * 8 = 72, v = 72 / 0.17 ≈ 423 phys units/s
    ball.body.setLinvel({ x: 423, y: 0, z: 0 }, true);
    const steps = computeSubSteps([ball], FIXED_DT);
    // distance per step = 423 / 240 ≈ 1.76
    // maxDistPerStep = 1.2
    // needed = ceil(1.76 / 1.2) = 2
    expect(steps).toBe(2);
    world.free();
  });

  it('should cap at 16 sub-steps for extreme speeds', () => {
    const world = createWorld(RAPIER);
    const ball = createBall(world, 60, 70, 'cue', 0);
    // Absurdly high speed
    ball.body.setLinvel({ x: 50000, y: 0, z: 0 }, true);
    expect(computeSubSteps([ball], FIXED_DT)).toBe(16);
    world.free();
  });

  it('should use the fastest ball when multiple balls have different speeds', () => {
    const world = createWorld(RAPIER);
    const slow = createBall(world, 50, 70, 'cue', 0);
    const fast = createBall(world, 70, 70, 'solid', 1);
    slow.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
    fast.body.setLinvel({ x: 423, y: 0, z: 0 }, true);
    const stepsTwo = computeSubSteps([slow, fast], FIXED_DT);
    const stepsOne = computeSubSteps([fast], FIXED_DT);
    expect(stepsTwo).toBe(stepsOne);
    world.free();
  });

  it('should increase sub-steps proportionally with speed', () => {
    const world = createWorld(RAPIER);
    const ball = createBall(world, 60, 70, 'cue', 0);

    ball.body.setLinvel({ x: 200, y: 0, z: 0 }, true);
    const stepsLow = computeSubSteps([ball], FIXED_DT);

    ball.body.setLinvel({ x: 800, y: 0, z: 0 }, true);
    const stepsHigh = computeSubSteps([ball], FIXED_DT);

    expect(stepsHigh).toBeGreaterThan(stepsLow);
    world.free();
  });
});

// --- Collision Accuracy Integration Tests ---

describe('Overshoot Collision Accuracy', () => {
  // Test a 30-degree cut shot at various power levels.
  // The target is offset so the aim line must cut at ~30 degrees.
  //
  // Geometry: target at (distance, 0) means a straight-on shot.
  // To create a 30-degree cut, we offset the target perpendicularly.
  //
  // We'll place the target at a distance of 60 physics units along X
  // with a Z offset that produces the desired cut angle.

  const testCases = [
    { name: 'low power',    power: 1.5 },
    { name: 'medium power', power: 4.5 },
    { name: 'high power',   power: 7.0 },
    { name: 'max power',    power: 9.0 },
  ];

  // Two cut angle scenarios
  const cutAngles = [
    {
      label: '30-degree cut',
      // Target 30 phys units ahead in X, offset 10 units in Z
      offsetX: 30,
      offsetZ: 10,
    },
    {
      label: '45-degree cut',
      // Target 20 phys units ahead, offset 15 units in Z
      offsetX: 20,
      offsetZ: 15,
    },
  ];

  for (const cut of cutAngles) {
    describe(cut.label, () => {
      // Compute the aim angle needed to hit the target ball.
      // The cue ball must aim so its center arrives at a point
      // 2*ballRadius away from the target center, along the collision normal.
      const targetDist = Math.sqrt(cut.offsetX ** 2 + cut.offsetZ ** 2);
      // Theoretical deflection: target moves along center-to-center line
      const expectedDeflection = theoreticalDeflectionAngle(cut.offsetX, cut.offsetZ);

      // The aim angle must point at the "ghost ball" position:
      // the point along the target-cue line that is 2*radius from target center
      const contactDist = BALL_RADIUS_PHYS * 2;
      // Ghost ball position relative to cue ball
      const ghostX = cut.offsetX - (contactDist * cut.offsetX / targetDist);
      const ghostZ = cut.offsetZ - (contactDist * cut.offsetZ / targetDist);
      // Actually, for a proper cut shot, we aim at the ghost ball position
      // which is offset from the target center by one ball diameter along
      // the opposite of the desired collision normal
      const aimAngle = Math.atan2(ghostZ, ghostX);

      for (const tc of testCases) {
        it(`should have <5° deflection error at ${tc.name} (power=${tc.power})`, () => {
          const { world, balls } = createTwoBallSetup(cut.offsetX, cut.offsetZ);

          const result = simulateAndGetTargetDeflection(world, balls, aimAngle, tc.power);
          world.free();

          expect(result).not.toBeNull();
          if (!result) return;

          // Compute angular error in degrees
          let angleDiff = result.deflectionAngle - expectedDeflection;
          // Normalize to [-π, π]
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          const errorDegrees = Math.abs(angleDiff) * (180 / Math.PI);

          // With adaptive sub-stepping, error should be small at all powers.
          // Before the fix, high power shots could have ~9° error.
          expect(errorDegrees).toBeLessThan(5);
        });
      }

      it('should not have significantly worse accuracy at max power vs low power', () => {
        const lowPower = 1.5;
        const maxPower = 9.0;

        const { world: w1, balls: b1 } = createTwoBallSetup(cut.offsetX, cut.offsetZ);
        const lowResult = simulateAndGetTargetDeflection(w1, b1, aimAngle, lowPower);
        w1.free();

        const { world: w2, balls: b2 } = createTwoBallSetup(cut.offsetX, cut.offsetZ);
        const highResult = simulateAndGetTargetDeflection(w2, b2, aimAngle, maxPower);
        w2.free();

        expect(lowResult).not.toBeNull();
        expect(highResult).not.toBeNull();
        if (!lowResult || !highResult) return;

        const lowError = Math.abs(lowResult.deflectionAngle - expectedDeflection);
        const highError = Math.abs(highResult.deflectionAngle - expectedDeflection);

        // High power error should not be more than 3× the low power error.
        // Before the fix, this ratio could be 5-10×.
        // (Add a small epsilon to avoid division-by-near-zero)
        const ratio = highError / (lowError + 0.001);
        expect(ratio).toBeLessThan(3);
      });
    });
  }

  it('should produce accurate head-on collision at all power levels', () => {
    // Head-on shot: target directly in front, no cut angle.
    // The target should deflect at angle 0 (straight along X).
    const powers = [1.5, 4.5, 7.0, 9.0];

    for (const power of powers) {
      const { world, balls } = createTwoBallSetup(30, 0);
      const aimAngle = 0; // straight ahead

      const result = simulateAndGetTargetDeflection(world, balls, aimAngle, power);
      world.free();

      expect(result).not.toBeNull();
      if (!result) continue;

      // Head-on: target should deflect along X axis (angle ≈ 0)
      const errorDeg = Math.abs(result.deflectionAngle) * (180 / Math.PI);
      expect(errorDeg).toBeLessThan(2);
    }
  });
});

// --- Adaptive Sub-stepping Determinism ---

describe('Adaptive Sub-stepping Determinism', () => {
  it('should produce identical results across repeated runs with adaptive sub-stepping', () => {
    // Run the same shot twice with adaptive sub-stepping and verify
    // the target ball ends up in exactly the same place.
    function runShot() {
      const { world, balls } = createTwoBallSetup(30, 10);
      const aimAngle = Math.atan2(10, 30);
      const power = 7.0;

      const cueBall = balls[0];
      const impulseStrength = power * 8;
      cueBall.body.applyImpulse({
        x: Math.cos(aimAngle) * impulseStrength,
        y: 0,
        z: Math.sin(aimAngle) * impulseStrength
      }, true);

      // Run for 500 outer steps (about 2 seconds)
      for (let step = 0; step < 500; step++) {
        const subSteps = computeSubSteps(balls, FIXED_DT);
        const subDt = FIXED_DT / subSteps;
        world.timestep = subDt;
        for (let s = 0; s < subSteps; s++) {
          world.step();
        }
        applyRollingFriction(balls, FIXED_DT);
      }

      const targetPos = balls[1].body.translation();
      const result = { x: targetPos.x, z: targetPos.z };
      world.free();
      return result;
    }

    const run1 = runShot();
    const run2 = runShot();

    expect(run1.x).toBeCloseTo(run2.x, 8);
    expect(run1.z).toBeCloseTo(run2.z, 8);
  });
});
