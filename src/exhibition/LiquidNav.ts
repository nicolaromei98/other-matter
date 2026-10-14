import gsap from 'gsap';

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** Proportions, all relative to the small bead radius. */
const ACTIVE = 1.5; // active bead radius
const DROP = 0.82; // droplet radius
const GAP = 0.62; // gap between neighbouring beads
const NECK = 0.04; // droplet overlap with its bead (the neck)
const AFTER = 0.32; // extra room between a droplet and the neighbouring bead

/**
 * Springs for the drag, as [angular frequency (rad/s), damping ratio]: under 1
 * they overshoot a little and settle, which is what makes it read as liquid.
 * With reduced motion every damping ratio becomes 1 (no overshoot).
 */
const FOLLOW: [number, number] = [14, 0.6]; // the liquid following the pointer
const SWELL: [number, number] = [11, 0.5]; // the swell moving into a bead: a small plop
const HEAD: [number, number] = [14, 0.62]; // droplet heads
const TAIL: [number, number] = [8.5, 0.48]; // droplet tails, trailing and wobbling
const REACH: [number, number] = [15, 0.55]; // a bridge forming and letting go
const BAND: [number, number] = [11, 0.38]; // the rubber band past either end
const GROW: [number, number] = [16, 0.7]; // droplets regrowing
const SINK: [number, number] = [24, 0.9]; // a droplet sinking out of the way during a hand-off
/** A hand-off lasts this long (s): the bridge is held while the other droplet takes it over. */
const HANDOFF = 0.18;
/** Past the midpoint by this much (in beads) before the swell moves on, so it does not flicker there. */
const HYST = 0.08;

/** One step of a damped spring (semi-implicit Euler): returns [position, velocity]. */
function spring(x: number, v: number, to: number, [w, z]: [number, number], h: number): [number, number] {
  v += (-w * w * (x - to) - 2 * z * w * v) * h;
  return [x + v * h, v];
}

/** One of the two droplets on the active bead: "next" on the right, "previous" on the left. */
export interface Droplet {
  /** +1 right of the bead, -1 left of it. */
  readonly side: 1 | -1;
  readonly head: Disc;
  readonly tail: Disc;
  /** Opacity of its dot and arrow (hidden while it travels or shrinks). */
  icon: number;
  readonly lead: { v: number }[];
  readonly lag: { v: number }[];
  /** Overall size: the droplet that does not travel shrinks away and regrows at the new bead. */
  readonly scale: { v: number };
  hop: gsap.core.Timeline | null;
  readonly button: HTMLButtonElement;
}

/**
 * The gallery slider as a row of black liquid beads, one per specimen.
 *
 * The active bead is larger and carries two droplets, each with a dot and an
 * arrow: "next" on its right, "previous" on its left. Selecting another
 * specimen makes the droplet on that side flow to the new bead: its head runs
 * ahead, its tail follows, and it merges with every bead it passes. The other
 * droplet sinks back into the old bead and wells up from the new one. The row
 * reflows as beads swell and shrink. All of it is weights tweened toward a
 * one-hot target (so an interrupted move simply continues from where it is),
 * turned into geometry here once per frame.
 *
 * The row can also be dragged, and then springs drive it, so it moves like a
 * liquid with mass: it follows the pointer a touch behind and overshoots a
 * little when the pointer stops. The swell stays on the bead nearest the
 * liquid and the droplet on that side reaches toward the neighbouring bead,
 * further the further it goes, until past the midpoint the two are bridged
 * and the swell flows over with a small plop. The bridge is handed over, not
 * broken: the droplet holding it keeps it a moment while the other droplet
 * sinks out of the old bead and wells up inside the bridge from the new one's
 * side, then lets go and flows through the new bead to its far side. Moving fast, the droplets stretch ahead and trail behind. Past
 * either end of the row the droplet is pulled out like a rubber band. On
 * release the same springs carry it into the chosen bead and let it settle.
 *
 * Geometry is in screen CSS px. It drives the DOM hit areas here and the WebGL
 * rendering in GooeySlider.
 */
export class LiquidNav {
  readonly beads: (Disc & { swell: number })[];
  readonly drops: [Droplet, Droplet];
  /** Smooth-union radius, px. */
  k = 12;
  /** Centre and size of the row's box (screen px). */
  readonly box = { x: 0, y: 0, w: 0, h: 0 };

