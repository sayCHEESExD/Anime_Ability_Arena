import { COMBAT, formatYen, type KitDef } from '@arena/shared';
import { kitPortraitUrl } from './KitPortraits.js';
import { GEAR, HEART, STAR_MARK, STAR_MARK_GREY, injectArenaStyles } from './arenaStyles.js';

export type CooldownSlot = 'attack' | 'dash' | 'skill' | 'ultimate' | 'jump';

interface KeyView {
  readonly root: HTMLDivElement;
  readonly shade: HTMLSpanElement;
  readonly timer: HTMLSpanElement;
  readonly name: HTMLSpanElement;
  cooling: boolean;
}

export interface HudCallbacks {
  onInventory(): void;
  onSettings(): void;
  onPlay(): void;
  onPrompt(): void;
}

const M1_NAMES: Readonly<Record<string, string>> = { fist: 'Punch', sword: 'Slash', dagger: 'Stab', polearm: 'Sweep' };

/**
 * THE ALWAYS-ON HUD, laid out as the reference:
 *
 *   bottom left    health bar, "Abilities:" and the diamond keys (M1, Q, E, R,
 *                  Space) with cooldown sweeps; Inventory / Settings tiles
 *   bottom right   Yen
 *   bottom centre  "Equipped: <kit>" and the green PLAY! bar (spawn island only)
 *   top right      the kill feed
 *   centre         death screen, unlock alert, streak callouts, damage numbers
 *
 * Every figure is replicated server state or a server event; this only draws.
 */
export class ArenaHud {
  private readonly left: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpGhost: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly buff: HTMLDivElement;
  private readonly keys = new Map<CooldownSlot, KeyView>();
  private readonly yen: HTMLDivElement;
  private readonly play: HTMLDivElement;
  private readonly equipped: HTMLDivElement;
  private readonly prompt: HTMLButtonElement;
  private readonly promptText: HTMLSpanElement;
  private readonly feed: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerTitle: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private readonly veil: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly streak: HTMLDivElement;
  private readonly alert: HTMLDivElement;
  private readonly alertText: HTMLDivElement;
  private readonly alertFace: HTMLImageElement;
  private readonly marker: HTMLDivElement;
  private readonly cross: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly all: HTMLElement[] = [];
  private lastYen = -1;
  private lastHp = -1;
  private promptSignature = '';

  constructor(private readonly parent: HTMLElement, callbacks: HudCallbacks) {
    injectArenaStyles();
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into?: HTMLElement): HTMLElementTagNameMap[K] => {
      const element = document.createElement(tag);
      element.className = className;
      (into ?? parent).appendChild(element);
      if (!into) this.all.push(element);
      return element;
    };

    // ---- bottom left
    this.left = el('div', 'ar-left');
    this.hp = el('div', 'ar-hp', this.left);
    const heart = el('div', 'ar-hp__heart', this.hp);
    heart.innerHTML = HEART;
    this.hpGhost = el('div', 'ar-hp__ghost', this.hp);
    this.hpFill = el('div', 'ar-hp__fill', this.hp);
    this.hpText = el('div', 'ar-hp__text ar-font ar-outline', this.hp);
    this.buff = el('div', 'ar-buff ar-font ar-outline', this.left);
    this.buff.hidden = true;
    const title = el('div', 'ar-abilities-title ar-font ar-outline', this.left);
    title.textContent = 'Abilities:';
    const keys = el('div', 'ar-keys', this.left);
    const key = (slot: CooldownSlot, bind: string, variant = ''): void => {
      const root = el('div', `ar-key ${variant}`, keys);
      const gem = el('div', 'ar-key__gem', root);
      const shade = el('span', 'ar-key__shade', gem);
      const b = el('span', 'ar-key__bind ar-font ar-outline', gem);
      b.textContent = bind;
      const timer = el('span', 'ar-key__timer ar-font ar-outline', gem);
      const name = el('span', 'ar-key__name ar-font ar-outline', root);
      this.keys.set(slot, { root, shade, timer, name, cooling: false });
    };
    key('attack', 'M1');
    key('dash', 'Q');
    key('skill', 'E', 'ar-key--skill');
    key('ultimate', 'R', 'ar-key--ult');
    key('jump', 'SPACE', 'ar-key--small');
    this.keys.get('dash')!.name.textContent = 'Dash';
    this.keys.get('jump')!.name.textContent = 'Jump';

    const tiles = el('div', 'ar-tiles', this.left);
    const tile = (variant: string, label: string, icon: string, hotkey: string, onClick: () => void): void => {
      const button = el('button', `ar-tile ar-tile--${variant}`, tiles);
      button.type = 'button';
      button.innerHTML = icon;
      const text = el('span', 'ar-tile__label ar-font ar-outline', button);
      text.textContent = label;
      const k = el('span', 'ar-tile__key ar-font ar-outline', button);
      k.textContent = hotkey;
      button.setAttribute('aria-label', `${label} (${hotkey})`);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
    };
    tile('inventory', 'Inventory', '<img src="/ui/inventory.png" alt="" draggable="false">', 'I', callbacks.onInventory);
    tile('settings', 'Settings', GEAR, 'O', callbacks.onSettings);

