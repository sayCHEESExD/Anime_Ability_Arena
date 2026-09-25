/**
 * EVERY KIT, IN-PROCESS: the real server CombatService and MovementService
 * on a fake clock, with no network. For each of the 15 kits, the caster fires
 * its skill (E) and its ultimate (R) at a dummy standing at a fitting range,
 * and the dummy must take damage, be launched and ragdolled (or, for a buff,
 * the buff must apply). Then the special rules: the counter parries and cuts
 * down the attacker, spawn protection blocks, Devil Union armour ignores
 * knockback, nobody is hurt on the spawn island, a fall after a hit is the
 * hitter's kill, and Yen follows damage exactly.
 *
 *   npm run verify:combat   (builds the server first)
 */
import * as S from '../shared/dist/index.js';
import { CombatService } from '../server/dist/combat/CombatService.js';
import { MovementService } from '../server/dist/movement/MovementService.js';
import { GameState } from '../server/dist/rooms/state/GameState.js';
import { PlayerState } from '../server/dist/rooms/state/PlayerState.js';

// ---- a controllable clock for performance.now() and Date.now()
let clock = 1_000_000;
Object.defineProperty(globalThis.performance, 'now', { value: () => clock, configurable: true });
const realDateNow = Date.now;
Date.now = () => Math.floor(clock);

