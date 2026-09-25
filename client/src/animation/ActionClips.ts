import type { AnimId, M1Style } from '@arena/shared';
import type { PoseDefinition } from './PoseBuffer.js';

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * ACTION CLIPS: every attack and ability animation, as a few keyed poses.
 *
 * Rotations are in CHARACTER space (see `PlayerRig`): +X pitch swings a limb
 * BACKWARD, so an arm punched straight forward is about -90 degrees X. A clip
 * either drives the UPPER body over the legs' own cycle (so the player can
 * swing while running) or the FULL body. `spin` turns the whole body around
 * during the clip; `lean` tips it forward.
 */
export interface ActionKey {
  readonly t: number;
  readonly pose: PoseDefinition;
}

export interface ActionClip {
  readonly keys: readonly ActionKey[];
  readonly body: 'upper' | 'full';
  /** Whole turns of spin over the clip. */
  readonly spin?: number;
  /** Forward lean at the clip's peak, radians. */
  readonly lean?: number;
  /** Rapid alternating punches: a procedural barrage. */
  readonly barrage?: boolean;
}

const k = (t: number, pose: PoseDefinition): ActionKey => ({ t, pose });

const REST_R: PoseDefinition = { ArmR1: { x: deg(-10), z: deg(-8) }, ArmR2: { x: deg(20) } };

// ---------------------------------------------------------------- M1 combos

const JAB_R: ActionClip = {
  body: 'upper',
  lean: deg(6),
  keys: [
    k(0, { ArmR1: { x: deg(-30), z: deg(-20) }, ArmR2: { x: deg(100) }, Spine1: { y: deg(18) } }),
    k(0.35, { ArmR1: { x: deg(-92), z: deg(4) }, ArmR2: { x: deg(4) }, ArmL1: { x: deg(-40), z: deg(20) }, ArmL2: { x: deg(90) }, Spine1: { y: deg(-22) } }),
    k(1, REST_R),
  ],
};
const JAB_L: ActionClip = {
  body: 'upper',
  lean: deg(6),
  keys: [
    k(0, { ArmL1: { x: deg(-30), z: deg(20) }, ArmL2: { x: deg(100) }, Spine1: { y: deg(-18) } }),
    k(0.35, { ArmL1: { x: deg(-92), z: deg(-4) }, ArmL2: { x: deg(4) }, ArmR1: { x: deg(-40), z: deg(-20) }, ArmR2: { x: deg(90) }, Spine1: { y: deg(22) } }),
    k(1, {}),
  ],
};
const KICK: ActionClip = {
  body: 'full',
  keys: [
    k(0, { LegR1: { x: deg(20) }, LegR2: { x: deg(60) }, ArmL1: { x: deg(-30), z: deg(30) }, ArmR1: { x: deg(-30), z: deg(-30) }, Spine1: { x: deg(-6) } }),
    k(0.35, { LegR1: { x: deg(-100) }, LegR2: { x: deg(0) }, LegL1: { x: deg(10) }, ArmL1: { x: deg(-10), z: deg(60) }, ArmR1: { x: deg(20), z: deg(-60) }, Spine1: { x: deg(-14) } }),
    k(1, {}),
  ],
};

