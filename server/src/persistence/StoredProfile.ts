/**
 * The facts of a player's progression that outlive a session: their Yen, the
 * kits they own and which one is equipped, and their lifetime combat stats
 * (which the Most Kills and Most Damage boards rank).
 */
export interface ProgressFields {
  yen: number;
  /** Yen earned, ever. */
  lifetimeYen: number;
  kills: number;
  deaths: number;
  /** Damage dealt to other players, ever. */
  damage: number;
  bestStreak: number;
  /** Kit ids owned. The default kit is always owned. */
  ownedKits: string[];
  /** The equipped kit id. */
  kit: string;
  /** Seconds played, lifetime. */
  playSeconds: number;
}

/** What one save writes. */
export interface ProfileFields extends ProgressFields {
  /** The portal's display name and portrait as last seen. Cleared when empty. */
  displayName: string;
  avatarUrl: string;
  /** Wall clock of the save. */
  updatedAt: number;
}

/**
 * The first-login migration's bookkeeping.
 *
 *   - An ACCOUNT profile created from a browser's guest progress carries
 *     `migratedFrom`, the guest key it came from.
 *   - That GUEST profile is then RETIRED: its progress is reset, it carries
 *     `migratedTo` (the account key), `migratedAt`, and `migratedSnapshot` -
 *     the progress it held at that moment, kept as a recovery copy.
 */
export interface MigrationFields {
  migratedFrom?: string;
  migratedTo?: string;
  migratedAt?: number;
  migratedSnapshot?: ProgressFields;
}

/**
 * A profile as READ from storage. Beyond the fields this build knows, it may
 * carry any field a newer or older build wrote: those are kept and written
 * back untouched, never dropped.
 */
export type StoredProfile = ProfileFields & MigrationFields & { [field: string]: unknown };

const NUMERIC_KEYS = ['yen', 'lifetimeYen', 'kills', 'deaths', 'damage', 'bestStreak', 'playSeconds'] as const satisfies readonly (keyof ProgressFields)[];

/** Optional string fields a save may CLEAR. The only fields ever $unset. */
export const CLEARABLE_FIELDS = ['displayName', 'avatarUrl'] as const;

const DEFAULT_KIT_ID = 'asta';

const numeric = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const ids = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value.slice(0, 64)) {
    if (typeof entry === 'string' && /^[a-z0-9_-]{1,32}$/.test(entry) && !out.includes(entry)) out.push(entry);
  }
  return out;
};

export const emptyProgress = (): ProgressFields => ({
  yen: 0,
  lifetimeYen: 0,
  kills: 0,
  deaths: 0,
  damage: 0,
  bestStreak: 0,
  ownedKits: [DEFAULT_KIT_ID],
  kit: DEFAULT_KIT_ID,
  playSeconds: 0,
});

/** Just the progression of a profile, coerced. */
export const progressOf = (source: Partial<ProgressFields>): ProgressFields => {
  const out = emptyProgress();
  for (const key of NUMERIC_KEYS) out[key] = numeric(source[key]);
  out.ownedKits = ids(source.ownedKits);
  if (!out.ownedKits.includes(DEFAULT_KIT_ID)) out.ownedKits.unshift(DEFAULT_KIT_ID);
  const kit = text(source.kit);
  out.kit = out.ownedKits.includes(kit) ? kit : DEFAULT_KIT_ID;
  return out;
};

/** Coerce whatever storage held into a profile, KEEPING every unknown field. */
export const coerceProfile = (raw: unknown): StoredProfile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const profile: StoredProfile = {
    ...source,
    ...progressOf(source as Partial<ProgressFields>),
    displayName: text(source['displayName']),
    avatarUrl: text(source['avatarUrl']),
    updatedAt: numeric(source['updatedAt']),
  };
  if (typeof source['migratedFrom'] !== 'string') delete profile.migratedFrom;
  if (typeof source['migratedTo'] !== 'string') delete profile.migratedTo;
  if (typeof source['migratedAt'] !== 'number') delete profile.migratedAt;
  if (source['migratedSnapshot'] && typeof source['migratedSnapshot'] === 'object') {
    profile.migratedSnapshot = progressOf(source['migratedSnapshot'] as Partial<ProgressFields>);
  } else {
    delete profile.migratedSnapshot;
  }
  return profile;
};

/** Whether a profile holds anything worth carrying into an account. */
export const hasProgress = (p: ProgressFields): boolean =>
  p.yen > 0 || p.lifetimeYen > 0 || p.kills > 0 || p.deaths > 0 || p.damage > 0 || p.ownedKits.length > 1;
