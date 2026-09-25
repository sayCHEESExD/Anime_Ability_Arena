import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Every world texture, drawn at runtime on a canvas: studded toy plates,
 * checkered stone, cliff dirt, the lava and the treadmill belt. No image files,
 * a few kilobytes of code, cached and shared.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /**
   * A STUD PLATE: two by two square studs, each a raised square with a round
   * stud on it, lit from the top-left. The reference's floor, walls and stage.
   */
  studs(base: string, dark: string, light: string): Texture {
    return this.cached(`studs:${base}:${dark}:${light}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const cell = size / 2;
      for (let cx = 0; cx < 2; cx += 1) {
        for (let cy = 0; cy < 2; cy += 1) drawStud(ctx, cx * cell, cy * cell, cell, base, dark, light);
      }
      return ctx.canvas;
    });
  }

  /**
   * THE SPAWN STUD PLATE in any colour: exactly the hub floor's pattern
   * (`studs`), with its dark and light edges derived the way the hub's are
   * (about 25 below and above the base). Every stylised surface in the world
   * wears this, so the whole map reads as one studded toy set.
   */
  stud(color: number | string): Texture {
    const base = typeof color === 'number' ? color : parseInt(color.replace('#', ''), 16);
    const channel = (value: number, shift: number, amount: number): number =>
      Math.min(255, Math.max(0, ((value >> shift) & 255) + amount));
    const css = (amount: number): string =>
      '#' + [16, 8, 0].map((shift) => channel(base, shift, amount).toString(16).padStart(2, '0')).join('');
    return this.studs(css(0), css(-26), css(25));
  }

  /**
   * THE NEUTRAL STUD PLATE: near-white studs, tinted per part by vertex
   * colour, so every studded surface in the world can share one material.
   */
  neutralStuds(): Texture {
    return this.studs('#f2f2f2', '#c4c4c4', '#ffffff');
  }

  /**
   * THE PLAZA TILE: a white square tile with a pale-blue chevron, the spawn
   * floor of the reference. One tile per repeat.
   */
  plazaTiles(base: string, line: string, chevron: string): Texture {
    return this.cached(`plaza:${base}:${line}:${chevron}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = chevron;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      for (const [cx, cy] of [
        [32, 40],
        [96, 104],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 8);
        ctx.lineTo(cx, cy + 8);
        ctx.lineTo(cx + 16, cy - 8);
        ctx.stroke();
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, size - 4, size - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(4, 4, size - 8, 3);
      return ctx.canvas;
    });
  }

  /** TATAMI: woven straw with a dark green border, for the Dojo Zone. */
  tatami(): Texture {
    return this.cached('tatami', () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = '#d9cf8f';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(120,110,50,0.35)';
      ctx.lineWidth = 1;
      for (let y = 2; y < size; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      ctx.fillStyle = '#2f5a2a';
      ctx.fillRect(0, 0, size, 8);
      ctx.fillRect(0, size - 8, size, 8);
      return ctx.canvas;
    });
  }

  /** A glowing rune circle, for the Cultist Zone floor and the portals. */
  runeCircle(color: string): Texture {
    return this.cached(`rune:${color}`, () => {
      const size = 256;
      const ctx = context(size);
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(128, 128, 118, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(128, 128, 96, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 5; i += 1) {
        const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        const x = 128 + Math.cos(a) * 92;
        const y = 128 + Math.sin(a) * 92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      return ctx.canvas;
    }, false);
  }

  /** CHECKERED plates: alternating shades, still studded. Islands and decks. */
  checker(a: string, b: string, dark: string, light: string): Texture {
    return this.cached(`checker:${a}:${b}:${dark}:${light}`, () => {
      const size = 128;
      const ctx = context(size);
      const cell = size / 2;
      for (let cx = 0; cx < 2; cx += 1) {
        for (let cy = 0; cy < 2; cy += 1) {
          const base = (cx + cy) % 2 === 0 ? a : b;
          ctx.fillStyle = base;
          ctx.fillRect(cx * cell, cy * cell, cell, cell);
          drawStud(ctx, cx * cell, cy * cell, cell, base, dark, light);
        }
      }
      return ctx.canvas;
    });
  }

  /** CLIFF DIRT: red-brown blocks with darker pits, studded. */
  dirt(base: string, dark: string): Texture {
    return this.cached(`dirt:${base}:${dark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const random = seeded(0xd1a7);
      for (let i = 0; i < 30; i += 1) {
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.08)' : dark;
        const s = 4 + random() * 8;
        ctx.fillRect(random() * size, random() * size, s, s);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 3;
      for (let y = 0; y <= size; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      return ctx.canvas;
    });
  }

  /**
   * THE LAVA: bright cells of molten orange separated by darker crust, with hot
   * yellow cores. The material scrolls it and pulses its glow.
   */
  lava(base: string, hot: string, crust: string): Texture {
    return this.cached(`lava:${base}:${hot}:${crust}`, () => {
      const size = 256;
      const ctx = context(size);
      ctx.fillStyle = crust;
      ctx.fillRect(0, 0, size, size);
      const random = seeded(0x1a7a);
      // Cells: rounded blobs on a jittered grid, drawn so they tile.
      const step = 42;
      for (let gx = -1; gx <= size / step; gx += 1) {
        for (let gy = -1; gy <= size / step; gy += 1) {
          const x = gx * step + random() * 14;
          const y = gy * step + random() * 14;
          const r = 15 + random() * 6;
          for (const [ox, oy] of [
            [0, 0],
            [size, 0],
            [0, size],
            [size, size],
          ] as const) {
            const grad = ctx.createRadialGradient(x + ox, y + oy, 2, x + ox, y + oy, r);
            grad.addColorStop(0, hot);
            grad.addColorStop(0.55, base);
            grad.addColorStop(1, base);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(x + ox, y + oy, r, r * 0.85, random(), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      return ctx.canvas;
    });
  }

  /** TREADMILL BELT: chevrons on dark rubber. The material scrolls it. */
  belt(base: string, mark: string): Texture {
    return this.cached(`belt:${base}:${mark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = mark;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 9;
      for (let i = -size; i < size * 2; i += 34) {
        ctx.beginPath();
        ctx.moveTo(i, size);
        ctx.lineTo(i + size / 2, size / 2);
        ctx.lineTo(i, 0);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, size, 5);
      ctx.fillRect(0, size - 5, size, 5);
      return ctx.canvas;
    });
  }

  /** A white floor chevron, for the arrows that point the way. */
  chevron(): Texture {
    return this.cached('chevron', () => {
      const size = 128;
      const ctx = context(size);
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 22;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(18, 96);
      ctx.lineTo(64, 40);
      ctx.lineTo(110, 96);
      ctx.stroke();
      return ctx.canvas;
    }, false);
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement, repeat = true): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    if (repeat) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }
}

/** One stud cell: a bevelled square with a round stud on it. */
const drawStud = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  base: string,
  dark: string,
  light: string,
): void => {
  const inset = cell * 0.08;
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + cell - inset, cell, inset);
  ctx.fillRect(x + cell - inset, y, inset, cell);
  ctx.fillStyle = light;
  ctx.fillRect(x, y, cell, inset * 0.6);
  ctx.fillRect(x, y, inset * 0.6, cell);
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  const r = cell * 0.26;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx + r * 0.12, cy + r * 0.16, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = light;
  ctx.lineWidth = cell * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();
};

/** The one texture set the whole world shares, so a stud is the same stud everywhere. */
export const worldTextures = new WorldTextures();

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};

/** Deterministic PRNG, so every client draws exactly the same world. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
