import { ArraySchema, Schema, type } from '@colyseus/schema';
import { COMBAT, DEFAULT_KIT, MOVEMENT, SPAWN } from '@arena/shared';
import { AvatarState } from './AvatarState.js';

/**
 * Replicated per-player state.
 *
 * Every field is written by the SERVER: the transform and every motion timer
 * by the authoritative simulation (the owner's client reconciles against ALL
 * of them, so a knockback the server applied replays identically), health,
 * Yen and stats by the combat service, kits by the kit service. Nothing is
 * ever copied from a client message.
 */
export class PlayerState extends Schema {
  @type('string') sessionId = '';

  @type('float32') x: number = SPAWN.x;
  @type('float32') y: number = SPAWN.y;
  @type('float32') z: number = SPAWN.z;
  @type('float32') rotationY: number = SPAWN.yaw;
  @type('float32') speed = 0;
  @type('boolean') grounded = true;
  @type('float32') velocityX = 0;
  @type('float32') velocityY = 0;
  @type('float32') velocityZ = 0;
  @type('uint32') lastInputSeq = 0;

  // ---- the rest of the simulation, for reconciliation
  @type('float32') stun = 0;
  @type('float32') lock = 0;
  @type('float32') slow = 0;
  @type('float32') dashCd = 0;
  @type('float32') lungeT = 0;
  @type('float32') lvx = 0;
  @type('float32') lvy = 0;
  @type('float32') lvz = 0;
  @type('float32') lgrav = 1;
  @type('float32') pendT = -1;
  @type('uint8') pendKind = 0;
  @type('float32') pendSpeed = 0;
  @type('float32') pendTime = 0;
  @type('float32') pendUp = 0;
  @type('float32') pendGrav = 1;
  @type('float32') pendYaw = 0;
  @type('boolean') pendSlam = false;
  @type('boolean') slam = false;

  @type(AvatarState) avatar = new AvatarState();
  @type('string') displayName = '';
  @type('string') avatarUrl = '';

  // ---- combat, all server-owned
  @type('float32') hp: number = COMBAT.maxHp;
  @type('boolean') dead = false;
  /** 'lobby' or 'arena'. */
  @type('string') zone = 'lobby';
  /** Spawn protection is up. */
  @type('boolean') shield = false;
  /** Active buff id, or ''. */
  @type('string') buff = '';
  /** Server clock (GameState.elapsed) when the buff ends. */
  @type('float64') buffEnds = 0;
  /** In a counter stance. */
  @type('boolean') counter = false;

  // ---- kits
  @type('string') kit: string = DEFAULT_KIT;
  /** Equipped on the next respawn (chosen while in the arena), or ''. */
  @type('string') pendingKit = '';
  @type(['string']) ownedKits = new ArraySchema<string>(DEFAULT_KIT);

  // ---- progression
  /** Written through `Wallet` only. */
  @type('float64') yen = 0;
  @type('float64') lifetimeYen = 0;
  @type('uint32') kills = 0;
  @type('uint32') deaths = 0;
  /** Damage dealt to other players, ever: the Most Damage board. */
  @type('float64') damage = 0;
  @type('uint16') streak = 0;
  @type('uint16') bestStreak = 0;
  @type('float64') playSeconds = 0;

  // ---- derived
  @type('float32') moveSpeed: number = MOVEMENT.walkSpeed;
  @type('float32') dashCdMul = 1;

  /** True once the server has simulated at least one input for this player. */
  @type('boolean') ready = false;
}