  private readonly size: { v: number }[];
  private readonly hover: { v: number }[];
  private readonly radii: number[];
  private rs = 17;
  private current = -1;
  /** The pointer is down on the row. */
  private scrubbing = false;
  /** Springs own the weights: while dragging, and while settling after it. */
  private driving = false;
  /** The pointer along the row (fractional bead index), and the liquid's own position following it. */
  private scrubF = 0;
  private fs = 0;
  private fv = 0;
  /** The liquid's velocity smoothed for the droplets' lean (beads/s); not reset when grabbed again. */
  private lean = 0;
  /** The bead the springs pull the swell into. */
  private target = 0;
  /** A hand-off in progress: time left, the bead the bridge holds from, and which way the swell moved (0: none). */
  private handoff = 0;
  private handFrom = 0;
  private handDir: 1 | -1 | 0 = 0;
  /** Spring velocities of everything the drag drives. */
  private readonly sizeV: number[];
  private readonly leadV: number[][];
  private readonly lagV: number[][];
  private readonly scaleV = [0, 0];
  private readonly reachV = [0, 0];
  private overV = 0;
  /** Per droplet: how far it reaches toward the neighbouring bead on its side (0…1), and which bead that is. */
  private readonly reach = [{ v: 0 }, { v: 0 }];
  private readonly reachTo = [-1, -1];
  /** Per droplet: still sinking into its old bead (a hop caught mid-way by a drag); the drag takes it over once sunk. */
  private readonly sinking = [false, false];
  private lastT = 0;
  /** How far the droplets are pulled past the end of the row, px (signed: + past the last bead). */
  private readonly over = { v: 0 };

  constructor(
    private readonly pill: HTMLElement,
    private readonly dots: HTMLButtonElement[],
    next: HTMLButtonElement,
    prev: HTMLButtonElement,
    private readonly reduced = false,
  ) {
    const weights = () => dots.map(() => ({ v: 0 }));
    const drop = (side: 1 | -1, button: HTMLButtonElement): Droplet => ({
      side,
      head: { x: 0, y: 0, r: 0 },
      tail: { x: 0, y: 0, r: 0 },
      icon: 1,
      lead: weights(),
      lag: weights(),
      scale: { v: 1 },
      hop: null,
      button,
    });
    this.drops = [drop(1, next), drop(-1, prev)];
    this.beads = dots.map(() => ({ x: 0, y: 0, r: 0, swell: 0 }));
    this.size = weights();
    this.hover = weights();
    this.radii = dots.map(() => 0);
    this.sizeV = dots.map(() => 0);
    this.leadV = [dots.map(() => 0), dots.map(() => 0)];
    this.lagV = [dots.map(() => 0), dots.map(() => 0)];

    dots.forEach((d, i) => {
      d.addEventListener('pointerenter', () => gsap.to(this.hover[i], { v: 1, duration: 0.45, ease: 'power2.out', overwrite: true }));
      d.addEventListener('pointerleave', () => gsap.to(this.hover[i], { v: 0, duration: 0.6, ease: 'power2.out', overwrite: true }));
    });
    this.measure();
  }

  /** Bead sizes follow the pill height (the active bead's diameter, set in CSS). */
  measure(): void {
    const h = this.pill.offsetHeight || 51;
    this.rs = h / 2 / ACTIVE;
    this.k = this.rs * 0.8;
  }

  /** The bead the row shows as active (ahead of the stage while a transition is still running). */
  get active(): number {
    return Math.max(0, this.current);
  }

  /** A drag is in progress (false once something else took the row over). */
  get isScrubbing(): boolean {
    return this.scrubbing;
  }

  /** Average distance between neighbouring beads, px: maps a drag onto the row. */
  spacing(): number {
    const n = this.beads.length;
    return n > 1 ? Math.max(1, (this.beads[n - 1].x - this.beads[0].x) / (n - 1)) : 1;
  }

