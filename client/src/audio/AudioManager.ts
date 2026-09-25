import { logger } from '../util/logger.js';

const SCOPE = 'audio';

/**
 * Master volumes per category. Music sits well under the gameplay sounds.
 * Music sits under the slash, which cuts through it.
 */
const MUSIC_GAIN = 0.45;
const SFX_GAIN = 0.34;

/**
 * THE WALK HAS ITS OWN BUS, and that is the whole reason it can be heard.
 *
 * `SFX_GAIN` is deliberately low because it holds down a CROWD: a dozen
 * one-shot blips, thuds and arpeggios that may all fire at once, and the
 * ceiling that keeps them from piling into distortion is the same ceiling that
 * kept the one continuous sound in the game at a whisper. The walk is not a
 * blip - it is the machine the player is riding, playing for as long as they
 * are moving - so it is mixed on its own and answers to nothing but this.
 *
 * Raising `SFX_GAIN` instead would have shouted every menu click in the game.
 */
const WALK_GAIN = 0.9;

/*
 * THE SUPPLIED FILES, and everything else synthesised.
 *
 * The asset set ships the background music, a slash and a fall, and those are
 * used as they are. Every other
 * sound - the hit, the jingles - is built from oscillators and noise, which
 * costs bytes measured in hundreds against the 12 MB budget.
 *
 * The TRACK is streamed through `<audio>` elements rather than decoded into a
 * buffer (a decoded three-minute track is tens of megabytes of memory), and
 * still routes through `musicBus`, so the portal's music volume, the master
 * volume and mute all work on it. An element's own `loop` leaves an audible
 * gap at the seam of an MP3 (its encoder padding), so the track loops by
 * CROSSFADING two elements instead: `MUSIC_CROSSFADE` seconds before the end
 * the other one starts from the top and the two trade places.
 */

/** The supplied background track. Streamed, never decoded. */
const MUSIC_URL = '/audio/music.mp3';
/** Seconds the end of one pass and the start of the next overlap. */
const MUSIC_CROSSFADE = 1.6;

/** The supplied one-shots, by the sound they stand in for. */
const SAMPLE_URLS: Partial<Record<SoundName, string>> = {
  // Falling off the island.
  fall: '/audio/fall.mp3',
  // A blade swing.
  swing: '/audio/katana.mp3',
  // A fist landing.
  punch: '/audio/punch.mp3',
  jump: '/audio/jump.mp3',
  // A kill / the local player's death.
  death: '/audio/death.mp3',
};

/**
 * Levels of the supplied one-shots, on the SFX bus (x `SFX_GAIN`). Set from the
 * files' measured loudness (katana -18.6, enemy death -19.4, fall -22.1 dBFS
 * RMS) so each lands at about the music's RMS with its transient well above
 * the music's peaks: a slash is heard over the track, never buried in it.
 */
const SAMPLE_GAIN: Partial<Record<SoundName, number>> = {
  swing: 1.4,
  punch: 1.6,
  kill: 1.8,
  death: 2.2,
};

/**
 * Most one-shot voices allowed to sound at once.
 *
 * A ceiling rather than a hope. Web Audio nodes are one-shot by design - a
 * source cannot be replayed, so every sound is a new node - and the thing that
 * has to be bounded is therefore how many are alive at any moment, not how
 * many are ever made. Beyond this, a request is dropped rather than queued:
 * the twelfth simultaneous footfall is inaudible anyway.
 */
const MAX_VOICES = 12;

/** Keep a slider inside 0..1 whatever the portal sent. */
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;

/** Seconds a given sound refuses to retrigger, so nothing can machine-gun. */
const COOLDOWNS: Readonly<Record<SoundName, number>> = {
  // Held-down or auto-click swings arrive every 0.2-0.25 s: one slash each, never a pile.
  swing: 0.12,
  hit: 0.06,
  kill: 0.15,
  death: 1.5,
  jump: 0.15,
  fall: 0.6,
  land: 0.14,
  step: 0.12,
  win: 0.4,
  level: 0.4,
  rebirth: 0.8,
  clear: 0.6,
  unlock: 0.3,
  buy: 0.3,
  refuse: 0.4,
  hatch: 0.5,
  punch: 0.05,
  whoosh: 0.08,
  boom: 0.12,
  zap: 0.08,
  charge: 0.3,
  coin: 0.05,
  portal: 0.8,
  block: 0.1,
  fire: 0.15,
  wind: 0.2,
};

