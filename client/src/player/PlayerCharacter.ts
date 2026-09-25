import { BUFFS, PLAYER_HEIGHT, kitById, type BuffId } from '@arena/shared';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  DoubleSide,
  NormalBlending,
  type Object3D,
} from 'three';
import { HOLDS } from '../animation/ActionClips.js';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { PlayerAnimator, type AnimationState } from '../animation/PlayerAnimator.js';
import { attachToMount, measureMounts, type BodyMounts } from '../animation/rig/BoneMounts.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { PLAYER_MODEL_YAW_OFFSET } from '../config/worldVisuals.js';
import { playerModelLoader } from './PlayerModelLoader.js';
import { createWeapons } from './Weapons.js';

/**
 * The visual half of a player, arranged so animation can never move them.
 *
 *   root          physics transform (position + facing). Gameplay owns it.
 *     visual      the lean, the spin, the ragdoll tumble
 *       model     the player's OWN Bloxity avatar (or the bundled rig), posed by the rig
 *         (bones) the kit's weapons, in the hands (and Zoro's third in the teeth)
 *     fx          buff aura, spawn shield, counter stance
 *
 * A kit never changes the body - only what it holds and how it stands.
 */
export class PlayerCharacter {
  readonly root = new Group();
  /** World-space extras. Kept for the composition API. */
  readonly worldRoot = new Group();

  private readonly visual = new Group();
  private readonly defaultModel: Object3D;
  private model: Object3D;
  private animator: PlayerAnimator;
  private rig: PlayerRig;
  private readonly status = new StatusFx();

  private readonly handR = new Group();
  private readonly handL = new Group();
  private readonly mouth = new Group();
  private kitId = '';
  private mounts: BodyMounts | null = null;

  constructor() {
    this.defaultModel = playerModelLoader.createInstance();
    this.model = this.defaultModel;
    this.model.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.root.add(this.visual, this.status.root);
    this.visual.add(this.model);
    this.rig = new PlayerRig(this.model, this.model);
    this.animator = new PlayerAnimator(this.rig, this.visual);
    this.mountHands();
  }

  get body(): { visual: Group; model: Object3D } {
    return { visual: this.visual, model: this.model };
  }

  get height(): number {
    return PLAYER_HEIGHT;
  }

  /** Wear a different body (the player's Bloxity avatar), or null for the bundled one. */
  setModel(next: Object3D | null): Object3D {
    const target = next ?? this.defaultModel;
    if (target === this.model) return target;
    const previous = this.model;
    previous.removeFromParent();
    this.handR.removeFromParent();
    this.handL.removeFromParent();
    this.mouth.removeFromParent();
    releaseBody(previous);
    target.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.rig = new PlayerRig(target, target);
    this.rig.resetToBindPose();
    target.updateMatrixWorld(true);
    this.model = target;
    this.visual.add(target);
    this.animator.setRig(this.rig);
    this.mountHands();
    return target;
  }

  /** Hand this body a kit's weapons. Cheap when unchanged. */
  setKit(id: string): void {
    if (id === this.kitId) return;
    this.kitId = id;
    for (const hand of [this.handR, this.handL, this.mouth]) hand.clear();
    const kit = kitById(id);
    if (!kit) return;
    const set = createWeapons(kit.weapon);
    if (set.right) {
      // The mount's +Z faces down the forearm; a quarter turn puts the edge across the body.
      set.right.rotation.y = Math.PI / 2;
      this.handR.add(set.right);
    }
    if (set.left) {
      set.left.rotation.y = -Math.PI / 2;
      this.handL.add(set.left);
    }
    if (set.mouth) {
      // Clenched crosswise in the teeth, blade to the right.
      set.mouth.rotation.set(0, 0, -Math.PI / 2);
      set.mouth.position.set(-0.2, -0.28, 0.42);
      this.mouth.add(set.mouth);
    }
  }

  /** The rest pose of the arms for this kit. */
  holdFor(input: AnimationInput): void {
    const kit = kitById(this.kitId);
    if (!kit) return;
    input.hold = HOLDS[kit.m1];
    input.guard = kit.m1 === 'fist';
  }

  setBuff(id: BuffId | ''): void {
    this.status.setBuff(id);
  }

  setShield(on: boolean): void {
    this.status.setShield(on);
  }

  setCounter(on: boolean): void {
    this.status.setCounter(on);
  }

