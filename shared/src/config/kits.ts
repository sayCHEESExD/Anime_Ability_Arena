import type { MotionScript } from '../sim/PlayerSim.js';

/**
 * THE ABILITY KITS.
 *
 * A kit is a MOVESET, never a body: the player keeps their own Bloxity avatar
 * and the kit hands them a weapon (or none), an M1 style and two abilities -
 * E (a skill) and R (the ultimate). Attack, Dash and Jump are shared by all.
 *
 * Everything here is DATA both sides read: the server resolves every hit from
 * it (range, damage, knockback, stun) and the client draws from it (colours,
 * animation, how far a beam reaches). The client never decides a hit.
 */

export type KitId =
  | 'asta'
  | 'ichigo'
  | 'luffy'
  | 'naruto'
  | 'jinwoo'
  | 'maki'
  | 'sasuke'
  | 'yuji'
  | 'deku'
  | 'killua'
  | 'zoro'
  | 'tanjiro'
  | 'sukuna'
  | 'gojo'
  | 'saitama';

export const DEFAULT_KIT: KitId = 'asta';

/** What a single hit does to its victim. */
export interface HitSpec {
  readonly damage: number;
  /** Horizontal launch speed, away from the source. */
  readonly kb: number;
  /** Vertical launch speed. */
  readonly up: number;
  /** Seconds ragdolled and immobile. */
  readonly stun: number;
}

export type Shape = 'cone' | 'line' | 'circle';

export type AnimId =
  | 'heavyPunch'
  | 'stretchPunch'
  | 'castOne'
  | 'castTwo'
  | 'throw'
  | 'spin'
  | 'leap'
  | 'signs'
  | 'roar'
  | 'stance'
  | 'lunge'
  | 'barrage'
  | 'slashWide'
  | 'raise'
  | 'flick'
  | 'uppercut'
  | 'blink';

/** Hitbox in front of (or around) the caster, once or as a follow-up. */
export interface MeleeEffect {
  readonly type: 'melee';
  readonly delay: number;
  readonly shape: Shape;
  readonly range: number;
  /** Cone half-angle, radians. */
  readonly arc?: number;
  /** Line width. */
  readonly width?: number;
  /** Most victims (1 = the nearest only). */
  readonly maxTargets?: number;
  readonly hit: HitSpec;
  /** A second impact on the SAME victims, `delay` seconds after the first. */
  readonly followUp?: { readonly delay: number; readonly hit: HitSpec };
}

export interface ExplodeSpec {
  readonly radius: number;
  readonly hit: HitSpec;
}

export interface ZoneSpec {
  readonly radius: number;
  readonly duration: number;
  readonly tick: number;
  readonly hit: HitSpec;
  /** Pull toward the centre, units per second, applied each tick. */
  readonly pull?: number;
  /** The zone rides on its caster. */
  readonly follow?: boolean;
  /** A last blast when it ends. */
  readonly final?: HitSpec;
  /** Height of the centre above the ground it was placed on. */
  readonly lift?: number;
}

export interface ProjectileEffect {
  readonly type: 'projectile';
  readonly delay: number;
  readonly speed: number;
  readonly range: number;
  readonly radius: number;
  readonly count?: number;
  /** Radians between projectiles of a fan. */
  readonly spread?: number;
  readonly pierce: boolean;
  readonly hit: HitSpec;
  readonly explode?: ExplodeSpec;
  /** A zone left where it stops. */
  readonly zone?: ZoneSpec;
}

/** The caster's own lunge (from the motion script) is the hitbox. */
export interface LungeEffect {
  readonly type: 'lunge';
  readonly radius: number;
  readonly pierce: boolean;
  readonly hit: HitSpec;
  readonly explode?: ExplodeSpec;
}

/** A leap whose landing is an area hit. */
export interface SlamEffect {
  readonly type: 'slam';
  readonly radius: number;
  readonly hit: HitSpec;
}

/** Blink (motion script) then strike round the arrival point. */
export interface BlinkStrikeEffect {
  readonly type: 'blinkStrike';
  readonly delay: number;
  readonly radius: number;
  readonly hit: HitSpec;
}

