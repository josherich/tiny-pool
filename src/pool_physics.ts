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
  BALL_FRICTION: 0.001,       // No ball-to-ball friction so physics matches guide line prediction
  CUSHION_RESTITUTION: 0.75,  // Cushion bounce factor
  CUSHION_FRICTION: 0.15,     // Cushion surface friction
  ROLLING_FRICTION: 0.015,    // Felt resistance (simulated)
  LINEAR_DAMPING: 0.8,        // Simulates rolling resistance on felt
  ANGULAR_DAMPING: 0.9,       // Simulates rotational friction on felt
  MAX_SHOT_POWER: 9,          // Maximum shot power (affects impulse strength)
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

// Canvas to physics scale (pixels per physics unit)
export const SCALE = 5;

// Fixed timestep for deterministic physics (240 Hz)
export const FIXED_DT = 1 / 240;

// ---------------------------------------------------------------------------
// Table specifications (based on pooltool PocketTableSpecs for a 7-ft table)
// All values in meters
// ---------------------------------------------------------------------------
export const TABLE_SPECS = {
  l: 1.9812,            // playing surface length (long axis, maps to X)
  w: 0.9906,            // playing surface width (short axis, maps to Z)
  cushionWidth: 0.0508, // depth of the cushion rubber from nose to rail back
  cushionHeight: 0.032, // height of cushion nose above table surface
  cornerPocket: {
    width: 0.118,        // opening width at cushion nose
    angle: 5.3,          // jaw angle in degrees from 45-degree diagonal
    depth: 0.0417,       // how far pocket center is offset from cushion intersection
    radius: 0.062,       // pocket catch radius
    jawRadius: 0.032,    // radius of curved jaw tips
  },
  sidePocket: {
    width: 0.137,
    angle: 7.14,
    depth: 0.0685,
    radius: 0.0645,
    jawRadius: 0.032,
  },
  ballRadius: 0.02625,  // standard 2.25" diameter ball
};

// Compute a scale factor that maps meters to physics units.
// The canvas is 1200x700 (SCALE=5), so physics space is 240x140.
// Reserve 40px (8 phys units) margin on each side for the rail wood.
// The long axis (l) maps to X; the short axis (w) maps to Z.
const CANVAS_W = 1200;
const CANVAS_H = 700;
const MARGIN_PX = 40;       // outer table edge margin in pixels
const MARGIN = MARGIN_PX / SCALE; // in physics units

// TABLE_UNIT: physics units per meter
export const TABLE_UNIT = (CANVAS_W / SCALE - 2 * MARGIN) / TABLE_SPECS.l;

// Playing surface origin in physics coords (top-left corner of felt)
export const SURFACE_ORIGIN_X = MARGIN;
export const SURFACE_ORIGIN_Z = (CANVAS_H / SCALE - TABLE_SPECS.w * TABLE_UNIT) / 2;
export const SURFACE_W = TABLE_SPECS.l * TABLE_UNIT; // physics width along X
export const SURFACE_L = TABLE_SPECS.w * TABLE_UNIT; // physics length along Z

// Ball radius in physics units
export const PHYS_BALL_RADIUS = TABLE_SPECS.ballRadius * TABLE_UNIT;
// Ball radius in pixels (for rendering)
export const BALL_RADIUS_PX = PHYS_BALL_RADIUS * SCALE;

// ---------------------------------------------------------------------------
// Table geometry computation (following pooltool layout.py)
// ---------------------------------------------------------------------------

type Seg = { x1: number; z1: number; x2: number; z2: number };
type Tip = { x: number; z: number; radius: number };

export type TableGeometry = {
  linearSegments: Seg[];
  circularTips: Tip[];
  pockets: Pocket[];       // in pixel coords
  physPockets: { x: number; z: number; radius: number }[]; // in physics coords
};

