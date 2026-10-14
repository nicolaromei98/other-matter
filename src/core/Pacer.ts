/** The last `n` samples, with cached percentiles (recomputed every 16 pushes). */
class Rolling {
  private readonly buf: Float32Array;
  private readonly sorted: Float32Array;
  private count = 0;
  private head = 0;
  private sinceSort = 16;
  constructor(n: number) {
    this.buf = new Float32Array(n);
    this.sorted = new Float32Array(n);
  }
  get ready(): boolean {
    return this.count >= this.buf.length / 2;
  }
  clear(): void {
    this.count = this.head = 0;
    this.sinceSort = 16;
  }
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    this.count = Math.min(this.buf.length, this.count + 1);
    this.sinceSort++;
  }
  percentile(q: number): number {
    const n = this.count;
    if (this.sinceSort >= 16 || n < this.buf.length) {
      const view = this.sorted.subarray(0, n);
      view.set(this.buf.subarray(0, n));
      view.sort();
      this.sinceSort = 0;
    }
    return this.sorted[Math.min(n - 1, Math.floor(q * (n - 1)))];
  }
}

interface Trial {
  kind: 'faster' | 'sharper';
  /** What to go back to if it does not pay. */
  dpr: number;
  every: 1 | 2;
  /** The cadence it set out to beat (ms). */
  cadence: number;
  /** A faster try steps down to this before giving up. */
  floor: number;
}

/**
 * Frame pacing and dynamic resolution, apart from the renderer (the engine
 * applies `dpr` and asks `skip()` on every animation frame), so it can also
 * run against a simulated display.
 *
 * Aims, in order: frames at an even rhythm (the unevenness is what reads as
 * stutter), then as fast a rhythm as the screen shows, then as much resolution
 * as that leaves room for.
 *
 * A drawn frame is late when it comes a refresh or more after the steady
 * interval of late (the cadence). A resolution change reallocates the canvas,
 * a hitch of a frame or two, so changes are few and deliberate, and for a
 * second after one, late frames are not counted.
 * - Stutter (over 7% of frames late for 1.5 s): a step of resolution
 *   down; on a fast screen (over 80 Hz) not below 1.75x, then a steady half
 *   rate (every other refresh); then further down.
 * - Steady but slower than the screen (60 fps on a 120 Hz screen, or 30 on
 *   a 60 Hz one): try less resolution for a faster cadence, a step at a time,
 *   for the full rate not below 1.75x, for 60 fps down to 1.25x.
 * - Calm at the best cadence it can get: try a step back up (more resolution,
 *   then every refresh again).
 * A try is judged once the cadence has been measured afresh: kept if it paid
 * (a faster cadence, or more resolution at the same one) and frames stayed
 * even, undone if not, and then the next try waits twice as long. Stalls over
 * 100 ms (shader compiles, tab switches, GC) say nothing about the GPU and are
 * skipped, and so is everything while held (loading, warm-up, intro).
 */
export class Pacer {
  dpr = 1;
  /** Draw every refresh (1), or every other one (2) when the GPU cannot keep a full rate steady. */
  every: 1 | 2 = 1;
  /**
   * The display's refresh interval (ms). Measured by the engine on frames that
   * draw nothing (while a scene is heavy the browser holds animation frames
   * back until the GPU catches up, and a 120 Hz screen looks like a 60 Hz
   * one); in between only ever lowered, by the steady gaps between frames.
   */
  refresh = 1000 / 60;
  /** The steady drawing interval lately (ms). */
  cadence = 1000 / 60;
  /** Share of drawn frames that came a refresh or more late, over the last second or so. */
  late = 0;

  private dprMin = 1;
  private dprMax = 1;
  private high: boolean;
  /**
   * The last 64 gaps between animation frames and between drawn frames. Low
   * percentiles of them, not minimums, so the short catch-up gaps after a long
   * frame do not count.
   */
  private readonly rafGaps = new Rolling(64);
  private readonly drawGaps = new Rolling(64);
  /** Seconds of sustained stutter, of calm (no late frames), and since the last change. */
  private stutter = 0;
  private calm = 0;
  private sinceChange = 0;
  /** Seconds left in which late frames are not counted: a change hitches a frame or two itself. */
  private quiet = 0;
  /** Seconds before anything counts. */
  private holdFor = 0;
  private trial: Trial | null = null;
  /** Seconds to wait before the next try. */
  private wait = 8;

  constructor(high: boolean) {
    this.high = high;
  }

  /** The screen's density (the window moved, or first): pacing starts over from the top. */
  fit(deviceDpr: number): void {
    this.dprMax = Math.min(deviceDpr || 1, this.high ? 2 : 1.25);
    this.dprMin = Math.min(this.dprMax, this.high ? 1 : 0.75);
    this.dpr = this.dprMax;
    this.every = 1;
    this.trial = null;
    this.wait = 8;
    this.changed();
  }

  /** A fresh refresh measurement (ms). */
  setRefresh(ms: number): void {
    this.refresh = ms;
    this.rafGaps.clear();
    this.changed();
  }

