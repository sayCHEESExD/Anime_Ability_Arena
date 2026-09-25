import type { Aabb } from '../types/math.js';

/**
 * THE WORLD LAYOUT: two floating islands over the sea.
 *
 *   SPAWN ISLAND (the lobby, z > -150): the player spawns at the plaza facing +Z
 *   down a short walkway lined with the fourteen unlockable kits on pedestals.
 *   The big white portal stands BEHIND the spawn (-Z), flanked by the Most Kills
 *   (-X) and Most Damage (+X) boards. Nobody can be hurt on the spawn island.
 *
 *   THE ARENA (z < -150): a wide ruined island of grass, sand and stone. Players
 *   fight freely; anyone who falls off, or is knocked off, dies.
 *
 * Every solid is an axis-aligned box that the server and the client both
 * collide against. `mat` is a VISUAL tag only: the client dresses a box by it.
 * There is no implicit ground - fall past every box and you keep falling.
 */

export type SolidMaterial =
  | 'sand'
  | 'grass'
  | 'path'
  | 'stone'
  | 'stoneDark'
  | 'pedestal'
  | 'trunk'
  | 'ruin'
  | 'invisible';

export interface Solid extends Aabb {
  readonly mat: SolidMaterial;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** Below this height a player has fallen off the world. */
export const KILL_Y = -42;
/** The sea surface (visual only). */
export const SEA_Y = -34;

/** Where a player appears on the spawn island, facing down the walkway (+Z). */
export const SPAWN: Placement = { x: 0, y: 0, z: 2, yaw: 0 };

/** The white portal, behind the spawn. Its disc faces +Z, toward the spawn. */
export const PORTAL = {
  x: 0,
  z: -26,
  /** Centre height of the disc. */
  centreY: 9.2,
  radius: 8.2,
  /** The trigger: step into the disc. */
  trigger: { minX: -7.2, maxX: 7.2, minY: -1, maxY: 16, minZ: -28, maxZ: -24.4 } as Aabb,
} as const;

/** The two boards beside the portal: Most Kills to the -X side, Most Damage to +X. */
export const BOARDS = {
  kills: { x: -21, z: -24 },
  damage: { x: 21, z: -24 },
  width: 15,
  height: 11,
  /** Height of the board's bottom edge. */
  bottom: 1.6,
  depth: 2.2,
} as const;

/** The pedestal that shows the local player's equipped kit, beside the Most Damage board. */
export const EQUIP_PEDESTAL = { x: 31, z: -13 } as const;

/** Walkway pedestals: seven down each side, cheapest furthest on the right. */
export const PEDESTAL = {
  firstZ: 17,
  spacing: 9,
  x: 13,
  half: 2.3,
  height: 2.4,
} as const;

/** Where kit pedestal `slot` stands. Slots 0..6 are the +X (right) side, 7..13 the -X (left) side. */
export const pedestalAt = (slot: number): { x: number; z: number; side: 1 | -1 } => {
  const right = slot < 7;
  const index = right ? slot : slot - 7;
  return { x: right ? -PEDESTAL.x : PEDESTAL.x, z: PEDESTAL.firstZ + index * PEDESTAL.spacing, side: right ? -1 : 1 };
};

/** Big blocky trees whose trunks arch over the walkway. */
export const WALK_TREES: readonly { x: number; z: number; lean: number }[] = [
  { x: -19, z: 25, lean: 1 },
  { x: 19, z: 34, lean: -1 },
  { x: -19, z: 52, lean: 1 },
  { x: 19, z: 61, lean: -1 },
  { x: -26, z: -8, lean: 1 },
  { x: 27, z: 0, lean: -1 },
];

/** The arena's middle, and half its width (the main field is 2 x half square). */
export const ARENA = { x: 0, z: -440, half: 140 } as const;

/** The four corner fortresses: a 10-high platform with an 18-high keep, linked by the bridge ring. */
export const ARENA_FORTS: readonly { x: number; z: number }[] = [
  { x: 90, z: 90 },
  { x: -90, z: 90 },
  { x: 90, z: -90 },
  { x: -90, z: -90 },
].map((f) => ({ x: ARENA.x + f.x, z: ARENA.z + f.z }));

/** Height of the fort platforms and of the bridge ring that joins them. */
export const RING_HEIGHT = 10;

/** The ruined columns in a ring round the ziggurat (some broken short). */
export const ARENA_COLUMNS: readonly { x: number; z: number; h: number }[] = [14, 7, 12, 5, 14, 9, 12, 6, 13, 8, 11, 5].map((h, i, all) => {
  const angle = (i / all.length) * Math.PI * 2 + Math.PI / 12;
  return { x: ARENA.x + Math.cos(angle) * 46, z: ARENA.z + Math.sin(angle) * 46, h };
});

/** Where a player lands in the arena: spread round the rim, facing the middle. */
export const ARENA_SPAWNS: readonly Placement[] = (
  [
    [0, 118],
    [0, -118],
    [118, 40],
    [118, -40],
    [-118, 40],
    [-118, -40],
  ] as const
).map(([dx, dz]) => ({ x: ARENA.x + dx, y: 0, z: ARENA.z + dz, yaw: Math.atan2(-dx, -dz) }));

export type Zone = 'lobby' | 'arena';

/** Which island a position belongs to. */
export const zoneAt = (_x: number, z: number): Zone => (z < -150 ? 'arena' : 'lobby');

export const inPortal = (x: number, y: number, z: number): boolean => {
  const t = PORTAL.trigger;
  return x >= t.minX && x <= t.maxX && y >= t.minY && y <= t.maxY && z >= t.minZ && z <= t.maxZ;
};

const box = (mat: SolidMaterial, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Solid => ({
  mat,
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ,
});

/** A centred box: centre x/z, size w/d, from y0 to y1. */
const cbox = (mat: SolidMaterial, x: number, z: number, w: number, d: number, y0: number, y1: number): Solid =>
  box(mat, x - w / 2, x + w / 2, y0, y1, z - d / 2, z + d / 2);

/**
 * A flight of stairs DESCENDING from a platform `rise` high whose edge is at
 * `edge`, stepping away in `dir` (along z, or along x when `alongX`), across
 * `fromA..toA`, down to a floor `base` high. Treads are 1 high - under the
 * step height - so it is walkable.
 */
const stairs = (mat: SolidMaterial, fromA: number, toA: number, edge: number, dir: 1 | -1, rise: number, run: number, alongX = false, base = 0): Solid[] => {
  const out: Solid[] = [];
  for (let i = 0; i < rise - 1 - base; i += 1) {
    const a = edge + dir * i * run;
    const b = a + dir * run;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const top = rise - 1 - i;
    // Each tread is a slab from the floor up, so the flight has no gaps under it.
    out.push(alongX ? box(mat, lo, hi, 0, top, fromA, toA) : box(mat, fromA, toA, 0, top, lo, hi));
  }
  return out;
};

let cached: Solid[] | null = null;

/** Every solid in the world. Built once; shared by the server and the client. */
export const buildStaticSolids = (): readonly Solid[] => {
  if (cached) return cached;
  const s: Solid[] = [];

  // ---------------------------------------------------------- spawn island
  // Plaza (portal + boards) and the walkway, one sandy top at y = 0.
  s.push(box('sand', -36, 36, -8, 0, -36, 8));
  s.push(box('sand', -22, 22, -8, 0, 8, 80));
  s.push(box('sand', -13, 13, -8, 0, 80, 88));
  // The paved strip down the middle of the walkway is a hair above the sand so the two never share a plane.
  s.push(box('path', -7, 7, -0.5, 0.02, 8, 80));

  // Portal frame: two stone pillars and a lintel.
  s.push(cbox('stone', PORTAL.x - 10.4, PORTAL.z, 3.4, 3.6, 0, 18));
  s.push(cbox('stone', PORTAL.x + 10.4, PORTAL.z, 3.4, 3.6, 0, 18));
  s.push(cbox('stone', PORTAL.x, PORTAL.z, 24.2, 3.6, 18, 20.4));
  // Nothing walks through the back of the portal: a thin slab behind the disc.
  s.push(cbox('invisible', PORTAL.x, PORTAL.z - 2.6, 17.4, 1, 0, 18));

  // The boards stand on stone footings.
  for (const board of [BOARDS.kills, BOARDS.damage]) {
    s.push(cbox('stone', board.x, board.z, BOARDS.width + 2.4, BOARDS.depth, 0, BOARDS.bottom + BOARDS.height + 1.2));
  }
  // The equipped-kit pedestal.
  s.push(cbox('pedestal', EQUIP_PEDESTAL.x, EQUIP_PEDESTAL.z, 5.6, 5.6, 0, 2.6));

  // Fourteen kit pedestals.
  for (let slot = 0; slot < 14; slot += 1) {
    const p = pedestalAt(slot);
    s.push(cbox('pedestal', p.x, p.z, PEDESTAL.half * 2, PEDESTAL.half * 2, 0, PEDESTAL.height));
  }
  // Tree trunks (their canopies are scenery overhead).
  for (const tree of WALK_TREES) s.push(cbox('trunk', tree.x, tree.z, 2.6, 2.6, 0, 9));

  // ------------------------------------------------------------- the arena
  // A wide field with four levels to fight on: the ground (0), the ziggurat's
  // tiers (4, 8, 12), the fort platforms and the bridge ring joining them (10),
  // and the keeps (18). Every level is reached by stairs; only the island's
  // edge is a drop.
  const ax = ARENA.x;
  const az = ARENA.z;
  const h = ARENA.half;
  s.push(box('grass', ax - h, ax + h, -10, 0, az - h, az + h));
  // Lobes, so the island's outline is not a plain square.
  s.push(box('grass', ax - 70, ax + 70, -10, 0, az - h - 30, az - h));
  s.push(box('grass', ax - 70, ax + 70, -10, 0, az + h, az + h + 30));
  s.push(box('sand', ax + h, ax + h + 30, -10, 0, az - 60, az + 60));
  s.push(box('sand', ax - h - 30, ax - h, -10, 0, az - 60, az + 60));

  // The central ziggurat: three tiers, the flights turning a quarter at each.
  s.push(box('stone', ax - 32, ax + 32, 0, 4, az - 32, az + 32));
  s.push(...stairs('stone', ax - 7, ax + 7, az + 32, 1, 4, 2));
  s.push(...stairs('stone', ax - 7, ax + 7, az - 32, -1, 4, 2));
  s.push(box('stone', ax - 20, ax + 20, 0, 8, az - 20, az + 20));
  s.push(...stairs('stone', az - 6, az + 6, ax + 20, 1, 8, 2, true, 4));
  s.push(...stairs('stone', az - 6, az + 6, ax - 20, -1, 8, 2, true, 4));
  s.push(box('ruin', ax - 9, ax + 9, 0, 12, az - 9, az + 9));
  s.push(...stairs('ruin', ax - 4, ax + 4, az + 9, 1, 12, 2, false, 8));
  s.push(...stairs('ruin', ax - 4, ax + 4, az - 9, -1, 12, 2, false, 8));

  // The four corner forts, each with a keep, and the flights up to them.
  for (const fort of ARENA_FORTS) {
    const sx = (fort.x > ax ? 1 : -1) as 1 | -1;
    const sz = (fort.z > az ? 1 : -1) as 1 | -1;
    s.push(cbox('stone', fort.x, fort.z, 36, 36, 0, RING_HEIGHT));
    // Up from the field: a flight descending toward the middle.
    // Off to the outer side, clear of the bridge that leaves the same face.
    s.push(...stairs('stone', fort.z + sz * 11 - 4, fort.z + sz * 11 + 4, fort.x - sx * 18, (-sx) as 1 | -1, RING_HEIGHT, 1.8, true));
    // The keep, and the flight up to it from the platform.
    s.push(cbox('ruin', fort.x, fort.z, 12, 12, 0, 18));
    // Toward the fort's outer edge, away from both bridges (they meet the inner faces).
    s.push(...stairs('ruin', fort.x - 3, fort.x + 3, fort.z + sz * 6, sz, 18, 1.7, false, RING_HEIGHT));
    // Merlons round the keep's roof.
    for (const [cx, cz] of [
      [-5.4, -5.4],
      [5.4, -5.4],
      [-5.4, 5.4],
      [5.4, 5.4],
    ] as const) {
      s.push(cbox('ruin', fort.x + cx, fort.z + cz, 1.2, 1.2, 18, 19.4));
    }
  }

  // The bridge ring at fort height, fort to fort, on pillars.
  const span = 72;
  const ring = 90;
  s.push(box('stone', ax - span, ax + span, RING_HEIGHT - 1, RING_HEIGHT, az + ring - 4, az + ring + 4));
  s.push(box('stone', ax - span, ax + span, RING_HEIGHT - 1, RING_HEIGHT, az - ring - 4, az - ring + 4));
  s.push(box('stone', ax + ring - 4, ax + ring + 4, RING_HEIGHT - 1, RING_HEIGHT, az - span, az + span));
  s.push(box('stone', ax - ring - 4, ax - ring + 4, RING_HEIGHT - 1, RING_HEIGHT, az - span, az + span));
  for (const t of [-36, 0, 36]) {
    s.push(cbox('ruin', ax + t, az + ring, 3, 3, 0, RING_HEIGHT - 1));
    s.push(cbox('ruin', ax + t, az - ring, 3, 3, 0, RING_HEIGHT - 1));
    s.push(cbox('ruin', ax + ring, az + t, 3, 3, 0, RING_HEIGHT - 1));
    s.push(cbox('ruin', ax - ring, az + t, 3, 3, 0, RING_HEIGHT - 1));
  }

  // Ruined columns round the ziggurat.
  for (const column of ARENA_COLUMNS) s.push(cbox('ruin', column.x, column.z, 2.6, 2.6, 0, column.h));

  // Broken arches on the diagonals.
  for (const [dx, dz] of [
    [58, 58],
    [-58, -58],
    [58, -58],
    [-58, 58],
  ] as const) {
    const cx = ax + dx;
    const cz = az + dz;
    s.push(cbox('ruin', cx - 5, cz, 2.6, 2.6, 0, 11));
    s.push(cbox('ruin', cx + 5, cz, 2.6, 2.6, 0, 11));
    s.push(cbox('ruin', cx, cz, 13, 2.6, 11, 13));
  }

  // Low cover walls between the ziggurat and the ring, and out on the rim.
  for (const t of [-1, 1]) {
    s.push(cbox('ruin', ax, az + t * 66, 16, 1.6, 0, 2.2));
    s.push(cbox('ruin', ax + t * 66, az, 1.6, 16, 0, 2.2));
    s.push(cbox('ruin', ax + 34, az + t * 112, 14, 1.6, 0, 2.2));
    s.push(cbox('ruin', ax - 34, az + t * 112, 14, 1.6, 0, 2.2));
  }

  cached = s;
  return cached;
};

/** A generous box the simulation clamps positions into; falling is handled by KILL_Y. */
export const worldBounds = (): Aabb => ({ minX: -800, maxX: 800, minY: -200, maxY: 400, minZ: -1000, maxZ: 400 });
