/**
 * PERSISTENCE, checked end to end against the BUILT server.
 *
 * Spawns `server/dist/index.js` with Bloxity's token verify route stubbed
 * (scripts/persistence/stub-bloxity.mjs, preloaded with `node --import`;
 * production code is untouched), joins it with real colyseus.js clients, and
 * reads the storage directly to prove what landed.
 *
 * Runs against the JSON store ALWAYS, in a temp directory.
 *
 * Runs against MongoDB too when one is available:
 *
 *   - MONGODB_URI=mongodb://host/db   uses that database and  * * WIPES IT * *
 *     (every collection is dropped before the suite). Never point it at a
 *     database you care about.
 *   - otherwise, if a `mongod` binary is found (MONGOD_BIN, or the one
 *     mongodb-memory-server caches under ~/.cache/mongodb-binaries), a real
 *     mongod is started on a fixed port with a temp dbPath and is killed and
 *     restarted for the outage tests. The binary lives OUTSIDE the repo.
 *   - otherwise the Mongo suite is skipped, loudly.
 *
 * Usage: npm run verify:persistence
 */
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'colyseus.js';
import { ACCOUNT_KEY_PREFIX, ARENA, MessageType, ROOM_NAME, accountKeyFor } from '../shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const STUB = pathToFileURL(path.join(ROOT, 'scripts', 'persistence', 'stub-bloxity.mjs')).href;
const GAME_SLUG = 'anime-ability-arena';
const PORT = 2611;
const MONGO_PORT = 27117;
const WINDOWS = platform() === 'win32';

if (!existsSync(SERVER_ENTRY)) {
  console.error(`server/dist is missing - run "npm run build:server" first (${SERVER_ENTRY})`);
  process.exit(1);
}

