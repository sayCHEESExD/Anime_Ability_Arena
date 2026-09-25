import type { Group } from 'three';
import { AIRBORNE, IDLE, LANDING, LOCOMOTION, TRANSITIONS } from '../config/animationConfig.js';
import { DOWNED_POSE, GUARD, RAGDOLL_POSE, type ActionClip } from './ActionClips.js';
import type { AnimationInput } from './AnimationInput.js';
import { LocomotionCycle } from './LocomotionCycle.js';
import { PoseBuffer, type PoseDefinition } from './PoseBuffer.js';
import type { PlayerRig } from './rig/PlayerRig.js';
import { BONE_INDEX, BONE_NAMES, type BoneName } from './rig/boneNames.js';

/** The body's state. Attacks are a LAYER over it, not a state. */
export type AnimationState = 'idle' | 'run' | 'airborne' | 'landing' | 'ragdoll';

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);
const ease = (t: number): number => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

/** The bones an upper-body clip owns. */
const UPPER: readonly BoneName[] = ['ArmL1', 'ArmL2', 'ArmR1', 'ArmR2', 'Spine1', 'Spine2', 'Neck1'];
const ALL: readonly BoneName[] = BONE_NAMES.filter((bone) => bone !== 'Rig1');
const ARMS: readonly BoneName[] = ['ArmL1', 'ArmL2', 'ArmR1', 'ArmR2'];

/**
 * Writes ONLY to bones (via `PlayerRig`) and to the visual node. It never
 * touches the physics root.
 *
 * The body walks, runs, jumps and falls; an ACTION layer (a swing, a cast)
 * overrides the upper body - or the whole body - on top. A hit replaces all
 * of it with the RAGDOLL: limbs flung wide and the body tumbling end over end
 * while airborne, then flat on its back once it lands, then back up as the
 * stun runs out.
 */
export class PlayerAnimator {
  private readonly locomotion = new LocomotionCycle();
  private readonly target = new PoseBuffer();
  private readonly from = new PoseBuffer();
  private readonly output = new PoseBuffer();
  private readonly layer = new PoseBuffer();
  private readonly layerB = new PoseBuffer();

  private state: AnimationState = 'idle';
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0;
  private idleTime = 0;
  private wasGrounded = true;
  private bank = 0;
  private lean = 0;
  /** Ragdoll tumble angle (visual pitch). */
  private tumble = 0;
  private flail = 0;
  private getUp = 1;

  constructor(
    private rig: PlayerRig,
    private readonly visual: Group,
  ) {}

  get currentState(): AnimationState {
    return this.state;
  }

  setRig(rig: PlayerRig): void {
    this.rig = rig;
  }

