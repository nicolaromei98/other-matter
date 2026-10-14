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
 * The row can also be dragged. While scrubbing, the swell stays on the bead
 * nearest the pointer and the droplet on the pointer's side reaches out
 * toward the neighbouring bead, further the further the pointer goes, until
 * at the midpoint it touches it and the two are bridged; past the midpoint the
 * swell flows into the neighbour and the bridge holds from its other side,
 * like surface tension handing the liquid on. Past either end of the row the
 * droplet is pulled out like a rubber band. On release everything settles
 * into the chosen bead with a little give.
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
  /** Dragging: the pointer's position along the row (fractional bead index). */
  private scrubbing = false;
  private scrubF = 0;
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

  /** Start dragging along the row, from the active bead. */
  beginScrub(): void {
    this.scrubbing = true;
    this.scrubF = Math.max(0, this.current);
    gsap.killTweensOf([...this.size, this.over, ...this.reach]);
    this.drops.forEach((d, idx) => {
      // a droplet whose hop has not reached its swap yet (still on its old bead) never slides
      // across the row: if it is already sunk it moves to the drag's bead at once, otherwise it
      // finishes sinking first; the drag regrows it either way
      const midHop = !!d.hop && d.hop.time() < 0.22;
      const t = d.hop ? d.hop.time() : 1;
      d.hop?.kill();
      d.hop = null;
      gsap.killTweensOf([...d.lead, ...d.lag, d.scale]);
      this.sinking[idx] = false;
      if (!midHop) return;
      if (d.scale.v <= 0.01) {
        this.oneHot(d, this.active);
        return;
      }
      this.sinking[idx] = true;
      gsap.to(d.scale, {
        v: 0,
        duration: Math.max(0.05, 0.22 - t),
        ease: 'power2.in',
        onComplete: () => {
          this.oneHot(d, Math.round(Math.min(this.beads.length - 1, Math.max(0, this.scrubF))));
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

  /** The pointer's position along the row, as a fractional bead index (may run past either end). */
  scrub(f: number): void {
    this.scrubF = f;
  }

  /** Let go: everything flows into bead `i` (the tails catch up with a little give). */
  endScrub(i: number): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.current = i;
    const give = this.reduced ? 'power3.out' : 'elastic.out(1, 0.5)';
    const back = this.reduced ? 'power3.out' : 'elastic.out(1, 0.45)';
    const to = (w: { v: number }[], duration: number, ease: string, delay = 0) =>
      w.forEach((x, j) => gsap.to(x, { v: j === i ? 1 : 0, duration, ease, delay, overwrite: true }));
    to(this.size, 0.5, 'power3.out');
    this.drops.forEach((d, idx) => {
      if (this.sinking[idx]) {
        // still sinking into its old bead: finish sinking, then well up from the chosen one
        this.sinking[idx] = false;
        gsap.to(d.scale, {
          v: 0,
          duration: Math.max(0.05, d.scale.v * 0.2),
          ease: 'power2.in',
          overwrite: true,
          onComplete: () => {
            this.oneHot(d, i);
            gsap.to(d.scale, { v: 1, duration: 0.5, ease: 'power3.out' });
          },
        });
        return;
      }
      // the droplets flow into the chosen bead, their tails catching up with a little give
      to(d.lead, 0.45, 'power3.out');
      to(d.lag, 0.85, give, 0.04);
      gsap.to(d.scale, { v: 1, duration: 0.3, ease: 'power2.out', overwrite: true });
    });
    // a bridge in progress lets go and springs back
    gsap.to(this.reach, { v: 0, duration: 0.7, ease: back, overwrite: true });
    gsap.to(this.over, { v: 0, duration: 0.7, ease: back, overwrite: true });
  }

  /** While dragging: the swell and the droplets' heads at the pointer, the tails trailing it. */
  private applyScrub(dt: number): void {
    const n = this.beads.length;
    const fc = Math.min(n - 1, Math.max(0, this.scrubF));
    // past either end the row gives like a rubber band, more reluctantly the further it goes
    const past = this.scrubF - fc;
    const over = Math.sign(past) * this.spacing() * 0.55 * (1 - Math.exp(-Math.abs(past) * 1.4));
    // eased, so grabbing it again while it springs back does not pop
    this.over.v += (over - this.over.v) * (1 - Math.exp(-dt / 0.05));

    // the bead nearest the pointer holds the swell; the pointer's offset from it (−0.5…0.5)
    const near = Math.round(fc);
    const off = fc - near;
    const toward = (w: { v: number }[], tau: number) => {
      const k = 1 - Math.exp(-dt / tau);
      w.forEach((o, j) => (o.v += ((j === near ? 1 : 0) - o.v) * k));
    };
    // the swell and the droplets flow quickly to a new nearest bead, the tails a little behind
    toward(this.size, 0.07);
    this.drops.forEach((d, idx) => {
      if (this.sinking[idx]) return;
      toward(d.lead, 0.06);
      toward(d.lag, 0.13);
      d.scale.v += (1 - d.scale.v) * (1 - Math.exp(-dt / 0.08));
      // the droplet on the pointer's side reaches toward the neighbour: touching it at the midpoint
      const t = d.side * off > 0 ? Math.min(1, Math.abs(off) / 0.5) : 0;
      let want = 1 - (1 - t) * (1 - t);
      const r = this.reach[idx];
      const to = near + d.side;
      if (want > 0 && to !== this.reachTo[idx]) {
        // a new bead to reach for: let go of the old one first (no jump), unless barely reaching
        // (by size: the spring-back after a release swings below zero)
        if (Math.abs(r.v) > 0.05) want = 0;
        else this.reachTo[idx] = to;
      }
      // (a droplet letting go keeps the bead it was reaching for, so it retracts the way it came)
      r.v += (want - r.v) * (1 - Math.exp(-dt / 0.045));
    });
  }

  /** Make bead `i` the active one; the droplet on that side flows there. */
  select(i: number, instant = false): void {
    if (this.scrubbing) {
      // a queued transition catching up with the bead the row already shows: the drag goes on
      if (i === this.current && !instant) return;
      // any other selection (keys, a tap, a view change) ends the drag: settle into it
      if (!instant) {
        this.endScrub(i);
        return;
      }
      this.scrubbing = false;
      this.sinking.fill(false);
      gsap.killTweensOf([this.over, ...this.reach]);
      this.over.v = 0;
      this.reach.forEach((r) => (r.v = 0));
    }
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
    if (this.scrubbing) this.applyScrub(dt);

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
    let w = gap * (n - 1);
    for (let i = 0; i < n; i++) {
      this.radii[i] = rs * (1 + (ACTIVE - 1) * this.size[i].v);
      w += 2 * this.radii[i] + 2 * tailW * this.size[i].v;
    }
    let x = cx - w / 2;
    for (let i = 0; i < n; i++) {
      const r = this.radii[i];
      const room = tailW * this.size[i].v;
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
    const reach = this.reach[idx].v;
    const j = this.reachTo[idx];
    if (Math.abs(reach) > 1e-3 && j >= 0 && j < this.beads.length) {
      const b = this.beads[j];
      // the head reaches over; the tail stays anchored at the bead the bridge starts from
      // (not wherever its weights are flowing), so the liquid holds as one body when the swell flips
      const touch = b.x - d.side * (b.r - rd * 0.45);
      hx += (touch - hx) * reach;
      const a = j - d.side;
      if (a >= 0 && a < this.beads.length) {
        const seatA = this.beads[a].x + d.side * (this.radii[a] + out);
        tx += (seatA + (touch - seatA) * 0.06 - tx) * Math.min(1, Math.abs(reach));
      }
    }
    // dragged past the end of the row: the droplet on that side is pulled out
    if (this.over.v * d.side > 0) {
      hx += this.over.v;
      tx += this.over.v * 0.1;
    }
    const stretch = Math.min(1, Math.abs(hx - tx) / (this.rs * 4));
    Object.assign(d.head, { x: hx, y: cy, r: rd * s * (1 - 0.18 * stretch) });
    Object.assign(d.tail, { x: tx, y: cy, r: rd * s * (1 - 0.3 * stretch) });
    d.icon = Math.pow(settled, 12) * (1 - stretch) * s * s * (1 - Math.min(1, Math.abs(reach) * 3));
  }
}
