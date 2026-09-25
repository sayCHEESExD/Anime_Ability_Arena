import type { InputState } from './InputState.js';

const MOVE_KEYS: Readonly<Record<string, 'forward' | 'back' | 'left' | 'right'>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** One-shot keys: a press is one action, a held key never repeats. */
const PULSE_KEYS: Readonly<Record<string, 'skill' | 'ultimate' | 'dash' | 'interact' | 'attack'>> = {
  KeyE: 'skill',
  KeyR: 'ultimate',
  KeyQ: 'dash',
  ShiftLeft: 'dash',
  KeyF: 'interact',
  KeyZ: 'attack',
};

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return element.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Desktop keyboard input. One of possibly several sources feeding InputManager. */
export class KeyboardSource {
  private readonly held = { forward: false, back: false, left: false, right: false, jump: false };
  private readonly pulses = { skill: false, ultimate: false, dash: false, interact: false, attack: false };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  apply(state: InputState): void {
    if (this.held.forward) state.moveZ += 1;
    if (this.held.back) state.moveZ -= 1;
    if (this.held.right) state.moveX += 1;
    if (this.held.left) state.moveX -= 1;
    if (this.held.jump) state.jump = true;
    for (const key of Object.keys(this.pulses) as (keyof typeof this.pulses)[]) {
      if (this.pulses[key]) state[key] = true;
      this.pulses[key] = false;
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    if (event.code === 'Space') {
      this.held.jump = true;
      event.preventDefault();
      return;
    }
    const move = MOVE_KEYS[event.code];
    if (move) {
      this.held[move] = true;
      return;
    }
    const pulse = PULSE_KEYS[event.code];
    if (pulse && !event.repeat) this.pulses[pulse] = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.held.jump = false;
    const move = MOVE_KEYS[event.code];
    if (move) this.held[move] = false;
  };

  /** Losing focus must not leave a key stuck down. */
  private readonly onBlur = (): void => {
    this.held.forward = false;
    this.held.back = false;
    this.held.left = false;
    this.held.right = false;
    this.held.jump = false;
  };
}
