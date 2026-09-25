import { DASH, MOVEMENT } from '../config/movement.js';
import { SPAWN } from '../config/map.js';
import { rotateTowards } from '../types/math.js';
import type { WorldCollision } from './WorldCollision.js';

/**
 * THE movement simulation, shared by the server and by client prediction.
 *
 * The server runs it to own the result and the client runs the identical
 * function to predict ahead of the network, so the two can only disagree
 * through inputs, never through maths.
 *
 * Beyond walking it carries every movement the combat needs, as plain numbers
 * so a reconciliation can copy them: the JUMP, the DASH, ability MOTION SCRIPTS
 * (lunges, leaps, blinks and roots, applied at a known input so they replay
 * identically), and the STUN a hit leaves behind - while stunned the player
 * is a ragdoll: no input is read, they fly on the knockback and skid to a stop.
 */

export interface PlayerMotion {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Seconds of ragdoll left: input ignored. */
  stun: number;
  /** Seconds rooted by one's own ability: no walking, jumping or dashing. */
  lock: number;
  /** Seconds walking at reduced speed (a mobile channel). */
  slow: number;
  dashCd: number;
  /** An active lunge: velocity held for `lungeT` seconds. */
  lungeT: number;
  lvx: number;
  lvy: number;
  lvz: number;
  /** Gravity scale during the lunge; 0 holds `lvy`. */
  lgrav: number;
  /** A queued impulse: fires when `pendT` reaches 0. -1 = none. */
  pendT: number;
  pendKind: number;
  pendSpeed: number;
  pendTime: number;
  pendUp: number;
  pendGrav: number;
  pendYaw: number;
  pendSlam: boolean;
  /** A leap in flight whose landing is a slam. */
  slam: boolean;
}

/** One frame of player intent. Carries no position - only what was pressed. */
export interface MovementInput {
  moveX: number;
  moveZ: number;
  cameraYaw: number;
  jump: boolean;
  dash: boolean;
}

/** Server-owned tuning the step reads but never changes. */
export interface SimParams {
  /** Walk speed in world units per second (buffs raise it). */
  moveSpeed: number;
  /** Multiplier on the dash cooldown (Godspeed lowers it). */
  dashCdMul: number;
}

export interface SimEvents {
  landed: boolean;
  jumped: boolean;
  dashed: boolean;
  /** A slam leap touched down this step. */
  slammed: boolean;
  /** Which queued impulse fired this step (0 = none). */
  fired: number;
}

/** What an ability does to its caster's body. Applied identically on both sides. */
export interface MotionScript {
  /** Seconds rooted from the cast. */
  readonly lock?: number;
  /** Seconds at half walking speed from the cast. */
  readonly slow?: number;
  /** Seconds from the cast until the impulse. */
  readonly delay?: number;
  readonly kind?: 'lunge' | 'leap' | 'blink';
  /** Lunge/leap horizontal speed; blink distance. */
  readonly speed?: number;
  /** Lunge duration. */
  readonly time?: number;
  /** Lunge/leap vertical speed. */
  readonly up?: number;
  /** Gravity scale during a lunge (0 = flat). */
  readonly grav?: number;
  /** The leap's landing is a slam. */
  readonly slam?: boolean;
}

export const IMPULSE = { none: 0, lunge: 1, leap: 2, blink: 3 } as const;

/** Largest single step the simulation will take, in seconds. */
export const MAX_SIM_DELTA = 0.1;

export const createMotion = (): PlayerMotion => ({
  x: SPAWN.x,
  y: SPAWN.y,
  z: SPAWN.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: SPAWN.yaw,
  grounded: true,
  stun: 0,
  lock: 0,
  slow: 0,
  dashCd: 0,
  lungeT: 0,
  lvx: 0,
  lvy: 0,
  lvz: 0,
  lgrav: 1,
  pendT: -1,
  pendKind: 0,
  pendSpeed: 0,
  pendTime: 0,
  pendUp: 0,
  pendGrav: 1,
  pendYaw: 0,
  pendSlam: false,
  slam: false,
});

