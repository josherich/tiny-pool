import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createWorld,
  setupTable,
  checkPockets,
  applyRollingFriction,
  computeSubSteps,
  getTableGeometry,
  physicsConfig,
  SCALE,
  TABLE,
  FIXED_DT,
  type Ball,
  type Pocketed,
  type PocketedThisShot
} from './pool_physics';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;
const NOSE = TABLE.CUSHION_INSET + TABLE.CUSHION_WIDTH; // play-area edge (px)
const BALL_RADIUS_PHYS = TABLE.BALL_RADIUS / SCALE;

const createMockCanvas = () =>
  ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT } as HTMLCanvasElement);

function createBall(world: RAPIER.World, pixelX: number, pixelY: number): Ball {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pixelX / SCALE, BALL_RADIUS_PHYS, pixelY / SCALE)
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

  return { body, collider, type: 'solid', number: 1 };
}

/**
 * Simulate a single ball shot at the given angle/power, mirroring the live
 * game loop (sub-stepping + pocket checks each sub-step). Returns tracking
 * info about the ball's trajectory and whether it was pocketed.
 */
function simulateSingleBall(
  pixelX: number,
  pixelY: number,
  angle: number,
  power: number
) {
  const canvas = createMockCanvas();
  const world = createWorld(RAPIER);
  const { pockets } = setupTable({ canvas, world, RAPIER });
  const balls: Ball[] = [createBall(world, pixelX, pixelY)];
  const pocketed: Pocketed = { solids: [], stripes: [], eight: false };
  const pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };

  const impulseStrength = power * 8;
  balls[0].body.applyImpulse(
    { x: Math.cos(angle) * impulseStrength, y: 0, z: Math.sin(angle) * impulseStrength },
    true
  );

  let minPixelX = pixelX, maxPixelX = pixelX;
  let minPixelY = pixelY, maxPixelY = pixelY;

  const maxSteps = Math.round((1 / FIXED_DT) * 10); // 10 seconds max
  for (let step = 0; step < maxSteps && balls.length > 0; step++) {
    const subSteps = computeSubSteps(balls, FIXED_DT);
    const subDt = FIXED_DT / subSteps;
    world.timestep = subDt;

    for (let s = 0; s < subSteps && balls.length > 0; s++) {
      world.step();
      if (balls.length > 0) {
        const pos = balls[0].body.translation();
        minPixelX = Math.min(minPixelX, pos.x * SCALE);
        maxPixelX = Math.max(maxPixelX, pos.x * SCALE);
        minPixelY = Math.min(minPixelY, pos.z * SCALE);
        maxPixelY = Math.max(maxPixelY, pos.z * SCALE);
      }
      checkPockets({ world, canvas, balls, pockets, pocketed, pocketedThisShot, RAPIER });
    }
    if (balls.length === 0) break;

    applyRollingFriction(balls, FIXED_DT);
    const v = balls[0].body.linvel();
    if (Math.sqrt(v.x * v.x + v.z * v.z) < 0.01) break;
  }

  const finalPos = balls.length > 0 ? balls[0].body.translation() : null;
  world.free();

  return {
    wasPocketed: balls.length === 0,
    pocketedThisShot,
    minPixelX, maxPixelX, minPixelY, maxPixelY,
    finalPixelX: finalPos ? finalPos.x * SCALE : null,
    finalPixelY: finalPos ? finalPos.z * SCALE : null
  };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('Table geometry consistency', () => {
  it('pockets returned by setupTable match the shared geometry', () => {
    const canvas = createMockCanvas();
    const world = createWorld(RAPIER);
    const { pockets } = setupTable({ canvas, world, RAPIER });
    const geometry = getTableGeometry(CANVAS_WIDTH, CANVAS_HEIGHT);
    expect(pockets).toEqual(geometry.pockets);
    world.free();
  });

  it('cushion polygons span exactly the visual cushion band', () => {
    const geometry = getTableGeometry(CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const cushion of geometry.cushions) {
      const [outerStart, outerEnd, noseEnd, noseStart] = cushion.points;
      if (cushion.inward.y !== 0) {
        // Horizontal cushion: rail edge at the inset, nose edge one band deeper
        expect(Math.abs(outerStart.y - noseStart.y)).toBe(TABLE.CUSHION_WIDTH);
        expect(Math.abs(outerEnd.y - noseEnd.y)).toBe(TABLE.CUSHION_WIDTH);
      } else {
        expect(Math.abs(outerStart.x - noseStart.x)).toBe(TABLE.CUSHION_WIDTH);
        expect(Math.abs(outerEnd.x - noseEnd.x)).toBe(TABLE.CUSHION_WIDTH);
      }
    }
  });
});