const SLASH_A: ActionClip = {
  body: 'upper',
  lean: deg(8),
  keys: [
    k(0, { ArmR1: { x: deg(-80), y: deg(20), z: deg(-80) }, ArmR2: { x: deg(40) }, Spine1: { y: deg(32) }, Spine2: { y: deg(16) } }),
    k(0.4, { ArmR1: { x: deg(-65), y: deg(-18), z: deg(45) }, ArmR2: { x: deg(6) }, Spine1: { y: deg(-32), x: deg(12) }, Spine2: { y: deg(-16) } }),
    k(1, { ArmR1: { x: deg(-34), z: deg(-14) }, ArmR2: { x: deg(52) } }),
  ],
};
const SLASH_B: ActionClip = {
  body: 'upper',
  lean: deg(8),
  keys: [
    k(0, { ArmR1: { x: deg(-66), y: deg(-16), z: deg(40) }, ArmR2: { x: deg(70) }, Spine1: { y: deg(-30) } }),
    k(0.4, { ArmR1: { x: deg(-76), y: deg(16), z: deg(-68) }, ArmR2: { x: deg(10) }, Spine1: { y: deg(30), x: deg(10) } }),
    k(1, { ArmR1: { x: deg(-34), z: deg(-14) }, ArmR2: { x: deg(52) } }),
  ],
};
const OVERHEAD: ActionClip = {
  body: 'full',
  lean: deg(14),
  keys: [
    k(0, { ArmR1: { x: deg(-170), z: deg(-10) }, ArmR2: { x: deg(30) }, ArmL1: { x: deg(-160), z: deg(10) }, Spine1: { x: deg(-12) }, LegL1: { x: deg(-10) } }),
    k(0.4, { ArmR1: { x: deg(-60) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(-60) }, ArmL2: { x: deg(20) }, Spine1: { x: deg(22) }, LegL1: { x: deg(-30) }, LegL2: { x: deg(30) }, LegR1: { x: deg(20) } }),
    k(1, { ArmR1: { x: deg(-34), z: deg(-14) }, ArmR2: { x: deg(52) } }),
  ],
};

const DAGGER_R: ActionClip = {
  body: 'upper',
  keys: [
    k(0, { ArmR1: { x: deg(-70), z: deg(-60) }, ArmR2: { x: deg(60) }, Spine1: { y: deg(24) } }),
    k(0.4, { ArmR1: { x: deg(-80), z: deg(40) }, ArmR2: { x: deg(10) }, Spine1: { y: deg(-24) } }),
    k(1, { ArmR1: { x: deg(-40), z: deg(-10) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-40), z: deg(10) }, ArmL2: { x: deg(60) } }),
  ],
};
const DAGGER_L: ActionClip = {
  body: 'upper',
  keys: [
    k(0, { ArmL1: { x: deg(-70), z: deg(60) }, ArmL2: { x: deg(60) }, Spine1: { y: deg(-24) } }),
    k(0.4, { ArmL1: { x: deg(-80), z: deg(-40) }, ArmL2: { x: deg(10) }, Spine1: { y: deg(24) } }),
    k(1, { ArmR1: { x: deg(-40), z: deg(-10) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-40), z: deg(10) }, ArmL2: { x: deg(60) } }),
  ],
};
const DAGGER_X: ActionClip = {
  body: 'upper',
  lean: deg(10),
  keys: [
    k(0, { ArmR1: { x: deg(-150), z: deg(-30) }, ArmL1: { x: deg(-150), z: deg(30) }, ArmR2: { x: deg(20) }, ArmL2: { x: deg(20) } }),
    k(0.4, { ArmR1: { x: deg(-60), z: deg(40) }, ArmL1: { x: deg(-60), z: deg(-40) }, ArmR2: { x: deg(0) }, ArmL2: { x: deg(0) }, Spine1: { x: deg(14) } }),
    k(1, { ArmR1: { x: deg(-40), z: deg(-10) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-40), z: deg(10) }, ArmL2: { x: deg(60) } }),
  ],
};

