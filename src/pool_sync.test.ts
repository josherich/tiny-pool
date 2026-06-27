import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  serializeBalls,
  hashGameState,
  restoreBallStates,
  simulateShot,
  type GameStateSnapshot,
  type ShotInput,
  type GameMessage
} from './pool_sync';
import { createWorld, setupTable, setupBalls, FIXED_DT } from './pool_physics';
import { evaluateTurnSwitch, evaluateGameOver, isValidBallPlacement } from './pool_rules';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;

function createMockCanvas() {
  return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } as any;
}

function createFreshWorld() {
  const canvas = createMockCanvas();
  const world = createWorld(RAPIER);
  const { pockets } = setupTable({ canvas, world, RAPIER });
  const balls = setupBalls({ canvas, world, RAPIER });
  const pocketed = { solids: [] as number[], stripes: [] as number[], eight: false };
  return { world, balls, pockets, pocketed, canvas };
}

beforeAll(async () => {
  await RAPIER.init();
  // Warmup: create and free a world so RAPIER's internal WASM allocator
  // reaches a stable state. The first world created after init() gets
  // different handle IDs, which affects RAPIER's constraint solver iteration
  // order. In production this isn't an issue because each client has its own
  // WASM instance, but in tests we share one.
  const warmup = createFreshWorld();
  warmup.world.free();
});

// --- Deterministic Physics Tests ---