export function computeTableGeometry(): TableGeometry {
  const S = TABLE_UNIT;
  const ox = SURFACE_ORIGIN_X;
  const oz = SURFACE_ORIGIN_Z;
  const W = SURFACE_W;     // playing surface X extent
  const L = SURFACE_L;     // playing surface Z extent

  const cw = TABLE_SPECS.cushionWidth * S;
  const ca = (TABLE_SPECS.cornerPocket.angle + 45) * Math.PI / 180;
  const sa = TABLE_SPECS.sidePocket.angle * Math.PI / 180;
  const pw = TABLE_SPECS.cornerPocket.width * S;
  const sw = TABLE_SPECS.sidePocket.width * S;
  const rc = TABLE_SPECS.cornerPocket.jawRadius * S;
  const rs = TABLE_SPECS.sidePocket.jawRadius * S;
  const dc = rc / Math.tan((Math.PI / 2 + ca) / 2);
  const ds = rs / Math.tan((Math.PI / 2 + sa) / 2);

  // Pooltool uses (x, y) = (width, length). Our coordinate system:
  //   pooltool x -> our Z (short axis, width)
  //   pooltool y -> our X (long axis, length)
  // We need to swap and offset. Define helper that takes pooltool (x,y) and
  // returns our (physX, physZ):
  const pt = (px: number, py: number) => ({
    x: ox + py,  // pooltool y = along length = our X
    z: oz + px,  // pooltool x = along width  = our Z
  });

  // Pooltool playing surface: x in [0, w], y in [0, l]  (w=short, l=long)
  const ptW = TABLE_SPECS.w * S;  // pooltool width (short)
  const ptL = TABLE_SPECS.l * S;  // pooltool length (long)

  const linearSegments: Seg[] = [];
  const addSeg = (px1: number, py1: number, px2: number, py2: number) => {
    const p1 = pt(px1, py1);
    const p2 = pt(px2, py2);
    linearSegments.push({ x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z });
  };

  // --- 6 main rail segments ---
  // Segment 3: left long rail, bottom half (pooltool: x=0, from corner to side pocket)
  addSeg(0, pw * Math.cos(Math.PI / 4) + dc, 0, (ptL - sw) / 2 - ds);
  // Segment 6: left long rail, top half
  addSeg(0, (ptL + sw) / 2 + ds, 0, -pw * Math.cos(Math.PI / 4) + ptL - dc);
  // Segment 15: right long rail, bottom half
  addSeg(ptW, pw * Math.cos(Math.PI / 4) + dc, ptW, (ptL - sw) / 2 - ds);
  // Segment 12: right long rail, top half
  addSeg(ptW, (ptL + sw) / 2 + ds, ptW, -pw * Math.cos(Math.PI / 4) + ptL - dc);
  // Segment 18: bottom short rail
  addSeg(pw * Math.cos(Math.PI / 4) + dc, 0, -pw * Math.cos(Math.PI / 4) + ptW - dc, 0);
  // Segment 9: top short rail
  addSeg(pw * Math.cos(Math.PI / 4) + dc, ptL, -pw * Math.cos(Math.PI / 4) + ptW - dc, ptL);

  // --- 4 side jaw segments ---
  // Segment 5: left side pocket, top jaw
  addSeg(-cw, (ptL + sw) / 2 - cw * Math.sin(sa),
         -ds * Math.cos(sa), (ptL + sw) / 2 - ds * Math.sin(sa));
  // Segment 4: left side pocket, bottom jaw
  addSeg(-cw, (ptL - sw) / 2 + cw * Math.sin(sa),
         -ds * Math.cos(sa), (ptL - sw) / 2 + ds * Math.sin(sa));
  // Segment 13: right side pocket, top jaw
  addSeg(ptW + cw, (ptL + sw) / 2 - cw * Math.sin(sa),
         ptW + ds * Math.cos(sa), (ptL + sw) / 2 - ds * Math.sin(sa));
  // Segment 14: right side pocket, bottom jaw
  addSeg(ptW + cw, (ptL - sw) / 2 + cw * Math.sin(sa),
         ptW + ds * Math.cos(sa), (ptL - sw) / 2 + ds * Math.sin(sa));

  // --- 8 corner jaw segments ---
  // Bottom-left corner (pooltool origin corner, y=0, x=0)
  // Segment 1: jaw along bottom rail (y=0)
  addSeg(pw * Math.cos(Math.PI / 4) - cw * Math.tan(ca), -cw,
         pw * Math.cos(Math.PI / 4) - dc * Math.sin(ca), -dc * Math.cos(ca));
  // Segment 2: jaw along left rail (x=0)
  addSeg(-cw, pw * Math.cos(Math.PI / 4) - cw * Math.tan(ca),
         -dc * Math.cos(ca), pw * Math.cos(Math.PI / 4) - dc * Math.sin(ca));

  // Top-left corner (y=ptL, x=0)
  // Segment 8: jaw along top rail
  addSeg(pw * Math.cos(Math.PI / 4) - cw * Math.tan(ca), cw + ptL,
         pw * Math.cos(Math.PI / 4) - dc * Math.sin(ca), ptL + dc * Math.cos(ca));
  // Segment 7: jaw along left rail
  addSeg(-cw, -pw * Math.cos(Math.PI / 4) + cw * Math.tan(ca) + ptL,
         -dc * Math.cos(ca), -pw * Math.cos(Math.PI / 4) + ptL + dc * Math.sin(ca));

  // Top-right corner (y=ptL, x=ptW)
  // Segment 10
  addSeg(-pw * Math.cos(Math.PI / 4) + cw * Math.tan(ca) + ptW, cw + ptL,
         -pw * Math.cos(Math.PI / 4) + ptW + dc * Math.sin(ca), ptL + dc * Math.cos(ca));
  // Segment 11
  addSeg(cw + ptW, -pw * Math.cos(Math.PI / 4) + cw * Math.tan(ca) + ptL,
         ptW + dc * Math.cos(ca), -pw * Math.cos(Math.PI / 4) + ptL + dc * Math.sin(ca));

  // Bottom-right corner (y=0, x=ptW)
  // Segment 16
  addSeg(cw + ptW, pw * Math.cos(Math.PI / 4) - cw * Math.tan(ca),
         ptW + dc * Math.cos(ca), pw * Math.cos(Math.PI / 4) - dc * Math.sin(ca));
  // Segment 17
  addSeg(-pw * Math.cos(Math.PI / 4) + cw * Math.tan(ca) + ptW, -cw,
         -pw * Math.cos(Math.PI / 4) + ptW + dc * Math.sin(ca), -dc * Math.cos(ca));

  // --- 12 circular jaw tips ---
  const circularTips: Tip[] = [];
  const addTip = (px: number, py: number, r: number) => {
    const p = pt(px, py);
    circularTips.push({ x: p.x, z: p.z, radius: r });
  };

  // Bottom-left corner
  addTip(pw * Math.cos(Math.PI / 4) + dc, -rc, rc);   // 1t: rail-side tip
  addTip(-rc, pw * Math.cos(Math.PI / 4) + dc, rc);    // 2t: rail-side tip

  // Left side pocket
  addTip(-rs, ptL / 2 - sw / 2 - ds, rs);              // 4t
  addTip(-rs, ptL / 2 + sw / 2 + ds, rs);              // 5t

  // Top-left corner
  addTip(-rc, ptL - (pw * Math.cos(Math.PI / 4) + dc), rc);  // 7t
  addTip(pw * Math.cos(Math.PI / 4) + dc, ptL + rc, rc);     // 8t

  // Top-right corner
  addTip(ptW - pw * Math.cos(Math.PI / 4) - dc, ptL + rc, rc);    // 10t
  addTip(ptW + rc, ptL - (pw * Math.cos(Math.PI / 4) + dc), rc);   // 11t

  // Right side pocket
  addTip(ptW + rs, ptL / 2 + sw / 2 + ds, rs);         // 13t
  addTip(ptW + rs, ptL / 2 - sw / 2 - ds, rs);         // 14t

  // Bottom-right corner
  addTip(ptW + rc, pw * Math.cos(Math.PI / 4) + dc, rc);           // 16t
  addTip(ptW - pw * Math.cos(Math.PI / 4) - dc, -rc, rc);         // 17t

  // --- Pocket positions ---
  const cr = TABLE_SPECS.cornerPocket.radius * S;
  const sr = TABLE_SPECS.sidePocket.radius * S;
  const cd = TABLE_SPECS.cornerPocket.depth * S;
  const sd = TABLE_SPECS.sidePocket.depth * S;
  const cD = cd / Math.sqrt(2);
  const sD = sd;

  const physPockets = [
    { x: ox - cD,          z: oz - cD,          radius: cr },  // bottom-left
    { x: ox + W / 2,       z: oz - sD,          radius: sr },  // bottom-side (left side pocket in our coords)
    { x: ox + W + cD,      z: oz - cD,          radius: cr },  // bottom-right
    { x: ox - cD,          z: oz + L + cD,      radius: cr },  // top-left
    { x: ox + W / 2,       z: oz + L + sD,      radius: sr },  // top-side
    { x: ox + W + cD,      z: oz + L + cD,      radius: cr },  // top-right
  ];

  const pockets: Pocket[] = physPockets.map(p => ({
    x: p.x * SCALE,
    y: p.z * SCALE,
    radius: p.radius * SCALE,
  }));

  return { linearSegments, circularTips, pockets, physPockets };
}

