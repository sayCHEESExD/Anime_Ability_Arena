import { DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS, KITS, type AvatarAppearance, type AvatarProportions } from '@arena/shared';

/**
 * WHO A FILL-IN PLAYER IS: a name that reads like anyone else's, a play style,
 * a skill level, and an avatar dressed from Bloxity's public catalogue.
 *
 * The style and skill are derived from the NAME (a stable hash), so the same
 * "player" who turns up again next week fights the same way - an aggressive
 * rusher stays one. Nothing here is ever shown as a bot marker; the names are
 * ordinary handles and the looks are real catalogue items.
 */

export type BotStyle = 'aggressive' | 'ranged' | 'defensive' | 'balanced';

export interface BotPersona {
  readonly name: string;
  /** Profile key the persona's lifetime stats live under. Never shown. */
  readonly key: string;
  readonly style: BotStyle;
  /** 0 (clumsy) .. 1 (sharp). Drives aim, reactions and judgement. */
  readonly skill: number;
  /** Seconds between something happening and the persona responding to it. */
  readonly reaction: number;
}

const NAMES = [
  'kaito_2011', 'NightFoxx', 'xXShadowBladeXx', 'ren_senpai', 'Zyrox77', 'mochi_puff', 'itz_dante', 'Kuroneko_Z',
  'blaze1904', 'ToastyNoodle', 'sukiyaki_kid', 'ProGamerMax09', 'LunaRaye', 'yuki_haze', 'Dr4gonSlay3r', 'coolkid_aj',
  'hikari_rin', 'Zenitsu_Fan', 'OblivionX', 'tacobell_fan22', 'Ryuu_Kage', 'minty_bloom', 'StormRider88', 'JJK_enjoyer',
  'akiraaa', 'bubblegum_rex', 'SilverFang_7', 'noodle_ninja', 'Kira_Senko', 'pixel_panda03', 'VoidWalkerr', 'sakura_mist',
  'TheRealZeke', 'hotdog_hero', 'shinobi_ace', 'Frostbyte21', 'itsmekenji', 'glitchy_gg', 'Raiden_X', 'cloudberry_7',
  'zoomer_zed', 'KatanaKai', 'lil_onigiri', 'BlueJayz', 'Nexus_Prime9', 'waffles4ever', 'tsuki_no_ko', 'CrimsonAce',
  'ghostpepper_x', 'Haruto_Plays', 'epicnate2012', 'MangoTango_', 'ShadowMonarchh', 'kawaii_kong', 'Blitz_Kaiser', 'riceball_ryo',
  'ZeroTwoFan', 'duck_lord99', 'Sorane_', 'OrangeSoda44', 'Takumi_Drift', 'ninja_nugget', 'Vortex_Viper', 'honeybun_hi',
  'Rogue_Kitsune', 'chillmode_ty', 'Asura_Strike', 'cheesecake_kn', 'Tempest77', 'yeet_master3000',
] as const;

