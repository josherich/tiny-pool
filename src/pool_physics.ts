import type RAPIER from '@dimforge/rapier3d-compat';

export type Ball = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  type: string;
  number: number;
};

export type Pocket = { x: number; y: number; radius: number };
export type Pocketed = { solids: number[]; stripes: number[]; eight: boolean };
export type PocketedThisShot = { solids: number[]; stripes: number[]; cueBall: boolean };
export type PocketedEvent = {
  type: string;
  number: number;
  startX: number;
  startY: number;
  pocketX: number;
  pocketY: number;
  rotation: { w: number; x: number; y: number; z: number };
};

// Default physics properties for realistic pool ball behavior
export const PHYSICS_DEFAULTS = {
  BALL_MASS: 0.17,            // kg (standard pool ball is ~170g)
  BALL_RESTITUTION: 0.97,     // Nearly elastic ball-to-ball collisions
  BALL_FRICTION: 0.1,         // Ball-to-ball and ball-to-rail contact friction
  CUSHION_RESTITUTION: 0.75,  // Cushion bounce factor
  CUSHION_FRICTION: 0.15,     // Cushion surface friction
  ROLLING_FRICTION: 0.015,    // Felt resistance (simulated)
  LINEAR_DAMPING: 0.4,        // Cloth drag on linear motion
  ANGULAR_DAMPING: 0.8,       // Spin decay over time
  MAX_SHOT_POWER: 9,          // Maximum shot power (affects impulse strength)
} as const;

// Cue ball spin physics constants
export const SPIN_DEFAULTS = {
  CLOTH_FRICTION: 0.15,       // Friction per physics step converting spin to velocity
  ROLLING_THRESHOLD: 5.0,     // Spin-vs-velocity gap to consider "sliding"
  SPIN_FACTOR: 50,            // How much tip offset creates spin
  FOLLOW_BOOST: 0.02,         // Topspin follow-through strength after collision
  DRAW_MAGNITUDE: 0.02,       // Backspin draw-back strength after collision
  SIDESPIN_SWERVE: 0.001,     // How much sidespin curves the ball path
  SIDESPIN_DECAY: 0.98,       // Sidespin decay per step (2% loss)
  DRAW_SPIN_RETENTION: 0.3,   // Spin retained after draw collision
} as const;

export type CueBallSpin = {
  x: number;       // sidespin: left (-) / right (+)
  y: number;       // topspin (+) / backspin (-)
  isSliding: boolean;
};

export const physicsConfig = { ...PHYSICS_DEFAULTS };

export const BALL_MASS = PHYSICS_DEFAULTS.BALL_MASS;
export const BALL_RESTITUTION = PHYSICS_DEFAULTS.BALL_RESTITUTION;
export const BALL_FRICTION = PHYSICS_DEFAULTS.BALL_FRICTION;
export const CUSHION_RESTITUTION = PHYSICS_DEFAULTS.CUSHION_RESTITUTION;
export const CUSHION_FRICTION = PHYSICS_DEFAULTS.CUSHION_FRICTION;
export const ROLLING_FRICTION = PHYSICS_DEFAULTS.ROLLING_FRICTION;
export const LINEAR_DAMPING = PHYSICS_DEFAULTS.LINEAR_DAMPING;
export const ANGULAR_DAMPING = PHYSICS_DEFAULTS.ANGULAR_DAMPING;
export const MAX_SHOT_POWER = PHYSICS_DEFAULTS.MAX_SHOT_POWER;

// Canvas to physics scale (pixels per physics unit)
export const SCALE = 5;

// Table geometry shared by physics and rendering (all values in pixels).
// The cushion band spans from CUSHION_INSET (rail line) to
// CUSHION_INSET + CUSHION_WIDTH (the cushion nose, i.e. the play-area edge).
export const TABLE = {
  CUSHION_INSET: 40,
  CUSHION_WIDTH: 20,
  BALL_RADIUS: 12,
  CORNER_POCKET_RADIUS: 30,
  SIDE_POCKET_RADIUS: 22,
  SIDE_POCKET_OFFSET: 5, // side pocket center sits this far behind the rail line
} as const;