  /** Start dragging along the row, from the active bead (or from where it is still settling). */
  beginScrub(): void {
    if (!this.driving) {
      // from rest: the liquid starts where the row shows it
      this.fs = this.target = this.active;
      this.fv = 0;
      this.zeroVelocities();
    } else {
      // grabbed again while it settles: it carries on from the bead it is flowing into
      this.fs = this.target;
      this.fv = 0;
    }
    this.handDir = 0;
    this.handoff = 0;
    this.scrubbing = true;
    this.driving = true;
    this.scrubF = this.fs;
    gsap.killTweensOf([...this.size, this.over, ...this.reach]);
    this.drops.forEach((d, idx) => {
      // still finishing a sink from an earlier grab: leave it to finish
      if (this.sinking[idx]) return;
      // a droplet whose hop has not reached its swap yet (still on its old bead) never slides
      // across the row: if it is already sunk it moves to the drag's bead at once, otherwise it
      // finishes sinking first; the springs regrow it either way
      const midHop = !!d.hop && d.hop.time() < 0.22;
      const t = d.hop ? d.hop.time() : 1;
      d.hop?.kill();
      d.hop = null;
      gsap.killTweensOf([...d.lead, ...d.lag, d.scale]);
      this.sinking[idx] = false;
      if (!midHop) return;
      if (d.scale.v <= 0.01) {
        this.oneHot(d, this.target);
        return;
      }
      this.sinking[idx] = true;
      gsap.to(d.scale, {
        v: 0,
        duration: Math.max(0.05, 0.22 - t),
        ease: 'power2.in',
        onComplete: () => {
          this.oneHot(d, this.target);
          this.scaleV[idx] = 0;
          this.sinking[idx] = false;
        },
      });
    });
  }

  /** Put a droplet's head and tail on bead `i`. */
  private oneHot(d: Droplet, i: number): void {
    d.lead.forEach((w, j) => (w.v = j === i ? 1 : 0));
    d.lag.forEach((w, j) => (w.v = j === i ? 1 : 0));
  }

  private zeroVelocities(): void {
    this.sizeV.fill(0);
    this.leadV.forEach((v) => v.fill(0));
    this.lagV.forEach((v) => v.fill(0));
    this.scaleV.fill(0);
    this.reachV.fill(0);
    this.overV = 0;
  }

  /** The pointer's position along the row, as a fractional bead index (may run past either end). */
  scrub(f: number): void {
    this.scrubF = f;
  }