export const createSimEvents = (): SimEvents => ({ landed: false, jumped: false, dashed: false, slammed: false, fired: 0 });

export const createSimParams = (): SimParams => ({ moveSpeed: MOVEMENT.walkSpeed, dashCdMul: 1 });

export const copyMotion = (from: PlayerMotion, to: PlayerMotion): void => {
  Object.assign(to, from);
};

/** Reset to a placement: every timer, lunge and queued impulse cleared. */
export const resetMotion = (motion: PlayerMotion, x: number, y: number, z: number, yaw: number): void => {
  const dashCd = motion.dashCd;
  Object.assign(motion, createMotion());
  motion.x = x;
  motion.y = y;
  motion.z = z;
  motion.yaw = yaw;
  motion.dashCd = Math.min(dashCd, DASH.cooldown);
};

export const horizontalSpeed = (motion: PlayerMotion): number => Math.hypot(motion.vx, motion.vz);

/** Sanitise one input before it is simulated. Applied on the SERVER. */
export const sanitiseInput = (input: Partial<MovementInput> | undefined): MovementInput => {
  const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  let moveX = finite(input?.moveX);
  let moveZ = finite(input?.moveZ);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }
  return { moveX, moveZ, cameraYaw: finite(input?.cameraYaw), jump: input?.jump === true, dash: input?.dash === true };
};

/**
 * Apply an ability's motion script at the moment it is cast, facing `yaw`.
 * The impulse itself is queued and fires inside `stepPlayer`, which has the
 * collision a blink needs.
 */
export const applyMotionScript = (motion: PlayerMotion, script: MotionScript | undefined, yaw: number): void => {
  motion.yaw = yaw;
  if (!script) return;
  if (script.lock) motion.lock = Math.max(motion.lock, script.lock);
  if (script.slow) motion.slow = Math.max(motion.slow, script.slow);
  if (script.kind) {
    motion.pendT = Math.max(0, script.delay ?? 0);
    motion.pendKind = IMPULSE[script.kind];
    motion.pendSpeed = script.speed ?? 0;
    motion.pendTime = script.time ?? 0;
    motion.pendUp = script.up ?? 0;
    motion.pendGrav = script.grav ?? 1;
    motion.pendYaw = yaw;
    motion.pendSlam = script.slam === true;
  }
};

/**
 * A HIT: launch and ragdoll. SERVER ONLY - the victim's client learns of it
 * by reconciliation. Cancels whatever the victim was doing.
 */
export const applyKnockback = (motion: PlayerMotion, vx: number, vy: number, vz: number, stun: number): void => {
  motion.vx = vx;
  motion.vy = vy;
  motion.vz = vz;
  if (vy > 0) motion.grounded = false;
  motion.stun = Math.max(motion.stun, stun);
  motion.lungeT = 0;
  motion.pendT = -1;
  motion.pendKind = 0;
  motion.lock = 0;
  motion.slow = 0;
  motion.slam = false;
};

const AXIS = { value: 0, y: 0, hit: false };

/** Move along a heading, stopping at walls. Used by blinks. */
const slide = (motion: PlayerMotion, dx: number, dz: number, collision: WorldCollision): void => {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / 0.4));
  for (let i = 0; i < steps; i += 1) {
    collision.moveAxis('x', motion.x, motion.y, motion.z, dx / steps, AXIS);
    motion.x = AXIS.value;
    motion.y = AXIS.y;
    collision.moveAxis('z', motion.x, motion.y, motion.z, dz / steps, AXIS);
    motion.z = AXIS.value;
    motion.y = AXIS.y;
  }
};

