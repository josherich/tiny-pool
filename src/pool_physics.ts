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
  BALL_RESTITUTION: 0.92,     // Bounciness of ball-to-ball collisions
  BALL_FRICTION: 0.001,           // No ball-to-ball friction so physics matches guide line prediction
  CUSHION_RESTITUTION: 0.75,  // Cushion bounce factor
  CUSHION_FRICTION: 0.15,     // Cushion surface friction
  ROLLING_FRICTION: 0.015,     // Felt resistance (simulated)
  LINEAR_DAMPING: 0.8,        // Simulates rolling resistance on felt
  ANGULAR_DAMPING: 0.9,       // Simulates rotational friction on felt
  MAX_SHOT_POWER: 9,          // Maximum shot power (affects impulse strength)
  TABLE_FRICTION: 12.0,       // Ball-cloth sliding friction (low enough to preserve spin pre-collision, high enough to manifest spin effects post-collision)
  SPIN_SCALE: 3.5,            // Scales cue-spin torque so top/back/side spin produce visible effects
  SIDESPIN_DECAY: 0.4,        // Per-second decay rate for vertical-axis spin (english)
  CUSHION_GRIP: 0.2,          // Fraction of sidespin transferred to linear velocity at cushion bounce
} as const;

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
export const TABLE_FRICTION = PHYSICS_DEFAULTS.TABLE_FRICTION;
export const SPIN_SCALE = PHYSICS_DEFAULTS.SPIN_SCALE;
export const SIDESPIN_DECAY = PHYSICS_DEFAULTS.SIDESPIN_DECAY;
export const CUSHION_GRIP = PHYSICS_DEFAULTS.CUSHION_GRIP;

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

export const applyRollingFriction = (balls: Ball[], dt: number) => {
  const rollingCoeff = physicsConfig.ROLLING_FRICTION;
  const tableMu = physicsConfig.TABLE_FRICTION;
  const sidespinDecay = physicsConfig.SIDESPIN_DECAY;
  const pixelRadius = 12;
  const physRadius = pixelRadius / SCALE;
  const g = 9.81;
  // Solid-sphere rotational inertia factor: I = (2/5) m r^2
  // Combined with r at the contact point, friction that produces a linear
  // velocity change dv also produces an angular change (5 / 2r) dv, so the
  // surface velocity v_s = v + ω × r_contact shrinks by (7/2) dv.
  const maxSurfaceDv = tableMu * g * dt;          // linear-velocity cap per step
  const sidespinDampFactor = Math.exp(-sidespinDecay * dt);

  for (const ball of balls) {
    const linvel = ball.body.linvel();
    const speed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);

    // --- Rolling resistance: gentle constant deceleration opposing motion ---
    let curVx = linvel.x;
    let curVz = linvel.z;
    if (speed > 0.05) {
      const deceleration = rollingCoeff * g;
      const newSpeed = Math.max(0, speed - deceleration * dt);
      const factor = newSpeed / speed;
      curVx = linvel.x * factor;
      curVz = linvel.z * factor;
      ball.body.setLinvel({ x: curVx, y: linvel.y, z: curVz }, true);
    }

    // --- Ball-cloth sliding friction: drives the ball toward pure rolling
    // and converts top/back spin into linear acceleration/deceleration. ---
    // Surface velocity at the contact point (bottom of ball, r = (0, -r, 0)):
    //   v_s = v + ω × r_contact
    //   (ω × r)_x = ω_z * r,  (ω × r)_z = -ω_x * r   (only horizontal parts matter)
    const angvel = ball.body.angvel();
    const vsX = curVx + angvel.z * physRadius;
    const vsZ = curVz - angvel.x * physRadius;
    const vsMag = Math.sqrt(vsX * vsX + vsZ * vsZ);

    if (vsMag > 1e-4) {
      // Cap the linear-velocity change per step at μ g dt (the max friction
      // impulse per unit mass). dvNeeded = (2/7) * |v_s| would bring v_s to
      // zero in one step; clamp to the per-step cap so friction can't inject
      // energy by reversing v_s.
      const dvNeeded = (2 / 7) * vsMag;
      const dvActual = Math.min(maxSurfaceDv, dvNeeded);
      const k = dvActual / vsMag;          // linear-velocity change per unit v_s
      const dvLinX = -k * vsX;
      const dvLinZ = -k * vsZ;
      // Δω from friction impulse at contact (r × J)/I, simplified for solid sphere:
      //   Δω_x =  (5 / 2r) * k * vs_z
      //   Δω_z = -(5 / 2r) * k * vs_x
      const spinFactor = (5 / (2 * physRadius)) * k;
      const dwX = spinFactor * vsZ;
      const dwZ = -spinFactor * vsX;

      ball.body.setLinvel({ x: curVx + dvLinX, y: linvel.y, z: curVz + dvLinZ }, true);
      ball.body.setAngvel({
        x: angvel.x + dwX,
        y: angvel.y * sidespinDampFactor,
        z: angvel.z + dwZ
      }, true);
    } else {
      // Already rolling (or stationary): just damp residual sidespin.
      if (Math.abs(angvel.y) > 1e-4) {
        ball.body.setAngvel({ x: angvel.x, y: angvel.y * sidespinDampFactor, z: angvel.z }, true);
      }
    }

    // --- Stop very slow balls completely so the table can settle ---
    // Match the original behavior: hard-stop at low linear speed so the
    // simulation converges deterministically. With natural rolling seeded at
    // shot time, a stationary ball has near-zero angular velocity too, so this
    // doesn't kill draw shots (which keep linear speed > 0.05 while the ball
    // still has backspin-driven inertia).
    if (speed < 0.05) {
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Keep balls on the table surface (Y = physRadius)
    const pos = ball.body.translation();
    if (Math.abs(pos.y - physRadius) > 0.01) {
      ball.body.setTranslation({ x: pos.x, y: physRadius, z: pos.z }, true);
      const linv = ball.body.linvel();
      ball.body.setLinvel({ x: linv.x, y: 0, z: linv.z }, true);
    }
  }
};

