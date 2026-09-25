import {
  WorldCollision,
  applyMotionScript,
  copyMotion,
  createMotion,
  createSimEvents,
  createSimParams,
  horizontalSpeed,
  resetMotion,
  stepPlayer,
  type MotionScript,
  type MoveMessage,
  type MovementInput,
  type PlayerMotion,
  type SimParams,
} from '@arena/shared';
import { Vector3 } from 'three';
import type { ActionClip } from '../animation/ActionClips.js';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import type { InputState } from '../input/InputState.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { NamePlate } from './NamePlate.js';
import { PlayerCharacter } from './PlayerCharacter.js';

const MAX_PENDING_INPUTS = 240;
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const SNAP_DISTANCE = 5;
const CORRECTION_RATE = 14;

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;
const EMPTY_INPUTS: MoveMessage[] = [];

export type PlacementKind = 'none' | 'respawn' | 'correction';

/** An attack/ability press riding one input: its slot, aim, and the motion predicted for it. */
export interface PendingAct {
  readonly act: number;
  readonly aim: number;
  /** The motion script predicted locally, or null when the move is server-driven. */
  readonly script: MotionScript | null;
}

interface PendingInput {
  seq: number;
  dt: number;
  input: MovementInput;
  act: PendingAct | null;
}

/**
 * The locally controlled player: a PREDICTION of a server-owned simulation.
 *
 * Runs the identical `stepPlayer` against the same world, keeps every input the
 * server has not acknowledged, and on each server update snaps to the
 * authoritative motion - EVERY field, stun and lunge timers included - and
 * replays them. So a knockback the server applied lands here, and an ability's
 * lunge the player pressed plays at once and replays at the same input.
 */
export class LocalPlayer {
  readonly character: PlayerCharacter;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly plate = new NamePlate();

  private readonly previous = { x: 0, y: 0, z: 0 };
  private readonly motion: PlayerMotion = createMotion();
  private readonly events = createSimEvents();
  private readonly replayEvents = createSimEvents();
  private readonly collision: WorldCollision;
  private readonly params: SimParams = createSimParams();

  private readonly pending: PendingInput[] = [];
  private nextSeq = 1;
  private readonly outgoing: MoveMessage[] = [];
  private accumulator = 0;
  private readonly correction = new Vector3();
  private placement: PlacementKind = 'none';
  private turnSignal = 0;
  private readonly animationInput: AnimationInput = createAnimationInput();

  private queuedAct: PendingAct | null = null;
  private queuedDash = false;
  private action: ActionClip | null = null;
  private actionTime = 0;
  private actionDuration = 1;
  private dead = false;

  landedEdge = false;
  jumpedEdge = false;
  dashedEdge = false;

  constructor(collision: WorldCollision) {
    this.collision = collision;
    this.character = new PlayerCharacter();
    this.character.root.add(this.plate.sprite);
    this.previous.x = this.motion.x;
    this.previous.y = this.motion.y;
    this.previous.z = this.motion.z;
    this.syncFromMotion();
    this.syncCharacter();
  }

  get horizontalSpeed(): number {
    return horizontalSpeed(this.motion);
  }

  get isGrounded(): boolean {
    return this.motion.grounded;
  }

  get yaw(): number {
    return this.motion.yaw;
  }

  /** Predicted seconds of ragdoll left. */
  get stun(): number {
    return this.motion.stun;
  }

  /** Predicted: rooted by a cast. */
  get locked(): boolean {
    return this.motion.lock > 0;
  }

  get dashCooldown(): number {
    return this.motion.dashCd;
  }

  get isDead(): boolean {
    return this.dead;
  }

  drainOutgoing(): MoveMessage[] {
    if (this.outgoing.length === 0) return EMPTY_INPUTS;
    const batch = this.outgoing.slice();
    this.outgoing.length = 0;
    return batch;
  }

  /** Server-owned tuning (buffs). */
  setParams(moveSpeed: number, dashCdMul: number): void {
    if (Number.isFinite(moveSpeed) && moveSpeed > 0) this.params.moveSpeed = moveSpeed;
    if (Number.isFinite(dashCdMul) && dashCdMul > 0) this.params.dashCdMul = dashCdMul;
  }

  setDead(dead: boolean): void {
    this.dead = dead;
  }

  setDisplayName(displayName: string, avatarUrl: string): void {
    this.plate.set(displayName, avatarUrl, this.character.height);
  }

  /** Queue an attack/ability press for the next simulated input. */
  cast(act: PendingAct): void {
    this.queuedAct = act;
  }

  requestDash(): void {
    this.queuedDash = true;
  }

  /** Play an attack/ability animation now. */
  playAction(clip: ActionClip, duration: number): void {
    this.action = clip;
    this.actionTime = 0;
    this.actionDuration = duration;
  }

  teleport(x: number, y: number, z: number, rotationY: number): void {
    resetMotion(this.motion, x, y, z, rotationY);
    this.previous.x = x;
    this.previous.y = y;
    this.previous.z = z;
    this.pending.length = 0;
    this.outgoing.length = 0;
    this.accumulator = 0;
    this.queuedAct = null;
    this.queuedDash = false;
    this.action = null;
    this.correction.set(0, 0, 0);
    this.placement = 'respawn';
    this.character.resetAnimation();
    this.syncFromMotion();
    this.syncCharacter();
  }

