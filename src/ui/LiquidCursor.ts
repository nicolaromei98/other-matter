import gsap from 'gsap';
import { Flap } from './Flap';

const CELLS = 8;
/** Body heights, px: the resting drop, the drop over something clickable, the pill that carries a word. */
const DOT = 11;
const HOVER = 20;
const PILL = 24;
/** From the hotspot to the word, and after the word to the pill's end. */
const LEAD = 10;
const PAD = 10;
/** The goo layer is a fixed box around the hotspot (the filter only draws inside it); hotspot at (BX, BY). */
const BX = 150;
const BY = 60;
/** What swells the drop: anything clickable that would actually do something. */
const CLICKABLE =
  'a[href], button:not(:disabled):not([aria-checked="true"]):not([aria-current="true"]), [role="button"]';

type State = 'rest' | 'hover' | 'label';

/**
 * The pointer is a drop of the same black liquid as the slider (the system
 * cursor is hidden; fine pointers only). At rest it is a small drop on the
 * hotspot. Moving, a droplet trails out of its back like a tail, never
 * detaching, and is drawn back in when it stops. Over something clickable it
 * swells; pressed, it squeezes. When there is something to say ("OPEN",
 * "STRIKE", "ROTATE"…) the drop stretches into a pill that carries the word,
 * which flaps in, with a white dot left on the hotspot; near the right edge
 * the pill grows to the left instead.
 *
 * Drop and hover are drawn white in difference blending, with an identical grey
 * copy on top in saturation blending that takes the hue out: a monochrome
 * negative of whatever is underneath. Black on the page, white over the black
 * controls, dark grey on the yellow, and text under the drop stays readable.
 * The pill is plain black so its word stays crisp; it switches back once it
 * has shrunk into a drop.
 */
export class LiquidCursor {
  private readonly el: HTMLElement;
  /** The saturation copy of the liquid (see above). */
  private readonly mono: HTMLElement;
  private readonly bodies: HTMLElement[];
  private readonly drops: HTMLElement[];
  private readonly dot: HTMLElement;
  private readonly text: HTMLElement;
  private readonly flap: Flap;
  /** Pointer, and an eased copy of it the droplet trails from. */
  private readonly at = { x: -100, y: -100 };
  private readonly lag = { x: -100, y: -100 };
  /** Body size (tweened), and which way the pill grows: 0 → right of the hotspot, 1 → left. */
  private readonly size = { w: DOT, h: DOT };
  private side = 0;
  private sideTarget = 0;
  private readonly show = { v: 0 };
  private readonly press = { v: 1 };
  private state: State = 'rest';
  private label: string | null = null;
  private labelW = 0;
  private inked = false;
  private overEl: Element | null = null;
  private ch = 6;
  private readonly enabled = matchMedia('(pointer: fine)').matches;

