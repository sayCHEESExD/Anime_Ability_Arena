import {
  ARENA,
  ARENA_COLUMNS,
  ARENA_FORTS,
  EQUIP_PEDESTAL,
  KITS,
  PEDESTAL,
  PORTAL,
  SEA_Y,
  WALK_TREES,
  WorldCollision,
  buildStaticSolids,
  formatYen,
  kitById,
  pedestalAt,
  type Solid,
} from '@arena/shared';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';
import { kitPortrait } from '../ui/KitPortraits.js';
import type { LeaderboardSnapshot } from '../net/netTypes.js';
import { arenaTextures } from './ArenaTextures.js';
import { Boards } from './Boards.js';
import { Sky } from './Sky.js';
import { texturedBox } from './texturedBox.js';

type Layer = 'sand' | 'grass' | 'cliff' | 'stone' | 'ruin' | 'path' | 'bark' | 'leaves' | 'leavesDark' | 'sandPatch' | 'rock' | 'bush' | 'banner';

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

/**
 * EVERYTHING STATIC: both islands, the sea, the trees, the portal, the kit
 * pedestals and the boards. Every solid comes from the shared map (the same
 * boxes the simulation collides with); dressing is added around them and
 * merged by material, so the whole world is a few dozen draw calls.
 */
export class World {
  readonly root = new Group();
  readonly collision = new WorldCollision();
  readonly boards = new Boards();
  private readonly sky = new Sky();
  private readonly parts = new Map<Layer, BufferGeometry[]>();
  private readonly disposables: (BufferGeometry | Material | Texture)[] = [];
  private readonly pedestals: PedestalSign[] = [];
  private equipSign: PedestalSign | null = null;
  private portalMaterial: ShaderMaterial | null = null;
  private portalRings: Mesh[] = [];
  private time = 0;

