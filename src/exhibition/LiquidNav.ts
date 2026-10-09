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

  constructor(
    private readonly pill: HTMLElement,
    private readonly dots: HTMLButtonElement[],
    next: HTMLButtonElement,
    prev: HTMLButtonElement,
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

  /** Make bead `i` the active one; the droplet on that side flows there. */
  select(i: number, instant = false): void {
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

    for (const d of this.drops) this.layoutDrop(d, rd, cy);

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
  private layoutDrop(d: Droplet, rd: number, cy: number): void {
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
    const stretch = Math.min(1, Math.abs(hx - tx) / (this.rs * 4));
    Object.assign(d.head, { x: hx, y: cy, r: rd * s * (1 - 0.18 * stretch) });
    Object.assign(d.tail, { x: tx, y: cy, r: rd * s * (1 - 0.3 * stretch) });
    d.icon = Math.pow(settled, 12) * (1 - stretch) * s * s;
  }
}
