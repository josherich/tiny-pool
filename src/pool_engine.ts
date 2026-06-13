import type RAPIER from '@dimforge/rapier3d-compat';
import {
  physicsConfig,
  SCALE,
  FIXED_DT,
  createWorld,
  setupTable,
  setupBalls,
  checkPockets,
  applyRollingFriction,
  computeSubSteps,
  syncPhysicsConfig,
  clonePocketed,
  getTableBounds,
  type Ball,
  type Pocket,
  type Pocketed,
  type PocketedThisShot
} from './pool_physics';
import { createDebugUI, setupTripleSlashToggle, type DebugUI } from './debug_ui';
import { allBallsStopped, canShoot, evaluateTurnSwitch, evaluateGameOver, isValidBallPlacement } from './pool_rules';
import {
  type ShotInput,
  type GameMessage,
  type GameStateSnapshot,
  serializeBalls,
  hashGameState,
  restoreBallStates
} from './pool_sync';
import { AudioManager } from './engine/audio';
import { NetworkManager } from './engine/networking';
import { InputHandler } from './engine/input';
import { PoolRenderer, type PocketingAnimation } from './engine/renderer';
import { isWithinCueSpinControl, computeCueSpinOffset } from './engine/cue_spin';
import { type GameSettings } from './settings';

class PoolGameEngine {
  canvas: HTMLCanvasElement;
  mode: string;
  RAPIER: typeof RAPIER;
  callbacks: any;
  world: RAPIER.World | null = null;
  balls: Ball[] = [];
  cushionBodies: RAPIER.RigidBody[] = [];
  currentPlayer = 1;
  aiming = false;
  aimAngle = 0;
  power = 0;
  powerIncreasing = false;
  powerDirection = 1;
  gameStarted = false;
  pocketed: Pocketed = { solids: [], stripes: [], eight: false };
  playerTypes: { player1: string | null; player2: string | null } = { player1: null, player2: null };
  isMyTurn = true;
  animationId: number | null = null;
  pockets: Pocket[] = [];
  shotInProgress = false;
  pocketedThisShot: PocketedThisShot = { solids: [], stripes: [], cueBall: false };
  pocketingAnimations: PocketingAnimation[] = [];
  isHost = true;
  accumulator = 0;
  lastTime = 0;
  lastHash: string | null = null;
  lastSnapshot: GameStateSnapshot | null = null;
  pendingPeerHash: string | null = null;
  ballInHand = false;
  debugUI: DebugUI | null = null;
  cleanupTripleSlash: (() => void) | null = null;
  cueSpinOffset = { x: 0, y: 0 };
  draggingCueSpin = false;
  cueControlExpanded = false;
  eventQueue: RAPIER.EventQueue | null = null;
  mobileTouchControlsEnabled: boolean;
  private audio: AudioManager;
  private network: NetworkManager;
  private input: InputHandler;
  private renderer: PoolRenderer;
  private joinCode: string | null;

  constructor(canvas: HTMLCanvasElement, mode: string, rapier: typeof RAPIER, callbacks: any) {
    this.canvas = canvas;
    this.mode = mode;
    this.RAPIER = rapier;
    this.callbacks = callbacks;
    this.joinCode = callbacks.joinCode || null;
    this.mobileTouchControlsEnabled = Boolean(callbacks.mobileTouchControlsEnabled);

    this.audio = new AudioManager();

    this.network = new NetworkManager({
      onConnectionStateChange: callbacks.onConnectionStateChange,
      onRoomCodeGenerated: callbacks.onRoomCodeGenerated,
      onGameMessage: (msg) => this.handleGameMessage(msg)
    });

    this.input = new InputHandler(canvas, {
      canShoot: () => this.canShoot(),
      getBalls: () => this.balls,
      getAimAngle: () => this.aimAngle,
      setAimAngle: (angle) => { this.aimAngle = angle; },
      isAiming: () => this.aiming,
      isBallInHand: () => this.ballInHand,
      isCueControlExpanded: () => this.cueControlExpanded,
      setCueControlExpanded: (v) => { this.cueControlExpanded = v; },
      isWithinCueSpinControl: (x, y, expanded) => isWithinCueSpinControl(x, y, this.canvas.width, this.canvas.height, expanded),
      updateCueSpinOffset: (x, y, expanded) => { this.cueSpinOffset = computeCueSpinOffset(x, y, this.canvas.width, this.canvas.height, expanded); },
      isDraggingCueSpin: () => this.draggingCueSpin,
      setDraggingCueSpin: (v) => { this.draggingCueSpin = v; },
      startPowerShot: () => this.startPowerShot(),
      releasePowerShot: () => this.releasePowerShot(),
      cancelPowerShot: () => this.cancelPowerShot(),
      onEscapePressed: () => this.callbacks.onEscapePressed?.(),
      placeBallInHand: () => this.placeBallInHand(),
      unlockAudio: () => this.audio.unlock(),
      onOpeningSoundCheck: () => {
        if (this.audio.isOpeningPending) this.audio.playOpening();
      },
      mobileTouchControlsEnabled: this.mobileTouchControlsEnabled
    });

    this.renderer = new PoolRenderer(canvas);

    if (callbacks.initialSettings) {
      this.audio.setMasterVolume(callbacks.initialSettings.sfxVolume);
      this.renderer.setTheme(callbacks.initialSettings.tableTheme);
      this.renderer.setAimLineLength(callbacks.initialSettings.aimLineLength);
    }
  }

