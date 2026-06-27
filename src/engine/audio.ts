import type RAPIER from '@dimforge/rapier3d-compat';
import { physicsConfig, type Ball } from '../pool_physics';
import cueStrikeSfx from '../pool-sounds/cue_strike.mp3';
import breakShotBigSfx from '../pool-sounds/break_shot_big.mp3';
import breakShotSmallSfx from '../pool-sounds/break_shot_small.mp3';
import ballCollisionSfx from '../pool-sounds/ball_collision.mp3';
import ballCollisionAltSfx from '../pool-sounds/ball_collision_alt.mp3';
import cushionHitSfx from '../pool-sounds/cushion_hit.mp3';
import foulDingSfx from '../pool-sounds/foul_ding.mp3';

export type SoundName =
  | 'cueStrike'
  | 'breakShot'
  | 'gameOpening'
  | 'ballCollision'
  | 'ballCollisionAlt'
  | 'cushionHit'
  | 'foulDing';

type AudioPool = {
  clips: HTMLAudioElement[];
  index: number;
  baseVolume: number;
};

function createPool(src: string, volume: number, size: number): AudioPool | null {
  if (typeof Audio === 'undefined') return null;
  const clips: HTMLAudioElement[] = [];
  for (let i = 0; i < size; i++) {
    const clip = new Audio(src);
    clip.preload = 'auto';
    clip.volume = volume;
    clips.push(clip);
  }
  return { clips, index: 0, baseVolume: volume };
}

export class AudioManager {
  private pools: Record<SoundName, AudioPool | null>;
  private unlocked = false;
  private openingSoundPending = false;
  private masterVolume = 0.8;
  lastBallCollisionMs = 0;
  lastCushionHitMs = 0;

  constructor() {
    this.pools = {
      cueStrike: createPool(cueStrikeSfx, 0.5, 1),
      breakShot: createPool(breakShotBigSfx, 0.56, 1),
      gameOpening: createPool(breakShotSmallSfx, 0.42, 1),
      ballCollision: createPool(ballCollisionSfx, 0.33, 2),
      ballCollisionAlt: createPool(ballCollisionAltSfx, 0.3, 2),
      cushionHit: createPool(cushionHitSfx, 0.28, 2),
      foulDing: createPool(foulDingSfx, 0.5, 1)
    };
  }

  play(sound: SoundName, playbackRate = 1, onBlocked?: () => void, volumeScale = 1) {
    const pool = this.pools[sound];
    if (!pool) return;

    const clip = pool.clips[pool.index];
    pool.index = (pool.index + 1) % pool.clips.length;

    clip.currentTime = 0;
    clip.volume = Math.max(0, Math.min(pool.baseVolume * volumeScale * this.masterVolume, 1));
    clip.playbackRate = playbackRate;

    const playback = clip.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => { onBlocked?.(); });
    }
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const pool of Object.values(this.pools)) {
      if (!pool) continue;
      const clip = pool.clips[0];
      const savedVolume = clip.volume;
      clip.volume = 0;
      const p = clip.play();
      if (p) {
        p.then(() => {
          clip.pause();
          clip.currentTime = 0;
          clip.volume = savedVolume;
        }).catch(() => {});
      }
    }
  }

  playOpening() {
    this.openingSoundPending = false;
    this.play('gameOpening', 1, () => {
      this.openingSoundPending = true;
    });
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  get isOpeningPending() { return this.openingSoundPending; }
  set isOpeningPending(v: boolean) { this.openingSoundPending = v; }

  playShot(isBreakShot: boolean, shotPower: number) {
    const playbackRate = 0.96 + Math.random() * 0.08;
    const normalizedPower = Math.max(0, Math.min(shotPower / physicsConfig.MAX_SHOT_POWER, 1));
    const volumeScale = 0.35 + normalizedPower * 0.9;
    this.play(isBreakShot ? 'breakShot' : 'cueStrike', playbackRate, undefined, volumeScale);
  }

  processCollisionEvents(
    eventQueue: RAPIER.EventQueue,
    world: RAPIER.World,
    balls: Ball[]
  ) {
    const ballHandles = new Set(balls.map(b => b.collider.handle));
    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      const h1Ball = ballHandles.has(handle1);
      const h2Ball = ballHandles.has(handle2);
      if (!h1Ball && !h2Ball) return;

      const c1 = world.getCollider(handle1);
      const c2 = world.getCollider(handle2);
      const b1 = c1.parent();
      const b2 = c2.parent();

      if (h1Ball && h2Ball) {
        if (b1 && b2) this.handleBallBallCollision(b1 as unknown as Ball, b2 as unknown as Ball);
        return;
      }

      const h1Fixed = b1?.isFixed() ?? false;
      const h2Fixed = b2?.isFixed() ?? false;
      const isCushion = (h1Ball && h2Fixed) || (h2Ball && h1Fixed);
      if (!isCushion) return;
      const ball = (h1Ball ? b1 : b2) as unknown as Ball | null;
      if (ball) this.handleBallCushionCollision(ball);
    });
  }

  handleBallBallCollision(b1: Ball, b2: Ball) {
    const now = performance.now();
    if (now - this.lastBallCollisionMs < 45) return;
    const v1 = b1.body.linvel(), v2 = b2.body.linvel();
    const rel = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
    const norm = Math.min(rel, 24) / 24;
    const vol = 0.04 + Math.pow(norm, 1.75) * 0.96;
    this.play(Math.random() < 0.5 ? 'ballCollision' : 'ballCollisionAlt', 0.94 + Math.random() * 0.12, undefined, vol);
    this.lastBallCollisionMs = now;
  }

  handleBallCushionCollision(ball: Ball) {
    const now = performance.now();
    if (now - this.lastCushionHitMs < 70) return;
    const bv = ball.body.linvel();
    const spd = Math.hypot(bv.x, bv.y, bv.z);
    const norm = Math.min(spd, 20) / 20;
    const vol = 0.03 + Math.pow(norm, 1.9) * 0.9;
    this.play('cushionHit', 0.95 + Math.random() * 0.1, undefined, vol);
    this.lastCushionHitMs = now;
  }

  destroy() {
    for (const pool of Object.values(this.pools)) {
      if (!pool) continue;
      for (const clip of pool.clips) {
        clip.pause();
        clip.src = '';
      }
    }
  }
}
