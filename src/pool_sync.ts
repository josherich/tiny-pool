import type RapierModule from '@dimforge/rapier3d-compat';
import {
  type Ball,
  type Pocket,
  type Pocketed,
  type PocketedThisShot,
  type PocketedEvent,
  SCALE,
  FIXED_DT,
  physicsConfig,
  checkPockets,
  applyRollingFriction,
  computeSubSteps
} from './pool_physics';
import { allBallsStopped } from './pool_rules';

// --- Types ---

export type ShotInput = {
  angle: number;
  power: number;
  topspin: number;
  sidespin: number;
};

export type BallState = {
  number: number;
  type: string;
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  angvel: { x: number; y: number; z: number };
  rotation: { w: number; x: number; y: number; z: number };
};

export type GameStateSnapshot = {
  balls: BallState[];
  pocketed: { solids: number[]; stripes: number[]; eight: boolean };
};

export type TurnState = {
  currentPlayer: number;
  playerTypes: { player1: string | null; player2: string | null };
  pocketed: { solids: number[]; stripes: number[]; eight: boolean };
};

export type GameMessage =
  | { type: 'shot'; input: ShotInput }
  | { type: 'state_hash'; hash: string }
  | { type: 'state_sync'; snapshot: GameStateSnapshot }
  | { type: 'turn'; state: TurnState }
  | { type: 'game_over'; winner: number; reason: string }
  | { type: 'ball_in_hand_place'; position: { x: number; z: number } };

// --- Constants ---

export const MAX_SIM_STEPS = Math.round((1 / FIXED_DT) * 30); // 30 seconds at physics rate

// --- Serialization ---

export function serializeBalls(balls: Ball[]): BallState[] {
  return balls
    .map(ball => {
      const pos = ball.body.translation();
      const linvel = ball.body.linvel();
      const angvel = ball.body.angvel();
      const rot = ball.body.rotation();
      return {
        number: ball.number,
        type: ball.type,
        position: { x: pos.x, y: pos.y, z: pos.z },
        linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
        angvel: { x: angvel.x, y: angvel.y, z: angvel.z },
        rotation: { w: rot.w, x: rot.x, y: rot.y, z: rot.z }
      };
    })
    .sort((a, b) => a.number - b.number);
}

// --- Hashing ---

function quantize(v: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

export function hashGameState(snapshot: GameStateSnapshot): string {
  const parts = snapshot.balls.map(b =>
    `${b.number}:${quantize(b.position.x)},${quantize(b.position.y)},${quantize(b.position.z)}`
  );
  parts.push(`s:${[...snapshot.pocketed.solids].sort().join(',')}`);
  parts.push(`t:${[...snapshot.pocketed.stripes].sort().join(',')}`);
  parts.push(`e:${snapshot.pocketed.eight}`);
  return fnv1aHash(parts.join('|'));
}

// --- State Restoration ---

export function restoreBallStates(
  world: RapierModule.World,
  balls: Ball[],
  snapshot: GameStateSnapshot,
  RAPIER: typeof RapierModule
): Ball[] {
  for (const ball of balls) {
    world.removeRigidBody(ball.body);
  }

  const newBalls: Ball[] = [];
  const physRadius = 12 / SCALE;

  for (const bs of snapshot.balls) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(bs.position.x, bs.position.y, bs.position.z)
      .setLinearDamping(physicsConfig.LINEAR_DAMPING)
      .setAngularDamping(physicsConfig.ANGULAR_DAMPING)
      .setCcdEnabled(true);

    const body = world.createRigidBody(bodyDesc);
    body.setLinvel(bs.linvel, true);
    body.setAngvel(bs.angvel, true);
    body.setRotation(bs.rotation, true);

    const colliderDesc = RAPIER.ColliderDesc.ball(physRadius)
      .setRestitution(physicsConfig.BALL_RESTITUTION)
      .setFriction(physicsConfig.BALL_FRICTION)
      .setMass(physicsConfig.BALL_MASS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = world.createCollider(colliderDesc, body);
    newBalls.push({ body, collider, type: bs.type, number: bs.number });
  }

  return newBalls;
}

// --- Deterministic Simulation ---

export type SimulationResult = {
  finalSnapshot: GameStateSnapshot;
  hash: string;
  pocketedEvents: PocketedEvent[];
  pocketedThisShot: PocketedThisShot;
  stepsRun: number;
};

export function simulateShot(
  world: RapierModule.World,
  balls: Ball[],
  pockets: Pocket[],
  pocketed: Pocketed,
  input: ShotInput,
  canvasWidth: number,
  canvasHeight: number,
  RAPIER: typeof RapierModule
): SimulationResult {
  const cueBall = balls.find(b => b.type === 'cue');
  if (!cueBall) throw new Error('No cue ball found');

  const impulseStrength = input.power * 8;
  const impulseX = Math.cos(input.angle) * impulseStrength;
  const impulseZ = Math.sin(input.angle) * impulseStrength;

  cueBall.body.applyImpulse({ x: impulseX, y: 0, z: impulseZ }, true);
  cueBall.body.applyTorqueImpulse({
    x: -impulseZ * input.topspin,
    y: impulseStrength * input.sidespin,
    z: impulseX * input.topspin
  }, true);

  const allPocketedEvents: PocketedEvent[] = [];
  const pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };
  let steps = 0;

  const canvasProxy = { width: canvasWidth, height: canvasHeight };

  while (steps < MAX_SIM_STEPS) {
    // Adaptive sub-stepping matching the live game loop
    const subSteps = computeSubSteps(balls, FIXED_DT);
    const subDt = FIXED_DT / subSteps;
    world.timestep = subDt;

    for (let s = 0; s < subSteps; s++) {
      world.step();

      const events = checkPockets({
        world,
        canvas: canvasProxy as any,
        balls,
        pockets,
        pocketed,
        pocketedThisShot,
        RAPIER
      });
      allPocketedEvents.push(...events);
    }
    applyRollingFriction(balls, FIXED_DT);

    steps++;

    if (steps > 10 && allBallsStopped(balls)) break;
  }

  const finalSnapshot: GameStateSnapshot = {
    balls: serializeBalls(balls),
    pocketed: { solids: [...pocketed.solids], stripes: [...pocketed.stripes], eight: pocketed.eight }
  };

  return {
    finalSnapshot,
    hash: hashGameState(finalSnapshot),
    pocketedEvents: allPocketedEvents,
    pocketedThisShot,
    stepsRun: steps
  };
}
