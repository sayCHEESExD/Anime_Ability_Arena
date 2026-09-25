import { MAX_PLAYERS_PER_ROOM, MessageType, type CastMessage, type HitMessage, type MoveMessage } from '@arena/shared';
import type { CombatService } from '../combat/CombatService.js';
import type { MovementService } from '../movement/MovementService.js';
import type { StoredProfile } from '../persistence/index.js';
import { profileStore } from '../progression/ProfileStore.js';
import type { GameState } from '../rooms/state/GameState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';
import { BotBrain, type BrainWorld, type Perceived } from './BotBrain.js';
import { pickPersona, randomKit, randomLook, type BotPersona } from './BotPersonas.js';

const SCOPE = 'bots';

/** What the manager needs from its room. */
export interface BotRoomHost {
  readonly state: GameState;
  readonly movement: MovementService;
  readonly combat: CombatService;
  /** Real (connected) players in the room. */
  realPlayers(): number;
  /** Seat a bot exactly like a joining player: state, services, the spawn island. */
  seatBot(sid: string, persona: BotPersona, profile: StoredProfile | null, look: ReturnType<typeof randomLook>, kit: string): void;
  /** Take a bot out exactly like a leaving player. */
  unseatBot(sid: string): void;
  /** One simulated input for a bot, through the same pipeline as a client's. */
  stepBot(sid: string, message: MoveMessage): void;
  /** The PLAY button. */
  enterArena(sid: string): void;
  equipBot(sid: string, kit: string): void;
}

/**
 * How many fill-ins a room wants for its real players. Enough that one lonely
 * player finds a lively fight, fewer as people arrive, none from 8 upward -
 * and never so many that real players could not all fit.
 */
export const botTarget = (real: number): number => {
  if (real <= 0) return 0;
  const table = [0, 5, 5, 4, 4, 2, 2, 1];
  const wanted = real < table.length ? table[real]! : 0;
  return Math.max(0, Math.min(wanted, MAX_PLAYERS_PER_ROOM - real));
};

interface Bot {
  readonly sid: string;
  readonly persona: BotPersona;
  readonly brain: BotBrain;
  seq: number;
  wasInLobby: boolean;
  /** Last moment it dealt or took damage: an engaged bot is the last to leave. */
  engagedAt: number;
}

/** Colyseus-shaped session ids, so nothing on the wire stands out. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const sessionIdLike = (): string => {
  let out = '';
  for (let i = 0; i < 9; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
};

const HISTORY_SECONDS = 1.2;
const SAVE_EVERY = 30;
const now = (): number => performance.now() / 1000;

/**
 * THE FILL-IN PLAYERS of one room, entirely server-side.
 *
 * Population: the target follows the real player count; one bot joins at a
 * time on a relaxed timer, one leaves at a time (the least engaged, ideally one
 * that is between lives), and a real player arriving at a full room makes a
 * bot leave at once - a bot never takes a real player's seat.
 *
 * Each bot is a PlayerState like any other: the same spawn island, portal,
 * movement simulation, combat service, knockback, deaths, Yen and leaderboard
 * rows (lifetime stats saved under the persona's own key). Only its INPUT is
 * produced here instead of arriving from a client.
 */
export class BotManager {
  private readonly bots = new Map<string, Bot>();
  private readonly history = new Map<string, { t: number; x: number; y: number; z: number }[]>();
  private pending = 0;
  private nextAddAt = 0;
  private nextRemoveAt = 0;
  private saveTimer = 0;
  private disposed = false;
  private readonly world: BrainWorld;

  constructor(private readonly host: BotRoomHost) {
    const self = this;
    this.world = {
      get now() {
        return now();
      },
      collision: host.movement.collision,
      players: () => host.state.players.entries(),
      motion: (sid) => host.movement.motion(sid),
      readyIn: (sid, slot) => host.combat.readyIn(sid, slot),
      perceived: (sid, delay) => self.perceived(sid, delay),
      isBot: (sid) => self.bots.has(sid),
    };
  }

  isBot(sid: string): boolean {
    return this.bots.has(sid);
  }

  get count(): number {
    return this.bots.size;
  }