  constructor() {
    this.root.add(this.sky.root, this.boards.root);
    this.buildSolids();
    this.buildSea();
    this.buildTrees();
    this.dressLobby();
    this.dressArena();
    this.buildPortal();
    this.buildPedestals();
    this.flush();
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  /** Every frame: the portal's swirl, the sky following the camera. */
  update(delta: number, cameraX: number, cameraZ: number): void {
    this.time += delta;
    if (this.portalMaterial) this.portalMaterial.uniforms['time']!.value = this.time;
    this.portalRings.forEach((ring, i) => {
      ring.rotation.z += delta * (i % 2 === 0 ? 0.6 : -0.9);
      const pulse = 1 + Math.sin(this.time * 2 + i) * 0.03;
      ring.scale.setScalar(pulse);
    });
    this.sky.follow(cameraX, cameraZ);
  }

  setBoards(board: LeaderboardSnapshot | null): void {
    this.boards.update(board);
  }

  /** Redraw pedestal captions for what this player owns and wears. */
  setOwnership(owned: readonly string[], equipped: string): void {
    for (const sign of this.pedestals) sign.setState(owned.includes(sign.kitId), sign.kitId === equipped);
    this.equipSign?.setKit(equipped);
  }

  dispose(): void {
    this.sky.dispose();
    this.boards.dispose();
    for (const sign of this.pedestals) sign.dispose();
    this.equipSign?.dispose();
    for (const item of this.disposables) item.dispose();
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------- building

  private push(layer: Layer, geometry: BufferGeometry): void {
    let list = this.parts.get(layer);
    if (!list) {
      list = [];
      this.parts.set(layer, list);
    }
    // Merge needs matching attributes: keep position/normal/uv only, non-indexed.
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    list.push(g);
  }

  /** A world-UV box centred at (x, y, z). */
  private box(layer: Layer, x: number, y: number, z: number, w: number, h: number, d: number, tile = 4, ry = 0, rx = 0, rz = 0): void {
    const geometry = texturedBox(w, h, d, tile);
    if (rx) geometry.rotateX(rx);
    if (rz) geometry.rotateZ(rz);
    if (ry) geometry.rotateY(ry);
    geometry.translate(x, y, z);
    this.push(layer, geometry);
  }

  private flush(): void {
    const material = (layer: Layer): Material => {
      switch (layer) {
        case 'sand':
        case 'sandPatch':
          return new MeshLambertMaterial({ map: arenaTextures.sand(), polygonOffset: layer === 'sandPatch', polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        case 'grass':
          return new MeshLambertMaterial({ map: arenaTextures.grass() });
        case 'cliff':
          return new MeshLambertMaterial({ map: arenaTextures.cliff() });
        case 'stone':
          return new MeshLambertMaterial({ map: arenaTextures.stone() });
        case 'ruin':
          return new MeshLambertMaterial({ map: arenaTextures.ruin() });
        case 'path':
          return new MeshLambertMaterial({ map: arenaTextures.path() });
        case 'bark':
          return new MeshLambertMaterial({ map: arenaTextures.bark() });
        case 'leaves':
          return new MeshLambertMaterial({ map: arenaTextures.leaves() });
        case 'leavesDark':
          return new MeshLambertMaterial({ map: arenaTextures.leaves(), color: 0xb8c8c0 });
        case 'rock':
          return new MeshLambertMaterial({ color: 0x8a93a8 });
        case 'bush':
          return new MeshLambertMaterial({ map: arenaTextures.leaves(), color: 0xa8e0a0 });
        case 'banner':
          return new MeshLambertMaterial({ color: 0xe8458f, side: DoubleSide });
      }
    };
    for (const [layer, list] of this.parts) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mat = material(layer);
      this.disposables.push(merged, mat);
      const mesh = new Mesh(merged, mat);
      mesh.name = `world-${layer}`;
      mesh.receiveShadow = true;
      mesh.castShadow = layer !== 'sandPatch' && layer !== 'cliff' && layer !== 'grass' && layer !== 'sand' && layer !== 'path';
      this.root.add(mesh);
    }
    this.parts.clear();
  }

  /** Every collision solid, dressed by its material tag; island tops get cliffs down to the sea. */
  private buildSolids(): void {
    buildStaticSolids().forEach((solid, index) => this.buildSolid(solid, index));
  }

  private buildSolid(s: Solid, index: number): void {
    const w = s.maxX - s.minX;
    const d = s.maxZ - s.minZ;
    const h = s.maxY - s.minY;
    const cx = (s.minX + s.maxX) / 2;
    const cz = (s.minZ + s.maxZ) / 2;
    switch (s.mat) {
      case 'invisible':
        return;
      case 'sand':
      case 'grass': {
        // The walkable top, then the cliff under it down into the sea.
        const top = new PlaneGeometry(w, d, 1, 1);
        top.rotateX(-Math.PI / 2);
        const uv = top.getAttribute('uv');
        for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (w / 12), uv.getY(i) * (d / 12));
        top.translate(cx, s.maxY, cz);
        this.push(s.mat, top);
        // Each island block's cliff is nudged a hair differently, so two
        // neighbouring blocks never share a plane.
        const nudge = index * 0.013;
        const cliffTop = s.maxY - 0.03 - nudge;
        const cliffBottom = SEA_Y - 4;
        this.box('cliff', cx, (cliffTop + cliffBottom) / 2, cz, w - 0.02 - nudge, cliffTop - cliffBottom, d - 0.02 - nudge, 8);
        // A grass or sand lip, and a rocky shelf lower down that widens the base.
        const lipLayer: Layer = s.mat === 'grass' ? 'grass' : 'sand';
        this.box(lipLayer, cx, s.maxY - 0.6 - nudge, cz, w + 0.3 + nudge, 1.1, d + 0.3 + nudge, 6);
        const shelf = cliffBottom + (cliffTop - cliffBottom) * 0.45 - nudge;
        this.box('cliff', cx, (shelf + cliffBottom) / 2, cz, w + 3 + nudge, shelf - cliffBottom, d + 3 + nudge, 8);
        return;
      }
      case 'path': {
        const top = new PlaneGeometry(w, d, 1, 1);
        top.rotateX(-Math.PI / 2);
        const uv = top.getAttribute('uv');
        for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (w / 7), uv.getY(i) * (d / 7));
        top.translate(cx, s.maxY, cz);
        this.push('path', top);
        return;
      }
      case 'stone':
      case 'pedestal':
        this.box('stone', cx, (s.minY + s.maxY) / 2, cz, w, h, d, 4);
        if (s.mat === 'pedestal') {
          // A wider plinth and a trim on top.
          this.box('stone', cx, 0.35, cz, w + 1.2, 0.7, d + 1.2, 4);
          this.box('ruin', cx, s.maxY + 0.2, cz, w + 0.6, 0.4, d + 0.6, 4);
        }
        return;
      case 'ruin':
        this.box('ruin', cx, (s.minY + s.maxY) / 2, cz, w, h, d, 5);
        return;
      case 'trunk':
        this.box('bark', cx, (s.minY + s.maxY) / 2, cz, w, h, d, 3);
        return;
    }
  }

  private buildSea(): void {
    const geometry = new PlaneGeometry(4000, 4000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 180, uv.getY(i) * 180);
    const material = new MeshLambertMaterial({ map: arenaTextures.sea(), color: new Color(0xd8ecff) });
    const sea = new Mesh(geometry, material);
    sea.position.set(0, SEA_Y, -200);
    sea.receiveShadow = true;
    this.disposables.push(geometry, material);
    this.root.add(sea);
  }

  /**
   * THE WALKWAY TREES: dark trunks that rise beside the path and arch over
   * it into big blocky canopies, as in the reference.
   */
  private buildTrees(): void {
    const rnd = seeded(71);
    for (const tree of WALK_TREES) {
      const lean = tree.lean;
      let x = tree.x;
      let y = 9;
      // Trunk segments bending over the walkway.
      for (let i = 0; i < 5; i += 1) {
        const tilt = (0.25 + i * 0.16) * lean;
        const length = 4.4;
        const dx = Math.sin(tilt) * length;
        const dy = Math.cos(tilt) * length;
        this.box('bark', x + dx / 2, y + dy / 2, tree.z, 2.3 - i * 0.2, length + 0.6, 2.3 - i * 0.2, 3, 0, 0, -tilt);
        x += dx;
        y += dy;
      }
      // Roots.
      for (const [rx, rz] of [
        [1.8, 0],
        [-1.8, 0.4],
        [0.2, 1.8],
        [0, -1.8],
      ] as const) {
        this.box('bark', tree.x + rx, 0.4, tree.z + rz, 1.4, 0.8, 1.4, 3, rnd());
      }
      // The canopy: a cluster of big leaf blocks.
      const count = 6 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i += 1) {
        const size = 6 + rnd() * 6;
        const ox = (rnd() - 0.5) * 12;
        const oy = (rnd() - 0.2) * 5;
        const oz = (rnd() - 0.5) * 12;
        this.box(i % 3 === 0 ? 'leavesDark' : 'leaves', x + ox, y + 3 + oy, tree.z + oz, size, size * 0.7, size, 4, rnd() * 0.6);
      }
    }
  }

