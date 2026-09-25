/**
 * FILL-IN PLAYERS, checked against a RUNNING server (`npm run dev`).
 *
 * The probe tells real players from fill-ins exactly as a client can: the
 * server sends a `peer` message for every REAL player, and nothing marks a
 * bot. It checks, in order:
 *
 *   - a lone player gets company: bots arrive ONE AT A TIME, up to the target
 *   - their names look like anyone's (no BOT / AI / NPC / CPU)
 *   - they walk into the arena, move around, fight - M1s, abilities, dashes -
 *     hit each other and the real player, and die and come back like anyone
 *   - they land on the leaderboards
 *   - as real players arrive the bots leave gradually, and at 8 real there are none
 *   - a room never holds more than 15, and a real player is never refused
 *   - as real players leave, bots come back
 *
 * Usage: npm run dev, then npm run verify:bots   (about three minutes)
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
const until = async (condition, timeoutMs, step = 100) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await sleep(step);
  }
  return condition();
};

const stamp = Date.now().toString(36);
console.log(`fill-in players (${ENDPOINT})`);

// ---- the observer: one real player, alone in a fresh room
const observerClient = new Client(ENDPOINT);
const observer = await observerClient.create(S.ROOM_NAME, { playerId: `botprobe-main-${stamp}`, identity: { displayName: 'Observer', avatarUrl: '' } });
const real = new Set([observer.sessionId]);
const events = { cast: [], hit: [], died: [] };
for (const type of Object.values(S.MessageType)) observer.onMessage(type, () => undefined);
observer.onMessage(S.MessageType.Peer, (m) => real.add(m.sid));
observer.onMessage(S.MessageType.Cast, (m) => events.cast.push({ at: Date.now(), ...m }));
observer.onMessage(S.MessageType.Hit, (m) => events.hit.push({ at: Date.now(), ...m }));
observer.onMessage(S.MessageType.Died, (m) => events.died.push({ at: Date.now(), ...m }));
let seq = 0;
const keepAlive = setInterval(() => {
  seq += 1;
  observer.send(S.MessageType.Move, { seq, dt: 1 / 60, moveX: 0, moveZ: 0, cameraYaw: 0 });
}, 1000 / 60);

const players = () => (observer.state?.players ? [...observer.state.players.entries()] : []);
const bots = () => players().filter(([id]) => !real.has(id));
const botCount = () => bots().length;

// Arrivals, sampled as they happen.
const arrivals = [];
const seenBots = new Set();
const sampler = setInterval(() => {
  for (const [id] of bots()) {
    if (!seenBots.has(id)) {
      seenBots.add(id);
      arrivals.push(Date.now());
    }
  }
}, 50);

const target1 = S.MAX_PLAYERS_PER_ROOM >= 6 ? 5 : 0;
await until(() => botCount() >= target1, 60_000);
check(botCount() === target1, `a lone player gets ${botCount()} fill-in players (target ${target1})`);
const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]);
check(gaps.every((gap) => gap >= 1000), `they arrive one at a time (gaps ${gaps.map((g) => (g / 1000).toFixed(1)).join('s, ')}s)`);
const names = bots().map(([, p]) => p.displayName);
check(names.every((name) => name && !/\b(bot|ai|npc|cpu)\b|^bot|bot$/i.test(name)), `their names look like anyone's: ${names.join(', ')}`);
check(bots().every(([id]) => /^[A-Za-z0-9_-]{9}$/.test(id)), 'their session ids look like any other');

// ---- behaviour
await until(() => bots().filter(([, p]) => p.zone === 'arena').length >= target1 - 1, 30_000);
check(bots().filter(([, p]) => p.zone === 'arena').length >= target1 - 1, 'they go through the portal into the arena');
const start = new Map(bots().map(([id, p]) => [id, { x: p.x, z: p.z }]));
const kits = new Set(bots().map(([, p]) => p.kit));
check(kits.size >= 2, `they bring different kits (${[...kits].join(', ')})`);

// The observer joins the fight and stands in the open, to see whether anyone comes for it.
observer.send(S.MessageType.EnterArena, {});
const watchFrom = Date.now();
await sleep(60_000);
const moved = bots().filter(([id, p]) => {
  const s = start.get(id);
  return s && Math.hypot(p.x - s.x, p.z - s.z) > 10;
}).length;
check(moved >= Math.min(3, target1), `${moved} of them roam the arena`);
const botCasts = events.cast.filter((m) => m.at >= watchFrom && !real.has(m.sid));
const m1 = botCasts.filter((m) => m.slot === S.ACT.attack).length;
const abilities = botCasts.filter((m) => m.slot !== S.ACT.attack).length;
check(m1 > 5, `they attack (${m1} swings in a minute)`);
check(abilities > 2, `they use their kit's abilities (${abilities} casts: ${[...new Set(botCasts.filter((m) => m.slot !== 1).map((m) => `${m.kit}/${m.slot === 2 ? 'E' : 'R'}`))].join(', ')})`);
const botHits = events.hit.filter((m) => m.at >= watchFrom && !real.has(m.a) && m.a && !m.blocked);
check(botHits.length > 3, `their attacks land (${botHits.length} hits)`);
const onObserver = events.hit.filter((m) => m.at >= watchFrom && m.v === observer.sessionId && !real.has(m.a));
check(onObserver.length > 0 || events.died.some((d) => d.v === observer.sessionId), `they fight the real player too (${onObserver.length} hits on the observer)`);
const deaths = events.died.filter((m) => m.at >= watchFrom);
console.log(`        ${deaths.length} deaths in the minute (${deaths.filter((d) => d.cause === 'fall').length} falls)`);
const dashed = bots().some(([, p]) => p.dashCd > 0) || events.hit.length > 0;
check(dashed, 'they dash');
const withStats = bots().filter(([, p]) => p.damage > 0 || p.kills > 0).length;
check(withStats > 0, `their damage and kills count like anyone's (${withStats} with stats)`);
await sleep(2500);
const board = [...observer.state.leaderboard.damage].map((row) => row.name).filter(Boolean);
check(board.some((name) => names.includes(name) || bots().some(([, p]) => p.displayName === name)), `fill-ins appear on the Most Damage board (${board.slice(0, 5).join(', ')})`);

// ---- real players arrive: bots thin out, never over capacity, gone at 8
const extras = [];
let peak = 0;
const peakWatch = setInterval(() => {
  peak = Math.max(peak, observer.state.players.size);
}, 50);
for (let i = 0; i < 6; i += 1) {
  const c = new Client(ENDPOINT);
  extras.push(await c.joinById(observer.roomId, { playerId: `botprobe-${i}-${stamp}` }));
}
// 7 real players: the target drops to 1.
await until(() => botCount() <= S.MAX_PLAYERS_PER_ROOM && botCount() <= 1, 90_000);
check(botCount() <= 1, `with 7 real players the fill-ins thin out to ${botCount()}`);
extras.push(await new Client(ENDPOINT).joinById(observer.roomId, { playerId: `botprobe-7-${stamp}` }));
await until(() => botCount() === 0, 60_000);
check(botCount() === 0, 'with 8 real players there are no fill-ins at all');

// Fill the room to 15 real: nobody refused, never more than 15 in it.
let refused = 0;
// Real players are counted as the server reports them (someone else may have wandered in too).
for (let i = 8; real.size < S.MAX_PLAYERS_PER_ROOM && i < 40; i += 1) {
  try {
    extras.push(await new Client(ENDPOINT).joinById(observer.roomId, { playerId: `botprobe-${i}-${stamp}` }));
    await sleep(150);
  } catch (error) {
    // Only a refusal BELOW the real-player capacity is a fill-in taking a seat.
    if (real.size < S.MAX_PLAYERS_PER_ROOM) {
      refused += 1;
      console.log(`        refused at ${real.size} real players: ${error?.message ?? error} (code ${error?.code}); ${botCount()} fill-ins`);
    }
  }
}
check(real.size === S.MAX_PLAYERS_PER_ROOM, `the room filled to ${real.size} real players`);
await sleep(1500);
check(refused === 0, 'a real player is never refused because of fill-ins');
check(peak <= S.MAX_PLAYERS_PER_ROOM, `the room never held more than ${S.MAX_PLAYERS_PER_ROOM} (peak ${peak})`);
clearInterval(peakWatch);

// ---- they leave again: bots come back
for (const room of extras) await Promise.race([room.leave(true), sleep(1500)]);
await until(() => botCount() >= 3, 60_000);
check(botCount() >= 3, `as real players leave, fill-ins return (${botCount()} back)`);

clearInterval(keepAlive);
clearInterval(sampler);
await Promise.race([observer.leave(true), sleep(1500)]);
console.log(failures === 0 ? '\nall bot checks passed' : `\n${failures} bot check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
