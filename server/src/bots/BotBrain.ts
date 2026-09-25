import {
  ACT,
  ARENA,
  COMBAT,
  M1,
  NO_FLOOR,
  PORTAL,
  kitById,
  type AbilityDef,
  type KitDef,
  type PlayerMotion,
  type WorldCollision,
} from '@arena/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { BotPersona, BotStyle } from './BotPersonas.js';

/**
 * ONE FILL-IN PLAYER'S HEAD.
 *
 * It sees the world only through PERCEPTION: other players' positions as they
 * were `reaction` seconds ago, and their casts once that long has passed - so
 * it cannot react to an attack before a person could have seen it. From that
 * it decides, a few times a second, what a player would do: pick someone to
 * fight (not always the nearest), chase or keep a comfortable distance for its
 * style, strafe, dash in or out, hop, back off when hurt, go after the weak,
 * and press attack and ability buttons with imperfect aim and a human delay
 * after each cooldown. The output is exactly a client's INPUT; the server
 * simulates and judges it like anyone else's.
 */

export interface Perceived {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

/** What the brain may look at. */
export interface BrainWorld {
  readonly now: number;
  readonly collision: WorldCollision;
  players(): IterableIterator<[string, PlayerState]>;
  motion(sid: string): PlayerMotion | null;
  readyIn(sid: string, slot: number): number;
  /** Whether a session is a fill-in (bots prefer real opponents a little). */
  isBot(sid: string): boolean;
  /** Where `sid` was `delay` seconds ago, with its velocity then. */
  perceived(sid: string, delay: number): Perceived | null;
}

/** One frame of a bot's intent, in the client's own input vocabulary. */
export interface BotIntent {
  /** Heading of the move (the "camera" yaw), and how hard the stick is pushed. */
  yaw: number;
  push: number;
  jump: boolean;
  dash: boolean;
  act: number;
  aim: number;
  /** Walked into the portal on the spawn island? The room places it. */
  enterArena: boolean;
}

interface Tendencies {
  /** Preferred fighting distance with nothing special ready. */
  readonly range: number;
  /** Health fraction under which it backs off after taking damage. */
  readonly retreatAt: number;
  /** Chance per decision to use a ready, in-window ability. */
  readonly eagerness: number;
  /** Chance to dash in when closing a gap. */
  readonly dashIn: number;
  /** Chance to dodge a cast it saw coming. */
  readonly dodge: number;
  /** Hops per second while moving. */
  readonly hops: number;
  /** Human delay after a cooldown before pressing again [min, max]. */
  readonly press: readonly [number, number];
}

const TENDENCIES: Readonly<Record<BotStyle, Tendencies>> = {
  aggressive: { range: 2.8, retreatAt: 0.15, eagerness: 0.75, dashIn: 0.4, dodge: 0.2, hops: 0.35, press: [0.03, 0.2] },
  balanced: { range: 3.4, retreatAt: 0.3, eagerness: 0.55, dashIn: 0.22, dodge: 0.35, hops: 0.25, press: [0.06, 0.32] },
  ranged: { range: 11, retreatAt: 0.35, eagerness: 0.7, dashIn: 0.06, dodge: 0.4, hops: 0.3, press: [0.1, 0.36] },
  defensive: { range: 7, retreatAt: 0.45, eagerness: 0.45, dashIn: 0.12, dodge: 0.55, hops: 0.2, press: [0.12, 0.45] },
};

type Kind = 'aim' | 'self' | 'buff' | 'summon' | 'counter';
interface Window {
  readonly min: number;
  readonly max: number;
  readonly kind: Kind;
}

/** When an ability is worth pressing: the distances at which it lands. */
const windowOf = (a: AbilityDef): Window => {
  const e = a.effect;
  const m = a.motion;
  switch (e.type) {
    case 'melee':
      return e.shape === 'circle' ? { min: 0, max: e.range * 0.8, kind: 'self' } : { min: 0, max: e.range * 0.85, kind: 'aim' };
    case 'projectile':
      return { min: 3, max: e.range * 0.7, kind: 'aim' };
    case 'lunge':
      return { min: 3, max: (m?.speed ?? 30) * (m?.time ?? 0.3) * 0.9 + e.radius, kind: 'aim' };
    case 'slam':
      return { min: 5, max: 18, kind: 'aim' };
    case 'blinkStrike':
      return { min: (m?.speed ?? 16) * 0.35, max: (m?.speed ?? 16) + 4, kind: 'aim' };
    case 'targetBlink':
      return { min: 3, max: e.range * 0.9, kind: 'aim' };
    case 'buff':
      return { min: 0, max: 14, kind: 'buff' };
    case 'summon':
      return { min: 0, max: 30, kind: 'summon' };
    case 'counter':
      return { min: 0, max: 6, kind: 'counter' };
    case 'barrage':
      return e.shape === 'circle' ? { min: 0, max: e.range * 0.8, kind: 'self' } : { min: 0, max: e.range * 0.9, kind: 'aim' };
    case 'zone':
      return e.distance === 0
        ? { min: 0, max: e.zone.radius * 0.7, kind: 'self' }
        : { min: Math.max(0, e.distance - e.zone.radius * 0.6), max: e.distance + e.zone.radius * 0.6, kind: 'aim' };
    case 'chainLunge':
      return { min: 2, max: e.seek * 0.85, kind: 'aim' };
  }
};

/** Projectile speed, for how far ahead to lead a moving target. */
const speedOf = (a: AbilityDef): number => (a.effect.type === 'projectile' ? a.effect.speed : 0);

interface SeenCast {
  at: number;
  from: string;
  x: number;
  z: number;
  slot: number;
}

const TAU = Math.PI * 2;
const wrap = (angle: number): number => {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

export class BotBrain {
  private readonly t: Tendencies;
  private target: string | null = null;
  private retargetAt = 0;
  private ignore = new Map<string, number>();
  private wander: { x: number; z: number; until: number } | null = null;
  private strafe = 1;
  private strafeFlipAt = 0;
  private retreatUntil = 0;
  private hesitateUntil = 0;
  private nextThink = 0;
  private m1At: number | null = null;
  private readonly holdUntil: (number | null)[] = [null, null, null, null];
  private stuck = 0;
  private sidestepUntil = 0;
  private sidestepYaw = 0;
  private lastHp: number = COMBAT.maxHp;
  private recentDamage = 0;
  private readonly seen: SeenCast[] = [];
  private readonly hitBy: { at: number; from: string }[] = [];
  private queuedDash: 'in' | 'out' | 'side' | null = null;
  private lobbyUntil = 0;
  private lobbyStuck = 0;
  private portalX = 0;

  constructor(
    readonly sid: string,
    readonly persona: BotPersona,
    private readonly random: () => number = Math.random,
  ) {
    this.t = TENDENCIES[persona.style];
  }

  private rnd(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  private chance(p: number): boolean {
    return this.random() < p;
  }

  /** Normal-ish noise (sum of uniforms), for aim. */
  private noise(): number {
    return (this.random() + this.random() + this.random() - 1.5) / 1.5;
  }

  /** A fresh arrival on the spawn island: browse a little, then walk into the portal. */
  arrivedInLobby(now: number): void {
    this.lobbyUntil = now + this.rnd(1.2, 5);
    this.lobbyStuck = 0;
    this.portalX = PORTAL.x + this.rnd(-4, 4);
    this.target = null;
    this.wander = null;
    this.retreatUntil = 0;
    this.m1At = null;
    this.holdUntil.fill(null);
    this.seen.length = 0;
    this.hitBy.length = 0;
  }

  /** Somebody cast something; it becomes known `reaction` seconds from now. */
  sawCast(from: string, slot: number, x: number, z: number, now: number): void {
    if (from === this.sid) return;
    this.seen.push({ at: now + this.persona.reaction * this.rnd(0.85, 1.3), from, x, z, slot });
    if (this.seen.length > 12) this.seen.shift();
  }

  /** This bot was hit by `from` (felt at once; who did it is noticed after a beat). */
  wasHit(from: string, now: number): void {
    if (from) this.hitBy.push({ at: now + this.persona.reaction, from });
  }

  think(self: PlayerState, world: BrainWorld, dt: number): BotIntent {
    const intent: BotIntent = { yaw: self.rotationY, push: 0, jump: false, dash: false, act: 0, aim: self.rotationY, enterArena: false };
    const now = world.now;
    const motion = world.motion(this.sid);
    if (!motion || self.dead) return intent;

    // What it has felt: damage (decaying memory of it).
    const taken = Math.max(0, this.lastHp - self.hp);
    this.lastHp = self.hp;
    this.recentDamage = this.recentDamage * Math.exp(-dt / 1.6) + taken;

    if (self.zone === 'lobby') return this.lobby(self, world, intent, dt);
    // Ragdolled or mid-cast: nothing to decide, nothing it could do.
    if (motion.stun > 0 || motion.lock > 0) return intent;

    const kit = kitById(self.kit) ?? kitById('asta')!;
    this.chooseTarget(self, world);
    const foe = this.target ? world.perceived(this.target, this.persona.reaction) : null;
    const foeState = this.target ? this.playerOf(world, this.target) : null;

    // A lapse of attention now and then: nobody plays at 100% every second.
    if (now >= this.hesitateUntil && this.chance(dt * 0.05 * (1.3 - this.persona.skill))) {
      this.hesitateUntil = now + this.rnd(0.25, 0.8);
    }
    const hesitating = now < this.hesitateUntil;

    // Hurt and under pressure: back off for a moment (styles differ a lot here).
    if (now >= this.retreatUntil && self.hp / COMBAT.maxHp < this.t.retreatAt && this.recentDamage > 6 && foe) {
      this.retreatUntil = now + this.rnd(2, 4.5);
      if (this.chance(0.5)) this.queuedDash = 'out';
    }
    const retreating = now < this.retreatUntil;

    this.react(self, world, kit, motion);

    let moveYaw = self.rotationY;
    let push = 0;
    if (foe && foeState) {
      const dx = foe.x - self.x;
      const dz = foe.z - self.z;
      const d = Math.hypot(dx, dz);
      const toward = Math.atan2(dx, dz);
      if (now >= this.strafeFlipAt) {
        this.strafe = this.chance(0.5) ? 1 : -1;
        this.strafeFlipAt = now + this.rnd(0.8, 2.6);
      }
      if (retreating) {
        // Away from the threat, bending toward the middle of the island.
        const away = toward + Math.PI + this.strafe * 0.5;
        moveYaw = this.blendToCentre(self, away, 0.35);
        push = 1;
      } else {
        const want = this.fightRange(self, kit, foeState, world);
        if (d > want + 1.5) {
          // Close in on where they are heading (a rough guess, not a perfect intercept).
          const lead = Math.min(0.6, d / 30) * this.persona.skill;
          const gx = foe.x + foe.vx * lead;
          const gz = foe.z + foe.vz * lead;
          moveYaw = Math.atan2(gx - self.x, gz - self.z);
          push = 1;
          if (d > 7 && d < 16 && motion.dashCd <= 0 && this.chance(dt * 2 * this.t.dashIn * (0.5 + this.persona.skill))) this.queuedDash = 'in';
        } else if (d < want - 1.5 && want > 4) {
          moveYaw = toward + Math.PI + this.strafe * 0.6;
          push = 0.9;
        } else {
          // In range: circle them.
          moveYaw = toward + this.strafe * (Math.PI / 2) - this.strafe * (d > want ? 0.3 : -0.3);
          push = this.t.range > 5 ? 0.8 : 0.55;
        }
        // Skilled players take the middle side, so their hits knock the enemy outward.
        if (this.persona.skill > 0.55 && d < 10 && d > 2) {
          const fromMid = Math.hypot(foe.x - ARENA.x, foe.z - ARENA.z);
          if (fromMid > 80) {
            const behind = Math.atan2(ARENA.x - foe.x, ARENA.z - foe.z);
            const gx = foe.x + Math.sin(behind) * want;
            const gz = foe.z + Math.cos(behind) * want;
            moveYaw = Math.atan2(gx - self.x, gz - self.z);
          }
        }
        this.attack(self, world, kit, foe, foeState, d, intent);
      }
    } else {
      // Nobody around: roam and look for a fight.
      if (!this.wander || now >= this.wander.until || Math.hypot(this.wander.x - self.x, this.wander.z - self.z) < 3) {
        this.wander = this.pickWander(world, now);
      }
      moveYaw = Math.atan2(this.wander.x - self.x, this.wander.z - self.z);
      push = 0.85;
    }

    if (hesitating) push *= 0.3;

    // Stuck on a wall or a ledge: hop, then try going round it.
    if (now < this.sidestepUntil) {
      moveYaw = this.sidestepYaw;
      push = 1;
    } else if (push > 0.3 && motion.grounded && Math.hypot(motion.vx, motion.vz) < 2.5) {
      this.stuck += dt;
      if (this.stuck > 0.35) intent.jump = true;
      if (this.stuck > 1.1) {
        this.sidestepYaw = moveYaw + (this.chance(0.5) ? 1 : -1) * this.rnd(1.2, 2);
        this.sidestepUntil = now + this.rnd(0.5, 0.9);
        this.stuck = 0;
        // Chasing someone it cannot reach (up a keep): give up on them for a while.
        if (this.target && foe && foe.y - self.y > 3) {
          this.ignore.set(this.target, now + this.rnd(5, 9));
          this.target = null;
        }
      }
    } else {
      this.stuck = 0;
    }

    moveYaw = this.avoidEdges(self, world, moveYaw, push);

    // The odd hop while moving about.
    if (push > 0.5 && motion.grounded && this.chance(dt * this.t.hops)) intent.jump = true;

    if (this.queuedDash && motion.dashCd <= 0) {
      const toward = foe ? Math.atan2(foe.x - self.x, foe.z - self.z) : moveYaw;
      const dashYaw =
        this.queuedDash === 'in' ? toward : this.queuedDash === 'out' ? this.blendToCentre(self, toward + Math.PI, 0.5) : toward + this.strafe * (Math.PI / 2);
      moveYaw = this.avoidEdges(self, world, dashYaw, 1);
      push = 1;
      intent.dash = true;
      if (this.queuedDash === 'side' && this.chance(0.4)) intent.jump = true;
      this.queuedDash = null;
    }

    intent.yaw = moveYaw;
    intent.push = push;
    return intent;
  }

  // ------------------------------------------------------------------ lobby

  private lobby(self: PlayerState, world: BrainWorld, intent: BotIntent, dt: number): BotIntent {
    const now = world.now;
    if (now < this.lobbyUntil) return intent;
    // Walk into the portal, like everyone does.
    const gz = PORTAL.z - 1;
    intent.yaw = Math.atan2(this.portalX - self.x, gz - self.z);
    intent.push = 1;
    const motion = world.motion(this.sid);
    if (motion && Math.hypot(motion.vx, motion.vz) < 2) this.lobbyStuck += dt;
    // If the walk fails for any reason, the PLAY button is always there.
    if (this.lobbyStuck > 4 || now > this.lobbyUntil + 12) intent.enterArena = true;
    return intent;
  }

  // ------------------------------------------------------------- targeting

  private playerOf(world: BrainWorld, sid: string): PlayerState | null {
    for (const [id, p] of world.players()) if (id === sid) return p;
    return null;
  }

  /**
   * Who to fight. Re-thought every couple of seconds, not every frame; the
   * nearest is likely but not certain, the weak are tempting, whoever just hit
   * it gets its attention, and real players are a touch more interesting.
   */
  private chooseTarget(self: PlayerState, world: BrainWorld): void {
    const now = world.now;
    // Hit by someone: turn on them (after noticing), more often than not.
    while (this.hitBy.length > 0 && this.hitBy[0]!.at <= now) {
      const { from } = this.hitBy.shift()!;
      if (from !== this.target && this.chance(this.persona.style === 'defensive' ? 0.4 : 0.65)) {
        this.target = from;
        this.retargetAt = now + this.rnd(2, 4);
      }
    }
    const current = this.target ? this.playerOf(world, this.target) : null;
    const valid = (p: PlayerState | null): boolean => !!p && !p.dead && p.zone === 'arena';
    if (current && !valid(current)) this.target = null;
    if (this.target && now < this.retargetAt) return;

    let best: string | null = null;
    let bestScore = Infinity;
    let currentScore = Infinity;
    for (const [id, p] of world.players()) {
      if (id === this.sid || !valid(p)) continue;
      if ((this.ignore.get(id) ?? 0) > now) continue;
      const seen = world.perceived(id, this.persona.reaction);
      if (!seen) continue;
      const d = Math.hypot(seen.x - self.x, seen.z - self.z);
      // Real players are noticed from further off: fill-ins exist to give them a fight.
      if (d > (world.isBot(id) ? 95 : 150)) continue;
      let score = d + (p.hp / COMBAT.maxHp) * 18 + this.rnd(0, 14);
      // Real players are a touch more interesting to fight than fill-ins.
      if (!world.isBot(id)) score *= 0.75;
      if (p.shield) score += 25;
      if (id === this.target) currentScore = score - 8;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    this.target = currentScore <= bestScore + 8 && this.target ? this.target : best;
    this.retargetAt = now + this.rnd(1.2, 3.5);
  }

  /** How far from the target to hang: the style, adjusted to what is ready right now. */
  private fightRange(self: PlayerState, kit: KitDef, foe: PlayerState, world: BrainWorld): number {
    const ready = (slot: number): boolean => world.readyIn(this.sid, slot) <= 0;
    const ranged = [kit.skill, kit.ultimate].find((a, i) => ready(i + 2) && windowOf(a).kind === 'aim' && windowOf(a).max > 9);
    const opening = foe.stun > 0 || foe.hp < self.hp - 25;
    switch (this.persona.style) {
      case 'aggressive':
        return M1[kit.m1].range * 0.6;
      case 'ranged':
        if (ranged) return Math.min(16, (windowOf(ranged).min + windowOf(ranged).max) / 2);
        return opening ? M1[kit.m1].range * 0.7 : 9;
      case 'defensive':
        return opening ? M1[kit.m1].range * 0.7 : 7.5;
      case 'balanced':
        if (ranged && this.chance(0.02)) return Math.min(12, (windowOf(ranged).min + windowOf(ranged).max) / 2);
        return M1[kit.m1].range * 0.75;
    }
  }

  // -------------------------------------------------------------- fighting

  /** Seen casts, once they could have been seen: dodge them, or parry. */
  private react(self: PlayerState, world: BrainWorld, kit: KitDef, motion: PlayerMotion): void {
    const now = world.now;
    while (this.seen.length > 0 && this.seen[0]!.at <= now) {
      const cast = this.seen.shift()!;
      const d = Math.hypot(cast.x - self.x, cast.z - self.z);
      if (d > 18) continue;
      // A counter kit parries a close attack if it reads it in time.
      if (kit.skill.effect.type === 'counter' && d < 6.5 && world.readyIn(this.sid, ACT.skill) <= 0) {
        const p = this.persona.style === 'defensive' ? 0.75 : this.persona.style === 'balanced' ? 0.5 : 0.3;
        if (this.chance(p * (0.4 + this.persona.skill))) {
          this.parryPending = true;
          continue;
        }
      }
      if (motion.dashCd <= 0 && cast.slot !== ACT.attack && this.chance(this.t.dodge * (0.35 + this.persona.skill * 0.8))) {
        this.queuedDash = 'side';
      }
    }
  }

  private parryPending = false;

  /** Buttons: M1 in reach, abilities in their window, all with human timing and aim. */
  private attack(self: PlayerState, world: BrainWorld, kit: KitDef, foe: Perceived, foeState: PlayerState, d: number, intent: BotIntent): void {
    const now = world.now;
    const toward = Math.atan2(foe.x - self.x, foe.z - self.z);
    const aimError = (0.05 + (1 - this.persona.skill) * 0.3) * this.noise() + (this.chance(0.05) ? (this.chance(0.5) ? 0.5 : -0.5) : 0);

    if (this.parryPending) {
      this.parryPending = false;
      intent.act = ACT.skill;
      intent.aim = toward;
      return;
    }

    if (now >= this.nextThink) {
      this.nextThink = now + this.rnd(0.18, 0.5);
      const opportunity = foeState.stun > 0 ? 1.8 : 1;
      const finishing = foeState.hp < 35 ? 1.4 : 1;
      for (const slot of [ACT.ultimate, ACT.skill]) {
        const ability = slot === ACT.skill ? kit.skill : kit.ultimate;
        if (world.readyIn(this.sid, slot) > 0) {
          this.holdUntil[slot] = null;
          continue;
        }
        // A human beat after the cooldown before it is even considered.
        if (this.holdUntil[slot] === null) {
          const style = this.persona.style === 'aggressive' ? 0.6 : this.persona.style === 'defensive' ? 1.4 : 1;
          this.holdUntil[slot] = now + this.rnd(0.3, 2.2) * style * (slot === ACT.ultimate ? 1.5 : 1);
        }
        if (now < this.holdUntil[slot]!) continue;
        const w = windowOf(ability);
        if (w.kind === 'counter') continue;
        const inWindow = d >= w.min && d <= w.max;
        if (!inWindow) continue;
        const p = this.t.eagerness * opportunity * finishing * (slot === ACT.ultimate ? 0.6 : 1);
        if (!this.chance(Math.min(0.95, p))) continue;
        // Lead a projectile a little, never perfectly.
        const speed = speedOf(ability);
        const lead = speed > 0 ? (d / speed) * this.persona.skill * this.rnd(0.4, 1.1) : 0;
        const ax = foe.x + foe.vx * lead;
        const az = foe.z + foe.vz * lead;
        intent.act = slot;
        intent.aim = Math.atan2(ax - self.x, az - self.z) + aimError * (w.kind === 'aim' ? 1 : 0.2);
        this.holdUntil[slot] = null;
        return;
      }
    }

    // M1: in reach (or, now and then, a whiff from just outside it).
    const reach = M1[kit.m1].range + 0.3;
    if (world.readyIn(this.sid, ACT.attack) > 0) {
      this.m1At = null;
      return;
    }
    const inReach = d <= reach || (d <= reach + 2.5 && this.chance(0.04));
    if (!inReach) return;
    if (this.persona.style === 'defensive' && foeState.stun <= 0 && this.chance(0.35)) return;
    if (this.m1At === null) this.m1At = now + this.rnd(this.t.press[0], this.t.press[1]);
    if (now < this.m1At) return;
    this.m1At = null;
    intent.act = ACT.attack;
    intent.aim = toward + aimError * 0.6;
  }

  // -------------------------------------------------------------- movement

  private blendToCentre(self: PlayerState, yaw: number, weight: number): number {
    const toMid = Math.atan2(ARENA.x - self.x, ARENA.z - self.z);
    const far = Math.min(1, Math.hypot(self.x - ARENA.x, self.z - ARENA.z) / ARENA.half);
    return yaw + wrap(toMid - yaw) * weight * far;
  }

  /**
   * Do not walk off the island: look a few studs ahead, and turn away from open
   * air. Usually. A careless moment (rarer for better players) lets it walk off,
   * as anybody might.
   */
  private avoidEdges(self: PlayerState, world: BrainWorld, yaw: number, push: number): number {
    if (push < 0.1) return yaw;
    const safe = (a: number): boolean => {
      for (const ahead of [2.5, 5]) {
        const x = self.x + Math.sin(a) * ahead;
        const z = self.z + Math.cos(a) * ahead;
        if (world.collision.floorBelow(x, self.y + 1.2, z, 0) === NO_FLOOR) return false;
      }
      return true;
    };
    if (safe(yaw)) return yaw;
    if (this.chance(0.003 * (1.2 - this.persona.skill))) return yaw;
    for (const turn of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const candidate = yaw + turn * this.strafe;
      if (safe(candidate)) return candidate;
    }
    return Math.atan2(ARENA.x - self.x, ARENA.z - self.z);
  }

  /** Somewhere to roam to: open ground on the island. */
  private pickWander(world: BrainWorld, now: number): { x: number; z: number; until: number } {
    // Half the time, roam toward where a real player is: that is where the game is.
    if (this.chance(0.5)) {
      const people: Perceived[] = [];
      for (const [id, p] of world.players()) {
        if (world.isBot(id) || p.dead || p.zone !== 'arena') continue;
        const seen = world.perceived(id, this.persona.reaction);
        if (seen) people.push(seen);
      }
      if (people.length > 0) {
        const who = people[Math.floor(this.random() * people.length)]!;
        const angle = this.rnd(0, TAU);
        const r = this.rnd(8, 30);
        const x = who.x + Math.cos(angle) * r;
        const z = who.z + Math.sin(angle) * r;
        if (world.collision.floorBelow(x, 1, z, 0) !== NO_FLOOR && !world.collision.blocked(x, 0.05, z)) return { x, z, until: now + this.rnd(5, 9) };
      }
    }
    for (let i = 0; i < 12; i += 1) {
      const angle = this.rnd(0, TAU);
      const r = this.rnd(20, 120);
      const x = ARENA.x + Math.cos(angle) * r;
      const z = ARENA.z + Math.sin(angle) * r;
      if (world.collision.floorBelow(x, 1, z, 0) === NO_FLOOR) continue;
      if (world.collision.blocked(x, 0.05, z)) continue;
      return { x, z, until: now + this.rnd(5, 10) };
    }
    return { x: ARENA.x + this.rnd(-60, 60), z: ARENA.z + 110, until: now + 6 };
  }
}