  private dressLobby(): void {
    const rnd = seeded(11);
    // Bushes and rocks round the island's rim.
    const rim: [number, number][] = [];
    for (let z = -32; z <= 84; z += 7) {
      rim.push([z < 8 ? -34 : -20, z], [z < 8 ? 34 : 20, z]);
    }
    for (const [x, z] of rim) {
      if (rnd() < 0.35) continue;
      if (rnd() < 0.7) this.bush(x + (rnd() - 0.5) * 2, z, 1.2 + rnd() * 1.4, rnd);
      else this.box('rock', x, 0.5, z, 1.4 + rnd(), 1.1, 1.3 + rnd(), 2, rnd());
    }
    // Stone lanterns flanking the walkway mouth.
    for (const side of [-1, 1]) {
      this.box('stone', side * 8.5, 1, 9, 1.4, 2, 1.4, 2);
      this.box('ruin', side * 8.5, 2.5, 9, 1.1, 1, 1.1, 2);
      this.box('stone', side * 8.5, 3.2, 9, 1.8, 0.4, 1.8, 2);
    }
  }

  private bush(x: number, z: number, size: number, rnd: () => number): void {
    this.box('bush', x, size * 0.45, z, size * 1.3, size * 0.9, size * 1.2, 3, rnd());
    this.box('bush', x + size * 0.4, size * 0.7, z - size * 0.2, size * 0.8, size * 0.8, size * 0.8, 3, rnd());
  }

