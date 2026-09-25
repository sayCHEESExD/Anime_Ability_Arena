import { Panel } from './Panel.js';
import { injectArenaStyles } from './arenaStyles.js';

export interface SettingsHost {
  toggleMusic(): boolean;
  isMusicMuted(): boolean;
  setSensitivity(scale: number): void;
  setShowFps(show: boolean): void;
}

const STORAGE_KEY = 'arena.settings';

/**
 * Settings: sound, look sensitivity, an FPS readout, and the controls. The
 * choices are this browser's own conveniences (localStorage), never progress.
 */
export class SettingsPanel extends Panel {
  private sensitivity = 1;
  private fps = false;

  constructor(parent: HTMLElement, private readonly host: SettingsHost) {
    super(parent, 'settings', 'Settings');
    injectArenaStyles();
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as { sensitivity?: number; fps?: boolean };
      if (typeof saved.sensitivity === 'number') this.sensitivity = saved.sensitivity;
      this.fps = saved.fps === true;
    } catch {
      /* private window: defaults */
    }
    host.setSensitivity(this.sensitivity);
    host.setShowFps(this.fps);
    this.render();
  }

  protected override onOpened(): void {
    this.render();
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sensitivity: this.sensitivity, fps: this.fps }));
    } catch {
      /* ignore */
    }
  }

  private render(): void {
    this.body.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'ar-set';
    const row = (label: string, control: HTMLElement): void => {
      const r = document.createElement('div');
      r.className = 'ar-set__row';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, control);
      wrap.appendChild(r);
    };
    const toggle = (on: boolean, flip: () => boolean): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ar-set__toggle';
      const paint = (value: boolean): void => {
        button.textContent = value ? 'ON' : 'OFF';
        button.classList.toggle('ar-set__toggle--off', !value);
      };
      paint(on);
      button.addEventListener('click', () => paint(flip()));
      return button;
    };
    row('Music & sound', toggle(!this.host.isMusicMuted(), () => !this.host.toggleMusic()));
    row(
      'Show FPS',
      toggle(this.fps, () => {
        this.fps = !this.fps;
        this.host.setShowFps(this.fps);
        this.save();
        return this.fps;
      }),
    );
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.3';
    slider.max = '2.5';
    slider.step = '0.1';
    slider.value = String(this.sensitivity);
    slider.className = 'ar-set__range';
    slider.addEventListener('input', () => {
      this.sensitivity = Number(slider.value);
      this.host.setSensitivity(this.sensitivity);
      this.save();
    });
    row('Camera sensitivity', slider);
    const help = document.createElement('div');
    help.className = 'ar-set__help';
    help.innerHTML =
      '<b>Controls</b><br>WASD move &middot; Mouse look &middot; Space jump<br>' +
      'Click / Z attack &middot; Q dash &middot; E skill &middot; R ultimate<br>' +
      'F unlock at a pedestal &middot; I inventory &middot; B store &middot; M mute &middot; Esc free the cursor<br>' +
      'Knock enemies off the arena - falls count as kills!';
    wrap.appendChild(help);
    this.body.appendChild(wrap);
  }
}
