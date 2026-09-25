import type { AvatarAppearance, AvatarProportions } from './avatar.js';

/**
 * Client -> server input (MessageType.Move).
 *
 * INPUT ONLY. No position, velocity, target or damage: the server simulates
 * movement from intent and resolves every attack itself. An attack or ability
 * press rides the input it was pressed on, so its motion (a lunge, a leap)
 * replays at exactly the same step on both sides.
 */
export interface MoveMessage {
  seq: number;
  /** Seconds this input covers. Clamped and rate-limited server-side. */
  dt: number;
  moveX: number;
  moveZ: number;
  cameraYaw: number;
  jump?: boolean;
  dash?: boolean;
  /** 0 none, 1 attack, 2 skill (E), 3 ultimate (R). */
  act?: number;
  /** Which way the act was aimed (the camera's yaw). */
  aim?: number;
}

export interface KitMessage {
  kit: string;
}

/** Why a player was placed. */
export type RespawnReason = 'join' | 'lobby' | 'arena' | 'death' | 'manual' | 'fall';

/** Server -> client authoritative placement (MessageType.Respawn). */
export interface RespawnMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  reason: RespawnReason;
}

/** Server -> everyone: a player cast something. Clients play its animation and VFX. */
export interface CastMessage {
  sid: string;
  /** 1 attack, 2 skill, 3 ultimate. */
  slot: number;
  /** The kit whose move it is. */
  kit: string;
  /** Which swing of the M1 combo (0..2). */
  combo: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Server -> the caster: that cast was refused (cooldown, stunned, dead). */
export interface RefusedMessage {
  slot: number;
  /** Seconds until it is really ready. */
  readyIn: number;
}

/** Server -> everyone: a hit landed. */
export interface HitMessage {
  /** Attacker session, or '' for none. */
  a: string;
  /** Victim session. */
  v: string;
  dmg: number;
  x: number;
  y: number;
  z: number;
  /** The launch the victim received. */
  kx: number;
  ky: number;
  kz: number;
  /** What hit: 'm1', an ability id, 'summon', 'chain', 'wave'. */
  src: string;
  /** Victim health after the hit. */
  hp: number;
  /** Absorbed by a shield, armour or a counter. */
  blocked?: boolean;
}

export type DeathCause = 'hit' | 'fall';

/** Server -> everyone: a player died. */
export interface DiedMessage {
  v: string;
  vName: string;
  /** Killer session, or ''. */
  k: string;
  kName: string;
  cause: DeathCause;
  x: number;
  y: number;
  z: number;
}

/** Server -> one player: Yen they just earned. */
export interface RewardMessage {
  yen: number;
  reason: 'damage' | 'kill';
  streak: number;
  x: number;
  y: number;
  z: number;
}

/** Server -> everyone: a projectile was fired. Clients fly it themselves. */
export interface ProjectileMessage {
  id: number;
  sid: string;
  ab: string;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  range: number;
  radius: number;
}

/** Server -> everyone: a projectile stopped (hit, wall or range). */
export interface ProjectileEndMessage {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Blast radius, 0 for none. */
  explode: number;
}

/** Server -> everyone: an area effect opened. */
export interface ZoneMessage {
  id: number;
  sid: string;
  ab: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  duration: number;
  follow: boolean;
}

export interface ZoneEndMessage {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** Server -> everyone: a one-off effect at a point (a slam landing, a counter, a teleport). */
export interface FxMessage {
  kind: 'slam' | 'blinkStrike' | 'counter' | 'teleport' | 'chain' | 'lungeEnd' | 'arise';
  sid: string;
  ab: string;
  x: number;
  y: number;
  z: number;
  x2?: number;
  y2?: number;
  z2?: number;
  radius?: number;
}

/** Server -> client: what happened to a request, so the UI can say so. */
export interface NoticeMessage {
  kind: 'bought' | 'equipped' | 'refused' | 'info' | 'unlocked';
  text: string;
  kit?: string;
}

export interface SetAvatarMessage {
  appearance: AvatarAppearance;
  proportions: AvatarProportions;
}

export interface SetIdentityMessage {
  displayName: string;
  avatarUrl: string;
}

/** Client -> server: the portal's game TOKEN, or null when signed out. */
export interface SetAuthMessage {
  token: string | null;
}

export type AuthStatus = 'account' | 'guest' | 'unavailable';

export interface AuthStateMessage {
  status: AuthStatus;
  note?: string;
}
