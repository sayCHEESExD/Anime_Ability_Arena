import type { ActionClip } from './ActionClips.js';
import type { PoseDefinition } from './PoseBuffer.js';

/**
 * The gameplay signals the animator consumes each frame. It reads these and
 * never writes back. The local player fills it from its prediction and every
 * remote from replicated state, so both run the exact same animation code.
 */
export interface AnimationInput {
  grounded: boolean;
  horizontalSpeed: number;
  verticalVelocity: number;
  /** -1..1 steering, for the lean. */
  turn: number;
  landed: boolean;
  /** Seconds of ragdoll left (0 = in control). */
  stun: number;
  dead: boolean;
  /** Dashing or lunging: lean into it. */
  lunging: boolean;
  /** The attack or ability playing, or null. */
  action: ActionClip | null;
  actionTime: number;
  actionDuration: number;
  /** How the arms rest between attacks: a weapon hold or raised fists. */
  hold: PoseDefinition;
  /** Unarmed kits keep their fists up. */
  guard: boolean;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  verticalVelocity: 0,
  turn: 0,
  landed: false,
  stun: 0,
  dead: false,
  lunging: false,
  action: null,
  actionTime: 0,
  actionDuration: 1,
  hold: {},
  guard: false,
});