  private dressArena(): void {
    const rnd = seeded(29);
    const ax = ARENA.x;
    const az = ARENA.z;
    // Blocky sand patches over the grass (each a hair higher than the last: no shared planes).
    const patches: [number, number, number, number][] = [
      [-60, -20, 40, 28],
      [-104, 30, 24, 40],
      [20, 70, 50, 22],
      [70, -16, 26, 44],
      [-20, -72, 44, 24],
      [50, -118, 36, 18],
      [-50, 118, 36, 18],
      [110, 110, 30, 24],
      [-120, -120, 24, 24],
      [0, 125, 60, 20],
      [0, -125, 60, 20],
      [125, 0, 18, 70],
      [-125, 0, 18, 70],
    ];
    patches.forEach(([x, z, w, d], i) => {
      const plane = new PlaneGeometry(w, d);
      plane.rotateX(-Math.PI / 2);
      const uv = plane.getAttribute('uv');
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) * (w / 12), uv.getY(k) * (d / 12));
      plane.rotateY((rnd() - 0.5) * 0.3);
      plane.translate(ax + x, 0.02 + i * 0.004, az + z);
      this.push('sandPatch', plane);
    });
    // Tufts, rocks and rubble over the whole field (never inside a solid).
    for (let i = 0; i < 230; i += 1) {
      const x = ax + (rnd() - 0.5) * 272;
      const z = az + (rnd() - 0.5) * 272;
      if (Math.abs(x - ax) < 36 && Math.abs(z - az) < 36) continue;
      if (this.collision.blocked(x, 0.05, z)) continue;
      const r = rnd();
      if (r < 0.55) this.bush(x, z, 0.6 + rnd() * 0.9, rnd);
      else if (r < 0.8) this.box('rock', x, 0.35, z, 0.8 + rnd() * 1.4, 0.7, 0.8 + rnd(), 2, rnd());
      else this.box('ruin', x, 0.3, z, 1.5 + rnd() * 1.5, 0.6, 1 + rnd(), 3, rnd());
    }
    // Fallen column pieces lying in the field.
    this.box('ruin', ax + 22, 1.1, az + 78, 2.2, 2.2, 8, 5, 0.6, 0, Math.PI / 2);
    this.box('ruin', ax - 54, 1.1, az + 30, 2.2, 2.2, 7, 5, -0.4, 0, Math.PI / 2);
    this.box('ruin', ax + 48, 1.1, az - 30, 2.2, 2.2, 7, 5, 1.1, 0, Math.PI / 2);
    // Capitals on the tall standing columns.
    for (const column of ARENA_COLUMNS) {
      if (column.h >= 10) this.box('ruin', column.x, column.h + 0.4, column.z, 3.6, 0.8, 3.6, 3);
    }
    // A pink banner flying from every keep, and one from the ziggurat's summit.
    for (const fort of ARENA_FORTS) {
      // In the keep's corner, clear of anyone standing on the roof.
      const px = fort.x + (fort.x > ARENA.x ? 4.4 : -4.4);
      const pz = fort.z + (fort.z > ARENA.z ? 4.4 : -4.4);
      this.box('bark', px, 18 + 6, pz, 0.5, 12, 0.5, 2);
      this.box('banner', px + 1.7, 18 + 9.5, pz, 3, 4.5, 0.12, 2);
    }
    this.box('bark', ax, 12 + 7, az, 0.6, 14, 0.6, 2);
    this.box('banner', ax + 2, 12 + 11, az, 3.6, 5, 0.12, 2);
  }

  /** THE WHITE PORTAL: a glowing disc in the stone arch, with slow rings. */
  private buildPortal(): void {
    const disc = new CircleGeometry(PORTAL.radius, 48);
    const material = new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      uniforms: { time: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          float swirl = sin(a * 6.0 + r * 10.0 - time * 3.0) * 0.5 + 0.5;
          float core = smoothstep(1.0, 0.0, r);
          vec3 color = mix(vec3(0.82, 0.92, 1.0), vec3(1.0), core * 0.85 + swirl * 0.15);
          float alpha = smoothstep(1.0, 0.92, r);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.portalMaterial = material;
    const mesh = new Mesh(disc, material);
    mesh.position.set(PORTAL.x, PORTAL.centreY, PORTAL.z);
    this.root.add(mesh);
    this.disposables.push(disc, material);

    // The bloom: a big additive glow sprite.
    const glowTexture = radialTexture('rgba(255,255,255,1)', 'rgba(210,235,255,0.5)');
    const glow = new Sprite(new SpriteMaterial({ map: glowTexture, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    glow.scale.set(PORTAL.radius * 4.2, PORTAL.radius * 4.2, 1);
    glow.position.set(PORTAL.x, PORTAL.centreY, PORTAL.z + 0.6);
    this.root.add(glow);
    this.disposables.push(glowTexture, glow.material);

    for (let i = 0; i < 3; i += 1) {
      const ring = new RingGeometry(PORTAL.radius * (0.55 + i * 0.16), PORTAL.radius * (0.58 + i * 0.16), 40, 1, i, Math.PI * 1.3);
      const ringMaterial = new MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const ringMesh = new Mesh(ring, ringMaterial);
      ringMesh.position.set(PORTAL.x, PORTAL.centreY, PORTAL.z + 0.1 + i * 0.05);
      this.root.add(ringMesh);
      this.portalRings.push(ringMesh);
      this.disposables.push(ring, ringMaterial);
    }
    // Carved trim round the arch.
    this.box('ruin', PORTAL.x - 10.4, 18.6, PORTAL.z, 4.2, 1, 4.4, 3);
    this.box('ruin', PORTAL.x + 10.4, 18.6, PORTAL.z, 4.2, 1, 4.4, 3);
    this.box('stone', PORTAL.x, 21.2, PORTAL.z, 26, 1.2, 4.6, 4);
    for (const side of [-1, 1]) this.box('stone', PORTAL.x + side * 10.4, 0.5, PORTAL.z, 4.6, 1, 4.8, 4);
  }

  private buildPedestals(): void {
    for (const kit of KITS) {
      if (kit.pedestal < 0) continue;
      const at = pedestalAt(kit.pedestal);
      const sign = new PedestalSign(kit.id, false);
      sign.sprite.position.set(at.x, PEDESTAL.height + 4.9, at.z);
      this.root.add(sign.sprite);
      this.pedestals.push(sign);
    }
    this.equipSign = new PedestalSign('asta', true);
    this.equipSign.sprite.position.set(EQUIP_PEDESTAL.x, 2.6 + 4.9, EQUIP_PEDESTAL.z);
    this.root.add(this.equipSign.sprite);
  }
}

/** A soft round glow. */
const radialTexture = (inner: string, mid: string): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, mid);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const FONT = '"Fredoka", "Baloo 2", "Nunito", "Segoe UI", system-ui, sans-serif';

/**
 * The billboard over a pedestal: the kit's name, its price (or OWNED /
 * EQUIPPED), and its round portrait - the reference's walkway display.
 */
class PedestalSign {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private owned = false;
  private equipped = false;

  constructor(
    public kitId: string,
    private readonly showcase: boolean,
  ) {
    this.canvas.width = 320;
    this.canvas.height = 400;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const material = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(7.2, 9, 1);
    this.draw();
  }

  setState(owned: boolean, equipped: boolean): void {
    if (owned === this.owned && equipped === this.equipped) return;
    this.owned = owned;
    this.equipped = equipped;
    this.draw();
  }

  setKit(id: string): void {
    if (id === this.kitId) return;
    this.kitId = id;
    this.draw();
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const kit = kitById(this.kitId);
    ctx.clearRect(0, 0, 320, 400);
    if (!kit) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const outlined = (text: string, y: number, size: number, fill: string, stroke = '#15182a', italic = true): void => {
      ctx.font = `${italic ? 'italic ' : ''}800 ${size}px ${FONT}`;
      let s = size;
      const w = ctx.measureText(text).width;
      if (w > 300) {
        s = (size * 300) / w;
        ctx.font = `${italic ? 'italic ' : ''}800 ${s}px ${FONT}`;
      }
      ctx.lineWidth = s * 0.2;
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, 160, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, 160, y);
    };
    if (this.showcase) {
      outlined(kit.name, 40, 52, '#ffffff');
      outlined('Equipped', 96, 44, '#5cf06a', '#0d3a12');
    } else {
      if (kit.isNew) outlined('NEW', 22, 34, '#ffd84a', '#5a3a00');
      outlined(kit.name, 62, 50, '#ffffff');
      if (this.equipped) outlined('EQUIPPED', 112, 40, '#5cf06a', '#0d3a12');
      else if (this.owned) outlined('OWNED', 112, 40, '#9fe8ff', '#0d2a3a');
      else outlined(formatYen(kit.price), 112, 44, '#ff4040', '#ffffff');
    }
    const portrait = kitPortrait(kit.id);
    ctx.drawImage(portrait, 28, 136, 264, 264);
    this.texture.needsUpdate = true;
  }
}