  /** Bolt the hand mounts to this body's forearms, in the bind pose with the root at the origin. */
  private mountHands(): void {
    const savedPosition = this.root.position.clone();
    const savedYaw = this.root.rotation.y;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.visual.position.set(0, 0, 0);
    this.visual.rotation.set(0, 0, 0);
    this.rig.resetToBindPose();
    this.root.updateMatrixWorld(true);

    this.mounts = measureMounts(this.rig, this.root);
    if (this.mounts.hand) attachToMount(this.handR, this.mounts.hand, this.root);
    if (this.mounts.handL) attachToMount(this.handL, this.mounts.handL, this.root);
    if (this.mounts.head) attachToMount(this.mouth, this.mounts.head, this.root);

    this.root.position.copy(savedPosition);
    this.root.rotation.y = savedYaw;
    this.root.updateMatrixWorld(true);
    this.animator.reset();
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  update(delta: number, input: AnimationInput): void {
    this.holdFor(input);
    this.animator.update(Math.max(0, delta), input);
    this.status.update(delta);
  }

  get animationState(): AnimationState {
    return this.animator.currentState;
  }

  resetAnimation(): void {
    this.animator.reset();
  }

  dispose(): void {
    this.status.dispose();
    this.root.removeFromParent();
    this.worldRoot.removeFromParent();
  }
}

/** Let go of a Bloxity body's materials when it is swapped out. */
const releaseBody = (model: Object3D): void => {
  if (model.userData['bloxityBody'] !== true) return;
  model.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};

let flameTexture: CanvasTexture | null = null;
const flame = (): CanvasTexture => {
  if (flameTexture) return flameTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 40, 0, 32, 36, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.quadraticCurveTo(56, 34, 44, 56);
  ctx.quadraticCurveTo(32, 64, 20, 56);
  ctx.quadraticCurveTo(8, 34, 32, 0);
  ctx.fill();
  flameTexture = new CanvasTexture(canvas);
  flameTexture.colorSpace = SRGBColorSpace;
  return flameTexture;
};

/**
 * What a player's STATE looks like on them: a buff's aura (black flames for
 * Devil Union, crackling blue for Godspeed), the spawn-protection bubble, and
 * the water ring of a counter stance. A handful of sprites, pooled per player.
 */
class StatusFx {
  readonly root = new Group();
  private readonly flames: Sprite[] = [];
  private readonly flameMaterial: SpriteMaterial;
  private readonly bubble: Mesh;
  private readonly ring: Mesh;
  private buff: BuffId | '' = '';
  private time = Math.random() * 10;

  constructor() {
    this.flameMaterial = new SpriteMaterial({ map: flame(), color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending });
    for (let i = 0; i < 10; i += 1) {
      const sprite = new Sprite(this.flameMaterial);
      sprite.visible = false;
      this.root.add(sprite);
      this.flames.push(sprite);
    }
    this.bubble = new Mesh(
      new SphereGeometry(2.3, 20, 14),
      new MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending }),
    );
    this.bubble.position.y = 1.7;
    this.bubble.visible = false;
    this.ring = new Mesh(
      new RingGeometry(1.6, 2.1, 32),
      new MeshBasicMaterial({ color: 0x5ac8ff, transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.15;
    this.ring.visible = false;
    this.root.add(this.bubble, this.ring);
  }

  setBuff(id: BuffId | ''): void {
    if (id === this.buff) return;
    this.buff = id;
    const on = id !== '';
    for (const sprite of this.flames) sprite.visible = on;
    if (on) {
      const color = new Color(id === 'devil' ? 0x3a0a0a : BUFFS[id].color);
      this.flameMaterial.color.copy(color);
      // Black flames read as dark: draw them normally rather than additive.
      this.flameMaterial.blending = id === 'devil' ? NormalBlending : AdditiveBlending;
      this.flameMaterial.opacity = id === 'devil' ? 0.85 : 0.9;
      this.flameMaterial.needsUpdate = true;
    }
  }

  setShield(on: boolean): void {
    this.bubble.visible = on;
  }

  setCounter(on: boolean): void {
    this.ring.visible = on;
  }

  update(delta: number): void {
    this.time += delta;
    if (this.buff) {
      this.flames.forEach((sprite, i) => {
        const phase = (this.time * 1.4 + i / this.flames.length) % 1;
        const angle = (i / this.flames.length) * Math.PI * 2 + this.time * 0.8;
        const radius = 0.9 + Math.sin(i * 3.1) * 0.25;
        sprite.position.set(Math.cos(angle) * radius, 0.2 + phase * 3.4, Math.sin(angle) * radius);
        const s = (1 - phase) * 1.3 + 0.3;
        sprite.scale.set(s, s * 1.4, 1);
      });
    }
    if (this.bubble.visible) {
      const pulse = 1 + Math.sin(this.time * 4) * 0.04;
      this.bubble.scale.setScalar(pulse);
    }
    if (this.ring.visible) {
      this.ring.rotation.z += delta * 3;
      const pulse = 1 + Math.sin(this.time * 10) * 0.08;
      this.ring.scale.setScalar(pulse);
    }
  }

  dispose(): void {
    this.flameMaterial.dispose();
    this.bubble.geometry.dispose();
    (this.bubble.material as MeshBasicMaterial).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
  }
}
