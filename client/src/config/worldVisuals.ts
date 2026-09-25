/**
 * THE PALETTE: a bright Roblox-style afternoon over the sea - pale sand,
 * slate-blue stone, deep blocky greens, a clean sky. Readable, never muddy.
 *
 * COLOUR ONLY. Every coordinate lives in `@arena/shared`'s map config.
 */
export const PALETTE = {
  /** Boards. */
  boardFrame: 0x5a6a92,
  boardFrameDark: 0x3c4868,
  boardPanel: '#5f6f96',
  boardPanelEdge: '#3e4a6b',
  boardStripe: 'rgba(255, 255, 255, 0.05)',
  boardInk: '#1b2238',
  boardHeading: '#e9eeff',
  boardName: '#ffffff',
  boardValue: '#dfe6ff',

  /** Ground. */
  sand: '#d9c9a3',
  sandDark: '#c4b287',
  grass: '#4f9e4a',
  grassDark: '#3f8a3c',
  path: '#b9ae94',
  stone: '#7b8fb8',
  stoneDark: '#5b6c93',
  ruin: '#a9b6d0',
  trunk: '#4a3b52',
  leaves: '#2f7a5c',
  leavesDark: '#255f4a',
  cliff: '#8793b0',
  sea: 0x3f8fd8,
  seaDeep: 0x2a6fb8,

  /** Sky and fog. */
  skyTop: 0x3f94ea,
  sky: 0x8fd0ff,
  fog: 0xcfe8ff,
  skyCloud: 0xffffff,
  skyCloudShade: 0xd9e8f7,
} as const;

/** Fog band: the far island melts into the sky. */
export const WORLD_FOG = {
  near: 220,
  far: 700,
} as const;

/** Yaw correction for the supplied player FBX. It already faces +Z. */
export const PLAYER_MODEL_YAW_OFFSET = 0;