const SWEEP_A: ActionClip = {
  body: 'upper',
  lean: deg(6),
  keys: [
    k(0, { ArmR1: { x: deg(-70), z: deg(-80) }, ArmR2: { x: deg(20) }, ArmL1: { x: deg(-60), z: deg(-10) }, ArmL2: { x: deg(50) }, Spine1: { y: deg(40) } }),
    k(0.45, { ArmR1: { x: deg(-70), z: deg(40) }, ArmR2: { x: deg(10) }, ArmL1: { x: deg(-50), z: deg(40) }, Spine1: { y: deg(-40) } }),
    k(1, { ArmR1: { x: deg(-50), z: deg(-10) }, ArmR2: { x: deg(40) } }),
  ],
};
const SWEEP_B: ActionClip = {
  body: 'upper',
  lean: deg(6),
  keys: [
    k(0, { ArmR1: { x: deg(-70), z: deg(40) }, ArmR2: { x: deg(10) }, Spine1: { y: deg(-40) } }),
    k(0.45, { ArmR1: { x: deg(-70), z: deg(-80) }, ArmR2: { x: deg(20) }, Spine1: { y: deg(40) } }),
    k(1, { ArmR1: { x: deg(-50), z: deg(-10) }, ArmR2: { x: deg(40) } }),
  ],
};
const THRUST: ActionClip = {
  body: 'full',
  lean: deg(12),
  keys: [
    k(0, { ArmR1: { x: deg(-40), z: deg(-20) }, ArmR2: { x: deg(90) }, LegL1: { x: deg(-10) }, Spine1: { y: deg(20) } }),
    k(0.35, { ArmR1: { x: deg(-95) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(-80) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(40) }, LegR1: { x: deg(25) }, Spine1: { y: deg(-10), x: deg(10) } }),
    k(1, { ArmR1: { x: deg(-50), z: deg(-10) }, ArmR2: { x: deg(40) } }),
  ],
};

export const M1_CLIPS: Readonly<Record<M1Style, readonly ActionClip[]>> = {
  fist: [JAB_R, JAB_L, KICK],
  sword: [SLASH_A, SLASH_B, OVERHEAD],
  dagger: [DAGGER_R, DAGGER_L, DAGGER_X],
  polearm: [SWEEP_A, SWEEP_B, THRUST],
};

// ------------------------------------------------------------- abilities