  reset(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.blendDuration = 0;
    this.wasGrounded = true;
    this.bank = 0;
    this.lean = 0;
    this.tumble = 0;
    this.getUp = 1;
    this.target.reset();
    this.from.reset();
    this.output.reset();
    this.rig.resetToBindPose();
    this.visual.position.set(0, 0, 0);
    this.visual.rotation.set(0, 0, 0);
  }

  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);
    this.stateTime += dt;
    this.resolveState(input);
    this.writePose(dt, input);
    this.blend(dt);
    if (this.state !== 'ragdoll') this.applyActionLayer(input);
    this.rig.applyPose(this.output);
    this.applyVisual(dt, input);
  }

  private resolveState(input: AnimationInput): void {
    if (input.dead || input.stun > 0.02) {
      if (this.state !== 'ragdoll') {
        this.setState('ragdoll', 0.06);
        this.getUp = 0;
      }
      this.wasGrounded = input.grounded;
      return;
    }
    if (input.landed || (input.grounded && !this.wasGrounded)) {
      this.wasGrounded = true;
      this.setState('landing', TRANSITIONS.toLanding);
      return;
    }
    this.wasGrounded = input.grounded;
    if (!input.grounded) {
      this.setState('airborne', TRANSITIONS.toAirborne);
      return;
    }
    if (this.state === 'landing' && this.stateTime < LANDING.duration) return;
    this.setState(input.horizontalSpeed < LOCOMOTION.idleSpeed ? 'idle' : 'run', TRANSITIONS.toLocomotion);
  }

  private setState(next: AnimationState, duration: number): void {
    if (next === this.state) return;
    this.from.copyFrom(this.output);
    this.state = next;
    this.stateTime = 0;
    this.blendTime = 0;
    this.blendDuration = duration;
  }

  private writePose(dt: number, input: AnimationInput): void {
    switch (this.state) {
      case 'idle': {
        this.locomotion.settleTowardNeutral(dt);
        this.idleTime += dt;
        const breath = Math.sin(this.idleTime * IDLE.breathFrequency * Math.PI * 2);
        this.target.applyDefinition(IDLE.basePose);
        this.target.add('Spine1', breath * IDLE.breathAmount);
        this.target.add('Neck1', -breath * IDLE.breathAmount * 0.6);
        this.target.bobY = breath * IDLE.breathBob;
        break;
      }
      case 'run':
        this.locomotion.advance(dt, input.horizontalSpeed, 1, input.lunging);
        this.locomotion.writePose(this.target, input.horizontalSpeed, 1);
        break;
      case 'airborne': {
        const rising = clamp(input.verticalVelocity / AIRBORNE.velocityReference, -1, 1);
        this.target.applyDefinition(AIRBORNE.fall);
        this.layerB.applyDefinition(AIRBORNE.rise);
        this.target.lerpBetween(this.target, this.layerB, clamp(0.5 + rising * 0.5, 0, 1));
        this.target.bobY = 0;
        break;
      }
      case 'landing': {
        const depth = 1 - ease(clamp(this.stateTime / LANDING.duration, 0, 1));
        this.target.applyDefinition(LANDING.pose, depth);
        this.target.bobY = LANDING.bobY * depth;
        break;
      }
      case 'ragdoll': {
        this.flail += dt * (input.grounded ? 2 : 14);
        if (input.grounded) {
          this.target.applyDefinition(DOWNED_POSE);
        } else {
          this.target.applyDefinition(RAGDOLL_POSE);
          const f = Math.sin(this.flail);
          const g = Math.cos(this.flail * 1.3);
          this.target.add('ArmR1', f * 0.5, 0, g * 0.3);
          this.target.add('ArmL1', -f * 0.5, 0, -g * 0.3);
          this.target.add('LegL1', g * 0.4);
          this.target.add('LegR1', -g * 0.4);
        }
        this.target.bobY = 0;
        break;
      }
    }
  }

  private blend(dt: number): void {
    if (this.blendDuration > 0) {
      this.blendTime += dt;
      const t = clamp(this.blendTime / this.blendDuration, 0, 1);
      this.output.lerpBetween(this.from, this.target, ease(t));
      if (t >= 1) this.blendDuration = 0;
    } else {
      this.output.copyFrom(this.target);
    }
  }

  /** THE ACTION LAYER: a swing or a cast while it plays; else the weapon hold / guard. */
  private applyActionLayer(input: AnimationInput): void {
    const clip = input.action;
    if (clip && input.actionTime >= 0 && input.actionTime < input.actionDuration) {
      const t = input.actionTime / Math.max(0.05, input.actionDuration);
      if (clip.barrage) {
        // Rapid alternating punches, both fists, for the whole clip.
        const phase = input.actionTime * 26;
        const r = Math.max(0, Math.sin(phase));
        const l = Math.max(0, Math.sin(phase + Math.PI));
        const fade = Math.min(1, (1 - t) * 6);
        this.layer.reset();
        this.layer.set('ArmR1', (-40 - 55 * r) * (Math.PI / 180) * fade, 0, -0.1);
        this.layer.set('ArmR2', (100 - 100 * r) * (Math.PI / 180) * fade);
        this.layer.set('ArmL1', (-40 - 55 * l) * (Math.PI / 180) * fade, 0, 0.1);
        this.layer.set('ArmL2', (100 - 100 * l) * (Math.PI / 180) * fade);
        this.layer.set('Spine1', 0.12 * fade, (r - l) * 0.25 * fade);
        this.override(UPPER, this.layer);
        return;
      }
      this.sample(clip, t, this.layer);
      this.override(clip.body === 'full' ? ALL : UPPER, this.layer);
      return;
    }
    // Between actions: the hold (weapon) or raised fists (unarmed).
    const hold: PoseDefinition = input.guard ? GUARD : input.hold;
    if (Object.keys(hold).length === 0) return;
    this.layer.applyDefinition(hold);
    const weight = input.guard ? (this.state === 'idle' ? 0.9 : 0.35) : 1;
    this.override(input.guard ? ARMS : (Object.keys(hold) as BoneName[]), this.layer, weight);
  }

  /** Keyed-pose lookup with an eased blend between the two surrounding keys. */
  private sample(clip: ActionClip, t: number, out: PoseBuffer): void {
    const keys = clip.keys;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1]!.t) i += 1;
    const a = keys[i]!;
    const b = keys[Math.min(i + 1, keys.length - 1)]!;
    const span = Math.max(1e-4, b.t - a.t);
    const k = clamp((t - a.t) / span, 0, 1);
    this.layerB.applyDefinition(a.pose);
    out.applyDefinition(b.pose);
    out.lerpBetween(this.layerB, out, ease(k));
  }

  private override(bones: readonly BoneName[], layer: PoseBuffer, weight = 1): void {
    const out = this.output.rotations;
    const src = layer.rotations;
    for (const bone of bones) {
      const at = BONE_INDEX[bone] * 3;
      for (let k = 0; k < 3; k += 1) {
        const a = out[at + k] ?? 0;
        const b = src[at + k] ?? 0;
        out[at + k] = a + (b - a) * weight;
      }
    }
  }

  private applyVisual(dt: number, input: AnimationInput): void {
    if (this.state === 'ragdoll') {
      if (!input.grounded) {
        // Tumble end over end, faster the harder the launch.
        this.tumble -= dt * clamp(6 + input.horizontalSpeed * 0.12, 6, 16);
      } else {
        // Settle flat on the back (the nearest lying angle).
        const want = Math.round((this.tumble + Math.PI / 2) / TAU) * TAU - Math.PI / 2;
        this.tumble += (want - this.tumble) * (1 - Math.exp(-14 * dt));
      }
      // Stand back up in the last moment of the stun.
      const rising = !input.dead && input.grounded && input.stun < 0.22;
      this.getUp = rising ? Math.min(1, this.getUp + dt * 6) : 0;
      const angle = this.tumble * (1 - ease(this.getUp));
      this.visual.rotation.set(angle, 0, 0);
      const lying = Math.abs(Math.sin(angle));
      this.visual.position.set(0, input.grounded ? lying * 0.45 : 1.4 * lying, 0);
      this.lean = 0;
      this.bank = 0;
      return;
    }
    this.tumble = 0;
    const clip = input.action;
    const active = clip && input.actionTime >= 0 && input.actionTime < input.actionDuration;
    const t = active ? input.actionTime / Math.max(0.05, input.actionDuration) : 0;
    let wantLean = active && clip.lean ? clip.lean * Math.sin(Math.PI * clamp(t, 0, 1)) : 0;
    if (input.lunging && !active) wantLean = 0.35;
    this.lean += (wantLean - this.lean) * (1 - Math.exp(-18 * dt));
    const wantBank = this.state === 'run' ? -input.turn * LOCOMOTION.bankAngle * 0.6 : 0;
    this.bank += (wantBank - this.bank) * (1 - Math.exp(-LOCOMOTION.bankRate * dt));
    const spin = active && clip.spin ? clip.spin * TAU * ease(clamp(t / 0.9, 0, 1)) : 0;
    this.visual.rotation.set(this.lean, spin, this.bank);
    this.visual.position.set(0, this.output.bobY, 0);
  }
}