  /** A real player is joining: make room at once if the seats are all taken. */
  enforceCapacity(): void {
    while (this.host.realPlayers() + this.bots.size > MAX_PLAYERS_PER_ROOM && this.bots.size > 0) {
      this.removeOne(true);
    }
    // Arrivals change the target: the next departure can come soon, not instantly.
    this.nextRemoveAt = Math.min(this.nextRemoveAt, now() + this.rnd(2, 5));
  }

  /** Combat events, as every client receives them: the brains perceive them late. */
  observe(type: string, message: unknown): void {
    const t = now();
    if (type === MessageType.Cast) {
      const cast = message as CastMessage;
      for (const bot of this.bots.values()) {
        if (bot.sid === cast.sid) bot.engagedAt = t;
        else bot.brain.sawCast(cast.sid, cast.slot, cast.x, cast.z, t);
      }
    } else if (type === MessageType.Hit) {
      const hit = message as HitMessage;
      const victim = this.bots.get(hit.v);
      if (victim) {
        victim.engagedAt = t;
        victim.brain.wasHit(hit.a, t);
      }
      const attacker = this.bots.get(hit.a);
      if (attacker) attacker.engagedAt = t;
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    const t = now();
    this.recordHistory(t);
    this.population(t);

    for (const bot of this.bots.values()) {
      const player = this.host.state.players.get(bot.sid);
      if (!player) continue;
      if (player.zone === 'lobby' && !bot.wasInLobby) {
        bot.brain.arrivedInLobby(t);
        // Between lives, now and then a player switches moveset.
        if (this.rnd(0, 1) < 0.2) this.host.equipBot(bot.sid, randomKit());
      }
      bot.wasInLobby = player.zone === 'lobby';
      const intent = bot.brain.think(player, this.world, dt);
      if (intent.enterArena && player.zone === 'lobby' && !player.dead) {
        this.host.enterArena(bot.sid);
        continue;
      }
      // One tick is several client-sized inputs, so bots move exactly as smoothly as players.
      const steps = Math.max(1, Math.round(dt * 60));
      for (let i = 0; i < steps; i += 1) {
        bot.seq += 1;
        const message: MoveMessage = { seq: bot.seq, dt: dt / steps, moveX: 0, moveZ: intent.push, cameraYaw: intent.yaw };
        if (intent.jump) message.jump = true;
        if (i === 0) {
          if (intent.dash) message.dash = true;
          if (intent.act) {
            message.act = intent.act;
            message.aim = intent.aim;
          }
        }
        this.host.stepBot(bot.sid, message);
      }
    }

    this.saveTimer += dt;
    if (this.saveTimer >= SAVE_EVERY) {
      this.saveTimer = 0;
      for (const bot of this.bots.values()) this.save(bot);
    }
  }

  /** Every bot leaves (the room is closing). Their stats are saved. */
  dispose(): void {
    this.disposed = true;
    this.clearAll();
  }

  /** Every bot leaves now (nobody real is left to play with). */
  private clearAll(): void {
    for (const bot of [...this.bots.values()]) {
      this.save(bot);
      this.host.unseatBot(bot.sid);
    }
    this.bots.clear();
  }

  // ------------------------------------------------------------ population

  private population(t: number): void {
    const real = this.host.realPlayers();
    const target = botTarget(real);
    const have = this.bots.size + this.pending;
    if (real === 0) {
      if (this.bots.size > 0) this.clearAll();
      return;
    }
    if (have < target && t >= this.nextAddAt) {
      // The first fill-in turns up quickly for a lone player; the rest trickle in.
      this.nextAddAt = t + (this.bots.size === 0 ? this.rnd(1.5, 3) : this.rnd(3, 8));
      void this.addOne();
    } else if (this.bots.size > target && t >= this.nextRemoveAt) {
      this.nextRemoveAt = t + this.rnd(4, 9);
      this.removeOne(false);
    }
  }

  private async addOne(): Promise<void> {
    const inUse = new Set([...this.bots.values()].map((bot) => bot.persona.name));
    const persona = pickPersona(inUse);
    this.pending += 1;
    let profile: StoredProfile | null = null;
    try {
      profile = await profileStore.load(persona.key);
    } catch (error) {
      // Storage down: seat nobody rather than a fill-in whose stats would be lost.
      logger.warn(SCOPE, `no fill-in added, storage unavailable: ${String(error)}`);
      this.pending -= 1;
      return;
    }
    this.pending -= 1;
    if (this.disposed || this.host.realPlayers() + this.bots.size >= MAX_PLAYERS_PER_ROOM) return;
    if (this.bots.size >= botTarget(this.host.realPlayers())) return;
    const sid = sessionIdLike();
    const bot: Bot = { sid, persona, brain: new BotBrain(sid, persona), seq: 0, wasInLobby: false, engagedAt: 0 };
    this.bots.set(sid, bot);
    this.host.seatBot(sid, persona, profile, randomLook(), randomKit());
    logger.info(SCOPE, `fill-in ${persona.name} (${persona.style}, skill ${persona.skill.toFixed(2)}) joined; ${this.bots.size} in the room`);
  }

  /**
   * One bot leaves. The least needed goes: between lives first, then whoever
   * has been out of the fight longest, furthest from real players. Unless the
   * room is over capacity, an engaged bot is left to finish its fight.
   */
  private removeOne(force: boolean): void {
    const t = now();
    let best: Bot | null = null;
    let bestScore = -Infinity;
    for (const bot of this.bots.values()) {
      const p = this.host.state.players.get(bot.sid);
      if (!p) {
        best = bot;
        break;
      }
      let score = Math.min(20, t - bot.engagedAt);
      if (p.zone === 'lobby' || p.dead) score += 50;
      score += Math.min(30, this.nearestReal(p) / 4);
      if (score > bestScore) {
        bestScore = score;
        best = bot;
      }
    }
    if (!best) return;
    if (!force && bestScore < 5) {
      // Everyone is mid-fight: try again shortly rather than yanking someone out.
      this.nextRemoveAt = t + this.rnd(1.5, 3);
      return;
    }
    this.save(best);
    this.bots.delete(best.sid);
    this.history.delete(best.sid);
    this.host.unseatBot(best.sid);
    logger.info(SCOPE, `fill-in ${best.persona.name} left; ${this.bots.size} in the room`);
  }

  private nearestReal(p: PlayerState): number {
    let nearest = 200;
    for (const [id, q] of this.host.state.players) {
      if (this.bots.has(id)) continue;
      nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.z - p.z));
    }
    return nearest;
  }

  private save(bot: Bot): void {
    const p = this.host.state.players.get(bot.sid);
    if (!p) return;
    void profileStore.save(bot.persona.key, p).catch((error: unknown) => logger.warn(SCOPE, `save of ${bot.persona.key} failed: ${String(error)}`));
  }

  // ------------------------------------------------------------ perception

  private recordHistory(t: number): void {
    for (const [id, p] of this.host.state.players) {
      let list = this.history.get(id);
      if (!list) {
        list = [];
        this.history.set(id, list);
      }
      list.push({ t, x: p.x, y: p.y, z: p.z });
      while (list.length > 2 && list[0]!.t < t - HISTORY_SECONDS) list.shift();
    }
    for (const id of this.history.keys()) if (!this.host.state.players.has(id)) this.history.delete(id);
  }

  /** Where `sid` was `delay` seconds ago (interpolated), and roughly how it was moving then. */
  private perceived(sid: string, delay: number): Perceived | null {
    const list = this.history.get(sid);
    if (!list || list.length === 0) return null;
    const at = now() - delay;
    const sample = (time: number): { x: number; y: number; z: number } => {
      if (time <= list[0]!.t) return list[0]!;
      for (let i = list.length - 1; i > 0; i -= 1) {
        const b = list[i]!;
        const a = list[i - 1]!;
        if (a.t <= time && time <= b.t) {
          const k = (time - a.t) / Math.max(1e-6, b.t - a.t);
          return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
        }
      }
      return list[list.length - 1]!;
    };
    const p = sample(at);
    const q = sample(at - 0.2);
    return { x: p.x, y: p.y, z: p.z, vx: (p.x - q.x) / 0.2, vz: (p.z - q.z) / 0.2 };
  }

  private rnd(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
