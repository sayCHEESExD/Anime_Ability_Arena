/**
 * A SPARRING BOT for manual testing: joins the room, walks through into the
 * arena, and stands (or, with MODE=fight, chases and punches) the nearest
 * other fighter. Run it beside `npm run dev` to have someone to hit.
 *
 *   node scripts/bot.mjs            # one idle target dummy
 *   MODE=fight COUNT=3 node scripts/bot.mjs
 *   X=0 Z=-300 node scripts/bot.mjs # stand at a spot in the arena
 */
import { Client } from 'colyseus.js';
import * as S from '../shared/dist/index.js';

const ENDPOINT = process.env.ENDPOINT ?? 'ws://localhost:2601';
const COUNT = Number(process.env.COUNT ?? 1);
const MODE = process.env.MODE ?? 'idle';
const HOME = { x: Number(process.env.X ?? S.ARENA.x + 20), z: Number(process.env.Z ?? S.ARENA.z + 104) };

const spawn = async (index) => {
  const client = new Client(ENDPOINT);
  const room = await client.joinOrCreate(S.ROOM_NAME, {
    playerId: `bot-${index}-${Date.now().toString(36)}`,
    identity: { displayName: `Sparring Bot ${index + 1}`, avatarUrl: '' },
  });
  for (const type of Object.values(S.MessageType)) room.onMessage(type, () => undefined);
  let seq = 0;
  let nextSwing = 0;
  const self = () => room.state.players.get(room.sessionId);
  setInterval(() => {
    const me = self();
    if (!me) return;
    seq += 1;
    const message = { seq, dt: 1 / 60, moveX: 0, moveZ: 0, cameraYaw: 0 };
    if (me.zone === 'lobby' && !me.dead) {
      room.send(S.MessageType.EnterArena, {});
    } else if (me.zone === 'arena' && !me.dead && me.stun <= 0) {
      let goal = HOME;
      let target = null;
      if (MODE === 'fight') {
        let best = 60;
        for (const [id, p] of room.state.players) {
          if (id === room.sessionId || p.zone !== 'arena' || p.dead) continue;
          const d = Math.hypot(p.x - me.x, p.z - me.z);
          if (d < best) {
            best = d;
            target = p;
          }
        }
        if (target) goal = target;
      }
      const dx = goal.x - me.x;
      const dz = goal.z - me.z;
      const d = Math.hypot(dx, dz);
      message.cameraYaw = Math.atan2(dx, dz);
      message.moveZ = d > (target ? 3.5 : 1.5) ? 1 : 0;
      if (target && d < 5 && Date.now() > nextSwing) {
        nextSwing = Date.now() + 700;
        message.act = S.ACT.attack;
        message.aim = message.cameraYaw;
      }
    }
    room.send(S.MessageType.Move, message);
  }, 1000 / 60);
  console.log(`bot ${index + 1} joined as ${room.sessionId}`);
};

for (let i = 0; i < COUNT; i += 1) await spawn(i);
