/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'animeabilityarena';

/**
 * Default server port. Override with the PORT env var on the server.
 *
 * Deliberately NOT 2567: the earlier games in this series occupy 2567-2593 on
 * the same machine, and sharing a port means whichever server starts first
 * silently serves both clients.
 */
export const DEFAULT_SERVER_PORT = 2601;

/**
 * Most players in ONE room.
 *
 * The matchmaker locks a room at this figure and opens another, so a
 * sixteenth player gets a new room rather than a refusal.
 */
export const MAX_PLAYERS_PER_ROOM = 15;

/**
 * How many OTHER players are drawn at once. A RENDERING limit only: every
 * player in the room is tracked and synchronised on every patch.
 */
export const VISIBLE_REMOTE_PLAYERS = 10;

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/**
 * Client->server and server->client message identifiers.
 *
 * A const object rather than an enum so it survives `verbatimModuleSyntax`.
 */
export const MessageType = {
  /** Client -> server: one frame of INPUT (move, jump, dash, attack/ability press). Never a transform. */
  Move: 'move',
  /** Client -> server: buy a kit with Yen. */
  BuyKit: 'buyKit',
  /** Client -> server: equip an owned kit (at once in the lobby, on respawn in the arena). */
  EquipKit: 'equipKit',
  /** Client -> server: the PLAY button - go to the arena, as if through the portal. */
  EnterArena: 'enterArena',
  /** Server -> everyone: combat events. */
  Cast: 'cast',
  Refused: 'refused',
  Hit: 'hit',
  Died: 'died',
  Reward: 'reward',
  Projectile: 'proj',
  ProjectileEnd: 'projEnd',
  Zone: 'zone',
  ZoneEnd: 'zoneEnd',
  Fx: 'fx',
  /** Server -> client: authoritative placement. */
  Respawn: 'respawn',
  /** Client -> server: "put me back on the spawn island" (refused while in a fight). */
  RequestRespawn: 'requestRespawn',
  /** Server -> client: the outcome of a request, for feedback. */
  Notice: 'notice',
  /** Client -> server: "this is what my Bloxity avatar looks like". */
  SetAvatar: 'setAvatar',
  /** Client -> server: the player's Bloxity DISPLAY NAME and portrait. */
  SetIdentity: 'setIdentity',
  /**
   * Client -> server: the portal's game TOKEN, or null when signed out. Never
   * an account id: the server asks Bloxity who the token belongs to.
   */
  SetAuth: 'setAuth',
  /** Server -> client: whose progress this session is now playing on. */
  AuthState: 'authState',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
