import { BOARDS, LEADERBOARD_SIZE, formatCount, visibleName } from '@arena/shared';
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three';
import { drawPortrait, portraitFor } from '../bloxity/Portraits.js';
import { maxTextureEdge } from '../config/device.js';
import type { LeaderboardSnapshot, NetLeaderEntry } from '../net/netTypes.js';
import { arenaTextures } from './ArenaTextures.js';
import { texturedBox } from './texturedBox.js';

type Category = 'kills' | 'damage';

const FONT = '"Fredoka", "Baloo 2", "Nunito", "Segoe UI", system-ui, sans-serif';
const PIXELS_PER_UNIT = 44;

/**
 * THE TWO BOARDS beside the portal, as the reference draws them: carved
 * slate tablets under a little stone roof, "MOST KILLS" and "MOST DAMAGE"
 * chiselled across the top in heavy italic caps, nine rows of "#1  name" with
 * the figure under each name. The stone footing is a world solid; this draws
 * the face, the roof and the text (redrawn only when the standings change).
 */
export class Boards {
  readonly root = new Group();
  private readonly faces: BoardFace[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];

  constructor() {
    const stone = new MeshLambertMaterial({ map: arenaTextures.stone() });
    const dark = new MeshLambertMaterial({ map: arenaTextures.stone(), color: 0x9aa4c4 });
    this.materials.push(stone, dark);

    const specs: { category: Category; heading: string; at: { x: number; z: number } }[] = [
      { category: 'kills', heading: 'MOST KILLS', at: BOARDS.kills },
      { category: 'damage', heading: 'MOST DAMAGE', at: BOARDS.damage },
    ];
    for (const spec of specs) {
      const group = new Group();
      group.position.set(spec.at.x, 0, spec.at.z);
      const top = BOARDS.bottom + BOARDS.height + 1.2;
      // The roof: two overhanging slabs, the upper one narrower.
      group.add(this.box(dark, 0, top + 0.5, 0, BOARDS.width + 5, 1, BOARDS.depth + 2.4));
      group.add(this.box(stone, 0, top + 1.4, 0, BOARDS.width + 2, 0.8, BOARDS.depth + 1.2));
      // Side pillars.
      for (const side of [-1, 1]) {
        group.add(this.box(dark, side * (BOARDS.width / 2 + 1.6), top / 2, 0.4, 1.4, top, BOARDS.depth + 0.4));
      }
      const face = new BoardFace(spec.category, spec.heading, BOARDS.width, BOARDS.height);
      face.mesh.position.set(0, BOARDS.bottom + BOARDS.height / 2 + 0.6, BOARDS.depth / 2 + 0.03);
      group.add(face.mesh);
      this.faces.push(face);
      this.root.add(group);
    }
  }

  update(board: LeaderboardSnapshot | null): void {
    if (!board) return;
    for (const face of this.faces) face.apply(board[face.category]);
  }

  dispose(): void {
    for (const face of this.faces) face.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }

  private box(material: MeshLambertMaterial, x: number, y: number, z: number, w: number, h: number, d: number): Mesh {
    const geometry = texturedBox(w, h, d, 4);
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

class BoardFace {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private signature = '-';
  private stone: HTMLCanvasElement | null = null;

  constructor(
    readonly category: Category,
    private readonly heading: string,
    width: number,
    height: number,
  ) {
    this.canvas = document.createElement('canvas');
    const scale = Math.min(PIXELS_PER_UNIT, maxTextureEdge() / Math.max(width, height));
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.geometry = new PlaneGeometry(width, height);
    this.material = new MeshBasicMaterial({ map: this.texture });
    this.mesh = new Mesh(this.geometry, this.material);
    this.draw([]);
  }

  apply(rows: readonly NetLeaderEntry[]): void {
    const signature = rows.map((row) => `${row.handle}:${row.name}:${row.avatarUrl}:${row.value}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.draw(rows);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }

  /** The slate behind the text, drawn once. */
  private background(width: number, height: number): HTMLCanvasElement {
    if (this.stone) return this.stone;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#7486b0');
    gradient.addColorStop(1, '#56668e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    // Faint brick courses.
    ctx.strokeStyle = 'rgba(30,40,70,0.25)';
    ctx.lineWidth = 2;
    const course = height / 9;
    for (let r = 1; r < 9; r += 1) {
      ctx.beginPath();
      ctx.moveTo(0, r * course);
      ctx.lineTo(width, r * course);
      ctx.stroke();
      for (let x = ((r % 2) * width) / 8; x < width; x += width / 4) {
        ctx.beginPath();
        ctx.moveTo(x, (r - 1) * course);
        ctx.lineTo(x, r * course);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(20,26,50,0.6)';
    ctx.lineWidth = width * 0.014;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
    this.stone = canvas;
    return canvas;
  }

  private draw(rows: readonly NetLeaderEntry[]): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.drawImage(this.background(width, height), 0, 0);

    const pad = width * 0.05;
    const headerH = height * 0.17;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    let size = headerH * 0.7;
    ctx.font = `italic 800 ${size}px ${FONT}`;
    const measured = ctx.measureText(this.heading).width;
    if (measured > width - pad * 2) size *= (width - pad * 2) / measured;
    ctx.font = `italic 800 ${size}px ${FONT}`;
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = '#1b2238';
    ctx.strokeText(this.heading, width / 2, headerH * 0.58);
    ctx.fillStyle = '#eef2ff';
    ctx.fillText(this.heading, width / 2, headerH * 0.58);

    const rowH = (height - headerH - pad * 0.4) / LEADERBOARD_SIZE;
    const unit = this.category === 'kills' ? 'Kills' : 'Damage';
    if (!rows.some((row) => row && row.handle)) {
      ctx.font = `italic 700 ${rowH * 0.5}px ${FONT}`;
      ctx.fillStyle = 'rgba(235,240,255,0.8)';
      ctx.fillText('No fighters yet - be the first!', width / 2, headerH + rowH * 1.5);
      this.texture.needsUpdate = true;
      return;
    }
    for (let i = 0; i < LEADERBOARD_SIZE; i += 1) {
      const row = rows[i];
      if (!row || !row.handle) continue;
      const top = headerH + rowH * i;
      const centre = top + rowH * 0.42;
      const rankSize = rowH * 0.56;
      ctx.textAlign = 'left';
      ctx.font = `italic 800 ${rankSize}px ${FONT}`;
      ctx.lineWidth = rankSize * 0.16;
      ctx.strokeStyle = '#1b2238';
      const rank = `#${i + 1}`;
      ctx.strokeText(rank, pad, centre);
      ctx.fillStyle = i === 0 ? '#ffd84a' : i === 1 ? '#e2e8f2' : i === 2 ? '#ffae5a' : '#c9d3ee';
      ctx.fillText(rank, pad, centre);

      const faceSize = rowH * 0.72;
      const faceX = pad + width * 0.12;
      const face = row.avatarUrl
        ? portraitFor(row.avatarUrl, () => {
            this.signature = '-';
          })
        : null;
      if (face) drawPortrait(ctx, face, faceX, top + rowH * 0.5, faceSize);
      const nameX = faceX + faceSize + width * 0.02;

      const name = visibleName(row.name);
      let nameSize = rowH * 0.5;
      ctx.font = `italic 800 ${nameSize}px ${FONT}`;
      const room = width - nameX - pad;
      const w = ctx.measureText(name).width;
      if (w > room) nameSize *= room / w;
      ctx.font = `italic 800 ${nameSize}px ${FONT}`;
      ctx.lineWidth = nameSize * 0.16;
      ctx.strokeText(name, nameX, top + rowH * 0.36);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, nameX, top + rowH * 0.36);

      const value = `${formatCount(row.value)} ${unit}`;
      ctx.font = `italic 700 ${rowH * 0.3}px ${FONT}`;
      ctx.fillStyle = 'rgba(230,236,255,0.85)';
      ctx.fillText(value, nameX, top + rowH * 0.74);
    }
    this.texture.needsUpdate = true;
  }
}