export type Point2 = { x: number; y: number };

export type CushionShape = {
  // 4 corners in pixel coords, ordered: outerStart, outerEnd, noseEnd, noseStart.
  // outerStart->outerEnd runs along the rail line; the nose edge faces the
  // play area and the two connecting edges are the angled pocket jaws.
  points: Point2[];
  // Unit vector pointing from the cushion into the play area
  inward: Point2;
};

export type TableGeometry = {
  pockets: Pocket[];
  cushions: CushionShape[];
  // Dark throat regions (gaps in the cushion band leading into each pocket),
  // in the same order as `pockets`
  pocketThroats: Point2[][];
};

/**
 * Single source of truth for the table layout. Both the physics colliders
 * and the renderer derive their shapes from this so that what the player
 * sees is exactly what the simulation collides with.
 */
export const getTableGeometry = (w: number, h: number): TableGeometry => {
  const inset = TABLE.CUSHION_INSET;
  const nose = inset + TABLE.CUSHION_WIDTH;
  const cornerR = TABLE.CORNER_POCKET_RADIUS;
  const sideR = TABLE.SIDE_POCKET_RADIUS;
  const sideOff = TABLE.SIDE_POCKET_OFFSET;

  const pockets: Pocket[] = [
    { x: inset, y: inset, radius: cornerR },               // Top-left
    { x: w / 2, y: inset - sideOff, radius: sideR },       // Top-middle
    { x: w - inset, y: inset, radius: cornerR },           // Top-right
    { x: inset, y: h - inset, radius: cornerR },           // Bottom-left
    { x: w / 2, y: h - inset + sideOff, radius: sideR },   // Bottom-middle
    { x: w - inset, y: h - inset, radius: cornerR }        // Bottom-right
  ];

  // Cushions end at the rail line where the corner pocket hole begins,
  // with a 45° jaw running back to the nose line.
  const cornerMouth = inset + cornerR;
  const cornerJaw = cornerMouth + TABLE.CUSHION_WIDTH;
  // Half-width of the side pocket mouth where its hole crosses the rail line,
  // also with a 45° jaw.
  const sideMouth = Math.sqrt(sideR * sideR - sideOff * sideOff);
  const sideJaw = sideMouth + TABLE.CUSHION_WIDTH;

  const cushions: CushionShape[] = [
    { // Top-left segment
      points: [
        { x: cornerMouth, y: inset },
        { x: w / 2 - sideMouth, y: inset },
        { x: w / 2 - sideJaw, y: nose },
        { x: cornerJaw, y: nose }
      ],
      inward: { x: 0, y: 1 }
    },
    { // Top-right segment
      points: [
        { x: w / 2 + sideMouth, y: inset },
        { x: w - cornerMouth, y: inset },
        { x: w - cornerJaw, y: nose },
        { x: w / 2 + sideJaw, y: nose }
      ],
      inward: { x: 0, y: 1 }
    },
    { // Bottom-left segment
      points: [
        { x: cornerMouth, y: h - inset },
        { x: w / 2 - sideMouth, y: h - inset },
        { x: w / 2 - sideJaw, y: h - nose },
        { x: cornerJaw, y: h - nose }
      ],
      inward: { x: 0, y: -1 }
    },
    { // Bottom-right segment
      points: [
        { x: w / 2 + sideMouth, y: h - inset },
        { x: w - cornerMouth, y: h - inset },
        { x: w - cornerJaw, y: h - nose },
        { x: w / 2 + sideJaw, y: h - nose }
      ],
      inward: { x: 0, y: -1 }
    },
    { // Left cushion
      points: [
        { x: inset, y: cornerMouth },
        { x: inset, y: h - cornerMouth },
        { x: nose, y: h - cornerJaw },
        { x: nose, y: cornerJaw }
      ],
      inward: { x: 1, y: 0 }
    },
    { // Right cushion
      points: [
        { x: w - inset, y: cornerMouth },
        { x: w - inset, y: h - cornerMouth },
        { x: w - nose, y: h - cornerJaw },
        { x: w - nose, y: cornerJaw }
      ],
      inward: { x: -1, y: 0 }
    }
  ];

  // Throat region of a corner pocket: the part of the cushion band between
  // the two adjacent jaws. (px, py) is the pocket center at the rail corner,
  // (sx, sy) mirror the shape toward the table interior.
  const cornerThroat = (px: number, py: number, sx: number, sy: number): Point2[] => [
    { x: px, y: py },
    { x: px + sx * cornerR, y: py },
    { x: px + sx * (cornerR + TABLE.CUSHION_WIDTH), y: py + sy * TABLE.CUSHION_WIDTH },
    { x: px + sx * TABLE.CUSHION_WIDTH, y: py + sy * TABLE.CUSHION_WIDTH },
    { x: px + sx * TABLE.CUSHION_WIDTH, y: py + sy * (cornerR + TABLE.CUSHION_WIDTH) },
    { x: px, y: py + sy * cornerR }
  ];

  const sideThroat = (cx: number, railY: number, noseY: number): Point2[] => [
    { x: cx - sideMouth, y: railY },
    { x: cx + sideMouth, y: railY },
    { x: cx + sideJaw, y: noseY },
    { x: cx - sideJaw, y: noseY }
  ];

  const pocketThroats: Point2[][] = [
    cornerThroat(inset, inset, 1, 1),
    sideThroat(w / 2, inset, nose),
    cornerThroat(w - inset, inset, -1, 1),
    cornerThroat(inset, h - inset, 1, -1),
    sideThroat(w / 2, h - inset, h - nose),
    cornerThroat(w - inset, h - inset, -1, -1)
  ];

  return { pockets, cushions, pocketThroats };
};

