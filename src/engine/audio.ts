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
  ): { cueBallHitObjectBall: boolean } {
    const ballHandles = new Set(balls.map(b => b.collider.handle));
    const cueBallHandle = balls.find(b => b.type === 'cue')?.collider.handle;
    let cueBallHitObjectBall = false;

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      const h1Ball = ballHandles.has(handle1);
      const h2Ball = ballHandles.has(handle2);
      if (!h1Ball && !h2Ball) return;

      const now = performance.now();
      const c1 = world.getCollider(handle1);
      const c2 = world.getCollider(handle2);
      const b1 = c1.parent();
      const b2 = c2.parent();

      if (h1Ball && h2Ball) {
        // Detect cue ball hitting an object ball
        if (cueBallHandle !== undefined &&
            (handle1 === cueBallHandle || handle2 === cueBallHandle)) {
          cueBallHitObjectBall = true;
        }

        if (now - this.lastBallCollisionMs < 45) return;
        const v1 = b1?.linvel(), v2 = b2?.linvel();
        const rel = v1 && v2 ? Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z) : 0;
        const norm = Math.min(rel, 24) / 24;
        const vol = 0.04 + Math.pow(norm, 1.75) * 0.96;
        this.play(Math.random() < 0.5 ? 'ballCollision' : 'ballCollisionAlt', 0.94 + Math.random() * 0.12, undefined, vol);
        this.lastBallCollisionMs = now;
        return;
      }

      const h1Fixed = c1.parent()?.isFixed() ?? false;
      const h2Fixed = c2.parent()?.isFixed() ?? false;
      const isCushion = (h1Ball && h2Fixed) || (h2Ball && h1Fixed);
      if (!isCushion || now - this.lastCushionHitMs < 70) return;

      const bv = h1Ball ? b1?.linvel() : b2?.linvel();
      const spd = bv ? Math.hypot(bv.x, bv.y, bv.z) : 0;
      const norm = Math.min(spd, 20) / 20;
      const vol = 0.03 + Math.pow(norm, 1.9) * 0.9;
      this.play('cushionHit', 0.95 + Math.random() * 0.1, undefined, vol);
      this.lastCushionHitMs = now;
    });

    return { cueBallHitObjectBall };
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