  reconcile(state: NetPlayerState): void {
    const predictedX = this.motion.x;
    const predictedY = this.motion.y;
    const predictedZ = this.motion.z;

    const m = this.motion;
    m.x = state.x;
    m.y = state.y;
    m.z = state.z;
    m.vx = state.velocityX;
    m.vy = state.velocityY;
    m.vz = state.velocityZ;
    m.yaw = state.rotationY;
    m.grounded = state.grounded;
    m.stun = state.stun;
    m.lock = state.lock;
    m.slow = state.slow;
    m.dashCd = state.dashCd;
    m.lungeT = state.lungeT;
    m.lvx = state.lvx;
    m.lvy = state.lvy;
    m.lvz = state.lvz;
    m.lgrav = state.lgrav;
    m.pendT = state.pendT;
    m.pendKind = state.pendKind;
    m.pendSpeed = state.pendSpeed;
    m.pendTime = state.pendTime;
    m.pendUp = state.pendUp;
    m.pendGrav = state.pendGrav;
    m.pendYaw = state.pendYaw;
    m.pendSlam = state.pendSlam;
    m.slam = state.slam;

    let kept = 0;
    for (const entry of this.pending) {
      if (entry.seq <= state.lastInputSeq) continue;
      this.pending[kept] = entry;
      kept += 1;
    }
    this.pending.length = kept;
    for (const entry of this.pending) {
      if (entry.act?.script) applyMotionScript(m, entry.act.script, entry.act.aim);
      stepPlayer(m, entry.input, this.params, entry.dt, this.collision, this.replayEvents);
    }

    const dx = predictedX - m.x;
    const dy = predictedY - m.y;
    const dz = predictedZ - m.z;
    const snapped = Math.hypot(dx, dy, dz) > SNAP_DISTANCE;
    this.correction.set(snapped ? 0 : dx, snapped ? 0 : dy, snapped ? 0 : dz);
    if (snapped) {
      this.previous.x = m.x;
      this.previous.y = m.y;
      this.previous.z = m.z;
      if (this.placement === 'none') this.placement = 'correction';
    }
    this.syncFromMotion();
    this.syncCharacter();
  }

  update(delta: number, input: Readonly<InputState>, cameraYaw: number): void {
    this.landedEdge = false;
    this.jumpedEdge = false;
    this.dashedEdge = false;
    this.accumulator += Math.max(0, delta);
    this.turnSignal = input.moveX;
    if (input.dash) this.queuedDash = true;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps += 1;
      const dead = this.dead;
      const movement: MovementInput = {
        moveX: dead ? 0 : input.moveX,
        moveZ: dead ? 0 : input.moveZ,
        cameraYaw,
        jump: !dead && input.jump,
        dash: !dead && this.queuedDash,
      };
      this.queuedDash = false;
      const act = this.queuedAct;
      this.queuedAct = null;
      const seq = this.nextSeq;
      this.nextSeq += 1;
      this.previous.x = this.motion.x;
      this.previous.y = this.motion.y;
      this.previous.z = this.motion.z;
      if (act?.script) applyMotionScript(this.motion, act.script, act.aim);
      stepPlayer(this.motion, movement, this.params, FIXED_DT, this.collision, this.events);
      this.landedEdge ||= this.events.landed;
      this.jumpedEdge ||= this.events.jumped;
      this.dashedEdge ||= this.events.dashed;
      this.pending.push({ seq, dt: FIXED_DT, input: movement, act });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
      const message: MoveMessage = { seq, dt: FIXED_DT, moveX: movement.moveX, moveZ: movement.moveZ, cameraYaw };
      if (movement.jump) message.jump = true;
      if (movement.dash) message.dash = true;
      if (act) {
        message.act = act.act;
        message.aim = act.aim;
      }
      this.outgoing.push(message);
    }
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    if (this.action) {
      this.actionTime += delta;
      if (this.actionTime >= this.actionDuration) this.action = null;
    }

    this.decayCorrection(delta);
    this.syncFromMotion();
    this.syncCharacter();
    this.updateAnimation(delta);
  }

  consumePlacement(): PlacementKind {
    const kind = this.placement;
    this.placement = 'none';
    return kind;
  }

  readMotion(into: PlayerMotion): void {
    copyMotion(this.motion, into);
  }

  private decayCorrection(delta: number): void {
    if (this.correction.lengthSq() < 1e-8) {
      this.correction.set(0, 0, 0);
      return;
    }
    this.correction.multiplyScalar(Math.exp(-CORRECTION_RATE * delta));
  }

  private syncFromMotion(): void {
    const alpha = Math.min(Math.max(this.accumulator / FIXED_DT, 0), 1);
    this.position.set(
      lerp(this.previous.x, this.motion.x, alpha) + this.correction.x,
      lerp(this.previous.y, this.motion.y, alpha) + this.correction.y,
      lerp(this.previous.z, this.motion.z, alpha) + this.correction.z,
    );
    this.velocity.set(this.motion.vx, this.motion.vy, this.motion.vz);
  }

  private updateAnimation(delta: number): void {
    const a = this.animationInput;
    a.grounded = this.motion.grounded;
    a.horizontalSpeed = this.horizontalSpeed;
    a.verticalVelocity = this.motion.vy;
    a.turn = this.turnSignal;
    a.landed = this.landedEdge;
    a.stun = this.motion.stun;
    a.dead = this.dead;
    a.lunging = this.motion.lungeT > 0;
    a.action = this.motion.stun > 0 ? null : this.action;
    a.actionTime = this.actionTime;
    a.actionDuration = this.actionDuration;
    this.character.update(delta, a);
  }

  private syncCharacter(): void {
    this.character.setPosition(this.position.x, this.position.y, this.position.z);
    this.character.root.rotation.y = this.motion.yaw;
  }
}
