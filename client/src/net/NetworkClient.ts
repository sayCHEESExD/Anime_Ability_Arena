import {
  MessageType,
  ROOM_NAME,
  type AuthStateMessage,
  type CastMessage,
  type DiedMessage,
  type FxMessage,
  type HitMessage,
  type KitMessage,
  type MoveMessage,
  type NoticeMessage,
  type ProjectileEndMessage,
  type ProjectileMessage,
  type RefusedMessage,
  type RespawnMessage,
  type RewardMessage,
  type SetAuthMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type ZoneEndMessage,
  type ZoneMessage,
} from '@arena/shared';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { clientConfig } from '../config/clientConfig.js';
import { logger } from '../util/logger.js';
import type { ConnectionStatus, LeaderboardSnapshot, NetGameState, NetLeaderEntry, NetPlayerState, NetSummonState } from './netTypes.js';

const SCOPE = 'NetworkClient';

/** Key under which this browser's stable player id is kept. */
const PLAYER_ID_KEY = 'arena.playerId';

/** Backoff between join attempts, in milliseconds. A cold host takes a while. */
const JOIN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

/**
 * The server's "storage unavailable" refusal. Not a failure of THIS join but
 * of the database behind it, so the retry does not give up.
 */
const STORAGE_UNAVAILABLE = 4105;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolvePlayerId = (): string => {
  const fresh = `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    const existing = window.localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(PLAYER_ID_KEY, fresh);
  } catch {
    return fresh;
  }
  return fresh;
};

export interface NetworkHandlers {
  onStatusChange?(status: ConnectionStatus, detail?: string): void;
  onSelfJoined?(sessionId: string): void;
  onPlayerAdded?(sessionId: string, player: NetPlayerState): void;
  onPlayerChanged?(sessionId: string, player: NetPlayerState): void;
  onPlayerRemoved?(sessionId: string): void;
  onSummonAdded?(key: string, summon: NetSummonState): void;
  onSummonRemoved?(key: string): void;
  onRespawn?(message: RespawnMessage): void;
  onNotice?(message: NoticeMessage): void;
  onAuthState?(message: AuthStateMessage): void;
  onCast?(message: CastMessage): void;
  onRefused?(message: RefusedMessage): void;
  onHit?(message: HitMessage): void;
  onDied?(message: DiedMessage): void;
  onReward?(message: RewardMessage): void;
  onProjectile?(message: ProjectileMessage): void;
  onProjectileEnd?(message: ProjectileEndMessage): void;
  onZone?(message: ZoneMessage): void;
  onZoneEnd?(message: ZoneEndMessage): void;
  onFx?(message: FxMessage): void;
}

/**
 * Thin wrapper over colyseus.js. The rest of the client never imports
 * colyseus.js directly.
 */
export class NetworkClient {
  private readonly handlers: NetworkHandlers;
  private client: Client | null = null;
  private room: Room<NetGameState> | null = null;
  private status: ConnectionStatus = 'idle';
  /** The portal's game token, asked for at join and on every login change. */
  private token: (() => string | null) | null = null;
  /** The last token the server was told about, so an unchanged one is not resent. */
  private sentToken: string | null | undefined = undefined;
  private look: (() => SetAvatarMessage | null) | null = null;
  private identityOf: (() => SetIdentityMessage) | null = null;

  constructor(handlers: NetworkHandlers = {}) {
    this.handlers = handlers;
  }

  setLookProvider(provider: () => SetAvatarMessage | null): void {
    this.look = provider;
  }

  sendAvatar(message: SetAvatarMessage): void {
    this.room?.send(MessageType.SetAvatar, message);
  }

  sendIdentity(message: SetIdentityMessage): void {
    this.room?.send(MessageType.SetIdentity, message);
  }

  /**
   * Where the portal's TOKEN comes from. The token is the only thing about
   * the login that is ever sent: the server asks Bloxity whose it is.
   */
  setTokenProvider(provider: () => string | null): void {
    this.token = provider;
  }

  /** Tell the server the login changed. Deduped: an unchanged token is not resent. */
  sendAuth(token: string | null): void {
    if (!this.room) return;
    if (token === this.sentToken) return;
    this.sentToken = token;
    const message: SetAuthMessage = { token };
    this.room.send(MessageType.SetAuth, message);
  }

  setDisplayProvider(provider: () => SetIdentityMessage): void {
    this.identityOf = provider;
  }

  get self(): NetPlayerState | null {
    const room = this.room;
    if (!room) return null;
    return room.state?.players?.get(room.sessionId) ?? null;
  }

  player(sessionId: string): NetPlayerState | null {
    return this.room?.state?.players?.get(sessionId) ?? null;
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** The server's clock, in seconds. */
  get elapsed(): number {
    return this.room?.state?.elapsed ?? 0;
  }

  async connect(): Promise<void> {
    if (!clientConfig.serverUrl) {
      this.setStatus('error');
      throw new Error('No game server is configured. Set VITE_SERVER_URL to the Colyseus endpoint and rebuild.');
    }

    this.setStatus('connecting');
    logger.info(SCOPE, `joining "${ROOM_NAME}" at ${clientConfig.serverUrl}`);

    this.client ??= new Client(clientConfig.serverUrl);
    const playerId = resolvePlayerId();
    const attempts = JOIN_BACKOFF_MS.length + 1;
    let joinedWith: string | null = null;

    for (let attempt = 1; ; attempt += 1) {
      const token = this.token?.() ?? null;
      try {
        this.room = await this.client.joinOrCreate<NetGameState>(ROOM_NAME, {
          playerId,
          token,
          avatar: this.look?.() ?? undefined,
          identity: this.identityOf?.() ?? undefined,
        });
        joinedWith = token;
        break;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: unknown }).code;
        const storageDown = code === STORAGE_UNAVAILABLE;
        logger.warn(SCOPE, `join attempt ${attempt}${storageDown ? '' : `/${attempts}`} failed: ${detail}`);
        if (!storageDown && attempt >= attempts) {
          this.setStatus('error', detail);
          throw error;
        }
        const wait = JOIN_BACKOFF_MS[Math.min(attempt, JOIN_BACKOFF_MS.length) - 1] ?? 0;
        this.setStatus('connecting', storageDown ? 'the server is waiting for its database' : `attempt ${attempt + 1}/${attempts}`);
        await sleep(wait);
      }
    }

    if (!this.room) throw new Error('join produced no room');

    this.sentToken = joinedWith;
    this.bindRoom(this.room);
    this.setStatus('connected');
    logger.info(SCOPE, `joined roomId=${this.room.roomId} sessionId=${this.room.sessionId}`);
    this.handlers.onSelfJoined?.(this.room.sessionId);
    this.sendAuth(this.token?.() ?? null);
  }

  /** Report one simulated input (with any attack/ability press on it). Deliberately NOT rate limited. */
  sendInput(message: MoveMessage): void {
    this.room?.send(MessageType.Move, message);
  }

  buyKit(kit: string): void {
    const message: KitMessage = { kit };
    this.room?.send(MessageType.BuyKit, message);
  }

  equipKit(kit: string): void {
    const message: KitMessage = { kit };
    this.room?.send(MessageType.EquipKit, message);
  }

  enterArena(): void {
    this.room?.send(MessageType.EnterArena, {});
  }

  requestRespawn(): void {
    this.room?.send(MessageType.RequestRespawn, {});
  }

  /** The two leaderboards, COPIED out of the schema as plain arrays. */
  get leaderboard(): LeaderboardSnapshot | null {
    const board = this.room?.state?.leaderboard;
    if (!board) return null;
    const copy = (rows: ArrayLike<NetLeaderEntry>): NetLeaderEntry[] => {
      const out: NetLeaderEntry[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row) out.push({ handle: row.handle, name: row.name, avatarUrl: row.avatarUrl, value: row.value });
      }
      return out;
    };
    return { kills: copy(board.kills), damage: copy(board.damage) };
  }

  /** Every summon, live (for drawing). */
  get summons(): Iterable<[string, NetSummonState]> {
    return this.room?.state?.summons?.entries() ?? [];
  }

  async disconnect(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    this.sentToken = undefined;
    this.setStatus('disconnected');
  }

  private bindRoom(room: Room<NetGameState>): void {
    const $ = getStateCallbacks(room);

    $(room.state).players.onAdd((player, sessionId) => {
      this.handlers.onPlayerAdded?.(sessionId, player);
      $(player).onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
      // A NESTED schema's changes do not bubble to its parent.
      $(player.avatar).onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
      const changed = (): void => this.handlers.onPlayerChanged?.(sessionId, player);
      $(player).ownedKits.onAdd(changed);
      $(player).ownedKits.onRemove(changed);
    });
    $(room.state).players.onRemove((_player, sessionId) => {
      this.handlers.onPlayerRemoved?.(sessionId);
    });
    $(room.state).summons.onAdd((summon, key) => this.handlers.onSummonAdded?.(key, summon));
    $(room.state).summons.onRemove((_summon, key) => this.handlers.onSummonRemoved?.(key));

    const on = <T>(type: string, handler: ((message: T) => void) | undefined): void => {
      room.onMessage<T>(type, (message) => handler?.(message));
    };
    on<RespawnMessage>(MessageType.Respawn, (m) => this.handlers.onRespawn?.(m));
    on<NoticeMessage>(MessageType.Notice, (m) => this.handlers.onNotice?.(m));
    on<CastMessage>(MessageType.Cast, (m) => this.handlers.onCast?.(m));
    on<RefusedMessage>(MessageType.Refused, (m) => this.handlers.onRefused?.(m));
    on<HitMessage>(MessageType.Hit, (m) => this.handlers.onHit?.(m));
    on<DiedMessage>(MessageType.Died, (m) => this.handlers.onDied?.(m));
    on<RewardMessage>(MessageType.Reward, (m) => this.handlers.onReward?.(m));
    on<ProjectileMessage>(MessageType.Projectile, (m) => this.handlers.onProjectile?.(m));
    on<ProjectileEndMessage>(MessageType.ProjectileEnd, (m) => this.handlers.onProjectileEnd?.(m));
    on<ZoneMessage>(MessageType.Zone, (m) => this.handlers.onZone?.(m));
    on<ZoneEndMessage>(MessageType.ZoneEnd, (m) => this.handlers.onZoneEnd?.(m));
    on<FxMessage>(MessageType.Fx, (m) => this.handlers.onFx?.(m));
    on<AuthStateMessage>(MessageType.AuthState, (m) => {
      logger.info(SCOPE, `playing as ${m.status}${m.note ? ` (${m.note})` : ''}`);
      this.handlers.onAuthState?.(m);
    });

    room.onError((code, message) => {
      logger.error(SCOPE, `room error ${code}: ${message ?? ''}`);
      this.setStatus('error', message);
    });

    room.onLeave((code) => {
      logger.warn(SCOPE, `left room (code ${code})`);
      this.setStatus('disconnected', `code ${code}`);
    });
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.handlers.onStatusChange?.(status, detail);
  }
}
