/**
 * THE WHOLE MULTIPLAYER LOOP, played by two bots against a RUNNING server:
 *
 *   spawn on the island -> the portal and the PLAY button put you in the arena
 *   -> spawn shields -> an M1 lands: damage, launch, ragdoll (stun), Yen for the
 *   hitter, the watcher sees it -> knock someone off the island: a fall kill
 *   credited to the hitter -> death -> respawn on the island -> beat someone
 *   to 0 HP: a hit kill -> buy a kit in the arena ("respawn to equip") -> reset
 *   -> the new kit is equipped -> its ability casts, moves the caster, and a
 *   second cast is refused on cooldown -> the server rate-limits spammed
 *   attacks -> nothing happens on the spawn island -> progress persists
 *   across a reconnect.
 *
 * Needs a running server (`npm run dev`), default ws://localhost:2601.
 */
import { Client } from 'colyseus.js';
import * as S from '../shared/dist/index.js';

const ENDPOINT = process.env.ENDPOINT ?? 'ws://localhost:2601';
let failures = 0;
const check = (ok, message) => {
  if (ok) console.log(`  ok    ${message}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, timeoutMs, step = 20) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await sleep(step);
  }
  return condition();
};

const stamp = Date.now().toString(36);

class Bot {
  constructor(name, playerId) {
    this.name = name;
    this.playerId = playerId;
    this.intent = { moveX: 0, moveZ: 0, yaw: 0, jump: false, dash: false };
    this.act = null;
    this.seq = 0;
    this.messages = {};
  }

  async join() {
    this.client = new Client(ENDPOINT);
    this.room = await this.client.joinOrCreate(S.ROOM_NAME, { playerId: this.playerId, identity: { displayName: this.name, avatarUrl: '' } });
    for (const type of Object.values(S.MessageType)) {
      this.messages[type] = [];
      this.room.onMessage(type, (message) => this.messages[type].push({ at: Date.now(), ...message }));
    }
    await until(() => this.self?.ready, 3000);
    this.timer = setInterval(() => this.send(), 1000 / 60);
    return this;
  }

  get sid() {
    return this.room.sessionId;
  }

  get self() {
    return this.room?.state?.players?.get(this.room.sessionId);
  }

  of(sid) {
    return this.room.state.players.get(sid);
  }

  send() {
    this.seq += 1;
    const message = {
      seq: this.seq,
      dt: 1 / 60,
      moveX: this.intent.moveX,
      moveZ: this.intent.moveZ,
      cameraYaw: this.intent.yaw,
      jump: this.intent.jump,
      dash: this.intent.dash,
    };
    this.intent.dash = false;
    if (this.act) {
      message.act = this.act.act;
      message.aim = this.act.aim;
      this.act = null;
    }
    this.room.send(S.MessageType.Move, message);
  }

  stop() {
    this.intent.moveX = 0;
    this.intent.moveZ = 0;
  }

  /** Walk toward a point (forward is the camera yaw). Resolves when within `near`. */
  async walkTo(x, z, near = 2, timeoutMs = 12000, stopWhen = () => false) {
    let stuck = 0;
    const ok = await until(() => {
      const p = this.self;
      const dx = x - p.x;
      const dz = z - p.z;
      if (Math.hypot(dx, dz) <= near || stopWhen()) return true;
      this.intent.yaw = Math.atan2(dx, dz);
      this.intent.moveZ = p.stun > 0 ? 0 : 1;
      // Blocked by a ledge or a wall: jump it.
      stuck = p.speed < 4 && p.grounded ? stuck + 1 : 0;
      this.intent.jump = stuck > 6;
      // Still stuck (a tall column): sidestep round it.
      this.intent.moveX = stuck > 20 ? 1 : 0;
      return false;
    }, timeoutMs);
    this.stop();
    this.intent.jump = false;
    return ok;
  }

  /** Go anywhere in the arena along the open rim, clear of the ziggurat and the forts. */
  async travel(x, z, near = 1.5) {
    const R = 124;
    const ax = S.ARENA.x;
    const az = S.ARENA.z;
    const rim = (px, pz) => {
      const dx = px - ax;
      const dz = pz - az;
      return Math.abs(dx) >= Math.abs(dz) ? { x: ax + Math.sign(dx) * R, z: pz, side: dx > 0 ? 0 : 2 } : { x: px, z: az + Math.sign(dz) * R, side: dz > 0 ? 3 : 1 };
    };
    // Sides clockwise from east: 0 E, 1 S, 2 W, 3 N; corner after side k.
    const corners = [
      { x: ax + R, z: az - R },
      { x: ax - R, z: az - R },
      { x: ax - R, z: az + R },
      { x: ax + R, z: az + R },
    ];
    const from = rim(this.self.x, this.self.z);
    const to = rim(x, z);
    await this.walkTo(from.x, from.z, 1.5, 20000);
    for (let side = from.side; side !== to.side; side = (side + 1) % 4) {
      await this.walkTo(corners[side].x, corners[side].z, 1.5, 25000);
    }
    await this.walkTo(to.x, to.z, 1.5, 25000);
    return this.walkTo(x, z, near, 15000);
  }

  press(act, aim) {
    this.act = { act, aim };
  }

  aimAt(other) {
    const p = this.self;
    return Math.atan2(other.x - p.x, other.z - p.z);
  }

  count(type, filter = () => true) {
    return this.messages[type].filter(filter).length;
  }

  async leave() {
    clearInterval(this.timer);
    // Bounded: the server records the leave at once, but the client-side promise can stall.
    await Promise.race([this.room.leave(true), sleep(2000)]);
  }
}

console.log(`multiplayer loop (${ENDPOINT})`);
const A = await new Bot('Alpha', `verify-a-${stamp}`).join();
const B = await new Bot('Bravo', `verify-b-${stamp}`).join();

// ---- spawn
check(A.self.zone === 'lobby' && Math.hypot(A.self.x - S.SPAWN.x, A.self.z - S.SPAWN.z) < 0.5, 'A spawns on the island at the spawn point');
check(A.self.hp === S.COMBAT.maxHp && A.self.kit === 'asta' && A.self.yen === 0, 'fresh player: full health, Asta equipped, 0 Yen');
await until(() => A.of(B.sid) !== undefined && B.of(A.sid) !== undefined, 2000);
check(A.of(B.sid) !== undefined && B.of(A.sid) !== undefined, 'both players see each other');

// ---- attacks on the island do nothing
A.press(S.ACT.attack, A.aimAt(B.self));
await sleep(300);
check(A.count(S.MessageType.Hit) === 0, 'an attack on the spawn island hurts nobody');

// ---- the portal
await A.walkTo(S.PORTAL.x, S.PORTAL.z - 1, 0.5, 8000, () => A.self.zone === 'arena');
await until(() => A.self.zone === 'arena', 2000);
check(A.self.zone === 'arena' && A.self.z < -200, `walking into the portal teleports A to the arena (z ${A.self.z.toFixed(0)})`);
check(A.messages[S.MessageType.Respawn].some((m) => m.reason === 'arena'), 'A was told it was placed in the arena');

// ---- the PLAY button
B.room.send(S.MessageType.EnterArena, {});
await until(() => B.self.zone === 'arena', 2000);
check(B.self.zone === 'arena', 'PLAY puts B in the arena');
check(B.self.shield === true, 'a fresh arrival has spawn protection');

// ---- B goes to the east edge; A comes at B from the west
const edgeX = S.ARENA.x + S.ARENA.half + 14;
await B.travel(edgeX, S.ARENA.z, 1.2);
await until(() => !A.self.shield && !B.self.shield, 4000);
check(!A.self.shield && !B.self.shield, 'spawn protection wears off');
await A.travel(B.self.x - 3.2, B.self.z, 0.6);
check(Math.hypot(A.self.x - B.self.x, A.self.z - B.self.z) < 6, 'A reaches B');

const bHp = B.self.hp;
A.press(S.ACT.attack, A.aimAt(B.self));
await until(() => A.count(S.MessageType.Hit, (m) => m.v === B.sid) > 0, 1500);
const hit = A.messages[S.MessageType.Hit].find((m) => m.v === B.sid);
check(hit && hit.dmg === S.M1.sword.hit.damage, `A's M1 lands for ${hit?.dmg} damage`);
check(hit && hit.kx > 10 && hit.ky > 5, 'the hit launches B away from A and up');
await until(() => B.self.hp < bHp && B.self.stun > 0, 1000);
check(B.self.hp === bHp - S.M1.sword.hit.damage, `B's health drops to ${B.self.hp}`);
check(B.self.stun > 0, `B is ragdolled/immobilised (stun ${B.self.stun.toFixed(2)}s)`);
check(B.count(S.MessageType.Hit, (m) => m.v === B.sid) > 0, 'the victim sees the hit too');
await until(() => A.self.yen > 0, 1000);
check(A.self.yen === S.M1.sword.hit.damage && A.self.damage === S.M1.sword.hit.damage, `A earns ${A.self.yen} Yen and ${A.self.damage} damage from the hit`);
check(A.count(S.MessageType.Reward, (m) => m.reason === 'damage') > 0, 'A is told about the Yen');

// ---- the knock-off: B flies off the edge (or walks off while still marked)
const fell = await until(() => B.self.dead || B.self.x > edgeX + 8, 3000);
if (!B.self.dead) {
  B.intent.yaw = Math.PI / 2;
  B.intent.moveZ = 1;
}
await until(() => B.self.dead, 6000);
B.stop();
const fallDeath = A.messages[S.MessageType.Died].find((m) => m.v === B.sid);
check(fell && fallDeath?.cause === 'fall', 'B falls off the arena and dies');
check(fallDeath?.k === A.sid && A.self.kills === 1, 'the fall kill is credited to the last hitter (A)');
check(A.self.yen === S.M1.sword.hit.damage + S.COMBAT.killYen, `A earns the kill bonus (${A.self.yen} Yen)`);
check(B.self.deaths === 1, 'B has one death');

// ---- respawn
await until(() => B.self.zone === 'lobby' && !B.self.dead, (S.COMBAT.deathSeconds + 2) * 1000);
check(B.self.zone === 'lobby' && !B.self.dead && B.self.hp === S.COMBAT.maxHp, 'after the death timer B respawns on the island at full health');
check(B.messages[S.MessageType.Respawn].some((m) => m.reason === 'death'), 'B was told why it respawned');

// ---- a hit kill: back in, and A beats B to 0 HP (B stands still)
B.room.send(S.MessageType.EnterArena, {});
await until(() => B.self.zone === 'arena', 2000);
const HOLD = { x: S.ARENA.x + 124, z: S.ARENA.z + 20 };
await B.travel(HOLD.x, HOLD.z, 1.2);
await A.travel(HOLD.x - 4, HOLD.z, 1.5);
await until(() => !B.self.shield, 4000);
const killsBefore = A.self.kills;
const hitKill = await until(() => {
  const b = B.self;
  const a = A.self;
  if (b.dead) return true;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  A.intent.yaw = Math.atan2(dx, dz);
  A.intent.moveZ = d > 3.5 && a.stun <= 0 ? 1 : 0;
  if (d < 5.5 && !A.act) A.press(S.ACT.attack, Math.atan2(dx, dz));
  // Keep B on the island: walk back toward the middle between hits.
  const toMid = Math.atan2(HOLD.x - b.x, HOLD.z - b.z);
  B.intent.yaw = toMid;
  B.intent.moveZ = Math.hypot(HOLD.x - b.x, HOLD.z - b.z) > 12 ? 1 : 0;
  return false;
}, 60000, 30);
A.stop();
B.stop();
const hitDeath = A.messages[S.MessageType.Died].filter((m) => m.v === B.sid).at(-1);
check(hitKill && A.self.kills === killsBefore + 1, 'A lands hits until B is out of health');
check(hitDeath?.cause === 'hit' || hitDeath?.cause === 'fall', `B dies (${hitDeath?.cause}), A has ${A.self.kills} kills, ${A.self.yen} Yen, streak ${A.self.streak}`);

// ---- enough Yen to buy Ichigo? (one more knock-off if not)
await until(() => B.self.zone === 'lobby' && !B.self.dead, (S.COMBAT.deathSeconds + 2) * 1000);
const ichigo = S.kitById('ichigo');
for (let cycle = 0; cycle < 5 && A.self.yen < ichigo.price; cycle += 1) {
  await until(() => B.self.zone === 'lobby' && !B.self.dead, (S.COMBAT.deathSeconds + 2) * 1000);
  B.room.send(S.MessageType.EnterArena, {});
  await until(() => B.self.zone === 'arena', 2000);
  await B.travel(edgeX, S.ARENA.z, 1.2);
  await until(() => !B.self.shield, 4000);
  await A.travel(B.self.x - 3.2, B.self.z, 0.6);
  A.press(S.ACT.attack, A.aimAt(B.self));
  await until(() => B.self.stun > 0, 1500);
  await sleep(900);
  if (!B.self.dead) {
    B.intent.yaw = Math.PI / 2;
    B.intent.moveZ = 1;
  }
  await until(() => B.self.dead, 6000);
  B.stop();
  console.log(`        cycle ${cycle + 1}: A yen ${A.self.yen}, kills ${A.self.kills}, streak ${A.self.streak}`);
}
check(A.self.yen >= ichigo.price, `A has ${A.self.yen} Yen, enough for Ichigo (${ichigo.price})`);

// ---- buy in the arena: unlocked, equips on respawn
const yenBefore = A.self.yen;
A.room.send(S.MessageType.BuyKit, { kit: 'ichigo' });
await until(() => A.self.ownedKits.includes('ichigo'), 2000);
check(A.self.ownedKits.includes('ichigo') && A.self.yen === yenBefore - ichigo.price, 'buying Ichigo spends the Yen and unlocks it');
check(A.self.kit === 'asta' && A.self.pendingKit === 'ichigo', 'bought mid-fight, it waits for the respawn');
check(A.messages[S.MessageType.Notice].some((m) => m.kind === 'unlocked' && /respawn to equip/.test(m.text)), 'A sees "You have unlocked Ichigo, respawn to equip!"');
A.room.send(S.MessageType.BuyKit, { kit: 'saitama' });
await sleep(300);
check(!A.self.ownedKits.includes('saitama') && A.messages[S.MessageType.Notice].some((m) => m.kind === 'refused'), 'a kit A cannot afford is refused');

await sleep(Math.max(0, S.COMBAT.creditSeconds * 1000 - (Date.now() - (A.messages[S.MessageType.Hit].filter((m) => m.v === A.sid).at(-1)?.at ?? 0))));
A.room.send(S.MessageType.RequestRespawn, {});
await until(() => A.self.zone === 'lobby', 2000);
check(A.self.zone === 'lobby' && A.self.kit === 'ichigo' && A.self.pendingKit === '', 'after resetting home, Ichigo is equipped');

// ---- the new kit's ability
A.room.send(S.MessageType.EnterArena, {});
await until(() => A.self.zone === 'arena', 2000);
await sleep(300);
const from = { x: A.self.x, z: A.self.z };
A.press(S.ACT.skill, A.self.rotationY);
await until(() => A.count(S.MessageType.Cast, (m) => m.sid === A.sid && m.slot === 2) > 0, 1500);
const cast = A.messages[S.MessageType.Cast].find((m) => m.sid === A.sid && m.slot === 2);
check(cast?.kit === 'ichigo', 'Flash Step (E) is cast with the Ichigo kit, and broadcast');
check(B.count(S.MessageType.Cast, (m) => m.sid === A.sid && m.slot === 2) > 0, 'the other player receives the cast');
await sleep(400);
const moved = Math.hypot(A.self.x - from.x, A.self.z - from.z);
check(moved > 10, `Flash Step moves A ${moved.toFixed(1)} studs`);
A.press(S.ACT.skill, A.self.rotationY);
await until(() => A.count(S.MessageType.Refused) > 0, 1500);
check(A.count(S.MessageType.Refused) > 0, 'casting again at once is refused (cooldown)');

// ---- spam: the server's cooldown decides
await sleep(600);
const castsBefore = A.count(S.MessageType.Cast, (m) => m.sid === A.sid && m.slot === 1);
const spamStart = Date.now();
for (let i = 0; i < 60; i += 1) {
  A.press(S.ACT.attack, 0);
  await sleep(17);
}
const spamSeconds = (Date.now() - spamStart) / 1000;
await sleep(200);
const swings = A.messages[S.MessageType.Cast].filter((m) => m.sid === A.sid && m.slot === 1).slice(castsBefore);
const gaps = swings.slice(1).map((m, i) => m.at - swings[i].at);
const allowed = Math.ceil(spamSeconds / (S.M1.sword.cooldown * S.COMBAT.cooldownSlack)) + 1;
check(swings.length <= allowed && gaps.every((gap) => gap >= S.M1.sword.cooldown * S.COMBAT.cooldownSlack * 1000 - 60), `60 presses in ${spamSeconds.toFixed(1)}s give ${swings.length} swings, spaced ${gaps.join('/')}ms (the cooldown)`);

// ---- the client cannot award itself anything
const yenNow = A.self.yen;
A.room.send('reward', { yen: 99999 });
A.room.send(S.MessageType.Hit, { v: B.sid, dmg: 100 });
await sleep(300);
check(A.self.yen === yenNow && B.self.hp === S.COMBAT.maxHp, 'forged reward/hit messages change nothing');

// ---- persistence across a reconnect
const saved = { yen: A.self.yen, kills: A.self.kills, damage: A.self.damage, kit: A.self.kit, owned: [...A.self.ownedKits] };
await A.leave();
await sleep(600);
const A2 = await new Bot('Alpha', `verify-a-${stamp}`).join();
check(
  A2.self.yen === saved.yen && A2.self.kills === saved.kills && A2.self.damage === saved.damage,
  `Yen (${A2.self.yen}), kills (${A2.self.kills}) and damage (${A2.self.damage}) survive a reconnect`,
);
check(A2.self.kit === 'ichigo' && A2.self.ownedKits.includes('ichigo'), 'the owned and equipped kit survive a reconnect');
check(A2.self.zone === 'lobby', 'a reconnect starts on the spawn island');

// ---- the boards
await sleep(2300);
const board = A2.room.state.leaderboard;
const handle = S.handleFor(`verify-a-${stamp}`);
const killsRow = [...board.kills].find((row) => row.handle === handle);
const damageRow = [...board.damage].find((row) => row.handle === handle);
check(killsRow && killsRow.value === saved.kills, `Most Kills board shows Alpha with ${killsRow?.value}`);
check(damageRow && damageRow.value === saved.damage, `Most Damage board shows Alpha with ${damageRow?.value}`);

await A2.leave();
await B.leave();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
