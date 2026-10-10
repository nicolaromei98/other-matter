import gsap from 'gsap';
import { Flap, centred } from './Flap';

const CELLS = 8;

/**
 * A small split-flap tag that rides next to the pointer and says what a click
 * or a drag will do there ("OPEN", "STRIKE", "ROTATE"...). The system cursor
 * stays (the hand over specimens); this only adds context. It eases after
 * the pointer, changes word with the split-flap turn, and hides when there is
 * nothing to say. Fine pointers only.
 */
export class CursorTag {
  private readonly el: HTMLElement;
  private readonly flap: Flap;
  private readonly pos = { x: -100, y: -100 };
  private readonly at = { x: -100, y: -100 };
  private label: string | null = null;
  private readonly enabled = matchMedia('(pointer: fine)').matches;

  constructor(reducedMotion: boolean, onLand?: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'om-cursor';
    this.el.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'om-label';
    this.el.appendChild(text);
    document.body.appendChild(this.el);
    this.flap = new Flap(text, centred('', CELLS), { cells: CELLS, stagger: 0.03, reducedMotion, onLand });
    gsap.set(this.el, { autoAlpha: 0, scale: 0.8 });
    if (!this.enabled) return;

    window.addEventListener(
      'pointermove',
      (e) => {
        this.at.x = e.clientX;
        this.at.y = e.clientY;
      },
      { passive: true },
    );
    gsap.ticker.add((_t, dt) => {
      const k = 1 - Math.exp(-dt / 1000 / 0.07);
      this.pos.x += (this.at.x - this.pos.x) * k;
      this.pos.y += (this.at.y - this.pos.y) * k;
      this.el.style.transform = `translate(${(this.pos.x + 16).toFixed(1)}px, ${(this.pos.y + 18).toFixed(1)}px)`;
    });
  }

  /** Show a word (or hide with null). Cheap to call every frame. */
  set(label: string | null): void {
    if (!this.enabled || label === this.label) return;
    const was = this.label;
    this.label = label;
    if (label === null) {
      gsap.to(this.el, { autoAlpha: 0, scale: 0.8, duration: 0.25, ease: 'power2.in', overwrite: true });
      return;
    }
    if (was === null) {
      // appear in place, then flap in the word
      this.pos.x = this.at.x;
      this.pos.y = this.at.y;
      gsap.to(this.el, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power3.out', overwrite: true });
    }
    this.flap.set(centred(label, CELLS));
  }
}
