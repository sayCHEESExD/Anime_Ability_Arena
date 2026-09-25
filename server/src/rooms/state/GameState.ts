import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { LEADERBOARD_SIZE } from '@arena/shared';
import { PlayerState } from './PlayerState.js';

/** One row of one board. */
export class LeaderEntry extends Schema {
  /** The row's KEY, derived from the account id. NEVER DRAWN. */
  @type('string') handle = '';
  /** THE NAME THE BOARD SHOWS: the portal's display name, or empty. */
  @type('string') name = '';
  @type('string') avatarUrl = '';
  @type('float64') value = 0;
}

/** The two boards beside the portal. Fixed-length, written in place. */
export class LeaderboardState extends Schema {
  @type([LeaderEntry]) kills = rows();
  @type([LeaderEntry]) damage = rows();
}

const rows = (): ArraySchema<LeaderEntry> => {
  const list = new ArraySchema<LeaderEntry>();
  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) list.push(new LeaderEntry());
  return list;
};

/** A shadow soldier (Arise). Moved by the server; clients draw it. */
export class SummonState extends Schema {
  @type('string') owner = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  /** Bumped on every swing, so clients can play it. */
  @type('uint16') swings = 0;
}

/** Root replicated state for one room. */
export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: SummonState }) summons = new MapSchema<SummonState>();
  @type('float64') elapsed = 0;
  @type(LeaderboardState) leaderboard = new LeaderboardState();
}