/**
 * Legal cue-ball placement bounds (physics units): the ball must sit fully
 * inside the play area, i.e. its edge cannot overlap the cushion nose.
 */
export const getPlacementBounds = (w: number, h: number) => {
  const nose = (TABLE.CUSHION_INSET + TABLE.CUSHION_WIDTH) / SCALE;
  const ballRadius = TABLE.BALL_RADIUS / SCALE;
  return {
    tableLeft: nose + ballRadius,
    tableRight: w / SCALE - nose - ballRadius,
    tableTop: nose + ballRadius,
    tableBottom: h / SCALE - nose - ballRadius,
    ballRadius
  };
};

// Fixed timestep for deterministic physics (240 Hz)
// Higher rate improves ball-ball collision accuracy: at lower rates the cue ball
// overshoots the theoretical first-contact point during discrete integration,
// shifting the collision normal and making cut shots thinner than predicted.
export const FIXED_DT = 1 / 240;

export const createWorld = (rapier: typeof RAPIER) =>
  new rapier.World({ x: 0.0, y: 0.0, z: 0.0 });

export const setupTable = ({
  canvas,
  world,
  RAPIER: rapier
}: {
  canvas: HTMLCanvasElement;
  world: RAPIER.World;
  RAPIER: typeof RAPIER;
}) => {
  const w = canvas.width;
  const h = canvas.height;
  const geometry = getTableGeometry(w, h);

  // Create cushion walls using Rapier 3D
  // In our 3D setup: X = left-right, Y = up (height), Z = top-bottom (depth into screen)
  // We simulate a top-down view, so balls roll on the X-Z plane at Y=BALL_RADIUS.
  //
  // Each cushion is a convex prism extruded from the exact polygon the
  // renderer draws (rail edge, nose edge and the two angled pocket jaws),
  // so collisions happen precisely at the visible cushion surface.
  const physBallRadius = TABLE.BALL_RADIUS / SCALE;
  const cushionHeight = physBallRadius * 2.5; // Cushions are taller than balls

  const cushionBodies: RAPIER.RigidBody[] = [];

  for (const cushion of geometry.cushions) {
    const points: number[] = [];
    for (const p of cushion.points) {
      points.push(p.x / SCALE, 0, p.y / SCALE);
      points.push(p.x / SCALE, cushionHeight, p.y / SCALE);
    }

    const colliderDesc = rapier.ColliderDesc.convexHull(new Float32Array(points));
    if (!colliderDesc) continue;

    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    colliderDesc
      .setRestitution(physicsConfig.CUSHION_RESTITUTION)
      .setFriction(physicsConfig.CUSHION_FRICTION)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(colliderDesc, body);
    cushionBodies.push(body);
  }

  return { pockets: geometry.pockets, cushionBodies };
};

