import { kitById, type KitId } from '@arena/shared';

/**
 * KIT PORTRAITS, drawn in code: the reference's look - a round badge with a
 * coloured speed-line burst, and the character as a black-and-white
 * silhouette (white face, black hair and shoulders) with the one or two
 * accessories that make them recognisable at a glance: a straw hat, a
 * headband, a blindfold, glasses, earrings, face marks.
 *
 * Every portrait is one cached canvas, shared by the walkway pedestals, the
 * inventory, the HUD and the unlock alert. No image files.
 */

const SIZE = 256;
const C = SIZE / 2;
const INK = '#0b0b10';
const FACE = '#ffffff';

const cache = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

export const kitPortrait = (id: string): HTMLCanvasElement => {
  const hit = cache.get(id);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  drawBadge(ctx, id);
  cache.set(id, canvas);
  return canvas;
};

/** The portrait as an image URL, for HTML. */
export const kitPortraitUrl = (id: string): string => {
  const hit = urls.get(id);
  if (hit) return hit;
  const url = kitPortrait(id).toDataURL('image/png');
  urls.set(id, url);
  return url;
};

const drawBadge = (ctx: CanvasRenderingContext2D, id: string): void => {
  const kit = kitById(id);
  const [a, b] = kit?.colors ?? ['#888888', '#222222'];
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, C - 6, 0, Math.PI * 2);
  ctx.clip();

  // The burst: a radial glow and alternating speed-line wedges.
  const glow = ctx.createRadialGradient(C, C * 0.95, 10, C, C, C);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.25, a);
  glow.addColorStop(1, b);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  const rays = 28;
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 0.7) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.lineTo(C + Math.cos(a0) * SIZE, C + Math.sin(a0) * SIZE);
    ctx.lineTo(C + Math.cos(a1) * SIZE, C + Math.sin(a1) * SIZE);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // A soft white ring inside the rim, like the reference's glow ring.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(C, C, C - 24, 0, Math.PI * 2);
  ctx.stroke();

  drawCharacter(ctx, id as KitId);
  ctx.restore();

  // The rim.
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(C, C, C - 6, 0, Math.PI * 2);
  ctx.stroke();
};

// ------------------------------------------------------------ primitives

/** Head centre and size: the face is an ellipse. */
const HX = C;
const HY = 128;
const RX = 40;
const RY = 50;

const shoulders = (ctx: CanvasRenderingContext2D, fill = INK, collar = false): void => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(HX - 108, SIZE);
  ctx.quadraticCurveTo(HX - 100, 196, HX - 30, 184);
  ctx.lineTo(HX + 30, 184);
  ctx.quadraticCurveTo(HX + 100, 196, HX + 108, SIZE);
  ctx.closePath();
  ctx.fill();
  // Neck.
  ctx.fillStyle = FACE;
  ctx.fillRect(HX - 17, 160, 34, 32);
  if (collar) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(HX - 34, 184);
    ctx.lineTo(HX, 214);
    ctx.lineTo(HX + 34, 184);
    ctx.lineTo(HX + 22, 182);
    ctx.lineTo(HX, 200);
    ctx.lineTo(HX - 22, 182);
    ctx.closePath();
    ctx.fill();
  }
};

const face = (ctx: CanvasRenderingContext2D): void => {
  ctx.fillStyle = FACE;
  ctx.beginPath();
  ctx.ellipse(HX, HY, RX, RY, 0, 0, Math.PI * 2);
  ctx.fill();
  // A jaw, slightly pointed, anime-style.
  ctx.beginPath();
  ctx.moveTo(HX - RX + 2, HY + 8);
  ctx.quadraticCurveTo(HX - 18, HY + RY + 8, HX, HY + RY + 10);
  ctx.quadraticCurveTo(HX + 18, HY + RY + 8, HX + RX - 2, HY + 8);
  ctx.fill();
};

/**
 * A crown of spikes round the top of the head, from angle a0 to a1 (radians,
 * 0 = right, -PI/2 = up). `len` is how far past the skull each spike reaches.
 */
