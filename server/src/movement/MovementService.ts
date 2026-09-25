import {
  MAX_SIM_DELTA,
  WorldCollision,
  applyMotionScript,
  createMotion,
  createSimEvents,
  createSimParams,
  horizontalSpeed,
  resetMotion,
  sanitiseInput,
  stepPlayer,
  type MotionScript,
  type MoveMessage,
  type PlayerMotion,
  type SimEvents,
  type SimParams,
} from '@arena/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** Simulated seconds a client may bank per real second. */
const MAX_TIME_BUDGET_RATIO = 1.5;
/** Seconds of simulated time a fresh client starts with, to absorb bursts. */
const INITIAL_BUDGET = 0.5;
/** Largest jump in sequence number the server will follow. */
const MAX_SEQ_JUMP = 600;
/** A client silent this long is stepped by the server with no input, so nobody hangs in the air. */
const IDLE_AFTER = 0.25;

export type RejectReason = 'malformed' | 'stale-seq' | 'seq-jump' | 'budget';

interface Sim {
  motion: PlayerMotion;
  events: SimEvents;
  params: SimParams;
  lastSeq: number;
  budget: number;
  lastRefill: number;
  lastInput: number;
}

/** What the room decides about an input's attack/ability press, before the step: a script and a facing, or refused. */
export type ActHandler = (act: number, aim: number, motion: PlayerMotion) => { script: MotionScript; yaw: number } | null;

const IDLE_INPUT = sanitiseInput({});

/**
 * Server-authoritative movement.
 *
 * The client sends INPUT and nothing else; this runs the shared simulation and
 * the result becomes the player's transform and every motion timer. The same
 * `stepPlayer` runs on the client for prediction. An attack press is handed to
 * the room BEFORE the step; if the room accepts it, the ability's motion script
 * is applied at that exact input, which is exactly where the client applied it.
 */
export class MovementService {
  private readonly sims = new Map<string, Sim>();
  readonly collision = new WorldCollision();

  private lastReject: RejectReason | null = null;

  initialise(player: PlayerState): void {
    const sim: Sim = {
      motion: createMotion(),
      events: createSimEvents(),
      params: createSimParams(),
      lastSeq: 0,
      budget: INITIAL_BUDGET,
      lastRefill: Date.now(),
      lastInput: Date.now(),
    };
    this.sims.set(player.sessionId, sim);
    this.publish(player);
  }

  has(sessionId: string): boolean {
    return this.sims.has(sessionId);
  }

  forget(sessionId: string): void {
    this.sims.delete(sessionId);
  }

  motion(sessionId: string): PlayerMotion | null {
    return this.sims.get(sessionId)?.motion ?? null;
  }

  get rejectReason(): RejectReason | null {
    return this.lastReject;
  }

  /** Teleport authoritatively. Only the server calls this. */
  teleport(player: PlayerState, x: number, y: number, z: number, yaw: number): void {
    const sim = this.sims.get(player.sessionId);
    if (!sim) return;
    resetMotion(sim.motion, x, y, z, yaw);
    this.publish(player);
  }

  /** Consume one input and advance the authoritative simulation. */
  applyInput(player: PlayerState, message: MoveMessage, onAct: ActHandler): SimEvents | null {
    this.lastReject = null;
    const sim = this.sims.get(player.sessionId);
    if (!sim) return null;

    const seq = message?.seq;
    const dt = message?.dt;
    if (typeof seq !== 'number' || !Number.isFinite(seq) || typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      this.lastReject = 'malformed';
      return null;
    }
    if (seq <= sim.lastSeq) {
      this.lastReject = 'stale-seq';
      return null;
    }
    if (seq > sim.lastSeq + MAX_SEQ_JUMP) {
      this.lastReject = 'seq-jump';
      return null;
    }

    const step = Math.min(dt, MAX_SIM_DELTA);
    this.refill(sim);
    if (step > sim.budget) {
      this.lastReject = 'budget';
      return null;
    }
    sim.budget -= step;
    sim.lastSeq = seq;
    sim.lastInput = Date.now();

    // The SERVER's figures, every step.
    sim.params.moveSpeed = player.moveSpeed;
    sim.params.dashCdMul = player.dashCdMul;

    const act = typeof message.act === 'number' ? Math.floor(message.act) : 0;
    if (act >= 1 && act <= 3) {
      const aim = Number.isFinite(message.aim) ? Number(message.aim) : sim.motion.yaw;
      const cast = onAct(act, aim, sim.motion);
      if (cast) applyMotionScript(sim.motion, cast.script, cast.yaw);
    }

    const input = sanitiseInput(message);
    if (player.dead) {
      input.moveX = 0;
      input.moveZ = 0;
      input.jump = false;
      input.dash = false;
    }
    stepPlayer(sim.motion, input, sim.params, step, this.collision, sim.events);
    this.publish(player);
    return sim.events;
  }

  /**
   * Step a player whose client has gone quiet (a hidden tab), with no input,
   * so a launched player still flies and falls. Returns the events, or null.
   */
  idle(player: PlayerState, delta: number): SimEvents | null {
    const sim = this.sims.get(player.sessionId);
    if (!sim) return null;
    if ((Date.now() - sim.lastInput) / 1000 < IDLE_AFTER) return null;
    sim.params.moveSpeed = player.moveSpeed;
    sim.params.dashCdMul = player.dashCdMul;
    stepPlayer(sim.motion, IDLE_INPUT, sim.params, Math.min(delta, MAX_SIM_DELTA), this.collision, sim.events);
    this.publish(player);
    return sim.events;
  }

  /** Copy the simulation into the replicated state. */
  publish(player: PlayerState): void {
    const sim = this.sims.get(player.sessionId);
    if (!sim) return;
    const m = sim.motion;
    player.x = m.x;
    player.y = m.y;
    player.z = m.z;
    player.rotationY = m.yaw;
    player.velocityX = m.vx;
    player.velocityY = m.vy;
    player.velocityZ = m.vz;
    player.speed = horizontalSpeed(m);
    player.grounded = m.grounded;
    player.stun = m.stun;
    player.lock = m.lock;
    player.slow = m.slow;
    player.dashCd = m.dashCd;
    player.lungeT = m.lungeT;
    player.lvx = m.lvx;
    player.lvy = m.lvy;
    player.lvz = m.lvz;
    player.lgrav = m.lgrav;
    player.pendT = m.pendT;
    player.pendKind = m.pendKind;
    player.pendSpeed = m.pendSpeed;
    player.pendTime = m.pendTime;
    player.pendUp = m.pendUp;
    player.pendGrav = m.pendGrav;
    player.pendYaw = m.pendYaw;
    player.pendSlam = m.pendSlam;
    player.slam = m.slam;
    player.lastInputSeq = sim.lastSeq;
    player.ready = true;
  }

  private refill(sim: Sim): void {
    const now = Date.now();
    const elapsed = Math.max(0, (now - sim.lastRefill) / 1000);
    sim.lastRefill = now;
    sim.budget = Math.min(sim.budget + elapsed * MAX_TIME_BUDGET_RATIO, MAX_SIM_DELTA * 20);
  }
}
