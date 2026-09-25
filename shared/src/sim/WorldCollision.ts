import { buildStaticSolids, worldBounds } from '../config/map.js';
import { MOVEMENT } from '../config/movement.js';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../constants/world.js';
import type { Aabb } from '../types/math.js';

/** Grid cell for the broad phase, in world units. */
const BROAD = 16;
const EPS = 1e-4;
/** What `floorBelow` answers over open air. */
export const NO_FLOOR = -1e6;

/**
 * THE WORLD AS THE SIMULATION SEES IT: axis-aligned boxes, shared by the
 * server (authority) and the client (prediction), so the two collide against
 * the exact same shapes. There is NO implicit ground: the islands float, and
 * off their edges a player falls.
 */
export class WorldCollision {
  private readonly solids: Aabb[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly bounds: Aabb;
  private readonly seen: number[] = [];
  private stamp = 1;
  private readonly marks: number[] = [];

  constructor() {
    for (const box of buildStaticSolids()) this.add(box);
    this.bounds = worldBounds();
  }

  /** Every static solid, for diagnostics and the verification scripts. */
  get boxes(): readonly Aabb[] {
    return this.solids;
  }

  private add(box: Aabb): void {
    const index = this.solids.length;
    this.solids.push(box);
    this.marks.push(0);
    for (let cx = Math.floor(box.minX / BROAD); cx <= Math.floor(box.maxX / BROAD); cx += 1) {
      for (let cz = Math.floor(box.minZ / BROAD); cz <= Math.floor(box.maxZ / BROAD); cz += 1) {
        const key = cellKey(cx, cz);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(index);
      }
    }
  }

  /** Candidate solids overlapping an XZ rectangle, each once. Reuses one array. */
  private query(minX: number, maxX: number, minZ: number, maxZ: number): readonly number[] {
    const out = this.seen;
    out.length = 0;
    this.stamp += 1;
    for (let cx = Math.floor(minX / BROAD); cx <= Math.floor(maxX / BROAD); cx += 1) {
      for (let cz = Math.floor(minZ / BROAD); cz <= Math.floor(maxZ / BROAD); cz += 1) {
        const list = this.grid.get(cellKey(cx, cz));
        if (!list) continue;
        for (const index of list) {
          if (this.marks[index] === this.stamp) continue;
          this.marks[index] = this.stamp;
          const b = this.solids[index]!;
          if (b.maxX <= minX || b.minX >= maxX || b.maxZ <= minZ || b.minZ >= maxZ) continue;
          out.push(index);
        }
      }
    }
    return out;
  }

  /** True when a player box standing at (x, y, z) overlaps any solid. */
  blocked(x: number, y: number, z: number): boolean {
    const r = PLAYER_RADIUS;
    for (const index of this.query(x - r, x + r, z - r, z + r)) {
      const b = this.solids[index]!;
      if (b.maxY > y + EPS && b.minY < y + PLAYER_HEIGHT - EPS) return true;
    }
    return false;
  }

  /** Move horizontally along one axis, stepping up low faces and stopping at walls. */
  moveAxis(axis: 'x' | 'z', x: number, y: number, z: number, delta: number, out: { value: number; y: number; hit: boolean }): void {
    out.y = y;
    out.hit = false;
    const r = PLAYER_RADIUS;
    let nx = axis === 'x' ? x + delta : x;
    let nz = axis === 'z' ? z + delta : z;
    let ny = y;

    for (let pass = 0; pass < 3; pass += 1) {
      let collided = false;
      for (const index of this.query(nx - r, nx + r, nz - r, nz + r)) {
        const b = this.solids[index]!;
        if (b.maxY <= ny + EPS || b.minY >= ny + PLAYER_HEIGHT - EPS) continue;
        const rise = b.maxY - ny;
        if (rise <= MOVEMENT.stepHeight && !this.blocked(nx, b.maxY, nz)) {
          ny = b.maxY;
          collided = true;
          break;
        }
        if (axis === 'x') nx = delta > 0 ? b.minX - r - EPS : b.maxX + r + EPS;
        else nz = delta > 0 ? b.minZ - r - EPS : b.maxZ + r + EPS;
        out.hit = true;
        collided = true;
        break;
      }
      if (!collided) break;
    }

    // Never let the step or the push leave the player further than asked.
    if (axis === 'x') {
      if ((delta > 0 && nx < x) || (delta < 0 && nx > x)) nx = x;
    } else if ((delta > 0 && nz < z) || (delta < 0 && nz > z)) nz = z;

    out.value = axis === 'x' ? nx : nz;
    out.y = ny;
  }

  /** The highest floor under the footprint at or below `y + tolerance`, or NO_FLOOR over open air. */
  floorBelow(x: number, y: number, z: number, tolerance = EPS): number {
    const r = PLAYER_RADIUS * 0.92;
    let floor = NO_FLOOR;
    for (const index of this.query(x - r, x + r, z - r, z + r)) {
      const b = this.solids[index]!;
      if (b.maxY <= y + tolerance && b.maxY > floor) floor = b.maxY;
    }
    return floor;
  }

  /** The lowest underside above the player's head, where a jump or launch stops. */
  ceilingAbove(x: number, y: number, z: number): number {
    const r = PLAYER_RADIUS * 0.92;
    let ceiling = Infinity;
    for (const index of this.query(x - r, x + r, z - r, z + r)) {
      const b = this.solids[index]!;
      if (b.minY >= y + PLAYER_HEIGHT - EPS && b.minY - PLAYER_HEIGHT < ceiling) ceiling = b.minY - PLAYER_HEIGHT;
    }
    return ceiling;
  }

  /**
   * How far along the segment a -> b is clear of every solid, 0..1. For the
   * chase camera and for line-of-sight checks.
   */
  segmentClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    let best = 1;
    for (const index of this.query(Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz))) {
      const b = this.solids[index]!;
      let t0 = 0;
      let t1 = best;
      const slab = (origin: number, delta: number, min: number, max: number): boolean => {
        if (Math.abs(delta) < 1e-9) return origin >= min && origin <= max;
        let near = (min - origin) / delta;
        let far = (max - origin) / delta;
        if (near > far) [near, far] = [far, near];
        if (near > t0) t0 = near;
        if (far < t1) t1 = far;
        return t0 <= t1;
      };
      if (!slab(ax, dx, b.minX, b.maxX) || !slab(ay, dy, b.minY, b.maxY) || !slab(az, dz, b.minZ, b.maxZ)) continue;
      if (t0 > 0 && t0 < best) best = t0;
    }
    return best;
  }

  /** True when a point is inside any solid (projectiles). */
  pointSolid(x: number, y: number, z: number): boolean {
    for (const index of this.query(x - 0.01, x + 0.01, z - 0.01, z + 0.01)) {
      const b = this.solids[index]!;
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  /** Keep a position inside the world, whatever displacement produced it. */
  clampToBounds(position: { x: number; z: number }): void {
    const r = PLAYER_RADIUS;
    const b = this.bounds;
    if (position.x < b.minX + r) position.x = b.minX + r;
    if (position.x > b.maxX - r) position.x = b.maxX - r;
    if (position.z < b.minZ + r) position.z = b.minZ + r;
    if (position.z > b.maxZ - r) position.z = b.maxZ - r;
  }
}

const cellKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