const fireImpulse = (motion: PlayerMotion, collision: WorldCollision, events: SimEvents): void => {
  const kind = motion.pendKind;
  const yaw = motion.pendYaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  motion.pendT = -1;
  motion.pendKind = 0;
  events.fired = kind;
  motion.yaw = yaw;
  if (kind === IMPULSE.lunge) {
    motion.lungeT = motion.pendTime;
    motion.lvx = fx * motion.pendSpeed;
    motion.lvz = fz * motion.pendSpeed;
    motion.lvy = motion.pendUp;
    motion.lgrav = motion.pendGrav;
    motion.vx = motion.lvx;
    motion.vz = motion.lvz;
    motion.vy = motion.lvy;
    if (motion.lvy > 0) motion.grounded = false;
  } else if (kind === IMPULSE.leap) {
    motion.vx = fx * motion.pendSpeed;
    motion.vz = fz * motion.pendSpeed;
    motion.vy = motion.pendUp;
    motion.grounded = false;
    motion.slam = motion.pendSlam;
  } else if (kind === IMPULSE.blink) {
    slide(motion, fx * motion.pendSpeed, fz * motion.pendSpeed, collision);
    motion.vx = 0;
    motion.vz = 0;
    motion.vy = Math.max(0, motion.vy);
    motion.grounded = false;
  }
};

/**
 * Advance one player by one step.
 *
 * @param motion    mutated in place
 * @param input     already sanitised intent
 * @param params    server-owned tuning
 * @param delta     seconds; clamped internally to [0, MAX_SIM_DELTA]
 * @param collision the world the player moves through
 * @param events    mutated in place with the edges this step produced
 */