/**
 * Determine the inward unit normal of the cushion the ball is currently
 * touching, in canvas-pixel space (y here corresponds to physics z). Returns
 * null if the ball is not in contact with any cushion. Only the four primary
 * cushion directions are recognized; pocket throats are intentionally ignored
 * since the ball is either already pocketed or about to be.
 */
export const getCushionInwardAt = (
  pixelX: number,
  pixelY: number,
  tableWidth: number,
  tableHeight: number
): { x: number; y: number } | null => {
  const nose = TABLE.CUSHION_INSET + TABLE.CUSHION_WIDTH;
  const ballR = TABLE.BALL_RADIUS;
  const touch = ballR + 2;

  const dTop = pixelY - nose;
  const dBottom = tableHeight - nose - pixelY;
  const dLeft = pixelX - nose;
  const dRight = tableWidth - nose - pixelX;

  const candidates: Array<{ dist: number; normal: { x: number; y: number } }> = [];
  if (Math.abs(dTop) <= touch) candidates.push({ dist: Math.abs(dTop), normal: { x: 0, y: 1 } });
  if (Math.abs(dBottom) <= touch) candidates.push({ dist: Math.abs(dBottom), normal: { x: 0, y: -1 } });
  if (Math.abs(dLeft) <= touch) candidates.push({ dist: Math.abs(dLeft), normal: { x: 1, y: 0 } });
  if (Math.abs(dRight) <= touch) candidates.push({ dist: Math.abs(dRight), normal: { x: -1, y: 0 } });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].normal;
};

/**
 * Apply sidespin (english) effect when a ball bounces off a cushion. The
 * cushion exerts a tangential friction impulse that converts vertical-axis
 * spin into linear velocity along the cushion, and reduces the spin itself.
 * Called once per detected ball-cushion collision start.
 */
export const applyCushionSpinToBall = (
  ball: Ball,
  tableWidth: number,
  tableHeight: number
) => {
  const ω = ball.body.angvel();
  if (Math.abs(ω.y) < 0.1) return;

  const pos = ball.body.translation();
  const pixelX = pos.x * SCALE;
  const pixelY = pos.z * SCALE;
  const normal = getCushionInwardAt(pixelX, pixelY, tableWidth, tableHeight);
  if (!normal) return;

  const physR = TABLE.BALL_RADIUS / SCALE;
  // Surface velocity at the cushion contact point due to vertical-axis spin
  // is ω_y * r in the tangential direction. Tangent t = (-n_z, 0, n_x), which
  // in canvas space (y ↔ z) is (-normal.y, normal.x).
  const spinSurfaceSpeed = ω.y * physR;
  const grip = physicsConfig.CUSHION_GRIP;
  // Negative sign so positive sidespin (right english) runs the ball to the
  // shooter's right along the cushion, matching the cue-ball control labels.
  const boost = -spinSurfaceSpeed * grip;

  const v = ball.body.linvel();
  ball.body.setLinvel({
    x: v.x + boost * -normal.y,
    y: v.y,
    z: v.z + boost * normal.x
  }, true);

  // Part of the sidespin is transferred to linear momentum at the cushion.
  ball.body.setAngvel({
    x: ω.x,
    y: ω.y * (1 - grip * 0.5),
    z: ω.z
  }, true);
};

export type CollisionHandlers = {
  onBallBallCollision?: (b1: Ball, b2: Ball) => void;
  onBallCushionCollision?: (ball: Ball) => void;
};

/**
 * Drain Rapier's collision event queue once and dispatch each event to the
 * appropriate handler. Used by the live game loop (with audio + cushion-spin
 * callbacks) and by `simulateShot` (cushion-spin only) so both pipelines apply
 * identical physics.
 */
export const processCollisionEvents = (
  eventQueue: RAPIER.EventQueue,
  world: RAPIER.World,
  balls: Ball[],
  handlers: CollisionHandlers
) => {
  if (!handlers.onBallBallCollision && !handlers.onBallCushionCollision) {
    // Drain without doing anything so the queue doesn't accumulate stale events.
    eventQueue.drainCollisionEvents(() => {});
    return;
  }

  const ballHandles = new Map<number, Ball>(balls.map(b => [b.collider.handle, b]));

  eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    if (!started) return;

    const ball1 = ballHandles.get(handle1);
    const ball2 = ballHandles.get(handle2);
    if (!ball1 && !ball2) return;

    const c1 = world.getCollider(handle1);
    const c2 = world.getCollider(handle2);

    if (ball1 && ball2) {
      handlers.onBallBallCollision?.(ball1, ball2);
      return;
    }

    const ball = ball1 ?? ball2;
    if (!ball) return;
    const otherIsFixed = ball1
      ? (c2.parent()?.isFixed() ?? false)
      : (c1.parent()?.isFixed() ?? false);
    if (otherIsFixed) {
      handlers.onBallCushionCollision?.(ball);
    }
  });
};