describe('Deterministic Physics', () => {
  it('should produce identical results for the same shot input (sequential worlds)', () => {
    const input: ShotInput = { angle: 0.1, power: 3.0, topspin: 0.3, sidespin: 0 };

    // Run 1: create world, simulate, capture result, free world
    const { world: world1, balls: balls1, pockets: pockets1, pocketed: pocketed1 } = createFreshWorld();
    const result1 = simulateShot(world1, balls1, pockets1, pocketed1, input, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);
    const snapshot1 = JSON.parse(JSON.stringify(result1.finalSnapshot));
    const hash1 = result1.hash;
    const steps1 = result1.stepsRun;
    world1.free();

    // Run 2: create fresh world, simulate with same input
    const { world: world2, balls: balls2, pockets: pockets2, pocketed: pocketed2 } = createFreshWorld();
    const result2 = simulateShot(world2, balls2, pockets2, pocketed2, input, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);
    world2.free();

    expect(steps1).toBe(result2.stepsRun);
    expect(snapshot1.balls.length).toBe(result2.finalSnapshot.balls.length);

    for (let i = 0; i < snapshot1.balls.length; i++) {
      expect(snapshot1.balls[i].position.x)
        .toBeCloseTo(result2.finalSnapshot.balls[i].position.x, 8);
      expect(snapshot1.balls[i].position.z)
        .toBeCloseTo(result2.finalSnapshot.balls[i].position.z, 8);
    }

    expect(hash1).toBe(result2.hash);
  });

  it('should produce identical results for an angled break shot', () => {
    const input: ShotInput = { angle: 0.15, power: 4.5, topspin: 0.3, sidespin: 0 };

    const { world: world1, balls: balls1, pockets: pockets1, pocketed: pocketed1 } = createFreshWorld();
    const result1 = simulateShot(world1, balls1, pockets1, pocketed1, input, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const { world: world2, balls: balls2, pockets: pockets2, pocketed: pocketed2 } = createFreshWorld();
    const result2 = simulateShot(world2, balls2, pockets2, pocketed2, input, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    expect(result1.hash).toBe(result2.hash);
    expect(result1.stepsRun).toBe(result2.stepsRun);
    expect(result1.pocketedEvents.length).toBe(result2.pocketedEvents.length);

    world1.free();
    world2.free();
  });

  it('should produce different results for different shot inputs', () => {
    const input1: ShotInput = { angle: 0, power: 3.0, topspin: 0.3, sidespin: 0 };
    const input2: ShotInput = { angle: 0.5, power: 3.0, topspin: 0.3, sidespin: 0 };

    const { world: world1, balls: balls1, pockets: pockets1, pocketed: pocketed1 } = createFreshWorld();
    const result1 = simulateShot(world1, balls1, pockets1, pocketed1, input1, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const { world: world2, balls: balls2, pockets: pockets2, pocketed: pocketed2 } = createFreshWorld();
    const result2 = simulateShot(world2, balls2, pockets2, pocketed2, input2, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    expect(result1.hash).not.toBe(result2.hash);

    world1.free();
    world2.free();
  });

  it('should eventually settle (all balls stop)', () => {
    const input: ShotInput = { angle: 0, power: 5.0, topspin: 0.3, sidespin: 0 };

    const { world, balls, pockets, pocketed } = createFreshWorld();
    const result = simulateShot(world, balls, pockets, pocketed, input, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    // Should settle well before the 30-second safety limit
    const stepsPerSecond = Math.round(1 / FIXED_DT);
    expect(result.stepsRun).toBeLessThan(stepsPerSecond * 20);
    expect(result.stepsRun).toBeGreaterThan(10);

    world.free();
  });
});



describe('Cue ball spin effects', () => {
  it('topspin and backspin should produce different cue-ball travel distances', () => {
    const topspinInput: ShotInput = { angle: 0, power: 2.6, topspin: 0.55, sidespin: 0 };
    const backspinInput: ShotInput = { angle: 0, power: 2.6, topspin: -0.55, sidespin: 0 };

    const top = createFreshWorld();
    const topResult = simulateShot(top.world, top.balls, top.pockets, top.pocketed, topspinInput, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const back = createFreshWorld();
    const backResult = simulateShot(back.world, back.balls, back.pockets, back.pocketed, backspinInput, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const topCue = topResult.finalSnapshot.balls.find(b => b.number === 0);
    const backCue = backResult.finalSnapshot.balls.find(b => b.number === 0);

    expect(topCue).toBeTruthy();
    expect(backCue).toBeTruthy();
    expect(topCue!.position.x).toBeGreaterThan(backCue!.position.x + 1.5);

    top.world.free();
    back.world.free();
  });

  it('left and right side spin should curve cue-ball travel in opposite directions', () => {
    const rightSpinInput: ShotInput = { angle: 0, power: 2.4, topspin: 0, sidespin: 0.7 };
    const leftSpinInput: ShotInput = { angle: 0, power: 2.4, topspin: 0, sidespin: -0.7 };

    const right = createFreshWorld();
    const rightResult = simulateShot(right.world, right.balls, right.pockets, right.pocketed, rightSpinInput, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const left = createFreshWorld();
    const leftResult = simulateShot(left.world, left.balls, left.pockets, left.pocketed, leftSpinInput, CANVAS_WIDTH, CANVAS_HEIGHT, RAPIER);

    const rightCue = rightResult.finalSnapshot.balls.find(b => b.number === 0);
    const leftCue = leftResult.finalSnapshot.balls.find(b => b.number === 0);

    expect(rightCue).toBeTruthy();
    expect(leftCue).toBeTruthy();
    expect(rightCue!.position.z).toBeGreaterThan(leftCue!.position.z + 0.4);

    right.world.free();
    left.world.free();
  });
});

// --- State Serialization Tests ---

describe('State Serialization', () => {
  it('should serialize all 16 balls with correct types', () => {
    const { world, balls } = createFreshWorld();

    const serialized = serializeBalls(balls);

    expect(serialized).toHaveLength(16);
    // Sorted by number, so index 0 is ball 0 (cue)
    expect(serialized[0].number).toBe(0);
    expect(serialized[0].type).toBe('cue');

    const types = serialized.map(b => b.type);
    expect(types.filter(t => t === 'cue')).toHaveLength(1);
    expect(types.filter(t => t === 'solid')).toHaveLength(7);
    expect(types.filter(t => t === 'stripe')).toHaveLength(7);
    expect(types.filter(t => t === 'eight')).toHaveLength(1);

    for (const bs of serialized) {
      expect(typeof bs.position.x).toBe('number');
      expect(typeof bs.position.y).toBe('number');
      expect(typeof bs.position.z).toBe('number');
      expect(bs.type).toMatch(/^(cue|solid|stripe|eight)$/);
    }

    world.free();
  });

  it('should restore state from snapshot accurately', () => {
    const { world, balls } = createFreshWorld();

    const snapshot: GameStateSnapshot = {
      balls: serializeBalls(balls),
      pocketed: { solids: [], stripes: [], eight: false }
    };

    // Mutate a ball position
    balls[0].body.setTranslation({ x: 100, y: 2.4, z: 50 }, true);

    // Restore from snapshot
    const restoredBalls = restoreBallStates(world, balls, snapshot, RAPIER);

    const restoredSerialized = serializeBalls(restoredBalls);
    expect(restoredSerialized.length).toBe(snapshot.balls.length);

    for (let i = 0; i < snapshot.balls.length; i++) {
      expect(restoredSerialized[i].position.x).toBeCloseTo(snapshot.balls[i].position.x, 5);
      expect(restoredSerialized[i].position.y).toBeCloseTo(snapshot.balls[i].position.y, 5);
      expect(restoredSerialized[i].position.z).toBeCloseTo(snapshot.balls[i].position.z, 5);
      expect(restoredSerialized[i].type).toBe(snapshot.balls[i].type);
      expect(restoredSerialized[i].number).toBe(snapshot.balls[i].number);
    }

    world.free();
  });
});

// --- Hashing Tests ---

describe('State Hashing', () => {
  it('should produce the same hash for the same state', () => {
    const snapshot: GameStateSnapshot = {
      balls: [
        {
          number: 0, type: 'cue',
          position: { x: 60, y: 2.4, z: 70 },
          linvel: { x: 0, y: 0, z: 0 },
          angvel: { x: 0, y: 0, z: 0 },
          rotation: { w: 1, x: 0, y: 0, z: 0 }
        }
      ],
      pocketed: { solids: [], stripes: [], eight: false }
    };

    const hash1 = hashGameState(snapshot);
    const hash2 = hashGameState(snapshot);
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBeGreaterThan(0);
  });

  it('should produce different hashes for different positions', () => {
    const snapshot1: GameStateSnapshot = {
      balls: [{
        number: 0, type: 'cue',
        position: { x: 60, y: 2.4, z: 70 },
        linvel: { x: 0, y: 0, z: 0 },
        angvel: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 }
      }],
      pocketed: { solids: [], stripes: [], eight: false }
    };

    const snapshot2: GameStateSnapshot = {
      balls: [{
        number: 0, type: 'cue',
        position: { x: 61, y: 2.4, z: 70 },
        linvel: { x: 0, y: 0, z: 0 },
        angvel: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 }
      }],
      pocketed: { solids: [], stripes: [], eight: false }
    };

    expect(hashGameState(snapshot1)).not.toBe(hashGameState(snapshot2));
  });

  it('should produce different hashes for different pocketed states', () => {
    const base = {
      balls: [{
        number: 0, type: 'cue' as const,
        position: { x: 60, y: 2.4, z: 70 },
        linvel: { x: 0, y: 0, z: 0 },
        angvel: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 }
      }]
    };

    const snapshot1: GameStateSnapshot = {
      ...base,
      pocketed: { solids: [1], stripes: [], eight: false }
    };
    const snapshot2: GameStateSnapshot = {
      ...base,
      pocketed: { solids: [], stripes: [], eight: false }
    };

    expect(hashGameState(snapshot1)).not.toBe(hashGameState(snapshot2));
  });
});

// --- Game State Sync Tests (Turn Logic) ---

describe('Turn Logic', () => {
  it('should switch turns when no ball is pocketed', () => {
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'online',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot: { solids: [], stripes: [], cueBall: false }
    });
    expect(result.currentPlayer).toBe(2);
    expect(result.isMyTurn).toBe(false);
  });

  it('should keep turn when own ball is pocketed', () => {
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'online',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot: { solids: [3], stripes: [], cueBall: false }
    });
    expect(result.currentPlayer).toBe(1);
    expect(result.isMyTurn).toBe(true);
  });

  it('should switch turns on scratch even if own ball pocketed', () => {
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'online',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot: { solids: [3], stripes: [], cueBall: true }
    });
    expect(result.currentPlayer).toBe(2);
    expect(result.isMyTurn).toBe(false);
  });

  it('should assign types on first pocket (solid)', () => {
    const playerTypes = { player1: null as string | null, player2: null as string | null };
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'online',
      isMyTurn: true,
      playerTypes,
      pocketedThisShot: { solids: [2], stripes: [], cueBall: false }
    });
    expect(result.playerTypes.player1).toBe('solid');
    expect(result.playerTypes.player2).toBe('stripe');
    expect(result.currentPlayer).toBe(1); // keeps turn
  });

  it('should assign types on first pocket (stripe)', () => {
    const playerTypes = { player1: null as string | null, player2: null as string | null };
    const result = evaluateTurnSwitch({
      currentPlayer: 2,
      mode: 'online',
      isMyTurn: false,
      playerTypes,
      pocketedThisShot: { solids: [], stripes: [9], cueBall: false }
    });
    expect(result.playerTypes.player2).toBe('stripe');
    expect(result.playerTypes.player1).toBe('solid');
    expect(result.currentPlayer).toBe(2); // keeps turn
  });

  it('should switch turns when pocketing opponent ball type', () => {
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'online',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot: { solids: [], stripes: [10], cueBall: false }
    });
    expect(result.currentPlayer).toBe(2);
    expect(result.isMyTurn).toBe(false);
  });
});

