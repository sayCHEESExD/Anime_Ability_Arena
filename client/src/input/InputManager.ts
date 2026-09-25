import { hasTouchSupport, isTouchPrimary, onFirstTouch } from '../config/device.js';
import { createInputState, type InputState } from './InputState.js';
import { KeyboardSource } from './KeyboardSource.js';
import { MouseLook } from './MouseLook.js';
import { TouchControls } from './TouchControls.js';

/**
 * Aggregates every input source into a single normalised InputState.
 *
 * Keyboard, mouse and touch are peers here: all merge into the same snapshot,
 * so the prediction, the network message and every server-authoritative rule
 * downstream cannot tell them apart.
 */
export class InputManager {
  private readonly state: InputState = createInputState();
  private readonly keyboard = new KeyboardSource();
  readonly look = new MouseLook();
  readonly touch = new TouchControls(this.look);
  private cancelTouchWatch: (() => void) | null = null;
  private suppressed = false;
  private interactPulse = false;

  get touchActive(): boolean {
    return this.touch.isVisible;
  }

  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.look.setSuppressed(suppressed);
    this.touch.setSuppressed(suppressed);
  }

  /** The on-screen prompt button was tapped. */
  pressInteract(): void {
    this.interactPulse = true;
  }

  attach(canvas: HTMLElement): void {
    this.keyboard.attach();
    this.look.attach(canvas);
    this.touch.attach(canvas, canvas.parentElement ?? document.body);
    if (isTouchPrimary()) {
      this.showTouchControls();
    } else if (hasTouchSupport()) {
      this.cancelTouchWatch = onFirstTouch(() => this.showTouchControls());
    }
  }

  detach(): void {
    this.keyboard.detach();
    this.look.detach();
    this.touch.detach();
    this.cancelTouchWatch?.();
    this.cancelTouchWatch = null;
  }

  /** Recompute the snapshot for this frame. */
  sample(): Readonly<InputState> {
    const s = this.state;
    s.moveX = 0;
    s.moveZ = 0;
    s.attack = false;
    s.skill = false;
    s.ultimate = false;
    s.dash = false;
    s.jump = false;
    s.interact = this.interactPulse;
    this.interactPulse = false;

    this.keyboard.apply(s);
    this.touch.apply(s);
    if (this.look.consumeClick()) s.attack = true;

    if (this.suppressed) {
      s.moveX = 0;
      s.moveZ = 0;
      s.attack = false;
      s.skill = false;
      s.ultimate = false;
      s.dash = false;
      s.jump = false;
      return s;
    }
    const magnitude = Math.hypot(s.moveX, s.moveZ);
    if (magnitude > 1) {
      s.moveX /= magnitude;
      s.moveZ /= magnitude;
    }
    return s;
  }

  private showTouchControls(): void {
    this.cancelTouchWatch?.();
    this.cancelTouchWatch = null;
    this.touch.show();
    document.body.classList.add('aoe-touch-mode');
  }
}