/** Appear behind the nearest enemy in range and strike. Server-driven movement. */
export interface TargetBlinkEffect {
  readonly type: 'targetBlink';
  readonly range: number;
  readonly radius: number;
  readonly hit: HitSpec;
  /** Blink this far forward when nobody is in range. */
  readonly fallback: number;
}

export type BuffId = 'devil' | 'godspeed';

export interface BuffEffect {
  readonly type: 'buff';
  readonly buff: BuffId;
  readonly duration: number;
}

export interface SummonEffect {
  readonly type: 'summon';
  readonly count: number;
  readonly duration: number;
  readonly speed: number;
  /** How far a summon looks for prey. */
  readonly seek: number;
  readonly reach: number;
  readonly cooldown: number;
  readonly hit: HitSpec;
}

export interface CounterEffect {
  readonly type: 'counter';
  readonly window: number;
  readonly hit: HitSpec;
}

export interface BarrageEffect {
  readonly type: 'barrage';
  readonly delay: number;
  readonly duration: number;
  readonly interval: number;
  readonly shape: Shape;
  readonly range: number;
  readonly arc?: number;
  readonly width?: number;
  readonly hit: HitSpec;
  readonly final: HitSpec;
}

export interface ZoneEffect {
  readonly type: 'zone';
  readonly delay: number;
  /** 0 = on the caster, else this far in front. */
  readonly distance: number;
  readonly zone: ZoneSpec;
}

/** A chain of auto-aimed lunges, driven by the server. */
export interface ChainLungeEffect {
  readonly type: 'chainLunge';
  readonly count: number;
  readonly interval: number;
  readonly speed: number;
  readonly time: number;
  readonly seek: number;
  readonly radius: number;
  readonly hit: HitSpec;
  readonly final: HitSpec;
}

export type AbilityEffect =
  | MeleeEffect
  | ProjectileEffect
  | LungeEffect
  | SlamEffect
  | BlinkStrikeEffect
  | TargetBlinkEffect
  | BuffEffect
  | SummonEffect
  | CounterEffect
  | BarrageEffect
  | ZoneEffect
  | ChainLungeEffect;

export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cooldown: number;
  readonly anim: AnimId;
  /** How long the cast animation plays. */
  readonly animTime: number;
  readonly motion?: MotionScript;
  readonly effect: AbilityEffect;
  /** Main VFX colour, and a second one. */
  readonly color: number;
  readonly color2: number;
  /** The VFX recipe the client plays. */
  readonly vfx: string;
}

export type WeaponId = 'none' | 'greatsword' | 'cleaver' | 'katana' | 'katanaBlack' | 'threeSwords' | 'daggers' | 'polearm';
export type M1Style = 'fist' | 'sword' | 'dagger' | 'polearm';

export interface KitDef {
  readonly id: KitId;
  readonly name: string;
  readonly price: number;
  readonly weapon: WeaponId;
  readonly m1: M1Style;
  /** Where its pedestal stands on the walkway (-1: the default kit has none). */
  readonly pedestal: number;
  readonly isNew?: boolean;
  /** The portrait's burst colours. */
  readonly colors: readonly [string, string];
  readonly skill: AbilityDef;
  readonly ultimate: AbilityDef;
}

// -------------------------------------------------------------------- M1

export interface M1Def {
  readonly range: number;
  readonly arc: number;
  readonly cooldown: number;
  readonly hit: HitSpec;
  /** Every third swing hits harder. */
  readonly finisher: HitSpec;
}

const deg = (d: number): number => (d * Math.PI) / 180;

export const M1: Readonly<Record<M1Style, M1Def>> = {
  fist: {
    range: 5.4,
    arc: deg(60),
    cooldown: 0.42,
    hit: { damage: 5, kb: 24, up: 14, stun: 0.75 },
    finisher: { damage: 7, kb: 32, up: 18, stun: 0.9 },
  },
  sword: {
    range: 6.8,
    arc: deg(65),
    cooldown: 0.5,
    hit: { damage: 6, kb: 25, up: 14, stun: 0.75 },
    finisher: { damage: 8, kb: 34, up: 18, stun: 0.9 },
  },
  dagger: {
    range: 5.2,
    arc: deg(62),
    cooldown: 0.34,
    hit: { damage: 4, kb: 21, up: 12, stun: 0.7 },
    finisher: { damage: 6, kb: 30, up: 16, stun: 0.85 },
  },
  polearm: {
    range: 7.8,
    arc: deg(75),
    cooldown: 0.56,
    hit: { damage: 6, kb: 27, up: 14, stun: 0.8 },
    finisher: { damage: 8, kb: 35, up: 18, stun: 0.95 },
  },
};

