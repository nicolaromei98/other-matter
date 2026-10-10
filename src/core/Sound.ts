import type { Slug } from '../data/materials';
import memoryGlassUrl from '../assets/sounds/memory-glass.mp3?url';
import liquidStoneUrl from '../assets/sounds/liquid-stone.mp3?url';

const STORE_KEY = 'om-sound';

/** Recorded voices; every other material is synthesised. */
const SAMPLES: Partial<Record<Slug, string>> = {
  'memory-glass': memoryGlassUrl,
  'liquid-stone': liquidStoneUrl,
};

/**
 * Hover sounds, played with the Web Audio API.
 *
 * Memory Glass and Liquid Stone use recorded voices (assets/sounds); the
 * other materials are synthesised, each designed around its physical
 * character: air, warmth, dust, liquid. Everything runs through a shared
 * convolution reverb (a generated impulse response) and a soft compressor.
 *
 * Browsers only allow audio after a user gesture, so the context is created
 * on the first pointerdown/keydown; hovers before that are silent. The
 * preference (on/off) is remembered per viewer.
 */
export class Sound {
  enabled: boolean;
  private ctx?: AudioContext;
  private master?: GainNode;
  private dry?: GainNode;
  private wet?: GainNode;
  private noise?: AudioBuffer;
  private last = new Map<string, number>();
  private listeners = new Set<(on: boolean) => void>();
  private buffers = new Map<Slug, AudioBuffer>();
  /** Currently playing sample per material (faded out when it is triggered again). */
  private voices = new Map<Slug, { src: AudioBufferSourceNode; gain: GainNode }>();
  /** Room tone: its level and the filter that colours it per material. */
  private amb?: { gain: GainNode; filter: BiquadFilterNode };
  private moodSlug: Slug | null = null;

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORE_KEY);
    } catch {
      /* storage unavailable */
    }
    this.enabled = stored !== 'off';
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // nothing to hear while the page is hidden
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this.enabled) this.ctx.resume().catch(() => {});
    });
  }

  onChange(fn: (on: boolean) => void): void {
    this.listeners.add(fn);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    if (this.enabled) this.ensure();
    this.ambient(this.enabled);
    this.listeners.forEach((fn) => fn(this.enabled));
  }

  private ensure(): AudioContext | undefined {
    if (typeof AudioContext === 'undefined') return undefined;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp);
      this.dry = ctx.createGain();
      this.dry.connect(this.master);
      const verb = ctx.createConvolver();
      verb.buffer = this.impulse(ctx, 2.6);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.55;
      this.wet.connect(verb);
      verb.connect(this.master);
      this.noise = this.noiseBuffer(ctx, 2);
      this.ctx = ctx;
      this.loadSamples(ctx);
      this.startAmbient(ctx);
      this.ambient(this.enabled);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /**
   * Room tone, very low: two sine drones a fifth apart, each breathing on its
   * own slow cycle, and a bed of soft noise, all through a lowpass that drifts.
   * The filter takes a colour per material (mood): airy for Aerogel and Dust
   * Silk, dark for Liquid Stone.
   */
  private startAmbient(ctx: AudioContext): void {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.5;
    filter.connect(gain);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    filter.connect(send);
    send.connect(this.wet!);

    const bed = ctx.createBufferSource();
    bed.buffer = this.noiseBuffer(ctx, 7);
    bed.loop = true;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.32;
    bed.connect(bedGain);
    bedGain.connect(filter);
    bed.start();

    [55, 82.41].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      const breath = ctx.createOscillator();
      breath.frequency.value = 0.045 + i * 0.027;
      const depth = ctx.createGain();
      depth.gain.value = 0.12;
      breath.connect(depth);
      depth.connect(g.gain);
      o.connect(g);
      g.connect(filter);
      o.start();
      breath.start();
    });

    const drift = ctx.createOscillator();
    drift.frequency.value = 0.025;
    const range = ctx.createGain();
    range.gain.value = 120;
    drift.connect(range);
    range.connect(filter.frequency);
    drift.start();

    this.amb = { gain, filter };
    this.mood(this.moodSlug);
  }

  /** Fade the room tone in or out. */
  private ambient(on: boolean): void {
    if (!this.amb || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.amb.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? 0.075 : 0, t + (on ? 3 : 0.6));
  }

  /** Colour the room tone for the specimen on the stage (null: neutral, in the grid). */
  mood(slug: Slug | null): void {
    this.moodSlug = slug;
    if (!this.amb || !this.ctx) return;
    const cutoff: Record<Slug, number> = {
      'aerogel-skin': 640,
      'memory-glass': 380,
      'thermal-foam': 470,
      'dust-silk': 720,
      'liquid-stone': 250,
      'bio-lens': 520,
    };
    const f = this.amb.filter.frequency;
    const t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(slug ? cutoff[slug] : 420, t + 2.2);
  }

  /** Fetch and decode the recorded voices (once, after the audio context exists). */
  private loadSamples(ctx: AudioContext): void {
    for (const [slug, url] of Object.entries(SAMPLES) as [Slug, string][]) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => this.buffers.set(slug, buf))
        .catch((err) => console.warn(`[sound] could not load ${slug}`, err));
    }
  }

  /** Play a recorded voice; a previous instance of the same voice fades out quickly. */
  private playSample(slug: Slug, buf: AudioBuffer, k: number, pan: number, t: number): number {
    const ctx = this.ctx!;
    const prev = this.voices.get(slug);
    if (prev) {
      prev.gain.gain.cancelScheduledValues(t);
      prev.gain.gain.setValueAtTime(prev.gain.gain.value, t);
      prev.gain.gain.linearRampToValueAtTime(0, t + 0.15);
      prev.src.stop(t + 0.2);
    }
    const out = this.bus(0.9 * k, 0.12, pan);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.01);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    gain.connect(out);
    src.start(t);
    const voice = { src, gain };
    this.voices.set(slug, voice);
    src.onended = () => {
      if (this.voices.get(slug) === voice) this.voices.delete(slug);
    };
    return buf.duration;
  }

  private get ready(): boolean {
    return this.enabled && !!this.ctx && this.ctx.state === 'running';
  }

  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Output bus with a dry/wet split and optional stereo position. */
  private bus(gain: number, wet: number, pan = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = wet;
    p.connect(send);
    send.connect(this.wet!);
    return g;
  }

  private env(param: AudioParam, t: number, peak: number, attack: number, release: number) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private tone(out: AudioNode, type: OscillatorType, f0: number, t: number, peak: number, attack: number, release: number, f1?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + attack + release * 0.4);
    const g = ctx.createGain();
    this.env(g.gain, t, peak, attack, release);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + attack + release + 0.05);
  }

  private hiss(out: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q: number, attack = 0.02) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, peak, attack, Math.max(0.01, dur - attack));
    src.connect(bq);
    bq.connect(g);
    g.connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Play a material's hover voice. Returns its length (s), or 0 if silent. */
  play(slug: Slug, intensity = 1, pan = 0): number {
    if (!this.ready) return 0;
    const now = this.ctx!.currentTime;
    if (now - (this.last.get(slug) ?? -1) < 0.32) return 0;
    this.last.set(slug, now);
    const t = now + 0.005;
    const k = Math.max(0.05, Math.min(1, intensity));

    const sample = this.buffers.get(slug);
    if (sample) return this.playSample(slug, sample, k, pan, t);

    // synthesised voices (also the fallback while a recording is still loading)
    switch (slug) {
      case 'aerogel-skin': {
        // a breath through a membrane
        const out = this.bus(0.9 * k, 0.7, pan);
        this.hiss(out, t, 1.1, 0.22, 'bandpass', 650, 1750, 2.2, 0.18);
        this.tone(out, 'sine', 880, t + 0.06, 0.035, 0.25, 1.1);
        this.tone(out, 'sine', 1318.5, t + 0.12, 0.02, 0.3, 1.0);
        return 1.3;
      }
      case 'memory-glass': {
        // a glass bell with inharmonic partials, and the tick of contact
        const out = this.bus(0.8 * k, 0.55, pan);
        const f = 740;
        [
          [1, 0.13, 1.6],
          [2.76, 0.065, 0.9],
          [5.4, 0.04, 0.5],
          [8.93, 0.02, 0.3],
        ].forEach(([m, g, r]) => this.tone(out, 'sine', f * m, t, g, 0.004, r));
        this.hiss(out, t, 0.03, 0.08, 'highpass', 3200, 5000, 0.7, 0.002);
        return 1.6;
      }
      case 'thermal-foam': {
        // warmth: a low chord blooming through an opening filter
        const out = this.bus(0.85 * k, 0.5, pan);
        const ctx = this.ctx!;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.8;
        lp.frequency.setValueAtTime(280, t);
        lp.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
        lp.frequency.exponentialRampToValueAtTime(420, t + 1.4);
        lp.connect(out);
        this.tone(lp, 'triangle', 196, t, 0.11, 0.28, 1.2);
        this.tone(lp, 'triangle', 293.66, t + 0.03, 0.07, 0.3, 1.1);
        this.tone(lp, 'sine', 392, t + 0.06, 0.04, 0.32, 1.0);
        return 1.5;
      }
      case 'dust-silk': {
        // granular shimmer: tiny high grains scattered across the stereo field
        const out = this.bus(0.7 * k, 0.65, 0);
        for (let i = 0; i < 14; i++) {
          const g = this.ctx!.createStereoPanner();
          g.pan.value = Math.max(-1, Math.min(1, pan + (Math.random() * 2 - 1) * 0.7));
          g.connect(out);
          this.tone(g, 'sine', 2200 + Math.random() * 4800, t + Math.random() * 0.75, 0.035, 0.003, 0.05 + Math.random() * 0.1);
        }
        this.hiss(out, t, 0.8, 0.03, 'highpass', 5000, 9000, 0.5, 0.15);
        return 1.0;
      }
      case 'liquid-stone': {
        // mass: a deep fifth, a low rumble and a mineral knock
        const out = this.bus(1 * k, 0.45, pan);
        this.tone(out, 'sine', 55, t, 0.32, 0.05, 2.0);
        this.tone(out, 'sine', 82.4, t + 0.02, 0.14, 0.06, 1.6);
        this.hiss(out, t, 0.45, 0.12, 'lowpass', 420, 120, 0.7, 0.04);
        this.hiss(out, t, 0.06, 0.2, 'bandpass', 900, 700, 8, 0.002);
        return 2.0;
      }
      case 'bio-lens': {
        // a wet bloom with two small bubbles
        const out = this.bus(0.85 * k, 0.45, pan);
        this.tone(out, 'sine', 260, t, 0.2, 0.012, 0.5, 540);
        this.tone(out, 'sine', 1200, t + 0.13, 0.05, 0.004, 0.07, 1500);
        this.tone(out, 'sine', 1650, t + 0.24, 0.04, 0.004, 0.06, 2050);
        return 0.8;
      }
    }
    return 0;
  }

  private lastTick = 0;

  /** A split-flap cell landing: a tiny, dry click (at most one every 28 ms). */
  tick(): void {
    if (!this.ready) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastTick < 0.028) return;
    this.lastTick = now;
    const out = this.bus(0.35, 0.05, (Math.random() - 0.5) * 0.3);
    this.hiss(out, now + 0.002, 0.025, 0.05, 'highpass', 5200, 4200, 0.7, 0.002);
  }

  /** Interface sounds: mode switch (soft whoosh) and specimen selection (tick). */
  ui(kind: 'switch' | 'select'): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime + 0.005;
    if (kind === 'switch') {
      const out = this.bus(0.6, 0.6);
      this.hiss(out, t, 0.75, 0.08, 'bandpass', 280, 2600, 1.4, 0.25);
    } else {
      const out = this.bus(0.6, 0.3);
      this.tone(out, 'sine', 1560, t, 0.05, 0.002, 0.06);
    }
  }
}