export const setupBalls = ({
  canvas,
  world,
  RAPIER: rapier
}: {
  canvas: HTMLCanvasElement;
  world: RAPIER.World;
  RAPIER: typeof RAPIER;
}): Ball[] => {
  const balls: Ball[] = [];
  const pixelRadius = 12;
  const physRadius = pixelRadius / SCALE;
  const h = canvas.height;

  // Cue ball position in pixels, then convert to physics
  const cuePixelX = 300;
  const cuePixelY = h / 2;
  const cuePhysX = cuePixelX / SCALE;
  const cuePhysZ = cuePixelY / SCALE;

  // Create a ball helper function
  const createBall = (physX: number, physZ: number, type: string, number: number) => {
    // Ball center at Y = physRadius (sitting on table surface at Y=0)
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(physX, physRadius, physZ)
      .setLinearDamping(physicsConfig.LINEAR_DAMPING)
      .setAngularDamping(physicsConfig.ANGULAR_DAMPING)
      .setCcdEnabled(true); // Enable CCD for fast-moving balls

    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = rapier.ColliderDesc.ball(physRadius)
      .setRestitution(physicsConfig.BALL_RESTITUTION)
      .setFriction(physicsConfig.BALL_FRICTION)
      .setMass(physicsConfig.BALL_MASS)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

    const collider = world.createCollider(colliderDesc, body);

    balls.push({ body, collider, type, number });
  };

  // Create cue ball
  createBall(cuePhysX, cuePhysZ, 'cue', 0);

  // Rack position (foot spot is typically 3/4 down the table length)
  const rackPixelX = 900;
  const rackPixelY = h / 2;
  const rackPhysX = rackPixelX / SCALE;
  const rackPhysZ = rackPixelY / SCALE;

  // Rack the balls in triangle formation
  // Standard 8-ball rack: 8-ball in center, one solid and one stripe in back corners
  const ballOrder = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let ballIndex = 0;
  const spacing = physRadius * 2.05; // Slightly more than diameter for tight rack

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      // Triangle points toward cue ball (negative X direction)
      const x = rackPhysX + row * spacing * 0.866; // cos(30deg) approx 0.866
      const z = rackPhysZ + (col - row / 2) * spacing;

      const ballNum = ballOrder[ballIndex];
      const type = ballNum === 8 ? 'eight' :
                   ballNum < 8 ? 'solid' : 'stripe';

      createBall(x, z, type, ballNum);
      ballIndex++;
    }
  }

  return balls;
};