// --- Game Over Tests ---

describe('Game Over', () => {
  it('should return null when 8-ball is not pocketed', () => {
    const result = evaluateGameOver({
      currentPlayer: 1,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketed: { solids: [1, 2, 3], stripes: [], eight: false }
    });
    expect(result).toBeNull();
  });

  it('should declare current player winner when all own balls cleared before 8-ball', () => {
    const result = evaluateGameOver({
      currentPlayer: 1,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketed: { solids: [1, 2, 3, 4, 5, 6, 7], stripes: [], eight: true }
    });
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(1);
    expect(result!.reason).toBe('Pocketed 8-ball after clearing all own balls');
  });

  it('should declare opponent winner when 8-ball pocketed early (solids not cleared)', () => {
    const result = evaluateGameOver({
      currentPlayer: 1,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketed: { solids: [1, 2, 3], stripes: [], eight: true }
    });
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(2);
    expect(result!.reason).toBe('Pocketed 8-ball early');
  });

  it('should declare opponent winner when 8-ball pocketed early (stripes not cleared)', () => {
    const result = evaluateGameOver({
      currentPlayer: 2,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketed: { solids: [], stripes: [9, 10, 11], eight: true }
    });
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(1);
    expect(result!.reason).toBe('Pocketed 8-ball early');
  });

  it('should declare player 2 winner when player 2 clears all stripes then pockets 8-ball', () => {
    const result = evaluateGameOver({
      currentPlayer: 2,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketed: { solids: [1, 2], stripes: [9, 10, 11, 12, 13, 14, 15], eight: true }
    });
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(2);
    expect(result!.reason).toBe('Pocketed 8-ball after clearing all own balls');
  });

  it('should declare opponent winner when types not assigned and 8-ball pocketed', () => {
    const result = evaluateGameOver({
      currentPlayer: 1,
      playerTypes: { player1: null, player2: null },
      pocketed: { solids: [], stripes: [], eight: true }
    });
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(2);
    expect(result!.reason).toBe('Pocketed 8-ball early');
  });
});

