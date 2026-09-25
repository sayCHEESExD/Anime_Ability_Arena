import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Blending,
  type BufferGeometry,
  type Object3D,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * EVERY COMBAT EFFECT, kept cheap for WebGL: a handful of shared geometries
 * and textures, one small material per live effect, additive blending, and
 * nothing alive for more than a couple of seconds. There are no particle
 * systems - an explosion is a sphere that swells and fades plus a ring on the
 * ground and a few sprites, which reads just as clearly.
 */

const TAU = Math.PI * 2;

interface Live {
  update(dt: number): boolean;
  dispose(): void;
}

const canvasTexture = (size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const GLOW = canvasTexture(64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const STAR = canvasTexture(128, (ctx, s) => {
  const c = s / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * TAU;
    const r = i % 2 === 0 ? c * 0.98 : c * 0.28;
    ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const PUFF = canvasTexture(64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, TAU);
  ctx.fill();
});

const G = {
  sphere: new SphereGeometry(1, 20, 14),
  ring: new RingGeometry(0.82, 1, 48),
  arc: new RingGeometry(0.7, 1, 32, 1, -1.2, 2.4),
  bigArc: new RingGeometry(0.55, 1, 40, 1, -1.35, 2.7),
  beam: new CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
  cone: new ConeGeometry(1, 1, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
  tornado: new CylinderGeometry(1, 0.35, 1, 18, 1, true).translate(0, 0.5, 0),
  torus: new TorusGeometry(1, 0.08, 6, 36),
  box: new BoxGeometry(1, 1, 1),
  blade: new BoxGeometry(1, 0.08, 0.35),
};

const basic = (color: number, opacity = 1, blending: Blending = AdditiveBlending): MeshBasicMaterial =>
  new MeshBasicMaterial({ color, transparent: true, opacity, blending, depthWrite: false, side: DoubleSide, fog: false });

const sprite = (texture: CanvasTexture, color: number, opacity = 1, blending: Blending = AdditiveBlending): Sprite =>
  new Sprite(new SpriteMaterial({ map: texture, color, transparent: true, opacity, blending, depthWrite: false, fog: false }));

const ease = (t: number): number => 1 - (1 - t) * (1 - t);

export type Anchor = () => { x: number; y: number; z: number; yaw: number } | null;

interface ProjectileView {
  readonly root: Group;
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
  readonly range: number;
  travelled: number;
  spin: number;
  dispose(): void;
}

interface ZoneView {
  readonly root: Group;
  readonly radius: number;
  readonly anchor: Anchor | null;
  readonly kind: string;
  age: number;
  readonly duration: number;
  dispose(): void;
}

interface SummonView {
  readonly root: Group;
  readonly arm: Object3D;
  swings: number;
  swing: number;
  target: Vector3;
  yaw: number;
}

export class Vfx {
  private readonly root = new Group();
  private readonly live: Live[] = [];
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly zones = new Map<number, ZoneView>();
  private readonly summons = new Map<string, SummonView>();
  private summonGeometry: BufferGeometry | null = null;
  private time = 0;

  constructor(scene: Scene) {
    scene.add(this.root);
  }

  // ------------------------------------------------------------ primitives

  /** A bright star burst that pops and fades. */
  burst(x: number, y: number, z: number, color: number, size = 2.4, life = 0.25): void {
    const s = sprite(STAR, color);
    s.position.set(x, y, z);
    s.material.rotation = Math.random() * TAU;
    this.root.add(s);
    this.add(life, (k) => {
      s.scale.setScalar(size * (0.4 + ease(k) * 0.9));
      s.material.opacity = 1 - k;
    }, () => {
      s.removeFromParent();
      s.material.dispose();
    });
  }

  /** A soft glow puff (dust, afterimages). */
  puff(x: number, y: number, z: number, color: number, size = 2, life = 0.5, rise = 1.5, blending: Blending = NormalBlending, opacity = 0.6): void {
    const s = sprite(PUFF, color, opacity, blending);
    s.position.set(x, y, z);
    this.root.add(s);
    this.add(life, (k) => {
      s.scale.setScalar(size * (0.6 + k * 0.8));
      s.position.y = y + rise * k;
      s.material.opacity = opacity * (1 - k);
    }, () => {
      s.removeFromParent();
      s.material.dispose();
    });
  }

  /** A flat ring on the ground that races outward. */
  ring(x: number, y: number, z: number, color: number, radius: number, life = 0.45, opacity = 0.85): void {
    const mesh = new Mesh(G.ring, basic(color, opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.12, z);
    this.root.add(mesh);
    this.add(life, (k) => {
      mesh.scale.setScalar(Math.max(0.1, radius * ease(k)));
      (mesh.material as MeshBasicMaterial).opacity = opacity * (1 - k);
    }, () => this.drop(mesh));
  }

  /** A sphere that swells and fades: an explosion's body. */
  sphere(x: number, y: number, z: number, color: number, radius: number, life = 0.4, opacity = 0.65, blending: Blending = NormalBlending): void {
    const mesh = new Mesh(G.sphere, basic(color, opacity, blending));
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    this.add(life, (k) => {
      mesh.scale.setScalar(Math.max(0.05, radius * (0.3 + ease(k) * 0.7)));
      (mesh.material as MeshBasicMaterial).opacity = opacity * (1 - k * k);
    }, () => this.drop(mesh));
  }

  /** A crescent slash arc, flat (yaw) or tilted (roll), sweeping round. */
  slash(x: number, y: number, z: number, yaw: number, color: number, reach: number, roll = 0, life = 0.24, big = false, blending: Blending = AdditiveBlending): void {
    const mesh = new Mesh(big ? G.bigArc : G.arc, basic(color, 0.95, blending));
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-Math.PI / 2 + roll, yaw - Math.PI / 2, 0);
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    const start = mesh.rotation.y;
    this.add(life, (k) => {
      mesh.scale.setScalar(reach * (0.75 + k * 0.35));
      mesh.rotation.y = start + (k - 0.5) * 0.5;
      (mesh.material as MeshBasicMaterial).opacity = 0.95 * (1 - k);
    }, () => this.drop(mesh));
  }

  /** A beam from a point along a heading: grows out, then fades. */
  beam(x: number, y: number, z: number, yaw: number, pitch: number, length: number, radius: number, color: number, life = 0.35, grow = 0.3, blending: Blending = AdditiveBlending): Mesh {
    const mesh = new Mesh(G.beam, basic(color, 0.9, blending));
    mesh.position.set(x, y, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-pitch, yaw, 0);
    this.root.add(mesh);
    this.add(life, (k) => {
      const out = Math.min(1, k / Math.max(0.01, grow));
      mesh.scale.set(radius * (1 - k * 0.5), radius * (1 - k * 0.5), length * ease(out));
      (mesh.material as MeshBasicMaterial).opacity = 0.9 * (k < grow ? 1 : 1 - (k - grow) / (1 - grow));
    }, () => this.drop(mesh));
    return mesh;
  }

  /** A beam between two points. */
  line(a: Vector3, b: Vector3, radius: number, color: number, life = 0.25): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.01) return;
    this.beam(a.x, a.y, a.z, Math.atan2(dx, dz), Math.asin(dy / length), length, radius, color, life, 0.01);
  }

  /** A jagged lightning bolt between two points. */
  lightning(a: Vector3, b: Vector3, color: number, life = 0.22, jag = 1.2, radius = 0.08): void {
    const segments = Math.max(3, Math.round(a.distanceTo(b) / 2));
    let prev = a.clone();
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      const next = new Vector3().lerpVectors(a, b, t);
      if (i < segments) next.add(new Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag));
      this.line(prev, next, radius, color, life);
      prev = next;
    }
  }

  /** An open cone shockwave pushing forward. */
  cone(x: number, y: number, z: number, yaw: number, length: number, spread: number, color: number, life = 0.45): void {
    const mesh = new Mesh(G.cone, basic(color, 0.7));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.root.add(mesh);
    this.add(life, (k) => {
      const e = ease(Math.min(1, k * 1.6));
      mesh.scale.set(spread * e, spread * e * 0.6, length * e);
      (mesh.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }, () => this.drop(mesh));
  }

  /** A glow that rides a player (charging an attack). */
  charge(anchor: Anchor, color: number, size: number, life: number, forward = 1.4, height = 1.7, crackle = false): void {
    const s = sprite(GLOW, color, 0.95);
    const core = sprite(STAR, 0xffffff, 0.9);
    this.root.add(s, core);
    this.add(life, (k) => {
      const at = anchor();
      if (!at) return;
      const x = at.x + Math.sin(at.yaw) * forward;
      const z = at.z + Math.cos(at.yaw) * forward;
      s.position.set(x, at.y + height, z);
      core.position.copy(s.position);
      const grow = Math.min(1, k * 2.5);
      const pulse = 1 + Math.sin(this.time * 30) * 0.12;
      s.scale.setScalar(size * grow * pulse);
      core.scale.setScalar(size * 0.5 * grow);
      core.material.rotation += 0.3;
      s.material.opacity = k > 0.85 ? (1 - k) / 0.15 : 0.95;
      core.material.opacity = s.material.opacity;
      if (crackle && Math.random() < 0.5) {
        const from = s.position.clone();
        const to = from.clone().add(new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3));
        this.lightning(from, to, color, 0.08, 0.6, 0.05);
      }
    }, () => {
      s.removeFromParent();
      core.removeFromParent();
      s.material.dispose();
      core.material.dispose();
    });
  }

  /** Afterimage puffs behind a moving player while `active()` says so. */
  trail(anchor: Anchor, color: number, life: number, every = 0.03, size = 1.8, blending: Blending = AdditiveBlending): void {
    let since = 0;
    this.add(life, (_k, dt) => {
      since += dt;
      if (since < every) return;
      since = 0;
      const at = anchor();
      if (at) this.puff(at.x, at.y + 1.6, at.z, color, size, 0.3, 0, blending, 0.55);
    }, () => undefined);
  }

  /** A spinning open cylinder: Zoro's tornado. */
  tornado(anchor: Anchor, color: number, radius: number, height: number, life: number): void {
    const meshes = [0, 1].map((i) => {
      const mesh = new Mesh(G.tornado, basic(color, 0.35 - i * 0.1));
      this.root.add(mesh);
      return mesh;
    });
    this.add(life, (k) => {
      const at = anchor();
      if (!at) return;
      const grow = Math.min(1, k * 4);
      meshes.forEach((mesh, i) => {
        mesh.position.set(at.x, at.y, at.z);
        mesh.scale.set(radius * grow * (1 - i * 0.25), height * grow, radius * grow * (1 - i * 0.25));
        mesh.rotation.y = this.time * (10 + i * 6);
        (mesh.material as MeshBasicMaterial).opacity = (0.35 - i * 0.1) * (k > 0.8 ? (1 - k) / 0.2 : 1);
      });
    }, () => meshes.forEach((mesh) => this.drop(mesh)));
  }

  /** Spinning slash arcs round a player for a while (a mobile spin attack). */
  whirl(anchor: Anchor, color: number, radius: number, life: number): void {
    let since = 0;
    this.add(life, (_k, dt) => {
      since += dt;
      if (since < 0.08) return;
      since = 0;
      const at = anchor();
      if (at) this.slash(at.x, at.y + 1.3, at.z, this.time * 14, color, radius, 0, 0.18, true);
    }, () => undefined);
  }

  /** Rapid punches in front of a player (Gatling). */
  barrage(anchor: Anchor, color: number, reach: number, width: number, life: number): void {
    let since = 0;
    this.add(life, (_k, dt) => {
      since += dt;
      if (since < 0.045) return;
      since = 0;
      const at = anchor();
      if (!at) return;
      const along = 2 + Math.random() * reach;
      const side = (Math.random() - 0.5) * width;
      const x = at.x + Math.sin(at.yaw) * along + Math.cos(at.yaw) * side;
      const z = at.z + Math.cos(at.yaw) * along - Math.sin(at.yaw) * side;
      const y = at.y + 1 + Math.random() * 1.6;
      this.beam(at.x + Math.cos(at.yaw) * side * 0.3, y, at.z - Math.sin(at.yaw) * side * 0.3, at.yaw, 0, along, 0.22, color, 0.12, 0.4, NormalBlending);
      this.burst(x, y, z, 0xffffff, 1.2, 0.12);
    }, () => undefined);
  }

  /** Flashes at the screen-space centre of a hit: the hit spark. */
  hitSpark(x: number, y: number, z: number, heavy: boolean, color = 0xffffff): void {
    this.burst(x, y, z, heavy ? 0xfff2a0 : color, heavy ? 4.2 : 2.6, heavy ? 0.3 : 0.2);
    if (heavy) this.sphere(x, y, z, 0xffffff, 2.2, 0.2, 0.6);
    for (let i = 0; i < (heavy ? 4 : 2); i += 1) {
      const a = Math.random() * TAU;
      const from = new Vector3(x, y, z);
      const to = from.clone().add(new Vector3(Math.cos(a) * 2.2, (Math.random() - 0.3) * 2, Math.sin(a) * 2.2));
      this.line(from, to, 0.06, 0xffffff, 0.12);
    }
  }

  // ----------------------------------------------------------- projectiles

  projectile(id: number, kind: string, x: number, y: number, z: number, dx: number, dz: number, speed: number, range: number, radius: number, color: number, color2: number): void {
    const root = new Group();
    root.position.set(x, y, z);
    const yaw = Math.atan2(dx, dz);
    root.rotation.y = yaw;
    const owned: (MeshBasicMaterial | SpriteMaterial)[] = [];
    const mesh = (geometry: BufferGeometry, c: number, opacity = 0.9, blending: Blending = NormalBlending): Mesh => {
      const m = new Mesh(geometry, basic(c, opacity, blending));
      owned.push(m.material as MeshBasicMaterial);
      root.add(m);
      return m;
    };
    const glow = (c: number, size: number, opacity = 0.45): Sprite => {
      const s = sprite(GLOW, c, opacity);
      owned.push(s.material);
      s.scale.setScalar(size);
      root.add(s);
      return s;
    };
    let spin = 0;
    switch (kind) {
      case 'crescent':
      case 'wave': {
        // A standing crescent facing its flight.
        const arc = mesh(G.bigArc, kind === 'wave' ? 0x111111 : color, kind === 'wave' ? 0.85 : 0.95, kind === 'wave' ? NormalBlending : AdditiveBlending);
        arc.rotation.set(0, Math.PI / 2, Math.PI / 2);
        arc.scale.setScalar(radius * 1.4);
        const inner = mesh(G.bigArc, kind === 'wave' ? 0xff2a2a : color2, 0.7, kind === 'wave' ? AdditiveBlending : NormalBlending);
        inner.rotation.set(0, Math.PI / 2, Math.PI / 2);
        inner.scale.setScalar(radius * 1.05);
        inner.position.z = -0.3;
        break;
      }
      case 'rasenshuriken': {
        mesh(G.sphere, 0xe8f6ff, 0.9).scale.setScalar(radius * 0.6);
        glow(color2, radius * 3);
        for (let i = 0; i < 4; i += 1) {
          const blade = mesh(G.blade, 0xcfeaff, 0.8);
          blade.scale.set(radius * 3.2, 1, 1.2);
          blade.rotation.y = (i / 4) * Math.PI;
        }
        spin = 22;
        break;
      }
      case 'spear': {
        const shaft = mesh(G.beam, 0x2b2b2b, 1, NormalBlending);
        shaft.scale.set(0.12, 0.12, 3.6);
        shaft.position.z = -2.4;
        const tip = mesh(new ConeGeometry(0.3, 1.1, 6).rotateX(Math.PI / 2), 0xd0d0d0, 1, NormalBlending);
        tip.position.z = 1.4;
        glow(0xffffff, 2);
        break;
      }
      case 'fireball':
        mesh(G.sphere, 0xff7a1a, 0.95).scale.setScalar(radius);
        mesh(G.sphere, 0xffe04a, 0.8).scale.setScalar(radius * 0.6);
        glow(0xff9a3a, radius * 3.2, 0.5);
        break;
      case 'airBullet':
        mesh(G.sphere, 0xe8fff4, 0.35).scale.setScalar(radius);
        mesh(G.torus, 0xffffff, 0.8).scale.setScalar(radius * 1.1);
        glow(0x9fffd0, radius * 3, 0.6);
        break;
      case 'dismantle': {
        const cut = mesh(G.box, 0xffffff, 0.95);
        cut.scale.set(radius * 2.4, 0.06, 0.5);
        cut.rotation.z = 0.35;
        const red = mesh(G.box, 0xff3b6b, 0.6);
        red.scale.set(radius * 2.6, 0.1, 0.3);
        red.rotation.z = 0.35;
        break;
      }
      case 'purple': {
        mesh(G.sphere, 0xa23bff, 0.9).scale.setScalar(radius);
        mesh(G.sphere, 0xf0d8ff, 0.9).scale.setScalar(radius * 0.45);
        glow(0xc05bff, radius * 3.2, 0.5);
        break;
      }
      default:
        mesh(G.sphere, color, 0.9).scale.setScalar(radius);
        glow(color, radius * 3);
    }
    this.root.add(root);
    this.projectiles.set(id, {
      root,
      dx,
      dz,
      speed,
      range,
      travelled: 0,
      spin,
      dispose: () => {
        root.removeFromParent();
        for (const material of owned) material.dispose();
      },
    });
  }

  endProjectile(id: number, x: number, y: number, z: number, explode: number, color: number, color2: number, kind: string): void {
    const view = this.projectiles.get(id);
    if (view) {
      view.dispose();
      this.projectiles.delete(id);
    }
    if (explode > 0) {
      this.sphere(x, y, z, color, explode, 0.5, 0.85);
      this.sphere(x, y, z, color2, explode * 0.6, 0.35, 0.8);
      this.ring(x, y - 1.4, z, color, explode * 1.4, 0.5);
      for (let i = 0; i < 5; i += 1) this.puff(x + (Math.random() - 0.5) * explode, y, z + (Math.random() - 0.5) * explode, 0x444444, 3, 0.9, 3, NormalBlending, 0.5);
    } else if (kind !== 'rasenshuriken') {
      this.burst(x, y, z, color, 2.5, 0.2);
    }
  }

  // ----------------------------------------------------------------- zones

  zone(id: number, kind: string, x: number, y: number, z: number, radius: number, duration: number, anchor: Anchor | null, color: number, color2: number): void {
    const root = new Group();
    root.position.set(x, y, z);
    const owned: (MeshBasicMaterial | SpriteMaterial)[] = [];
    const mesh = (geometry: BufferGeometry, c: number, opacity: number, blending: Blending = NormalBlending): Mesh => {
      const m = new Mesh(geometry, basic(c, opacity, blending));
      owned.push(m.material as MeshBasicMaterial);
      root.add(m);
      return m;
    };
    if (kind === 'shrine') {
      // The domain: a dark red dome over a blood-red ring.
      const dome = mesh(new SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI / 2), 0x3a0008, 0.35, NormalBlending);
      dome.scale.setScalar(radius);
      const floor = mesh(G.ring, color, 0.8);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.15;
      floor.scale.setScalar(radius);
    } else if (kind === 'blue') {
      mesh(G.sphere, color, 0.85).scale.setScalar(1.6);
      mesh(G.sphere, 0xffffff, 0.9).scale.setScalar(0.8);
      const halo = mesh(G.torus, color2, 0.6);
      halo.scale.setScalar(radius * 0.5);
      const halo2 = mesh(G.torus, color, 0.4);
      halo2.scale.setScalar(radius * 0.8);
      halo2.rotation.x = Math.PI / 2;
    } else {
      // Rasenshuriken's grinding sphere.
      mesh(G.sphere, 0xe8f6ff, 0.35).scale.setScalar(radius);
      mesh(G.sphere, color2, 0.5).scale.setScalar(radius * 0.4);
      const disk = mesh(G.torus, 0xffffff, 0.6);
      disk.scale.setScalar(radius);
      disk.rotation.x = Math.PI / 2;
    }
    this.root.add(root);
    this.zones.set(id, {
      root,
      radius,
      anchor,
      kind,
      age: 0,
      duration,
      dispose: () => {
        root.removeFromParent();
        for (const material of owned) material.dispose();
      },
    });
  }

  endZone(id: number, x: number, y: number, z: number, color: number): void {
    const view = this.zones.get(id);
    if (!view) return;
    view.dispose();
    this.zones.delete(id);
    const r = view.radius;
    this.sphere(x, y, z, color, r * (view.kind === 'blue' ? 0.8 : 1.1), 0.45, 0.8);
    this.ring(x, y - (view.kind === 'shrine' ? 0 : 1.5), z, 0xffffff, r * 1.3, 0.5);
  }

  // --------------------------------------------------------------- summons

  addSummon(key: string, x: number, y: number, z: number, yaw: number): void {
    if (this.summons.has(key)) return;
    if (!this.summonGeometry) {
      const parts: BufferGeometry[] = [];
      const part = (w: number, h: number, d: number, px: number, py: number, pz: number): void => {
        parts.push(new BoxGeometry(w, h, d).translate(px, py, pz));
      };
      part(1.2, 1.4, 0.7, 0, 2.1, 0);
      part(0.9, 0.9, 0.9, 0, 3.25, 0);
      part(0.45, 1.3, 0.45, -0.3, 0.7, 0);
      part(0.45, 1.3, 0.45, 0.3, 0.7, 0);
      part(0.4, 1.3, 0.4, -0.85, 2.1, 0);
      this.summonGeometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
    }
    const root = new Group();
    const body = new Mesh(this.summonGeometry, basic(0x120a2a, 0.92, NormalBlending));
    const aura = sprite(GLOW, 0x4d2bff, 0.5);
    aura.scale.set(3.4, 5, 1);
    aura.position.y = 2;
    const eyes = new Mesh(G.box, basic(0x7fd8ff, 1));
    eyes.scale.set(0.6, 0.12, 0.1);
    eyes.position.set(0, 3.35, 0.46);
    const arm = new Group();
    arm.position.set(0.85, 2.7, 0);
    const armMesh = new Mesh(G.box, basic(0x120a2a, 0.92, NormalBlending));
    armMesh.scale.set(0.4, 1.3, 0.4);
    armMesh.position.y = -0.6;
    const blade = new Mesh(G.box, basic(0x9f8bff, 0.9));
    blade.scale.set(0.08, 1.2, 0.25);
    blade.position.set(0, -1.4, 0.4);
    blade.rotation.x = Math.PI / 2;
    arm.add(armMesh, blade);
    root.add(body, aura, eyes, arm);
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    this.root.add(root);
    this.summons.set(key, { root, arm, swings: -1, swing: 0, target: new Vector3(x, y, z), yaw });
    this.ring(x, y, z, 0x4d2bff, 3, 0.5);
    this.puff(x, y + 1, z, 0x2a1a5a, 3.5, 0.6, 2, NormalBlending, 0.8);
  }

  moveSummon(key: string, x: number, y: number, z: number, yaw: number, swings: number): void {
    const view = this.summons.get(key);
    if (!view) return;
    view.target.set(x, y, z);
    view.yaw = yaw;
    if (view.swings >= 0 && swings > view.swings) view.swing = 0.3;
    view.swings = swings;
  }

  removeSummon(key: string): void {
    const view = this.summons.get(key);
    if (!view) return;
    const p = view.root.position;
    this.puff(p.x, p.y + 1.5, p.z, 0x2a1a5a, 3, 0.5, 2, NormalBlending, 0.8);
    view.root.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      material?.dispose?.();
    });
    view.root.removeFromParent();
    this.summons.delete(key);
  }

  // ------------------------------------------------------------------ clock

  update(dt: number): void {
    this.time += dt;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      if (!this.live[i]!.update(dt)) {
        this.live[i]!.dispose();
        this.live.splice(i, 1);
      }
    }
    for (const view of this.projectiles.values()) {
      const step = view.speed * dt;
      if (view.travelled < view.range + 4) {
        view.root.position.x += view.dx * step;
        view.root.position.z += view.dz * step;
        view.travelled += step;
      }
      if (view.spin) view.root.rotation.y += view.spin * dt;
    }
    for (const view of this.zones.values()) {
      view.age += dt;
      const at = view.anchor?.();
      if (at) view.root.position.set(at.x, at.y, at.z);
      view.root.rotation.y += dt * (view.kind === 'blue' ? -6 : view.kind === 'shrine' ? 0.4 : 16);
      if (view.kind === 'shrine' && Math.random() < 0.7) {
        // Slashes flicker all through the domain.
        const p = view.root.position;
        const a = Math.random() * TAU;
        const r = Math.random() * view.radius;
        this.slash(p.x + Math.cos(a) * r, p.y + 0.5 + Math.random() * 3, p.z + Math.sin(a) * r, Math.random() * TAU, 0xffffff, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.15);
      }
      if (view.kind === 'blue' && Math.random() < 0.5) {
        const p = view.root.position;
        const a = Math.random() * TAU;
        this.line(new Vector3(p.x + Math.cos(a) * view.radius, p.y + (Math.random() - 0.5) * 4, p.z + Math.sin(a) * view.radius), p.clone(), 0.05, 0x7fb0ff, 0.2);
      }
    }
    for (const view of this.summons.values()) {
      const p = view.root.position;
      const alpha = 1 - Math.exp(-12 * dt);
      p.lerp(view.target, alpha);
      view.root.rotation.y = view.yaw;
      view.swing = Math.max(0, view.swing - dt);
      view.arm.rotation.x = view.swing > 0 ? -Math.sin((1 - view.swing / 0.3) * Math.PI) * 2.2 : Math.sin(this.time * 6) * 0.2;
      p.y = view.target.y + Math.sin(this.time * 4 + p.x) * 0.1;
    }
  }

  dispose(): void {
    for (const live of this.live) live.dispose();
    this.live.length = 0;
    for (const view of this.projectiles.values()) view.dispose();
    for (const view of this.zones.values()) view.dispose();
    for (const key of [...this.summons.keys()]) this.removeSummon(key);
    this.root.removeFromParent();
  }

  private add(life: number, tick: (k: number, dt: number) => void, done: () => void): void {
    let age = 0;
    tick(0, 0);
    this.live.push({
      update: (dt) => {
        age += dt;
        const k = Math.min(1, age / life);
        tick(k, dt);
        return age < life;
      },
      dispose: done,
    });
  }

  private drop(mesh: Mesh): void {
    mesh.removeFromParent();
    (mesh.material as MeshBasicMaterial).dispose();
  }
}

export const colorOf = (value: number): Color => new Color(value);