export const checkPockets = ({
  world,
  canvas,
  balls,
  pockets,
  pocketed,
  pocketedThisShot,
  RAPIER: rapier
}: {
  world: RAPIER.World;
  canvas: HTMLCanvasElement;
  balls: Ball[];
  pockets: Pocket[];
  pocketed: Pocketed;
  pocketedThisShot: PocketedThisShot;
  RAPIER: typeof RAPIER;
}): PocketedEvent[] => {
  const pixelRadius = 12;
  const h = canvas.height;
  const pocketedEvents: PocketedEvent[] = [];

  // Check if ball has fallen into a pocket
  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i];
    const pos = ball.body.translation();

    // Convert physics position to pixel position
    const pixelX = pos.x * SCALE;
    const pixelZ = pos.z * SCALE;

    // Check proximity to pockets
    let isInPocket = false;
    let pocketHit: Pocket | null = null;
    for (const pocket of pockets) {
      const dx = pixelX - pocket.x;
      const dz = pixelZ - pocket.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Ball is pocketed if its center is within pocket radius
      if (dist < pocket.radius) {
        isInPocket = true;
        pocketHit = pocket;
        break;
      }
    }

    // Fallback: If ball is outside table bounds, consider it pocketed
    // This catches fast-moving balls that might skip past pocket detection
    const w = canvas.width;
    const cushionInset = TABLE.CUSHION_INSET;
    if (pixelX < cushionInset - pixelRadius || pixelX > w - cushionInset + pixelRadius ||
        pixelZ < cushionInset - pixelRadius || pixelZ > h - cushionInset + pixelRadius) {
      isInPocket = true;
    }

    if (isInPocket) {
      if (!pocketHit) {
        pocketHit = pockets.reduce((closest, pocket) => {
          const dx = pixelX - pocket.x;
          const dz = pixelZ - pocket.y;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (!closest || dist < closest.dist) {
            return { pocket, dist };
          }
          return closest;
        }, null as { pocket: Pocket; dist: number } | null)?.pocket || pockets[0];
      }

      if (ball.type !== 'cue') {
        const rot = ball.body.rotation();
        pocketedEvents.push({
          type: ball.type,
          number: ball.number,
          startX: pixelX,
          startY: pixelZ,
          pocketX: pocketHit.x,
          pocketY: pocketHit.y,
          rotation: { w: rot.w, x: rot.x, y: rot.y, z: rot.z }
        });
      }

      // Remove ball from physics world
      world.removeRigidBody(ball.body);

      if (ball.type === 'cue') {
        // Scratch - replace cue ball
        const resetPixelX = 300;
        const resetPixelZ = h / 2;
        const resetPhysX = resetPixelX / SCALE;
        const resetPhysZ = resetPixelZ / SCALE;
        const physRadius = pixelRadius / SCALE;

        // Create new cue ball
        const bodyDesc = rapier.RigidBodyDesc.dynamic()
          .setTranslation(resetPhysX, physRadius, resetPhysZ)
          .setLinearDamping(physicsConfig.LINEAR_DAMPING)
          .setAngularDamping(physicsConfig.ANGULAR_DAMPING)
          .setCcdEnabled(true);

        const newBody = world.createRigidBody(bodyDesc);

        const colliderDesc = rapier.ColliderDesc.ball(physRadius)
          .setRestitution(physicsConfig.BALL_RESTITUTION)
          .setFriction(physicsConfig.BALL_FRICTION)
          .setMass(physicsConfig.BALL_MASS)
          .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

        const newCollider = world.createCollider(colliderDesc, newBody);

        // Update the ball reference
        balls[i] = { body: newBody, collider: newCollider, type: 'cue', number: 0 };

        // Track that cue ball was scratched this shot
        pocketedThisShot.cueBall = true;
      } else if (ball.type === 'eight') {
        pocketed.eight = true;
        balls.splice(i, 1);
      } else {
        if (ball.type === 'solid') {
          pocketed.solids.push(ball.number);
          pocketedThisShot.solids.push(ball.number);
        } else {
          pocketed.stripes.push(ball.number);
          pocketedThisShot.stripes.push(ball.number);
        }
        balls.splice(i, 1);
      }
    }
  }

  return pocketedEvents;
};