// ------------------------------------------------------------------ buffs

export interface BuffDef {
  readonly name: string;
  readonly speedMul: number;
  readonly dashCdMul: number;
  readonly damageMul: number;
  readonly kbMul: number;
  /** Immune to knockback and stun (damage still lands). */
  readonly armor: boolean;
  /** Each M1 also throws a short black slash wave. */
  readonly m1Wave: boolean;
  /** Each M1 hit arcs lightning to nearby enemies. */
  readonly chain?: { readonly count: number; readonly radius: number; readonly hit: HitSpec };
  readonly color: number;
}

export const BUFFS: Readonly<Record<BuffId, BuffDef>> = {
  devil: { name: 'Devil Union', speedMul: 1.12, dashCdMul: 1, damageMul: 1.7, kbMul: 1.35, armor: true, m1Wave: true, color: 0x1a0d0d },
  godspeed: {
    name: 'Godspeed',
    speedMul: 1.65,
    dashCdMul: 0.4,
    damageMul: 1,
    kbMul: 1,
    armor: false,
    m1Wave: false,
    chain: { count: 2, radius: 11, hit: { damage: 5, kb: 12, up: 10, stun: 0.6 } },
    color: 0x7fd8ff,
  },
};

/** The black wave an M1 throws during Devil Union. */
export const DEVIL_WAVE = { speed: 60, range: 20, radius: 2.4, hit: { damage: 5, kb: 26, up: 12, stun: 0.7 } } as const;

// ------------------------------------------------------------------- kits