  constructor(
    private readonly reducedMotion: boolean,
    onLand?: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'om-cursor';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <svg class="om-cursor-defs" width="0" height="0" aria-hidden="true">
        <filter id="om-goo" x="0" y="0" width="100%" height="100%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </svg>
      <div class="om-cursor-goo"><span class="om-cursor-body"></span><span class="om-cursor-drop"></span></div>
      <span class="om-cursor-dot"></span>
      <span class="om-label om-cursor-text"><span></span></span>`;
    this.mono = document.createElement('div');
    this.mono.className = 'om-cursor-mono';
    this.mono.setAttribute('aria-hidden', 'true');
    this.mono.innerHTML = `<div class="om-cursor-goo"><span class="om-cursor-body"></span><span class="om-cursor-drop"></span></div>`;
    document.body.append(this.el, this.mono);
    this.bodies = [this.el, this.mono].map((e) => e.querySelector('.om-cursor-body') as HTMLElement);
    this.drops = [this.el, this.mono].map((e) => e.querySelector('.om-cursor-drop') as HTMLElement);
    this.dot = this.el.querySelector('.om-cursor-dot') as HTMLElement;
    this.text = this.el.querySelector('.om-cursor-text') as HTMLElement;
    this.flap = new Flap(this.text.firstElementChild as HTMLElement, ' '.repeat(CELLS), {
      cells: CELLS,
      stagger: 0.03,
      reducedMotion,
      onLand,
    });
    gsap.set([this.text, this.dot], { autoAlpha: 0 });
    if (!this.enabled) {
      this.el.hidden = this.mono.hidden = true;
      return;
    }
    document.documentElement.classList.add('has-liquid-cursor');

    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') return;
        this.at.x = e.clientX;
        this.at.y = e.clientY;
        if (this.show.v === 0) this.appear();
      },
      { passive: true },
    );
    document.addEventListener(
      'pointerover',
      (e) => {
        this.overEl = (e.target as Element | null)?.closest?.('a, button, [role="button"]') ?? null;
        this.apply();
      },
      { passive: true },
    );
    // leaving the window: the drop dries up; it drips in again on the next move
    document.documentElement.addEventListener('mouseleave', () => {
      gsap.to(this.show, { v: 0, duration: 0.25, ease: 'power2.in', overwrite: true });
      gsap.to([this.el, this.mono], { autoAlpha: 0, duration: 0.25, overwrite: true });
    });
    window.addEventListener('pointerdown', () => {
      gsap.to(this.press, { v: 0.72, duration: 0.16, ease: 'power3.out', overwrite: true });
    });
    window.addEventListener('pointerup', () => {
      gsap.to(this.press, { v: 1, duration: 0.8, ease: this.elastic(0.45), overwrite: true });
      // a click can change what the element under the pointer does (the view switch, the slider dots)
      requestAnimationFrame(() => this.apply());
    });
    gsap.ticker.add(this.frame);
  }

  /** Over a DOM control (a button or link), whether or not a click there does anything right now. */
  get overControl(): boolean {
    return !!this.overEl && this.overEl.isConnected;
  }

  /** Over a DOM control that would do something on click. */
  get overClickable(): boolean {
    return !!this.overEl && this.overEl.isConnected && this.overEl.matches(CLICKABLE);
  }

  /** Show a word (or go back to the drop with null). Cheap to call every frame. */
  set(label: string | null): void {
    if (!this.enabled || label === this.label) return;
    this.label = label;
    if (label !== null) {
      this.ch = (this.text.querySelector('.flap > span') as HTMLElement | null)?.offsetWidth || this.ch;
      this.labelW = label.length * this.ch;
      gsap.set(this.text, { width: this.labelW });
      this.flap.set(label.padEnd(CELLS, ' '));
    } else {
      this.flap.set(' '.repeat(CELLS), true);
    }
    this.apply(true);
  }

  private elastic(period: number): string {
    return this.reducedMotion ? 'power3.out' : `elastic.out(1, ${period})`;
  }

  private appear(): void {
    this.lag.x = this.at.x;
    this.lag.y = this.at.y;
    gsap.to([this.el, this.mono], { autoAlpha: 1, duration: 0.15, overwrite: true });
    gsap.to(this.show, { v: 1, duration: 0.7, ease: this.elastic(0.5), overwrite: true });
  }

  /** Tween the body to the current state: pill for a word, swollen over a control, else the drop. */
  private apply(force = false): void {
    const next: State = this.label !== null ? 'label' : this.overClickable ? 'hover' : 'rest';
    if (next === this.state && !force) return;
    const was = this.state;
    this.state = next;
    if (next === 'label') {
      this.inked = true;
      this.el.classList.add('is-label');
      this.mono.classList.add('is-off');
      const w = PILL / 2 + LEAD + this.labelW + PAD;
      gsap.to(this.size, { w, h: PILL, duration: 0.7, ease: this.elastic(0.6), overwrite: true });
      gsap.to([this.text, this.dot], { autoAlpha: 1, duration: 0.25, delay: was === 'label' ? 0 : 0.1, overwrite: true });
      return;
    }
    const d = next === 'hover' ? HOVER : DOT;
    gsap.to(this.size, { w: d, h: d, duration: 0.6, ease: this.elastic(0.5), overwrite: true });
    gsap.to([this.text, this.dot], { autoAlpha: 0, duration: 0.15, overwrite: true });
  }

  private frame = (_t: number, dtMs: number): void => {
    const dt = Math.min(0.05, dtMs / 1000);
    const k = 1 - Math.exp(-dt / 0.07);
    this.lag.x += (this.at.x - this.lag.x) * k;
    this.lag.y += (this.at.y - this.lag.y) * k;

    // the pill grows to the left when it would run off the right edge (with some hysteresis)
    if (this.state === 'label') {
      const reach = this.at.x + PILL / 2 + LEAD + this.labelW + PAD;
      if (reach + 12 > window.innerWidth) this.sideTarget = 1;
      else if (reach + 48 < window.innerWidth) this.sideTarget = 0;
    }
    this.side += (this.sideTarget - this.side) * (1 - Math.exp(-dt / 0.1));

    // back to difference blending once the pill has shrunk into a drop
    if (this.inked && this.state !== 'label' && this.size.w - this.size.h < 3) {
      this.inked = false;
      this.el.classList.remove('is-label');
      this.mono.classList.remove('is-off');
    }

    const sc = this.show.v * (this.state === 'label' ? 1 : this.press.v);
    const w = this.size.w * sc;
    const h = this.size.h * sc;
    const s = this.side;
    // body: a capsule whose end cap sits on the hotspot
    const x0 = -h / 2 - (w - h) * s;
    const cx = x0 + w / 2;
    for (const b of this.bodies) {
      b.style.width = `${w.toFixed(2)}px`;
      b.style.height = `${h.toFixed(2)}px`;
      b.style.borderRadius = `${(h / 2).toFixed(2)}px`;
      b.style.transform = `translate(${(BX + x0).toFixed(2)}px, ${(BY - h / 2).toFixed(2)}px)`;
    }

    // the droplet trails out of the back, opposite to where the pointer is heading
    const dx = this.at.x - this.lag.x;
    const dy = this.at.y - this.lag.y;
    const len = Math.hypot(dx, dy);
    const t = this.reducedMotion ? 0 : Math.min(1, len / 36);
    const pull = t * t * (3 - 2 * t);
    const d = Math.max(7, this.size.h * 0.72) * sc;
    let ox = 0;
    let oy = 0;
    if (len > 0.01 && w > 0.5) {
      const ux = -dx / len;
      const uy = -dy / len;
      // distance from the body's centre to its outline along that direction (as an ellipse)
      const edge = 1 / Math.hypot(ux / (w / 2), uy / (h / 2));
      ox = ux * (edge + d * 0.55) * pull;
      oy = uy * (edge + d * 0.55) * pull;
    }
    for (const e of this.drops) {
      e.style.width = e.style.height = `${d.toFixed(2)}px`;
      e.style.transform = `translate(${(BX + cx + ox - d / 2).toFixed(2)}px, ${(BY + oy - d / 2).toFixed(2)}px) scale(${(1 - 0.35 * pull).toFixed(3)})`;
    }

    // the word sits after the hotspot's cap, on whichever side the pill grows
    const tx = LEAD * (1 - 2 * s) - this.labelW * s;
    this.text.style.transform = `translate(${tx.toFixed(2)}px, ${-PILL / 2}px)`;
    this.el.style.transform = this.mono.style.transform = `translate(${this.at.x.toFixed(2)}px, ${this.at.y.toFixed(2)}px)`;
  };
}