export const syncPhysicsConfig = (balls: Ball[], cushionBodies: RAPIER.RigidBody[]) => {
  for (const ball of balls) {
    ball.body.setLinearDamping(physicsConfig.LINEAR_DAMPING);
    ball.body.setAngularDamping(physicsConfig.ANGULAR_DAMPING);
    ball.collider.setRestitution(physicsConfig.BALL_RESTITUTION);
    ball.collider.setFriction(physicsConfig.BALL_FRICTION);
    ball.collider.setMass(physicsConfig.BALL_MASS);
  }
  for (const body of cushionBodies) {
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      c.setRestitution(physicsConfig.CUSHION_RESTITUTION);
      c.setFriction(physicsConfig.CUSHION_FRICTION);
    }
  }
};

export const clonePocketed = (p: Pocketed): Pocketed =>
  ({ solids: [...p.solids], stripes: [...p.stripes], eight: p.eight });

/**
 * Compute the number of sub-steps needed so no ball travels more than a
 * fraction of its diameter in a single step.  This keeps collision normals
 * accurate even for hard shots.
 */
export const computeSubSteps = (balls: Ball[], dt: number): number => {
  const pixelRadius = 12;
  const physRadius = pixelRadius / SCALE;
  const maxDistPerStep = physRadius * 0.5; // at most 25% of diameter per sub-step

  let maxSpeed = 0;
  for (const ball of balls) {
    const v = ball.body.linvel();
    const speed = Math.sqrt(v.x * v.x + v.z * v.z);
    if (speed > maxSpeed) maxSpeed = speed;
  }

  if (maxSpeed <= 0) return 1;
  const needed = Math.ceil(maxSpeed * dt / maxDistPerStep);
  return Math.min(needed, 16); // cap to avoid runaway subdivision
};

export const applyRollingFriction = (balls: Ball[], _dt: number) => {
  const frictionCoeff = physicsConfig.ROLLING_FRICTION;
  const pixelRadius = 12;
  const physRadius = pixelRadius / SCALE;

  for (const ball of balls) {
    const linvel = ball.body.linvel();
    const speed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);

    if (speed > 0.05) {
      // Apply friction force opposite to velocity
      const frictionForce = frictionCoeff * physicsConfig.BALL_MASS * 9.81; // F = mu * m * g
      const deceleration = frictionForce / physicsConfig.BALL_MASS;
      const dt = FIXED_DT;

      // Reduce velocity slightly each step
      const newSpeed = Math.max(0, speed - deceleration * dt);
      const factor = speed > 0 ? newSpeed / speed : 0;

      ball.body.setLinvel({
        x: linvel.x * factor,
        y: linvel.y,
        z: linvel.z * factor
      }, true);

      // Sync angular velocity to match linear velocity for visual rolling
      // For a rolling ball: omega = v / r
      const targetAngVelX = -linvel.z / physRadius;
      const targetAngVelZ = linvel.x / physRadius;
      const currentAngVel = ball.body.angvel();
      const blend = 0.1;
      ball.body.setAngvel({
        x: currentAngVel.x * (1 - blend) + targetAngVelX * blend,
        y: currentAngVel.y * 0.95,
        z: currentAngVel.z * (1 - blend) + targetAngVelZ * blend
      }, true);
    } else {
      // Stop very slow balls completely
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Keep balls on the table (Y should be at ball radius)
    const pos = ball.body.translation();
    if (Math.abs(pos.y - physRadius) > 0.01) {
      ball.body.setTranslation({ x: pos.x, y: physRadius, z: pos.z }, true);
      const linv = ball.body.linvel();
      ball.body.setLinvel({ x: linv.x, y: 0, z: linv.z }, true);
    }
  }
};

/**
 * Initialize cue ball spin from a shot's tip offset.
 */
export const initCueBallSpin = (
  topspin: number,
  sidespin: number,
  power: number
): CueBallSpin => ({
  y: topspin * power * SPIN_DEFAULTS.SPIN_FACTOR,
  x: sidespin * power * SPIN_DEFAULTS.SPIN_FACTOR,
  isSliding: true,
});