  init() {
    this.world = createWorld(this.RAPIER);
    this.eventQueue = new this.RAPIER.EventQueue(true);

    if (!this.world) return;
    const { pockets, cushionBodies } = setupTable({
      canvas: this.canvas,
      world: this.world,
      RAPIER: this.RAPIER
    });
    this.pockets = pockets;
    this.cushionBodies = cushionBodies;
    this.balls = setupBalls({ canvas: this.canvas, world: this.world, RAPIER: this.RAPIER });
    this.input.attach();

    this.debugUI = createDebugUI();
    this.cleanupTripleSlash = setupTripleSlashToggle(() => {
      this.debugUI?.toggle();
    });

    if (this.mode === 'online' && !this.joinCode) {
      this.network.setupAsHost();
    } else if (this.mode === 'online' && this.joinCode) {
      this.isHost = false;
      this.isMyTurn = false;
      this.network.joinRoom(this.joinCode);
    }

    this.audio.isOpeningPending = true;
    this.audio.playOpening();
    this.gameLoop();
  }

  private handleGameMessage(message: GameMessage) {
    switch (message.type) {
      case 'shot':
        this.applyShot(message.input);
        break;

      case 'state_hash':
        if (this.shotInProgress) {
          this.pendingPeerHash = message.hash;
        } else {
          this.handleStateHashComparison(message.hash);
        }
        break;

      case 'state_sync':
        if (!this.isHost && this.world) {
          this.balls = restoreBallStates(this.world, this.balls, message.snapshot, this.RAPIER);
          this.pocketed = clonePocketed(message.snapshot.pocketed);
        }
        break;

      case 'turn':
        if (!this.isHost) {
          this.currentPlayer = message.state.currentPlayer;
          this.playerTypes = { ...message.state.playerTypes };
          this.pocketed = clonePocketed(message.state.pocketed);
          this.isMyTurn = this.currentPlayer === 2;
        }
        break;

      case 'game_over':
        this.callbacks.onGameOver?.({ winner: message.winner, reason: message.reason });
        break;

      case 'ball_in_hand_place': {
        const cueBall = this.balls.find(b => b.type === 'cue');
        if (cueBall) {
          const physRadius = getTableBounds().ballRadius;
          cueBall.body.setTranslation({ x: message.position.x, y: physRadius, z: message.position.z }, true);
          cueBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          cueBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        this.ballInHand = false;
        break;
      }
    }
  }

  private handleStateHashComparison(peerHash: string) {
    if (!this.lastHash) return;
    if (this.lastHash !== peerHash) {
      console.warn('State hash mismatch!', this.lastHash, 'vs', peerHash);
      if (this.isHost && this.lastSnapshot) {
        // Host is authoritative — send corrective snapshot to guest
        this.network.send({ type: 'state_sync', snapshot: this.lastSnapshot });
      } else if (!this.isHost) {
        // Guest detected mismatch from host's hash — send own hash back
        // so the host can also detect the mismatch and send state_sync
        this.network.send({ type: 'state_hash', hash: this.lastHash });
      }
    }
  }

  canShoot(): boolean {
    if (this.ballInHand) return false;
    return canShoot({ mode: this.mode, isMyTurn: this.isMyTurn, balls: this.balls });
  }

  private getTableBounds() {
    return getTableBounds();
  }

  private placeBallInHand() {
    if (!this.ballInHand) return;
    if (this.mode === 'online' && !this.isMyTurn) return;

    const physX = this.input.mousePos.x / SCALE;
    const physZ = this.input.mousePos.y / SCALE;
    const bounds = this.getTableBounds();

    const ballPositions = this.balls
      .filter(b => b.type !== 'cue')
      .map(b => {
        const pos = b.body.translation();
        return { x: pos.x, z: pos.z };
      });

    if (!isValidBallPlacement({ physX, physZ, ballPositions, ...bounds })) return;

    const cueBall = this.balls.find(b => b.type === 'cue');
    if (!cueBall) return;

    cueBall.body.setTranslation({ x: physX, y: bounds.ballRadius, z: physZ }, true);
    cueBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    cueBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballInHand = false;

    if (this.mode === 'online') {
      this.network.send({ type: 'ball_in_hand_place', position: { x: physX, z: physZ } });
    }
  }

  private startPowerShot() {
    if (this.ballInHand) return;
    if (this.canShoot()) {
      this.aiming = true;
      this.power = 0;
      this.powerIncreasing = true;
      this.powerDirection = 1;
    }
  }

  private releasePowerShot() {
    if (this.aiming && this.canShoot()) {
      this.shoot();
    }
    this.aiming = false;
    this.powerIncreasing = false;
  }

  cancelPowerShot() {
    this.aiming = false;
    this.powerIncreasing = false;
    this.power = 0;
  }

  beginTouchPowerControl(): boolean {
    if (this.ballInHand) return false;
    if (!this.canShoot()) return false;
    this.input.touchAimDragActive = false;
    this.aiming = true;
    this.powerIncreasing = false;
    return true;
  }

  setTouchPowerRatio(ratio: number) {
    if (!this.beginTouchPowerControl()) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    this.power = clamped * physicsConfig.MAX_SHOT_POWER;
  }

  shootFromTouchControl() {
    const shouldShoot = this.aiming && this.power > 0.001 && this.canShoot();
    if (shouldShoot) {
      this.shoot();
    }
    this.cancelPowerShot();
  }

  adjustAim(deltaRadians: number) {
    if (!this.canShoot() || this.aiming) return;
    this.aimAngle = Math.atan2(
      Math.sin(this.aimAngle + deltaRadians),
      Math.cos(this.aimAngle + deltaRadians)
    );
  }

  updateSettings(settings: GameSettings) {
    this.audio.setMasterVolume(settings.sfxVolume);
    this.renderer.setTheme(settings.tableTheme);
    this.renderer.setAimLineLength(settings.aimLineLength);
  }

  private shoot() {
    const cueBall = this.balls.find(b => b.type === 'cue');
    if (!cueBall) return;

    const input: ShotInput = {
      angle: this.aimAngle,
      power: this.power,
      topspin: -this.cueSpinOffset.y * 0.5,
      sidespin: this.cueSpinOffset.x * 0.5
    };

    if (this.mode === 'online') {
      this.network.send({ type: 'shot', input });
    }

    this.applyShot(input);
    this.cueSpinOffset = { x: 0, y: 0 };
    this.cueControlExpanded = false;
  }

  private applyShot(input: ShotInput) {
    const cueBall = this.balls.find(b => b.type === 'cue');
    if (!cueBall) return;

    const isBreakShot = !this.gameStarted;
    this.audio.playShot(isBreakShot, input.power);
    this.shotInProgress = true;
    this.pocketedThisShot = { solids: [], stripes: [], cueBall: false };

    // Zero out any residual velocity before applying shot impulse
    cueBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    cueBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    const impulseStrength = input.power * 8;
    const impulseX = Math.cos(input.angle) * impulseStrength;
    const impulseZ = Math.sin(input.angle) * impulseStrength;

    cueBall.body.applyImpulse({ x: impulseX, y: 0, z: impulseZ }, true);
    cueBall.body.applyTorqueImpulse({
      x: -impulseZ * input.topspin,
      y: impulseStrength * input.sidespin,
      z: impulseX * input.topspin
    }, true);

    this.gameStarted = true;
  }

  private checkPockets() {
    if (!this.world) return;
    const pocketedEvents = checkPockets({
      world: this.world,
      canvas: this.canvas,
      balls: this.balls,
      pockets: this.pockets,
      pocketed: this.pocketed,
      pocketedThisShot: this.pocketedThisShot,
      RAPIER: this.RAPIER
    });

    const now = performance.now();
    pocketedEvents.forEach((event) => {
      this.pocketingAnimations.push({ ...event, startTime: now, duration: 250 });
    });
  }

  private gameLoop(currentTime: number = performance.now()) {
    if (!this.world) return;

    if (this.lastTime === 0) this.lastTime = currentTime;
    const frameTime = Math.min((currentTime - this.lastTime) / 1000, 0.05);
    this.lastTime = currentTime;

    syncPhysicsConfig(this.balls, this.cushionBodies);

    this.accumulator += frameTime;

    while (this.accumulator >= FIXED_DT) {
      // Adaptive sub-stepping: subdivide when balls are fast so no ball
      // moves more than ~25% of its diameter per sub-step.
      const subSteps = computeSubSteps(this.balls, FIXED_DT);
      const subDt = FIXED_DT / subSteps;
      this.world.timestep = subDt;

      for (let s = 0; s < subSteps; s++) {
        this.world.step(this.eventQueue || undefined);
        if (this.eventQueue) this.audio.processCollisionEvents(this.eventQueue, this.world, this.balls);
        this.checkPockets();
      }
      applyRollingFriction(this.balls, FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    if (this.shotInProgress && allBallsStopped(this.balls)) {
      this.onShotSettled();
    }

    if (this.aiming && this.powerIncreasing) {
      const step = 0.01 * physicsConfig.MAX_SHOT_POWER;
      this.power += step * this.powerDirection;
      if (this.power >= physicsConfig.MAX_SHOT_POWER) {
        this.power = physicsConfig.MAX_SHOT_POWER;
        this.powerDirection = -1;
      } else if (this.power <= 0) {
        this.power = 0;
        this.powerDirection = 1;
      }
    }

    this.renderer.render({
      balls: this.balls,
      pockets: this.pockets,
      pocketed: this.pocketed,
      currentPlayer: this.currentPlayer,
      playerTypes: this.playerTypes,
      aiming: this.aiming,
      aimAngle: this.aimAngle,
      power: this.power,
      ballInHand: this.ballInHand,
      mousePos: this.input.mousePos,
      canShoot: this.canShoot(),
      cueSpinOffset: this.cueSpinOffset,
      cueControlExpanded: this.cueControlExpanded,
      pocketingAnimations: this.pocketingAnimations,
      mode: this.mode,
      isMyTurn: this.isMyTurn
    });

    this.animationId = requestAnimationFrame((t) => this.gameLoop(t));
  }

  private onShotSettled() {
    this.shotInProgress = false;

    // In online mode, only the host is authoritative for turn logic.
    // The guest defers to the host's "turn" message to avoid race conditions
    // where the guest's local evaluateTurnSwitch overwrites the host's state.
    if (this.mode === 'online' && !this.isHost) {
      if (this.pocketedThisShot.cueBall) {
        this.ballInHand = true;
        this.audio.play('foulDing');
      }

      const snapshot: GameStateSnapshot = {
        balls: serializeBalls(this.balls),
        pocketed: clonePocketed(this.pocketed)
      };
      const hash = hashGameState(snapshot);
      this.lastHash = hash;

      // Send hash to host so it can detect mismatches and send corrections
      this.network.send({ type: 'state_hash', hash });

      if (this.pendingPeerHash) {
        this.handleStateHashComparison(this.pendingPeerHash);
        this.pendingPeerHash = null;
      }

      return;
    }

    const result = evaluateTurnSwitch({
      currentPlayer: this.currentPlayer,
      mode: this.mode,
      isMyTurn: this.isMyTurn,
      playerTypes: this.playerTypes,
      pocketedThisShot: this.pocketedThisShot
    });
    this.playerTypes = result.playerTypes;
    this.currentPlayer = result.currentPlayer;
    this.isMyTurn = result.isMyTurn;

    if (this.pocketedThisShot.cueBall) {
      this.ballInHand = true;
      this.audio.play('foulDing');
    }

    if (this.mode === 'online') {
      const snapshot: GameStateSnapshot = {
        balls: serializeBalls(this.balls),
        pocketed: clonePocketed(this.pocketed)
      };
      const hash = hashGameState(snapshot);
      this.lastSnapshot = snapshot;
      this.lastHash = hash;

      this.network.send({ type: 'state_hash', hash });
      this.network.send({
        type: 'turn',
        state: {
          currentPlayer: this.currentPlayer,
          playerTypes: { ...this.playerTypes },
          pocketed: clonePocketed(this.pocketed)
        }
      });

      if (this.pendingPeerHash) {
        this.handleStateHashComparison(this.pendingPeerHash);
        this.pendingPeerHash = null;
      }
    }

    const gameOverResult = evaluateGameOver({
      currentPlayer: this.currentPlayer,
      playerTypes: this.playerTypes,
      pocketed: this.pocketed
    });

    if (gameOverResult) {
      if (this.mode === 'online') {
        this.network.send({
          type: 'game_over',
          winner: gameOverResult.winner,
          reason: gameOverResult.reason
        });
      }
      this.callbacks.onGameOver?.({
        winner: gameOverResult.winner,
        reason: gameOverResult.reason
      });
    }
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.input.detach();
    if (this.eventQueue) { this.eventQueue.free(); this.eventQueue = null; }
    if (this.world) { this.world.free(); this.world = null; }
    this.network.destroy();
    if (this.debugUI) { this.debugUI.destroy(); this.debugUI = null; }
    if (this.cleanupTripleSlash) { this.cleanupTripleSlash(); this.cleanupTripleSlash = null; }
    this.audio.destroy();
  }
}

export default PoolGameEngine;
