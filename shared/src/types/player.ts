/**
 * Visual states the animator can be in. PRESENTATION only: gameplay authority
 * never lives here.
 */
export const PlayerAnimationState = {
  Idle: 'idle',
  Run: 'run',
} as const;

export type PlayerAnimationState = (typeof PlayerAnimationState)[keyof typeof PlayerAnimationState];
