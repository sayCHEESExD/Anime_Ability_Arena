import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning. Every number the animator uses lives here.
 * All rotations are in CHARACTER space (see `PlayerRig`): +X pitch swings a
 * limb BACKWARD, so a raised arm is a large negative X.
 */

/** The walk/run cycle: ONE cycle at three depths. The right hand keeps hold of the cutter. */
export const LOCOMOTION = {
  minFrequency: 0.7,
  maxFrequency: 3.6,
  strideDistance: 5.2,
  idleSpeed: 0.6,
  walkSpeed: 4,
  runSpeed: 14,
  sprintSpeed: 30,

  hipSwing: { walk: deg(22), run: deg(42), sprint: deg(56) },
  kneeBend: { walk: deg(30), run: deg(58), sprint: deg(72) },
  armSwing: { walk: deg(18), run: deg(36), sprint: deg(52) },
  elbowBend: { walk: deg(14), run: deg(44), sprint: deg(70) },
  torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
  torsoLean: { walk: deg(3), run: deg(10), sprint: deg(18) },
  headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
  torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
  bob: { walk: 0.05, run: 0.11, sprint: 0.15 },
  bankAngle: deg(9),
  bankRate: 8,
} as const;

/** The idle: a relaxed stance, breathing, cutter in hand. */
export const IDLE = {
  breathFrequency: 0.35,
  breathAmount: deg(1.8),
  breathBob: 0.012,
  basePose: {
    ArmL1: { x: deg(-8), z: deg(14) },
    ArmL2: { x: deg(38) },
    ArmR1: { x: deg(4), z: deg(-6) },
    ArmR2: { x: deg(12) },
    LegL1: { x: deg(-4) },
    LegR1: { x: deg(4) },
  } satisfies PoseDefinition,
} as const;

/** In the air: knees tucked on the way up, legs reaching on the way down. */
export const AIRBORNE = {
  rise: {
    LegL1: { x: deg(-38) },
    LegR1: { x: deg(8) },
    LegL2: { x: deg(62) },
    LegR2: { x: deg(40) },
    ArmL1: { x: deg(-40), z: deg(34) },
    ArmR1: { x: deg(-30), z: deg(-34) },
    ArmL2: { x: deg(30) },
    ArmR2: { x: deg(30) },
    Spine1: { x: deg(6) },
  } satisfies PoseDefinition,
  fall: {
    LegL1: { x: deg(-14) },
    LegR1: { x: deg(10) },
    LegL2: { x: deg(22) },
    LegR2: { x: deg(18) },
    ArmL1: { x: deg(-70), z: deg(40) },
    ArmR1: { x: deg(-60), z: deg(-40) },
    ArmL2: { x: deg(20) },
    ArmR2: { x: deg(20) },
    Spine1: { x: deg(-4) },
  } satisfies PoseDefinition,
  velocityReference: 20,
} as const;

/** The landing crouch (a step down off a training pad). */
export const LANDING = {
  duration: 0.16,
  pose: {
    LegL1: { x: deg(-34) },
    LegR1: { x: deg(-34) },
    LegL2: { x: deg(58) },
    LegR2: { x: deg(58) },
    ArmL1: { x: deg(-18), z: deg(20) },
    ArmR1: { x: deg(-18), z: deg(-20) },
    Spine1: { x: deg(14) },
  } satisfies PoseDefinition,
  bobY: -0.32,
} as const;

/**
 * THE SLASH: one sweep of the cutter across the grass in three beats - WIND
 * (the tool drawn back out to the right), CUT (a fast, low sweep across the
 * front of the body) and RECOVER back to the hold. Two mirrored variants
 * alternate, so auto-click reads as forehand, backhand, forehand. Layered OVER
 * the legs, so a player can slash while walking.
 *
 * "duration" is the longest a slash ever takes; a faster Agility shortens it
 * to fit the slash interval (AnimationInput.swingDuration).
 */
export const SWING = {
  duration: 0.34,
  /** Fraction of the slash spent winding, and where the cut ends. */
  windEnd: 0.3,
  cutEnd: 0.62,
  forehand: {
    wind: {
      ArmR1: { x: deg(-78), y: deg(20), z: deg(-72) },
      ArmR2: { x: deg(38) },
      ArmL1: { x: deg(-30), z: deg(30) },
      ArmL2: { x: deg(40) },
      Spine1: { y: deg(30), x: deg(4) },
      Spine2: { y: deg(16) },
      Neck1: { y: deg(-20) },
    } satisfies PoseDefinition,
    cut: {
      ArmR1: { x: deg(-62), y: deg(-18), z: deg(40) },
      ArmR2: { x: deg(8) },
      ArmL1: { x: deg(-14), z: deg(26) },
      ArmL2: { x: deg(24) },
      Spine1: { y: deg(-30), x: deg(14) },
      Spine2: { y: deg(-16), x: deg(8) },
      Neck1: { y: deg(22) },
    } satisfies PoseDefinition,
  },
  backhand: {
    wind: {
      ArmR1: { x: deg(-66), y: deg(-16), z: deg(36) },
      ArmR2: { x: deg(70) },
      ArmL1: { x: deg(-24), z: deg(28) },
      ArmL2: { x: deg(34) },
      Spine1: { y: deg(-28) },
      Spine2: { y: deg(-14) },
      Neck1: { y: deg(18) },
    } satisfies PoseDefinition,
    cut: {
      ArmR1: { x: deg(-74), y: deg(16), z: deg(-66) },
      ArmR2: { x: deg(10) },
      ArmL1: { x: deg(-12), z: deg(24) },
      ArmL2: { x: deg(20) },
      Spine1: { y: deg(30), x: deg(12) },
      Spine2: { y: deg(16), x: deg(6) },
      Neck1: { y: deg(-20) },
    } satisfies PoseDefinition,
  },
  /** Legs brace into the sweep. */
  lunge: {
    LegL1: { x: deg(-18) },
    LegL2: { x: deg(24) },
    LegR1: { x: deg(14) },
    LegR2: { x: deg(10) },
  } satisfies PoseDefinition,
  /** The whole body leans into the cut. */
  lean: deg(9),
} as const;

/**
 * THE HOLD: the cutter carried in the right hand, out in front at the hip,
 * blade up - at rest and on the run. Only the right arm; the left keeps its
 * own swing.
 */
export const HOLD = {
  ArmR1: { x: deg(-34), z: deg(-14) },
  ArmR2: { x: deg(52) },
} satisfies PoseDefinition;

/** Seconds a pose change takes to blend in. */
export const TRANSITIONS = {
  toLocomotion: 0.14,
  toAirborne: 0.12,
  toLanding: 0.06,
} as const;