// --- Message Protocol Tests ---

describe('Message Protocol', () => {
  it('should roundtrip shot message through JSON', () => {
    const msg: GameMessage = {
      type: 'shot',
      input: { angle: 1.234, power: 3.5, topspin: 0.3, sidespin: 0 }
    };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('shot');
    if (roundtripped.type === 'shot') {
      expect(roundtripped.input.angle).toBeCloseTo(1.234);
      expect(roundtripped.input.power).toBeCloseTo(3.5);
      expect(roundtripped.input.topspin).toBeCloseTo(0.3);
      expect(roundtripped.input.sidespin).toBeCloseTo(0);
    }
  });

  it('should roundtrip state_hash message through JSON', () => {
    const msg: GameMessage = { type: 'state_hash', hash: 'abc123' };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('state_hash');
    if (roundtripped.type === 'state_hash') {
      expect(roundtripped.hash).toBe('abc123');
    }
  });

  it('should roundtrip state_sync message through JSON', () => {
    const snapshot: GameStateSnapshot = {
      balls: [{
        number: 0, type: 'cue',
        position: { x: 60, y: 2.4, z: 70 },
        linvel: { x: 0, y: 0, z: 0 },
        angvel: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 }
      }],
      pocketed: { solids: [1, 2], stripes: [9], eight: false }
    };
    const msg: GameMessage = { type: 'state_sync', snapshot };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('state_sync');
    if (roundtripped.type === 'state_sync') {
      expect(roundtripped.snapshot.balls[0].position.x).toBe(60);
      expect(roundtripped.snapshot.pocketed.solids).toEqual([1, 2]);
      expect(roundtripped.snapshot.pocketed.stripes).toEqual([9]);
    }
  });

  it('should roundtrip turn message through JSON', () => {
    const msg: GameMessage = {
      type: 'turn',
      state: {
        currentPlayer: 2,
        playerTypes: { player1: 'solid', player2: 'stripe' },
        pocketed: { solids: [1, 3], stripes: [], eight: false }
      }
    };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('turn');
    if (roundtripped.type === 'turn') {
      expect(roundtripped.state.currentPlayer).toBe(2);
      expect(roundtripped.state.playerTypes.player1).toBe('solid');
      expect(roundtripped.state.pocketed.solids).toEqual([1, 3]);
    }
  });

  it('should roundtrip game_over message through JSON', () => {
    const msg: GameMessage = {
      type: 'game_over',
      winner: 1,
      reason: 'Pocketed 8-ball after clearing all own balls'
    };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('game_over');
    if (roundtripped.type === 'game_over') {
      expect(roundtripped.winner).toBe(1);
      expect(roundtripped.reason).toBe('Pocketed 8-ball after clearing all own balls');
    }
  });

  it('should roundtrip ball_in_hand_place message through JSON', () => {
    const msg: GameMessage = {
      type: 'ball_in_hand_place',
      position: { x: 60.5, z: 70.2 }
    };
    const roundtripped = JSON.parse(JSON.stringify(msg)) as GameMessage;
    expect(roundtripped.type).toBe('ball_in_hand_place');
    if (roundtripped.type === 'ball_in_hand_place') {
      expect(roundtripped.position.x).toBeCloseTo(60.5);
      expect(roundtripped.position.z).toBeCloseTo(70.2);
    }
  });
});