let failures = 0;
const check = (ok, message) => {
  if (ok) console.log(`  ok    ${message}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
};

const ORIGIN = { x: S.ARENA.x + 20, z: S.ARENA.z + 104 };

/** A fresh little world: one room's state, the two services and a message log. */
const makeWorld = () => {
  const state = new GameState();
  const movement = new MovementService();
  const log = [];
  const sent = [];
  const deaths = [];
  const host = {
    get state() {
      return state;
    },
    movement,
    broadcast: (type, message) => log.push({ type, ...message }),
    sendTo: (sid, type, message) => sent.push({ sid, type, ...message }),
    persist: () => undefined,
    respawnAfterDeath: (sid) => deaths.push(sid),
  };
  const combat = new CombatService(host);
  const seqs = new Map();
  const add = (sid, x, z, yaw, kit = 'asta') => {
    const p = new PlayerState();
    p.sessionId = sid;
    p.kit = kit;
    p.zone = 'arena';
    state.players.set(sid, p);
    movement.initialise(p);
    movement.teleport(p, x, 0, z, yaw);
    combat.add(sid);
    combat.syncDerived(p);
    seqs.set(sid, 0);
    return p;
  };
  /** One 60 Hz input for a player, optionally pressing a slot. */
  const input = (sid, act = 0, aim = 0) => {
    const p = state.players.get(sid);
    const seq = seqs.get(sid) + 1;
    seqs.set(sid, seq);
    const message = { seq, dt: 1 / 60, moveX: 0, moveZ: 0, cameraYaw: 0 };
    if (act) {
      message.act = act;
      message.aim = aim;
    }
    const events = movement.applyInput(p, message, (a, y, m) => combat.tryCast(sid, a, y, m));
    if (events) combat.afterStep(sid, events);
  };
  /** Advance everyone `seconds`, ticking combat at 20 Hz like the room. */
  let tickAcc = 0;
  const run = (seconds) => {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i += 1) {
      clock += 1000 / 60;
      for (const sid of state.players.keys()) input(sid);
      tickAcc += 1 / 60;
      if (tickAcc >= 0.05) {
        tickAcc -= 0.05;
        combat.tick(0.05);
      }
    }
  };
  return { state, movement, combat, log, sent, deaths, add, input, run };
};

/** How far the dummy stands, per ability, so the move can reach it. */
const RANGE = {
  asta_meteorite: 12,
  asta_devil: 4,
  ichigo_flashstep: 9,
  ichigo_getsuga: 16,
  luffy_pistol: 12,
  luffy_gatling: 5,
  naruto_rasengan: 12,
  naruto_rasenshuriken: 16,
  jinwoo_authority: 10,
  jinwoo_arise: 7,
  maki_cloud: 4,
  maki_spear: 16,
  sasuke_fireball: 14,
  sasuke_chidori: 16,
  yuji_divergent: 4,
  yuji_blackflash: 5,
  deku_delaware: 14,
  deku_detroit: 12,
  killua_palm: 14,
  killua_godspeed: 4,
  zoro_onigiri: 10,
  zoro_tatsumaki: 6,
  tanjiro_deadcalm: 4,
  tanjiro_hinokami: 9,
  sukuna_dismantle: 12,
  sukuna_shrine: 8,
  gojo_blue: 12,
  gojo_purple: 18,
  saitama_normal: 4,
  saitama_serious: 18,
};

console.log('every kit, every ability (server combat, in-process)');
for (const kit of S.KITS) {
  for (const slot of [S.ACT.skill, S.ACT.ultimate]) {
    const ability = S.abilityOf(kit, slot);
    const w = makeWorld();
    const d = RANGE[ability.id] ?? 6;
    const caster = w.add('caster', ORIGIN.x, ORIGIN.z, 0, kit.id);
    const dummy = w.add('dummy', ORIGIN.x, ORIGIN.z + d, Math.PI, 'asta');
    w.run(0.1);
    w.input('caster', slot, 0);
    const cast = w.log.find((m) => m.type === S.MessageType.Cast && m.sid === 'caster');
    const effect = ability.effect.type;
    if (effect === 'buff') {
      w.run(0.3);
      check(cast && caster.buff === ability.effect.buff, `${kit.name} ${slot === 2 ? 'E' : 'R'} ${ability.name}: buff "${caster.buff}" applied (speed ${caster.moveSpeed.toFixed(1)})`);
      // ...and, once the cast's root ends, the buffed M1 lands.
      w.run(Math.max(0.2, (ability.motion?.lock ?? 0) - 0.2));
      w.input('caster', S.ACT.attack, 0);
      w.run(0.2);
      check(dummy.hp < 100, `${kit.name} buffed M1 lands for ${100 - dummy.hp}`);
      continue;
    }
    if (effect === 'counter') {
      // The dummy attacks into the stance.
      w.run(0.15);
      w.input('dummy', S.ACT.attack, Math.PI);
      w.run(0.3);
      const parried = w.log.some((m) => m.type === S.MessageType.Fx && m.kind === 'counter');
      check(parried && caster.hp === 100 && dummy.hp < 100 && dummy.stun > 0, `${kit.name} ${ability.name}: the attack is parried (caster ${caster.hp} HP) and the attacker is cut (${dummy.hp} HP)`);
      continue;
    }
    w.run(effect === 'summon' || effect === 'zone' ? 5.5 : 3.5);
    const hits = w.log.filter((m) => m.type === S.MessageType.Hit && m.v === 'dummy' && m.a === 'caster' && !m.blocked);
    const taken = 100 - dummy.hp + (dummy.dead ? 0 : 0);
    const launched = hits.some((m) => Math.hypot(m.kx, m.kz) > 0 || m.ky > 0);
    check(
      cast && hits.length > 0 && (taken > 0 || dummy.dead) && launched,
      `${kit.name} ${slot === 2 ? 'E' : 'R'} ${ability.name}: ${hits.length} hit(s), ${dummy.dead ? 'KO' : `${taken} dmg`}, launched`,
    );
    const yen = caster.yen;
    const damageDealt = hits.reduce((sum, m) => sum + m.dmg, 0);
    const expectedYen = damageDealt * S.COMBAT.yenPerDamage + (dummy.dead ? S.COMBAT.killYen : 0);
    if (yen !== expectedYen) check(false, `${kit.name} ${ability.name}: Yen ${yen} should equal damage ${damageDealt} (+kill)`);
  }
}

console.log('\nthe arena on foot (walking only, no jumps)');
{
  const collision = new S.WorldCollision();
  const walk = (motion, route) => {
    const params = S.createSimParams();
    const events = S.createSimEvents();
    const reached = [];
    for (const [x, z, expectY, label] of route) {
      for (let i = 0; i < 60 * 10; i += 1) {
        const dx = x - motion.x;
        const dz = z - motion.z;
        if (Math.hypot(dx, dz) < 0.6) break;
        S.stepPlayer(motion, { moveX: 0, moveZ: 1, cameraYaw: Math.atan2(dx, dz), jump: false, dash: false }, params, 1 / 60, collision, events);
      }
      const ok = Math.hypot(x - motion.x, z - motion.z) < 1.2 && Math.abs(motion.y - expectY) < 0.05;
      check(ok, `${label} (y ${motion.y.toFixed(1)}, ${Math.hypot(x - motion.x, z - motion.z).toFixed(1)} from the mark)`);
      reached.push(ok);
    }
    return reached.every(Boolean);
  };
  const ax = S.ARENA.x;
  const az = S.ARENA.z;
  const m = S.createMotion();
  S.resetMotion(m, ax, 0, az + 45, Math.PI);
  walk(m, [
    [ax, az + 27, 4, 'ziggurat: up the north flight to the first tier'],
    [ax + 26, az + 27, 4, 'along the first tier'],
    [ax + 28, az, 4, 'round to the east flight'],
    [ax + 11, az, 8, 'up to the second tier'],
    [ax + 14, az + 15, 8, 'along the second tier'],
    [ax, az + 17, 8, 'round to the summit flight'],
    [ax, az + 3, 12, 'up to the summit'],
  ]);
  const fort = S.ARENA_FORTS[0];
  const f = S.createMotion();
  S.resetMotion(f, fort.x - 42, 0, fort.z + 11, Math.PI / 2);
  walk(f, [
    [fort.x - 10, fort.z + 11, S.RING_HEIGHT, 'fort: up the flight onto the platform'],
    [fort.x - 6, fort.z + 17, S.RING_HEIGHT, 'across the platform'],
    [fort.x, fort.z + 17, S.RING_HEIGHT + 1, 'onto the foot of the keep flight'],
    [fort.x, fort.z + 4.5, 18, 'up to the top of the keep'],
  ]);
  const b = S.createMotion();
  S.resetMotion(b, fort.x, S.RING_HEIGHT, fort.z - 16, Math.PI);
  walk(b, [[fort.x, S.ARENA.z, S.RING_HEIGHT, 'bridge: from the fort along the ring']]);
  const u = S.createMotion();
  S.resetMotion(u, ax + 60, 0, az + 18, Math.PI / 2);
  walk(u, [[ax + 118, az + 18, 0, 'under a bridge on the ground']]);
}

console.log('\nrules');
{
  // Spawn protection blocks; attacking drops your own.
  const w = makeWorld();
  const a = w.add('a', ORIGIN.x, ORIGIN.z, 0);
  const b = w.add('b', ORIGIN.x, ORIGIN.z + 4, Math.PI);
  w.combat.enteredArena('b');
  w.run(0.1);
  w.input('a', S.ACT.attack, 0);
  w.run(0.2);
  check(b.hp === 100 && w.log.some((m) => m.type === S.MessageType.Hit && m.blocked), 'spawn protection blocks a hit');
  w.run(3);
  w.input('a', S.ACT.attack, 0);
  w.run(0.2);
  check(b.hp < 100 && b.stun > 0, 'after it wears off the hit lands and ragdolls');
  check(a.yen === 100 - b.hp, `the hitter earns 1 Yen per damage (${a.yen})`);
}
{
  // Nobody is hurt on the spawn island.
  const w = makeWorld();
  const a = w.add('a', 0, 4, 0);
  const b = w.add('b', 0, 8, Math.PI);
  a.zone = 'lobby';
  b.zone = 'lobby';
  w.run(0.1);
  w.input('a', S.ACT.attack, 0);
  w.input('a', S.ACT.skill, 0);
  w.run(2);
  check(b.hp === 100 && a.yen === 0, 'no damage and no Yen on the spawn island');
}
{
  // Devil Union armour: damage lands, knockback and stun do not.
  const w = makeWorld();
  const a = w.add('a', ORIGIN.x, ORIGIN.z, 0, 'saitama');
  const b = w.add('b', ORIGIN.x, ORIGIN.z + 4, Math.PI, 'asta');
  w.run(0.1);
  w.input('b', S.ACT.ultimate, Math.PI);
  w.run(0.8);
  w.input('a', S.ACT.skill, 0);
  w.run(0.3);
  check(b.buff === 'devil' && b.hp < 100 && b.stun === 0, `Devil Union: Normal Punch hurts (${b.hp} HP) but cannot launch or stun`);
}
{
  // A knock-off: hit, then fall below the world within the credit window.
  const w = makeWorld();
  const edge = S.ARENA.x + S.ARENA.half + 20;
  const a = w.add('a', edge - 4, S.ARENA.z, Math.PI / 2, 'saitama');
  const b = w.add('b', edge, S.ARENA.z, -Math.PI / 2);
  w.run(0.1);
  w.input('a', S.ACT.skill, Math.PI / 2);
  for (let i = 0; i < 400 && !b.dead; i += 1) {
    w.run(1 / 60);
    if (b.y < S.KILL_Y) w.combat.fell('b');
  }
  const died = w.log.find((m) => m.type === S.MessageType.Died);
  check(b.dead && died?.cause === 'fall' && died.k === 'a' && a.kills === 1, 'knocked off the island: a fall kill credited to the hitter');
  check(a.yen === 12 + S.COMBAT.killYen, `the killer earns damage + ${S.COMBAT.killYen} Yen (${a.yen})`);
  w.run(S.COMBAT.deathSeconds + 0.2);
  check(w.deaths.includes('b'), 'the death timer hands the victim back to the room for a respawn');
}
{
  // Stunned players cannot act; interrupted wind-ups never land.
  const w = makeWorld();
  const a = w.add('a', ORIGIN.x, ORIGIN.z, 0, 'saitama');
  const b = w.add('b', ORIGIN.x, ORIGIN.z + 4, Math.PI, 'asta');
  w.run(0.1);
  w.input('a', S.ACT.ultimate, 0); // Serious Punch: a long wind-up
  w.run(0.2);
  w.input('b', S.ACT.attack, Math.PI); // b punches first
  w.run(1.5);
  check(b.hp === 100, 'a wind-up interrupted by a hit never lands');
}

Date.now = realDateNow;
console.log(failures === 0 ? '\nall combat checks passed' : `\n${failures} combat check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
