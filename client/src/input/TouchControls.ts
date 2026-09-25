import type { InputState } from './InputState.js';

const ZONE_WIDTH = 0.45;
const ZONE_TOP = 0.3;
const RADIUS_VMIN = 0.12;
const RADIUS_MIN = 36;
const RADIUS_MAX = 84;
const DEADZONE = 0.18;
const LOOK_SENSITIVITY = 0.005;

export interface LookSink {
  addLookDelta(deltaX: number, deltaY: number): void;
}

export type TouchAction = 'attack' | 'skill' | 'ultimate' | 'dash' | 'jump';

interface ActionButton {
  readonly element: HTMLButtonElement;
  readonly shade: HTMLSpanElement;
  readonly timer: HTMLSpanElement;
  readonly label: HTMLSpanElement;
}

/**
 * Touch controls for a phone held landscape: a virtual stick on the left,
 * drag-to-look on the right, and a fan of fighting buttons - a big ATTACK,
 * JUMP, DASH, and the kit's two abilities - each with a cooldown sweep.
 *
 * A SOURCE, not a second control scheme: it writes the same fields the
 * keyboard writes, through the same `InputManager`, into the same message.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<TouchAction, ActionButton>();

  private canvas: HTMLElement | null = null;
  private readonly look: LookSink;
  private movePointer: number | null = null;
  private lookPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 64;
  private lookX = 0;
  private lookY = 0;
  private moveX = 0;
  private moveZ = 0;
  private readonly pulses = { attack: false, skill: false, ultimate: false, dash: false };
  private jumpHeld = false;
  private visible = false;
  private suppressed = false;

  constructor(look: LookSink) {
    this.look = look;
    this.root = document.createElement('div');
    this.root.className = 'aoe-touch';
    this.root.hidden = true;

    this.stick = document.createElement('div');
    this.stick.className = 'aoe-touch__stick';
    this.knob = document.createElement('div');
    this.knob.className = 'aoe-touch__knob';
    this.stick.append(this.knob);
    this.root.append(this.stick);

    const make = (action: TouchAction, text: string): void => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `aoe-tb aoe-tb--${action}`;
      element.setAttribute('aria-label', text);
      const label = document.createElement('span');
      label.className = 'aoe-tb__label';
      label.textContent = text;
      const shade = document.createElement('span');
      shade.className = 'aoe-tb__shade';
      const timer = document.createElement('span');
      timer.className = 'aoe-tb__timer';
      element.append(shade, label, timer);
      this.root.append(element);
      this.buttons.set(action, { element, shade, timer, label });
    };
    make('attack', 'ATTACK');
    make('jump', 'JUMP');
    make('dash', 'DASH');
    make('skill', 'E');
    make('ultimate', 'R');
    injectStyles();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  attach(canvas: HTMLElement, container: HTMLElement): void {
    this.canvas = canvas;
    container.append(this.root);
    this.measure();
    canvas.addEventListener('pointerdown', this.onCanvasDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.measure);
    for (const [action, button] of this.buttons) {
      this.bindHold(button.element, (down) => {
        if (action === 'jump') this.jumpHeld = down;
        else if (down) this.pulses[action] = true;
      });
    }
  }

  detach(): void {
    this.canvas?.removeEventListener('pointerdown', this.onCanvasDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.measure);
    this.root.remove();
    this.canvas = null;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    this.measure();
  }

  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.root.classList.toggle('aoe-touch--hidden', suppressed);
    if (suppressed) this.releaseAll();
  }

  /** Name the two ability buttons after the equipped kit's moves. */
  setAbilityNames(skill: string, ultimate: string): void {
    const s = this.buttons.get('skill');
    const u = this.buttons.get('ultimate');
    if (s) s.label.innerHTML = `<b>E</b><small>${skill}</small>`;
    if (u) u.label.innerHTML = `<b>R</b><small>${ultimate}</small>`;
  }

  /** The cooldown sweep: `remaining` of `total` seconds left. */
  setCooldown(action: TouchAction, remaining: number, total: number): void {
    const button = this.buttons.get(action);
    if (!button) return;
    const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    button.shade.style.setProperty('--cd', `${(fraction * 360).toFixed(1)}deg`);
    button.element.classList.toggle('is-cooling', fraction > 0);
    const text = remaining > 0.05 && total >= 1 ? (remaining >= 10 ? Math.ceil(remaining).toString() : remaining.toFixed(1)) : '';
    if (button.timer.textContent !== text) button.timer.textContent = text;
  }

  apply(state: InputState): void {
    state.moveX += this.moveX;
    state.moveZ += this.moveZ;
    if (this.jumpHeld) state.jump = true;
    for (const key of Object.keys(this.pulses) as (keyof typeof this.pulses)[]) {
      if (this.pulses[key]) state[key] = true;
      this.pulses[key] = false;
    }
  }

  private bindHold(button: HTMLButtonElement, set: (down: boolean) => void): void {
    const down = (event: PointerEvent): void => {
      if (this.suppressed) return;
      event.stopPropagation();
      event.preventDefault();
      set(true);
      button.classList.add('is-down');
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* no capture; the window-level pointerup still releases */
      }
    };
    const up = (event: PointerEvent): void => {
      event.stopPropagation();
      set(false);
      button.classList.remove('is-down');
      try {
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private readonly onCanvasDown = (event: PointerEvent): void => {
    if (this.suppressed || !this.visible) return;
    if (event.pointerType === 'mouse') return;
    if (this.movePointer === null && this.inStickZone(event.clientX, event.clientY)) {
      this.movePointer = event.pointerId;
      this.originX = event.clientX;
      this.originY = event.clientY;
      this.stick.style.left = `${this.originX}px`;
      this.stick.style.top = `${this.originY}px`;
      this.stick.classList.add('aoe-touch__stick--active');
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.suppressed) return;
    if (event.pointerId === this.movePointer) {
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    if (event.pointerId === this.lookPointer) {
      this.look.addLookDelta((event.clientX - this.lookX) * LOOK_SENSITIVITY, (event.clientY - this.lookY) * LOOK_SENSITIVITY);
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.movePointer) this.releaseStick();
    if (event.pointerId === this.lookPointer) this.lookPointer = null;
  };

  private inStickZone(x: number, y: number): boolean {
    return x < window.innerWidth * ZONE_WIDTH && y > window.innerHeight * ZONE_TOP;
  }

  private readonly measure = (): void => {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    this.radius = Math.max(RADIUS_MIN, Math.min(vmin * RADIUS_VMIN, RADIUS_MAX));
    this.stick.style.setProperty('--aoe-stick-radius', `${this.radius}px`);
    if (this.movePointer === null) {
      this.stick.style.left = '';
      this.stick.style.top = '';
    }
  };

  private updateStick(x: number, y: number): void {
    const dx = x - this.originX;
    const dy = y - this.originY;
    const distance = Math.hypot(dx, dy);
    const deflection = Math.min(distance / this.radius, 1);
    if (deflection < DEADZONE || distance < 1e-4) {
      this.moveX = 0;
      this.moveZ = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    const magnitude = (deflection - DEADZONE) / (1 - DEADZONE);
    const dirX = dx / distance;
    const dirY = dy / distance;
    this.moveX = dirX * magnitude;
    this.moveZ = -dirY * magnitude;
    this.knob.style.transform = `translate(calc(-50% + ${dirX * deflection * this.radius}px), calc(-50% + ${dirY * deflection * this.radius}px))`;
  }

  private releaseStick(): void {
    this.movePointer = null;
    this.moveX = 0;
    this.moveZ = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.stick.classList.remove('aoe-touch__stick--active');
    this.stick.style.left = '';
    this.stick.style.top = '';
  }

  private releaseAll(): void {
    this.releaseStick();
    this.lookPointer = null;
    this.jumpHeld = false;
    for (const key of Object.keys(this.pulses) as (keyof typeof this.pulses)[]) this.pulses[key] = false;
    for (const button of this.buttons.values()) button.element.classList.remove('is-down');
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
:root { --tb: clamp(52px, 12vmin, 84px); }
.aoe-touch { position: fixed; inset: 0; z-index: 22; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; }
.aoe-touch[hidden] { display: none; }
.aoe-touch--hidden { opacity: 0; pointer-events: none; }
.aoe-touch__stick {
  --aoe-stick-radius: 64px;
  position: fixed;
  left: calc(env(safe-area-inset-left, 0px) + 40px + var(--aoe-stick-radius));
  top: auto;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 36px);
  width: calc(var(--aoe-stick-radius) * 2);
  height: calc(var(--aoe-stick-radius) * 2);
  margin: calc(var(--aoe-stick-radius) * -1) 0 0 calc(var(--aoe-stick-radius) * -1);
  border: 3px solid rgba(20, 24, 40, 0.7);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  opacity: 0.6;
}
.aoe-touch__stick--active { bottom: auto; opacity: 0.95; }
.aoe-touch__knob {
  position: absolute; left: 50%; top: 50%; width: 46%; height: 46%;
  transform: translate(-50%, -50%);
  border: 3px solid rgba(20, 24, 40, 0.8); border-radius: 50%;
  background: linear-gradient(180deg, #ffffff, #cfd8ee);
}
.aoe-tb {
  position: fixed;
  width: var(--tb); height: var(--tb);
  padding: 0;
  border: 3px solid #0d0f18;
  border-radius: 22%;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #4a4f63, #262a38);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.35);
  color: #fff;
  font-family: "Fredoka", system-ui, sans-serif;
  font-weight: 700;
  pointer-events: auto;
  touch-action: none;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.aoe-tb__label, .aoe-tb__timer {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transform: rotate(-45deg);
  text-shadow: 0 2px 0 rgba(0,0,0,0.6);
  line-height: 1;
  font-size: calc(var(--tb) * 0.22);
}
.aoe-tb__label b { font-size: calc(var(--tb) * 0.34); }
.aoe-tb__label small { font-size: calc(var(--tb) * 0.13); max-width: 90%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.aoe-tb__timer { font-size: calc(var(--tb) * 0.34); color: #fff; }
.aoe-tb.is-cooling .aoe-tb__label { opacity: 0.35; }
.aoe-tb__shade {
  --cd: 0deg;
  position: absolute; inset: -30%;
  background: conic-gradient(rgba(0,0,0,0.62) var(--cd), transparent 0);
  transform: rotate(-45deg);
}
.aoe-tb.is-down { filter: brightness(1.3); }
.aoe-tb--attack {
  width: calc(var(--tb) * 1.35); height: calc(var(--tb) * 1.35);
  right: calc(env(safe-area-inset-right, 0px) + var(--tb) * 0.6);
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tb) * 0.55);
  background: linear-gradient(135deg, #ff6b5a, #b8201a);
}
.aoe-tb--jump { right: calc(env(safe-area-inset-right, 0px) + var(--tb) * 2.55); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tb) * 0.35); background: linear-gradient(135deg, #6fe06a, #2a8a26); }
.aoe-tb--dash { right: calc(env(safe-area-inset-right, 0px) + var(--tb) * 2.3); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tb) * 1.75); background: linear-gradient(135deg, #5ac8ff, #1f6fd6); }
.aoe-tb--skill { right: calc(env(safe-area-inset-right, 0px) + var(--tb) * 1.25); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tb) * 2.45); background: linear-gradient(135deg, #b98bff, #6a2fd6); }
.aoe-tb--ultimate { right: calc(env(safe-area-inset-right, 0px) + var(--tb) * 0.1); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tb) * 2.2); background: linear-gradient(135deg, #ffd23d, #d67a0a); }
`;
  document.head.append(style);
};
