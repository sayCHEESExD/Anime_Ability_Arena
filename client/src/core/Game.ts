import {
  ACT,
  BUFFS,
  DASH,
  EQUIP_PEDESTAL,
  KITS,
  M1,
  PEDESTAL,
  formatYen,
  kitById,
  pedestalAt,
  type AbilityDef,
  type BuffId,
  type CastMessage,
  type DiedMessage,
  type FxMessage,
  type HitMessage,
  type KitDef,
  type NoticeMessage,
  type RespawnMessage,
  type RewardMessage,
} from '@arena/shared';
import { Vector3 } from 'three';
import { ABILITY_CLIPS, M1_CLIPS } from '../animation/ActionClips.js';
import { AudioManager } from '../audio/AudioManager.js';
import { PlayerAudio } from '../audio/PlayerAudio.js';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { Bloxity } from '../bloxity/Bloxity.js';
import { lookFromLegion } from '../bloxity/avatarLook.js';
import { identityFromLegion } from '../bloxity/identity.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { CastFx } from '../combat/CastFx.js';
import { Vfx, type Anchor } from '../combat/Vfx.js';
import { clientConfig } from '../config/clientConfig.js';
import { InputManager } from '../input/InputManager.js';
import { NetworkClient } from '../net/NetworkClient.js';
import type { ConnectionStatus, NetPlayerState } from '../net/netTypes.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { playerModelLoader, type PlayerModelReport } from '../player/PlayerModelLoader.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { RendererManager } from '../rendering/RendererManager.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { ArenaHud } from '../ui/ArenaHud.js';
import { BloxityPanel } from '../ui/BloxityPanel.js';
import { InventoryPanel } from '../ui/InventoryPanel.js';
import { Panel, anyPanelOpen } from '../ui/Panel.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { logger } from '../util/logger.js';
import { World } from '../world/World.js';

const SCOPE = 'Game';
const EYE = 1.6;
const PROJECTED = new Vector3();

/** Every ability by id, for colours and recipes of server-sent effects. */
const ABILITIES = new Map<string, AbilityDef>();
for (const kit of KITS) {
  ABILITIES.set(kit.skill.id, kit.skill);
  ABILITIES.set(kit.ultimate.id, kit.ultimate);
}

const STREAK_CALLOUTS: Readonly<Record<number, string>> = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!', 5: 'RAMPAGE!', 7: 'UNSTOPPABLE!', 10: 'GODLIKE!' };