const spikes = (
  ctx: CanvasRenderingContext2D,
  count: number,
  a0: number,
  a1: number,
  len: number,
  width: number,
  fill: string,
  stroke?: string,
  jitter = 0.35,
  cy = HY - 6,
): void => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  const rx = RX + 6;
  const ry = RY + 2;
  const base = (angle: number): [number, number] => [HX + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
  const start = base(a0);
  ctx.moveTo(HX, cy + 6);
  ctx.lineTo(start[0], start[1]);
  for (let i = 0; i < count; i += 1) {
    const t0 = a0 + ((a1 - a0) * i) / count;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / count;
    const mid = (t0 + t1) / 2 + Math.sin(i * 12.9898) * jitter * ((a1 - a0) / count);
    const reach = len * (0.75 + 0.35 * Math.abs(Math.sin(i * 7.13 + count)));
    const tipX = HX + Math.cos(mid) * (rx + reach);
    const tipY = cy + Math.sin(mid) * (ry + reach);
    const [ex, ey] = base(t1);
    ctx.lineTo(tipX + Math.cos(mid + Math.PI / 2) * width * 0.1, tipY);
    ctx.lineTo(ex, ey);
  }
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
};

/** Bangs: points hanging over the forehead. */
const bangs = (ctx: CanvasRenderingContext2D, count: number, depth: number, fill: string, stroke?: string, spread = 1): void => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  const left = HX - RX * 1.08 * spread;
  const right = HX + RX * 1.08 * spread;
  const top = HY - RY + 4;
  ctx.moveTo(left, HY - 4);
  ctx.quadraticCurveTo(left, top - 12, HX, top - 14);
  ctx.quadraticCurveTo(right, top - 12, right, HY - 4);
  for (let i = count; i >= 0; i -= 1) {
    const x = left + ((right - left) * i) / count;
    const tip = i % 2 === 0 ? HY - 30 + depth * (0.6 + 0.4 * Math.abs(Math.sin(i * 2.1))) : top + 6;
    ctx.lineTo(x, tip);
  }
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
};