export const ABILITY_CLIPS: Readonly<Record<AnimId, ActionClip>> = {
  heavyPunch: {
    body: 'full',
    lean: deg(16),
    keys: [
      k(0, {}),
      k(0.45, { ArmR1: { x: deg(-20), z: deg(-40) }, ArmR2: { x: deg(120) }, ArmL1: { x: deg(-70), z: deg(20) }, ArmL2: { x: deg(40) }, Spine1: { y: deg(40), x: deg(-6) }, LegL1: { x: deg(-20) }, LegR1: { x: deg(20) }, LegL2: { x: deg(30) } }),
      k(0.6, { ArmR1: { x: deg(-95) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(-10), z: deg(30) }, ArmL2: { x: deg(80) }, Spine1: { y: deg(-30), x: deg(12) }, LegL1: { x: deg(-45) }, LegL2: { x: deg(45) }, LegR1: { x: deg(30) } }),
      k(1, {}),
    ],
  },
  stretchPunch: {
    body: 'upper',
    lean: deg(10),
    keys: [
      k(0, { ArmR1: { x: deg(-20), z: deg(-30) }, ArmR2: { x: deg(110) }, Spine1: { y: deg(30) } }),
      k(0.25, { ArmR1: { x: deg(-92) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-20) } }),
      k(0.75, { ArmR1: { x: deg(-92) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-20) } }),
      k(1, {}),
    ],
  },
  castOne: {
    body: 'upper',
    keys: [
      k(0, { ArmR1: { x: deg(-30), z: deg(-40) }, ArmR2: { x: deg(90) } }),
      k(0.35, { ArmR1: { x: deg(-95), z: deg(-4) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-10) } }),
      k(0.8, { ArmR1: { x: deg(-95), z: deg(-4) }, ArmR2: { x: deg(0) } }),
      k(1, {}),
    ],
  },
  castTwo: {
    body: 'full',
    keys: [
      k(0, {}),
      k(0.5, { ArmR1: { x: deg(-40), z: deg(-10), y: deg(30) }, ArmL1: { x: deg(-40), z: deg(10), y: deg(-30) }, ArmR2: { x: deg(90) }, ArmL2: { x: deg(90) }, Spine1: { y: deg(35) }, LegL1: { x: deg(-25) }, LegL2: { x: deg(30) }, LegR1: { x: deg(20) } }),
      k(0.7, { ArmR1: { x: deg(-92), z: deg(6) }, ArmL1: { x: deg(-92), z: deg(-6) }, ArmR2: { x: deg(0) }, ArmL2: { x: deg(0) }, Spine1: { y: deg(-5), x: deg(8) }, LegL1: { x: deg(-35) }, LegL2: { x: deg(35) }, LegR1: { x: deg(25) } }),
      k(0.92, { ArmR1: { x: deg(-92), z: deg(6) }, ArmL1: { x: deg(-92), z: deg(-6) }, ArmR2: { x: deg(0) }, ArmL2: { x: deg(0) }, LegL1: { x: deg(-35) }, LegL2: { x: deg(35) }, LegR1: { x: deg(25) } }),
      k(1, {}),
    ],
  },
  throw: {
    body: 'upper',
    lean: deg(12),
    keys: [
      k(0, {}),
      k(0.5, { ArmR1: { x: deg(-160), z: deg(-20) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-60), z: deg(20) }, Spine1: { y: deg(35), x: deg(-10) } }),
      k(0.7, { ArmR1: { x: deg(-60), z: deg(10) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(-10), z: deg(30) }, Spine1: { y: deg(-25), x: deg(14) } }),
      k(1, {}),
    ],
  },
  spin: {
    body: 'upper',
    spin: 3,
    keys: [
      k(0, { ArmR1: { x: deg(-80), z: deg(-80) }, ArmL1: { x: deg(-80), z: deg(80) }, ArmR2: { x: deg(0) }, ArmL2: { x: deg(0) } }),
      k(0.9, { ArmR1: { x: deg(-80), z: deg(-80) }, ArmL1: { x: deg(-80), z: deg(80) }, ArmR2: { x: deg(0) }, ArmL2: { x: deg(0) } }),
      k(1, {}),
    ],
  },
  leap: {
    body: 'full',
    keys: [
      k(0, { LegL1: { x: deg(-40) }, LegR1: { x: deg(-40) }, LegL2: { x: deg(70) }, LegR2: { x: deg(70) }, ArmR1: { x: deg(-20) } }),
      k(0.2, { ArmR1: { x: deg(-175), z: deg(-10) }, ArmL1: { x: deg(-165), z: deg(10) }, ArmR2: { x: deg(20) }, LegL1: { x: deg(-60) }, LegL2: { x: deg(80) }, LegR1: { x: deg(10) }, Spine1: { x: deg(-14) } }),
      k(0.7, { ArmR1: { x: deg(-175), z: deg(-10) }, ArmL1: { x: deg(-165), z: deg(10) }, ArmR2: { x: deg(20) }, LegL1: { x: deg(-60) }, LegL2: { x: deg(80) }, Spine1: { x: deg(-14) } }),
      k(0.85, { ArmR1: { x: deg(-50) }, ArmL1: { x: deg(-50) }, ArmR2: { x: deg(0) }, Spine1: { x: deg(30) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(60) }, LegR1: { x: deg(-40) }, LegR2: { x: deg(60) } }),
      k(1, {}),
    ],
  },
  signs: {
    body: 'upper',
    keys: [
      k(0, {}),
      k(0.25, { ArmR1: { x: deg(-60), z: deg(30), y: deg(-40) }, ArmL1: { x: deg(-60), z: deg(-30), y: deg(40) }, ArmR2: { x: deg(100) }, ArmL2: { x: deg(100) } }),
      k(0.5, { ArmR1: { x: deg(-70), z: deg(34), y: deg(-40) }, ArmL1: { x: deg(-50), z: deg(-34), y: deg(40) }, ArmR2: { x: deg(110) }, ArmL2: { x: deg(90) } }),
      k(0.8, { ArmR1: { x: deg(-65), z: deg(32), y: deg(-40) }, ArmL1: { x: deg(-65), z: deg(-32), y: deg(40) }, ArmR2: { x: deg(105) }, ArmL2: { x: deg(105) }, Neck1: { x: deg(-8) } }),
      k(1, {}),
    ],
  },
  roar: {
    body: 'full',
    keys: [
      k(0, { Spine1: { x: deg(20) }, ArmR1: { x: deg(-20), z: deg(-10) }, ArmL1: { x: deg(-20), z: deg(10) }, LegL1: { x: deg(-20) }, LegL2: { x: deg(40) }, LegR1: { x: deg(-20) }, LegR2: { x: deg(40) } }),
      k(0.35, { Spine1: { x: deg(-18) }, Neck1: { x: deg(-20) }, ArmR1: { x: deg(-40), z: deg(-70) }, ArmL1: { x: deg(-40), z: deg(70) }, ArmR2: { x: deg(40) }, ArmL2: { x: deg(40) }, LegL1: { z: deg(12) }, LegR1: { z: deg(-12) } }),
      k(0.8, { Spine1: { x: deg(-18) }, Neck1: { x: deg(-20) }, ArmR1: { x: deg(-40), z: deg(-70) }, ArmL1: { x: deg(-40), z: deg(70) }, ArmR2: { x: deg(40) }, ArmL2: { x: deg(40) }, LegL1: { z: deg(12) }, LegR1: { z: deg(-12) } }),
      k(1, {}),
    ],
  },
  stance: {
    body: 'full',
    keys: [
      k(0, {}),
      k(0.15, { ArmR1: { x: deg(-60), z: deg(20), y: deg(-40) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-55), z: deg(-10) }, ArmL2: { x: deg(70) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(60) }, LegR1: { x: deg(30) }, LegR2: { x: deg(30) }, Spine1: { x: deg(10), y: deg(-20) } }),
      k(0.9, { ArmR1: { x: deg(-60), z: deg(20), y: deg(-40) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-55), z: deg(-10) }, ArmL2: { x: deg(70) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(60) }, LegR1: { x: deg(30) }, LegR2: { x: deg(30) }, Spine1: { x: deg(10), y: deg(-20) } }),
      k(1, {}),
    ],
  },
  lunge: {
    body: 'full',
    lean: deg(22),
    keys: [
      k(0, { ArmR1: { x: deg(-30), z: deg(-30) }, ArmR2: { x: deg(90) }, LegL1: { x: deg(-30) }, LegL2: { x: deg(50) }, LegR1: { x: deg(20) }, Spine1: { y: deg(25) } }),
      k(0.3, { ArmR1: { x: deg(-95) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(30), z: deg(20) }, LegL1: { x: deg(-50) }, LegL2: { x: deg(40) }, LegR1: { x: deg(40) }, LegR2: { x: deg(20) }, Spine1: { y: deg(-10) } }),
      k(0.85, { ArmR1: { x: deg(-95) }, ArmR2: { x: deg(0) }, ArmL1: { x: deg(30), z: deg(20) }, LegL1: { x: deg(-50) }, LegL2: { x: deg(40) }, LegR1: { x: deg(40) }, LegR2: { x: deg(20) } }),
      k(1, {}),
    ],
  },
  barrage: {
    body: 'upper',
    lean: deg(10),
    barrage: true,
    keys: [k(0, {}), k(1, {})],
  },
  slashWide: {
    body: 'full',
    lean: deg(12),
    keys: [
      k(0, { ArmR1: { x: deg(-90), z: deg(-100) }, ArmR2: { x: deg(20) }, ArmL1: { x: deg(-40), z: deg(30) }, Spine1: { y: deg(50) }, LegL1: { x: deg(-20) }, LegR1: { x: deg(20) } }),
      k(0.5, { ArmR1: { x: deg(-90), z: deg(-100) }, ArmR2: { x: deg(20) }, Spine1: { y: deg(55) }, LegL1: { x: deg(-30) }, LegL2: { x: deg(40) }, LegR1: { x: deg(25) } }),
      k(0.62, { ArmR1: { x: deg(-80), z: deg(60) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-45), x: deg(14) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(40) }, LegR1: { x: deg(30) } }),
      k(1, {}),
    ],
  },
  raise: {
    body: 'full',
    keys: [
      k(0, {}),
      k(0.3, { ArmR1: { x: deg(-170), z: deg(-20) }, ArmR2: { x: deg(10) }, ArmL1: { x: deg(-20), z: deg(20) }, Neck1: { x: deg(-12) }, Spine1: { x: deg(-8) } }),
      k(0.6, { ArmR1: { x: deg(-100), z: deg(-10) }, ArmR2: { x: deg(0) }, Spine1: { x: deg(10) } }),
      k(0.9, { ArmR1: { x: deg(-100), z: deg(-10) }, ArmR2: { x: deg(0) } }),
      k(1, {}),
    ],
  },
  flick: {
    body: 'upper',
    keys: [
      k(0, { ArmR1: { x: deg(-80), z: deg(-10) }, ArmR2: { x: deg(70) } }),
      k(0.35, { ArmR1: { x: deg(-92) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-10) } }),
      k(0.7, { ArmR1: { x: deg(-92) }, ArmR2: { x: deg(0) } }),
      k(1, {}),
    ],
  },
  uppercut: {
    body: 'full',
    keys: [
      k(0, { LegL2: { x: deg(40) }, LegR2: { x: deg(40) }, ArmR1: { x: deg(10) }, ArmR2: { x: deg(90) } }),
      k(0.4, { ArmR1: { x: deg(-160) }, ArmR2: { x: deg(20) }, Spine1: { x: deg(-12) } }),
      k(1, {}),
    ],
  },
  blink: {
    body: 'full',
    lean: deg(18),
    keys: [
      k(0, { LegL1: { x: deg(-30) }, LegL2: { x: deg(50) }, LegR1: { x: deg(-10) }, LegR2: { x: deg(40) }, ArmR1: { x: deg(-60), z: deg(-40) }, ArmR2: { x: deg(40) } }),
      k(0.4, { ArmR1: { x: deg(-80), z: deg(50) }, ArmR2: { x: deg(0) }, Spine1: { y: deg(-30) }, LegL1: { x: deg(-40) }, LegL2: { x: deg(40) }, LegR1: { x: deg(30) } }),
      k(1, {}),
    ],
  },
};