const shortcutOf = (event: KeyboardEvent): string => (event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.code.toLowerCase());

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return element.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * Composition root. Owns every subsystem and the per-frame order - input,
 * casting, prediction, camera, network, effects, HUD, render - and no
 * gameplay rules: every hit, every point of damage, every Yen is the
 * server's, and every figure on screen is replicated or sent by it.
 */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: RendererManager;
  private readonly sceneManager = new SceneManager();
  private readonly camera = new ThirdPersonCamera();
  private readonly input = new InputManager();
  private readonly remotePlayers: RemotePlayerManager;
  private readonly audio = new AudioManager();
  private readonly playerAudio = new PlayerAudio(this.audio);
  private readonly bloxity: Bloxity;
  private readonly bloxityPanel: BloxityPanel;
  private readonly network: NetworkClient;
  private readonly hud: ArenaHud;
  private readonly inventory: InventoryPanel;
  private readonly settings: SettingsPanel;
  private readonly fpsReadout: HTMLDivElement;

  private world: World | null = null;
  private vfx: Vfx | null = null;
  private castFx: CastFx | null = null;
  private localPlayer: LocalPlayer | null = null;
  private dresser: AvatarDresser | null = null;
  private pendingAvatar: (() => void) | null = null;
  private localSessionId: string | null = null;
  private local: NetPlayerState | null = null;

  /** When each slot is ready again, on this clock: [unused, attack, skill, ultimate]. */
  private readonly ready = [0, 0, 0, 0];
  private clock = 0;
  private kit: KitDef = KITS[0]!;
  private zone = 'lobby';
  private dead = false;
  private deathTimer = 0;
  private shake = 0;
  private lastStreak = 0;
  private nearKit: string | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new RendererManager(container);
    this.remotePlayers = new RemotePlayerManager(this.sceneManager.scene);
    this.fpsReadout = document.createElement('div');
    this.fpsReadout.className = 'aoe-fps aoe-font';
    this.fpsReadout.hidden = true;
    container.appendChild(this.fpsReadout);


    this.hud = new ArenaHud(container, {
      onInventory: () => this.togglePanel(this.inventory),
      onSettings: () => this.togglePanel(this.settings),
      onPlay: () => this.play(),
      onPrompt: () => this.input.pressInteract(),
    });
    this.inventory = new InventoryPanel(
      container,
      (id) => this.network.buyKit(id),
      (id) => this.network.equipKit(id),
    );
    this.settings = new SettingsPanel(container, {
      toggleMusic: () => this.audio.toggleMuted(),
      isMusicMuted: () => this.audio.isMuted,
      setSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      setShowFps: (show) => {
        this.fpsReadout.hidden = !show;
      },
    });

    this.bloxity = new Bloxity({
      setMasterVolume: (level) => this.audio.setMasterVolume(level),
      setMusicVolume: (level) => this.audio.setMusicVolume(level),
      setGraphicsQuality: (level) => this.renderer.setQuality(level),
      setShowFps: (show) => {
        this.fpsReadout.hidden = !show;
      },
      setCameraSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      respawn: () => this.network.requestRespawn(),
      pointerLockChanged: (locked) => this.input.look.setCursorFree(!locked),
      avatarChanged: (equipped, proportions) => {
        const look = lookFromLegion(equipped, proportions);
        this.network.sendAvatar(look);
        const apply = (): void => this.dresser?.setLook(look.appearance, look.proportions);
        if (this.dresser) apply();
        else this.pendingAvatar = apply;
      },
    });
    this.bloxityPanel = new BloxityPanel(container, this.bloxity);

    window.addEventListener('keydown', this.onHotkey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('mousedown', this.onGesture);
    window.addEventListener('touchstart', this.onGesture, { passive: true });
    this.renderer.onResize((width, height) => this.camera.setViewport(width, height));

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => {
        this.localSessionId = sessionId;
        const roomId = this.network.roomId;
        this.bloxity.updateRoom(roomId);
        this.bloxityPanel.setRoom(roomId);
      },
      onPlayerAdded: (sessionId, player) => this.onPlayerAdded(sessionId, player),
      onPlayerChanged: (sessionId, player) => this.onPlayerChanged(sessionId, player),
      onPlayerRemoved: (sessionId) => this.remotePlayers.remove(sessionId),
      onSummonAdded: (key, s) => this.vfx?.addSummon(key, s.x, s.y, s.z, s.yaw),
      onSummonRemoved: (key) => this.vfx?.removeSummon(key),
      onRespawn: (message) => this.onRespawn(message),
      onNotice: (message) => this.onNotice(message),
      onCast: (message) => this.onCast(message),
      onRefused: (message) => {
        this.ready[message.slot] = this.clock + message.readyIn;
      },
      onHit: (message) => this.onHit(message),
      onDied: (message) => this.onDied(message),
      onReward: (message) => this.onReward(message),
      onProjectile: (m) => {
        this.projectileAbility.set(m.id, m.ab);
        const colors = this.colorsOf(m.ab);
        const kind = m.ab === 'wave' ? 'wave' : (ABILITIES.get(m.ab)?.vfx ?? 'orb');
        this.vfx?.projectile(m.id, kind, m.x, m.y, m.z, m.dx, m.dz, m.speed, m.range, m.radius, colors[0], colors[1]);
      },
      onProjectileEnd: (m) => {
        const ab = this.projectileAbility.get(m.id) ?? '';
        this.projectileAbility.delete(m.id);
        const view = this.colorsOf(ab);
        this.vfx?.endProjectile(m.id, m.x, m.y, m.z, m.explode, view[0], view[1], ABILITIES.get(ab)?.vfx ?? '');
        if (m.explode > 0) this.castFx?.sound('boom', m.x, m.z);
      },
      onZone: (m) => {
        const ability = ABILITIES.get(m.ab);
        const kind = ability?.vfx ?? 'rasenshuriken';
        this.vfx?.zone(m.id, kind, m.x, m.y, m.z, m.radius, m.duration, m.follow ? this.anchorOf(m.sid, false) : null, ability?.color ?? 0xffffff, ability?.color2 ?? 0xffffff);
        this.castFx?.sound(kind === 'shrine' ? 'boom' : 'wind', m.x, m.z);
      },
      onZoneEnd: (m) => {
        this.vfx?.endZone(m.id, m.x, m.y, m.z, 0xffffff);
        this.castFx?.sound('boom', m.x, m.z, 0.7);
      },
      onFx: (m) => this.onFx(m),
    });
    this.network.setTokenProvider(() => this.bloxity.getToken());
    this.network.setLookProvider(() => lookFromLegion(this.bloxity.getEquipped(), this.bloxity.getProportions()));
    this.network.setDisplayProvider(() => identityFromLegion(this.bloxity.getUser(), this.bloxity.getGuest()));
    this.bloxity.onUserChanged((user) => {
      this.network.sendAuth(this.bloxity.getToken());
      this.network.sendIdentity(identityFromLegion(user, this.bloxity.getGuest()));
    });
  }

  /** Which ability each live projectile belongs to (for its end burst's colour). */
  private readonly projectileAbility = new Map<number, string>();

  private colorsOf(ab: string): [number, number] {
    if (ab === 'wave') return [0x111111, 0xff2a2a];
    const ability = ABILITIES.get(ab);
    return ability ? [ability.color, ability.color2] : [0xffffff, 0xffffff];
  }

  private readonly onHotkey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTyping(event.target)) return;
    switch (shortcutOf(event)) {
      case 'i':
      case 'tab':
        event.preventDefault();
        this.togglePanel(this.inventory);
        break;
      case 'o':
        this.togglePanel(this.settings);
        break;
      case 'm':
        this.audio.toggleMuted();
        break;
      case 'escape':
        this.closePanels();
        this.input.look.setCursorFree(true);
        this.bloxity.showPortalMenu(true);
        break;
      default:
        break;
    }
  };

  private readonly onGesture = (): void => {
    this.audio.resume();
  };

  private get panels(): Panel[] {
    return [this.inventory, this.settings];
  }

  private closePanels(): void {
    for (const panel of this.panels) panel.setOpen(false);
  }

  private togglePanel(panel: Panel): void {
    for (const other of this.panels) if (other !== panel) other.setOpen(false);
    panel.toggle();
  }

  private play(): void {
    if (this.zone !== 'lobby' || this.dead) return;
    this.network.enterArena();
  }

  startBloxity(): void {
    this.bloxity.start();
    document.body.classList.toggle('aoe-portal-embedded', this.bloxity.embedded);
  }

  loadingStep(text: string): void {
    this.bloxity.loadingStep(text);
  }

  /** Load the rig, then build everything that needs it. */
  async initialise(): Promise<PlayerModelReport> {
    const report = await playerModelLoader.load();
    const scene = this.sceneManager.scene;
    this.world = new World();
    this.world.addTo(scene);
    this.vfx = new Vfx(scene);
    this.castFx = new CastFx(this.vfx, this.audio, () => this.localPlayer?.position ?? null);

    this.localPlayer = new LocalPlayer(this.world.collision);
    this.localPlayer.character.setKit(this.kit.id);
    this.dresser = new AvatarDresser(this.localPlayer.character);
    this.pendingAvatar?.();
    this.pendingAvatar = null;
    scene.add(this.localPlayer.character.root, this.localPlayer.character.worldRoot);
    this.camera.snapTo(this.localPlayer.position);
    this.applyKit(this.kit);
    this.hud.setLobby(true);
    this.hud.setHealth(100);
    this.hud.setYen(0);
    logger.info(SCOPE, 'world ready');
    return report;
  }

  async connect(): Promise<void> {
    await this.network.connect();
  }

  start(): void {
    this.input.attach(this.renderer.renderer.domElement);
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
  }

  stop(): void {
    this.input.detach();
    this.bloxity.gameplayEnd();
    this.bloxity.updateRoom('');
    void this.network.disconnect();
  }

  update(delta: number, _now: number): void {
    this.clock += delta;
    this.input.setSuppressed(anyPanelOpen());
    const input = this.input.sample();
    const player = this.localPlayer;
    const world = this.world;

    this.camera.setOrbit(this.input.look.yaw, this.input.look.pitch);
    this.camera.setZoom(this.input.look.zoom);

    if (player && world) {
      this.updateCasting(input.attack || this.input.look.attackHeld, input.skill, input.ultimate, player);
      player.update(delta, input, this.input.look.yaw);
      if (player.dashedEdge) {
        this.audio.play('whoosh', 0.8);
        this.vfx?.trail(this.anchorOf(this.localSessionId ?? '', true), 0xffffff, DASH.time + 0.05, 0.02, 1.6);
      }
      this.updatePedestals(player, input.interact);

      const placement = player.consumePlacement();
      if (placement !== 'none') this.camera.snapTo(player.position, placement === 'respawn');
      this.camera.setTarget(player.position);
      this.camera.setCollision(world.collision);
      this.sceneManager.followShadow(player.position.x, player.position.y, player.position.z);
      this.flushInput();
      this.playerAudio.update(delta, {
        horizontalSpeed: player.horizontalSpeed,
        isGrounded: player.isGrounded,
        verticalVelocity: player.velocity.y,
        jumpedEdge: player.jumpedEdge,
        landedEdge: player.landedEdge,
      });
      world.update(delta, this.camera.camera.position.x, this.camera.camera.position.z);
      this.updateHud(player);
    }

    this.world?.setBoards(this.network.leaderboard);
    this.remotePlayers.advance(delta, player?.position ?? null);
    for (const [key, s] of this.network.summons) this.vfx?.moveSummon(key, s.x, s.y, s.z, s.yaw, s.swings);
    this.castFx?.update(delta);
    this.vfx?.update(delta);
    this.camera.update(delta, player?.horizontalSpeed ?? 0);
    this.applyShake(delta);
    this.updateDeath(delta);
    this.tickFps(delta);
    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);
  }

  // ----------------------------------------------------------------- casting

  /**
   * An attack or ability press. Predicted at once - the animation, the effect
   * and the ability's motion (a lunge, a leap) - and sent on the next input for
   * the server to judge. The server's word is final: a refused cast resets the
   * local cooldown, and any motion is corrected by reconciliation.
   */
  private updateCasting(attack: boolean, skill: boolean, ultimate: boolean, player: LocalPlayer): void {
    if (this.dead || !this.local || anyPanelOpen()) return;
    const slot = ultimate ? ACT.ultimate : skill ? ACT.skill : attack ? ACT.attack : 0;
    if (!slot) return;
    if (player.stun > 0 || player.locked) return;
    if (this.clock < this.ready[slot]!) return;
    const kit = this.kit;
    const aim = this.aimYaw(player, slot === ACT.attack ? M1[kit.m1].range + 3 : 26);
    const anchor = this.anchorOf(this.localSessionId ?? '', true);
    if (slot === ACT.attack) {
      const godspeed = this.local.buff === 'godspeed';
      this.ready[1] = this.clock + M1[kit.m1].cooldown * (godspeed ? 0.8 : 1);
      this.combo = this.clock - this.lastSwing < 1 ? (this.combo + 1) % 3 : 0;
      this.lastSwing = this.clock;
      player.cast({ act: ACT.attack, aim, script: {} });
      const clips = M1_CLIPS[kit.m1];
      player.playAction(clips[this.combo]!, Math.max(0.3, M1[kit.m1].cooldown * 0.95));
      this.castFx?.m1(kit, this.combo, anchor);
      return;
    }
    const ability = slot === ACT.skill ? kit.skill : kit.ultimate;
    this.ready[slot] = this.clock + ability.cooldown;
    const serverDriven = ability.effect.type === 'targetBlink' || ability.effect.type === 'chainLunge';
    player.cast({ act: slot, aim, script: serverDriven ? { lock: ability.motion?.lock } : (ability.motion ?? {}) });
    player.playAction(ABILITY_CLIPS[ability.anim], ability.animTime);
    this.castFx?.ability(ability, anchor, true);
  }

  private combo = 0;
  private lastSwing = -10;

  /**
   * Where a press is aimed: the camera's heading, nudged onto an enemy inside
   * a narrow cone and in reach - aim assist that helps a thumb on a phone as
   * much as a mouse, without ever turning round to find someone.
   */
  private aimYaw(player: LocalPlayer, reach: number): number {
    const yaw = this.input.look.yaw;
    if (this.zone !== 'arena') return yaw;
    let best = yaw;
    let bestScore = Infinity;
    for (const [, remote] of this.remotePlayers.all()) {
      if (remote.dead || remote.zone !== 'arena') continue;
      const p = remote.drawn;
      const dx = p.x - player.position.x;
      const dz = p.z - player.position.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || Math.abs(p.y - player.position.y) > 6) continue;
      const toward = Math.atan2(dx, dz);
      let off = toward - yaw;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      const limit = d < 8 ? 0.9 : 0.4;
      if (Math.abs(off) > limit) continue;
      const score = Math.abs(off) * 10 + d;
      if (score < bestScore) {
        bestScore = score;
        best = toward;
      }
    }
    return best;
  }

  /** A live position for effects that ride a player. */
  private anchorOf(sid: string, local: boolean): Anchor {
    return () => {
      if (local || sid === this.localSessionId) {
        const p = this.localPlayer;
        return p ? { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw } : null;
      }
      const remote = this.remotePlayers.get(sid);
      if (!remote) return null;
      const d = remote.drawn;
      return { x: d.x, y: d.y, z: d.z, yaw: remote.character.root.rotation.y };
    };
  }

  // ----------------------------------------------------------------- lobby

  /** Walk up to a pedestal: a prompt to unlock or equip its kit. F (or tapping the prompt) does it. */
  private updatePedestals(player: LocalPlayer, interact: boolean): void {
    this.nearKit = null;
    if (this.zone !== 'lobby' || !this.local) {
      this.hud.setPrompt(null);
      return;
    }
    const x = player.position.x;
    const z = player.position.z;
    let nearest: KitDef | null = null;
    let nearestD = PEDESTAL.half + 4.5;
    for (const kit of KITS) {
      if (kit.pedestal < 0) continue;
      const at = pedestalAt(kit.pedestal);
      const d = Math.hypot(at.x - x, at.z - z);
      if (d < nearestD) {
        nearestD = d;
        nearest = kit;
      }
    }
    const atEquip = Math.hypot(EQUIP_PEDESTAL.x - x, EQUIP_PEDESTAL.z - z) < 7;
    if (!nearest) {
      if (atEquip) {
        this.hud.setPrompt('Open Inventory', 'plain');
        if (interact) this.togglePanel(this.inventory);
      } else this.hud.setPrompt(null);
      return;
    }
    this.nearKit = nearest.id;
    const owned = Array.from(this.local.ownedKits).includes(nearest.id);
    if (!owned) {
      const afford = this.local.yen >= nearest.price;
      this.hud.setPrompt(`Unlock ${nearest.name} - ${formatYen(nearest.price)}`, afford ? 'buy' : 'poor');
      if (interact) {
        if (afford) this.network.buyKit(nearest.id);
        else this.inventory.openOn(nearest.id);
      }
    } else if (this.local.kit === nearest.id) {
      this.hud.setPrompt(`${nearest.name} is equipped`, 'plain');
      if (interact) this.inventory.openOn(nearest.id);
    } else {
      this.hud.setPrompt(`Equip ${nearest.name}`, 'buy');
      if (interact) this.network.equipKit(nearest.id);
    }
  }

  // --------------------------------------------------------------- the HUD

  private updateHud(player: LocalPlayer): void {
    const kit = this.kit;
    const m1 = M1[kit.m1].cooldown;
    this.setCooldown('attack', this.ready[1]! - this.clock, m1);
    this.setCooldown('skill', this.ready[2]! - this.clock, kit.skill.cooldown);
    this.setCooldown('ultimate', this.ready[3]! - this.clock, kit.ultimate.cooldown);
    const dashTotal = DASH.cooldown * (this.local?.dashCdMul ?? 1);
    this.setCooldown('dash', player.dashCooldown, dashTotal);
    this.hud.setCooldown('jump', 0, 0);
    const local = this.local;
    if (local?.buff) {
      const left = Math.max(0, local.buffEnds - this.network.elapsed);
      this.hud.setBuff(BUFFS[local.buff as BuffId]?.name ?? null, left);
    } else this.hud.setBuff(null, 0);
  }

  private setCooldown(slot: 'attack' | 'skill' | 'ultimate' | 'dash', remaining: number, total: number): void {
    const left = Math.max(0, remaining);
    this.hud.setCooldown(slot, left, total);
    this.input.touch.setCooldown(slot, left, total);
  }

  private applyKit(kit: KitDef): void {
    this.kit = kit;
    this.hud.setKit(kit);
    this.input.touch.setAbilityNames(kit.skill.name, kit.ultimate.name);
    this.localPlayer?.character.setKit(kit.id);
    this.ready.fill(0);
  }

  // ---------------------------------------------------------------- events

  private flushInput(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const message of player.drainOutgoing()) this.network.sendInput(message);
  }

  private onRespawn(message: RespawnMessage): void {
    this.localPlayer?.teleport(message.x, message.y, message.z, message.rotationY);
    this.input.look.setYaw(message.rotationY);
    this.ready.fill(0);
    if (message.reason === 'arena') {
      this.hud.whiteFlash();
      this.audio.play('portal');
      this.hud.zoneTitle('THE ARENA');
    } else if (message.reason === 'death' || message.reason === 'manual') {
      this.hud.zoneTitle('SPAWN ISLAND');
    }
    if (message.reason !== 'arena' && message.reason !== 'fall') {
      this.hud.hideBanner();
      this.hud.setDeathVeil(false);
    }
  }

  private onCast(message: CastMessage): void {
    if (message.sid === this.localSessionId) return;
    const remote = this.remotePlayers.get(message.sid);
    const kit = kitById(message.kit);
    if (!remote || !kit || !this.remotePlayers.isDrawn(message.sid)) return;
    const anchor = this.anchorOf(message.sid, false);
    if (message.slot === ACT.attack) {
      const clip = M1_CLIPS[kit.m1][message.combo % 3]!;
      remote.playAction(clip, Math.max(0.3, M1[kit.m1].cooldown * 0.95), message.yaw);
      this.castFx?.m1(kit, message.combo, anchor);
      return;
    }
    const ability = message.slot === ACT.skill ? kit.skill : kit.ultimate;
    remote.playAction(ABILITY_CLIPS[ability.anim], ability.animTime, message.yaw);
    this.castFx?.ability(ability, anchor, false);
  }

  private onHit(message: HitMessage): void {
    const me = this.localSessionId;
    const heavy = message.dmg >= 14 || Math.hypot(message.kx, message.kz) > 50;
    let x = message.x;
    let y = message.y;
    let z = message.z;
    const remote = message.v !== me ? this.remotePlayers.get(message.v) : null;
    if (remote) {
      x = remote.drawn.x;
      y = remote.drawn.y + EYE;
      z = remote.drawn.z;
    } else if (message.v === me && this.localPlayer) {
      x = this.localPlayer.position.x;
      y = this.localPlayer.position.y + EYE;
      z = this.localPlayer.position.z;
    }
    if (message.blocked) {
      this.vfx?.burst(x, y, z, 0x9fdcff, 2.4, 0.2);
      this.castFx?.sound('block', x, z);
      if (message.a === me) this.popDamage(x, y + 1, z, 0, 'blocked');
      return;
    }
    const attackerKit = kitById(message.a === me ? this.kit.id : (this.network.player(message.a)?.kit ?? ''));
    const color = ABILITIES.get(message.src)?.color ?? 0xffffff;
    this.vfx?.hitSpark(x, y, z, heavy, color === 0x0a0a0a || color === 0x0d0d0d ? 0xff2040 : 0xffffff);
    const blade = message.src === 'm1' && attackerKit && attackerKit.weapon !== 'none';
    this.castFx?.sound(blade ? 'swing' : 'punch', x, z, heavy ? 1 : 0.8);
    if (message.v === me) {
      this.hud.hurtFlash();
      this.shake = Math.max(this.shake, heavy ? 0.9 : 0.5);
      this.popDamage(x, y + 0.6, z, message.dmg, 'me');
    } else if (message.a === me) {
      this.hud.hitMarker();
      this.shake = Math.max(this.shake, heavy ? 0.45 : 0.2);
      this.popDamage(x, y + 1, z, message.dmg, heavy ? 'big' : 'normal');
    }
  }

  private popDamage(x: number, y: number, z: number, amount: number, kind: 'normal' | 'big' | 'me' | 'blocked'): void {
    PROJECTED.set(x, y, z).project(this.camera.camera);
    if (PROJECTED.z > 1) return;
    const sx = (PROJECTED.x * 0.5 + 0.5) * this.renderer.width;
    const sy = (-PROJECTED.y * 0.5 + 0.5) * this.renderer.height;
    this.hud.damage(sx, sy, amount, kind);
  }

  private onDied(message: DiedMessage): void {
    const me = this.localSessionId;
    this.hud.killFeed(message.kName, message.vName, message.cause === 'fall', message.v === me || message.k === me);
    this.vfx?.puff(message.x, message.y + 1.5, message.z, 0x222233, 5, 1, 3, 1, 0.7);
    this.castFx?.sound('death', message.x, message.z, 0.8);
    if (message.v === me) {
      this.dead = true;
      this.deathTimer = 3;
      const how = message.cause === 'fall' ? (message.kName ? `Knocked off by ${message.kName}` : 'You fell off the island') : `Defeated by ${message.kName || 'someone'}`;
      this.hud.showBanner('YOU DIED', how, true);
      this.hud.setDeathVeil(true);
      if (message.cause === 'fall') this.audio.play('fall');
    }
    if (message.k === me) {
      this.shake = Math.max(this.shake, 0.4);
      this.hud.callout(message.cause === 'fall' ? 'KNOCKED OUT!' : 'K.O.!');
    }
  }

  private updateDeath(delta: number): void {
    if (!this.dead) return;
    this.deathTimer = Math.max(0, this.deathTimer - delta);
    this.hud.setBannerSub(this.deathTimer > 0 ? `Respawning in ${Math.ceil(this.deathTimer)}...` : 'Respawning...');
  }

  private onReward(message: RewardMessage): void {
    this.hud.gain(message.yen, message.reason === 'kill');
    this.audio.play('coin', message.reason === 'kill' ? 1 : 0.5);
    if (message.reason === 'kill' && message.streak !== this.lastStreak) {
      this.lastStreak = message.streak;
      const callout = STREAK_CALLOUTS[message.streak];
      if (callout) window.setTimeout(() => this.hud.callout(callout), 900);
    }
  }

  private onFx(message: FxMessage): void {
    const [c, c2] = this.colorsOf(message.ab);
    this.castFx?.fx(message, c, c2);
    if (message.kind === 'teleport' && message.sid === this.localSessionId) this.audio.play('whoosh');
  }

  private onNotice(message: NoticeMessage): void {
    switch (message.kind) {
      case 'unlocked':
        this.audio.play('unlock');
        if (message.kit) this.hud.showAlert(message.kit, message.text);
        break;
      case 'equipped':
        this.audio.play('buy');
        this.hud.toast(message.text, 'good');
        break;
      case 'bought':
        this.audio.play('unlock');
        this.hud.toast(message.text, 'gold');
        break;
      case 'info':
        this.hud.toast(message.text, 'gold');
        break;
      case 'refused':
        this.audio.play('refuse');
        this.hud.toast(message.text, 'bad');
        break;
    }
  }

  private onPlayerAdded(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.add(sessionId, state);
    this.bloxity.playerJoined(sessionId);
    this.bloxity.playerInRoom(sessionId);
  }

  private onPlayerChanged(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.update(sessionId, state);
  }

  /** Everything the server says about the local player. It derives none of it. */
  private applyLocalState(state: NetPlayerState): void {
    const player = this.localPlayer;
    if (!player) return;
    this.local = state;

    player.setParams(state.moveSpeed, state.dashCdMul);
    player.setDead(state.dead);
    player.setDisplayName(state.displayName, state.avatarUrl);
    player.plate.setHealth(-1);
    // Your own name is not drawn over your head: it only blocks the view.
    player.plate.sprite.visible = false;
    if (state.ready) player.reconcile(state);
    if (!state.dead && this.dead) {
      this.dead = false;
      this.hud.hideBanner();
      this.hud.setDeathVeil(false);
    }

    if (state.kit !== this.kit.id) {
      const kit = kitById(state.kit);
      if (kit) this.applyKit(kit);
    }
    if (state.zone !== this.zone) {
      this.zone = state.zone;
      this.hud.setLobby(state.zone === 'lobby');
      if (state.zone === 'lobby') this.lastStreak = 0;
    }
    player.character.setBuff((state.buff || '') as BuffId | '');
    player.character.setShield(state.shield);
    player.character.setCounter(state.counter);
    this.hud.setHealth(state.hp);
    this.hud.setYen(state.yen);
    const owned = Array.from(state.ownedKits);
    this.world?.setOwnership(owned, state.kit);
    this.inventory.setState(owned, state.kit, state.pendingKit, state.yen);
  }

  private applyShake(delta: number): void {
    if (this.shake <= 0) return;
    const amount = this.shake * this.shake * 0.8;
    const cam = this.camera.camera;
    cam.position.x += (Math.random() - 0.5) * amount;
    cam.position.y += (Math.random() - 0.5) * amount;
    cam.position.z += (Math.random() - 0.5) * amount;
    this.shake = Math.max(0, this.shake - delta * 2.6);
  }

  private onStatusChange(status: ConnectionStatus): void {
    if (clientConfig.debug) logger.info(SCOPE, `connection: ${status}`);
    if (status === 'disconnected' || status === 'error') this.hud.toast('Disconnected from the server - reload to rejoin', 'bad');
  }

  private tickFps(delta: number): void {
    if (this.fpsReadout.hidden) return;
    this.fpsAccum += delta;
    this.fpsFrames += 1;
    if (this.fpsAccum < 0.5) return;
    this.fpsReadout.textContent = `${Math.round(this.fpsFrames / this.fpsAccum)} FPS`;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
  }

  dispose(): void {
    this.stop();
    for (const panel of this.panels) panel.dispose();
    this.hud.dispose();
    window.removeEventListener('keydown', this.onHotkey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('mousedown', this.onGesture);
    window.removeEventListener('touchstart', this.onGesture);
    this.bloxity.dispose();
    this.bloxityPanel.dispose();
    this.dresser?.dispose();
    this.fpsReadout.remove();
    this.audio.dispose();
    this.remotePlayers.dispose();
    this.vfx?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
  }
}