/** A stable 32-bit hash, so a name always maps to the same habits. */
const hash = (value: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const STYLES: readonly BotStyle[] = ['aggressive', 'ranged', 'defensive', 'balanced', 'aggressive', 'balanced'];

export const personaFor = (name: string): BotPersona => {
  const h = hash(name);
  // Skill spreads from clumsy to sharp; most sit in the middle, like a real lobby.
  const a = ((h >>> 8) & 0xff) / 255;
  const b = ((h >>> 16) & 0xff) / 255;
  const skill = 0.25 + ((a + b) / 2) * 0.65;
  return {
    name,
    key: `bot_${name.toLowerCase().replace(/[^a-z0-9_]/g, '')}`,
    style: STYLES[h % STYLES.length]!,
    skill,
    // Sharper players react faster; everyone is between ~0.18 s and ~0.5 s.
    reaction: 0.18 + (1 - skill) * 0.28 + (((h >>> 24) & 0xff) / 255) * 0.06,
  };
};

/** A persona not already in this room. */
export const pickPersona = (inUse: ReadonlySet<string>, random: () => number = Math.random): BotPersona => {
  const free = NAMES.filter((name) => !inUse.has(name));
  const pool = free.length > 0 ? free : NAMES;
  return personaFor(pool[Math.floor(random() * pool.length)]!);
};

// Catalogue ids from https://api.bloxity.io/v1/avatar/items (public), by slot.
const SKINS = ['69cb00f6c3c4aac219abd8c3', '6a64132cc15c92a8d8f7e0fc', '6a33eae79e8362499889c351', '6a33f3e99e820be9a1eab1a7', '69d8a70b2240b84a28355eeb', '6a05227281f9706108234f12', '69cccd98e846506e2c476254', '6a406d92cb8211ae598d9d13', '69cb4d26d4d8030160b05673', '69c816ee3ecd845acf8232fc', '69cf6a006beecd2f1a3bc792', '6a5ef38b49230685c1a834a6', '6a406bb8cb8211ae598ca3cb'];
const HEADS = ['69c816f83ecd845acf823368', '69d616eb89c7be405c2a49ce', '69d615a889c7be405c2a451f', '69c816f93ecd845acf82336e', '69d6170c89c7be405c2a4a42', '69d6b4612240b84a282f3ace', '69d4ba11898417846b7a9af7', '69d617e189c7be405c2a4bef', '69d6b26d2240b84a282f3628', '69c816f83ecd845acf82336b'];
const TORSOS = ['69d61a0689c7be405c2a5579', '69c816fc3ecd845acf823392', '69c816fc3ecd845acf823395', '69d4ba42898417846b7a9b65', '69d4a9b8898417846b7a73ad'];
const ARMS = ['69c816fa3ecd845acf823377', '69d61b8089c7be405c2a5ce4', '69c816fa3ecd845acf82337d', '69c816fa3ecd845acf82337a', '69d6252689c7be405c2a8212', '69d4a953898417846b7a7283', '69d621bf89c7be405c2a7878'];
const LEGS = ['69d6251289c7be405c2a81b7', '69c816fb3ecd845acf823389', '69c816fb3ecd845acf823386'];
/** Hats; `force` ones are modelled round the stock head, so they clear the head slot. */
const HATS: readonly { id: string; force?: boolean }[] = [
  { id: '69c816be3ecd845acf82310d', force: true },
  { id: '69c816be3ecd845acf82310a' },
  { id: '69c816c33ecd845acf82313d' },
  { id: '69c816c63ecd845acf82315e' },
  { id: '6a44d5c4089e7e9a7db5d027' },
  { id: '69c816bd3ecd845acf8230f9', force: true },
  { id: '69c816c33ecd845acf823140' },
  { id: '69c816bd3ecd845acf8230ff' },
  { id: '69c816db3ecd845acf823233' },
  { id: '6a44d5c6089e7e9a7db5d03c' },
];
const BACKS = ['69c816de3ecd845acf823254', '69c816df3ecd845acf823260', '69c816e13ecd845acf823272', '69c816df3ecd845acf823266', '69c816df3ecd845acf823263'];

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)]!;

/** A plausible outfit: some players wear the default, most wear a few items. */
export const randomLook = (random: () => number = Math.random): { appearance: AvatarAppearance; proportions: AvatarProportions } => {
  const appearance: AvatarAppearance = { ...DEFAULT_APPEARANCE };
  if (random() < 0.7) appearance.skinId = pick(SKINS, random);
  if (random() < 0.45) appearance.headId = pick(HEADS, random);
  if (random() < 0.4) appearance.torsoId = pick(TORSOS, random);
  if (random() < 0.4) {
    const arms = pick(ARMS, random);
    appearance.armLId = arms;
    appearance.armRId = arms;
  }
  if (random() < 0.3) {
    const legs = pick(LEGS, random);
    appearance.legLId = legs;
    appearance.legRId = legs;
  }
  if (random() < 0.4) {
    const hat = pick(HATS, random);
    appearance.hatId = hat.id;
    if (hat.force) appearance.headId = '';
  }
  if (random() < 0.2) appearance.backId = pick(BACKS, random);
  const proportions: AvatarProportions = { ...DEFAULT_PROPORTIONS };
  if (random() < 0.3) proportions.height = 0.92 + random() * 0.16;
  return { appearance, proportions };
};

/** Which kit a fill-in player brings: any of them, like a room of mixed progress. */
export const randomKit = (random: () => number = Math.random): string => pick(KITS, random).id;