export const stepPlayer = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  delta: number,
  collision: WorldCollision,
  events: SimEvents,
): void => {
  events.landed = false;
  events.jumped = false;
  events.dashed = false;
  events.slammed = false;
  events.fired = 0;
  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_SIM_DELTA) : 0;
  if (dt === 0) return;

  motion.stun = Math.max(0, motion.stun - dt);
  motion.lock = Math.max(0, motion.lock - dt);
  motion.slow = Math.max(0, motion.slow - dt);
  motion.dashCd = Math.max(0, motion.dashCd - dt);
  if (motion.lungeT > 0) motion.lungeT = Math.max(0, motion.lungeT - dt);

  if (motion.pendT >= 0 && motion.stun <= 0) {
    motion.pendT -= dt;
    if (motion.pendT <= 0) fireImpulse(motion, collision, events);
  }

  const stunned = motion.stun > 0;
  const lunging = motion.lungeT > 0;
  let gravityScale = 1;

  if (stunned) {
    // RAGDOLL: no input. Skid to a stop on the ground, drift in the air.
    const h = Math.hypot(motion.vx, motion.vz);
    if (h > 1e-4) {
      const next = motion.grounded ? Math.max(0, h - MOVEMENT.stunGroundFriction * dt) : h * Math.exp(-MOVEMENT.stunAirDrag * dt);
      motion.vx *= next / h;
      motion.vz *= next / h;
    }
  } else if (lunging) {
    motion.vx = motion.lvx;
    motion.vz = motion.lvz;
    if (motion.lgrav === 0) motion.vy = motion.lvy;
    gravityScale = motion.lgrav;
  } else {
    const rooted = motion.lock > 0;
    // Camera-relative stick: forward is where the camera looks, right is -X at yaw 0.
    const yaw = input.cameraYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    let wishX = rx * input.moveX + fx * input.moveZ;
    let wishZ = rz * input.moveX + fz * input.moveZ;
    if (rooted) {
      wishX = 0;
      wishZ = 0;
    }
    const wishLength = Math.hypot(wishX, wishZ);

    const speed = Math.max(0, params.moveSpeed) * (motion.slow > 0 ? 0.5 : 1);
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;
    const scale = Math.max(1, speed / MOVEMENT.walkSpeed);
    let rate = (wishLength > 0.01 ? MOVEMENT.acceleration : MOVEMENT.deceleration) * scale;
    if (!motion.grounded) rate *= MOVEMENT.airControl;
    const dvx = targetX - motion.vx;
    const dvz = targetZ - motion.vz;
    const dv = Math.hypot(dvx, dvz);
    const maxChange = rate * dt;
    if (dv <= maxChange) {
      motion.vx = targetX;
      motion.vz = targetZ;
    } else {
      motion.vx += (dvx / dv) * maxChange;
      motion.vz += (dvz / dv) * maxChange;
    }

    if (wishLength > 0.05) {
      motion.yaw = rotateTowards(motion.yaw, Math.atan2(wishX, wishZ), MOVEMENT.turnSpeed * dt);
    }

    if (!rooted && input.jump && motion.grounded) {
      motion.vy = MOVEMENT.jumpVelocity;
      motion.grounded = false;
      events.jumped = true;
    }

    if (!rooted && input.dash && motion.dashCd <= 0) {
      const dir = wishLength > 0.05 ? Math.atan2(wishX, wishZ) : motion.yaw;
      motion.yaw = dir;
      motion.lungeT = DASH.time;
      motion.lvx = Math.sin(dir) * DASH.speed;
      motion.lvz = Math.cos(dir) * DASH.speed;
      motion.lvy = 0;
      motion.lgrav = DASH.gravity;
      motion.vx = motion.lvx;
      motion.vz = motion.lvz;
      motion.vy = Math.max(motion.vy, 2);
      motion.dashCd = DASH.cooldown * params.dashCdMul;
      events.dashed = true;
      gravityScale = DASH.gravity;
    }
  }

  if (!(lunging && motion.lgrav === 0)) {
    motion.vy = Math.max(motion.vy - MOVEMENT.gravity * gravityScale * dt, -MOVEMENT.terminalVelocity);
  }

  // Substep so a fast lunge or a launch cannot tunnel a thin wall.
  const travel = Math.max(Math.abs(motion.vx), Math.abs(motion.vz), Math.abs(motion.vy)) * dt;
  const steps = Math.min(MOVEMENT.maxSubsteps, Math.max(1, Math.ceil(travel / MOVEMENT.maxSubstepDistance)));
  const h = dt / steps;
  const wasGrounded = motion.grounded;
  let grounded = false;

  for (let i = 0; i < steps; i += 1) {
    collision.moveAxis('x', motion.x, motion.y, motion.z, motion.vx * h, AXIS);
    if (AXIS.hit) {
      motion.vx = 0;
      motion.lvx = 0;
    }
    motion.x = AXIS.value;
    motion.y = AXIS.y;
    collision.moveAxis('z', motion.x, motion.y, motion.z, motion.vz * h, AXIS);
    if (AXIS.hit) {
      motion.vz = 0;
      motion.lvz = 0;
    }
    motion.z = AXIS.value;
    motion.y = AXIS.y;
    collision.clampToBounds(motion);

    const nextY = motion.y + motion.vy * h;
    const ceiling = motion.vy > 0 ? collision.ceilingAbove(motion.x, motion.y, motion.z) : Infinity;
    const floor = collision.floorBelow(motion.x, motion.y, motion.z, 1e-3);
    // Walking off a stair tread stays on the ground rather than hopping off it.
    const snap = wasGrounded && motion.vy <= 0 && motion.y - floor <= MOVEMENT.stepHeight + 0.05;
    if (nextY <= floor || snap) {
      motion.y = floor;
      if (motion.vy < 0) motion.vy = 0;
      grounded = true;
    } else if (nextY > ceiling) {
      motion.y = ceiling;
      motion.vy = 0;
    } else {
      motion.y = nextY;
    }
  }

  motion.grounded = grounded;
  if (grounded && !wasGrounded) {
    events.landed = true;
    if (motion.slam) {
      motion.slam = false;
      events.slammed = true;
    }
  }
};