let failures = 0;
const fail = (message) => {
  lastProgress = Date.now();
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => {
  lastProgress = Date.now();
  console.log(`  ok    ${message}`);
};
const check = (condition, message) => (condition ? pass(message) : fail(message));
const note = (message) => console.log(`        ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A STALL WATCHDOG. Every step names itself; if no step completes for two
 * minutes the run is aborted with the name of the one it was in, so a hang
 * is a diagnosis rather than a silent process.
 */
let currentStep = 'starting';
let lastProgress = Date.now();
const step = (label) => {
  currentStep = label;
  lastProgress = Date.now();
  if (process.env.VERBOSE) note(`-> ${label}`);
};
setInterval(() => {
  if (Date.now() - lastProgress > 120_000) {
    console.error(`\npersistence: STALLED for 120s in step "${currentStep}"`);
    process.exit(2);
  }
}, 5000).unref();

const waitFor = async (probe, label, timeoutMs = 10_000, everyMs = 60) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await probe();
    } catch {
      value = undefined;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(everyMs);
  }
};

// ------------------------------------------------------------- the server

/** A spawned test server: its port, its log, and a hard stop. */
class TestServer {
  constructor(proc, port) {
    this.proc = proc;
    this.port = port;
    this.lines = [];
    this.exited = new Promise((resolve) => proc.once('exit', resolve));
    for (const stream of [proc.stdout, proc.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        rest += chunk;
        const parts = rest.split('\n');
        rest = parts.pop() ?? '';
        this.lines.push(...parts);
        // SERVER_LOG=<file> keeps every test server's output for a post-mortem.
        if (process.env.SERVER_LOG) appendFileSync(process.env.SERVER_LOG, parts.map((l) => `[${port}] ${l}\n`).join(''));
      });
    }
  }

  get log() {
    return this.lines.join('\n');
  }

  /**
   * Stop the server. On Windows a signal never reaches a Node handler, so it
   * is killed hard; every test that needs a write to survive waits for the
   * write to be visible in storage BEFORE calling this. Elsewhere a SIGTERM
   * exercises the graceful path (drain, flush, close).
   */
  async stop({ graceful = !WINDOWS } = {}) {
    if (this.proc.exitCode !== null) return;
    if (graceful) {
      this.proc.kill('SIGTERM');
      const finished = await Promise.race([this.exited.then(() => true), sleep(15_000).then(() => false)]);
      if (finished) return;
      note('graceful stop timed out; killing');
    }
    this.proc.kill('SIGKILL');
    await this.exited;
  }
}

const health = async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return response.ok ? response.json() : null;
};

const startServer = async ({ dataDir, mongoUri = '', port = PORT, slug = GAME_SLUG, stubSlug = GAME_SLUG }) => {
  const proc = spawn(process.execPath, ['--import', STUB, SERVER_ENTRY, '--port', String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      ARENA_DATA_DIR: dataDir,
      MONGODB_URI: mongoUri,
      BLOXITY_GAME_ID: slug,
      STUB_GAME_SLUG: stubSlug,
      HOST: '127.0.0.1',
      PORT: '',
      POD_NAME: `test-pod-${port}`,
      // Deterministic rooms: no fill-in players.
      ARENA_BOTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = new TestServer(proc, port);
  try {
    await waitFor(() => health(port), `server on ${port}`, 30_000, 100);
  } catch (error) {
    console.error(server.log);
    throw error;
  }
  return server;
};

// ------------------------------------------------------------- the client

const endpoint = (port) => `ws://127.0.0.1:${port}`;

/** Join the room as a browser (guest id) with an optional portal token. */
const joinAs = async (port, { playerId, token = null, name } = {}) => {
  const client = new Client(endpoint(port));
  const options = { playerId, token };
  if (name) options.identity = { displayName: name, avatarUrl: '' };
  const room = await client.joinOrCreate(ROOM_NAME, options);
  room.port = port;
  room.authStates = [];
  for (const type of Object.values(MessageType)) if (type !== 'authState') room.onMessage(type, () => {});
  room.onMessage('authState', (message) => room.authStates.push(message));
  await waitFor(() => room.state?.players?.get(room.sessionId), 'own player state');
  return room;
};

/** A join that is expected to be REFUSED. Returns the error code, or null if it got in. */
const joinRefused = async (port, options) => {
  try {
    const room = await joinAs(port, options);
    await room.leave();
    return null;
  } catch (error) {
    return error?.code ?? -1;
  }
};

const me = (room) => room.state.players.get(room.sessionId);

/**
 * State arrives by PATCH on the room's clock while a message is sent at once,
 * so a figure is asserted once the next patch has carried it, not the instant
 * the message landed.
 */
const settled = (room, predicate, label) =>
  waitFor(() => (predicate(me(room)) ? true : null), label, 4000, 40).then(
    () => true,
    () => false,
  );

/**
 * Earn progress the only way there is: DAMAGE another player in the arena. A
 * sparring partner joins the same room, both go through to the arena, meet in
 * open ground and the player lands M1s until the server credits damage (and
 * the Yen that comes with it). Returns the new lifetime damage.
 */
const MEET = { x: ARENA.x + 20, z: ARENA.z + 104 };
const drive = (room) => {
  let seq = 0;
  const intent = { yaw: 0, forward: 0, side: 0, jump: false, act: 0, aim: 0 };
  const timer = setInterval(() => {
    seq += 1;
    const message = { seq, dt: 1 / 60, moveX: intent.side, moveZ: intent.forward, cameraYaw: intent.yaw, jump: intent.jump };
    if (intent.act) {
      message.act = intent.act;
      message.aim = intent.aim;
      intent.act = 0;
    }
    room.send('move', message);
  }, 1000 / 60);
  return { intent, stop: () => clearInterval(timer) };
};
const walkTo = async (room, driver, x, z, near) => {
  let stuck = 0;
  await waitFor(() => {
    const p = me(room);
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.hypot(dx, dz) <= near) return true;
    driver.intent.yaw = Math.atan2(dx, dz);
    driver.intent.forward = p.stun > 0 ? 0 : 1;
    stuck = p.speed < 4 && p.grounded ? stuck + 1 : 0;
    driver.intent.jump = stuck > 3;
    driver.intent.side = stuck > 10 ? 1 : 0;
    return null;
  }, 'walk to the meeting point', 30_000, 30);
  driver.intent.forward = 0;
  driver.intent.side = 0;
  driver.intent.jump = false;
};
/** Travel along the open rim (124 out), clear of the ziggurat and the forts. */
const travel = async (room, driver, x, z, near) => {
  const R = 124;
  const rim = (px, pz) => {
    const dx = px - ARENA.x;
    const dz = pz - ARENA.z;
    return Math.abs(dx) >= Math.abs(dz)
      ? { x: ARENA.x + Math.sign(dx) * R, z: pz, side: dx > 0 ? 0 : 2 }
      : { x: px, z: ARENA.z + Math.sign(dz) * R, side: dz > 0 ? 3 : 1 };
  };
  const corners = [
    { x: ARENA.x + R, z: ARENA.z - R },
    { x: ARENA.x - R, z: ARENA.z - R },
    { x: ARENA.x - R, z: ARENA.z + R },
    { x: ARENA.x + R, z: ARENA.z + R },
  ];
  const from = rim(me(room).x, me(room).z);
  const to = rim(x, z);
  await walkTo(room, driver, from.x, from.z, 1.5);
  for (let side = from.side; side !== to.side; side = (side + 1) % 4) await walkTo(room, driver, corners[side].x, corners[side].z, 1.5);
  await walkTo(room, driver, to.x, to.z, 1.5);
  await walkTo(room, driver, x, z, near);
};
let sparCount = 0;
/** A sparring partner in the same room as `room`. */
const joinPartner = async (room) => {
  sparCount += 1;
  const partnerClient = new Client(endpoint(room.port ?? PORT));
  const partner = await partnerClient.joinById(room.roomId, { playerId: `spar_${sparCount}_${Date.now().toString(36)}` });
  for (const type of Object.values(MessageType)) partner.onMessage(type, () => {});
  await waitFor(() => partner.state?.players?.get(partner.sessionId), 'partner state');
  return partner;
};

const earn = async (room, _seconds, existing = null) => {
  const before = me(room).damage;
  const partner = existing ?? (await joinPartner(room));
  const mine = drive(room);
  const theirs = drive(partner);
  try {
    room.send('enterArena', {});
    partner.send('enterArena', {});
    await waitFor(() => me(room).zone === 'arena' && me(partner).zone === 'arena', 'both in the arena', 5000);
    await travel(partner, theirs, MEET.x, MEET.z, 1.5);
    await travel(room, mine, MEET.x - 3, MEET.z, 0.8);
    await sleep(2600);
    await waitFor(() => {
      if (me(room).damage > before) return true;
      const p = me(room);
      const q = me(partner);
      mine.intent.act = 1;
      mine.intent.aim = Math.atan2(q.x - p.x, q.z - p.z);
      return null;
    }, 'damage to be credited', 8000, 500);
  } finally {
    mine.stop();
    theirs.stop();
    if (!existing) await partner.leave(true).catch(() => undefined);
  }
  // Back to the island so a later session starts where a player would.
  room.send('requestRespawn', {});
  return me(room).damage;
};

const setAuth = async (room, token, expectStatus) => {
  const seen = room.authStates.length;
  room.send('setAuth', { token });
  return waitFor(
    () => room.authStates.slice(seen).find((m) => (expectStatus ? m.status === expectStatus : true)),
    `authState ${expectStatus ?? ''}`.trim(),
    15_000,
  );
};

const leaveAndWait = async (room) => {
  await room.leave(true);
  await sleep(150);
};

const webhook = async (port, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/bloxity/bux`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// ------------------------------------------------------------- the storage

/** Direct readers for each store, so a test proves what LANDED, not what a client saw. */
class JsonReader {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  readProfiles() {
    const file = path.join(this.dataDir, 'profiles.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  readGrants() {
    const file = path.join(this.dataDir, 'grants.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  async close() {}
}

class MongoReader {
  constructor(uri) {
    this.uri = uri;
  }
  async open() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 3000 });
    await this.client.connect();
    this.db = this.client.db();
  }
  async wipe() {
    await this.db.dropDatabase();
  }
  async readProfiles() {
    const out = {};
    for (const doc of await this.db.collection('profiles').find({}).toArray()) {
      const { _id, ...rest } = doc;
      out[_id] = rest;
    }
    return out;
  }
  async readGrants() {
    const out = {};
    for (const doc of await this.db.collection('grants').find({}).toArray()) {
      const { _id, ...rest } = doc;
      out[_id] = rest;
    }
    return out;
  }
  async close() {
    await this.client?.close();
  }
}

const profileOf = async (reader, key) => (await reader.readProfiles())[key] ?? null;
const waitForProfile = (reader, key, predicate, label, timeoutMs = 12_000) =>
  waitFor(async () => {
    const profile = await profileOf(reader, key);
    return profile && predicate(profile) ? profile : null;
  }, label, timeoutMs, 100);

const PROGRESS_KEYS = ['yen', 'lifetimeYen', 'kills', 'deaths', 'damage', 'bestStreak', 'kit', 'playSeconds'];
const LIST_KEYS = ['ownedKits'];
const sameProgress = (a, b) =>
  PROGRESS_KEYS.every((k) => (a?.[k] ?? 0) === (b?.[k] ?? 0)) &&
  LIST_KEYS.every((k) => JSON.stringify(a?.[k] ?? []) === JSON.stringify(b?.[k] ?? []));

// ------------------------------------------------------------- mongod

const findMongod = () => {
  if (process.env.MONGOD_BIN && existsSync(process.env.MONGOD_BIN)) return process.env.MONGOD_BIN;
  const cache = path.join(homedir(), '.cache', 'mongodb-binaries');
  if (!existsSync(cache)) return null;
  const bin = readdirSync(cache).find((f) => f.startsWith('mongod'));
  return bin ? path.join(cache, bin) : null;
};

class Mongod {
  constructor(binary, dbPath, port) {
    this.binary = binary;
    this.dbPath = dbPath;
    this.port = port;
    this.uri = `mongodb://127.0.0.1:${port}/arena_verify`;
  }
  async start() {
    mkdirSync(this.dbPath, { recursive: true });
    this.proc = spawn(this.binary, ['--port', String(this.port), '--dbpath', this.dbPath, '--bind_ip', '127.0.0.1', '--quiet'], {
      stdio: 'ignore',
    });
    this.exited = new Promise((resolve) => this.proc.once('exit', resolve));
    const { MongoClient } = await import('mongodb');
    await waitFor(async () => {
      const client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 500 });
      try {
        await client.connect();
        await client.db().command({ ping: 1 });
        return true;
      } finally {
        await client.close().catch(() => {});
      }
    }, `mongod on ${this.port}`, 40_000, 250);
  }
  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.proc.kill('SIGKILL');
    await this.exited;
    // Let the port go before a restart binds it again.
    await sleep(WINDOWS ? 800 : 200);
  }
}