describe('Cushion collision matches visuals', () => {
  it('ball bounces off the top cushion exactly at the drawn nose line', () => {
    // Shoot straight up at the middle of the top-left cushion segment
    const result = simulateSingleBall(300, 350, -Math.PI / 2, 3.0);

    expect(result.wasPocketed).toBe(false);
    // The ball center should never pass closer to the rail than nose + radius
    // (small tolerance for solver penetration)
    expect(result.minPixelY).toBeGreaterThan(NOSE + TABLE.BALL_RADIUS - 3);
    // And it must have actually reached the cushion
    expect(result.minPixelY).toBeLessThan(NOSE + TABLE.BALL_RADIUS + 3);
  });

  it('ball bounces off the left cushion exactly at the drawn nose line', () => {
    const result = simulateSingleBall(300, 350, Math.PI, 3.0);

    expect(result.wasPocketed).toBe(false);
    expect(result.minPixelX).toBeGreaterThan(NOSE + TABLE.BALL_RADIUS - 3);
    expect(result.minPixelX).toBeLessThan(NOSE + TABLE.BALL_RADIUS + 3);
  });

  it('ball aimed at cushion near a corner pocket bounces instead of vanishing', () => {
    // x=120 is well inside the top-left cushion segment (nose spans 85..~558)
    const result = simulateSingleBall(120, 350, -Math.PI / 2, 3.0);

    expect(result.wasPocketed).toBe(false);
    expect(result.minPixelY).toBeGreaterThan(NOSE + TABLE.BALL_RADIUS - 3);
  });

  it('ball shot at the jaw next to the side pocket never tunnels off the table', () => {
    // x=570 used to be inside the bare cushion gap: the ball sailed through
    // a visually solid rail and was silently removed by the out-of-bounds
    // fallback. Now the angled jaw collider deflects it.
    const result = simulateSingleBall(570, 350, -Math.PI / 2, 4.0);

    // The ball must never get deeper than the side pocket center line;
    // it either bounces off the jaw or is funneled into the pocket mouth.
    expect(result.minPixelY).toBeGreaterThan(TABLE.CUSHION_INSET - TABLE.SIDE_POCKET_OFFSET);
  });
});

describe('Pocketing matches visuals', () => {
  it('ball shot straight into the top-side pocket is pocketed', () => {
    const result = simulateSingleBall(CANVAS_WIDTH / 2, 350, -Math.PI / 2, 3.0);
    expect(result.wasPocketed).toBe(true);
    expect(result.pocketedThisShot.solids).toContain(1);
  });

  it('ball shot diagonally into the top-left corner pocket is pocketed', () => {
    const result = simulateSingleBall(200, 200, (-3 * Math.PI) / 4, 3.0);
    expect(result.wasPocketed).toBe(true);
    expect(result.pocketedThisShot.solids).toContain(1);
  });

  it('ball shot diagonally into the bottom-right corner pocket is pocketed', () => {
    const result = simulateSingleBall(
      CANVAS_WIDTH - 200, CANVAS_HEIGHT - 200, Math.PI / 4, 3.0
    );
    expect(result.wasPocketed).toBe(true);
  });

  it('slow roll along the cushion is not pocketed mid-rail', () => {
    // Roll gently parallel to the top cushion, hugging it: the ball should
    // come to rest on the table, not drop into a phantom pocket
    const result = simulateSingleBall(300, NOSE + TABLE.BALL_RADIUS + 1, 0, 1.0);
    expect(result.wasPocketed).toBe(false);
    expect(result.finalPixelY).toBeGreaterThan(NOSE);
  });
});
