/**
 * Combat and economy tuning. Every figure is applied by the SERVER; the
 * client reads these only to draw (health bars, cooldown rings).
 */
export const COMBAT = {
  maxHp: 100,
  /** Yen for each point of damage dealt to another player. */
  yenPerDamage: 1,
  /** Yen for a kill, plus a bonus per kill in the current streak. */
  killYen: 40,
  streakYen: 10,
  maxStreakYen: 100,
  /** A player knocked off the island within this long of a hit is the hitter's kill. */
  creditSeconds: 8,
  /** Seconds without taking damage before health comes back, and how fast. */
  regenDelay: 6,
  regenPerSecond: 5,
  /** Seconds a fresh arrival in the arena cannot be hurt (ends early on attacking). */
  spawnShield: 2.5,
  /** Seconds between dying and reappearing on the spawn island. */
  deathSeconds: 3,
  /** Vertical reach of a hitbox either side of the victim's middle. */
  verticalReach: 4.2,
  /** Share of a cooldown a cast may arrive early by (network jitter). */
  cooldownSlack: 0.88,
} as const;

/** Bloxity Bux products: what each SKU grants, in Yen. */
export const BUX_YEN: Readonly<Record<string, number>> = {
  yen_small: 2500,
  yen_large: 25000,
};

/** Yen as the HUD prints it: 505¥, 12,000¥, 1.2M¥. */
export const formatYen = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (amount >= 1_000_000) return `${(Math.floor(amount / 100_000) / 10).toString()}M¥`;
  return `${amount.toLocaleString('en-US')}¥`;
};

/** A whole number with separators: 52,115. */
export const formatCount = (value: number): string =>
  (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0).toLocaleString('en-US');