// Cache geometry so renderer and other systems can access it
let _cachedGeometry: TableGeometry | null = null;
export function getTableGeometry(): TableGeometry {
  if (!_cachedGeometry) _cachedGeometry = computeTableGeometry();
  return _cachedGeometry;
}

// ---------------------------------------------------------------------------
// World and table setup
// ---------------------------------------------------------------------------

export const createWorld = (rapier: typeof RAPIER) =>
  new rapier.World({ x: 0.0, y: 0.0, z: 0.0 });

export const setupTable = ({
  canvas: _canvas,
  world,
  RAPIER: rapier
}: {
  canvas: HTMLCanvasElement;
  world: RAPIER.World;
  RAPIER: typeof RAPIER;
}) => {
  const geo = computeTableGeometry();
  _cachedGeometry = geo;

  const cushionHeight = PHYS_BALL_RADIUS * 2.5;
  const cushionThickness = TABLE_SPECS.cushionWidth * TABLE_UNIT;
  const cushionBodies: RAPIER.RigidBody[] = [];

  // Helper: create a rotated thin cuboid collider for a linear cushion segment
  const createSegmentCushion = (seg: Seg) => {
    const cx = (seg.x1 + seg.x2) / 2;
    const cz = (seg.z1 + seg.z2) / 2;
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001) return;

    // RAPIER Y-rotation: local X → (cos(θ), 0, -sin(θ)) in world.
    // To align local X with segment direction (dx, 0, dz), need sin(θ) = -dz/L.
    const angle = Math.atan2(-dz, dx);
    const qw = Math.cos(angle / 2);
    const qy = Math.sin(angle / 2);

    const bodyDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(cx, cushionHeight / 2, cz)
      .setRotation({ w: qw, x: 0, y: qy, z: 0 });
    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = rapier.ColliderDesc.cuboid(
      length / 2,            // half-extent along segment direction
      cushionHeight / 2,     // half-extent vertical
      cushionThickness / 2   // half-extent perpendicular to segment
    )
      .setRestitution(physicsConfig.CUSHION_RESTITUTION)
      .setFriction(physicsConfig.CUSHION_FRICTION)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(colliderDesc, body);
    cushionBodies.push(body);
  };

  // Helper: create a vertical cylinder collider for jaw tips
  const createTipCylinder = (tip: Tip) => {
    const bodyDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(tip.x, cushionHeight / 2, tip.z);
    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = rapier.ColliderDesc.cylinder(
      cushionHeight / 2,
      tip.radius
    )
      .setRestitution(physicsConfig.CUSHION_RESTITUTION)
      .setFriction(physicsConfig.CUSHION_FRICTION)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(colliderDesc, body);
    cushionBodies.push(body);
  };

  // Create all 18 linear cushion segments
  for (const seg of geo.linearSegments) {
    createSegmentCushion(seg);
  }

  // Create all 12 circular jaw-tip colliders
  for (const tip of geo.circularTips) {
    createTipCylinder(tip);
  }

  return { pockets: geo.pockets, cushionBodies };
};

