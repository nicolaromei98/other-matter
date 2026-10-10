import gsap from 'gsap';

/** Glyphs flashed while a cell turns (all in the Akkurat Mono subset). */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/';
export const BLANK = '\u00a0';

export interface FlapOptions {
  /** Fixed number of cells (defaults to the first text's length). */
  cells?: number;
  /** Delay between cells, s. */
  stagger?: number;
  reducedMotion?: boolean;
  /** Called as each turning cell lands (sound). */
  onLand?: () => void;
}

/** Centre `text` in `cells` cells with blank padding. */
export function centred(text: string, cells: number): string {
  const free = Math.max(0, cells - text.length);
  const left = Math.floor(free / 2);
  return BLANK.repeat(left) + text + BLANK.repeat(free - left);
}

/**
 * Split-flap text: a row of monospace cells. Each cell whose letter changes
 * turns over in perspective, flashes a random glyph on the way and lands on
 * the new letter, in a cascade from the left. Letters that stay the same do
 * not move; interrupting a turn starts the next one from where the cell is.
 * Cells are 1ch wide, so in a monospace face the row never changes width.
 */
export class Flap {
  private readonly cells: HTMLElement[] = [];
  private readonly target: string[] = [];
  private readonly flips: (gsap.core.Timeline | null)[] = [];
  private readonly stagger: number;

  constructor(
    readonly el: HTMLElement,
    text: string,
    private readonly opts: FlapOptions = {},
  ) {
    this.stagger = opts.stagger ?? 0.045;
    el.classList.add('flap');
    el.textContent = '';
    const n = opts.cells ?? text.length;
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('span');
      cell.textContent = BLANK;
      el.appendChild(cell);
      this.cells.push(cell);
      this.target.push(BLANK);
      this.flips.push(null);
    }
    this.set(text, true);
  }

  get text(): string {
    return this.target.join('');
  }

  /** Turn the cells whose letter changes. */
  set(text: string, instant = false): void {
    this.turn(text, instant, false);
  }

  /** Scramble every letter and land back on the same text: a quick "decode". */
  shuffle(): void {
    this.turn(this.text, false, true);
  }

  private turn(text: string, instant: boolean, all: boolean): void {
    let order = 0;
    this.cells.forEach((cell, i) => {
      const next = text[i] ?? BLANK;
      if (!all && next === this.target[i]) return;
      if (all && next === BLANK) return;
      this.target[i] = next;
      // stop the whole turn, letter swaps included, and start from where the cell is
      this.flips[i]?.kill();
      this.flips[i] = null;
      if (instant || this.opts.reducedMotion) {
        cell.textContent = next;
        gsap.set(cell, { rotationX: 0, opacity: 1 });
        return;
      }
      const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      this.flips[i] = gsap
        .timeline({ delay: order++ * this.stagger })
        // the old letter tilts away…
        .to(cell, { rotationX: -90, opacity: 0.15, duration: 0.17, ease: 'power2.in' })
        // …a random glyph comes round the other side…
        .add(() => {
          cell.textContent = next === BLANK ? BLANK : glyph();
        })
        .fromTo(
          cell,
          { rotationX: 90, opacity: 0.15 },
          // not applied up front: the old letter must tilt away first
          { rotationX: 0, opacity: 1, duration: 0.42, ease: 'power3.out', immediateRender: false },
        )
        // …and resolves into the new letter as it settles
        .add(() => {
          cell.textContent = next;
          this.opts.onLand?.();
        }, '-=0.3');
    });
  }
}
