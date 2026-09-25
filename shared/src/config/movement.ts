/**
 * Movement tuning. The client predicts with these numbers and the server
 * simulates with them, so there is exactly one copy.
 */
export interface MovementConfig {
  readonly walkSpeed: number;
  readonly acceleration: number;
  readonly deceleration: number;
  /** Fraction of ground acceleration retained in the air. */
  readonly airControl: number;
  /** Downward acceleration, world units per second squared. */
  readonly gravity: number;
  readonly jumpVelocity: number;
  /** Turn rate toward the movement direction, radians per second. */
  readonly turnSpeed: number;
  readonly maxSubstepDistance: number;
  readonly maxSubsteps: number;
  /** Height the character steps up without jumping: stair treads. */
  readonly stepHeight: number;
  readonly terminalVelocity: number;
  /** Deceleration while ragdolled on the ground, and the drag while ragdolled in the air. */
  readonly stunGroundFriction: number;
  readonly stunAirDrag: number;
}

export const MOVEMENT: MovementConfig = {
  walkSpeed: 17,
  acceleration: 130,
  deceleration: 120,
  airControl: 0.6,
  gravity: 72,
  jumpVelocity: 27,
  turnSpeed: 14,
  maxSubstepDistance: 0.5,
  maxSubsteps: 60,
  stepHeight: 1.05,
  terminalVelocity: 95,
  stunGroundFriction: 55,
  stunAirDrag: 0.5,
};

/** The shared dash (Q): a short flat burst in the move direction, or forward. */
export const DASH = {
  speed: 64,
  time: 0.17,
  /** Gravity scale while dashing. */
  gravity: 0.25,
  cooldown: 1.4,
} as const;
