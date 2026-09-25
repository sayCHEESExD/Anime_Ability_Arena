import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { PALETTE } from '../config/worldVisuals.js';

/**
 * The world's surfaces, drawn on canvases at load: sand, grass, cliff rock,
 * slate brick, pale ruin blocks, flagstones, bark and leaves. A few KB of
 * code instead of megabytes of images, cached and shared.
 */

const cache = new Map<string, Texture>();

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

const make = (key: string, size: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, pixel = false): Texture => {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, seeded(key.length * 7919 + key.charCodeAt(0)));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  if (pixel) {
    texture.magFilter = NearestFilter;
  }
  cache.set(key, texture);
  return texture;
};

const shade = (hex: string, amount: number): string => {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (shift: number): number => Math.min(255, Math.max(0, ((n >> shift) & 255) + amount));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};

const speckle = (ctx: CanvasRenderingContext2D, rnd: () => number, size: number, count: number, base: string, spread: number, dot: number): void => {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = shade(base, Math.round((rnd() - 0.5) * spread));
    const s = dot * (0.5 + rnd());
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
};

export const arenaTextures = {
  /** Fine pale beach sand with soft ripples. */
  sand(): Texture {
    return make('sand', 256, (ctx, rnd) => {
      ctx.fillStyle = PALETTE.sand;
      ctx.fillRect(0, 0, 256, 256);
      speckle(ctx, rnd, 256, 2600, PALETTE.sand, 26, 2);
      ctx.strokeStyle = 'rgba(160,140,100,0.18)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        const y = rnd() * 256;
        ctx.moveTo(0, y);
        for (let x = 0; x <= 256; x += 32) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 6);
        ctx.stroke();
      }
    });
  },

  /** Roblox-style grass: a clean green with darker blades speckled through. */
  grass(): Texture {
    return make('grass', 256, (ctx, rnd) => {
      ctx.fillStyle = PALETTE.grass;
      ctx.fillRect(0, 0, 256, 256);
      speckle(ctx, rnd, 256, 1800, PALETTE.grass, 36, 3);
      ctx.strokeStyle = 'rgba(30,80,30,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 500; i += 1) {
        const x = rnd() * 256;
        const y = rnd() * 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 4);
        ctx.stroke();
      }
    });
  },

  /** Layered cliff rock for island sides. */
  cliff(): Texture {
    return make('cliff', 256, (ctx, rnd) => {
      ctx.fillStyle = PALETTE.cliff;
      ctx.fillRect(0, 0, 256, 256);
      let y = 0;
      while (y < 256) {
        const h = 14 + rnd() * 26;
        ctx.fillStyle = shade(PALETTE.cliff, Math.round((rnd() - 0.5) * 34));
        ctx.fillRect(0, y, 256, h);
        ctx.fillStyle = 'rgba(30,36,60,0.35)';
        ctx.fillRect(0, y + h - 3, 256, 3);
        let x = rnd() * 60;
        while (x < 256) {
          ctx.fillRect(x, y, 2, h);
          x += 40 + rnd() * 80;
        }
        y += h;
      }
      speckle(ctx, rnd, 256, 900, PALETTE.cliff, 30, 2);
    });
  },

  /** Slate-blue brick, the spawn island's stone. */
  stone(): Texture {
    return make('stone', 256, (ctx, rnd) => {
      ctx.fillStyle = shade(PALETTE.stone, -40);
      ctx.fillRect(0, 0, 256, 256);
      const rows = 8;
      const h = 256 / rows;
      for (let r = 0; r < rows; r += 1) {
        const offset = (r % 2) * 32;
        for (let x = -64 + offset; x < 256; x += 64) {
          ctx.fillStyle = shade(PALETTE.stone, Math.round((rnd() - 0.5) * 30));
          ctx.fillRect(x + 2, r * h + 2, 60, h - 4);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + 2, r * h + 2, 60, 3);
        }
      }
      speckle(ctx, rnd, 256, 700, PALETTE.stone, 30, 2);
    });
  },

  /** Big pale ruin blocks for columns, arches and walls. */
  ruin(): Texture {
    return make('ruin', 256, (ctx, rnd) => {
      ctx.fillStyle = shade(PALETTE.ruin, -46);
      ctx.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 4; r += 1) {
        const offset = (r % 2) * 64;
        for (let x = -128 + offset; x < 256; x += 128) {
          ctx.fillStyle = shade(PALETTE.ruin, Math.round((rnd() - 0.5) * 22));
          ctx.fillRect(x + 3, r * 64 + 3, 122, 58);
        }
      }
      // Cracks.
      ctx.strokeStyle = 'rgba(40,50,80,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i += 1) {
        let x = rnd() * 256;
        let y = rnd() * 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k += 1) {
          x += (rnd() - 0.5) * 30;
          y += rnd() * 20;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      speckle(ctx, rnd, 256, 600, PALETTE.ruin, 26, 2);
    });
  },

  /** Worn flagstones down the middle of the walkway. */
  path(): Texture {
    return make('path', 256, (ctx, rnd) => {
      ctx.fillStyle = shade(PALETTE.path, -40);
      ctx.fillRect(0, 0, 256, 256);
      for (let gx = 0; gx < 2; gx += 1) {
        for (let gy = 0; gy < 2; gy += 1) {
          ctx.fillStyle = shade(PALETTE.path, Math.round((rnd() - 0.5) * 20));
          ctx.fillRect(gx * 128 + 4, gy * 128 + 4, 120, 120);
        }
      }
      speckle(ctx, rnd, 256, 900, PALETTE.path, 24, 2);
    });
  },

  /** Dark, faintly purple bark. */
  bark(): Texture {
    return make('bark', 128, (ctx, rnd) => {
      ctx.fillStyle = PALETTE.trunk;
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 40; i += 1) {
        ctx.fillStyle = shade(PALETTE.trunk, Math.round((rnd() - 0.5) * 30));
        ctx.fillRect(rnd() * 128, 0, 2 + rnd() * 4, 128);
      }
    });
  },

  /** Blocky canopy leaves: a mottled deep green. */
  leaves(): Texture {
    return make('leaves', 128, (ctx, rnd) => {
      ctx.fillStyle = PALETTE.leaves;
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 260; i += 1) {
        ctx.fillStyle = shade(PALETTE.leaves, Math.round((rnd() - 0.5) * 40));
        const s = 4 + rnd() * 9;
        ctx.fillRect(rnd() * 128, rnd() * 128, s, s);
      }
    }, true);
  },

  /** Rippled sea. */
  sea(): Texture {
    return make('sea', 256, (ctx, rnd) => {
      ctx.fillStyle = '#3f8fd8';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i += 1) {
        ctx.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.12})`;
        ctx.lineWidth = 2;
        const x = rnd() * 256;
        const y = rnd() * 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 8, y - 3, x + 16 + rnd() * 10, y);
        ctx.stroke();
      }
    });
  },
};