export type SoundName =
  /** The cutter sweeping through the grass. */
  | 'swing'
  /** The cutter biting into tough grass. */
  | 'hit'
  /** An enemy falling. */
  | 'kill'
  | 'jump'
  | 'fall'
  /** The local player falling in battle. */
  | 'death'
  | 'land'
  /** One footfall. */
  | 'step'
  | 'win'
  | 'level'
  | 'rebirth'
  /** A stage wave cleared. */
  | 'clear'
  /** A cutter, aura or upgrade bought. */
  | 'unlock'
  /** Something equipped. */
  | 'buy'
  | 'refuse'
  /** An egg cracking open. */
  | 'hatch'
  /** A fist landing. */
  | 'punch'
  /** A dash, a lunge, a blink. */
  | 'whoosh'
  /** An explosion or a slam. */
  | 'boom'
  /** Lightning. */
  | 'zap'
  /** An ability charging up. */
  | 'charge'
  /** Yen earned. */
  | 'coin'
  /** Through the portal. */
  | 'portal'
  /** A hit absorbed. */
  | 'block'
  | 'fire'
  | 'wind';

/**
 * Every sound in the game, synthesised.
 *
 * EVERY sound is synthesised - oscillators and envelopes cost bytes measured
 * in the hundreds, and a pack of wavs is the easiest way to spend the 12 MB
 * budget. There is no music and there are no samples: this build ships not one
 * audio file.
 *
 * THREE rules hold the whole thing together:
 *
 *  - ONE context, ONE music voice. The `started` flag and the single
 *    `startMusic` call are what make a doubled track impossible rather than
 *    merely unlikely.
 *  - ONE-SHOTS ARE BOUNDED, twice: a per-sound cooldown stops the same effect
 *    retriggering every frame, and a hard voice ceiling stops the mix from
 *    ever containing more than a dozen of them.
 *  - ONLY THE LOCAL PLAYER makes noise. A busy room would otherwise put the
 *    footfalls, the leaps and the deaths of every other pilot into a mix the
 *    player is trying to hear their own machine in.
 *
 * Nothing here starts until the player's first gesture: browsers refuse to run
 * an AudioContext before one, and a context created earlier merely sits
 * suspended and confuses everything downstream.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  /** The walking loop's own bus. See `WALK_GAIN`. */
  private walkBus: GainNode | null = null;
  /** The safety limiter every bus passes through. See `resume`. */
  private limiter: DynamicsCompressorNode | null = null;

  /** Live one-shot voices, so the ceiling can be enforced. */
  private voices = 0;
  /** Wall-clock of the last play, per sound. */
  private readonly lastPlayed = new Map<SoundName, number>();

  /**
   * The music, as a streaming element rather than a decoded buffer.
   *
   * `decodeAudioData` would hold the whole track in memory uncompressed - a
   * three-minute stereo file is over thirty megabytes once decoded, for
   * something that is only ever played start to finish. An element streams it,
   * loops it natively, and still routes through Web Audio, which is what keeps
   * the portal's music slider and the mute working.
   */
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  /** The two crossfading voices of the track, and which one is playing now. */
  private musicVoices: { element: HTMLAudioElement; gain: GainNode; source: MediaElementAudioSourceNode }[] = [];
  private musicCurrent = 0;
  private musicFading = false;
  private musicTimer = 0;

  /**
   * Decoded one-shot samples, by name.
   *
   * A sound is only in here once it has actually decoded, which is what makes
   * the fallback in `play` a simple lookup: until then - and for ever, if the
   * file is missing or the fetch is blocked - the synthesised voice is used
   * instead, so a blocked asset is a different sound rather than silence.
   */
  private readonly samples = new Map<SoundName, AudioBuffer>();
  /** Set once the fetches have been kicked off, so they happen exactly once. */
  private samplesRequested = false;

  /**
   * The sampled sound currently playing, per name. At most ONE each.
   *
   * The cooldowns were tuned against the synthesised voices, every one of which
   * was SHORTER than its own cooldown - the death lasted 0.5s behind a 0.6s
   * cooldown - so a one-shot could never catch its own tail. The recorded files
   * are far longer (both about 1.8s), which quietly breaks that: two deaths
   * 0.7s apart would clear the cooldown and sound on top of each other, and
   * jumps would stack until they hit the voice ceiling.
   *
   * So a sampled sound REPLACES itself rather than layering. The trigger and
   * the gain are untouched - every jump still plays the jump - it simply
   * restarts instead of doubling, which is what keeps "no overlapping deaths"
   * true now that the sound outlasts its cooldown.
   */
  private readonly activeSamples = new Map<SoundName, { source: AudioBufferSourceNode; envelope: GainNode }>();

  /**
   * THE WALKING LOOP, and it is a loop rather than a one-shot per stride.
   *
   * The supplied `robot steps.mp3` is nearly three seconds of a mech WALKING -
   * several footfalls, not one - so firing it on every stride would restart it
   * before it had played its first step and the mech would sound like it was
   * stuttering on one foot. Looped instead, with its playback rate tied to the
   * pace, it is what it was recorded as: the sound of the machine walking, for
   * as long as the machine is walking.
   *
   * It is deliberately NOT counted against `voices`. That ceiling exists to
   * bound how many one-shots can pile up; this is one node whose lifetime is
   * "while the player is moving", and letting it be dropped by a busy moment
   * would silence the feet for the rest of the walk.
   */
  private footsteps: AudioBufferSourceNode | null = null;
  private footstepGain: GainNode | null = null;

  private muted = false;
  private started = false;

  /** The portal's master and music sliders, 0..1. Both default to full. */
  private masterLevel = 1;
  private musicLevel = 1;

  /**
   * Bring the audio up, on a real user gesture.
   *
   * Safe to call repeatedly - it is wired to every gesture precisely because
   * no single one of them is guaranteed to be the one the browser accepts.
   */
  resume(): void {
    if (this.muted) return;
    if (!this.context) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
      } catch (error) {
        logger.warn(SCOPE, `no audio context: ${String(error)}`);
        return;
      }

      this.master = this.context.createGain();
      // Built at the level the portal has ALREADY set: settings arrive before
      // the first user gesture, so a context created at full volume would be
      // loud for exactly as long as it took the next slider change to arrive.
      this.master.gain.value = this.muted ? 0 : this.masterLevel;

      /*
       * A SAFETY LIMITER, and it is what buys the mix its headroom.
       *
       * Web Audio's destination HARD CLIPS at plus or minus one. Without
       * something at the end of the chain, every level in this file has to be
       * chosen so that the loudest possible sum of music, walk and a dozen
       * one-shots still lands under that - which is why everything was pinned
       * so low that the mech could not be heard walking. This catches the
       * coincidences instead, so each sound can be set at the level it should
       * be rather than at the level the worst case allows.
       *
       * It sits AFTER the master gain, so mute and the portal's volume slider
       * work exactly as they did: at zero, nothing reaches it at all.
       *
       * Conservative on purpose, and the threshold is CHOSEN rather than
       * guessed: with the portal's sliders at maximum the music track peaks at
       * about -5 dBFS on its own, so a threshold below that would have the
       * limiter riding the soundtrack all the time. At -3 it is untouched by
       * any single source and only ever catches a sum.
       */
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 4;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.master.connect(this.limiter);
      this.limiter.connect(this.context.destination);

      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = MUSIC_GAIN * this.musicLevel;
      this.musicBus.connect(this.master);

      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = SFX_GAIN;
      this.sfxBus.connect(this.master);

      this.walkBus = this.context.createGain();
      this.walkBus.gain.value = WALK_GAIN;
      this.walkBus.connect(this.master);
    }

    void this.context.resume().catch(() => undefined);

    if (!this.started) {
      this.started = true;
      this.startMusic();
      this.loadSamples();
      logger.info(SCOPE, 'audio started');
    }

    // A tab that was backgrounded pauses the element; resuming has to restart
    // it, and `play()` on an already-playing element is a no-op.
    if (this.musicElement && !this.muted) {
      void this.musicElement.play().catch(() => undefined);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Silence everything, or bring it back. The music keeps its own time. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    // The loop is the one voice that would otherwise keep running: master gain
    // silences it, but a muted game should not be holding a source open.
    if (muted) this.stopFootsteps();
    this.applyMaster();
  }

  /**
   * The portal's master volume, 0..1.
   *
   * Kept SEPARATE from mute rather than folded into it: they are two different
   * statements - "I set this to 30%" and "silence, now" - and a mute that
   * overwrote the level would hand back the wrong one when it lifted. The
   * master gain is the product of the two, so unmuting restores whatever the
   * slider said.
   */
  setMasterVolume(level: number): void {
    this.masterLevel = clamp01(level);
    this.applyMaster();
  }

  /** The portal's music volume, 0..1, against the game's own tuned mix. */
  setMusicVolume(level: number): void {
    this.musicLevel = clamp01(level);
    if (this.musicBus && this.context) {
      this.musicBus.gain.setTargetAtTime(
        MUSIC_GAIN * this.musicLevel,
        this.context.currentTime,
        0.05,
      );
    }
  }

  private applyMaster(): void {
    if (this.master && this.context) {
      const target = this.muted ? 0 : this.masterLevel;
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
    }

    // A muted stream is PAUSED, not merely silenced. Leaving it running would
    // keep decoding a file nobody can hear, and on a phone that is battery
    // spent on nothing.
    const element = this.musicElement;
    if (!element) return;
    if (this.muted) {
      for (const voice of this.musicVoices) voice.element.pause();
    } else {
      void element.play().catch(() => undefined);
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Play a one-shot.
   *
   * Refused if the same sound played within its cooldown, or if the voice
   * ceiling is already reached. Both refusals are silent: a sound that cannot
   * be heard is not an error.
   */
  /**
   * Drive the walking loop.
   *
   * @param active true while the mech is on the ground and actually moving
   * @param pace   0..1, how fast it is going as a fraction of its own top
   * @returns false when there is no recording to play, so the caller can fall
   *          back to the synthesised per-stride footfall instead
   *
   * Called every frame. Starting, stopping and re-rating are all idempotent,
   * because the caller has no business tracking which of those it did last.
   */
  setFootsteps(active: boolean, pace: number): boolean {
    const ctx = this.context;
    // ITS OWN BUS, not the one-shot bus. See `WALK_GAIN`.
    const bus = this.walkBus;
    const buffer = this.samples.get('step');
    if (!ctx || !bus || !buffer) {
      this.stopFootsteps();
      return false;
    }
    if (!active || this.muted || ctx.state !== 'running') {
      this.stopFootsteps();
      return true;
    }

    if (!this.footsteps || !this.footstepGain) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const envelope = ctx.createGain();
      // From silence, so setting off never begins with a click.
      envelope.gain.value = 0;
      source.connect(envelope);
      envelope.connect(bus);
      source.start();
      this.footsteps = source;
      this.footstepGain = envelope;
    }

    /*
     * Pace changes the RATE, within a band a recording can be stretched over
     * without sounding like a different machine.
     *
     * The same reasoning as the animation's cadence clamp: a late-game mech
     * covers four hundred units a second and an unclamped cadence is a tone
     * rather than a walk. The sense of speed comes from the world going past.
     */
    const level = clamp01(pace);
    const now = ctx.currentTime;
    // Under 1 across the whole band: the recording's own cadence is quicker
    // than this mech's, and the gait it has to agree with is a slow one.
    this.footsteps.playbackRate.setTargetAtTime(0.6 + level * 0.35, now, 0.08);
    /*
     * LOUD ENOUGH TO BE THE MACHINE YOU ARE RIDING.
     *
     * The arithmetic is the reason rather than taste. The walk recording and
     * the music track are within half a decibel of each other (-12.3 dBFS RMS
     * against -11.9), so whatever each is multiplied by IS the balance between
     * them - and the music reaches the master at MUSIC_GAIN, 0.55. A walk that
     * only matches that figure does not read as loud: the music is broadband
     * and the walk is mostly low end, so at equal level the track MASKS it.
     * It has to sit clearly ABOVE the music to be heard as what it is.
     *
     * The band is narrow on purpose. A mech walking slowly is still a mech
     * walking; this is not a fade, it is the difference between a stroll and a
     * full stride.
     */
    this.footstepGain.gain.setTargetAtTime(0.72 + level * 0.28, now, 0.05);
    return true;
  }

  /** Stop the walking loop, fading out so it does not click. */
  private stopFootsteps(): void {
    const source = this.footsteps;
    const envelope = this.footstepGain;
    this.footsteps = null;
    this.footstepGain = null;
    if (!source) return;
    const ctx = this.context;
    if (envelope && ctx) {
      const now = ctx.currentTime;
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
      envelope.gain.linearRampToValueAtTime(0, now + 0.06);
      try {
        source.stop(now + 0.08);
      } catch {
        // Already stopped; nothing to do.
      }
      return;
    }
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }

  play(name: SoundName, intensity = 1): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < COOLDOWNS[name]) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    const level = Math.min(Math.max(intensity, 0), 1);
    switch (name) {
      case 'swing':
        if (this.playSample('swing', now, (SAMPLE_GAIN.swing ?? 0.6) * (0.75 + level * 0.25))) break;
        // A bright whoosh: filtered noise swept down, with a thin metallic ring.
        this.noise(now, 0.16, 5200, 900, 0.32 * level);
        this.blip(now, 'triangle', 1800, 1200, 0.08, 0.06 * level);
        break;
      case 'hit':
        this.thud(now, 0.5 * level, 180);
        this.noise(now, 0.08, 3000, 1200, 0.35 * level);
        this.blip(now, 'square', 520, 260, 0.07, 0.12 * level);
        break;
      case 'kill':
        if (this.playSample('kill', now, SAMPLE_GAIN.kill ?? 0.8)) break;
        this.thud(now, 0.7, 110);
        this.arpeggio(now + 0.02, [0, 7, 12], 0.05, 'triangle', 0.35);
        break;
      case 'jump':
        if (this.playSample('jump', now, 0.55 * level)) break;
        this.blip(now, 'sine', 300, 720, 0.14, 0.3 * level);
        break;
      case 'fall':
        if (this.playSample('fall', now, 0.5)) break;
        this.thud(now, 0.7, 90);
        break;
      case 'death':
        if (this.playSample('death', now, SAMPLE_GAIN.death ?? 0.75)) break;
        this.thud(now, 0.8, 80);
        this.blip(now + 0.05, 'triangle', 420, 90, 0.6, 0.3);
        break;
      case 'refuse':
        this.blip(now, 'square', 220, 150, 0.16, 0.25);
        break;
      case 'land':
        this.thud(now, 0.25 + level * 0.25);
        break;
      case 'step':
        this.thud(now, 0.06 + level * 0.08, 150);
        break;
      case 'win':
        this.arpeggio(now, [0, 4, 7, 12], 0.09, 'triangle', 0.5);
        break;
      case 'level':
        this.arpeggio(now, [0, 7, 12], 0.07, 'triangle', 0.4);
        break;
      case 'rebirth':
        this.arpeggio(now, [0, 4, 7, 12, 16, 19], 0.08, 'sawtooth', 0.45);
        break;
      case 'clear':
        this.arpeggio(now, [0, 5, 9, 12, 17], 0.07, 'triangle', 0.45);
        break;
      case 'unlock':
        this.arpeggio(now, [0, 4, 7, 12, 16], 0.06, 'triangle', 0.4);
        break;
      case 'buy':
        this.arpeggio(now, [0, 7, 12], 0.05, 'square', 0.3);
        break;
      case 'hatch':
        this.noise(now, 0.2, 2400, 600, 0.3);
        this.arpeggio(now + 0.18, [0, 4, 7, 11, 14], 0.07, 'triangle', 0.45);
        break;
      case 'punch':
        if (this.playSample('punch', now, (SAMPLE_GAIN.punch ?? 1) * (0.6 + level * 0.4))) break;
        this.thud(now, 0.6 * level, 140);
        this.noise(now, 0.06, 2600, 900, 0.3 * level);
        break;
      case 'whoosh':
        this.noise(now, 0.22, 900, 3600, 0.3 * level);
        break;
      case 'boom':
        this.thud(now, 0.9 * level, 70);
        this.noise(now, 0.45, 1400, 120, 0.55 * level);
        break;
      case 'zap':
        this.noise(now, 0.12, 7000, 2500, 0.3 * level);
        this.blip(now, 'sawtooth', 1400, 300, 0.12, 0.1 * level);
        break;
      case 'charge':
        this.blip(now, 'sawtooth', 160, 900, 0.45, 0.08 * level);
        this.noise(now, 0.45, 400, 3000, 0.12 * level);
        break;
      case 'coin':
        this.arpeggio(now, [12, 19], 0.045, 'triangle', 0.18 * level);
        break;
      case 'portal':
        this.noise(now, 0.6, 300, 5000, 0.3);
        this.arpeggio(now + 0.05, [0, 7, 12, 19, 24], 0.06, 'sine', 0.35);
        break;
      case 'block':
        this.blip(now, 'square', 1500, 1300, 0.08, 0.12);
        this.blip(now, 'triangle', 2200, 2100, 0.12, 0.1);
        break;
      case 'fire':
        this.noise(now, 0.4, 600, 200, 0.45 * level);
        this.thud(now, 0.4 * level, 90);
        break;
      case 'wind':
        this.noise(now, 0.5, 400, 1600, 0.35 * level);
        break;
    }
  }

  dispose(): void {
    window.clearInterval(this.musicTimer);
    for (const voice of this.musicVoices) {
      voice.element.pause();
      // Dropping the src releases the network request and the decoder; an
      // element left holding a stream keeps both alive after the game is gone.
      voice.element.removeAttribute('src');
      voice.element.load();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.musicVoices = [];
    this.musicSource?.disconnect();
    this.musicSource = null;
    this.musicElement = null;
    this.samples.clear();
    this.activeSamples.clear();
    this.samplesRequested = false;
    this.started = false;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.stopFootsteps();
    this.sfxBus = null;
    this.walkBus = null;
    this.limiter = null;
  }

  // -------------------------------------------------------------- the music

  /**
   * Start the background track.
   *
   * Called exactly once, from behind the `started` flag, which is what makes a
   * doubled tune impossible rather than merely unlikely. A failure here is
   * SILENT on purpose: a blocked or missing track is a game without music, not
   * a game that stops.
   */
  private startMusic(): void {
    const ctx = this.context;
    const bus = this.musicBus;
    if (!ctx || !bus || this.musicElement) return;

    try {
      for (let i = 0; i < 2; i += 1) {
        const element = new Audio(MUSIC_URL);
        element.loop = false;
        // Same-origin, but stated anyway: without it the element is tainted and
        // `createMediaElementSource` produces silence rather than an error.
        element.crossOrigin = 'anonymous';
        element.preload = i === 0 ? 'auto' : 'metadata';
        const source = ctx.createMediaElementSource(element);
        const gain = ctx.createGain();
        gain.gain.value = i === 0 ? 1 : 0;
        source.connect(gain);
        gain.connect(bus);
        // A pass that reaches its end without a crossfade (a throttled tab) starts over at once.
        element.addEventListener('ended', () => {
          if (this.musicVoices[this.musicCurrent]?.element === element && !this.muted) {
            element.currentTime = 0;
            void element.play().catch(() => undefined);
          }
        });
        this.musicVoices.push({ element, gain, source });
      }
    } catch (error) {
      logger.warn(SCOPE, `music not routed: ${String(error)}`);
      this.musicVoices = [];
      return;
    }

    this.musicCurrent = 0;
    this.musicElement = this.musicVoices[0]!.element;
    this.musicSource = this.musicVoices[0]!.source;
    this.musicTimer = window.setInterval(() => this.tickMusic(), 200);
    if (!this.muted) void this.musicElement.play().catch(() => undefined);
  }

  /**
   * The seamless loop: near the end of the playing pass, start the other voice
   * from the top and crossfade (equal-power) into it.
   */
  private tickMusic(): void {
    const ctx = this.context;
    if (!ctx || this.muted || this.musicFading || this.musicVoices.length < 2) return;
    const current = this.musicVoices[this.musicCurrent]!;
    const duration = current.element.duration;
    if (!Number.isFinite(duration) || duration < MUSIC_CROSSFADE * 3 || current.element.paused) return;
    if (duration - current.element.currentTime > MUSIC_CROSSFADE) return;

    const nextIndex = 1 - this.musicCurrent;
    const next = this.musicVoices[nextIndex]!;
    const now = ctx.currentTime;
    this.musicFading = true;
    next.element.currentTime = 0;
    void next.element.play().catch(() => undefined);
    const steps = 16;
    const outCurve = new Float32Array(steps);
    const inCurve = new Float32Array(steps);
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      outCurve[i] = Math.cos((t * Math.PI) / 2);
      inCurve[i] = Math.sin((t * Math.PI) / 2);
    }
    current.gain.gain.cancelScheduledValues(now);
    next.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueCurveAtTime(outCurve, now, MUSIC_CROSSFADE);
    next.gain.gain.setValueCurveAtTime(inCurve, now, MUSIC_CROSSFADE);
    this.musicCurrent = nextIndex;
    this.musicElement = next.element;
    this.musicSource = next.source;
    window.setTimeout(() => {
      current.element.pause();
      current.element.currentTime = 0;
      this.musicFading = false;
    }, MUSIC_CROSSFADE * 1000 + 100);
  }

  // --------------------------------------------------------- the one-shots

  /**
   * Fetch and decode the supplied one-shots.
   *
   * Fire and forget, and every failure is swallowed: a sample that does not
   * arrive simply never enters `samples`, and `playSample` returns false, and
   * the synthesised voice is used instead. A blocked asset is therefore a
   * DIFFERENT SOUND rather than silence, which is the whole reason the
   * fallback exists.
   *
   * Requested once, behind a flag, because `resume()` is wired to every
   * gesture and fetching the same two files on every click would be a slow
   * leak nobody would look for.
   */
  private loadSamples(): void {
    if (this.samplesRequested) return;
    this.samplesRequested = true;
    const ctx = this.context;
    if (!ctx) return;

    for (const [name, url] of Object.entries(SAMPLE_URLS)) {
      void fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((data) => (data ? ctx.decodeAudioData(data) : null))
        .then((buffer) => {
          if (buffer) this.samples.set(name as SoundName, buffer);
        })
        .catch(() => undefined);
    }
  }

  /**
   * Play a decoded sample, if one is available.
   *
   * @returns false when nothing was decoded, so the caller synthesises
   *          instead. That fallback is the whole shape of this method: a
   *          missing or blocked file changes which sound plays and nothing
   *          else.
   *
   * A sampled sound REPLACES itself rather than layering. The cooldowns are
   * tuned against the synthesised voices, every one of which is shorter than
   * its own cooldown; a recorded file need not be, so without this two of them
   * could overlap.
   */
  private playSample(name: SoundName, when: number, gain: number): boolean {
    const ctx = this.context;
    const bus = this.sfxBus;
    const buffer = this.samples.get(name);
    if (!ctx || !bus || !buffer) return false;

    // The previous take fades out over a few milliseconds rather than being cut (a hard stop clicks).
    const previous = this.activeSamples.get(name);
    if (previous) {
      previous.envelope.gain.cancelScheduledValues(when);
      previous.envelope.gain.setValueAtTime(previous.envelope.gain.value, when);
      previous.envelope.gain.linearRampToValueAtTime(0, when + 0.04);
      try {
        previous.source.stop(when + 0.05);
      } catch {
        // Already stopped.
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const envelope = ctx.createGain();
    envelope.gain.value = gain;
    source.connect(envelope);
    envelope.connect(bus);

    this.voices += 1;
    this.activeSamples.set(name, { source, envelope });
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      if (this.activeSamples.get(name)?.source === source) this.activeSamples.delete(name);
    };
    source.start(when);
    return true;
  }

  private blip(
    at: number,
    shape: OscillatorType,
    from: number,
    to: number,
    length: number,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, length);
  }

  /** A push against the air: a short filtered noise burst with a low thump. */
  private thud(at: number, gain: number, frequency = 150): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.45, at + 0.09);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, 0.12);
  }

  /**
   * A swept band of noise: the whoosh of a blade, the crack of an eggshell.
   * One shared second of white noise, looped from a random offset, through a
   * band-pass filter swept from `from` Hz to `to` Hz.
   */
  private noise(at: number, length: number, from: number, to: number, gain: number): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    if (!this.noiseBuffer) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.loopStart = Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + length);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(bus);
    this.hold(source, envelope, at, length, () => filter.disconnect());
  }

  private noiseBuffer: AudioBuffer | null = null;

  private arpeggio(
    at: number,
    semitones: readonly number[],
    step: number,
    shape: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    for (let i = 0; i < semitones.length; i += 1) {
      if (this.voices >= MAX_VOICES) return;
      const osc = ctx.createOscillator();
      osc.type = shape;
      osc.frequency.value = 440 * 2 ** ((semitones[i] as number) / 12);

      const start = at + i * step;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(gain, start + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + step * 2.2);

      osc.connect(envelope);
      envelope.connect(bus);
      this.hold(osc, envelope, start, step * 2.2);
    }
  }

  /**
   * Start a voice, count it, and make sure it is uncounted exactly once.
   *
   * The counting is the whole reason `MAX_VOICES` means anything: a node that
   * started without being counted, or one that ended without being uncounted,
   * would leave the ceiling either useless or permanently closed.
   */
  private hold(
    osc: AudioScheduledSourceNode,
    envelope: GainNode,
    at: number,
    length: number,
    onDone?: () => void,
  ): void {
    this.voices += 1;
    osc.start(at);
    osc.stop(at + length + 0.02);
    osc.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      osc.disconnect();
      envelope.disconnect();
      onDone?.();
    };
  }
}
