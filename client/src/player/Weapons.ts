import type { WeaponId } from '@arena/shared';
import { CylinderGeometry, ConeGeometry, type Group } from 'three';
import { PartBuilder } from '../render/PartBuilder.js';

/**
 * THE WEAPONS, built from primitives and held in the avatar's hands. The
 * player's body is always their own Bloxity avatar; a kit only hands them a
 * blade. Each is built along +Y (grip at the origin, tip up) with its edge
 * facing +Z, the hand mount's frame. Cached per id and cloned per player.
 */
export interface WeaponSet {
  readonly right: Group | null;
  readonly left: Group | null;
  /** A blade clenched in the teeth (Zoro). */
  readonly mouth: Group | null;
}

const cache = new Map<string, Group>();

const build = (key: string, make: (b: PartBuilder) => void): Group => {
  let group = cache.get(key);
  if (!group) {
    const builder = new PartBuilder();
    make(builder);
    group = builder.build(`weapon-${key}`, true);
    cache.set(key, group);
  }
  return group.clone();
};

const katana = (b: PartBuilder, blade: number, edge: number, guard: number, grip: number, length = 2.5): void => {
  // Grip (wrapped), guard, blade and a bright edge.
  b.box(0.16, 0.7, 0.16, grip, 'smooth', { y: 0.05 });
  b.box(0.42, 0.08, 0.42, guard, 'smooth', { y: 0.44 });
  b.box(0.07, length, 0.2, blade, 'smooth', { y: 0.48 + length / 2 });
  b.box(0.05, length - 0.1, 0.05, edge, 'glow', { y: 0.48 + length / 2 - 0.05, z: 0.12 });
  b.add(new ConeGeometry(0.1, 0.3, 4), blade, 'smooth', { y: 0.48 + length + 0.12, sx: 0.7, sz: 2 });
};

export const createWeapons = (id: WeaponId): WeaponSet => {
  switch (id) {
    case 'greatsword':
      return {
        right: build('greatsword', (b) => {
          // Asta's demon-slayer: a massive, chipped black slab.
          b.box(0.2, 0.9, 0.2, 0x4a3a2a, 'smooth', { y: 0 });
          b.box(0.9, 0.18, 0.5, 0x3a3a44, 'smooth', { y: 0.5 });
          b.box(0.16, 3.5, 0.78, 0x18181c, 'smooth', { y: 2.35 });
          b.box(0.1, 3.3, 0.1, 0x55565e, 'smooth', { y: 2.3, z: 0.4 });
          for (let i = 0; i < 4; i += 1) b.box(0.18, 0.28, 0.22, 0x18181c, 'smooth', { y: 1.1 + i * 0.8, z: -0.46 });
          b.box(0.16, 0.5, 0.5, 0x18181c, 'smooth', { y: 4.2, z: 0.1, rx: 0.4 });
        }),
        left: null,
        mouth: null,
      };
    case 'cleaver':
      return {
        right: build('cleaver', (b) => {
          // Zangetsu: a wide cleaver with a silver edge and a cloth-wrapped tang.
          b.box(0.16, 0.9, 0.16, 0xf2f2f2, 'smooth', { y: 0 });
          b.box(0.1, 3.2, 0.9, 0x2a2d36, 'smooth', { y: 2.05 });
          b.box(0.12, 3.1, 0.16, 0xdfe6f0, 'smooth', { y: 2.0, z: 0.5 });
          b.box(0.1, 0.5, 0.9, 0x2a2d36, 'smooth', { y: 3.75, z: 0.05, rx: 0.35 });
        }),
        left: null,
        mouth: null,
      };
    case 'katana':
      return { right: build('katana', (b) => katana(b, 0xd8dde8, 0xffffff, 0x3a2a55, 0x4a3a6a)), left: null, mouth: null };
    case 'katanaBlack':
      return {
        right: build('katanaBlack', (b) => {
          katana(b, 0x16161c, 0x6fb8ff, 0x2a2a2a, 0x2a4a3a);
          // The chequered guard.
          b.box(0.44, 0.1, 0.44, 0xd0a040, 'smooth', { y: 0.44 });
        }),
        left: null,
        mouth: null,
      };
    case 'threeSwords':
      return {
        right: build('wado', (b) => katana(b, 0xe8ecf4, 0xffffff, 0xd0a040, 0xf4f4f4)),
        left: build('shusui', (b) => katana(b, 0x1a1a22, 0xff4040, 0xd0a040, 0x1a1a22)),
        mouth: build('kitetsu', (b) => katana(b, 0xd8dde8, 0xffffff, 0xd0a040, 0xc03030, 2.1)),
      };
    case 'daggers': {
      const dagger = (b: PartBuilder): void => {
        b.box(0.14, 0.5, 0.14, 0x1a1a24, 'smooth', { y: 0.05 });
        b.box(0.36, 0.08, 0.2, 0x3a3a5a, 'smooth', { y: 0.32 });
        b.box(0.06, 1.1, 0.22, 0x1c1c2c, 'smooth', { y: 0.92 });
        b.box(0.04, 1.0, 0.04, 0x8f7bff, 'glow', { y: 0.9, z: 0.13 });
        b.add(new ConeGeometry(0.1, 0.3, 4), 0x1c1c2c, 'smooth', { y: 1.6, sx: 0.6, sz: 2 });
      };
      return { right: build('daggerR', dagger), left: build('daggerL', dagger), mouth: null };
    }
    case 'polearm':
      return {
        right: build('polearm', (b) => {
          // Maki's cursed polearm: a long shaft, a curved blade on top, a butt cap below.
          b.add(new CylinderGeometry(0.09, 0.09, 5.2, 8), 0x3a2a1a, 'smooth', { y: 1.2 });
          b.box(0.3, 0.14, 0.3, 0xd0a040, 'smooth', { y: 3.8 });
          b.box(0.08, 1.4, 0.34, 0xdfe4ee, 'smooth', { y: 4.55, z: 0.06 });
          b.add(new ConeGeometry(0.16, 0.5, 4), 0xdfe4ee, 'smooth', { y: 5.4, z: 0.12, sx: 0.5, sz: 1.6 });
          b.box(0.22, 0.3, 0.22, 0xd0a040, 'smooth', { y: -1.4 });
        }),
        left: null,
        mouth: null,
      };
    case 'none':
      return { right: null, left: null, mouth: null };
  }
};
