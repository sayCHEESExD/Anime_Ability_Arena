import { M1, type AbilityDef, type FxMessage, type KitDef } from '@arena/shared';
import { Vector3 } from 'three';
import type { AudioManager, SoundName } from '../audio/AudioManager.js';
import type { Anchor, Vfx } from './Vfx.js';

const EYE = 1.6;

/**
 * THE CHOREOGRAPHY of every move: which effects and sounds a cast plays, and
 * when - timed to the same delays the server resolves the hit at, so a beam
 * appears as the damage lands. Presentation only; a cast drawn here decides
 * nothing.
 */
export class CastFx {
  private readonly timers: { at: number; run: () => void }[] = [];
  private time = 0;

  constructor(
    private readonly vfx: Vfx,
    private readonly audio: AudioManager,
    /** Where the local player is, for distance-scaled sounds. */
    private readonly listener: () => { x: number; z: number } | null,
  ) {}

  update(dt: number): void {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i -= 1) {
      const timer = this.timers[i]!;
      if (timer.at <= this.time) {
        this.timers.splice(i, 1);
        timer.run();
      }
    }
  }

  private after(delay: number, run: () => void): void {
    if (delay <= 0) run();
    else this.timers.push({ at: this.time + delay, run });
  }

  /** A sound, quieter with distance from the local player; silent far away. */
  sound(name: SoundName, x: number, z: number, level = 1): void {
    const me = this.listener();
    const d = me ? Math.hypot(me.x - x, me.z - z) : 0;
    if (d > 90) return;
    this.audio.play(name, level * Math.max(0.15, 1 - d / 90));
  }

  /** An M1 swing: a slash arc for blades, a punch pop for fists. */
  m1(kit: KitDef, combo: number, anchor: Anchor): void {
    const at = anchor();
    if (!at) return;
    const def = M1[kit.m1];
    const color = kit.weapon === 'none' ? 0xffffff : kit.id === 'asta' ? 0x202020 : kit.id === 'tanjiro' ? 0x6fb8ff : 0xffffff;
    const blend = kit.id === 'asta';
    if (kit.m1 === 'fist') {
      this.sound('whoosh', at.x, at.z, 0.4);
      this.after(0.1, () => {
        const a = anchor();
        if (!a) return;
        this.vfx.burst(a.x + Math.sin(a.yaw) * 2.6, a.y + EYE, a.z + Math.cos(a.yaw) * 2.6, 0xffffff, combo === 2 ? 2.4 : 1.5, 0.14);
      });
      return;
    }
    this.sound('swing', at.x, at.z, 0.8);
    const roll = combo === 0 ? 0.25 : combo === 1 ? -0.25 : 1.25;
    this.after(0.08, () => {
      const a = anchor();
      if (!a) return;
      this.vfx.slash(a.x, a.y + 1.4, a.z, a.yaw, color, def.range * 0.85, roll, 0.2, combo === 2, blend ? 1 : 2);
      if (kit.id === 'zoro') this.vfx.slash(a.x, a.y + 1.1, a.z, a.yaw, 0x9fffb0, def.range * 0.7, -roll, 0.2);
    });
  }

  /** An ability: its charge, its body, its trail. Hits and explosions come separately from the server. */
  ability(ability: AbilityDef, anchor: Anchor, _local: boolean): void {
    const at = anchor();
    if (!at) return;
    const c = ability.color;
    const c2 = ability.color2;
    const e = ability.effect;
    const delay = 'delay' in e ? e.delay : 0;
    const x = at.x;
    const z = at.z;
    const front = (a: { x: number; y: number; z: number; yaw: number }, d: number): Vector3 =>
      new Vector3(a.x + Math.sin(a.yaw) * d, a.y + EYE, a.z + Math.cos(a.yaw) * d);

    switch (ability.vfx) {
      case 'slam':
        this.sound('jump', x, z);
        this.vfx.ring(at.x, at.y, at.z, 0xffffff, 4, 0.35);
        this.vfx.trail(anchor, 0x111111, 0.9, 0.04, 2, 1);
        break;
      case 'devilAura':
        this.sound('boom', x, z, 0.8);
        for (let i = 0; i < 8; i += 1) {
          const a = (i / 8) * Math.PI * 2;
          this.vfx.puff(at.x + Math.cos(a) * 2.5, at.y + 0.6, at.z + Math.sin(a) * 2.5, 0x140404, 3, 0.7, 3.5, 1, 0.75);
        }
        this.vfx.ring(at.x, at.y, at.z, 0xff2a2a, 9, 0.6);
        break;
      case 'flashStep':
        this.sound('whoosh', x, z);
        this.vfx.puff(at.x, at.y + EYE, at.z, 0xffffff, 3, 0.4, 0, 2, 0.8);
        break;
      case 'crescent':
        this.sound('charge', x, z, 0.7);
        this.vfx.charge(anchor, c, 2.5, delay + 0.05, 1.2, 2.2, false);
        this.after(delay, () => this.sound('swing', x, z));
        break;
      case 'stretch':
        this.after(delay - 0.08, () => {
          const a = anchor();
          if (!a) return;
          this.sound('whoosh', a.x, a.z);
          const hand = front(a, 0.8);
          this.vfx.beam(hand.x, hand.y, hand.z, a.yaw, 0, 20, 0.32, 0xffc9a0, 0.4, 0.35, 1);
          const fist = front(a, 20.5);
          this.after(0.1, () => this.vfx.burst(fist.x, fist.y, fist.z, 0xffffff, 2.8, 0.2));
        });
        break;
      case 'gatling':
        this.sound('punch', x, z, 0.6);
        if (e.type === 'barrage') this.vfx.barrage(anchor, 0xffc9a0, e.range, e.width ?? 5, e.duration + 0.1);
        break;
      case 'rasengan':
        this.sound('charge', x, z, 0.6);
        this.vfx.charge(anchor, c, 2.2, 0.62, 1.3, 1.4);
        this.after(0.22, () => {
          this.sound('whoosh', x, z);
          this.vfx.trail(anchor, c, 0.4, 0.03, 2);
        });
        break;
      case 'rasenshuriken':
        this.sound('wind', x, z);
        this.vfx.charge(anchor, 0xdff4ff, 3.2, delay + 0.05, 0.4, 4.2);
        break;
      case 'authority':
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          this.sound('boom', a.x, a.z, 0.6);
          this.vfx.cone(a.x, a.y + EYE, a.z, a.yaw, 17, 10, c, 0.5);
        });
        break;
      case 'arise':
        this.sound('charge', x, z, 0.6);
        this.vfx.ring(at.x, at.y, at.z, c, 6, 0.8);
        break;
      case 'spin':
        this.sound('wind', x, z, 0.7);
        this.vfx.whirl(anchor, ability.id === 'zoro_tatsumaki' ? 0xd8ffe0 : c, e.type === 'barrage' ? e.range : 7, e.type === 'barrage' ? e.duration + 0.1 : 1);
        if (ability.vfx === 'spin' && ability.id === 'zoro_tatsumaki') this.vfx.tornado(anchor, c2, 10, 14, 1.25);
        break;
      case 'tornado':
        this.sound('wind', x, z);
        this.vfx.tornado(anchor, c2, 10.5, 14, 1.25);
        this.vfx.whirl(anchor, 0xffffff, 9, 1.1);
        break;
      case 'spear':
        this.after(delay, () => this.sound('whoosh', x, z));
        break;
      case 'fireball':
        this.sound('fire', x, z, 0.6);
        this.vfx.charge(anchor, 0xff7a1a, 2, delay + 0.05, 1, 2.2);
        break;
      case 'chidori':
        this.sound('zap', x, z);
        this.vfx.charge(anchor, c, 2.4, 0.95, 1.1, 1.2, true);
        this.after(0.5, () => {
          this.sound('zap', x, z);
          this.vfx.trail(anchor, c, 0.5, 0.025, 2.2);
        });
        break;
      case 'divergent':
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          this.sound('punch', a.x, a.z);
          const p = front(a, 3);
          this.vfx.burst(p.x, p.y, p.z, c, 2.6, 0.2);
        });
        break;
      case 'blackFlash':
        this.sound('charge', x, z, 0.8);
        this.vfx.charge(anchor, 0xff2040, 1.6, delay, 1.2, 1.6, true);
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          const p = front(a, 3.5);
          this.vfx.sphere(p.x, p.y, p.z, 0x000000, 3.5, 0.35, 0.9, 1);
          for (let i = 0; i < 6; i += 1) {
            const to = p.clone().add(new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8));
            this.vfx.lightning(p, to, i % 2 ? 0xff2040 : 0x220005, 0.3, 1.5, 0.12);
          }
          this.sound('boom', a.x, a.z);
        });
        break;
      case 'airBullet':
        this.after(delay, () => this.sound('wind', x, z, 0.8));
        break;
      case 'shockCone':
        this.sound('charge', x, z, 0.8);
        this.vfx.charge(anchor, c, 2.2, delay, 0.9, 1.6, true);
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          this.sound('boom', a.x, a.z);
          this.vfx.cone(a.x, a.y + EYE, a.z, a.yaw, 24, 12, 0xffffff, 0.55);
          this.vfx.cone(a.x, a.y + EYE, a.z, a.yaw, 20, 8, c, 0.45);
          this.vfx.ring(a.x, a.y, a.z, 0xffffff, 10, 0.5);
        });
        break;
      case 'lightningPalm':
        this.sound('zap', x, z);
        break;
      case 'godspeed':
        this.sound('zap', x, z);
        for (let i = 0; i < 6; i += 1) {
          const from = new Vector3(at.x, at.y + EYE, at.z);
          const to = from.clone().add(new Vector3((Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7));
          this.vfx.lightning(from, to, c, 0.3);
        }
        this.vfx.ring(at.x, at.y, at.z, c, 7, 0.5);
        break;
      case 'oniGiri':
        this.after(0.18, () => {
          this.sound('swing', x, z);
          this.vfx.trail(anchor, 0xd8ffe0, 0.32, 0.03, 1.8);
        });
        this.after(0.5, () => {
          const a = anchor();
          if (!a) return;
          for (let i = 0; i < 3; i += 1) this.vfx.slash(a.x, a.y + 1.2 + i * 0.3, a.z, a.yaw + Math.PI, i === 1 ? 0x3bdc5a : 0xffffff, 5, (i - 1) * 0.6, 0.3, true);
        });
        break;
      case 'water':
        this.sound('wind', x, z, 0.5);
        break;
      case 'fireDance':
        this.sound('fire', x, z);
        this.vfx.trail(anchor, 0xff7a1a, 1.15, 0.025, 2.2);
        for (let k = 0; k < 3; k += 1) {
          this.after(0.15 + k * 0.36, () => {
            const a = anchor();
            if (!a) return;
            this.sound('swing', a.x, a.z);
            this.vfx.slash(a.x, a.y + 1.3, a.z, a.yaw, k === 2 ? 0xffd23d : 0xff7a1a, 6, (k - 1) * 0.7, 0.3, true);
          });
        }
        break;
      case 'dismantle':
        this.after(delay, () => this.sound('swing', x, z, 0.7));
        break;
      case 'shrine':
        this.sound('charge', x, z);
        this.after(delay, () => this.sound('boom', x, z));
        break;
      case 'blue':
        this.sound('charge', x, z, 0.6);
        break;
      case 'purple':
        this.sound('charge', x, z);
        // Red and blue gathering, then the sphere.
        this.vfx.charge(anchor, 0xff3030, 2.2, delay, 1.6, 2.1, false);
        this.vfx.charge(anchor, 0x3070ff, 2.2, delay, 1.6, 1.3, false);
        this.after(delay, () => this.sound('boom', x, z));
        break;
      case 'normalPunch':
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          this.sound('punch', a.x, a.z);
          const p = front(a, 3);
          this.vfx.burst(p.x, p.y, p.z, 0xffffff, 3.4, 0.2);
          this.vfx.ring(p.x, a.y + 0.5, p.z, 0xffffff, 4, 0.3);
        });
        break;
      case 'seriousPunch':
        this.sound('charge', x, z, 1);
        this.vfx.charge(anchor, 0xffffff, 2, delay, 1.1, 1.6, false);
        this.after(delay, () => {
          const a = anchor();
          if (!a) return;
          this.sound('boom', a.x, a.z);
          this.sound('wind', a.x, a.z);
          this.vfx.cone(a.x, a.y + EYE, a.z, a.yaw, 58, 14, 0xffffff, 0.8);
          this.vfx.cone(a.x, a.y + EYE, a.z, a.yaw, 50, 9, 0xffe27a, 0.6);
          this.vfx.sphere(a.x + Math.sin(a.yaw) * 3, a.y + EYE, a.z + Math.cos(a.yaw) * 3, 0xffffff, 6, 0.3, 0.9);
          for (let i = 0; i < 8; i += 1) {
            const d = 6 + i * 6;
            this.vfx.puff(a.x + Math.sin(a.yaw) * d, a.y + 0.8, a.z + Math.cos(a.yaw) * d, 0xd9c9a3, 5, 1, 3, 1, 0.6);
          }
        });
        break;
      default:
        break;
    }
  }

  /** One-off server effects: a slam landing, a flash-step strike, a counter, a teleport, chain lightning. */
  fx(message: FxMessage, color: number, color2: number): void {
    const { x, y, z } = message;
    switch (message.kind) {
      case 'slam': {
        const r = message.radius ?? 8;
        this.sound('boom', x, z);
        this.vfx.ring(x, y, z, color2, r * 1.3, 0.55);
        this.vfx.ring(x, y, z, 0xffffff, r, 0.4);
        this.vfx.sphere(x, y + 1, z, color, r * 0.6, 0.4, 0.8, 1);
        for (let i = 0; i < 8; i += 1) {
          const a = (i / 8) * Math.PI * 2;
          this.vfx.puff(x + Math.cos(a) * r * 0.7, y + 0.5, z + Math.sin(a) * r * 0.7, 0xd9c9a3, 4, 0.8, 2, 1, 0.7);
        }
        break;
      }
      case 'blinkStrike': {
        const r = message.radius ?? 5;
        this.sound('swing', x, z);
        this.vfx.slash(x, y - 0.3, z, Math.random() * Math.PI, color, r, 0.9, 0.3, true);
        this.vfx.slash(x, y - 0.3, z, Math.random() * Math.PI, color2, r * 0.9, -0.9, 0.3, true);
        this.vfx.burst(x, y, z, color, 3, 0.25);
        if (message.x2 !== undefined && message.z2 !== undefined) {
          this.vfx.line(new Vector3(message.x2, message.y2 ?? y, message.z2), new Vector3(x, y, z), 0.25, color2, 0.35);
        }
        break;
      }
      case 'counter': {
        this.sound('block', x, z);
        const from = new Vector3(x, y, z);
        const to = new Vector3(message.x2 ?? x, message.y2 ?? y, message.z2 ?? z);
        this.vfx.line(from, to, 0.35, 0x5ac8ff, 0.35);
        this.vfx.slash(to.x, to.y - 0.3, to.z, Math.atan2(to.x - from.x, to.z - from.z), 0x9fdcff, 5, 0.8, 0.35, true);
        this.vfx.burst(to.x, to.y, to.z, 0xffffff, 4, 0.3);
        break;
      }
      case 'teleport': {
        const from = new Vector3(x, y, z);
        const to = new Vector3(message.x2 ?? x, message.y2 ?? y, message.z2 ?? z);
        this.sound('zap', x, z);
        this.vfx.lightning(from, to, color, 0.3, 1.4, 0.12);
        this.vfx.puff(x, y, z, 0xffffff, 3, 0.4, 0, 2, 0.8);
        break;
      }
      case 'chain': {
        const from = new Vector3(x, y, z);
        const to = new Vector3(message.x2 ?? x, message.y2 ?? y, message.z2 ?? z);
        this.sound('zap', x, z, 0.6);
        this.vfx.lightning(from, to, 0x9fe8ff, 0.25, 1.2, 0.1);
        break;
      }
      case 'lungeEnd': {
        const r = message.radius ?? 4;
        this.sound('boom', x, z, 0.8);
        this.vfx.sphere(x, y, z, color, r, 0.45, 0.85);
        this.vfx.sphere(x, y, z, 0xffffff, r * 0.5, 0.3, 0.9);
        this.vfx.ring(x, y - 1.4, z, color, r * 1.6, 0.45);
        break;
      }
      case 'arise':
        this.sound('boom', x, z, 0.6);
        this.vfx.ring(x, y, z, 0x4d2bff, 8, 0.7);
        this.vfx.sphere(x, y + 1, z, 0x1a0a3a, 5, 0.6, 0.6, 1);
        break;
    }
  }
}