// ---------------------------------------------------------------------------
// Ball setup
// ---------------------------------------------------------------------------

export const setupBalls = ({
  canvas: _canvas,
  world,
  RAPIER: rapier
}: {
  canvas: HTMLCanvasElement;
  world: RAPIER.World;
  RAPIER: typeof RAPIER;
}): Ball[] => {
  const balls: Ball[] = [];
  const physRadius = PHYS_BALL_RADIUS;

  // Cue ball at ~1/4 of playing surface length
  const cuePhysX = SURFACE_ORIGIN_X + SURFACE_W * 0.25;
  const cuePhysZ = SURFACE_ORIGIN_Z + SURFACE_L / 2;

  const createBall = (physX: number, physZ: number, type: string, number: number) => {
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(physX, physRadius, physZ)
      .setLinearDamping(physicsConfig.LINEAR_DAMPING)
      .setAngularDamping(physicsConfig.ANGULAR_DAMPING)
      .setCcdEnabled(true);

    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = rapier.ColliderDesc.ball(physRadius)
      .setRestitution(physicsConfig.BALL_RESTITUTION)
      .setFriction(physicsConfig.BALL_FRICTION)
      .setMass(physicsConfig.BALL_MASS)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

    const collider = world.createCollider(colliderDesc, body);
    balls.push({ body, collider, type, number });
  };

  createBall(cuePhysX, cuePhysZ, 'cue', 0);

  // Rack at ~3/4 of playing surface length (foot spot)
  const rackPhysX = SURFACE_ORIGIN_X + SURFACE_W * 0.75;
  const rackPhysZ = SURFACE_ORIGIN_Z + SURFACE_L / 2;

  const ballOrder = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let ballIndex = 0;
  const spacing = physRadius * 2.05;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = rackPhysX + row * spacing * 0.866;
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

// ---------------------------------------------------------------------------
// Pocket detection
// ---------------------------------------------------------------------------

export const checkPockets = ({
  world,
  canvas: _canvas,
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
  const physRadius = PHYS_BALL_RADIUS;
  const pocketedEvents: PocketedEvent[] = [];

  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i];
    const pos = ball.body.translation();

    const pixelX = pos.x * SCALE;
    const pixelZ = pos.z * SCALE;

    // Check proximity to pockets (pocket centers are outside the playing surface)
    let isInPocket = false;
    let pocketHit: Pocket | null = null;
    for (const pocket of pockets) {
      const dx = pixelX - pocket.x;
      const dz = pixelZ - pocket.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < pocket.radius) {
        isInPocket = true;
        pocketHit = pocket;
        break;
      }
    }

    // Fallback: ball far outside playing surface bounds
    const bx = SURFACE_ORIGIN_X * SCALE;
    const bz = SURFACE_ORIGIN_Z * SCALE;
    const bw = SURFACE_W * SCALE;
    const bl = SURFACE_L * SCALE;
    const margin = BALL_RADIUS_PX * 2;
    if (!isInPocket &&
        (pixelX < bx - margin || pixelX > bx + bw + margin ||
         pixelZ < bz - margin || pixelZ > bz + bl + margin)) {
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

      world.removeRigidBody(ball.body);

      if (ball.type === 'cue') {
        // Scratch - replace cue ball at starting position
        const resetPhysX = SURFACE_ORIGIN_X + SURFACE_W * 0.25;
        const resetPhysZ = SURFACE_ORIGIN_Z + SURFACE_L / 2;

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
        balls[i] = { body: newBody, collider: newCollider, type: 'cue', number: 0 };
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

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

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

export const computeSubSteps = (balls: Ball[], dt: number): number => {
  const physRadius = PHYS_BALL_RADIUS;
  const maxDistPerStep = physRadius * 0.5;

  let maxSpeed = 0;
  for (const ball of balls) {
    const v = ball.body.linvel();
    const speed = Math.sqrt(v.x * v.x + v.z * v.z);
    if (speed > maxSpeed) maxSpeed = speed;
  }

  if (maxSpeed <= 0) return 1;
  const needed = Math.ceil(maxSpeed * dt / maxDistPerStep);
  return Math.min(needed, 16);
};

export const applyRollingFriction = (balls: Ball[], dt: number) => {
  const frictionCoeff = physicsConfig.ROLLING_FRICTION;
  const physRadius = PHYS_BALL_RADIUS;

  for (const ball of balls) {
    const linvel = ball.body.linvel();
    const speed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);

    if (speed > 0.05) {
      const frictionForce = frictionCoeff * physicsConfig.BALL_MASS * 9.81;
      const deceleration = frictionForce / physicsConfig.BALL_MASS;
      const newSpeed = Math.max(0, speed - deceleration * dt);
      const factor = speed > 0 ? newSpeed / speed : 0;

      ball.body.setLinvel({
        x: linvel.x * factor,
        y: linvel.y,
        z: linvel.z * factor
      }, true);

      if (speed > 0.05) {
        const targetAngVelX = -linvel.z / physRadius;
        const targetAngVelZ = linvel.x / physRadius;

        const currentAngVel = ball.body.angvel();
        const blend = 0.1;
        ball.body.setAngvel({
          x: currentAngVel.x * (1 - blend) + targetAngVelX * blend,
          y: currentAngVel.y * 0.95,
          z: currentAngVel.z * (1 - blend) + targetAngVelZ * blend
        }, true);
      }
    } else {
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    const pos = ball.body.translation();
    if (Math.abs(pos.y - physRadius) > 0.01) {
      ball.body.setTranslation({ x: pos.x, y: physRadius, z: pos.z }, true);
      const linv = ball.body.linvel();
      ball.body.setLinvel({ x: linv.x, y: 0, z: linv.z }, true);
    }
  }
};

// ---------------------------------------------------------------------------
// Table bounds helper (used by engine and renderer)
// ---------------------------------------------------------------------------
export function getTableBounds() {
  const physBallRadius = PHYS_BALL_RADIUS;
  return {
    tableLeft: SURFACE_ORIGIN_X + physBallRadius,
    tableRight: SURFACE_ORIGIN_X + SURFACE_W - physBallRadius,
    tableTop: SURFACE_ORIGIN_Z + physBallRadius,
    tableBottom: SURFACE_ORIGIN_Z + SURFACE_L - physBallRadius,
    ballRadius: physBallRadius,
  };
}
