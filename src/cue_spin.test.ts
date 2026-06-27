import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createWorld,
  setupTable,
  setupBalls,
  checkPockets,
  applyRollingFriction,
  applyCushionSpinToBall,
  processCollisionEvents,
  computeSubSteps,
  SCALE,
  FIXED_DT,
  physicsConfig,
  type Ball,
  type Pocket,
  type Pocketed,
  type PocketedThisShot
} from './pool_physics';
import { allBallsStopped } from './pool_rules';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;
const BALL_RADIUS_PHYS = 12 / SCALE;

const createMockCanvas = () =>
  ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT } as HTMLCanvasElement);

function createFreshWorld() {
  const canvas = createMockCanvas();
  const world = createWorld(RAPIER);
  const { pockets } = setupTable({ canvas, world, RAPIER });
  const balls = setupBalls({ canvas, world, RAPIER });
  const pocketed: Pocketed = { solids: [], stripes: [], eight: false };
  return { world, balls, pockets, pocketed, canvas };
}

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

type SpinInput = { topspin: number; sidespin: number };

/** Strike the cue ball at the given angle/power/spin and run the physics
 * forward until the cue ball's velocity has dropped below `cueStopThreshold`
 * (or `maxSeconds` elapses). Returns a trace of the cue ball's position
 * sampled every `sampleEvery` seconds. */
function runCueBallShot(
  world: RAPIER.World,
  balls: Ball[],
  pockets: Pocket[],
  pocketed: Pocketed,
  pocketedThisShot: PocketedThisShot,
  angle: number,
  power: number,
  spin: SpinInput,
  opts: { maxSeconds?: number; sampleEvery?: number } = {}
) {
  const maxSeconds = opts.maxSeconds ?? 6;
  const sampleEvery = opts.sampleEvery ?? 0.05;
  const cueBall = balls.find(b => b.type === 'cue')!;

  const impulseStrength = power * 8;
  const impulseX = Math.cos(angle) * impulseStrength;
  const impulseZ = Math.sin(angle) * impulseStrength;

  cueBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  cueBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  cueBall.body.applyImpulse({ x: impulseX, y: 0, z: impulseZ }, true);
  const spinScale = physicsConfig.SPIN_SCALE;
  cueBall.body.applyTorqueImpulse({
    x: impulseZ * spin.topspin * spinScale,
    y: impulseStrength * spin.sidespin * spinScale,
    z: -impulseX * spin.topspin * spinScale
  }, true);

  const trace: { t: number; x: number; z: number; vx: number; vz: number; wy: number }[] = [];
  const eventQueue = new RAPIER.EventQueue(true);
  const canvas = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } as any;
  const maxSteps = Math.round((1 / FIXED_DT) * maxSeconds);
  let nextSampleAt = 0;
  let elapsed = 0;
  let postCollisionCueVx: number | null = null;
  let postCollisionCueVz: number | null = null;
  let postCollisionTime: number | null = null;
  let preCollisionCueSpeed = 0;
  let sawCollision = false;

  for (let step = 0; step < maxSteps; step++) {
    const subSteps = computeSubSteps(balls, FIXED_DT);
    const subDt = FIXED_DT / subSteps;
    world.timestep = subDt;

    for (let s = 0; s < subSteps; s++) {
      world.step(eventQueue);
      processCollisionEvents(eventQueue, world, balls, {
        onBallCushionCollision: (b) => applyCushionSpinToBall(b, CANVAS_WIDTH, CANVAS_HEIGHT)
      });
      checkPockets({ world, canvas, balls, pockets, pocketed, pocketedThisShot, RAPIER });

      // Detect first ball-ball collision by watching for the target ball moving.
      if (!sawCollision) {
        const target = balls.find(b => b.type !== 'cue');
        if (target) {
          const tv = target.body.linvel();
          const tspd = Math.hypot(tv.x, tv.z);
          if (tspd > 0.5) {
            sawCollision = true;
            const cv = cueBall.body.linvel();
            postCollisionCueVx = cv.x;
            postCollisionCueVz = cv.z;
            postCollisionTime = elapsed;
          }
        }
      }
    }
    applyRollingFriction(balls, FIXED_DT);

    elapsed += FIXED_DT;
    if (elapsed >= nextSampleAt) {
      const p = cueBall.body.translation();
      const v = cueBall.body.linvel();
      const w = cueBall.body.angvel();
      trace.push({ t: elapsed, x: p.x, z: p.z, vx: v.x, vz: v.z, wy: w.y });
      nextSampleAt = elapsed + sampleEvery;
    }

    const cueLin = cueBall.body.linvel();
    preCollisionCueSpeed = Math.hypot(cueLin.x, cueLin.z);

    if (step > 20 && allBallsStopped(balls)) break;
  }

  const finalCuePos = cueBall.body.translation();
  const finalCueVel = cueBall.body.linvel();
  return {
    finalCueX: finalCuePos.x * SCALE,
    finalCueZ: finalCuePos.z * SCALE,
    finalCueSpeed: Math.hypot(finalCueVel.x, finalCueVel.z),
    postCollisionCueVx,
    postCollisionCueVz,
    postCollisionTime,
    preCollisionCueSpeed,
    sawCollision,
    trace
  };
}