    // ---- bottom right
    this.yen = el('div', 'ar-yen ar-font ar-outline');

    // ---- lobby centre
    this.play = el('div', 'ar-play');
    this.equipped = el('div', 'ar-play__equipped ar-font ar-outline', this.play);
    const row = el('div', 'ar-play__row', this.play);
    const star = el('div', 'ar-play__star', row);
    star.innerHTML = STAR_MARK;
    const playButton = el('button', 'ar-play__button ar-font ar-outline', row);
    playButton.type = 'button';
    playButton.textContent = 'PLAY!';
    playButton.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onPlay();
    });
    playButton.addEventListener('pointerdown', (event) => event.stopPropagation());

    this.prompt = el('button', 'ar-prompt ar-font ar-outline');
    this.prompt.type = 'button';
    this.prompt.hidden = true;
    const promptKey = el('span', 'ar-prompt__key', this.prompt);
    promptKey.textContent = 'F';
    this.promptText = el('span', '', this.prompt);
    this.prompt.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onPrompt();
    });
    this.prompt.addEventListener('pointerdown', (event) => event.stopPropagation());

    this.feed = el('div', 'ar-feed');
    this.veil = el('div', 'ar-death-veil');
    this.hurt = el('div', 'ar-hurt');
    this.flash = el('div', 'ar-flash');
    this.banner = el('div', 'ar-banner');
    this.banner.hidden = true;
    this.bannerTitle = el('div', 'ar-banner__title ar-font ar-outline', this.banner);
    this.bannerSub = el('div', 'ar-banner__sub ar-font ar-outline', this.banner);
    this.streak = el('div', 'ar-streak ar-font ar-outline');
    this.zone = el('div', 'ar-zone ar-font ar-outline');

    this.alert = el('div', 'ar-alert');
    this.alert.hidden = true;
    const alertStar = el('div', 'ar-alert__star', this.alert);
    alertStar.innerHTML = STAR_MARK_GREY;
    const alertBody = el('div', 'ar-alert__body', this.alert);
    const alertTitle = el('div', 'ar-alert__title ar-font ar-outline', alertBody);
    alertTitle.textContent = 'ALERT!';
    this.alertText = el('div', 'ar-alert__text ar-font ar-outline', alertBody);
    const face = el('div', 'ar-alert__face', this.alert);
    this.alertFace = el('img', '', face);
    this.alertFace.alt = '';

    this.marker = el('div', 'ar-marker');
    this.cross = el('div', 'ar-cross');
    this.cross.hidden = true;
    this.toasts = el('div', 'ar-toasts');
  }

  /** Health; hidden bar numbers on the island are still drawn (always full there). */
  setHealth(hp: number): void {
    const value = Math.max(0, Math.round(hp));
    if (value === this.lastHp) return;
    this.lastHp = value;
    const fraction = value / COMBAT.maxHp;
    this.hpFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.hpGhost.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.hpText.textContent = String(value);
    this.hp.classList.toggle('ar-hp--low', fraction <= 0.3 && value > 0);
  }

  setBuff(name: string | null, seconds: number): void {
    this.buff.hidden = !name;
    if (name) this.buff.textContent = `${name} ${Math.ceil(seconds)}s`;
  }

  setKit(kit: KitDef): void {
    this.keys.get('attack')!.name.textContent = M1_NAMES[kit.m1] ?? 'Attack';
    this.keys.get('skill')!.name.textContent = kit.skill.name;
    this.keys.get('ultimate')!.name.textContent = kit.ultimate.name;
    this.equipped.textContent = `Equipped: ${kit.name}`;
  }

  setCooldown(slot: CooldownSlot, remaining: number, total: number): void {
    const view = this.keys.get(slot);
    if (!view) return;
    const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    const cooling = fraction > 0.001;
    view.shade.style.setProperty('--cd', `${(fraction * 360).toFixed(1)}deg`);
    const text = cooling && total >= 1 ? (remaining >= 10 ? Math.ceil(remaining).toString() : remaining.toFixed(1)) : '';
    if (view.timer.textContent !== text) view.timer.textContent = text;
    if (cooling !== view.cooling) {
      view.root.classList.toggle('is-cooling', cooling);
      if (!cooling) {
        view.root.classList.remove('is-ready');
        void view.root.offsetWidth;
        view.root.classList.add('is-ready');
      }
      view.cooling = cooling;
    }
  }

  setYen(yen: number): void {
    if (yen === this.lastYen) return;
    this.yen.textContent = formatYen(yen);
    if (this.lastYen >= 0 && yen > this.lastYen) {
      this.yen.classList.remove('ar-yen--pop');
      void this.yen.offsetWidth;
      this.yen.classList.add('ar-yen--pop');
    }
    this.lastYen = yen;
  }

  /** "+12¥" rising from the Yen counter. */
  gain(amount: number, kill: boolean): void {
    const rect = this.yen.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'ar-gain ar-font ar-outline';
    pop.textContent = `+${formatYen(amount)}${kill ? ' KO!' : ''}`;
    pop.style.left = `${rect.left + rect.width / 2}px`;
    pop.style.top = `${rect.top - 10}px`;
    this.parent.appendChild(pop);
    window.setTimeout(() => pop.remove(), 1100);
  }

  setLobby(inLobby: boolean): void {
    this.play.hidden = !inLobby;
    this.cross.hidden = inLobby;
  }

  /** The pedestal prompt. Null hides it. */
  setPrompt(text: string | null, tone: 'buy' | 'poor' | 'plain' = 'plain'): void {
    const signature = text === null ? '' : `${tone}:${text}`;
    if (signature === this.promptSignature) return;
    this.promptSignature = signature;
    this.prompt.hidden = text === null;
    if (text === null) return;
    this.promptText.textContent = text;
    this.prompt.classList.toggle('ar-prompt--buy', tone === 'buy');
    this.prompt.classList.toggle('ar-prompt--poor', tone === 'poor');
  }

  /** One kill-feed row. */
  killFeed(killer: string, victim: string, fell: boolean, mine: boolean): void {
    const row = document.createElement('div');
    row.className = `ar-feed__row ar-font ar-outline${mine ? ' ar-feed__row--me' : ''}`;
    const k = document.createElement('b');
    const v = document.createElement('i');
    v.textContent = victim;
    if (killer) {
      k.textContent = killer;
      row.append(k, document.createTextNode(fell ? ' knocked off ' : ' defeated '), v);
    } else {
      row.append(v, document.createTextNode(' fell off the island'));
    }
    this.feed.prepend(row);
    while (this.feed.childElementCount > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => row.remove(), 5000);
  }

  showBanner(title: string, sub: string, death = false): void {
    this.banner.hidden = false;
    this.banner.classList.toggle('ar-banner--death', death);
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('ar-banner--show');
    void this.banner.offsetWidth;
    this.banner.classList.add('ar-banner--show');
  }

  setBannerSub(sub: string): void {
    this.bannerSub.textContent = sub;
  }

  hideBanner(): void {
    this.banner.hidden = true;
  }

  setDeathVeil(on: boolean): void {
    this.veil.classList.toggle('ar-death-veil--on', on);
  }

  hurtFlash(): void {
    this.hurt.classList.remove('ar-hurt--flash');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('ar-hurt--flash');
  }

  whiteFlash(): void {
    this.flash.classList.remove('ar-flash--on');
    void this.flash.offsetWidth;
    this.flash.classList.add('ar-flash--on');
  }

  callout(text: string): void {
    this.streak.textContent = text;
    this.streak.classList.remove('ar-streak--show');
    void this.streak.offsetWidth;
    this.streak.classList.add('ar-streak--show');
  }

  zoneTitle(text: string): void {
    this.zone.textContent = text;
    this.zone.classList.remove('ar-zone--show');
    void this.zone.offsetWidth;
    this.zone.classList.add('ar-zone--show');
  }

  /** The reference's ALERT! ribbon, with the kit's portrait. */
  showAlert(kitId: string, text: string): void {
    this.alertText.textContent = text;
    this.alertFace.src = kitPortraitUrl(kitId);
    this.alert.hidden = false;
    this.alert.classList.remove('ar-alert--show');
    void this.alert.offsetWidth;
    this.alert.classList.add('ar-alert--show');
  }

  hitMarker(): void {
    this.marker.classList.remove('ar-marker--hit');
    void this.marker.offsetWidth;
    this.marker.classList.add('ar-marker--hit');
  }

  /** A damage number at a screen point. */
  damage(x: number, y: number, amount: number, kind: 'normal' | 'big' | 'me' | 'blocked'): void {
    const pop = document.createElement('div');
    pop.className = `ar-dmg ar-font ar-outline${kind === 'normal' ? '' : ` ar-dmg--${kind}`}`;
    pop.textContent = kind === 'blocked' ? 'BLOCKED' : String(amount);
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    this.parent.appendChild(pop);
    const drift = (Math.random() - 0.5) * 40;
    pop.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
        { transform: 'translate(-50%, -80%) scale(1.25)', opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${drift}px), -260%) scale(1)`, opacity: 0 },
      ],
      { duration: 850, easing: 'ease-out' },
    );
    window.setTimeout(() => pop.remove(), 860);
  }

  toast(text: string, tone: 'good' | 'bad' | 'gold' = 'good'): void {
    const row = document.createElement('div');
    row.className = `ar-toast ar-toast--${tone} ar-font ar-outline`;
    row.textContent = text;
    this.toasts.appendChild(row);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => row.remove(), 2400);
  }

  dispose(): void {
    for (const element of this.all) element.remove();
  }
}
