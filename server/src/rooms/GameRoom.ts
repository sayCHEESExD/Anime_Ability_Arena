import { Client, Room, ServerError } from '@colyseus/core';
import {
  ARENA_SPAWNS,
  COMBAT,
  KILL_Y,
  KITS,
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  SPAWN,
  accountKeyFor,
  formatYen,
  inPortal,
  isAccountKey,
  isKitId,
  isValidGuestId,
  kitById,
  sanitizeAppearance,
  sanitizeIdentity,
  sanitizeProportions,
  type AuthStateMessage,
  type AuthStatus,
  type KitMessage,
  type MoveMessage,
  type NoticeMessage,
  type Placement,
  type RespawnMessage,
  type RespawnReason,
  type SetAuthMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type SimEvents,
} from '@arena/shared';
import { tokenHash, verifyGameToken } from '../auth/BloxityAuth.js';
import { CombatService, type CombatHost } from '../combat/CombatService.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { hasProgress, progressOf, type ProfileFields, type StoredProfile } from '../persistence/index.js';
import { buxGrants } from '../progression/BuxGrants.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { profileStore } from '../progression/ProfileStore.js';
import { wallet } from '../progression/Wallet.js';
import { logger } from '../util/logger.js';
import { GameState } from './state/GameState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'GameRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;
/** Milliseconds between looks for purchases waiting on an account. */
const GRANT_POLL_MS = 15_000;
/** Re-verification backoff for a token Bloxity could not be asked about. */
const REVERIFY_FIRST_MS = 15_000;
const REVERIFY_MAX_MS = 120_000;
/** How long a mid-session switch waits for the leaving profile to land before staying put. */
const SWITCH_SAVE_TIMEOUT_MS = 8000;
/** How long a leave or a dispose waits for its save to land before moving on. */
const LEAVE_SAVE_TIMEOUT_MS = 5000;
/** Longest token accepted. Bloxity's are a few hundred bytes. */
const MAX_TOKEN_LENGTH = 4096;

/** Join refusals. The client's retry/backoff recognises STORAGE_UNAVAILABLE. */
export const JOIN_ERROR = {
  ROOM_FULL: 4103,
  BAD_PLAYER_ID: 4104,
  STORAGE_UNAVAILABLE: 4105,
} as const;

interface JoinOptions {
  /** The browser's own guest id. NEVER an account id; the prefix is refused. */
  playerId?: string;
  /** The portal's game token, or nothing. Verified with Bloxity, never trusted. */
  token?: string | null;
  avatar?: SetAvatarMessage;
  identity?: SetIdentityMessage;
}

/** What `onAuth` resolves and hands to `onJoin`. */
interface ResolvedProfile {
  readonly key: string;
  readonly guestKey: string;
  readonly accountKey: string | null;
  readonly token: string | null;
  readonly tokenHash: string;
  readonly status: AuthStatus;
  readonly profile: StoredProfile | null;
  readonly migrated: boolean;
}

/** Per-session bookkeeping the replicated state must not carry. */
interface Session {
  key: string;
  guestKey: string;
  accountKey: string | null;
  token: string | null;
  tokenHash: string;
  status: AuthStatus;
  /** True while a login change is being applied: autosaves and grants hold off. */
  switching: boolean;
  queued: SetAuthMessage | null;
  granting: boolean;
  reverifyAt: number;
  reverifyDelay: number;
  grantPollAt: number;
}

/**
 * The authoritative room.
 *
 * Composition only: movement lives in `MovementService`, every rule of the
 * fight in `CombatService`, and this decides the order they run in and where
 * players are placed - the spawn island, the arena, back home after a death.
 * The one hard rule: nothing a client sends is ever copied into state. A Move
 * is simulated, an attack press is judged by the server's cooldowns against
 * the server's positions, a purchase is checked against the server's wallet.
 *
 * WHOSE PROGRESS A SESSION PLAYS ON is decided here too: the client sends its
 * browser id and the portal's TOKEN, Bloxity is asked whose token it is, and
 * the profile is READ FROM STORAGE in `onAuth`. A read that fails refuses the
 * join - a player is never seated on an empty profile that would autosave
 * over their real one.
 */