// --- Ball in Hand Placement Validation Tests ---

describe('Ball in Hand Placement', () => {
  // Table bounds in physics units (derived from 1200x700 canvas, cushionInset=40, ballRadius=12, SCALE=5)
  const tableBounds = {
    tableLeft: (40 + 12) / 5,    // 10.4
    tableRight: (1200 - 40 - 12) / 5,  // 229.6
    tableTop: (40 + 12) / 5,     // 10.4
    tableBottom: (700 - 40 - 12) / 5,   // 129.6
    ballRadius: 12 / 5            // 2.4
  };

  it('should accept valid placement with no nearby balls', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 70,
      ballPositions: [],
      ...tableBounds
    });
    expect(result).toBe(true);
  });

  it('should accept placement far from other balls', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 70,
      ballPositions: [
        { x: 180, z: 70 },  // far away
        { x: 100, z: 100 }  // also far away
      ],
      ...tableBounds
    });
    expect(result).toBe(true);
  });

  it('should reject placement outside table bounds (left)', () => {
    const result = isValidBallPlacement({
      physX: 5,  // too far left (< 10.4)
      physZ: 70,
      ballPositions: [],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should reject placement outside table bounds (right)', () => {
    const result = isValidBallPlacement({
      physX: 235,  // too far right (> 229.6)
      physZ: 70,
      ballPositions: [],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should reject placement outside table bounds (top)', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 5,  // too far up (< 10.4)
      ballPositions: [],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should reject placement outside table bounds (bottom)', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 135,  // too far down (> 129.6)
      ballPositions: [],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should reject placement overlapping another ball', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 70,
      ballPositions: [
        { x: 62, z: 70 }  // only 2 units away, less than 2 * 2.4 * 1.05 = 5.04
      ],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should accept placement just outside overlap range', () => {
    // ballRadius * 2.1 = 2.4 * 2.1 = 5.04
    // Place ball at distance 6 from another ball (> 5.04)
    const result = isValidBallPlacement({
      physX: 66,
      physZ: 70,
      ballPositions: [
        { x: 60, z: 70 }  // 6 units away, greater than 5.04
      ],
      ...tableBounds
    });
    expect(result).toBe(true);
  });

  it('should reject when overlapping any one of multiple balls', () => {
    const result = isValidBallPlacement({
      physX: 60,
      physZ: 70,
      ballPositions: [
        { x: 100, z: 70 },  // far away - OK
        { x: 61, z: 70 }    // too close - overlap
      ],
      ...tableBounds
    });
    expect(result).toBe(false);
  });

  it('should work with physics world ball positions', () => {
    const { world, balls } = createFreshWorld();

    // Extract non-cue ball positions from the physics world
    const ballPositions = balls
      .filter(b => b.type !== 'cue')
      .map(b => {
        const pos = b.body.translation();
        return { x: pos.x, z: pos.z };
      });

    // Place at cue ball's default position (should be far from rack)
    const cueBall = balls.find(b => b.type === 'cue')!;
    const cuePos = cueBall.body.translation();
    const result = isValidBallPlacement({
      physX: cuePos.x,
      physZ: cuePos.z,
      ballPositions,
      ...tableBounds
    });
    expect(result).toBe(true);

    // Place directly on top of a racked ball (should fail)
    const firstBall = balls.find(b => b.type !== 'cue')!;
    const firstPos = firstBall.body.translation();
    const resultOverlap = isValidBallPlacement({
      physX: firstPos.x,
      physZ: firstPos.z,
      ballPositions,
      ...tableBounds
    });
    expect(resultOverlap).toBe(false);

    world.free();
  });
});

// --- Ball in Hand Turn Integration Tests ---

describe('Ball in Hand Turn Logic', () => {
  it('should indicate scratch occurred when cue ball is pocketed', () => {
    const pocketedThisShot = { solids: [], stripes: [], cueBall: true };
    const result = evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'local',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot
    });
    // Turn should switch and cueBall flag should remain true
    expect(result.currentPlayer).toBe(2);
    expect(pocketedThisShot.cueBall).toBe(true);
  });

  it('should indicate no scratch when cue ball is not pocketed', () => {
    const pocketedThisShot = { solids: [3], stripes: [], cueBall: false };
    evaluateTurnSwitch({
      currentPlayer: 1,
      mode: 'local',
      isMyTurn: true,
      playerTypes: { player1: 'solid', player2: 'stripe' },
      pocketedThisShot
    });
    expect(pocketedThisShot.cueBall).toBe(false);
  });
});
