import {
  ACT,
  BUFFS,
  COMBAT,
  DEVIL_WAVE,
  M1,
  MOVEMENT,
  MessageType,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  abilityOf,
  applyKnockback,
  kitById,
  visibleName,
  type AbilityDef,
  type BuffId,
  type CastMessage,
  type DiedMessage,
  type ExplodeSpec,
  type FxMessage,
  type HitMessage,
  type HitSpec,
  type MotionScript,
  type PlayerMotion,
  type ProjectileEndMessage,
  type ProjectileMessage,
  type RefusedMessage,
  type RewardMessage,
  type Shape,
  type SimEvents,
  type ZoneEndMessage,
  type ZoneMessage,
  type ZoneSpec,
} from '@arena/shared';
import type { MovementService } from '../movement/MovementService.js';
import { wallet } from '../progression/Wallet.js';
import type { GameState } from '../rooms/state/GameState.js';
import { SummonState } from '../rooms/state/GameState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** What the combat service needs from its room. */
export interface CombatHost {
  readonly state: GameState;
  readonly movement: MovementService;
  broadcast(type: string, message: unknown): void;
  sendTo(sessionId: string, type: string, message: unknown): void;
  /** Save a player's progress now (a kill, a death). */
  persist(sessionId: string): void;
  /** The death timer ran out: put them back on the spawn island. */
  respawnAfterDeath(sessionId: string): void;
}

interface LungeHitbox {
  readonly src: string;
  readonly radius: number;
  readonly pierce: boolean;
  readonly hit: HitSpec;
  readonly explode?: ExplodeSpec;
  readonly until: number;
  readonly hitSet: Set<string>;
  started: boolean;
}

interface Fighter {
  readonly sid: string;
  /** When each slot is ready again: [unused, attack, skill, ultimate]. */
  readonly ready: number[];
  combo: number;
  lastM1: number;
  lastHitBy: string;
  lastHitAt: number;
  lastDamageAt: number;
  shieldUntil: number;
  buff: BuffId | null;
  buffUntil: number;
  counterUntil: number;
  counterHit: HitSpec | null;
  counterSrc: string;
  lunge: LungeHitbox | null;
  slam: { src: string; radius: number; hit: HitSpec; until: number } | null;
  deadUntil: number;
}

interface Timer {
  at: number;
  sid: string;
  /** Cancelled if the owner is stunned or dies (an interrupted cast). */
  cancelable: boolean;
  run: () => void;
}

interface Projectile {
  readonly id: number;
  readonly owner: string;
  readonly src: string;
  x: number;
  y: number;
  z: number;
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
  readonly range: number;
  readonly radius: number;
  readonly pierce: boolean;
  readonly hit: HitSpec;
  readonly explode?: ExplodeSpec;
  readonly zone?: ZoneSpec;
  travelled: number;
  readonly hitSet: Set<string>;
}

interface Zone {
  readonly id: number;
  readonly owner: string;
  readonly src: string;
  x: number;
  y: number;
  z: number;
  readonly spec: ZoneSpec;
  readonly ends: number;
  nextTick: number;
}

interface Summon {
  readonly key: string;
  readonly owner: string;
  readonly state: SummonState;
  readonly until: number;
  readonly hit: HitSpec;
  readonly speed: number;
  readonly seek: number;
  readonly reach: number;
  readonly cooldown: number;
  nextSwing: number;
}

const now = (): number => performance.now() / 1000;
const EYE = 1.6;
const EMPTY_SCRIPT: MotionScript = {};

/**
 * EVERY RULE OF THE FIGHT, and the only place damage, kills and Yen happen.
 *
 * A client presses a button; the input carries the slot and an aim yaw, and
 * `tryCast` decides whether it may (alive, not ragdolled, not mid-cast, off
 * cooldown by the SERVER's clock). An accepted cast is broadcast for everyone
 * to animate, and its effect is resolved here against the server's own
 * positions: melee shapes, projectiles flown on the server, zones, lunges,
 * slams, summons. Every hit goes through `applyHit`, which applies the damage,
 * the launch and the ragdoll, pays the attacker Yen for the damage, and turns
 * a lethal hit into a kill. Nobody can be hurt on the spawn island.
 */