// ------------------------------------------------------------- the suite

/**
 * The scenarios every store must pass. `ctx` carries the store's reader and
 * a way to (re)start the server against it.
 */
const runSuite = async (ctx) => {
  const { reader, kind } = ctx;
  const server = { current: await ctx.startServer() };
  const restart = async () => {
    await server.current.stop();
    server.current = await ctx.startServer();
  };
  const port = () => server.current.port;

  const acct = 'acct1';
  const acctKey = accountKeyFor(acct);
  const bad = new Set();
  const badToken = 'valid:'; // no id after the colon: the stub rejects it

  console.log(`\n${kind}: guests`);
  {
    const g = await joinAs(port(), { playerId: 'p_guest1', name: 'GuestOne' });
    const t1 = await earn(g);
    await leaveAndWait(g);
    const stored = await waitForProfile(reader, 'p_guest1', (p) => p.damage >= t1, 'guest save');
    check(stored.displayName === 'GuestOne', 'the guest save keeps its display name');
    const again = await joinAs(port(), { playerId: 'p_guest1' });
    check(me(again).damage === stored.damage, `existing guest profile restores (damage ${stored.damage})`);
    await leaveAndWait(again);
    ctx.guestProgress = stored;
  }

  console.log(`\n${kind}: first login migrates`);
  {
    const before = await profileOf(reader, 'p_guest1');
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    check(me(s).damage === before.damage, 'the session carries the guest progress into the account');
    const account = await waitForProfile(reader, acctKey, () => true, 'account profile');
    check(sameProgress(account, before), 'every progress field is preserved in the account profile');
    check(account.migratedFrom === 'p_guest1', 'account profile records migratedFrom');
    const guest = await waitForProfile(reader, 'p_guest1', (p) => p.migratedTo === acctKey, 'retired guest');
    check(guest.migratedSnapshot?.damage === before.damage, 'the guest copy keeps its progress as migratedSnapshot');
    check(guest.damage === 0, 'the retired guest profile is fresh');
    const more = await earn(s);
    check(more > before.damage, 'the signed-in session keeps earning');
    await leaveAndWait(s);
    const after = await waitForProfile(reader, acctKey, (p) => p.damage >= more, 'account save after playing');
    check((await profileOf(reader, 'p_guest1')).damage === 0, 'account play does not touch the retired guest');
    ctx.accountTotal = after.damage;
    bad.add(server.current.log.includes(`join`) ? '' : 'no join log');
  }

  console.log(`\n${kind}: nothing leaks to a claimed id`);
  {
    check((await joinRefused(port(), { playerId: `${ACCOUNT_KEY_PREFIX}${acct}` })) === 4104, 'a guest id with the account prefix is refused');
    const raw = await joinAs(port(), { playerId: acct });
    check(me(raw).damage === 0, 'a raw account id as a browser id gets a fresh guest, nothing more');
    await leaveAndWait(raw);
    const forged = await joinAs(port(), { playerId: 'p_forger', token: `forged:${acct}` });
    check(me(forged).damage === 0, 'a forged token gets a fresh guest, nothing more');
    await leaveAndWait(forged);
    const noid = await joinAs(port(), { playerId: 'p_noid', token: `noid:${acct}` });
    check(me(noid).damage === 0 && server.current.log.includes('carried no usable _id'), 'a 2xx without an _id does not verify');
    await leaveAndWait(noid);
    check((await joinRefused(port(), { playerId: 'p_bad', token: badToken })) === null, 'a rejected token still lets the player in as a guest');
  }

  console.log(`\n${kind}: sign-out and sign-in on the live session`);
  {
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    check(me(s).damage === ctx.accountTotal, 'reconnecting as the same account restores it');
    const out = await setAuth(s, null, 'guest');
    check(out.status === 'guest' && (await settled(s, (p) => p.damage === 0, 'fresh guest state')), 'logout -> guest, fresh because this browser was migrated');
    const guestBit = await earn(s, 0.8);
    const back = await setAuth(s, `valid:${acct}`, 'account');
    check(back.status === 'account' && (await settled(s, (p) => p.damage === ctx.accountTotal, 'account state')), 'signing back in restores the account');
    // The switch saved the guest it LEFT from live state before loading the account.
    const guest = await waitForProfile(reader, 'p_guest1', (p) => p.damage >= guestBit, 'the leaving guest save');
    check(guest.migratedTo === acctKey && guest.damage >= guestBit, 'the retired guest is not migrated a second time');
    check((await profileOf(reader, acctKey)).damage === ctx.accountTotal, 'guest play never reached the account');
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: the same account elsewhere`);
  {
    const other = await joinAs(port(), { playerId: 'p_browser2', token: `bare:${acct}` });
    check(me(other).damage === ctx.accountTotal, 'the same account on another browser sees the same progress');
    await leaveAndWait(other);
    check((await profileOf(reader, 'p_browser2')) === null, 'that browser gained no guest profile of its own');
  }

  console.log(`\n${kind}: an existing account is never overwritten`);
  {
    const g3 = await joinAs(port(), { playerId: 'p_guest3' });
    const t3 = await earn(g3);
    await leaveAndWait(g3);
    await waitForProfile(reader, 'p_guest3', (p) => p.damage >= t3, 'guest3 save');
    const s = await joinAs(port(), { playerId: 'p_guest3', token: `valid:${acct}` });
    check(me(s).damage === ctx.accountTotal, 'the account wins over the browser profile');
    const guest3 = await profileOf(reader, 'p_guest3');
    check(guest3.damage >= t3 && !guest3.migratedTo, 'the browser profile is left untouched and not retired');
    const out = await setAuth(s, null, 'guest');
    check(out.status === 'guest' && (await settled(s, (p) => p.damage === guest3.damage, 'guest3 state')), "logout returns that browser's own progress");
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: purchases`);
  {
    const first = await webhook(port(), { transactionId: 'tx-1', userId: acct, sku: 'yen_small', username: 'user_acct1' });
    check(first.status === 200 && first.body?.ok === true, 'the webhook answers 200 once the grant is recorded');
    const dup = await webhook(port(), { transactionId: 'tx-1', userId: acct, sku: 'yen_small' });
    check(dup.status === 200 && dup.body?.duplicate === true, 'a retried webhook is a duplicate, not a second payout');
    const impostor = await joinAs(port(), { playerId: acct });
    await sleep(400);
    check(me(impostor).yen === 0, 'a guest using the account id as a browser id is paid nothing');
    await leaveAndWait(impostor);
    const moneyBefore = (await profileOf(reader, acctKey)).yen;
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    await waitFor(() => me(s).yen === moneyBefore + 2500, 'the grant to be paid on join', 8000);
    pass('a recorded purchase is paid to the verified account on join (+25000)');
    await waitForProfile(reader, acctKey, (p) => p.yen === moneyBefore + 2500, 'account save with the grant');
    const settledGrant = await waitFor(async () => (await reader.readGrants())['tx-1']?.appliedAt ? true : null, 'tx-1 to be settled', 8000).catch(() => false);
    check(settledGrant === true, 'the grant is marked applied once the save landed');
    await leaveAndWait(s);

    const second = await webhook(port(), { transactionId: 'tx-2', userId: acct, sku: 'yen_large' });
    check(second.status === 200, 'a second purchase is recorded');
    await waitFor(async () => (await reader.readGrants())['tx-2'], 'tx-2 to be durable');
    await restart();
    const again = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    await waitFor(() => me(again).yen === moneyBefore + 2500 + 25000, 'the grant to survive the restart', 8000);
    pass('a purchase recorded before a restart is paid after it (+500000)');
    await waitForProfile(reader, acctKey, (p) => p.yen === moneyBefore + 2500 + 25000, 'account save after the restart grant');
    await leaveAndWait(again);
    ctx.accountMoney = moneyBefore + 2500 + 25000;
  }

  console.log(`\n${kind}: Bloxity unavailable`);
  {
    const s = await joinAs(port(), { playerId: 'p_outage', token: 'down:acct9' });
    check(me(s).damage === 0 && server.current.log.includes('bloxity unavailable, will re-ask'), 'a token Bloxity cannot answer for is let in as a guest and re-asked later');
    await leaveAndWait(s);
    const h = await joinAs(port(), { playerId: 'p_outage2', token: 'neterr:acct9' });
    check(me(h).damage === 0, 'a network error verifying is a guest too');
    await leaveAndWait(h);
  }

  console.log(`\n${kind}: a server restart loses nothing`);
  {
    const g = await joinAs(port(), { playerId: 'p_restart' });
    const t = await earn(g);
    await leaveAndWait(g);
    await waitForProfile(reader, 'p_restart', (p) => p.damage >= t, 'save before restart');
    const accountBefore = await profileOf(reader, acctKey);
    await restart();
    const again = await joinAs(port(), { playerId: 'p_restart' });
    check(me(again).damage >= t, 'a guest profile survives a server restart');
    await leaveAndWait(again);
    const s = await joinAs(port(), { playerId: 'p_browser2', token: `valid:${acct}` });
    check(me(s).damage === accountBefore.damage && me(s).yen === accountBefore.yen, 'an account profile survives a server restart');
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: the wrong game`);
  {
    await server.current.stop();
    server.current = await ctx.startServer({ slug: 'another-game' });
    const s = await joinAs(port(), { playerId: 'p_wrong', token: `valid:${acct}` });
    check(me(s).damage === 0 && server.current.log.includes('rejected (401 GAME_TOKEN_INVALID)'), 'a token for another game slug is rejected by the verify route');
    await leaveAndWait(s);
    await server.current.stop();
    server.current = await ctx.startServer();
  }

  ctx.server = server;
  return server;
};

/** JSON-only: the file on disk. */
const runJsonExtras = async (ctx, server) => {
  const { reader, dataDir } = ctx;
  console.log('\njson: a corrupt file is moved aside');
  {
    const before = await reader.readProfiles();
    await server.current.stop();
    const file = path.join(dataDir, 'profiles.json');
    const garbage = '{ this is not json' + readFileSync(file, 'utf8');
    writeFileSync(file, garbage);
    server.current = await ctx.startServer();
    const aside = readdirSync(dataDir).find((f) => f.startsWith('profiles.json.corrupt-'));
    check(Boolean(aside), 'the unreadable file is moved aside');
    check(aside && readFileSync(path.join(dataDir, aside), 'utf8') === garbage, 'the moved-aside file keeps its bytes intact');
    const g = await joinAs(port(server), { playerId: 'p_after_corrupt' });
    await earn(g, 0.6);
    await leaveAndWait(g);
    await waitForProfile(reader, 'p_after_corrupt', (p) => p.damage > 0, 'a save after the move-aside');
    check(!existsSync(path.join(dataDir, 'profiles.json.tmp')), 'no temp file is left behind');
    // Put the good data back for the log scan below to stay meaningful.
    await server.current.stop();
    writeFileSync(file, JSON.stringify(before));
    server.current = await ctx.startServer();
  }
};

const port = (server) => server.current.port;

/** Mongo-only: outages, the queued save, the legacy import. */
const runMongoExtras = async (ctx, server, mongod) => {
  const { reader } = ctx;
  const acct = 'acct1';
  const acctKey = accountKeyFor(acct);

  console.log('\nmongo: the database goes down');
  {
    step('outage: join as the account');
    const s = await joinAs(port(server), { playerId: 'p_browser2', token: `valid:${acct}` });
    const total = me(s).damage;
    // The sparring partner joins BEFORE the outage: nobody can join during one.
    const partner = await joinPartner(s);
    step('outage: stop mongod');
    await reader.close();
    await mongod.stop();
    check((await health(port(server)))?.ok === true, '/health still answers while the database is down');
    const code = await joinRefused(port(server), { playerId: 'p_during_outage' });
    check(code === 4105, `a join during the outage is REFUSED (code ${code}), never seated on a fresh profile`);
    step('outage: sign-out while down');
    const stay = await setAuth(s, null);
    const stayed = stay.status === 'account' && /staying/.test(stay.note ?? '') && me(s).damage === total;
    check(stayed, 'a sign-out that cannot reach storage stays on the account');
    if (!stayed) {
      note(`authState=${JSON.stringify(stay)} total=${total} now=${me(s).damage}`);
      for (const line of server.current.lines.slice(-12)) note(line);
    }
    step('outage: earn while down');
    const more = await earn(s, 0.8, partner);
    await partner.leave(true).catch(() => undefined);
    step('outage: leave while down');
    await leaveAndWait(s); // queues a save the database cannot take yet
    step('outage: restart mongod');
    await mongod.start();
    await reader.open();
    step('outage: wait for the queued save');
    const landed = await waitForProfile(reader, acctKey, (p) => p.damage >= more, 'the queued save to land once the database is back', 80_000);
    check(landed.damage >= more, 'a save made during the outage lands once the database is back');
    const again = await joinAs(port(server), { playerId: 'p_browser2', token: `valid:${acct}` });
    check(me(again).damage === landed.damage && me(again).yen === landed.yen && landed.yen >= ctx.accountMoney, 'everything is intact after the outage');
    const out = await setAuth(again, null, 'guest');
    const wentThrough = out.status === 'guest' && (await settled(again, (p) => p.damage === 0, 'guest after outage'));
    check(wentThrough, 'and the sign-out goes through now');
    if (!wentThrough) {
      note(`authState=${JSON.stringify(out)} now=${me(again).damage} guestDoc=${JSON.stringify(await profileOf(reader, 'p_browser2'))}`);
      for (const line of server.current.lines.slice(-12)) note(line);
    }
    await leaveAndWait(again);
  }

  console.log('\nmongo: the legacy JSON file is imported, insert-only');
  {
    const account = await profileOf(reader, acctKey);
    const legacy = {
      legacy_player: { ...ctx.guestProgress, damage: 777, yen: 7, displayName: 'Legacy', updatedAt: 1 },
      [acctKey]: { ...account, damage: 1, yen: 1, displayName: 'MUST NOT WIN', updatedAt: Date.now() + 1e9 },
    };
    writeFileSync(path.join(ctx.dataDir, 'profiles.json'), JSON.stringify(legacy));
    await server.current.stop();
    server.current = await ctx.startServer();
    await sleep(300);
    const imported = await profileOf(reader, 'legacy_player');
    check(imported?.damage === 777 && imported?.yen === 7, 'a profile only the legacy file knew is added');
    const kept = await profileOf(reader, acctKey);
    check(kept.damage === account.damage && kept.displayName !== 'MUST NOT WIN', 'an existing account profile is never overwritten by the import');
    check(server.current.log.includes('legacy import'), 'the import is logged');
  }
};

const scanLog = (label, log) => {
  const bad = log.split('\n').filter((line) => /UnhandledPromiseRejection|unhandledRejection|uncaughtException|TypeError|ReferenceError|RangeError/.test(line));
  check(bad.length === 0, `${label}: no unhandled errors in the server log`);
  for (const line of bad.slice(0, 10)) note(line);
};

// ------------------------------------------------------------- run

const run = async () => {
  const stamp = Date.now();
  const logs = [];

  // ---- JSON store (ONLY=mongo skips it while iterating on the Mongo half)
  if (process.env.ONLY !== 'mongo') {
    const dataDir = mkdtempSync(path.join(tmpdir(), `arena-json-${stamp}-`));
    const reader = new JsonReader(dataDir);
    const ctx = {
      kind: 'json',
      reader,
      dataDir,
      startServer: (overrides = {}) => startServer({ dataDir, ...overrides }),
    };
    console.log(`json store in ${dataDir}`);
    const server = await runSuite(ctx);
    await runJsonExtras(ctx, server);
    logs.push(['json', server.current.log]);
    await server.current.stop();
    scanLog('json', logs.map(([, l]) => l).join('\n'));
    rmSync(dataDir, { recursive: true, force: true });
  }

  // ---- Mongo store
  let mongod = null;
  let uri = process.env.MONGODB_URI ?? '';
  if (!uri) {
    const binary = findMongod();
    if (binary) {
      mongod = new Mongod(binary, mkdtempSync(path.join(tmpdir(), `tongue-mongod-${stamp}-`)), MONGO_PORT);
      console.log(`\nstarting mongod from ${binary}`);
      await mongod.start();
      uri = mongod.uri;
    }
  }
  if (!uri) {
    console.log('\nmongo: SKIPPED - set MONGODB_URI (it will be WIPED) or MONGOD_BIN to run the Mongo suite');
  } else {
    const dataDir = mkdtempSync(path.join(tmpdir(), `tongue-mongo-${stamp}-`));
    const reader = new MongoReader(uri);
    await reader.open();
    console.log(`\nWIPING the test database at ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
    await reader.wipe();
    const ctx = {
      kind: 'mongo',
      reader,
      dataDir,
      startServer: (overrides = {}) => startServer({ dataDir, mongoUri: uri, ...overrides }),
    };
    const server = await runSuite(ctx);
    if (mongod) await runMongoExtras(ctx, server, mongod);
    else console.log('\nmongo: outage tests SKIPPED (no local mongod to kill; MONGODB_URI points at a server this script does not own)');
    const log = server.current.log;
    await server.current.stop();
    await reader.close();
    scanLog('mongo', log);
    if (mongod) await mongod.stop();
    rmSync(dataDir, { recursive: true, force: true });
    if (mongod) rmSync(mongod.dbPath, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\npersistence OK' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('\npersistence: ABORTED -', error?.stack ?? error);
  process.exit(1);
});
