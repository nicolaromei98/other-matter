import gsap from 'gsap';
import { Flap } from './Flap';

const CELLS = 8;
/** Pill height and side padding, px. */
const H = 22;
const PAD = 9;
/** Room around the blobs inside the goo layer (the filter only draws within its box). */
const G = 24;

/**
 * A small liquid tag that rides next to the pointer and says what a click or
 * a drag will do there ("OPEN", "STRIKE", "ROTATE"...). The system cursor
 * stays (the hand over specimens); this only adds context.
 *
 * The pill is black liquid, like the slider: it drips in with a little
 * elastic give; while it chases a moving pointer, a droplet trails out of its
 * back end like a tail of liquid (never detaching) and is drawn back in when it
 * catches up (an SVG goo filter on the blob layer only, so the text stays
 * crisp); and it swells or narrows to fit each new word, which flaps in
 * centred. Fine pointers only.
 */
export class CursorTag {
  private readonly el: HTMLElement;
  private readonly goo: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly drop: HTMLElement;
  private readonly text: HTMLElement;
  private readonly flap: Flap;
  private readonly pos = { x: -100, y: -100 };
  private readonly at = { x: -100, y: -100 };
  private readonly size = { w: H };
  private label: string | null = null;
  private ch = 6;
  private readonly enabled = matchMedia('(pointer: fine)').matches;

  constructor(reducedMotion: boolean, onLand?: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'om-cursor';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <svg class="om-cursor-defs" width="0" height="0" aria-hidden="true">
        <filter id="om-goo" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
      </svg>
      <div class="om-cursor-goo"><span class="om-cursor-pill"></span><span class="om-cursor-drop"></span></div>
      <span class="om-label om-cursor-text"><span></span></span>`;
    document.body.appendChild(this.el);
    this.goo = this.el.querySelector('.om-cursor-goo') as HTMLElement;
    this.pill = this.el.querySelector('.om-cursor-pill') as HTMLElement;
    this.drop = this.el.querySelector('.om-cursor-drop') as HTMLElement;
    this.text = this.el.querySelector('.om-cursor-text') as HTMLElement;
    this.flap = new Flap(this.text.firstElementChild as HTMLElement, ' '.repeat(CELLS), {
      cells: CELLS,
      stagger: 0.03,
      reducedMotion,
      onLand,
    });
    gsap.set(this.goo, { scale: 0, transformOrigin: `${G + H / 2}px ${G + H / 2}px` });
    gsap.set(this.text, { autoAlpha: 0 });
    if (!this.enabled) {
      this.el.hidden = true;
      return;
    }

    window.addEventListener(
      'pointermove',
      (e) => {
        this.at.x = e.clientX;
        this.at.y = e.clientY;
      },
      { passive: true },
    );
    gsap.ticker.add(this.frame);
  }

  private frame = (_t: number, dtMs: number): void => {
    const dt = Math.min(0.05, dtMs / 1000);
    // the pill eases after the pointer…
    const k = 1 - Math.exp(-dt / 0.08);
    this.pos.x += (this.at.x - this.pos.x) * k;
    this.pos.y += (this.at.y - this.pos.y) * k;
    // …and a droplet trails out of its back end, opposite to where it is heading
    const dx = this.at.x - this.pos.x;
    const dy = this.at.y - this.pos.y;
    const len = Math.hypot(dx, dy);
    const t = Math.min(1, len / 30);
    const reach = t * t * (3 - 2 * t);
    const hw = this.size.w / 2;
    let ox = 0;
    let oy = 0;
    if (len > 0.01) {
      const ux = -dx / len;
      const uy = -dy / len;
      // distance from the pill's centre to its outline along that direction (as an ellipse)
      const edge = 1 / Math.hypot(ux / hw, uy / (H / 2));
      ox = ux * (edge + 10) * reach;
      oy = uy * (edge + 10) * reach;
    }
    this.el.style.transform = `translate(${(this.pos.x + 16).toFixed(1)}px, ${(this.pos.y + 14).toFixed(1)}px)`;
    this.pill.style.width = `${this.size.w.toFixed(2)}px`;
    this.drop.style.transform = `translate(${(hw + ox).toFixed(1)}px, ${(H / 2 + oy).toFixed(1)}px) scale(${(1 - 0.3 * reach).toFixed(3)})`;
  };

  /** Show a word (or hide with null). Cheap to call every frame. */
  set(label: string | null): void {
    if (!this.enabled || label === this.label) return;
    const was = this.label;
    this.label = label;
    if (label === null) {
      gsap.to(this.text, { autoAlpha: 0, duration: 0.15, overwrite: true });
      gsap.to(this.goo, { scale: 0, duration: 0.3, ease: 'power3.in', overwrite: true });
      this.flap.set(' '.repeat(CELLS), true);
      return;
    }
    this.ch = (this.text.querySelector('.flap > span') as HTMLElement | null)?.offsetWidth || this.ch;
    const w = label.length * this.ch + PAD * 2;
    gsap.set(this.text, { width: label.length * this.ch, x: PAD });
    if (was === null) {
      // drip in where the pointer is: a droplet that swells into the pill
      this.pos.x = this.at.x;
      this.pos.y = this.at.y;
      this.size.w = H;
      gsap.to(this.goo, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.55)', overwrite: true });
      gsap.to(this.size, { w, duration: 0.7, delay: 0.05, ease: 'elastic.out(1, 0.6)', overwrite: true });
      gsap.to(this.text, { autoAlpha: 1, duration: 0.25, delay: 0.12, overwrite: true });
    } else {
      // a new word: the liquid swells or narrows to fit it, with a little wobble
      gsap.to(this.size, { w, duration: 0.6, ease: 'elastic.out(1, 0.65)', overwrite: true });
    }
    this.flap.set(label.padEnd(CELLS, ' '));
  }
}
