import type { AudioManager } from './AudioManager.js';

const MIN_AUDIBLE_SPEED = 2.5;
const STRIDE_DISTANCE = 3.2;
const MAX_STEPS_PER_SECOND = 7;
/** A landing this fast is a big drop, and gets the supplied fall sound. */
const HARD_LANDING_SPEED = 30;

export interface PlayerAudioInput {
  readonly horizontalSpeed: number;
  readonly isGrounded: boolean;
  readonly verticalVelocity: number;
  readonly jumpedEdge: boolean;
  readonly landedEdge: boolean;
}

/** The local player's own sounds: footfalls per stride, the jump, the landing. */
export class PlayerAudio {
  private stride = 0;
  private sinceBeat = 0;
  private lastFall = 0;

  constructor(private readonly audio: AudioManager) {}

  update(delta: number, player: PlayerAudioInput): void {
    if (player.jumpedEdge) this.audio.play('jump');
    if (!player.isGrounded) this.lastFall = Math.min(this.lastFall, player.verticalVelocity);
    if (player.landedEdge) {
      this.audio.play(-this.lastFall > HARD_LANDING_SPEED ? 'fall' : 'land', 0.7);
      this.lastFall = 0;
    }

    this.sinceBeat += delta;
    if (!player.isGrounded || player.horizontalSpeed < MIN_AUDIBLE_SPEED) {
      this.stride = 0;
      return;
    }
    this.stride += player.horizontalSpeed * delta;
    if (this.stride < STRIDE_DISTANCE) return;
    this.stride = 0;
    if (this.sinceBeat < 1 / MAX_STEPS_PER_SECOND) return;
    this.sinceBeat = 0;
    this.audio.play('step', 0.5);
  }
}
