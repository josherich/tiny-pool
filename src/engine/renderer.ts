import {
  physicsConfig,
  SCALE,
  BALL_RADIUS_PX,
  SURFACE_ORIGIN_X,
  SURFACE_ORIGIN_Z,
  SURFACE_W,
  SURFACE_L,
  getTableGeometry,
  getTableBounds,
  type Ball,
  type Pocket,
  type Pocketed,
  type PocketedEvent,
} from '../pool_physics';
import { isValidBallPlacement } from '../pool_rules';
import { renderBall3D, renderDisplayBall, BALL_COLORS } from './ball_renderer';
import { TABLE_THEMES, type ThemeColors, type TableTheme } from '../settings';

export type PocketingAnimation = PocketedEvent & {
  startTime: number;
  duration: number;
};

export type RenderState = {
  balls: Ball[];
  pockets: Pocket[];
  pocketed: Pocketed;
  currentPlayer: number;
  playerTypes: { player1: string | null; player2: string | null };
  aiming: boolean;
  aimAngle: number;
  power: number;
  ballInHand: boolean;
  mousePos: { x: number; y: number };
  canShoot: boolean;
  cueSpinOffset: { x: number; y: number };
  cueControlExpanded: boolean;
  pocketingAnimations: PocketingAnimation[];
  mode: string;
  isMyTurn: boolean;
};

function findTargetBall(
  balls: Ball[],
  cueBallX: number,
  cueBallY: number,
  aimAngle: number,
  ballRadius: number
): { impactX: number; impactY: number; targetBallX: number; targetBallY: number } | null {
  const dirX = Math.cos(aimAngle);
  const dirY = Math.sin(aimAngle);

  let closestDist = Infinity;
  let closestBall: { x: number; y: number } | null = null;

  for (const ball of balls) {
    if (ball.type === 'cue') continue;
    const pos = ball.body.translation();
    const targetX = pos.x * SCALE;
    const targetY = pos.z * SCALE;

    const toTargetX = targetX - cueBallX;
    const toTargetY = targetY - cueBallY;
    const projDist = toTargetX * dirX + toTargetY * dirY;
    if (projDist <= 0) continue;

    const closestPointX = cueBallX + dirX * projDist;
    const closestPointY = cueBallY + dirY * projDist;
    const perpDist = Math.hypot(targetX - closestPointX, targetY - closestPointY);
    const collisionDist = ballRadius * 2;

    if (perpDist < collisionDist) {
      const backDist = Math.sqrt(collisionDist * collisionDist - perpDist * perpDist);
      const actualDist = projDist - backDist;
      if (actualDist > 0 && actualDist < closestDist) {
        closestDist = actualDist;
        closestBall = { x: targetX, y: targetY };
      }
    }
  }

  if (closestBall) {
    return {
      impactX: cueBallX + dirX * closestDist,
      impactY: cueBallY + dirY * closestDist,
      targetBallX: closestBall.x,
      targetBallY: closestBall.y
    };
  }
  return null;
}

// Pixel coordinates of the playing surface
const feltLeft = SURFACE_ORIGIN_X * SCALE;
const feltTop = SURFACE_ORIGIN_Z * SCALE;
const feltW = SURFACE_W * SCALE;
const feltL = SURFACE_L * SCALE;