  /** Nothing counts for the next `seconds` (loading and intro, a tab coming back). */
  hold(seconds: number): void {
    this.holdFor = Math.max(this.holdFor, seconds);
  }

  /** An animation frame came `gap` ms after the last one. */
  raf(gap: number): void {
    if (gap <= 4 || gap >= 40) return;
    this.rafGaps.push(gap);
    // frames steadily closer together than measured: a faster screen than measured
    const steady = this.rafGaps.ready ? this.rafGaps.percentile(0.25) : this.refresh;
    if (steady < this.refresh * 0.8) this.refresh = steady;
  }

  /** Whether to skip drawing this animation frame, `elapsed` ms after the last drawn one (steady half rate). */
  skip(elapsed: number): boolean {
    return this.every === 2 && elapsed < this.refresh * 1.5;
  }

  /** A frame was drawn `elapsedMs` after the last one; `dt` in seconds. May change `dpr` and `every`. */
  frame(elapsedMs: number, dt: number): void {
    if (this.holdFor > 0) {
      this.holdFor -= dt;
      return;
    }
    if (elapsedMs > 100) return;
    this.drawGaps.push(elapsedMs);
    if (this.drawGaps.ready) this.cadence = this.drawGaps.percentile(0.2);
    this.sinceChange += dt;
    if (this.quiet > 0) {
      this.quiet -= dt;
      return;
    }
    const isLate = elapsedMs > this.cadence * 1.45;
    this.late += ((isLate ? 1 : 0) - this.late) * (1 - Math.exp(-dt));
    this.stutter = this.late > 0.07 ? this.stutter + dt : Math.max(0, this.stutter - dt * 2);

    // a fast screen can fall back to a steady half rate; on a 60 Hz one that is 30 fps
    const canHalve = this.refresh < 12;
    const floorFull = this.clampDpr(this.high ? (canHalve ? 1.75 : 1.5) : 1);

    if (this.stutter > 1.5) {
      if (this.every === 1 && this.dpr - 0.25 >= floorFull - 1e-3) this.dpr = this.clampDpr(this.dpr - 0.25);
      else if (this.every === 1 && canHalve) this.every = 2;
      else if (this.dpr > this.dprMin) this.dpr = this.clampDpr(this.dpr - 0.25);
      // a try that did not hold (or a kept one that gave out soon after): wait longer before the next
      if (this.trial || this.sinceChange < 6) this.wait = Math.min(120, this.wait * 2);
      this.trial = null;
      this.changed();
      return;
    }
    this.calm = this.late < 0.03 ? this.calm + dt : 0;

    // a try in progress: judged once the cadence has been measured afresh
    if (this.trial) {
      if (this.sinceChange < 3 || !this.drawGaps.ready) return;
      const t = this.trial;
      const even = this.late < 0.05;
      const paid = even && (t.kind === 'faster' ? this.cadence < t.cadence - this.refresh * 0.5 : this.cadence < t.cadence * 1.15);
      if (paid) {
        this.trial = null;
        this.wait = Math.max(8, this.wait / 2);
        return;
      }
      // not faster yet: a further step down, while the try's floor allows
      if (t.kind === 'faster' && this.every === 1 && this.dpr - 0.25 >= t.floor - 1e-3) {
        this.dpr = this.clampDpr(this.dpr - 0.25);
        this.changed();
        return;
      }
      this.trial = null;
      this.every = t.every;
      this.dpr = t.dpr;
      this.wait = Math.min(120, this.wait * 2);
      this.changed();
      return;
    }
    if (this.calm < 2 || this.sinceChange < this.wait) return;

    const fullRate = this.cadence < this.refresh * 1.3;
    const at60 = this.cadence < (1000 / 60) * 1.2;
    if (this.every === 1 && !fullRate) {
      // steady but slower than the screen: a step of resolution for a faster cadence
      const floor = at60 ? floorFull : this.clampDpr(this.high ? 1.25 : 0.75);
      if (this.dpr - 0.25 >= floor - 1e-3) {
        this.try('faster', this.dpr - 0.25, 1, floor);
        return;
      }
    }
    // calm at the best cadence it can get: more resolution, then every refresh again (at the full rate's floor)
    if (this.dpr < this.dprMax) this.try('sharper', this.dpr + 0.25, this.every, this.dpr);
    else if (this.every === 2) this.try('faster', Math.min(this.dpr, floorFull), 1, floorFull);
  }

  private try(kind: Trial['kind'], dpr: number, every: 1 | 2, floor: number): void {
    this.trial = { kind, dpr: this.dpr, every: this.every, cadence: this.cadence, floor };
    this.dpr = this.clampDpr(dpr);
    this.every = every;
    this.changed();
  }

  private clampDpr(v: number): number {
    return Math.round(Math.min(this.dprMax, Math.max(this.dprMin, v)) * 8) / 8;
  }

  /** After any change: measure afresh, past the change's own hitch. */
  private changed(): void {
    this.late = 0;
    this.stutter = 0;
    this.calm = 0;
    this.sinceChange = 0;
    this.quiet = 1;
    this.drawGaps.clear();
  }
}