const band = (ctx: CanvasRenderingContext2D, y: number, height: number, fill: string, plate?: string): void => {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(HX, HY, RX + 2, RY + 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(HX - RX - 4, y, RX * 2 + 8, height);
  ctx.restore();
  if (plate) {
    ctx.fillStyle = plate;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillRect(HX - 20, y + 1, 40, height - 2);
    ctx.strokeRect(HX - 20, y + 1, 40, height - 2);
  }
};

// ------------------------------------------------------------- characters

const drawCharacter = (ctx: CanvasRenderingContext2D, id: KitId): void => {
  switch (id) {
    case 'asta':
      shoulders(ctx, INK, true);
      spikes(ctx, 9, -Math.PI * 1.05, 0.05, 30, 20, '#f4f4f4', INK, 0.5);
      face(ctx);
      bangs(ctx, 8, 30, '#f4f4f4', INK);
      band(ctx, HY - 36, 13, INK);
      // The clover on the headband.
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc(HX + Math.cos((i * Math.PI) / 2) * 4, HY - 30 + Math.sin((i * Math.PI) / 2) * 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'ichigo':
      shoulders(ctx, INK, true);
      spikes(ctx, 11, -Math.PI * 1.08, 0.08, 34, 18, INK, undefined, 0.5);
      face(ctx);
      bangs(ctx, 9, 34, INK);
      break;
    case 'luffy': {
      shoulders(ctx, '#d62a2a');
      face(ctx);
      bangs(ctx, 7, 22, INK);
      // The straw hat.
      ctx.fillStyle = '#e8c56a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(HX, HY - 30, 86, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(HX - 44, HY - 34);
      ctx.bezierCurveTo(HX - 46, HY - 96, HX + 46, HY - 96, HX + 44, HY - 34);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d62a2a';
      ctx.fillRect(HX - 44, HY - 50, 88, 13);
      // The scar under the eye.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(HX - 24, HY + 8);
      ctx.lineTo(HX - 12, HY + 12);
      ctx.moveTo(HX - 20, HY + 5);
      ctx.lineTo(HX - 18, HY + 15);
      ctx.stroke();
      break;
    }
    case 'naruto':
      shoulders(ctx, '#ff8a1f');
      spikes(ctx, 12, -Math.PI * 1.12, 0.12, 38, 18, INK, undefined, 0.3);
      face(ctx);
      bangs(ctx, 9, 30, INK);
      band(ctx, HY - 40, 16, '#1f3b8a', '#cfd6e4');
      // The swirl on the plate, and the whisker marks.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(HX, HY - 32, 4, 0, Math.PI * 1.6);
      ctx.stroke();
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          ctx.beginPath();
          ctx.moveTo(HX + side * 20, HY + 12 + i * 6);
          ctx.lineTo(HX + side * 36, HY + 10 + i * 7);
          ctx.stroke();
        }
      }
      break;
    case 'jinwoo':
      shoulders(ctx, INK, true);
      spikes(ctx, 10, -Math.PI * 1.02, 0.02, 20, 14, INK, undefined, 0.6);
      face(ctx);
      bangs(ctx, 10, 36, INK, undefined, 1.02);
      // Glowing blue eyes.
      ctx.fillStyle = '#5ac8ff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(HX + side * 16, HY + 2, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'maki': {
      shoulders(ctx, INK);
      // The ponytail behind.
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(HX + 20, HY - 50);
      ctx.quadraticCurveTo(HX + 90, HY - 70, HX + 84, HY + 20);
      ctx.quadraticCurveTo(HX + 70, HY - 30, HX + 30, HY - 30);
      ctx.fill();
      spikes(ctx, 6, -Math.PI * 1.02, 0.02, 10, 14, INK, undefined, 0.2);
      face(ctx);
      bangs(ctx, 6, 26, INK);
      // The glasses.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(HX + side * 17, HY + 4, 12, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(HX - 5, HY + 4);
      ctx.lineTo(HX + 5, HY + 4);
      ctx.stroke();
      break;
    }
    case 'sasuke':
      shoulders(ctx, INK, true);
      // The swept-back spikes.
      spikes(ctx, 8, -Math.PI * 0.95, -Math.PI * 0.05, 44, 20, INK, undefined, 0.2, HY - 12);
      face(ctx);
      // Long bangs framing the face.
      ctx.fillStyle = INK;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + side * 8, HY - RY + 4);
        ctx.quadraticCurveTo(HX + side * 48, HY - 30, HX + side * 40, HY + 30);
        ctx.lineTo(HX + side * 30, HY - 10);
        ctx.closePath();
        ctx.fill();
      }
      bangs(ctx, 5, 18, INK, undefined, 0.8);
      break;
    case 'yuji':
      shoulders(ctx, INK, true);
      spikes(ctx, 9, -Math.PI * 1.02, 0.02, 20, 14, '#ff8fb0', INK, 0.4);
      face(ctx);
      bangs(ctx, 8, 18, '#ff8fb0', INK);
      // The undercut and the scar-like marks under the eyes.
      ctx.fillStyle = INK;
      ctx.fillRect(HX - RX - 2, HY - 26, 10, 22);
      ctx.fillRect(HX + RX - 8, HY - 26, 10, 22);
      break;
    case 'deku': {
      shoulders(ctx, '#1f6b4a');
      // Curly mop: many round bumps.
      ctx.fillStyle = INK;
      for (let i = 0; i < 14; i += 1) {
        const angle = -Math.PI * 1.1 + (i / 13) * Math.PI * 1.2;
        ctx.beginPath();
        ctx.arc(HX + Math.cos(angle) * (RX + 8), HY - 8 + Math.sin(angle) * (RY + 6), 17 + (i % 3) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      face(ctx);
      bangs(ctx, 8, 24, INK);
      // Freckles.
      ctx.fillStyle = INK;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          ctx.beginPath();
          ctx.arc(HX + side * (18 + i * 5), HY + 18 + (i % 2) * 3, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'killua':
      shoulders(ctx, '#2a3a6a', true);
      spikes(ctx, 12, -Math.PI * 1.12, 0.12, 30, 18, '#f4f6ff', INK, 0.6);
      face(ctx);
      bangs(ctx, 10, 30, '#f4f6ff', INK);
      break;
    case 'zoro':
      shoulders(ctx, '#1f5a2a', true);
      spikes(ctx, 10, -Math.PI * 1.02, 0.02, 10, 12, INK, undefined, 0.5);
      face(ctx);
      bangs(ctx, 7, 8, INK);
      // Three gold earrings on the left ear.
      ctx.fillStyle = '#ffd23d';
      for (let i = 0; i < 3; i += 1) {
        ctx.fillRect(HX - RX - 6, HY + 6 + i * 8, 4, 7);
      }
      // A green bandana knotted on the arm reads as a band here.
      ctx.fillStyle = '#2f8a3a';
      ctx.fillRect(HX + 64, 204, 30, 14);
      break;
    case 'tanjiro':
      shoulders(ctx, '#1a6a4a', true);
      // The checkered haori hint.
      ctx.fillStyle = '#0b0b10';
      for (let i = 0; i < 6; i += 1) ctx.fillRect(HX - 100 + i * 32 + (i % 2) * 6, 214 + (i % 2) * 12, 14, 14);
      spikes(ctx, 10, -Math.PI * 1.04, 0.04, 22, 14, INK, undefined, 0.5);
      face(ctx);
      bangs(ctx, 9, 26, INK);
      // The forehead scar and the hanafuda earrings.
      ctx.fillStyle = '#b3262e';
      ctx.fillRect(HX - 22, HY - 34, 16, 8);
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.fillRect(HX + side * (RX + 4) - 5, HY + 14, 10, 20);
        ctx.strokeRect(HX + side * (RX + 4) - 5, HY + 14, 10, 20);
        ctx.fillStyle = '#e03a2a';
        ctx.beginPath();
        ctx.arc(HX + side * (RX + 4), HY + 24, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'sukuna':
      shoulders(ctx, '#f0f0f0');
      ctx.fillStyle = INK;
      ctx.fillRect(HX - 60, 214, 120, 42);
      spikes(ctx, 11, -Math.PI * 1.02, 0.02, 30, 14, '#ff8fb0', INK, 0.5);
      face(ctx);
      bangs(ctx, 8, 14, '#ff8fb0', INK, 0.9);
      // The markings: lines under the eyes and the second pair of eyes.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + side * 10, HY + 10);
        ctx.lineTo(HX + side * 34, HY + 12);
        ctx.moveTo(HX + side * 10, HY + 16);
        ctx.lineTo(HX + side * 30, HY + 18);
        ctx.stroke();
        ctx.fillStyle = '#c21830';
        ctx.beginPath();
        ctx.ellipse(HX + side * 17, HY + 2, 6, 3, 0, 0, Math.PI * 2);
        ctx.ellipse(HX + side * 19, HY - 10, 5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'gojo':
      shoulders(ctx, INK, true);
      spikes(ctx, 11, -Math.PI * 1.1, 0.1, 40, 18, '#f4f6ff', INK, 0.4, HY - 14);
      face(ctx);
      bangs(ctx, 8, 16, '#f4f6ff', INK, 0.95);
      // The blindfold.
      band(ctx, HY - 12, 22, INK);
      break;
    case 'saitama': {
      shoulders(ctx, '#ffd23d');
      // The cape clasp.
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(HX + side * 44, 196, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      face(ctx);
      // The bald head's shine, and the famous blank look.
      ctx.fillStyle = 'rgba(200,210,230,0.9)';
      ctx.beginPath();
      ctx.ellipse(HX - 16, HY - 30, 12, 6, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(HX + side * 16, HY + 4, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(HX - 8, HY + 28);
      ctx.lineTo(HX + 8, HY + 28);
      ctx.stroke();
      break;
    }
  }
};