export class PoolRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private theme: ThemeColors = TABLE_THEMES['green'];
  private aimLineLength = 300;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  setTheme(tableTheme: TableTheme) {
    this.theme = TABLE_THEMES[tableTheme];
  }

  setAimLineLength(length: number) {
    this.aimLineLength = Math.max(100, Math.min(500, length));
  }

  render(state: RenderState) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const radius = BALL_RADIUS_PX;
    const now = performance.now();

    // Background (outer rail wood)
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, w, h);

    // Felt (playing surface)
    ctx.fillStyle = this.theme.felt;
    ctx.fillRect(feltLeft, feltTop, feltW, feltL);

    this.renderCushionShadows(ctx, w, h);
    this.renderTableMarkings(ctx, w, h);
    this.renderPockets(ctx, state.pockets);
    this.renderBallShadows(ctx, state.balls, radius, state.ballInHand);
    this.renderBalls(ctx, state.balls, radius, state.ballInHand);
    this.renderPocketingAnimations(ctx, state.pocketingAnimations, radius, now);
    this.renderBallInHand(ctx, state, w, h, radius);
    this.renderCueStick(ctx, state, radius);
    this.renderPowerMeter(ctx, state, w, h);
    this.renderBallDisplay(ctx, state, w);
    this.renderCueSpinControl(ctx, state);
  }

  private renderCushionShadows(ctx: CanvasRenderingContext2D, _w: number, _h: number) {
    const sd = 10, ssd = 3;
    ctx.save();
    ctx.beginPath();
    ctx.rect(feltLeft, feltTop, feltW, feltL);
    ctx.clip();

    // Top shadow
    const topS = ctx.createLinearGradient(0, feltTop, 0, feltTop + sd);
    topS.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
    topS.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = topS;
    ctx.fillRect(feltLeft, feltTop, feltW, sd);

    // Side shadows
    const leftS = ctx.createLinearGradient(feltLeft, 0, feltLeft + sd, 0);
    leftS.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
    leftS.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = leftS;
    ctx.fillRect(feltLeft, feltTop, ssd, feltL);

    const rightS = ctx.createLinearGradient(feltLeft + feltW, 0, feltLeft + feltW - sd, 0);
    rightS.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
    rightS.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rightS;
    ctx.fillRect(feltLeft + feltW - ssd, feltTop, ssd, feltL);

    // Bottom shadow
    const botS = ctx.createLinearGradient(0, feltTop + feltL - sd, 0, feltTop + feltL);
    botS.addColorStop(0, 'rgba(0, 0, 0, 0)');
    botS.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
    ctx.fillStyle = botS;
    ctx.fillRect(feltLeft, feltTop + feltL - sd, feltW, sd);
    ctx.restore();
  }

  private renderTableMarkings(ctx: CanvasRenderingContext2D, _w: number, _h: number) {
    // Draw cushion nose segments as lines on the felt boundary
    const geo = getTableGeometry();
    ctx.strokeStyle = this.theme.feltBorder;
    ctx.lineWidth = 2;

    // Draw each cushion segment as a line
    for (const seg of geo.linearSegments) {
      ctx.beginPath();
      ctx.moveTo(seg.x1 * SCALE, seg.z1 * SCALE);
      ctx.lineTo(seg.x2 * SCALE, seg.z2 * SCALE);
      ctx.stroke();
    }

    // Draw circular jaw tips
    for (const tip of geo.circularTips) {
      ctx.beginPath();
      ctx.arc(tip.x * SCALE, tip.z * SCALE, tip.radius * SCALE, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderPockets(ctx: CanvasRenderingContext2D, pockets: Pocket[]) {
    // Arc ranges for pocket rim highlights (based on pocket position)
    // Order: bottom-left, bottom-side, bottom-right, top-left, top-side, top-right
    const arcRanges: [number, number][] = [
      [0.75, 1.75], [1.1, 1.9], [1.25, 2.25],
      [0.25, 1.25], [0.1, 0.9], [-0.25, 0.75]
    ];

    pockets.forEach((p, i) => {
      ctx.fillStyle = this.theme.pocketShadow;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = this.theme.pocketBg;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 2, 0, Math.PI * 2); ctx.fill();

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      g.addColorStop(0, 'hsl(0, 0%, 2%)'); g.addColorStop(0.7, 'hsl(0, 0%, 5%)'); g.addColorStop(1, 'hsl(0, 0%, 10%)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = 'hsl(0, 0%, 0%)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 0.7, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = 'hsl(25, 25%, 20%)'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius - 1, Math.PI * arcRanges[i][0], Math.PI * arcRanges[i][1]);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x - 2, p.y - 2, p.radius * 0.5, 0, Math.PI * 2); ctx.stroke();
    });
  }

  private renderBallShadows(ctx: CanvasRenderingContext2D, balls: Ball[], radius: number, ballInHand: boolean) {
    balls.forEach(ball => {
      if (ballInHand && ball.type === 'cue') return;
      const pos = ball.body.translation();
      ctx.save();
      ctx.translate(pos.x * SCALE + 3, pos.z * SCALE + 4);
      ctx.scale(1, 0.6);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.1);
      sg.addColorStop(0, 'rgba(0, 0, 0, 0.79)');
      sg.addColorStop(0.6, 'rgba(0, 0, 0, 0.54)');
      sg.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, radius * 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  private renderBalls(ctx: CanvasRenderingContext2D, balls: Ball[], radius: number, ballInHand: boolean) {
    balls.forEach(ball => {
      if (ballInHand && ball.type === 'cue') return;
      const pos = ball.body.translation();
      const rot = ball.body.rotation();
      renderBall3D(ctx, pos.x * SCALE, pos.z * SCALE, radius, ball.type, ball.number, rot);
    });
  }

  private renderPocketingAnimations(ctx: CanvasRenderingContext2D, anims: PocketingAnimation[], radius: number, now: number) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const elapsed = now - a.startTime;
      if (elapsed >= a.duration) { anims.splice(i, 1); continue; }

      const t = Math.min(elapsed / a.duration, 1);
      const ease = t * t;
      const drawX = a.startX + (a.pocketX - a.startX) * ease;
      const drawY = a.startY + (a.pocketY - a.startY) * ease;
      const scale = 1 - 0.75 * ease;
      const alpha = 1 - 0.85 * ease;

      ctx.save(); ctx.globalAlpha = 0.45 * (1 - ease);
      ctx.translate(drawX + 2, drawY + 3); ctx.scale(1, 0.6);
      ctx.beginPath(); ctx.arc(0, 0, radius * 1.05 * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fill(); ctx.restore();

      ctx.save(); ctx.globalAlpha = alpha;
      renderBall3D(ctx, drawX, drawY, radius * scale, a.type, a.number, a.rotation);
      ctx.restore();
    }
  }

  private renderBallInHand(ctx: CanvasRenderingContext2D, state: RenderState, w: number, h: number, radius: number) {
    if (!state.ballInHand) return;
    const canPlace = state.mode !== 'online' || state.isMyTurn;

    if (canPlace) {
      const gx = state.mousePos.x, gy = state.mousePos.y;
      const physX = gx / SCALE, physZ = gy / SCALE;
      const bounds = getTableBounds();
      const ballPositions = state.balls.filter(b => b.type !== 'cue').map(b => {
        const pos = b.body.translation(); return { x: pos.x, z: pos.z };
      });
      const valid = isValidBallPlacement({ physX, physZ, ballPositions, ...bounds });

      ctx.save(); ctx.globalAlpha = 0.4; ctx.translate(gx + 3, gy + 4); ctx.scale(1, 0.6);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.beginPath(); ctx.arc(0, 0, radius * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(gx, gy, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      ctx.strokeStyle = valid ? 'rgba(50, 205, 50, 0.8)' : 'rgba(220, 50, 50, 0.8)';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, radius + 3, 0, Math.PI * 2); ctx.stroke();

      ctx.fillStyle = valid ? 'hsl(120, 60%, 60%)' : 'hsl(0, 60%, 60%)';
      ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
      ctx.fillText('Ball in Hand - Click to place', w / 2, h - 30);
    } else {
      ctx.fillStyle = 'hsl(45, 80%, 65%)'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
      ctx.fillText('Opponent placing cue ball...', w / 2, h - 30);
    }
  }

  private renderCueStick(ctx: CanvasRenderingContext2D, state: RenderState, radius: number) {
    if (!state.canShoot) return;
    const cueBall = state.balls.find(b => b.type === 'cue');
    if (!cueBall) return;

    const pos = cueBall.body.translation();
    const bx = pos.x * SCALE, by = pos.z * SCALE;
    const cueLen = 400;
    const pr = Math.min(state.power / physicsConfig.MAX_SHOT_POWER, 1);
    const cueDist = state.aiming ? 30 + pr * 50 : 30;
    const sx = bx - Math.cos(state.aimAngle) * cueDist;
    const sy = by - Math.sin(state.aimAngle) * cueDist;
    const ex = sx - Math.cos(state.aimAngle) * cueLen;
    const ey = sy - Math.sin(state.aimAngle) * cueLen;
    const ca = Math.atan2(ey - sy, ex - sx);

    const tipLen = 6, ferruleLen = 10, shaftLen = cueLen * 0.62;
    const shaftStart = tipLen + ferruleLen, buttStart = shaftStart + shaftLen;

    ctx.save(); ctx.translate(sx + 4, sy + 5); ctx.rotate(ca);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cueLen, 0); ctx.stroke(); ctx.restore();

    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ca);

    const seg = (x0: number, x1: number, w: number, s: CanvasRenderingContext2D['strokeStyle']) => {
      ctx.strokeStyle = s; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke();
    };

    seg(0, tipLen, 7, '#1f2937');
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    seg(tipLen, tipLen + ferruleLen, 7.4, '#e5e7eb');

    const sg = ctx.createLinearGradient(shaftStart, 0, shaftStart + shaftLen, 0);
    sg.addColorStop(0, 'hsl(35, 45%, 78%)'); sg.addColorStop(0.45, 'hsl(30, 42%, 62%)'); sg.addColorStop(1, 'hsl(25, 38%, 45%)');
    seg(shaftStart, shaftStart + shaftLen, 7.8, sg);

    const bg = ctx.createLinearGradient(buttStart, 0, cueLen, 0);
    bg.addColorStop(0, 'hsl(20, 45%, 35%)'); bg.addColorStop(0.6, 'hsl(18, 40%, 28%)'); bg.addColorStop(1, 'hsl(12, 35%, 18%)');
    seg(buttStart, cueLen, 10, bg);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(buttStart + 8, 0); ctx.lineTo(buttStart + 28, 0); ctx.stroke();
    ctx.fillStyle = 'hsl(12, 35%, 14%)'; ctx.beginPath(); ctx.arc(cueLen, 0, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Aiming line
    const tbi = findTargetBall(state.balls, bx, by, state.aimAngle, radius);
    const op = state.aiming ? 0.3 + 0.3 * pr : 0.4;
    ctx.strokeStyle = `rgba(255, 255, 255, ${op})`; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(bx, by);

    if (tbi) {
      ctx.lineTo(tbi.impactX, tbi.impactY); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = `rgba(255, 255, 255, ${op + 0.2})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tbi.impactX, tbi.impactY, radius, 0, Math.PI * 2); ctx.stroke();

      const tdx = tbi.targetBallX - tbi.impactX, tdy = tbi.targetBallY - tbi.impactY;
      const tdl = Math.sqrt(tdx * tdx + tdy * tdy);
      if (tdl > 0.1) {
        ctx.strokeStyle = `rgba(255, 200, 100, ${op + 0.1})`; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(tbi.targetBallX, tbi.targetBallY);
        ctx.lineTo(tbi.targetBallX + tdx / tdl * (this.aimLineLength * 0.5), tbi.targetBallY + tdy / tdl * (this.aimLineLength * 0.5)); ctx.stroke();
      }
      ctx.setLineDash([]);
    } else {
      ctx.lineTo(bx + Math.cos(state.aimAngle) * this.aimLineLength, by + Math.sin(state.aimAngle) * this.aimLineLength);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  private renderPowerMeter(ctx: CanvasRenderingContext2D, state: RenderState, w: number, h: number) {
    if (!state.aiming) return;
    const mx = w / 2, my = h - 60, mw = 200, mh = 20;
    const pr = Math.min(state.power / physicsConfig.MAX_SHOT_POWER, 1);
    ctx.fillStyle = 'hsl(25, 15%, 15%)'; ctx.fillRect(mx - mw / 2, my, mw, mh);
    ctx.fillStyle = `hsl(${120 - pr * 120}, 70%, 50%)`; ctx.fillRect(mx - mw / 2, my, mw * pr, mh);
    ctx.strokeStyle = 'hsl(45, 80%, 65%)'; ctx.lineWidth = 2; ctx.strokeRect(mx - mw / 2, my, mw, mh);
  }

  private renderBallDisplay(ctx: CanvasRenderingContext2D, state: RenderState, cw: number) {
    const dy = 20, br = 10, bs = 24, gpx = 16, gpy = 8;
    const cpt = state.currentPlayer === 1 ? state.playerTypes.player1 : state.playerTypes.player2;
    const solActive = cpt === 'solid', strActive = cpt === 'stripe';
    const solStart = 90, solEnd = solStart + 6 * bs;
    const strEnd = cw - 90, strStart = strEnd - 6 * bs;

    const highlight = (sx: number, ex: number, active: boolean) => {
      ctx.save();
      ctx.strokeStyle = active ? 'hsl(45, 85%, 62%)' : 'rgba(148, 163, 184, 0.22)';
      ctx.fillStyle = active ? 'rgba(250, 204, 21, 0.14)' : 'rgba(75, 85, 99, 0.2)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(sx - gpx, dy - br - gpy, ex - sx + gpx * 2, br * 2 + gpy * 2, 12);
      ctx.fill(); ctx.stroke(); ctx.restore();
    };

    highlight(solStart, solEnd, solActive);
    highlight(strStart, strEnd, strActive);

    for (let i = 1; i <= 7; i++) {
      renderDisplayBall(ctx, solStart + (i - 1) * bs, dy, br, 'solid', i, BALL_COLORS[(i - 1) % 8],
        state.pocketed.solids.includes(i), Boolean(cpt) && !solActive);
    }

    renderDisplayBall(ctx, cw / 2 + 50, dy, br, 'eight', 8, '#333333', state.pocketed.eight, false);

    for (let i = 9; i <= 15; i++) {
      renderDisplayBall(ctx, strEnd - (15 - i) * bs, dy, br, 'stripe', i, BALL_COLORS[(i - 9) % 8],
        state.pocketed.stripes.includes(i), Boolean(cpt) && !strActive);
    }
  }

  private renderCueSpinControl(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!state.cueControlExpanded) {
      this.renderMiniCueSpinControl(ctx, state); return;
    }

    const cx = this.canvas.width - 80, cy = 88, r = 50;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 12, 12, 0.55)'; ctx.beginPath(); ctx.arc(cx, cy, r + 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3f4f6'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();

    const dx = cx + state.cueSpinOffset.x * r, ddy = cy + state.cueSpinOffset.y * r;
    ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(dx, ddy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx - 2, ddy - 2, 3, 0, Math.PI * 2); ctx.stroke();

    ctx.textAlign = 'center'; ctx.fillStyle = '#f9fafb'; ctx.font = 'bold 12px Arial';
    ctx.fillText('Cue Ball Control', cx, cy - r - 20);
    ctx.font = '11px Arial'; ctx.fillStyle = 'rgba(249, 250, 251, 0.9)';
    ctx.fillText('Top', cx, cy - r - 6); ctx.fillText('Back', cx, cy + r + 15);
    ctx.fillText('Left', cx - r - 20, cy + 4); ctx.fillText('Right', cx + r + 23, cy + 4);
    ctx.restore();
  }

  private renderMiniCueSpinControl(ctx: CanvasRenderingContext2D, state: RenderState) {
    const cx = this.canvas.width - 20, cy = this.canvas.height / 2 - 20, r = 14;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 12, 12, 0.45)'; ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3f4f6'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    const dx = cx + state.cueSpinOffset.x * r, dy = cy + state.cueSpinOffset.y * r;
    ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(dx, dy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