export const KITS: readonly KitDef[] = [
  {
    id: 'asta',
    name: 'Asta',
    price: 0,
    weapon: 'greatsword',
    m1: 'sword',
    pedestal: -1,
    colors: ['#ff4444', '#7a0c0c'],
    skill: {
      id: 'asta_meteorite',
      name: 'Black Meteorite',
      description: 'Leap high and crash down, sword first. The landing launches everyone around you.',
      cooldown: 6,
      anim: 'leap',
      animTime: 1.1,
      motion: { kind: 'leap', speed: 24, up: 34, delay: 0.08, slam: true },
      effect: { type: 'slam', radius: 9.5, hit: { damage: 16, kb: 44, up: 24, stun: 1.1 } },
      color: 0x111111,
      color2: 0xff3b3b,
      vfx: 'slam',
    },
    ultimate: {
      id: 'asta_devil',
      name: 'Devil Union',
      description: 'Black form for 6s: unstoppable (no knockback), +70% damage, and every swing throws a black slash.',
      cooldown: 16,
      anim: 'roar',
      animTime: 0.8,
      motion: { lock: 0.6 },
      effect: { type: 'buff', buff: 'devil', duration: 6 },
      color: 0x0d0d0d,
      color2: 0xff2a2a,
      vfx: 'devilAura',
    },
  },
  {
    id: 'ichigo',
    name: 'Ichigo',
    price: 250,
    weapon: 'cleaver',
    m1: 'sword',
    pedestal: 6,
    colors: ['#ff8a2a', '#8a2a00'],
    skill: {
      id: 'ichigo_flashstep',
      name: 'Flash Step',
      description: 'Vanish and reappear 16 studs ahead, cutting everyone around the landing spot.',
      cooldown: 5,
      anim: 'blink',
      animTime: 0.45,
      motion: { kind: 'blink', speed: 16, delay: 0.05, lock: 0.3 },
      effect: { type: 'blinkStrike', delay: 0.1, radius: 6.5, hit: { damage: 12, kb: 34, up: 16, stun: 1 } },
      color: 0xffffff,
      color2: 0x66ccff,
      vfx: 'flashStep',
    },
    ultimate: {
      id: 'ichigo_getsuga',
      name: 'Getsuga Tensho',
      description: 'Swing a huge crescent of spirit energy that tears through every enemy in its path.',
      cooldown: 8,
      anim: 'slashWide',
      animTime: 0.6,
      motion: { lock: 0.5 },
      effect: {
        type: 'projectile',
        delay: 0.3,
        speed: 72,
        range: 75,
        radius: 3.6,
        pierce: true,
        hit: { damage: 24, kb: 55, up: 22, stun: 1.2 },
      },
      color: 0x7fd4ff,
      color2: 0x0b1030,
      vfx: 'crescent',
    },
  },
  {
    id: 'luffy',
    name: 'Luffy',
    price: 500,
    weapon: 'none',
    m1: 'fist',
    pedestal: 5,
    colors: ['#ff4d4d', '#ffd23d'],
    skill: {
      id: 'luffy_pistol',
      name: 'Gum-Gum Pistol',
      description: 'Stretch your arm 20 studs out and slug the first enemy it reaches.',
      cooldown: 4,
      anim: 'stretchPunch',
      animTime: 0.55,
      motion: { lock: 0.4 },
      effect: { type: 'melee', delay: 0.14, shape: 'line', range: 21, width: 2.8, maxTargets: 1, hit: { damage: 14, kb: 50, up: 14, stun: 1 } },
      color: 0xffc9a0,
      color2: 0xff4d4d,
      vfx: 'stretch',
    },
    ultimate: {
      id: 'luffy_gatling',
      name: 'Gum-Gum Gatling',
      description: 'Plant your feet and unleash a storm of rubber punches, ending in a launcher.',
      cooldown: 10,
      anim: 'barrage',
      animTime: 1.35,
      motion: { lock: 1.35 },
      effect: {
        type: 'barrage',
        delay: 0.1,
        duration: 1.1,
        interval: 0.1,
        shape: 'line',
        range: 10,
        width: 6,
        hit: { damage: 3, kb: 7, up: 5, stun: 0.45 },
        final: { damage: 10, kb: 62, up: 24, stun: 1.2 },
      },
      color: 0xffc9a0,
      color2: 0xffffff,
      vfx: 'gatling',
    },
  },
  {
    id: 'naruto',
    name: 'Naruto',
    price: 1250,
    weapon: 'none',
    m1: 'fist',
    pedestal: 4,
    colors: ['#ff9a1f', '#1f5bff'],
    skill: {
      id: 'naruto_rasengan',
      name: 'Rasengan',
      description: 'Charge forward with a spinning sphere of chakra that bursts on the first enemy it meets.',
      cooldown: 6,
      anim: 'lunge',
      animTime: 0.75,
      motion: { kind: 'lunge', delay: 0.22, speed: 50, time: 0.4, up: 0, grav: 0, lock: 0.22 },
      effect: {
        type: 'lunge',
        radius: 2.8,
        pierce: false,
        hit: { damage: 20, kb: 58, up: 26, stun: 1.2 },
        explode: { radius: 5, hit: { damage: 8, kb: 34, up: 18, stun: 0.9 } },
      },
      color: 0x5fb8ff,
      color2: 0xffffff,
      vfx: 'rasengan',
    },
    ultimate: {
      id: 'naruto_rasenshuriken',
      name: 'Rasenshuriken',
      description: 'Hurl a wind-blade shuriken. Where it lands it grinds everyone caught inside, then detonates.',
      cooldown: 11,
      anim: 'throw',
      animTime: 0.8,
      motion: { lock: 0.6 },
      effect: {
        type: 'projectile',
        delay: 0.45,
        speed: 44,
        range: 60,
        radius: 2.2,
        pierce: false,
        hit: { damage: 6, kb: 4, up: 4, stun: 0.6 },
        zone: { radius: 8, duration: 1.3, tick: 0.15, hit: { damage: 2, kb: 0, up: 3, stun: 0.5 }, pull: 12, final: { damage: 12, kb: 56, up: 32, stun: 1.25 }, lift: 1.6 },
      },
      color: 0xbfe8ff,
      color2: 0x3f9bff,
      vfx: 'rasenshuriken',
    },
  },
  {
    id: 'jinwoo',
    name: 'Jin-Woo',
    price: 2500,
    weapon: 'daggers',
    m1: 'dagger',
    pedestal: 3,
    colors: ['#6b3bff', '#0a0620'],
    skill: {
      id: 'jinwoo_authority',
      name: "Ruler's Authority",
      description: 'Seize everyone in a cone with invisible force and hurl them into the sky.',
      cooldown: 6,
      anim: 'castOne',
      animTime: 0.6,
      motion: { lock: 0.45 },
      effect: { type: 'melee', delay: 0.25, shape: 'cone', range: 17, arc: deg(38), hit: { damage: 10, kb: 6, up: 44, stun: 1.4 } },
      color: 0x9b7bff,
      color2: 0xffffff,
      vfx: 'authority',
    },
    ultimate: {
      id: 'jinwoo_arise',
      name: 'Arise',
      description: 'Raise three shadow soldiers from the ground. For 8s they hunt down your nearest enemies.',
      cooldown: 18,
      anim: 'raise',
      animTime: 0.9,
      motion: { lock: 0.8 },
      effect: { type: 'summon', count: 3, duration: 8, speed: 21, seek: 45, reach: 3.6, cooldown: 0.9, hit: { damage: 5, kb: 24, up: 13, stun: 0.75 } },
      color: 0x4d2bff,
      color2: 0x9fd0ff,
      vfx: 'arise',
    },
  },
  {
    id: 'maki',
    name: 'Maki',
    price: 4500,
    weapon: 'polearm',
    m1: 'polearm',
    pedestal: 2,
    colors: ['#3bd16b', '#0c3a1c'],
    skill: {
      id: 'maki_cloud',
      name: 'Playful Cloud',
      description: 'Whirl the three-section staff around you for a second while you move, battering everyone nearby.',
      cooldown: 6,
      anim: 'spin',
      animTime: 1.1,
      motion: { slow: 1.1 },
      effect: {
        type: 'barrage',
        delay: 0.05,
        duration: 1,
        interval: 0.2,
        shape: 'circle',
        range: 7.5,
        hit: { damage: 4, kb: 18, up: 10, stun: 0.6 },
        final: { damage: 6, kb: 44, up: 20, stun: 1 },
      },
      color: 0xd8f5d0,
      color2: 0x3bd16b,
      vfx: 'spin',
    },
    ultimate: {
      id: 'maki_spear',
      name: 'Heavenly Spear',
      description: 'Throw a cursed spear at blinding speed. Whoever it skewers is pinned for nearly two seconds.',
      cooldown: 8,
      anim: 'throw',
      animTime: 0.6,
      motion: { lock: 0.4 },
      effect: { type: 'projectile', delay: 0.25, speed: 115, range: 95, radius: 1.4, pierce: false, hit: { damage: 22, kb: 40, up: 10, stun: 1.9 } },
      color: 0xd0d0d0,
      color2: 0x2b2b2b,
      vfx: 'spear',
    },
  },
  {
    id: 'sasuke',
    name: 'Sasuke',
    price: 7500,
    weapon: 'katana',
    m1: 'sword',
    pedestal: 1,
    colors: ['#8a3bff', '#1a0b3a'],
    skill: {
      id: 'sasuke_fireball',
      name: 'Great Fireball',
      description: 'Breathe a huge fireball that explodes on contact, blasting everyone around it.',
      cooldown: 6,
      anim: 'signs',
      animTime: 0.7,
      motion: { lock: 0.5 },
      effect: {
        type: 'projectile',
        delay: 0.35,
        speed: 36,
        range: 55,
        radius: 2.8,
        pierce: false,
        hit: { damage: 8, kb: 20, up: 10, stun: 0.8 },
        explode: { radius: 7.5, hit: { damage: 14, kb: 46, up: 24, stun: 1.1 } },
      },
      color: 0xff7a1a,
      color2: 0xffe04a,
      vfx: 'fireball',
    },
    ultimate: {
      id: 'sasuke_chidori',
      name: 'Chidori',
      description: 'Gather a thousand birds of lightning, then pierce straight through everything in a 35-stud line.',
      cooldown: 10,
      anim: 'lunge',
      animTime: 1,
      motion: { kind: 'lunge', delay: 0.5, speed: 76, time: 0.46, up: 0, grav: 0, lock: 0.5 },
      effect: { type: 'lunge', radius: 3, pierce: true, hit: { damage: 28, kb: 60, up: 20, stun: 1.4 } },
      color: 0x9fdcff,
      color2: 0x2b6bff,
      vfx: 'chidori',
    },
  },
  {
    id: 'yuji',
    name: 'Yuji Itadori',
    price: 10000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 0,
    isNew: true,
    colors: ['#ff4d6d', '#2a0a12'],
    skill: {
      id: 'yuji_divergent',
      name: 'Divergent Fist',
      description: 'A punch whose cursed energy lands a beat later - a second, far heavier impact on the same target.',
      cooldown: 5,
      anim: 'heavyPunch',
      animTime: 0.5,
      motion: { lock: 0.35 },
      effect: {
        type: 'melee',
        delay: 0.1,
        shape: 'cone',
        range: 6.4,
        arc: deg(50),
        hit: { damage: 7, kb: 8, up: 5, stun: 0.6 },
        followUp: { delay: 0.3, hit: { damage: 13, kb: 48, up: 22, stun: 1.15 } },
      },
      color: 0x5ad0ff,
      color2: 0xffffff,
      vfx: 'divergent',
    },
    ultimate: {
      id: 'yuji_blackflash',
      name: 'Black Flash',
      description: 'Focus, step in and land a perfectly timed punch - black lightning, colossal damage.',
      cooldown: 10,
      anim: 'heavyPunch',
      animTime: 0.9,
      motion: { kind: 'lunge', delay: 0.42, speed: 20, time: 0.12, up: 0, grav: 0, lock: 0.7 },
      effect: { type: 'melee', delay: 0.52, shape: 'cone', range: 7.6, arc: deg(60), hit: { damage: 34, kb: 82, up: 30, stun: 1.4 } },
      color: 0x0a0a0a,
      color2: 0xff2040,
      vfx: 'blackFlash',
    },
  },
  {
    id: 'deku',
    name: 'Deku',
    price: 12000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 7,
    colors: ['#2ee88a', '#0a4a2a'],
    skill: {
      id: 'deku_delaware',
      name: 'Delaware Smash',
      description: 'Flick an air bullet. Light damage, but it blows its target away.',
      cooldown: 5,
      anim: 'flick',
      animTime: 0.45,
      motion: { lock: 0.3 },
      effect: { type: 'projectile', delay: 0.14, speed: 95, range: 60, radius: 2.3, pierce: false, hit: { damage: 8, kb: 72, up: 18, stun: 1 } },
      color: 0xdffff0,
      color2: 0x2ee88a,
      vfx: 'airBullet',
    },
    ultimate: {
      id: 'deku_detroit',
      name: 'Detroit Smash',
      description: 'Wind up One For All and punch - a shockwave that flattens everything in a huge cone.',
      cooldown: 11,
      anim: 'heavyPunch',
      animTime: 1,
      motion: { lock: 0.85 },
      effect: { type: 'melee', delay: 0.5, shape: 'cone', range: 23, arc: deg(34), hit: { damage: 26, kb: 92, up: 28, stun: 1.3 } },
      color: 0x2ee88a,
      color2: 0xfff27a,
      vfx: 'shockCone',
    },
  },
  {
    id: 'killua',
    name: 'Killua',
    price: 15000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 8,
    colors: ['#6fd8ff', '#0b2a4a'],
    skill: {
      id: 'killua_palm',
      name: 'Lightning Palm',
      description: 'Flicker to the back of the nearest enemy within 26 studs and strike with a lightning palm.',
      cooldown: 6,
      anim: 'blink',
      animTime: 0.45,
      motion: { lock: 0.3 },
      effect: { type: 'targetBlink', range: 26, radius: 4, hit: { damage: 14, kb: 42, up: 16, stun: 1 }, fallback: 12 },
      color: 0x9fe8ff,
      color2: 0xffffff,
      vfx: 'lightningPalm',
    },
    ultimate: {
      id: 'killua_godspeed',
      name: 'Godspeed',
      description: 'For 7s: move 65% faster, dash far more often, and every punch arcs lightning to nearby enemies.',
      cooldown: 15,
      anim: 'roar',
      animTime: 0.6,
      motion: { lock: 0.4 },
      effect: { type: 'buff', buff: 'godspeed', duration: 7 },
      color: 0x7fd8ff,
      color2: 0xffffff,
      vfx: 'godspeed',
    },
  },
  {
    id: 'zoro',
    name: 'Zoro',
    price: 18000,
    weapon: 'threeSwords',
    m1: 'sword',
    pedestal: 9,
    colors: ['#3bdc5a', '#0c3a14'],
    skill: {
      id: 'zoro_onigiri',
      name: 'Oni Giri',
      description: 'Three-sword dash straight through your enemies, cutting all of them.',
      cooldown: 5,
      anim: 'lunge',
      animTime: 0.6,
      motion: { kind: 'lunge', delay: 0.18, speed: 66, time: 0.3, up: 0, grav: 0, lock: 0.18 },
      effect: { type: 'lunge', radius: 3, pierce: true, hit: { damage: 16, kb: 36, up: 14, stun: 1 } },
      color: 0xffffff,
      color2: 0x3bdc5a,
      vfx: 'oniGiri',
    },
    ultimate: {
      id: 'zoro_tatsumaki',
      name: 'Tatsumaki',
      description: 'Spin your blades into a tornado that sucks up everyone around you, then flings them away.',
      cooldown: 10,
      anim: 'spin',
      animTime: 1.25,
      motion: { lock: 1.25 },
      effect: {
        type: 'barrage',
        delay: 0.1,
        duration: 1,
        interval: 0.2,
        shape: 'circle',
        range: 10.5,
        hit: { damage: 4, kb: -10, up: 20, stun: 0.8 },
        final: { damage: 12, kb: 56, up: 32, stun: 1.3 },
      },
      color: 0xd8ffe0,
      color2: 0x3bdc5a,
      vfx: 'tornado',
    },
  },
  {
    id: 'tanjiro',
    name: 'Tanjiro',
    price: 26000,
    weapon: 'katanaBlack',
    m1: 'sword',
    pedestal: 10,
    colors: ['#3bb0ff', '#0a1f3a'],
    skill: {
      id: 'tanjiro_deadcalm',
      name: 'Dead Calm',
      description: 'Water Breathing counter stance for 1s. The first hit you take is parried and the attacker is cut down.',
      cooldown: 7,
      anim: 'stance',
      animTime: 1,
      motion: { lock: 1 },
      effect: { type: 'counter', window: 1, hit: { damage: 20, kb: 55, up: 22, stun: 1.3 } },
      color: 0x5ac8ff,
      color2: 0xffffff,
      vfx: 'water',
    },
    ultimate: {
      id: 'tanjiro_hinokami',
      name: 'Hinokami Kagura',
      description: 'The Dance of the Fire God: three blazing dash-slashes, each homing on the nearest enemy.',
      cooldown: 12,
      anim: 'lunge',
      animTime: 1.2,
      motion: { lock: 1.15 },
      effect: {
        type: 'chainLunge',
        count: 3,
        interval: 0.36,
        speed: 62,
        time: 0.24,
        seek: 20,
        radius: 3.2,
        hit: { damage: 11, kb: 26, up: 14, stun: 0.9 },
        final: { damage: 14, kb: 62, up: 26, stun: 1.3 },
      },
      color: 0xff7a1a,
      color2: 0xffd23d,
      vfx: 'fireDance',
    },
  },
  {
    id: 'sukuna',
    name: 'Sukuna',
    price: 37000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 11,
    isNew: true,
    colors: ['#ff5ab8', '#3a0a1f'],
    skill: {
      id: 'sukuna_dismantle',
      name: 'Dismantle',
      description: 'Flick three invisible slashes in a fan. Each one cuts the first enemy it meets.',
      cooldown: 5,
      anim: 'castOne',
      animTime: 0.45,
      motion: { lock: 0.3 },
      effect: { type: 'projectile', delay: 0.14, speed: 88, range: 50, radius: 1.7, count: 3, spread: deg(13), pierce: false, hit: { damage: 8, kb: 26, up: 10, stun: 0.8 } },
      color: 0xffffff,
      color2: 0xff3b6b,
      vfx: 'dismantle',
    },
    ultimate: {
      id: 'sukuna_shrine',
      name: 'Malevolent Shrine',
      description: 'Expand your domain for 4.5s: everyone within 18 studs of you is slashed over and over.',
      cooldown: 18,
      anim: 'signs',
      animTime: 0.8,
      motion: { lock: 0.7 },
      effect: {
        type: 'zone',
        delay: 0.6,
        distance: 0,
        zone: { radius: 18, duration: 4.5, tick: 0.3, hit: { damage: 3, kb: 3, up: 6, stun: 0.5 }, follow: true, final: { damage: 6, kb: 40, up: 20, stun: 1 } },
      },
      color: 0xff2a4a,
      color2: 0x1a0005,
      vfx: 'shrine',
    },
  },
  {
    id: 'gojo',
    name: 'Gojo',
    price: 55000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 12,
    colors: ['#3b8bff', '#b43bff'],
    skill: {
      id: 'gojo_blue',
      name: 'Lapse Blue',
      description: 'Open a point of attraction 12 studs ahead. It drags everyone nearby into itself, then implodes.',
      cooldown: 7,
      anim: 'castOne',
      animTime: 0.5,
      motion: { lock: 0.35 },
      effect: {
        type: 'zone',
        delay: 0.2,
        distance: 12,
        zone: { radius: 12, duration: 1.6, tick: 0.1, hit: { damage: 1, kb: 0, up: 2, stun: 0.3 }, pull: 34, final: { damage: 8, kb: 20, up: 26, stun: 1 }, lift: 2 },
      },
      color: 0x2b7bff,
      color2: 0xbfe0ff,
      vfx: 'blue',
    },
    ultimate: {
      id: 'gojo_purple',
      name: 'Hollow Purple',
      description: 'Collide Blue and Red into imaginary mass: a colossal sphere that erases everything in its path.',
      cooldown: 14,
      anim: 'castTwo',
      animTime: 1.2,
      motion: { lock: 1 },
      effect: { type: 'projectile', delay: 0.8, speed: 34, range: 85, radius: 5.2, pierce: true, hit: { damage: 32, kb: 85, up: 26, stun: 1.4 } },
      color: 0xa23bff,
      color2: 0xffffff,
      vfx: 'purple',
    },
  },
  {
    id: 'saitama',
    name: 'Saitama',
    price: 70000,
    weapon: 'none',
    m1: 'fist',
    pedestal: 13,
    colors: ['#ffd23d', '#ff3b3b'],
    skill: {
      id: 'saitama_normal',
      name: 'Normal Punch',
      description: 'Just a normal punch. Whoever takes it goes flying.',
      cooldown: 4,
      anim: 'heavyPunch',
      animTime: 0.4,
      motion: { lock: 0.25 },
      effect: { type: 'melee', delay: 0.08, shape: 'cone', range: 5.8, arc: deg(42), maxTargets: 1, hit: { damage: 12, kb: 98, up: 30, stun: 1.2 } },
      color: 0xffffff,
      color2: 0xffd23d,
      vfx: 'normalPunch',
    },
    ultimate: {
      id: 'saitama_serious',
      name: 'Serious Punch',
      description: 'Get serious. After a moment, a punch whose shockwave sweeps a 55-stud line clean.',
      cooldown: 16,
      anim: 'heavyPunch',
      animTime: 1.2,
      motion: { lock: 1.05 },
      effect: { type: 'melee', delay: 0.72, shape: 'line', range: 55, width: 13, hit: { damage: 40, kb: 150, up: 44, stun: 1.6 } },
      color: 0xffffff,
      color2: 0xffe27a,
      vfx: 'seriousPunch',
    },
  },
];

const BY_ID = new Map<string, KitDef>(KITS.map((kit) => [kit.id, kit]));

export const kitById = (id: string): KitDef | undefined => BY_ID.get(id);

export const isKitId = (id: unknown): id is KitId => typeof id === 'string' && BY_ID.has(id);

/** The kit on walkway pedestal `slot`. */
export const kitOnPedestal = (slot: number): KitDef | undefined => KITS.find((kit) => kit.pedestal === slot);

/** Ability slots, as sent in an input. */
export const ACT = { none: 0, attack: 1, skill: 2, ultimate: 3 } as const;
export type ActSlot = 1 | 2 | 3;

export const abilityOf = (kit: KitDef, slot: ActSlot): AbilityDef | null =>
  slot === ACT.skill ? kit.skill : slot === ACT.ultimate ? kit.ultimate : null;
