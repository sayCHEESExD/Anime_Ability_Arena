import type { AvatarAppearance, AvatarProportions } from '@arena/shared';
import type { ArraySchema, MapSchema } from '@colyseus/schema';

/**
 * Client-side TYPE mirror of the server's Colyseus schema.
 *
 * Types only - colyseus.js builds the concrete schema instances at runtime
 * from the handshake reflection.
 */
export interface NetPlayerState {
  sessionId: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  speed: number;
  grounded: boolean;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  lastInputSeq: number;

  stun: number;
  lock: number;
  slow: number;
  dashCd: number;
  lungeT: number;
  lvx: number;
  lvy: number;
  lvz: number;
  lgrav: number;
  pendT: number;
  pendKind: number;
  pendSpeed: number;
  pendTime: number;
  pendUp: number;
  pendGrav: number;
  pendYaw: number;
  pendSlam: boolean;
  slam: boolean;

  avatar: AvatarAppearance & AvatarProportions;
  displayName: string;
  avatarUrl: string;

  hp: number;
  dead: boolean;
  zone: string;
  shield: boolean;
  buff: string;
  buffEnds: number;
  counter: boolean;

  kit: string;
  pendingKit: string;
  ownedKits: ArraySchema<string>;

  yen: number;
  lifetimeYen: number;
  kills: number;
  deaths: number;
  damage: number;
  streak: number;
  bestStreak: number;
  playSeconds: number;

  moveSpeed: number;
  dashCdMul: number;
  ready: boolean;
}

export interface NetSummonState {
  owner: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  swings: number;
}

export interface NetLeaderEntry {
  handle: string;
  name: string;
  avatarUrl: string;
  value: number;
}

export interface NetLeaderboardState {
  kills: ArrayLike<NetLeaderEntry>;
  damage: ArrayLike<NetLeaderEntry>;
}

export interface NetGameState {
  players: MapSchema<NetPlayerState>;
  summons: MapSchema<NetSummonState>;
  elapsed: number;
  leaderboard: NetLeaderboardState;
}

/** A leaderboard flattened into plain data, ready to draw. */
export interface LeaderboardSnapshot {
  kills: readonly NetLeaderEntry[];
  damage: readonly NetLeaderEntry[];
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
