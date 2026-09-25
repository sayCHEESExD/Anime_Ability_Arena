import type { Game } from '../core/Game.js';
import type { GameLoop } from '../core/GameLoop.js';

/**
 * DEV-ONLY test harness (loaded by main.ts in debug builds only): drive the
 * game from the console or an automated browser, where requestAnimationFrame
 * is throttled. `__t.pause()` stops the loop so frames are stepped by hand;
 * `__t.try('gojo', 3, 16)` equips a kit, walks to the nearest arena fighter
 * and casts. Every request goes through the same network path as a player's.
 */
export const installHarness = (game: Game, loop: GameLoop): void => {
  // The harness reaches into private fields on purpose: it is a test tool.
  const g = game as unknown as Record<string, any>;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const step = async (frames: number): Promise<void> => {
    for (let i = 0; i < frames; i += 1) {
      game.update(1 / 60, performance.now());
      await wait(16);
    }
  };
  const remotes = (): [string, any][] => [...g['remotePlayers'].all()];
  const target = (): any => remotes().find(([, r]) => r.zone === 'arena' && !r.dead)?.[1] ?? null;
  const targetId = (): string | null => remotes().find(([, r]) => r.zone === 'arena' && !r.dead)?.[0] ?? null;
  const face = (): void => {
    const b = target();
    if (!b) return;
    const p = g['localPlayer'].position;
    g['input'].look.setYaw(Math.atan2(b.position.x - p.x, b.position.z - p.z));
  };
  const goto = async (dist = 3.5): Promise<void> => {
    const kb = g['input'].keyboard;
    for (let i = 0; i < 900; i += 1) {
      const b = target();
      if (!b) break;
      const p = g['localPlayer'].position;
      const dx = b.position.x - p.x;
      const dz = b.position.z - p.z;
      if (Math.hypot(dx, dz) < dist) break;
      g['input'].look.setYaw(Math.atan2(dx, dz));
      kb.held.forward = true;
      kb.held.jump = g['localPlayer'].horizontalSpeed < 5 && g['localPlayer'].stun <= 0;
      await step(1);
    }
    kb.held.forward = false;
    kb.held.jump = false;
    await step(5);
  };
  const ready = async (): Promise<boolean> => {
    for (let i = 0; i < 150; i += 1) {
      const id = targetId();
      const s = id ? g['network'].player(id) : null;
      if (s && !s.shield && s.stun <= 0 && !s.dead) return true;
      await step(3);
    }
    return false;
  };
  const kit = async (id: string, dist = 3.5): Promise<void> => {
    if (g['zone'] !== 'lobby') {
      g['network'].requestRespawn();
      await wait(500);
      await step(10);
    }
    g['network'].equipKit(id);
    await wait(400);
    await step(5);
    g['play']();
    await wait(500);
    await step(160);
    await goto(dist);
    face();
  };
  const cast = async (slot: number, frames: number, turn = 0): Promise<string> => {
    face();
    g['input'].look.setYaw(g['input'].look.yaw + turn);
    const b = target();
    const before = b?.hp;
    g['updateCasting'](slot === 1, slot === 2, slot === 3, g['localPlayer']);
    await step(frames);
    return `${g['kit'].id} slot ${slot}: target ${before} -> ${target()?.hp ?? 'down'}`;
  };
  const tryKit = async (id: string, slot: number, dist: number, frames = 60, turn = 0): Promise<string> => {
    if (g['kit'].id !== id || g['zone'] !== 'arena') await kit(id, dist);
    await ready();
    await goto(dist);
    while (g['ready'][slot] > g['clock']) await step(5);
    return cast(slot, frames, turn);
  };
  (window as unknown as { __t: unknown }).__t = {
    game,
    pause: () => loop.stop(),
    resume: () => loop.start(),
    step,
    goto,
    kit,
    cast,
    try: tryKit,
    target,
  };
};