  /** Let go: the springs carry everything into bead `i` and let it settle there. */
  endScrub(i: number): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.current = this.target = i;
    // a hand-off in progress completes on its own; the springs then carry it into `i`
  }

  /** The springs stop where they are (an instant selection takes over). */
  private stopDrive(): void {
    this.scrubbing = false;
    this.driving = false;
    this.handDir = 0;
    this.handoff = 0;
    this.sinking.fill(false);
    for (const d of this.drops) gsap.killTweensOf(d.scale);
    gsap.killTweensOf([this.over, ...this.reach]);
    this.over.v = 0;
    this.reach.forEach((r) => (r.v = 0));
    this.fv = 0;
    this.zeroVelocities();
  }

  /** Per frame while the springs drive: substeps at 120 Hz, so they stay stable on slow frames. */
  private drive(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let k = 0; k < steps; k++) this.driveStep(dt / steps);
    if (!this.scrubbing && this.atRest()) this.park();
  }

  private driveStep(h: number): void {
    const n = this.beads.length;
    const damp = (sp: [number, number]): [number, number] => (this.reduced ? [sp[0], 1] : sp);
    let off = 0;
    if (this.scrubbing) {
      // the liquid follows the pointer on a spring: a touch behind, a little past when it stops
      [this.fs, this.fv] = spring(this.fs, this.fv, this.scrubF, damp(FOLLOW), h);
      const fc = Math.min(n - 1, Math.max(0, this.fs));
      const before = this.target;
      while (fc - this.target > 0.5 + HYST && this.target < n - 1) this.target++;
      while (fc - this.target < -0.5 - HYST && this.target > 0) this.target--;
      if (this.target !== before) {
        // the swell moves on: hand the bridge over (from the bead next to the new one)
        this.handDir = this.target > before ? 1 : -1;
        this.handFrom = this.target - this.handDir;
        this.handoff = HANDOFF;
      }
      off = fc - this.target;
    } else {
      this.fv *= Math.exp(-h * 10);
    }
    this.lean += (this.fv - this.lean) * (1 - Math.exp(-h / 0.06));

    // the swell flows into its bead (and overshoots it a little: a plop)
    this.size.forEach((w, j) => ([w.v, this.sizeV[j]] = spring(w.v, this.sizeV[j], j === this.target ? 1 : 0, damp(SWELL), h)));
    // a hand-off: the droplet on the side the swell moved holds the bridge from the old bead,
    // the other one sinks into the old bead out of sight
    const handing = this.handDir !== 0;
    this.drops.forEach((d, idx) => {
      if (this.sinking[idx]) return;
      const holder = handing && d.side === this.handDir;
      const sinker = handing && d.side === -this.handDir;
      const home = handing ? this.handFrom : this.target;
      const lv = this.leadV[idx];
      const gv = this.lagV[idx];
      // once let go the droplets settle near-critically: an overshoot that scales with the
      // distance travelled would fling them off the row after a long flick (the swell keeps its plop)
      const head: [number, number] = this.scrubbing ? HEAD : [HEAD[0], 0.9];
      const tail: [number, number] = this.scrubbing ? TAIL : [TAIL[0], 0.9];
      d.lead.forEach((w, j) => ([w.v, lv[j]] = spring(w.v, lv[j], j === home ? 1 : 0, damp(head), h)));
      d.lag.forEach((w, j) => ([w.v, gv[j]] = spring(w.v, gv[j], j === home ? 1 : 0, damp(tail), h)));
      [d.scale.v, this.scaleV[idx]] = spring(d.scale.v, this.scaleV[idx], sinker ? 0 : 1, damp(sinker ? SINK : GROW), h);

      const r = this.reach[idx];
      let want = 0;
      if (holder) {
        // keep the bridge from the old bead to the new one (letting go of a different one
        // first, so a crossing that comes while it still reaches does not make it jump a bead)
        const to = this.handFrom + d.side;
        if (to !== this.reachTo[idx] && Math.abs(r.v) > 0.05) want = 0;
        else {
          this.reachTo[idx] = to;
          want = 1;
        }
      } else if (!sinker && this.scrubbing && d.side * off > 0) {
        // the droplet on the liquid's side reaches toward the neighbour: touching it at the midpoint
        const t = Math.min(1, Math.abs(off) / 0.5);
        want = 1 - (1 - t) * (1 - t);
        const to = this.target + d.side;
        if (to !== this.reachTo[idx]) {
          // a new bead to reach for: let go of the old one first (no jump), unless barely reaching
          if (Math.abs(r.v) > 0.05) want = 0;
          else this.reachTo[idx] = to;
        }
      }
      // (a droplet letting go keeps the bead it was reaching for, so it retracts the way it came)
      [r.v, this.reachV[idx]] = spring(r.v, this.reachV[idx], want, damp(REACH), h);
    });

    if (handing) {
      this.handoff -= h;
      if (this.handoff <= 0) {
        // the sunk droplet wells up inside the bridge from the new bead's side, already reaching
        // back to the old bead; the holder lets go and flows on through the new bead
        const idx = this.drops.findIndex((d) => d.side === -this.handDir);
        const d = this.drops[idx];
        this.oneHot(d, this.target);
        this.leadV[idx].fill(0);
        this.lagV[idx].fill(0);
        this.reachTo[idx] = this.target + d.side;
        // reaching back only if the holder really spans that gap (else it would appear from nowhere)
        const other = 1 - idx;
        const back = this.scrubbing && d.side * off > 0 && this.reachTo[other] === this.target && this.reach[other].v > 0.9;
        this.reach[idx].v = back ? 1 : 0;
        this.reachV[idx] = 0;
        this.handDir = 0;
      }
    }

    // past either end the row gives like a rubber band, more reluctantly the further it goes
    let over = 0;
    if (this.scrubbing) {
      const past = this.fs - Math.min(n - 1, Math.max(0, this.fs));
      over = Math.sign(past) * this.spacing() * 0.55 * (1 - Math.exp(-Math.abs(past) * 1.4));
    }
    [this.over.v, this.overV] = spring(this.over.v, this.overV, over, damp(BAND), h);
    // its springy overshoot stays within reach of the row
    const cap = this.spacing() * 0.65;
    if (Math.abs(this.over.v) > cap) {
      this.over.v = Math.sign(this.over.v) * cap;
      this.overV = 0;
    }
  }

  /** Settled after a release: everything is at its target and still. */
  private atRest(): boolean {
    const e = 2e-3;
    const still = (x: number, to: number, v: number) => Math.abs(x - to) < e && Math.abs(v) < e * 10;
    if (this.handDir !== 0 || this.sinking.some(Boolean) || !still(this.over.v, 0, this.overV)) return false;
    for (let j = 0; j < this.size.length; j++) if (!still(this.size[j].v, j === this.target ? 1 : 0, this.sizeV[j])) return false;
    return this.drops.every(
      (d, idx) =>
        still(d.scale.v, 1, this.scaleV[idx]) &&
        still(this.reach[idx].v, 0, this.reachV[idx]) &&
        d.lead.every((w, j) => still(w.v, j === this.target ? 1 : 0, this.leadV[idx][j])) &&
        d.lag.every((w, j) => still(w.v, j === this.target ? 1 : 0, this.lagV[idx][j])),
    );
  }

  /** Hand the row back to the tweened selections, exactly one-hot. */
  private park(): void {
    this.driving = false;
    this.handDir = 0;
    this.lean = 0;
    this.current = this.target;
    this.size.forEach((w, j) => (w.v = j === this.target ? 1 : 0));
    for (const d of this.drops) {
      this.oneHot(d, this.target);
      d.scale.v = 1;
    }
    this.reach.forEach((r) => (r.v = 0));
    this.over.v = 0;
    this.fv = 0;
    this.zeroVelocities();
  }

  /** Make bead `i` the active one; the droplet on that side flows there. */
  select(i: number, instant = false): void {
    if (this.driving && !instant) {
      if (this.scrubbing) {
        // a queued transition catching up with the bead the row already shows: the drag goes on
        if (i === this.current) return;
        // any other selection (keys, a tap, a view change) ends the drag: settle into it
        this.endScrub(i);
        return;
      }
      // still settling after a drag: the springs simply carry it on to the new bead
      this.current = this.target = i;
      return;
    }
    if (this.driving) this.stopDrive();
    if (i === this.current && !instant) return;
    const from = this.current;
    this.current = i;
    const oneHot = (w: { v: number }[]) => w.forEach((x, j) => (x.v = j === i ? 1 : 0));

    if (instant || from < 0) {
      gsap.killTweensOf(this.size);
      oneHot(this.size);
      for (const d of this.drops) {
        d.hop?.kill();
        gsap.killTweensOf([...d.lead, ...d.lag, d.scale]);
        oneHot(d.lead);
        oneHot(d.lag);
        d.scale.v = 1;
      }
      return;
    }

    const run = 0.62 + 0.07 * Math.abs(i - from);
    const dir = i > from ? 1 : -1;
    this.size.forEach((w, j) => gsap.to(w, { v: j === i ? 1 : 0, duration: run + 0.12, ease: 'power3.inOut', overwrite: true }));
    for (const d of this.drops) {
      d.hop?.kill();
      d.hop = null;
      if (d.side === dir) {
        // flows along the row to the new bead
        d.lead.forEach((w, j) => gsap.to(w, { v: j === i ? 1 : 0, duration: run, ease: 'power3.inOut', overwrite: true }));
        d.lag.forEach((w, j) => gsap.to(w, { v: j === i ? 1 : 0, duration: run + 0.18, delay: 0.07, ease: 'power2.inOut', overwrite: true }));
        gsap.to(d.scale, { v: 1, duration: 0.3, ease: 'power2.out', overwrite: true });
      } else {
        // sinks into the old bead, wells up from the new one
        gsap.killTweensOf([...d.lead, ...d.lag]);
        d.hop = gsap
          .timeline()
          .to(d.scale, { v: 0, duration: 0.22, ease: 'power2.in', overwrite: true })
          .add(() => {
            oneHot(d.lead);
            oneHot(d.lag);
          })
          .to(d.scale, { v: 1, duration: 0.5, ease: 'power3.out' }, run * 0.72);
      }
    }
  }

  /** Per frame: weights → geometry → DOM. */
  layout(): void {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastT) / 1000));
    this.lastT = now;
    if (this.driving) this.drive(dt);

    const p = this.pill.getBoundingClientRect();
    const cx = p.left + p.width / 2;
    const cy = p.top + p.height / 2;
    Object.assign(this.box, { x: cx, y: cy, w: p.width, h: p.height });

    const rs = this.rs;
    const rd = rs * DROP;
    const gap = rs * GAP;
    const tailW = 2 * rd - rs * NECK + rs * AFTER;
    const n = this.beads.length;

    // reflow: each bead takes its diameter, the active one also room for a droplet on each side
    // (the swell's plop may undershoot below 0: the room gets a soft floor, with no kink at 0,
    // so it never pinches a bead's neighbours together until they fuse)
    const roomOf = (v: number) => (v >= 0 ? v : -0.04 * (1 - Math.exp(v / 0.04)));
    let w = gap * (n - 1);
    for (let i = 0; i < n; i++) {
      this.radii[i] = rs * (1 + (ACTIVE - 1) * this.size[i].v);
      w += 2 * this.radii[i] + 2 * tailW * roomOf(this.size[i].v);
    }
    let x = cx - w / 2;
    for (let i = 0; i < n; i++) {
      const r = this.radii[i];
      const room = tailW * roomOf(this.size[i].v);
      const b = this.beads[i];
      b.x = x + room + r;
      b.y = cy;
      b.r = r * (1 + 0.1 * this.hover[i].v);
      b.swell = this.size[i].v;
      x += 2 * (room + r) + gap;
    }

    this.drops.forEach((d, idx) => this.layoutDrop(d, idx, rd, cy));

    // DOM: hit areas over the beads and the droplets
    const base = rs * ACTIVE;
    for (let i = 0; i < n; i++) {
      const b = this.beads[i];
      this.dots[i].style.transform = `translate(${(b.x - cx).toFixed(2)}px, 0) scale(${(b.r / base).toFixed(4)})`;
    }
    for (const d of this.drops) {
      d.button.style.transform = `translate(${(d.head.x - cx).toFixed(2)}px, 0)`;
      d.button.style.visibility = d.icon > 0.5 ? 'visible' : 'hidden';
    }
  }

  /** A droplet's head and tail are weighted mixes of the beads' seats on its side. */
  private layoutDrop(d: Droplet, idx: number, rd: number, cy: number): void {
    const s = d.scale.v;
    // a shrinking droplet also sinks into its bead, so it leaves no bump when it is gone
    const out = rd * s - this.rs * NECK - (1 - s) * this.k;
    let hx = 0;
    let tx = 0;
    let settled = 1; // 1 when every weight sits at 0 or 1
    for (let i = 0; i < this.beads.length; i++) {
      const seat = this.beads[i].x + d.side * (this.radii[i] + out);
      const l = d.lead[i].v;
      const t = d.lag[i].v;
      hx += l * seat;
      tx += t * seat;
      settled = Math.min(settled, Math.max(l, 1 - l), Math.max(t, 1 - t));
    }
    // dragging: reaching toward the neighbouring bead, the head overlapping its edge at full reach
    // (the spring may swing it a little past either way; never backwards out of the bead)
    const reach = Math.min(1.15, Math.max(0, this.reach[idx].v));
    const j = this.reachTo[idx];
    if (reach > 1e-3 && j >= 0 && j < this.beads.length) {
      const b = this.beads[j];
      // the head reaches over; the tail stays anchored at the bead the bridge starts from
      // (not wherever its weights are flowing), so the liquid holds as one body when the swell flips
      const touch = b.x - d.side * (b.r - rd * 0.45);
      hx += (touch - hx) * reach;
      const a = j - d.side;
      if (a >= 0 && a < this.beads.length) {
        const seatA = this.beads[a].x + d.side * (this.radii[a] + out);
        tx += (seatA + (touch - seatA) * 0.06 - tx) * Math.min(1, reach);
      }
    }
    // dragged past the end of the row: the droplet on that side is pulled out
    if (this.over.v * d.side > 0) {
      hx += this.over.v;
      tx += this.over.v * 0.1;
    }
    // moving fast: the droplet ahead stretches forward, the one behind trails its tail
    if (this.driving && this.lean !== 0) {
      let lean = Math.max(-rd * 0.9, Math.min(rd * 0.9, this.lean * this.spacing() * 0.035));
      if (this.over.v * lean > 0) lean = 0;
      if (lean * d.side > 0) {
        hx += lean;
        tx += lean * 0.3;
      } else {
        tx -= lean * 0.4;
      }
    }
    const stretch = Math.min(1, Math.abs(hx - tx) / (this.rs * 4));
    Object.assign(d.head, { x: hx, y: cy, r: rd * s * (1 - 0.18 * stretch) });
    Object.assign(d.tail, { x: tx, y: cy, r: rd * s * (1 - 0.3 * stretch) });
    d.icon = Math.min(1, Math.pow(Math.min(1, settled), 12) * (1 - stretch) * s * s * (1 - Math.min(1, Math.abs(this.reach[idx].v) * 3)));
  }
}
