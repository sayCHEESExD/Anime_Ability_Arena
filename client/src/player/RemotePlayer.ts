import type { BuffId } from '@arena/shared';
import type { ActionClip } from '../animation/ActionClips.js';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { lookFromState } from '../bloxity/avatarLook.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { NamePlate } from './NamePlate.js';
import { PlayerCharacter } from './PlayerCharacter.js';

const FOLLOW_RATE = 16;
const SNAP_DISTANCE = 14;

const shortestAngle = (from: number, to: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * Another player, rendered from replicated state ONLY: their own Bloxity
 * avatar, their kit's weapons, the transform smoothed toward the server's,
 * the ragdoll whenever the server says they are stunned, and every attack
 * the server broadcasts (`playAction`).
 */
export class RemotePlayer {
  readonly character: PlayerCharacter;

  private readonly plate = new NamePlate();
  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetYaw = 0;
  private readonly input: AnimationInput = createAnimationInput();
  private placed = false;
  private readonly dresser: AvatarDresser;
  private lastLook = '';
  private stunLeft = 0;
  private lastStun = 0;
  private action: ActionClip | null = null;
  private actionTime = 0;
  private actionDuration = 1;
  private faceYaw = 0;
  private faceFor = 0;
  private wasGrounded = true;
  private velocityX = 0;
  private velocityY = 0;
  private velocityZ = 0;
  hp = 100;
  zone = 'lobby';
  dead = false;

  get position(): { readonly x: number; readonly y: number; readonly z: number } {
    return { x: this.targetX, y: this.targetY, z: this.targetZ };
  }

  /** Where the body is drawn now (smoothed). */
  get drawn(): { readonly x: number; readonly y: number; readonly z: number } {
    return this.character.root.position;
  }

  constructor(state: NetPlayerState) {
    this.character = new PlayerCharacter();
    this.character.root.add(this.plate.sprite);
    this.dresser = new AvatarDresser(this.character);
    this.apply(state);
    this.character.setPosition(this.targetX, this.targetY, this.targetZ);
    this.character.setYaw(this.targetYaw);
    this.placed = true;
  }

  apply(state: NetPlayerState): void {
    const jumped = Math.hypot(state.x - this.targetX, state.z - this.targetZ) > SNAP_DISTANCE;
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetYaw = state.rotationY;
    this.velocityX = state.velocityX;
    this.velocityY = state.velocityY;
    this.velocityZ = state.velocityZ;
    if (jumped) this.placed = false;
    this.hp = state.hp;
    this.zone = state.zone;
    this.dead = state.dead;
    this.plate.set(state.displayName, state.avatarUrl, this.character.height);
    this.plate.setHealth(state.zone === 'arena' && !state.dead ? state.hp : -1);

    this.input.grounded = state.grounded;
    this.input.horizontalSpeed = state.speed;
    this.input.verticalVelocity = state.velocityY;
    this.input.lunging = state.lungeT > 0;
    this.input.dead = state.dead;
    // A fresh (or longer) stun restarts the local countdown.
    if (state.stun > this.lastStun + 0.05 || (state.stun > 0 && this.stunLeft <= 0)) this.stunLeft = state.stun;
    if (state.stun <= 0) this.stunLeft = 0;
    this.lastStun = state.stun;

    this.character.setKit(state.kit);
    this.character.setBuff((state.buff || '') as BuffId | '');
    this.character.setShield(state.shield);
    this.character.setCounter(state.counter);
    this.dressFrom(state);
  }

  /** Play a broadcast attack or ability, facing where it was aimed. */
  playAction(clip: ActionClip, duration: number, yaw: number): void {
    this.action = clip;
    this.actionTime = 0;
    this.actionDuration = duration;
    this.faceYaw = yaw;
    this.faceFor = Math.min(duration, 0.8);
  }

  private dressFrom(state: NetPlayerState): void {
    const avatar = state.avatar;
    if (!avatar) return;
    const look = lookFromState(avatar);
    const key = JSON.stringify(look);
    if (key === this.lastLook) return;
    this.lastLook = key;
    this.dresser.setLook(look.appearance, look.proportions);
  }

  update(delta: number): void {
    const dt = Math.max(0, delta);
    const position = this.character.root.position;
    // Extrapolate a little along the server velocity while flying (a launch reads smoother).
    const lead = this.stunLeft > 0 || this.input.lunging ? 0.05 : 0;
    const tx = this.targetX + this.velocityX * lead;
    const ty = this.targetY + this.velocityY * lead;
    const tz = this.targetZ + this.velocityZ * lead;
    const gap = Math.hypot(tx - position.x, ty - position.y, tz - position.z);
    if (!this.placed || gap > SNAP_DISTANCE * 2) {
      position.set(this.targetX, this.targetY, this.targetZ);
      this.character.setYaw(this.targetYaw);
      this.placed = true;
    } else {
      const alpha = 1 - Math.exp(-FOLLOW_RATE * dt);
      position.x += (tx - position.x) * alpha;
      position.y += (ty - position.y) * alpha;
      position.z += (tz - position.z) * alpha;
      const yaw = this.character.root.rotation.y;
      const want = this.faceFor > 0 ? this.faceYaw : this.targetYaw;
      this.character.setYaw(yaw + shortestAngle(yaw, want) * Math.min(1, alpha * 1.6));
    }

    if (this.action) {
      this.actionTime += dt;
      if (this.actionTime >= this.actionDuration) this.action = null;
    }
    this.faceFor = Math.max(0, this.faceFor - dt);
    this.stunLeft = Math.max(0, this.stunLeft - dt);

    this.input.landed = this.input.grounded && !this.wasGrounded;
    this.wasGrounded = this.input.grounded;
    this.input.stun = this.stunLeft;
    this.input.action = this.stunLeft > 0 ? null : this.action;
    this.input.actionTime = this.actionTime;
    this.input.actionDuration = this.actionDuration;
    this.character.update(dt, this.input);
  }

  dispose(): void {
    this.plate.dispose();
    this.dresser.dispose();
    this.character.dispose();
  }
}
