import type { PlayerState } from '../rooms/state/PlayerState.js';

/** Largest Yen balance the game will hold. */
const MAX_YEN = 1e12;

/**
 * The ONE place Yen is added or removed.
 *
 * Damage, kills and Bux grants add it (and the lifetime total); kits are
 * BOUGHT with it (`wallet.spend`, after every other check has passed).
 */
export const wallet = {
  add(player: PlayerState, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = player.yen;
    player.yen = Math.min(MAX_YEN, Math.floor(before + amount));
    const granted = player.yen - before;
    player.lifetimeYen = Math.min(MAX_YEN, player.lifetimeYen + granted);
    return granted;
  },

  /** Deduct Yen. False and unchanged when the player cannot afford it. */
  spend(player: PlayerState, cost: number): boolean {
    const price = Math.floor(Number.isFinite(cost) ? Math.max(0, cost) : 0);
    if (player.yen < price) return false;
    player.yen -= price;
    return true;
  },
};