export class GameRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override autoDispose = true;

  readonly movement = new MovementService();
  private combat!: CombatService;

  /** Session id -> the profile key it currently plays on. The boards read it. */
  private readonly playerIds = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();

  private autosaveTimer = 0;

  override onCreate(): void {
    this.state = new GameState();
    this.setPatchRate(serverConfig.patchRateMs);

    const room = this;
    const host: CombatHost = {
      get state() {
        return room.state;
      },
      movement: this.movement,
      broadcast: (type, message) => this.broadcast(type, message),
      sendTo: (sid, type, message) => this.clientOf(sid)?.send(type, message),
      persist: (sid) => {
        const player = this.state.players.get(sid);
        if (player) this.persist(sid, player);
      },
      respawnAfterDeath: (sid) => this.placeInLobby(sid, 'death'),
    };
    this.combat = new CombatService(host);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) => this.onMove(client, message));
    this.onMessage(MessageType.BuyKit, (client, message: KitMessage) => this.onBuyKit(client, message));
    this.onMessage(MessageType.EquipKit, (client, message: KitMessage) => this.onEquipKit(client, message));
    this.onMessage(MessageType.EnterArena, (client) => this.onEnterArena(client));
    this.onMessage(MessageType.RequestRespawn, (client) => this.onRequestRespawn(client));
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) => this.onSetIdentity(client, message));
    this.onMessage(MessageType.SetAvatar, (client, message: SetAvatarMessage) => this.onSetAvatar(client, message));
    this.onMessage(MessageType.SetAuth, (client, message: SetAuthMessage) => {
      void this.switchAuth(client, message, false);
    });

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), serverConfig.patchRateMs);
    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  override async onAuth(client: Client, options: JoinOptions = {}): Promise<ResolvedProfile> {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      logger.warn(SCOPE, `refused a join: room ${this.roomId} is full (${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`);
      throw new ServerError(JOIN_ERROR.ROOM_FULL, 'room is full');
    }
    const guestKey = readGuestKey(options.playerId);
    const token = readToken(options.token);
    try {
      return await this.resolveProfile(guestKey, token, null);
    } catch (error) {
      logger.error(SCOPE, `refused a join: storage unreachable for ${client.sessionId}:`, error);
      throw new ServerError(JOIN_ERROR.STORAGE_UNAVAILABLE, 'storage unavailable, try again shortly');
    }
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: ResolvedProfile): void {
    const resolved: ResolvedProfile = auth ?? {
      key: '',
      guestKey: '',
      accountKey: null,
      token: null,
      tokenHash: '',
      status: 'guest',
      profile: null,
      migrated: false,
    };

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    const now = Date.now();
    this.sessions.set(client.sessionId, {
      key: resolved.key,
      guestKey: resolved.guestKey,
      accountKey: resolved.accountKey,
      token: resolved.token,
      tokenHash: resolved.tokenHash,
      status: resolved.status,
      switching: false,
      queued: null,
      granting: false,
      reverifyAt: now + REVERIFY_FIRST_MS,
      reverifyDelay: REVERIFY_FIRST_MS,
      grantPollAt: now + GRANT_POLL_MS,
    });
    if (resolved.key) this.playerIds.set(client.sessionId, resolved.key);

    // Restore BEFORE any service initialises: everything derived is derived from it.
    profileStore.applyTo(player, resolved.profile);
    this.state.players.set(client.sessionId, player);
    this.initialiseServices(client.sessionId, player);

    if (options.avatar) this.writeAvatar(player, options.avatar);
    if (options.identity) {
      const identity = sanitizeIdentity(options.identity);
      if (identity.displayName) {
        player.displayName = identity.displayName;
        player.avatarUrl = identity.avatarUrl;
      }
    }

    this.placeInLobby(client.sessionId, 'join');
    this.sendAuthState(client, resolved.status);
    if (resolved.accountKey) void this.applyGrants(client.sessionId);

    logger.info(
      SCOPE,
      `join ${client.sessionId} as ${describe(resolved)} (${resolved.profile ? 'restored' : 'new'}) ` +
        `yen=${player.yen} kills=${player.kills} kit=${player.kit} owned=${player.ownedKits.length}`,
    );
  }

  override async onLeave(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const key = this.sessions.get(client.sessionId)?.key;

    this.combat.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.playerIds.delete(client.sessionId);

    logger.info(SCOPE, `leave ${client.sessionId}`);
    if (player && key) await this.saveBounded(key, player);
  }

  override async onDispose(): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const [sessionId, player] of this.state.players) {
      const key = this.sessions.get(sessionId)?.key;
      if (key) saves.push(this.saveBounded(key, player));
    }
    await Promise.all(saves);
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

  // ------------------------------------------------------------- identity

  /**
   * WHOSE PROFILE, and the profile itself, read from storage now.
   *
   * With a token, Bloxity is asked. Verified -> the account key; the
   * account's own profile always wins. If the account has none and this
   * browser's guest has real progress, the guest's progress becomes the
   * account's - insert-only, so two pods racing for the same first login
   * create one profile - and the guest is then retired.
   *
   * Rejected -> a guest. Unavailable -> a guest FOR NOW, re-asked on a backoff.
   * Throws when storage cannot be read. Callers refuse or stay put.
   */
  private async resolveProfile(guestKey: string, token: string | null, live: ProfileFields | null): Promise<ResolvedProfile> {
    let status: AuthStatus = 'guest';
    let accountKey: string | null = null;
    const hash = token ? tokenHash(token) : '';
    if (token) {
      const outcome = await verifyGameToken(token);
      if (outcome.status === 'verified') {
        accountKey = accountKeyFor(outcome.accountId);
        status = 'account';
      } else if (outcome.status === 'unavailable') {
        status = 'unavailable';
      }
    }

    if (accountKey) {
      let profile = await profileStore.load(accountKey);
      let migrated = false;
      if (!profile && guestKey) {
        const guest = await profileStore.load(guestKey);
        const retired = Boolean(guest?.migratedTo);
        const source: ProfileFields | null =
          live ??
          (guest
            ? { ...progressOf(guest), displayName: guest.displayName, avatarUrl: guest.avatarUrl, updatedAt: guest.updatedAt }
            : null);
        if (!retired && source && hasProgress(source)) {
          const created = { ...source, updatedAt: Date.now(), migratedFrom: guestKey };
          if (await profileStore.insertIfAbsent(accountKey, created)) {
            // Only AFTER the account holds it is the guest copy retired.
            await profileStore.retireGuest(guestKey, accountKey, progressOf(source), {
              displayName: source.displayName,
              avatarUrl: source.avatarUrl,
            });
            profile = created;
            migrated = true;
            logger.info(SCOPE, `migrated guest ${guestKey} into ${accountKey} (yen=${source.yen})`);
          } else {
            logger.info(SCOPE, `lost the first-login race for ${accountKey}; loading the winner`);
            profile = await profileStore.load(accountKey);
          }
        }
      }
      return { key: accountKey, guestKey, accountKey, token, tokenHash: hash, status, profile, migrated };
    }

    const profile = guestKey ? await profileStore.load(guestKey) : null;
    return { key: guestKey, guestKey, accountKey: null, token, tokenHash: hash, status, profile, migrated: false };
  }

  /**
   * A LOGIN CHANGE ON THE LIVE SESSION: sign-in, sign-out, account switch, or
   * a re-ask about a token Bloxity was unavailable for. Save the profile being
   * left, resolve the new one, apply it exactly as a join does. Only the
   * newest login counts.
   */
  private async switchAuth(client: Client, message: SetAuthMessage, reverify: boolean): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;

    const token = readToken(message?.token);
    if (session.switching) {
      session.queued = { token };
      return;
    }
    const hash = token ? tokenHash(token) : '';
    if (!reverify && hash === session.tokenHash) return;

    session.switching = true;
    try {
      const leavingKey = session.key;
      const wasGuest = session.accountKey === null;
      const live = profileStore.snapshot(player);

      if (leavingKey) {
        const landed = await withTimeout(profileStore.save(leavingKey, player), SWITCH_SAVE_TIMEOUT_MS);
        if (!landed) {
          logger.warn(SCOPE, `${client.sessionId}: storage did not take the leaving save; staying on ${leavingKey}`);
          this.sendAuthState(client, session.status, 'storage unavailable; staying on the current profile');
          return;
        }
      }

      let target: ResolvedProfile;
      try {
        target = await this.resolveProfile(session.guestKey, token, wasGuest ? live : null);
      } catch (error) {
        logger.warn(SCOPE, `${client.sessionId}: storage unreachable during a login change; staying put:`, error);
        this.sendAuthState(client, session.status, 'storage unavailable; staying on the current profile');
        return;
      }

      session.token = target.token;
      session.tokenHash = target.tokenHash;
      if (target.status === 'unavailable') {
        session.reverifyDelay = Math.min(REVERIFY_MAX_MS, session.reverifyDelay * 2);
        session.reverifyAt = Date.now() + session.reverifyDelay;
      } else {
        session.reverifyDelay = REVERIFY_FIRST_MS;
      }

      if (target.key === session.key) {
        session.status = target.status;
        this.sendAuthState(client, target.status);
        return;
      }

      profileStore.applyTo(player, target.profile, true);
      session.key = target.key;
      session.accountKey = target.accountKey;
      session.status = target.status;
      if (target.key) this.playerIds.set(client.sessionId, target.key);
      else this.playerIds.delete(client.sessionId);

      this.forgetServices(client.sessionId);
      this.initialiseServices(client.sessionId, player);
      this.placeInLobby(client.sessionId, 'join');

      if (target.key) await this.saveBounded(target.key, player);
      this.sendAuthState(client, target.status);
      leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
      logger.info(
        SCOPE,
        `${client.sessionId} switched ${leavingKey || '(none)'} -> ${describe(target)}` +
          `${target.migrated ? ' [migrated]' : ''} yen=${player.yen} kills=${player.kills}`,
      );
    } finally {
      session.switching = false;
      const queued = session.queued;
      session.queued = null;
      if (queued) void this.switchAuth(client, queued, false);
      else if (session.accountKey) void this.applyGrants(client.sessionId);
    }
  }

  private initialiseServices(sessionId: string, player: PlayerState): void {
    if (!this.movement.has(sessionId)) this.movement.initialise(player);
    this.combat.remove(sessionId);
    this.combat.add(sessionId);
    this.combat.syncDerived(player);
  }

  /** Everything but movement, whose simulation state belongs to the connection. */
  private forgetServices(sessionId: string): void {
    this.combat.remove(sessionId);
  }

  private sendAuthState(client: Client, status: AuthStatus, note?: string): void {
    const message: AuthStateMessage = note ? { status, note } : { status };
    client.send(MessageType.AuthState, message);
  }

  private clientOf(sessionId: string): Client | undefined {
    return this.clients.find((client) => client.sessionId === sessionId);
  }

  // ---------------------------------------------------------------- input

  private onMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const events = this.movement.applyInput(player, message, (act, aim, motion) => this.combat.tryCast(client.sessionId, act, aim, motion));
    if (events) this.afterMotion(client.sessionId, player, events);
  }

  /** After any step of a player's simulation: combat hooks, the portal, falling off the world. */
  private afterMotion(sessionId: string, player: PlayerState, events: SimEvents): void {
    this.combat.afterStep(sessionId, events);
    if (player.dead) return;
    if (player.zone === 'lobby' && inPortal(player.x, player.y, player.z)) {
      this.placeInArena(sessionId);
      return;
    }
    if (player.y < KILL_Y) {
      if (player.zone === 'lobby') this.placeAt(sessionId, SPAWN, 'fall');
      else this.combat.fell(sessionId);
    }
  }

  // ----------------------------------------------------------------- kits

  /**
   * BUY A KIT with Yen. Owned for good; equipped at once on the spawn island,
   * or on the next respawn when bought mid-fight.
   */
  private onBuyKit(client: Client, message: KitMessage): void {
    const player = this.state.players.get(client.sessionId);
    const id = message?.kit;
    if (!player || !isKitId(id)) return;
    const kit = kitById(id)!;
    if (player.ownedKits.includes(id)) {
      this.onEquipKit(client, message);
      return;
    }
    if (!wallet.spend(player, kit.price)) {
      this.notify(client, { kind: 'refused', text: `${kit.name} costs ${formatYen(kit.price)} - you have ${formatYen(player.yen)}` });
      return;
    }
    const owned = new Set([...player.ownedKits, id]);
    player.ownedKits.clear();
    for (const k of KITS) if (owned.has(k.id)) player.ownedKits.push(k.id);
    const equippedNow = this.equip(player, id);
    this.persist(client.sessionId, player);
    this.notify(client, {
      kind: 'unlocked',
      kit: id,
      text: equippedNow ? `You have unlocked ${kit.name}!` : `You have unlocked ${kit.name}, respawn to equip!`,
    });
    logger.info(SCOPE, `${client.sessionId} bought ${id} for ${kit.price} (yen ${player.yen})`);
  }

  private onEquipKit(client: Client, message: KitMessage): void {
    const player = this.state.players.get(client.sessionId);
    const id = message?.kit;
    if (!player || !isKitId(id)) return;
    if (!player.ownedKits.includes(id)) {
      this.notify(client, { kind: 'refused', text: `Unlock ${kitById(id)!.name} first` });
      return;
    }
    const kit = kitById(id)!;
    const now = this.equip(player, id);
    this.persist(client.sessionId, player);
    this.notify(client, { kind: 'equipped', kit: id, text: now ? `Equipped ${kit.name}` : `${kit.name} equips when you respawn` });
  }

  /** Equip now on the spawn island (true), or on the next respawn from the arena (false). */
  private equip(player: PlayerState, id: string): boolean {
    if (player.zone === 'lobby' && !player.dead) {
      player.kit = id;
      player.pendingKit = '';
      return true;
    }
    player.pendingKit = id === player.kit ? '' : id;
    return false;
  }

  // ------------------------------------------------------------- placement

  private onEnterArena(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead || player.zone !== 'lobby') return;
    this.placeInArena(client.sessionId);
  }

  /**
   * Home to the spawn island. In the arena this is a RESET: straight after
   * being hit it counts as a death, credited to whoever hit you.
   */
  private onRequestRespawn(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    if (player.zone === 'lobby') {
      this.placeAt(client.sessionId, SPAWN, 'manual');
      return;
    }
    if (this.combat.sinceHit(client.sessionId) < COMBAT.creditSeconds) this.combat.fell(client.sessionId);
    else this.placeInLobby(client.sessionId, 'manual');
  }

  /** THE one way a player is put on the spawn island: health, cooldowns and a waiting kit all applied. */
  private placeInLobby(sessionId: string, reason: RespawnReason): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.zone = 'lobby';
    this.combat.reset(sessionId);
    if (player.pendingKit && player.ownedKits.includes(player.pendingKit)) player.kit = player.pendingKit;
    player.pendingKit = '';
    this.placeAt(sessionId, SPAWN, reason);
  }

  /** Through the portal: onto the arena spawn furthest from everyone already fighting. */
  private placeInArena(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    let best = ARENA_SPAWNS[0]!;
    let bestScore = -1;
    for (const spawn of ARENA_SPAWNS) {
      let nearest = Infinity;
      for (const other of this.state.players.values()) {
        if (other === player || other.zone !== 'arena' || other.dead) continue;
        nearest = Math.min(nearest, Math.hypot(other.x - spawn.x, other.z - spawn.z));
      }
      const score = nearest + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = spawn;
      }
    }
    player.zone = 'arena';
    this.combat.reset(sessionId);
    this.combat.enteredArena(sessionId);
    this.placeAt(sessionId, best, 'arena');
    logger.info(SCOPE, `${sessionId} entered the arena`);
  }

  private placeAt(sessionId: string, placement: Placement, reason: RespawnReason): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    this.movement.teleport(player, placement.x, placement.y, placement.z, placement.yaw);
    const message: RespawnMessage = { x: placement.x, y: placement.y, z: placement.z, rotationY: placement.yaw, reason };
    this.clientOf(sessionId)?.send(MessageType.Respawn, message);
  }

  // -------------------------------------------------------------- identity

  private onSetAvatar(client: Client, message: SetAvatarMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.writeAvatar(player, message);
  }

  private onSetIdentity(client: Client, message: SetIdentityMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const identity = sanitizeIdentity(message);
    if (player.displayName === identity.displayName && player.avatarUrl === identity.avatarUrl) return;
    player.displayName = identity.displayName;
    player.avatarUrl = identity.avatarUrl;
    this.persist(client.sessionId, player);
    leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
  }

  private writeAvatar(player: PlayerState, message: SetAvatarMessage): void {
    player.avatar.apply(sanitizeAppearance(message?.appearance), sanitizeProportions(message?.proportions));
  }

  private notify(client: Client, notice: NoticeMessage): void {
    client.send(MessageType.Notice, notice);
  }

  // ----------------------------------------------------------------- clock

  private tick(delta: number): void {
    this.state.elapsed += delta;
    for (const [sessionId, player] of this.state.players) {
      const events = this.movement.idle(player, delta);
      if (events) this.afterMotion(sessionId, player, events);
      if (player.ready) player.playSeconds += delta;
    }
    this.combat.tick(delta);
    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.playerIds);
    this.tickSessions();

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      for (const [sessionId, player] of this.state.players) this.persist(sessionId, player);
    }
  }

  /** Re-asks about tokens Bloxity was unavailable for, and polls for purchases. */
  private tickSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.switching) continue;
      if (session.status === 'unavailable' && session.token && now >= session.reverifyAt) {
        session.reverifyAt = now + session.reverifyDelay;
        const client = this.clientOf(sessionId);
        if (client) void this.switchAuth(client, { token: session.token }, true);
      }
      if (session.accountKey && now >= session.grantPollAt) {
        session.grantPollAt = now + GRANT_POLL_MS;
        void this.applyGrants(sessionId);
      }
    }
  }

  // ---------------------------------------------------------------- grants

  /**
   * Pay out what the webhook recorded for this account: CLAIM (atomic per
   * grant, so no other pod pays the same one), add the Money, SAVE the
   * profile, and only then mark the grants applied.
   */
  private async applyGrants(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player || !session.accountKey || session.switching || session.granting) return;
    const accountKey = session.accountKey;
    session.granting = true;
    try {
      const grants = await buxGrants.claim(accountKey);
      if (grants.length === 0) return;
      if (this.sessions.get(sessionId) !== session || session.accountKey !== accountKey || session.switching) {
        logger.warn(SCOPE, `left ${grants.length} claimed grant(s) for ${accountKey} to a later session`);
        return;
      }
      for (const grant of grants) {
        if (grant.money > 0) wallet.add(player, grant.money);
        logger.info(SCOPE, `granted ${grant.sku} to ${sessionId} (+${grant.money} yen) [${grant.transactionId}]`);
      }
      await profileStore.save(accountKey, player);
      await buxGrants.settle(grants.map((grant) => grant.transactionId));
      leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
    } catch (error) {
      logger.warn(SCOPE, `could not pay grants for ${accountKey}: ${String(error)}`);
    } finally {
      session.granting = false;
    }
  }

  // ----------------------------------------------------------------- saves

  /** A routine save. Held while the session is changing login. */
  private persist(sessionId: string, player: PlayerState): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.key || session.switching) return;
    void this.saveQuietly(session.key, player);
  }

  private async saveQuietly(key: string, player: PlayerState): Promise<void> {
    try {
      await profileStore.save(key, player);
    } catch (error) {
      logger.error(SCOPE, `save of ${key} failed:`, error);
    }
  }

  /** A save that is waited for only so long; it stays queued and retried regardless. */
  private async saveBounded(key: string, player: PlayerState): Promise<void> {
    const landed = await withTimeout(this.saveQuietly(key, player), LEAVE_SAVE_TIMEOUT_MS);
    if (!landed) logger.warn(SCOPE, `save of ${key} is queued; it lands when storage is back`);
  }
}

/** A guest key from a join option: valid, or empty when none was sent. Refuses the account prefix. */
const readGuestKey = (raw: unknown): string => {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'string' && isAccountKey(raw)) {
    logger.warn(SCOPE, `refused a join: browser id carries the account prefix`);
    throw new ServerError(JOIN_ERROR.BAD_PLAYER_ID, 'invalid player id');
  }
  if (!isValidGuestId(raw)) {
    logger.warn(SCOPE, `refused a join: malformed browser id`);
    throw new ServerError(JOIN_ERROR.BAD_PLAYER_ID, 'invalid player id');
  }
  return raw;
};

const readToken = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_TOKEN_LENGTH ? raw : null;

const describe = (resolved: ResolvedProfile): string => {
  if (resolved.accountKey) return `account ${resolved.accountKey}`;
  const key = resolved.guestKey || '(no id)';
  return resolved.status === 'unavailable' ? `guest ${key} (bloxity unavailable, will re-ask)` : `guest ${key}`;
};

/** True if the promise settled within the deadline; it keeps running either way. */
const withTimeout = (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