/**
 * Create a zeroed-out spin state.
 */
export const zeroCueBallSpin = (): CueBallSpin => ({
  x: 0, y: 0, isSliding: false,
});

/**
 * The core spin-friction update loop. Each physics step, cloth friction
 * drags spin and velocity toward each other until they match (pure rolling).
 */
export const updateCueBallSpin = (spin: CueBallSpin, cueBall: Ball): void => {
  const linvel = cueBall.body.linvel();
  const speed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
  const pixelRadius = 12;
  const radius = pixelRadius / SCALE;

  // Ball has stopped — kill spin
  if (speed < 0.01) {
    spin.x = 0;
    spin.y = 0;
    spin.isSliding = false;
    return;
  }

  // What spin SHOULD be for pure rolling
  const expectedSpin = speed / radius;
  const spinDiff = spin.y - expectedSpin;

  // Travel direction unit vector
  const dirX = linvel.x / speed;
  const dirZ = linvel.z / speed;

  if (Math.abs(spinDiff) > SPIN_DEFAULTS.ROLLING_THRESHOLD) {
    // --- SLIDING PHASE ---
    // Friction nudges linear velocity toward what spin demands
    const frictionForce = SPIN_DEFAULTS.CLOTH_FRICTION * Math.sign(spinDiff);

    cueBall.body.setLinvel({
      x: linvel.x + frictionForce * dirX,
      y: linvel.y,
      z: linvel.z + frictionForce * dirZ,
    }, true);

    // Spin bleeds toward rolling state
    spin.y -= frictionForce * (radius * 3);
    spin.isSliding = true;
  } else {
    // --- ROLLING PHASE ---
    // Spin locked to velocity — no more sliding friction
    spin.y = expectedSpin;
    spin.isSliding = false;
  }

  // Sidespin causes subtle swerve (curved path)
  if (Math.abs(spin.x) > 0.1) {
    // Perpendicular direction (rotate 90 degrees)
    const perpX = -dirZ;
    const perpZ = dirX;

    const currentLinvel = cueBall.body.linvel();
    cueBall.body.setLinvel({
      x: currentLinvel.x + spin.x * SPIN_DEFAULTS.SIDESPIN_SWERVE * perpX,
      y: currentLinvel.y,
      z: currentLinvel.z + spin.x * SPIN_DEFAULTS.SIDESPIN_SWERVE * perpZ,
    }, true);

    // Decay sidespin
    spin.x *= SPIN_DEFAULTS.SIDESPIN_DECAY;
  }
};

/**
 * Apply spin-dependent impulse after the cue ball hits an object ball.
 * Topspin → follow (cue chases object ball).
 * Backspin → draw (cue brakes or reverses).
 */
export const applyCueBallCollisionSpin = (spin: CueBallSpin, cueBall: Ball): void => {
  const linvel = cueBall.body.linvel();
  const speed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
  if (speed < 0.01) return;

  const dirX = linvel.x / speed;
  const dirZ = linvel.z / speed;

  if (spin.y > 0) {
    // TOPSPIN (follow): cue ball chases the object ball
    const boost = spin.y * SPIN_DEFAULTS.FOLLOW_BOOST;
    cueBall.body.applyImpulse({
      x: dirX * boost,
      y: 0,
      z: dirZ * boost,
    }, true);
  } else if (spin.y < 0) {
    // BACKSPIN (draw): cue ball brakes or reverses
    const drawForce = Math.abs(spin.y) * SPIN_DEFAULTS.DRAW_MAGNITUDE;
    cueBall.body.applyImpulse({
      x: -dirX * drawForce,
      y: 0,
      z: -dirZ * drawForce,
    }, true);
    // Spin spent on impact
    spin.y *= SPIN_DEFAULTS.DRAW_SPIN_RETENTION;
  }
  // Center-ball hit (spin.y ≈ 0): no impulse, RAPIER's default is correct
};