/** The weapon hold between swings, by M1 style. */
export const HOLDS: Readonly<Record<M1Style, PoseDefinition>> = {
  fist: {},
  sword: { ArmR1: { x: deg(-34), z: deg(-14) }, ArmR2: { x: deg(52) } },
  dagger: { ArmR1: { x: deg(-30), z: deg(-10) }, ArmR2: { x: deg(60) }, ArmL1: { x: deg(-30), z: deg(10) }, ArmL2: { x: deg(60) } },
  polearm: { ArmR1: { x: deg(-40), z: deg(-18) }, ArmR2: { x: deg(40) } },
};

/** The fighting stance for unarmed kits: fists up. */
export const GUARD: PoseDefinition = {
  ArmR1: { x: deg(-40), z: deg(-14) },
  ArmR2: { x: deg(100) },
  ArmL1: { x: deg(-44), z: deg(14) },
  ArmL2: { x: deg(104) },
};

/** THE RAGDOLL: limp and spread-eagled, tumbling in the air. */
export const RAGDOLL_POSE: PoseDefinition = {
  ArmR1: { x: deg(-120), z: deg(-70) },
  ArmL1: { x: deg(-110), z: deg(70) },
  ArmR2: { x: deg(30) },
  ArmL2: { x: deg(40) },
  LegL1: { x: deg(-30), z: deg(18) },
  LegR1: { x: deg(10), z: deg(-18) },
  LegL2: { x: deg(40) },
  LegR2: { x: deg(20) },
  Spine1: { x: deg(-16) },
  Neck1: { x: deg(-20) },
};

/** Lying on the ground after a launch. */
export const DOWNED_POSE: PoseDefinition = {
  ArmR1: { x: deg(-150), z: deg(-40) },
  ArmL1: { x: deg(-150), z: deg(40) },
  ArmR2: { x: deg(10) },
  ArmL2: { x: deg(10) },
  LegL1: { z: deg(12) },
  LegR1: { z: deg(-12) },
  Neck1: { x: deg(-10) },
};
