import { logger } from '../util/logger.js';
import type { Bloxity } from '../bloxity/Bloxity.js';
import type { LegionFriend, LegionUser } from '../bloxity/legionTypes.js';
import { Panel } from './Panel.js';
import { injectHudStyles } from './hudStyles.js';

const SCOPE = 'bloxity/ui';

/**
 * A panel whose body can be filled from outside.
 *
 * `Panel.body` is protected on purpose - a panel owns its own contents - so
 * the way to fill one is to BE one. This exposes a single container to write
 * into and changes nothing else, which keeps the open/close accounting and the
 * movement suppression exactly where they already are.
 */
class ContentPanel extends Panel {
  readonly content = document.createElement('div');

  constructor(parent: HTMLElement, variant: string, title: string) {
    super(parent, variant, title);
    this.body.appendChild(this.content);
  }
}

/** Fallback portrait, from the portal's own CDN. */
const DEFAULT_PFP = 'https://static.bloxity.io/img/pfps/0.png?width=128&quality=85';

/**
 * The portal's face inside the game.
 *
 * An account chip on the right of the screen, with friends and the avatar
 * customiser behind it. There is no store. It owns no state - the chip is redrawn from
 * whatever `Bloxity.onUserChanged` last said, and every figure it shows is
 * fetched when the panel opens rather than cached, so a purchase made in
 * another tab cannot leave a stale balance on screen.
 *
 * The panels extend the game's own `Panel`, which is what keeps movement
 * suppressed while one is open - a shop the player walks out of mid-purchase
 * would be a shop with a different bug every time.
 */
export class BloxityPanel {
  private readonly bloxity: Bloxity;
  private readonly chip: HTMLDivElement;
  private readonly friends: ContentPanel;

  private readonly friendsBody: HTMLDivElement;

  private readonly offUser: () => void;

  /** The room to invite people into. '' while not in one. */
  private roomId = '';

  constructor(parent: HTMLElement, bloxity: Bloxity) {
    injectHudStyles();
    this.bloxity = bloxity;

    this.chip = document.createElement('div');
    this.chip.className = 'aoe-account aoe-font';
    parent.appendChild(this.chip);

    this.friends = new ContentPanel(parent, 'friends', 'Friends');
    this.friendsBody = this.friends.content;

    // THE one auth subscription in the UI layer, fanned out from the one in
    // `Bloxity`. It fires immediately, so the chip is never blank.
    this.offUser = this.bloxity.onUserChanged((user) => this.renderChip(user));
  }

  /** Tell the panel which room an invite should point at. */
  setRoom(roomId: string): void {
    this.roomId = roomId;
  }

  dispose(): void {
    this.offUser();
    this.chip.remove();
    this.friends.dispose();
  }

  // ------------------------------------------------------------------ chip

  private renderChip(user: LegionUser | null): void {
    this.chip.replaceChildren();

    if (!this.bloxity.available) {
      // Say so rather than showing a login button that cannot work.
      const note = document.createElement('span');
      note.className = 'aoe-account__note';
      note.textContent = 'Playing offline';
      this.chip.appendChild(note);
      return;
    }

    if (!user) {
      this.chip.appendChild(
        this.button('Log in', 'aoe-account__login', () => {
          void this.bloxity.showAuthPopup();
        }),
      );
      return;
    }

    const pfp = document.createElement('img');
    pfp.className = 'aoe-account__pfp';
    pfp.src = user.pfp || DEFAULT_PFP;
    pfp.alt = '';
    pfp.draggable = false;

    const name = document.createElement('span');
    name.className = 'aoe-account__name';
    name.textContent = user.displayName || user.username;

    const row = document.createElement('div');
    row.className = 'aoe-account__row';
    row.append(pfp, name);

    const actions = document.createElement('div');
    actions.className = 'aoe-account__actions';
    actions.append(
      this.button('Friends', 'aoe-account__btn', () => void this.openFriends()),
      this.button('Avatar', 'aoe-account__btn', () => this.bloxity.showCustomizer()),
    );

    this.chip.append(row, actions);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `${className} aoe-font`;
    node.textContent = label;
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return node;
  }

  // --------------------------------------------------------------- friends

  private async openFriends(): Promise<void> {
    this.friends.setOpen(true);
    this.friendsBody.replaceChildren(this.note('Loading friends…'));

    const list = await this.bloxity.getFriends();
    if (!this.friends.isOpen) return;

    if (list.length === 0) {
      this.friendsBody.replaceChildren(
        this.note('No friends yet. Add some on bloxity.io.'),
      );
    } else {
      this.friendsBody.replaceChildren(...list.map((friend) => this.friendRow(friend)));
    }

    // The shareable link, which works whether the game is embedded or not.
    const link = this.bloxity.getInviteLink(this.roomId);
    if (!link) return;
    const copy = this.button('Copy invite link', 'aoe-action', () => {
      void navigator.clipboard
        .writeText(link)
        .then(() => {
          copy.textContent = 'Copied!';
          window.setTimeout(() => (copy.textContent = 'Copy invite link'), 1500);
        })
        .catch(() => logger.warn(SCOPE, 'clipboard refused the invite link'));
    });
    this.friendsBody.appendChild(copy);
  }

  private friendRow(friend: LegionFriend): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'aoe-friend';

    const pfp = document.createElement('img');
    pfp.className = 'aoe-friend__pfp';
    pfp.src = friend.pfp || DEFAULT_PFP;
    pfp.alt = '';
    pfp.draggable = false;

    /*
     * THE DISPLAY NAME, and only the display name.
     *
     * This row used to carry the login handle underneath it as a second line.
     * It is a real portal username rather than anything generated, but it is
     * still an IDENTIFIER, and this game shows people the name they chose -
     * over a mech, on a board and here - and never an id of any kind.
     */
    const name = document.createElement('div');
    name.className = 'aoe-friend__name';
    name.innerHTML = `<b>${escapeHtml(friend.displayName || friend.username)}</b>`;

    const status = document.createElement('span');
    status.className = 'aoe-friend__status';
    status.textContent = presenceLabel(friend);

    const invite = this.button('Invite', 'aoe-friend__invite', () => {
      invite.disabled = true;
      void this.bloxity.inviteFriend(friend._id, this.roomId).then((sent) => {
        invite.textContent = sent ? 'Invited' : 'Failed';
        if (!sent) invite.disabled = false;
      });
    });

    row.append(pfp, name, status, invite);
    return row;
  }

  private note(text: string): HTMLParagraphElement {
    const node = document.createElement('p');
    node.className = 'aoe-panel__note';
    node.textContent = text;
    return node;
  }
}

/**
 * The presence word.
 *
 * Accepts BOTH spellings of the in-game status: the documentation says
 * `in-game` and the reference implementation emits `in_game`, and a portal
 * that changes its mind must not silently turn every friend grey.
 */
const presenceLabel = (friend: LegionFriend): string => {
  const status = friend.presence?.status ?? 'offline';
  const game = friend.presence?.gameName ?? friend.presence?.currentGame;
  if (status === 'in-game' || status === 'in_game') return game ? `In ${game}` : 'In game';
  if (status === 'online') return 'Online';
  if (status === 'away') return 'Away';
  return 'Offline';
};

/** Friend names come from other people; they are never markup. */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) =>
    char === '&'
      ? '&amp;'
      : char === '<'
        ? '&lt;'
        : char === '>'
          ? '&gt;'
          : char === '"'
            ? '&quot;'
            : '&#39;',
  );