export class CombatService {
  private readonly fighters = new Map<string, Fighter>();
  private readonly timers: Timer[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly zones: Zone[] = [];
  private readonly summons = new Map<string, Summon>();
  private nextId = 1;

  constructor(private readonly host: CombatHost) {}

  // ------------------------------------------------------------ lifecycle

  add(sid: string): void {
    this.fighters.set(sid, {
      sid,
      ready: [0, 0, 0, 0],
      combo: 0,
      lastM1: 0,
      lastHitBy: '',
      lastHitAt: -1e9,
      lastDamageAt: -1e9,
      shieldUntil: 0,
      buff: null,
      buffUntil: 0,
      counterUntil: 0,
      counterHit: null,
      counterSrc: '',
      lunge: null,
      slam: null,
      deadUntil: 0,
    });
  }

  remove(sid: string): void {
    this.fighters.delete(sid);
    this.cancelTimers(sid, true);
    this.dropSummons(sid);
    for (let i = this.zones.length - 1; i >= 0; i -= 1) if (this.zones[i]!.owner === sid) this.endZone(i, false);
  }

  /** A fresh arrival in the arena: spawn protection, clean slate. */
  enteredArena(sid: string): void {
    const f = this.fighters.get(sid);
    const p = this.player(sid);
    if (!f || !p) return;
    f.shieldUntil = now() + COMBAT.spawnShield;
    p.shield = true;
    f.lastHitBy = '';
    f.lastHitAt = -1e9;
  }

  /** Back to the spawn island (death, reset, join): everything combat-related wiped. */
  reset(sid: string): void {
    const f = this.fighters.get(sid);
    const p = this.player(sid);
    if (!f || !p) return;
    this.cancelTimers(sid, true);
    this.dropSummons(sid);
    for (let i = this.zones.length - 1; i >= 0; i -= 1) if (this.zones[i]!.owner === sid) this.endZone(i, false);
    f.ready.fill(0);
    f.combo = 0;
    f.lastHitBy = '';
    f.lastHitAt = -1e9;
    f.shieldUntil = 0;
    f.buff = null;
    f.buffUntil = 0;
    f.counterUntil = 0;
    f.lunge = null;
    f.slam = null;
    f.deadUntil = 0;
    p.hp = COMBAT.maxHp;
    p.dead = false;
    p.shield = false;
    p.buff = '';
    p.buffEnds = 0;
    p.counter = false;
    p.streak = 0;
    this.syncDerived(p, f);
  }

  /** Seconds since this player was last hit by someone (for the reset rule). */
  sinceHit(sid: string): number {
    const f = this.fighters.get(sid);
    return f ? now() - f.lastHitAt : Infinity;
  }

  // --------------------------------------------------------------- casting

  /**
   * One press of attack (1), skill (2) or ultimate (3), aimed at `aim`. Returns
   * the motion script to apply to the caster at this input, or null if refused.
   */
  tryCast(sid: string, slot: number, aim: number, motion: PlayerMotion): { script: MotionScript; yaw: number } | null {
    this.faceYaw = null;
    const script = this.cast(sid, slot, aim, motion);
    return script ? { script, yaw: this.faceYaw ?? aim } : null;
  }

  /** A facing the server chose for the caster (a blink behind a target), or null for the aim. */
  private faceYaw: number | null = null;

  private cast(sid: string, slot: number, aim: number, motion: PlayerMotion): MotionScript | null {
    const f = this.fighters.get(sid);
    const p = this.player(sid);
    if (!f || !p || p.dead) return null;
    const kit = kitById(p.kit);
    if (!kit) return null;
    const t = now();

    if (motion.stun > 0 || motion.lock > 0) {
      if (slot !== ACT.attack) this.refuse(sid, slot, f);
      return null;
    }

    if (slot === ACT.attack) {
      const def = M1[kit.m1];
      const cooldown = def.cooldown * (f.buff === 'godspeed' ? 0.8 : 1);
      if (t < f.ready[1]! - cooldown * (1 - COMBAT.cooldownSlack)) return null;
      f.ready[1] = t + cooldown;
      f.combo = t - f.lastM1 < 1 ? (f.combo + 1) % 3 : 0;
      f.lastM1 = t;
      this.dropShield(f, p);
      this.broadcastCast(sid, p, slot, f.combo, aim);
      this.resolveM1(sid, p, f, aim);
      return EMPTY_SCRIPT;
    }

    const ability = abilityOf(kit, slot as 2 | 3);
    if (!ability) return null;
    if (t < f.ready[slot]! - ability.cooldown * (1 - COMBAT.cooldownSlack)) {
      this.refuse(sid, slot, f);
      return null;
    }
    f.ready[slot] = t + ability.cooldown;
    this.dropShield(f, p);
    this.broadcastCast(sid, p, slot, 0, aim);
    return this.resolveAbility(sid, p, f, ability, aim, motion) ?? ability.motion ?? EMPTY_SCRIPT;
  }

  private refuse(sid: string, slot: number, f: Fighter): void {
    const message: RefusedMessage = { slot, readyIn: Math.max(0, (f.ready[slot] ?? 0) - now()) };
    this.host.sendTo(sid, MessageType.Refused, message);
  }

  private broadcastCast(sid: string, p: PlayerState, slot: number, combo: number, yaw: number): void {
    const message: CastMessage = { sid, slot, kit: p.kit, combo, x: p.x, y: p.y, z: p.z, yaw };
    this.host.broadcast(MessageType.Cast, message);
  }

  private dropShield(f: Fighter, p: PlayerState): void {
    f.shieldUntil = 0;
    p.shield = false;
  }

  private resolveM1(sid: string, p: PlayerState, f: Fighter, aim: number): void {
    const kit = kitById(p.kit)!;
    const def = M1[kit.m1];
    const spec = f.combo === 2 ? def.finisher : def.hit;
    const devil = f.buff === 'devil';
    const targets = this.shapeTargets(sid, p.x, p.y, p.z, aim, 'cone', def.range + (devil ? 1.5 : 0), def.arc, 0, 3);
    for (const victim of targets) {
      const landed = this.applyHit(sid, victim, spec, p.x, p.z, 'm1', aim);
      if (landed && f.buff === 'godspeed') this.chainLightning(sid, victim);
    }
    if (devil) {
      this.spawnProjectile(sid, 'wave', p.x, p.y + EYE, p.z, aim, {
        speed: DEVIL_WAVE.speed,
        range: DEVIL_WAVE.range,
        radius: DEVIL_WAVE.radius,
        pierce: true,
        hit: DEVIL_WAVE.hit,
      });
    }
  }

  private chainLightning(sid: string, from: string): void {
    const chain = BUFFS.godspeed.chain;
    const origin = this.player(from);
    if (!chain || !origin) return;
    const near = this.enemiesOf(sid)
      .filter((q) => q.sessionId !== from)
      .map((q) => ({ q, d: Math.hypot(q.x - origin.x, q.z - origin.z) }))
      .filter((e) => e.d <= chain.radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, chain.count);
    for (const { q } of near) {
      const fx: FxMessage = { kind: 'chain', sid, ab: 'chain', x: origin.x, y: origin.y + EYE, z: origin.z, x2: q.x, y2: q.y + EYE, z2: q.z };
      this.host.broadcast(MessageType.Fx, fx);
      this.applyHit(sid, q.sessionId, chain.hit, origin.x, origin.z, 'chain');
    }
  }

  /** Schedule/perform an ability. Returns a motion script to use instead of the ability's own, or null. */
  private resolveAbility(sid: string, p: PlayerState, f: Fighter, ability: AbilityDef, aim: number, motion: PlayerMotion): MotionScript | null {
    const t = now();
    const e = ability.effect;
    const fx = Math.sin(aim);
    const fz = Math.cos(aim);
    const src = ability.id;

    switch (e.type) {
      case 'melee': {
        this.at(sid, t + e.delay, true, () => {
          const c = this.player(sid);
          if (!c) return;
          const victims = this.shapeTargets(sid, c.x, c.y, c.z, aim, e.shape, e.range, e.arc ?? 0, e.width ?? 0, e.maxTargets ?? 16);
          const landed = victims.filter((v) => this.applyHit(sid, v, e.hit, c.x, c.z, src, aim));
          if (e.followUp && landed.length > 0) {
            const follow = e.followUp;
            this.at(sid, now() + follow.delay, false, () => {
              const c2 = this.player(sid);
              if (!c2 || c2.dead) return;
              for (const v of landed) {
                const q = this.player(v);
                if (!q || q.dead) continue;
                const fx2: FxMessage = { kind: 'blinkStrike', sid, ab: src, x: q.x, y: q.y + EYE, z: q.z, radius: 2.5 };
                this.host.broadcast(MessageType.Fx, fx2);
                this.applyHit(sid, v, follow.hit, c2.x, c2.z, src, aim);
              }
            });
          }
        });
        return null;
      }
      case 'projectile': {
        this.at(sid, t + e.delay, true, () => {
          const c = this.player(sid);
          if (!c) return;
          const count = e.count ?? 1;
          for (let i = 0; i < count; i += 1) {
            const yaw = aim + (i - (count - 1) / 2) * (e.spread ?? 0);
            this.spawnProjectile(sid, src, c.x + fx * 1.2, c.y + EYE, c.z + fz * 1.2, yaw, e);
          }
        });
        return null;
      }
      case 'lunge': {
        const m = ability.motion;
        f.lunge = {
          src,
          radius: e.radius,
          pierce: e.pierce,
          hit: e.hit,
          explode: e.explode,
          until: t + (m?.delay ?? 0) + (m?.time ?? 0) + 1.2,
          hitSet: new Set(),
          started: false,
        };
        return null;
      }
      case 'slam':
        f.slam = { src, radius: e.radius, hit: e.hit, until: t + 3 };
        return null;
      case 'blinkStrike': {
        // Everyone along the flash, and everyone round the landing, is cut.
        const fromX = p.x;
        const fromY = p.y;
        const fromZ = p.z;
        const delay = (ability.motion?.delay ?? 0) + e.delay + 0.05;
        this.at(sid, t + delay, true, () => {
          const c = this.player(sid);
          if (!c) return;
          const message: FxMessage = { kind: 'blinkStrike', sid, ab: src, x: c.x, y: c.y + EYE, z: c.z, x2: fromX, y2: fromY + EYE, z2: fromZ, radius: e.radius };
          this.host.broadcast(MessageType.Fx, message);
          const travelled = Math.hypot(c.x - fromX, c.z - fromZ);
          const victims = new Set(this.shapeTargets(sid, c.x, c.y, c.z, aim, 'circle', e.radius, 0, 0, 16));
          for (const v of this.shapeTargets(sid, fromX, fromY, fromZ, aim, 'line', travelled, 0, 4, 16)) victims.add(v);
          for (const v of victims) this.applyHit(sid, v, e.hit, fromX, fromZ, src, aim);
        });
        return null;
      }
      case 'targetBlink': {
        const target = this.nearestEnemy(sid, p.x, p.y, p.z, e.range);
        if (!target) return { ...(ability.motion ?? {}), kind: 'blink', speed: e.fallback, delay: 0.05 };
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const ux = dx / d;
        const uz = dz / d;
        const toX = target.x + ux * 2.4;
        const toZ = target.z + uz * 2.4;
        const faceYaw = Math.atan2(-ux, -uz);
        const fromX = p.x;
        const fromY = p.y;
        const fromZ = p.z;
        motion.x = toX;
        motion.y = target.y;
        motion.z = toZ;
        motion.vx = 0;
        motion.vz = 0;
        motion.vy = Math.max(0, motion.vy);
        motion.grounded = false;
        motion.yaw = faceYaw;
        this.host.movement.publish(p);
        const message: FxMessage = { kind: 'teleport', sid, ab: src, x: fromX, y: fromY + EYE, z: fromZ, x2: toX, y2: target.y + EYE, z2: toZ };
        this.host.broadcast(MessageType.Fx, message);
        const victimId = target.sessionId;
        this.at(sid, t + 0.1, true, () => {
          const c = this.player(sid);
          if (!c) return;
          const strike: FxMessage = { kind: 'blinkStrike', sid, ab: src, x: c.x - ux, y: c.y + EYE, z: c.z - uz, radius: e.radius };
          this.host.broadcast(MessageType.Fx, strike);
          const victims = new Set(this.shapeTargets(sid, c.x, c.y, c.z, faceYaw, 'circle', e.radius, 0, 0, 8));
          victims.add(victimId);
          for (const v of victims) this.applyHit(sid, v, e.hit, c.x, c.z, src, faceYaw);
        });
        this.faceYaw = faceYaw;
        return ability.motion ?? EMPTY_SCRIPT;
      }
      case 'buff': {
        f.buff = e.buff;
        f.buffUntil = t + e.duration;
        p.buff = e.buff;
        p.buffEnds = this.host.state.elapsed + e.duration;
        if (e.buff === 'godspeed') motion.dashCd = 0;
        this.syncDerived(p, f);
        return null;
      }
      case 'summon': {
        this.at(sid, t + 0.55, true, () => {
          const c = this.player(sid);
          if (!c) return;
          this.dropSummons(sid);
          const arise: FxMessage = { kind: 'arise', sid, ab: src, x: c.x, y: c.y, z: c.z, radius: 4 };
          this.host.broadcast(MessageType.Fx, arise);
          for (let i = 0; i < e.count; i += 1) {
            const angle = aim + Math.PI + (i - (e.count - 1) / 2) * 0.9;
            const state = new SummonState();
            state.owner = sid;
            state.x = c.x + Math.sin(angle) * 3.2;
            state.y = c.y;
            state.z = c.z + Math.cos(angle) * 3.2;
            state.yaw = aim;
            const key = `${sid}:${this.nextId++}`;
            this.host.state.summons.set(key, state);
            this.summons.set(key, {
              key,
              owner: sid,
              state,
              until: now() + e.duration,
              hit: e.hit,
              speed: e.speed,
              seek: e.seek,
              reach: e.reach,
              cooldown: e.cooldown,
              nextSwing: now() + 0.4 + i * 0.15,
            });
          }
        });
        return null;
      }
      case 'counter':
        f.counterUntil = t + e.window;
        f.counterHit = e.hit;
        f.counterSrc = src;
        p.counter = true;
        return null;
      case 'barrage': {
        for (let k = 0; ; k += 1) {
          const offset = e.delay + k * e.interval;
          if (offset >= e.delay + e.duration - 1e-6) break;
          this.at(sid, t + offset, true, () => this.barrageHit(sid, aim, e.shape, e.range, e.arc ?? 0, e.width ?? 0, e.hit, src));
        }
        this.at(sid, t + e.delay + e.duration, true, () => this.barrageHit(sid, aim, e.shape, e.range + 1, e.arc ?? 0, e.width ?? 0, e.final, src));
        return null;
      }
      case 'zone': {
        this.at(sid, t + e.delay, true, () => {
          const c = this.player(sid);
          if (!c) return;
          const x = c.x + fx * e.distance;
          const z = c.z + fz * e.distance;
          this.spawnZone(sid, src, x, c.y + (e.zone.lift ?? 0), z, e.zone);
        });
        return null;
      }
      case 'chainLunge': {
        for (let k = 0; k < e.count; k += 1) {
          const last = k === e.count - 1;
          this.at(sid, t + 0.05 + k * e.interval, true, () => {
            const c = this.player(sid);
            const m = this.host.movement.motion(sid);
            if (!c || !m) return;
            const target = this.nearestEnemy(sid, c.x, c.y, c.z, e.seek);
            const yaw = target ? Math.atan2(target.x - c.x, target.z - c.z) : m.yaw;
            m.yaw = yaw;
            m.lungeT = e.time;
            m.lvx = Math.sin(yaw) * e.speed;
            m.lvz = Math.cos(yaw) * e.speed;
            m.lvy = 0;
            m.lgrav = 0;
            m.vx = m.lvx;
            m.vz = m.lvz;
            m.vy = 0;
            m.lock = Math.max(m.lock, e.time + 0.1);
            this.host.movement.publish(c);
            const fighter = this.fighters.get(sid);
            if (fighter) {
              fighter.lunge = { src, radius: e.radius, pierce: true, hit: last ? e.final : e.hit, until: now() + e.time + 0.3, hitSet: new Set(), started: false };
            }
          });
        }
        return null;
      }
    }
  }

  private barrageHit(sid: string, aim: number, shape: Shape, range: number, arc: number, width: number, hit: HitSpec, src: string): void {
    const c = this.player(sid);
    if (!c) return;
    for (const v of this.shapeTargets(sid, c.x, c.y, c.z, aim, shape, range, arc, width, 16)) this.applyHit(sid, v, hit, c.x, c.z, src, aim);
  }

  // ---------------------------------------------------------- movement hooks

  /** After each simulated step of `sid`: slams landing, lunges connecting. */
  afterStep(sid: string, events: SimEvents): void {
    const f = this.fighters.get(sid);
    const p = this.player(sid);
    if (!f || !p) return;
    if (events.slammed && f.slam) {
      const slam = f.slam;
      f.slam = null;
      if (now() <= slam.until && !p.dead) {
        const fx: FxMessage = { kind: 'slam', sid, ab: slam.src, x: p.x, y: p.y, z: p.z, radius: slam.radius };
        this.host.broadcast(MessageType.Fx, fx);
        for (const v of this.shapeTargets(sid, p.x, p.y, p.z, p.rotationY, 'circle', slam.radius, 0, 0, 16)) {
          this.applyHit(sid, v, slam.hit, p.x, p.z, slam.src);
        }
      }
    }
    this.checkLunge(sid, f, p);
  }

  private checkLunge(sid: string, f: Fighter, p: PlayerState): void {
    const lunge = f.lunge;
    if (!lunge) return;
    const m = this.host.movement.motion(sid);
    if (!m || p.dead || now() > lunge.until) {
      f.lunge = null;
      return;
    }
    if (m.lungeT <= 0) {
      // Finished - or still queued behind its wind-up (it expires by `until` if it never fires).
      if (lunge.started) f.lunge = null;
      return;
    }
    lunge.started = true;
    for (const q of this.enemiesOf(sid)) {
      if (lunge.hitSet.has(q.sessionId)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > lunge.radius + PLAYER_RADIUS) continue;
      if (Math.abs(q.y - p.y) > COMBAT.verticalReach) continue;
      lunge.hitSet.add(q.sessionId);
      this.applyHit(sid, q.sessionId, lunge.hit, p.x - Math.sin(m.yaw) * 2, p.z - Math.cos(m.yaw) * 2, lunge.src, m.yaw);
      if (!lunge.pierce) {
        // Stop dead on the first body and burst.
        m.lungeT = 0;
        m.vx *= 0.1;
        m.vz *= 0.1;
        this.host.movement.publish(p);
        f.lunge = null;
        const fx: FxMessage = { kind: 'lungeEnd', sid, ab: lunge.src, x: q.x, y: q.y + EYE, z: q.z, radius: lunge.explode?.radius ?? 3 };
        this.host.broadcast(MessageType.Fx, fx);
        if (lunge.explode) this.explodeAt(sid, lunge.src, q.x, q.y + EYE, q.z, lunge.explode, new Set([q.sessionId]));
        return;
      }
    }
  }

  // ------------------------------------------------------------------ hits

  /**
   * THE HIT. Damage, launch, ragdoll, Yen, kill. Returns true if it landed
   * (it may be blocked by spawn protection or parried by a counter).
   */
  applyHit(attacker: string, victim: string, spec: HitSpec, fromX: number, fromZ: number, src: string, fallbackYaw?: number, velocity?: { x: number; y: number; z: number }): boolean {
    if (attacker === victim) return false;
    const vp = this.player(victim);
    const vf = this.fighters.get(victim);
    const motion = this.host.movement.motion(victim);
    if (!vp || !vf || !motion || vp.dead || vp.zone !== 'arena') return false;
    const ap = attacker ? this.player(attacker) : null;
    const af = attacker ? this.fighters.get(attacker) : null;
    if (attacker && (!ap || ap.zone !== 'arena' || ap.dead && src !== 'summon')) return false;
    const t = now();

    if (t < vf.shieldUntil) {
      this.broadcastHit(attacker, vp, 0, 0, 0, 0, src, true);
      return false;
    }

    // A counter stance parries the hit and cuts the attacker down.
    if (t < vf.counterUntil && vf.counterHit) {
      const counter = vf.counterHit;
      vf.counterUntil = 0;
      vp.counter = false;
      this.broadcastHit(attacker, vp, 0, 0, 0, 0, src, true);
      if (ap && attacker) {
        const fx: FxMessage = { kind: 'counter', sid: victim, ab: vf.counterSrc, x: vp.x, y: vp.y + EYE, z: vp.z, x2: ap.x, y2: ap.y + EYE, z2: ap.z };
        this.host.broadcast(MessageType.Fx, fx);
        this.applyHit(victim, attacker, counter, vp.x, vp.z, vf.counterSrc);
      }
      return false;
    }

    const buff = af?.buff ? BUFFS[af.buff] : null;
    const damage = Math.max(0, Math.round(spec.damage * (buff?.damageMul ?? 1)));
    const kbMul = buff?.kbMul ?? 1;

    let vx: number;
    let vz: number;
    let vy = spec.up;
    if (velocity) {
      vx = velocity.x;
      vy = velocity.y;
      vz = velocity.z;
    } else {
      let dx = vp.x - fromX;
      let dz = vp.z - fromZ;
      let d = Math.hypot(dx, dz);
      if (d < 0.3) {
        const yaw = fallbackYaw ?? ap?.rotationY ?? 0;
        dx = Math.sin(yaw);
        dz = Math.cos(yaw);
        d = 1;
      }
      vx = (dx / d) * spec.kb * kbMul;
      vz = (dz / d) * spec.kb * kbMul;
      vy = spec.up * (spec.kb >= 0 ? Math.sqrt(kbMul) : 1);
    }

    const armored = vf.buff !== null && BUFFS[vf.buff].armor;
    if (!armored && spec.stun > 0) {
      applyKnockback(motion, vx, vy, vz, spec.stun);
      this.interrupt(victim, vf, vp);
      this.host.movement.publish(vp);
    }

    vp.hp = Math.max(0, vp.hp - damage);
    vf.lastDamageAt = t;
    if (attacker) {
      vf.lastHitBy = attacker;
      vf.lastHitAt = t;
    }

    if (ap && attacker && damage > 0) {
      ap.damage += damage;
      const yen = wallet.add(ap, damage * COMBAT.yenPerDamage);
      if (yen > 0) {
        const reward: RewardMessage = { yen, reason: 'damage', streak: ap.streak, x: vp.x, y: vp.y + PLAYER_HEIGHT, z: vp.z };
        this.host.sendTo(attacker, MessageType.Reward, reward);
      }
    }

    this.broadcastHit(attacker, vp, damage, armored ? 0 : vx, armored ? 0 : vy, armored ? 0 : vz, src, false);
    if (vp.hp <= 0) this.kill(victim, attacker, 'hit');
    return true;
  }

  private broadcastHit(attacker: string, vp: PlayerState, dmg: number, kx: number, ky: number, kz: number, src: string, blocked: boolean): void {
    const message: HitMessage = { a: attacker, v: vp.sessionId, dmg, x: vp.x, y: vp.y + EYE, z: vp.z, kx, ky, kz, src, hp: vp.hp };
    if (blocked) message.blocked = true;
    this.host.broadcast(MessageType.Hit, message);
  }

  /** A stunned player's casts are interrupted. */
  private interrupt(sid: string, f: Fighter, p: PlayerState): void {
    this.cancelTimers(sid, false);
    f.lunge = null;
    f.slam = null;
    f.counterUntil = 0;
    p.counter = false;
  }

  // ----------------------------------------------------------------- death

  /** A player fell below the world, or reset mid-fight. Credits their last hitter. */
  fell(sid: string): void {
    const p = this.player(sid);
    const f = this.fighters.get(sid);
    if (!p || !f || p.dead) return;
    const credited = now() - f.lastHitAt <= COMBAT.creditSeconds ? f.lastHitBy : '';
    this.kill(sid, credited, 'fall');
  }

  private kill(victim: string, killer: string, cause: 'hit' | 'fall'): void {
    const vp = this.player(victim);
    const vf = this.fighters.get(victim);
    if (!vp || !vf || vp.dead) return;
    const t = now();
    vp.dead = true;
    vp.hp = 0;
    vp.deaths += 1;
    vp.streak = 0;
    vp.shield = false;
    vp.counter = false;
    vf.buff = null;
    p_clearBuff(vp);
    this.syncDerived(vp, vf);
    this.cancelTimers(victim, true);
    this.dropSummons(victim);
    for (let i = this.zones.length - 1; i >= 0; i -= 1) if (this.zones[i]!.owner === victim && this.zones[i]!.spec.follow) this.endZone(i, false);
    vf.lunge = null;
    vf.slam = null;
    vf.deadUntil = t + COMBAT.deathSeconds;
    const motion = this.host.movement.motion(victim);
    if (motion) {
      // Lie where you fell: a ragdoll that outlasts the death screen.
      motion.stun = COMBAT.deathSeconds + 1;
      motion.lock = 0;
      motion.pendT = -1;
      this.host.movement.publish(vp);
    }

    const kp = killer && killer !== victim ? this.player(killer) : null;
    if (kp) {
      kp.kills += 1;
      kp.streak += 1;
      kp.bestStreak = Math.max(kp.bestStreak, kp.streak);
      const bonus = Math.min(COMBAT.maxStreakYen, (kp.streak - 1) * COMBAT.streakYen);
      const yen = wallet.add(kp, COMBAT.killYen + bonus);
      const reward: RewardMessage = { yen, reason: 'kill', streak: kp.streak, x: vp.x, y: vp.y + PLAYER_HEIGHT, z: vp.z };
      this.host.sendTo(killer, MessageType.Reward, reward);
      this.host.persist(killer);
    }
    const died: DiedMessage = {
      v: victim,
      vName: visibleName(vp.displayName),
      k: kp ? killer : '',
      kName: kp ? visibleName(kp.displayName) : '',
      cause,
      x: vp.x,
      y: vp.y,
      z: vp.z,
    };
    this.host.broadcast(MessageType.Died, died);
    this.host.persist(victim);
    const respawnAt = t + COMBAT.deathSeconds;
    this.at(victim, respawnAt, false, () => {
      const p = this.player(victim);
      if (p?.dead) this.host.respawnAfterDeath(victim);
    });
  }

  // ------------------------------------------------------------ projectiles

  private spawnProjectile(
    owner: string,
    src: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
    spec: { speed: number; range: number; radius: number; pierce: boolean; hit: HitSpec; explode?: ExplodeSpec; zone?: ZoneSpec },
  ): void {
    const projectile: Projectile = {
      id: this.nextId++,
      owner,
      src,
      x,
      y,
      z,
      dx: Math.sin(yaw),
      dz: Math.cos(yaw),
      speed: spec.speed,
      range: spec.range,
      radius: spec.radius,
      pierce: spec.pierce,
      hit: spec.hit,
      explode: spec.explode,
      zone: spec.zone,
      travelled: 0,
      hitSet: new Set(),
    };
    this.projectiles.push(projectile);
    const message: ProjectileMessage = { id: projectile.id, sid: owner, ab: src, x, y, z, dx: projectile.dx, dz: projectile.dz, speed: spec.speed, range: spec.range, radius: spec.radius };
    this.host.broadcast(MessageType.Projectile, message);
  }

  private tickProjectiles(dt: number): void {
    const collision = this.host.movement.collision;
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const pr = this.projectiles[i]!;
      const distance = pr.speed * dt;
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.6, pr.radius * 0.8)));
      const step = distance / steps;
      let ended = false;
      for (let s = 0; s < steps && !ended; s += 1) {
        pr.x += pr.dx * step;
        pr.z += pr.dz * step;
        pr.travelled += step;
        if (collision.pointSolid(pr.x, pr.y, pr.z)) {
          ended = true;
          break;
        }
        for (const q of this.enemiesOf(pr.owner)) {
          if (pr.hitSet.has(q.sessionId)) continue;
          const d = Math.hypot(q.x - pr.x, q.z - pr.z);
          if (d > pr.radius + PLAYER_RADIUS) continue;
          if (pr.y < q.y - pr.radius || pr.y > q.y + PLAYER_HEIGHT + pr.radius) continue;
          pr.hitSet.add(q.sessionId);
          this.applyHit(pr.owner, q.sessionId, pr.hit, pr.x - pr.dx * 3, pr.z - pr.dz * 3, pr.src, Math.atan2(pr.dx, pr.dz));
          if (!pr.pierce) {
            ended = true;
            break;
          }
        }
        if (pr.travelled >= pr.range) ended = true;
      }
      if (ended) {
        this.projectiles.splice(i, 1);
        this.endProjectile(pr);
      }
    }
  }

  private endProjectile(pr: Projectile): void {
    const message: ProjectileEndMessage = { id: pr.id, x: pr.x, y: pr.y, z: pr.z, explode: pr.explode?.radius ?? 0 };
    this.host.broadcast(MessageType.ProjectileEnd, message);
    if (pr.explode) this.explodeAt(pr.owner, pr.src, pr.x, pr.y, pr.z, pr.explode, new Set());
    if (pr.zone) this.spawnZone(pr.owner, pr.src, pr.x, pr.y, pr.z, pr.zone);
  }

  private explodeAt(owner: string, src: string, x: number, y: number, z: number, spec: ExplodeSpec, _skip: Set<string>): void {
    for (const q of this.enemiesOf(owner)) {
      const d = Math.hypot(q.x - x, q.z - z);
      if (d > spec.radius + PLAYER_RADIUS) continue;
      if (Math.abs(q.y + EYE - y) > spec.radius + 1) continue;
      this.applyHit(owner, q.sessionId, spec.hit, x, z, src);
    }
  }

  // ----------------------------------------------------------------- zones

  private spawnZone(owner: string, src: string, x: number, y: number, z: number, spec: ZoneSpec): void {
    const zone: Zone = { id: this.nextId++, owner, src, x, y, z, spec, ends: now() + spec.duration, nextTick: now() };
    this.zones.push(zone);
    const message: ZoneMessage = { id: zone.id, sid: owner, ab: src, x, y, z, radius: spec.radius, duration: spec.duration, follow: spec.follow === true };
    this.host.broadcast(MessageType.Zone, message);
  }

  private tickZones(): void {
    const t = now();
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const zone = this.zones[i]!;
      const spec = zone.spec;
      if (spec.follow) {
        const o = this.player(zone.owner);
        if (o) {
          zone.x = o.x;
          zone.y = o.y;
          zone.z = o.z;
        }
      }
      while (t >= zone.nextTick && zone.nextTick < zone.ends) {
        zone.nextTick += spec.tick;
        for (const q of this.enemiesOf(zone.owner)) {
          const dx = zone.x - q.x;
          const dz = zone.z - q.z;
          const d = Math.hypot(dx, dz);
          if (d > spec.radius + PLAYER_RADIUS) continue;
          if (Math.abs(q.y + EYE - zone.y) > spec.radius + 2) continue;
          if (spec.pull) {
            const k = d > 0.5 ? spec.pull * Math.min(1, d / 3) : 0;
            const up = q.y + EYE < zone.y ? spec.hit.up + (zone.y - q.y - EYE) * 3 : 0;
            this.applyHit(zone.owner, q.sessionId, spec.hit, zone.x, zone.z, zone.src, undefined, { x: d > 0 ? (dx / d) * k : 0, y: up, z: d > 0 ? (dz / d) * k : 0 });
          } else {
            this.applyHit(zone.owner, q.sessionId, spec.hit, zone.x, zone.z, zone.src);
          }
        }
      }
      if (t >= zone.ends) this.endZone(i, true);
    }
  }

  private endZone(index: number, final: boolean): void {
    const zone = this.zones[index];
    if (!zone) return;
    this.zones.splice(index, 1);
    if (final && zone.spec.final) {
      for (const q of this.enemiesOf(zone.owner)) {
        const d = Math.hypot(q.x - zone.x, q.z - zone.z);
        if (d > zone.spec.radius + PLAYER_RADIUS) continue;
        if (Math.abs(q.y + EYE - zone.y) > zone.spec.radius + 2) continue;
        this.applyHit(zone.owner, q.sessionId, zone.spec.final, zone.x, zone.z, zone.src);
      }
    }
    const message: ZoneEndMessage = { id: zone.id, x: zone.x, y: zone.y, z: zone.z };
    this.host.broadcast(MessageType.ZoneEnd, message);
  }

  // --------------------------------------------------------------- summons

  private tickSummons(dt: number): void {
    const t = now();
    const collision = this.host.movement.collision;
    for (const summon of [...this.summons.values()]) {
      const owner = this.player(summon.owner);
      if (!owner || owner.dead || t >= summon.until) {
        this.removeSummon(summon.key);
        continue;
      }
      const s = summon.state;
      const target = this.nearestEnemy(summon.owner, s.x, s.y, s.z, summon.seek);
      // With no prey, heel beside the owner.
      const goalX = target ? target.x : owner.x;
      const goalZ = target ? target.z : owner.z;
      const dx = goalX - s.x;
      const dz = goalZ - s.z;
      const d = Math.hypot(dx, dz);
      const stop = target ? summon.reach * 0.7 : 4;
      if (d > stop) {
        const move = Math.min(d - stop, summon.speed * dt);
        const nx = s.x + (dx / d) * move;
        const nz = s.z + (dz / d) * move;
        const floor = collision.floorBelow(nx, s.y + 2, nz, 0);
        // Never walk off an edge.
        if (floor > s.y - 3) {
          s.x = nx;
          s.z = nz;
          s.y = floor;
        }
      }
      if (d > 0.1) s.yaw = Math.atan2(dx, dz);
      if (target && d <= summon.reach + PLAYER_RADIUS && Math.abs(target.y - s.y) < COMBAT.verticalReach && t >= summon.nextSwing) {
        summon.nextSwing = t + summon.cooldown;
        s.swings += 1;
        this.applyHit(summon.owner, target.sessionId, summon.hit, s.x, s.z, 'summon', s.yaw);
      }
    }
  }

  private dropSummons(owner: string): void {
    for (const summon of [...this.summons.values()]) if (summon.owner === owner) this.removeSummon(summon.key);
  }

  private removeSummon(key: string): void {
    this.summons.delete(key);
    this.host.state.summons.delete(key);
  }

  // ----------------------------------------------------------------- clock

  tick(dt: number): void {
    const t = now();
    // Timers (sorted by time as they fire; the list is short).
    for (let guard = 0; guard < 256; guard += 1) {
      let index = -1;
      let earliest = Infinity;
      for (let i = 0; i < this.timers.length; i += 1) {
        const timer = this.timers[i]!;
        if (timer.at <= t && timer.at < earliest) {
          earliest = timer.at;
          index = i;
        }
      }
      if (index < 0) break;
      const [timer] = this.timers.splice(index, 1);
      timer!.run();
    }

    this.tickProjectiles(dt);
    this.tickZones();
    this.tickSummons(dt);

    for (const [sid, f] of this.fighters) {
      const p = this.player(sid);
      if (!p) continue;
      if (f.buff && t >= f.buffUntil) {
        f.buff = null;
        p_clearBuff(p);
        this.syncDerived(p, f);
      }
      if (p.shield && t >= f.shieldUntil) p.shield = false;
      if (p.counter && t >= f.counterUntil) p.counter = false;
      if (f.lunge) this.checkLunge(sid, f, p);
      if (!p.dead && p.hp < COMBAT.maxHp) {
        if (p.zone === 'lobby') p.hp = COMBAT.maxHp;
        else if (t - f.lastDamageAt >= COMBAT.regenDelay) p.hp = Math.min(COMBAT.maxHp, p.hp + COMBAT.regenPerSecond * dt);
      }
    }
  }

  // --------------------------------------------------------------- helpers

  /** Walk speed and dash cooldown from the active buff. The only writer of both. */
  syncDerived(p: PlayerState, f?: Fighter): void {
    const fighter = f ?? this.fighters.get(p.sessionId);
    const buff = fighter?.buff ? BUFFS[fighter.buff] : null;
    p.moveSpeed = MOVEMENT.walkSpeed * (buff?.speedMul ?? 1);
    p.dashCdMul = buff?.dashCdMul ?? 1;
  }

  private at(sid: string, at: number, cancelable: boolean, run: () => void): void {
    this.timers.push({ at, sid, cancelable, run });
  }

  private cancelTimers(sid: string, all: boolean): void {
    for (let i = this.timers.length - 1; i >= 0; i -= 1) {
      const timer = this.timers[i]!;
      if (timer.sid === sid && (all || timer.cancelable)) this.timers.splice(i, 1);
    }
  }

  private player(sid: string): PlayerState | undefined {
    return this.host.state.players.get(sid);
  }

  /** Everyone `sid` may hurt: alive, in the arena, not themselves. */
  private enemiesOf(sid: string): PlayerState[] {
    const out: PlayerState[] = [];
    for (const [id, q] of this.host.state.players) {
      if (id === sid || q.dead || q.zone !== 'arena') continue;
      out.push(q);
    }
    return out;
  }

  private nearestEnemy(sid: string, x: number, y: number, z: number, range: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = range + PLAYER_RADIUS;
    for (const q of this.enemiesOf(sid)) {
      if (Math.abs(q.y - y) > 12) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }

  /** Victims inside a shape in front of (or around) a point, nearest first. */
  private shapeTargets(sid: string, x: number, y: number, z: number, yaw: number, shape: Shape, range: number, arc: number, width: number, max: number): string[] {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Wide beams and big whirls reach up as well as out (a tornado lifts its victims).
    const reachY = COMBAT.verticalReach + (shape === 'line' ? width * 0.35 : shape === 'circle' ? range * 0.5 : 0);
    const found: { id: string; d: number }[] = [];
    for (const q of this.enemiesOf(sid)) {
      if (Math.abs(q.y - y) > reachY) continue;
      const dx = q.x - x;
      const dz = q.z - z;
      const d = Math.hypot(dx, dz);
      let inside = false;
      if (shape === 'circle') inside = d <= range + PLAYER_RADIUS;
      else if (shape === 'cone') {
        if (d <= range + PLAYER_RADIUS) {
          if (d < 1.6) inside = true;
          else {
            const dot = (dx * fx + dz * fz) / d;
            inside = Math.acos(Math.max(-1, Math.min(1, dot))) <= arc;
          }
        }
      } else {
        const along = dx * fx + dz * fz;
        const lateral = Math.abs(dx * fz - dz * fx);
        inside = along >= -1 && along <= range + PLAYER_RADIUS && lateral <= width / 2 + PLAYER_RADIUS;
      }
      if (inside) found.push({ id: q.sessionId, d });
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, max).map((entry) => entry.id);
  }
}

const p_clearBuff = (p: PlayerState): void => {
  p.buff = '';
  p.buffEnds = 0;
};