beforeAll(async () => {
  await RAPIER.init();
  const warmup = createFreshWorld();
  warmup.world.free();
});

describe('Cue ball spin physics', () => {
  it('a cue ball with no spin naturally develops rolling angular velocity', () => {
    const { world, balls, pockets, pocketed } = createFreshWorld();
    const pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };

    const result = runCueBallShot(world, balls, pockets, pocketed, pocketedThisShot, 0, 3.0, { topspin: 0, sidespin: 0 }, { maxSeconds: 1 });
    void result;

    // After ~0.5s of friction, the cue ball's surface velocity v_s = v + ω×r
    // should be much smaller than the linear speed (i.e., the ball is mostly rolling).
    const cueBall = balls.find(b => b.type === 'cue')!;
    const v = cueBall.body.linvel();
    const w = cueBall.body.angvel();
    const vsX = v.x + w.z * BALL_RADIUS_PHYS;
    const vsZ = v.z - w.x * BALL_RADIUS_PHYS;
    const vMag = Math.hypot(v.x, v.z);
    const vsMag = Math.hypot(vsX, vsZ);

    expect(vMag).toBeGreaterThan(0.5);
    // Friction should have developed significant rolling: v_s << v.
    expect(vsMag).toBeLessThan(vMag * 0.5);
    world.free();
  });

  it('topspin accelerates the cue ball forward after a head-on collision (follow shot)', () => {
    // Head-on into a single target ball placed directly along +x from the cue.
    // Place target at a known x so the cue definitely hits it.
    const setupWithTarget = () => {
      const { world, balls, pockets, pocketed } = createFreshWorld();
      const pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };
      // Move target ball out of the rack and place it directly in front of cue.
      const target = balls.find(b => b.number === 1)!;
      const cueBall = balls.find(b => b.type === 'cue')!;
      const cuePos = cueBall.body.translation();
      // Target 60 phys units ahead in +x of cue (well outside rack area, clear path).
      target.body.setTranslation({ x: cuePos.x + 60, y: BALL_RADIUS_PHYS, z: cuePos.z }, true);
      target.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Remove all other balls to keep the test isolated.
      const keep = balls.filter(b => b === cueBall || b === target);
      balls.length = 0;
      balls.push(...keep);
      return { world, balls, pockets, pocketed, pocketedThisShot };
    };

    const noSpin = setupWithTarget();
    const r0 = runCueBallShot(noSpin.world, noSpin.balls, noSpin.pockets, noSpin.pocketed, noSpin.pocketedThisShot, 0, 4.0, { topspin: 0, sidespin: 0 }, { maxSeconds: 2 });
    noSpin.world.free();

    const top = setupWithTarget();
    const rTop = runCueBallShot(top.world, top.balls, top.pockets, top.pocketed, top.pocketedThisShot, 0, 4.0, { topspin: 0.5, sidespin: 0 }, { maxSeconds: 2 });
    top.world.free();

    expect(r0.sawCollision).toBe(true);
    expect(rTop.sawCollision).toBe(true);

    // With topspin, the cue ball should continue further forward after collision
    // (follow shot) than without spin.
    expect(rTop.finalCueX).toBeGreaterThan(r0.finalCueX + 20);
  });

  it('backspin reverses the cue ball after a head-on collision (draw shot)', () => {
    const setupWithTarget = () => {
      const { world, balls, pockets, pocketed } = createFreshWorld();
      const pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };
      const target = balls.find(b => b.number === 1)!;
      const cueBall = balls.find(b => b.type === 'cue')!;
      const cuePos = cueBall.body.translation();
      target.body.setTranslation({ x: cuePos.x + 60, y: BALL_RADIUS_PHYS, z: cuePos.z }, true);
      target.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const keep = balls.filter(b => b === cueBall || b === target);
      balls.length = 0;
      balls.push(...keep);
      return { world, balls, pockets, pocketed, pocketedThisShot, cueStartX: cuePos.x };
    };

    const r = setupWithTarget();
    const cueStartXpx = r.cueStartX * SCALE;
    const result = runCueBallShot(r.world, r.balls, r.pockets, r.pocketed, r.pocketedThisShot, 0, 5.0, { topspin: -0.5, sidespin: 0 }, { maxSeconds: 3 });
    r.world.free();

    expect(result.sawCollision).toBe(true);
    // After a draw shot, the cue ball should end up BEHIND its starting position
    // (i.e., finalCueX < cueStartXpx since +x is the shot direction).
    expect(result.finalCueX).toBeLessThan(cueStartXpx);
  });

  it('sidespin changes the cue ball trajectory after a cushion bounce', () => {
    // Aim the cue ball straight at the right cushion; with no spin it should
    // bounce straight back. With sidespin, the cushion grip should add a
    // tangential velocity component so the ball leaves at an angle.
    const setup = () => {
      const world = createWorld(RAPIER);
      const canvas = createMockCanvas();
      const { pockets } = setupTable({ canvas, world, RAPIER });
      const balls: Ball[] = [];
      // Place cue ball near the left side, aimed straight right at the right cushion.
      balls.push(createBall(world, 60, 70, 'cue', 0));
      return { world, balls, pockets, pocketed: { solids: [], stripes: [], eight: false } as Pocketed };
    };

    const runShot = (sidespin: number) => {
      const s = setup();
      const pThis: PocketedThisShot = { solids: [], stripes: [], cueBall: false };
      const r = runCueBallShot(s.world, s.balls, s.pockets, s.pocketed, pThis, 0, 6.0, { topspin: 0, sidespin }, { maxSeconds: 6 });
      s.world.free();
      return r;
    };

    const r0 = runShot(0);
    const rLeft = runShot(-0.5);
    const rRight = runShot(0.5);

    // Without sidespin the ball should bounce back roughly along its incoming path
    // (final z near its starting z = 70*SCALE).
    expect(Math.abs(r0.finalCueZ - 70 * SCALE)).toBeLessThan(40);

    // With opposite sidespins, the final z positions should differ from each
    // other and bracket the no-spin case.
    expect(rLeft.finalCueZ).not.toBeCloseTo(r0.finalCueZ, 1);
    expect(rRight.finalCueZ).not.toBeCloseTo(r0.finalCueZ, 1);
    // The two spin directions should push the ball in opposite z directions.
    expect(Math.sign(rLeft.finalCueZ - r0.finalCueZ)).not.toEqual(Math.sign(rRight.finalCueZ - r0.finalCueZ));
  });
});
