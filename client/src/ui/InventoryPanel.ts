import { KITS, M1, formatYen, kitById, type AbilityDef, type KitDef } from '@arena/shared';
import { kitPortraitUrl } from './KitPortraits.js';
import { Panel } from './Panel.js';
import { injectArenaStyles } from './arenaStyles.js';

const M1_LABEL: Readonly<Record<string, string>> = { fist: 'Punch combo', sword: 'Sword combo', dagger: 'Dagger combo', polearm: 'Polearm combo' };

/**
 * THE INVENTORY: every moveset, as the reference lays it out - a grid of
 * round portraits, each with its name above and one button under it
 * (Equipped / Equip / its Yen price), and a detail card on the right with
 * the selected kit's moves. Buying and equipping are REQUESTS; the server
 * checks the Yen and the ownership, and this redraws from replicated state.
 */
export class InventoryPanel extends Panel {
  private readonly grid: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly yenLine: HTMLDivElement;
  private owned: readonly string[] = ['asta'];
  private equipped = 'asta';
  private pending = '';
  private yen = 0;
  private selected = 'asta';
  private signature = '';

  constructor(
    parent: HTMLElement,
    private readonly onBuy: (id: string) => void,
    private readonly onEquip: (id: string) => void,
  ) {
    super(parent, 'inventory', 'Inventory', '<img class="aoe-icon" src="/ui/inventory.png" alt="">');
    injectArenaStyles();
    const box = this.root.querySelector('.aoe-panel__box') as HTMLDivElement;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ar-inv__close';
    close.innerHTML = '<span>X</span>';
    close.addEventListener('click', () => this.setOpen(false));
    box.appendChild(close);

    const layout = document.createElement('div');
    layout.className = 'ar-inv';
    const main = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'ar-inv__section ar-font ar-outline';
    section.textContent = 'Movesets';
    this.yenLine = document.createElement('div');
    this.yenLine.className = 'ar-inv__yen ar-font ar-outline';
    this.grid = document.createElement('div');
    this.grid.className = 'ar-inv__grid';
    main.append(section, this.yenLine, this.grid);
    this.detail = document.createElement('div');
    this.detail.className = 'ar-detail';
    layout.append(main, this.detail);
    this.body.appendChild(layout);
    this.render();
  }

  setState(owned: readonly string[], equipped: string, pending: string, yen: number): void {
    const signature = `${owned.join(',')}|${equipped}|${pending}|${yen}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.owned = owned;
    this.equipped = equipped;
    this.pending = pending;
    this.yen = yen;
    if (this.isOpen) this.render();
  }

  /** Open on a particular kit (a pedestal's). */
  openOn(id: string): void {
    this.selected = id;
    this.setOpen(true);
  }

  protected override onOpened(): void {
    this.render();
  }

  private button(kit: KitDef, big = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${big ? 'aoe-action ar-detail__btn' : 'ar-card__btn'} ar-font ar-outline`;
    const owned = this.owned.includes(kit.id);
    const wearing = this.pending ? kit.id === this.pending : kit.id === this.equipped;
    if (wearing) {
      button.textContent = this.pending && kit.id === this.pending ? 'On Respawn' : 'Equipped';
      button.disabled = big;
    } else if (owned) {
      button.textContent = 'Equip';
      if (!big) button.classList.add('ar-card__btn--equip');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.onEquip(kit.id);
      });
    } else {
      button.textContent = big ? `Buy ${formatYen(kit.price)}` : formatYen(kit.price);
      const poor = this.yen < kit.price;
      if (!big) button.classList.add(poor ? 'ar-card__btn--poor' : 'ar-card__btn--price');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.onBuy(kit.id);
      });
    }
    return button;
  }

  private render(): void {
    this.yenLine.textContent = `You have ${formatYen(this.yen)}`;
    this.grid.replaceChildren();
    for (const kit of [...KITS].sort((a, b) => a.price - b.price)) {
      const card = document.createElement('div');
      card.className = 'ar-card';
      if (kit.id === this.selected) card.classList.add('ar-card--selected');
      if (!this.owned.includes(kit.id)) card.classList.add('ar-card--locked');
      const name = document.createElement('div');
      name.className = 'ar-card__name ar-font ar-outline';
      name.textContent = kit.name;
      const face = document.createElement('img');
      face.className = 'ar-card__face';
      face.src = kitPortraitUrl(kit.id);
      face.alt = kit.name;
      face.draggable = false;
      card.append(name, face, this.button(kit));
      if (kit.isNew) {
        const tag = document.createElement('span');
        tag.className = 'ar-card__new ar-font ar-outline';
        tag.textContent = 'NEW';
        card.appendChild(tag);
      }
      card.addEventListener('click', () => {
        this.selected = kit.id;
        this.render();
      });
      this.grid.appendChild(card);
    }
    this.renderDetail();
  }

  private renderDetail(): void {
    const kit = kitById(this.selected) ?? KITS[0]!;
    this.detail.replaceChildren();
    const name = document.createElement('div');
    name.className = 'ar-detail__name ar-font ar-outline';
    name.textContent = kit.name;
    const face = document.createElement('img');
    face.className = 'ar-detail__face';
    face.src = kitPortraitUrl(kit.id);
    face.alt = '';
    const moves = document.createElement('div');
    moves.className = 'ar-detail__moves ar-font ar-outline';
    moves.textContent = 'Moves:';
    const move = (key: string, title: string, text: string, cooldown?: number): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = 'ar-detail__move ar-font';
      const b = document.createElement('b');
      b.className = 'ar-outline';
      b.textContent = `${key} - ${title}`;
      const p = document.createElement('p');
      p.textContent = text;
      row.append(b);
      if (cooldown !== undefined) {
        const small = document.createElement('small');
        small.textContent = `  ${cooldown}s`;
        b.appendChild(small);
      }
      row.append(p);
      return row;
    };
    const ability = (key: string, a: AbilityDef): HTMLDivElement => move(key, a.name, a.description, a.cooldown);
    this.detail.append(
      name,
      face,
      moves,
      move('M1', M1_LABEL[kit.m1] ?? 'Attack', `Three-hit combo, every hit launches (${M1[kit.m1].hit.damage}-${M1[kit.m1].finisher.damage} dmg).`),
      ability('E', kit.skill),
      ability('R', kit.ultimate),
      this.button(kit, true),
    );
  }
}
