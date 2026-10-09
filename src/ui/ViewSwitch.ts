import gsap from 'gsap';

type Mode = 'gallery' | 'grid';

/**
 * The Gallery / Grid switch: a segmented control.
 *
 * A black thumb sits under the active option and flows to the other one like
 * the slider's liquid: its leading edge leaves first and the trailing edge
 * catches up, so it stretches (and thins a little) on the way. A copy of the
 * icons in white is clipped to the thumb, so whatever part of an icon is over
 * it reads white and the rest grey, pixel for pixel while it moves. The label next
 * to it states the current view ("VIEW — GRID") and, once the pointer rests on
 * the other option, previews it in grey (the cross-fade itself is CSS). It is a
 * radio group: arrow keys move the selection, the active option has no hover
 * and does nothing on click.
 */
export class ViewSwitch {
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly lit: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly label: HTMLElement;
  private readonly edge = { l: 0, r: 0 };
  private mode: Mode;
  /** Hover intent: the preview waits a beat, so passing over the option does nothing. */
  private hoverTimer = 0;
  private size = 0;
  private inset = 0;
  private radius = 0;

  constructor(
    root: HTMLElement,
    mode: Mode,
    private readonly onPick: (mode: Mode) => void,
    private readonly reducedMotion = false,
  ) {
    this.track = root.querySelector('.sw-track') as HTMLElement;
    this.thumb = root.querySelector('.sw-thumb') as HTMLElement;
    this.buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.sw'));
    this.label = root.querySelector('.om-view') as HTMLElement;
    this.mode = mode;

    // the white icons, clipped to the thumb
    this.lit = document.createElement('span');
    this.lit.className = 'sw-lit';
    this.lit.setAttribute('aria-hidden', 'true');
    for (const b of this.buttons) {
      const icon = document.createElement('span');
      icon.className = 'sw-lit-icon';
      icon.appendChild(b.querySelector('svg')!.cloneNode(true));
      this.lit.appendChild(icon);
    }
    this.track.appendChild(this.lit);

    this.buttons.forEach((b) => {
      b.addEventListener('click', () => this.pick(b.dataset.mode as Mode));
      b.addEventListener('pointerenter', () => {
        clearTimeout(this.hoverTimer);
        if (b.dataset.mode === this.mode) return;
        this.hoverTimer = window.setTimeout(() => {
          if (b.dataset.mode !== this.mode) this.showLabel(b.dataset.mode as Mode, true);
        }, 140);
      });
      b.addEventListener('pointerleave', () => {
        clearTimeout(this.hoverTimer);
        this.showLabel(this.mode, false);
      });
    });
    this.track.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      // the switch owns the arrows while it has focus (the gallery uses them otherwise)
      e.preventDefault();
      e.stopPropagation();
      this.pick(this.mode === 'grid' ? 'gallery' : 'grid');
      this.button(this.mode).focus();
    });
    window.addEventListener('resize', () => this.set(this.mode, true));
    this.set(mode, true);
  }

  /** Reflect a view change (from here, the keyboard or anywhere else). */
  set(mode: Mode, instant = false): void {
    const moved = mode !== this.mode;
    this.mode = mode;
    this.buttons.forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.moveThumb(instant || !moved);
    clearTimeout(this.hoverTimer);
    this.showLabel(mode, false);
  }

  private pick(mode: Mode): void {
    if (mode === this.mode) return;
    this.onPick(mode);
  }

  private button(mode: Mode): HTMLButtonElement {
    return this.buttons.find((b) => b.dataset.mode === mode)!;
  }

  private moveThumb(instant: boolean): void {
    const b = this.button(this.mode);
    const l = b.offsetLeft;
    const r = l + b.offsetWidth;
    this.size = b.offsetWidth;
    this.inset = b.offsetTop;
    this.radius = parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0;
    const e = this.edge;
    gsap.killTweensOf(e);
    if (instant || this.reducedMotion) {
      e.l = l;
      e.r = r;
      this.place();
      return;
    }
    // the edge on the side of travel leads, the other one follows
    const right = l > e.l;
    const lead = { duration: 0.42, ease: 'power3.inOut', onUpdate: this.place };
    const lag = { duration: 0.46, delay: 0.08, ease: 'power3.inOut', onUpdate: this.place };
    gsap.to(e, { r, ...(right ? lead : lag) });
    gsap.to(e, { l, ...(right ? lag : lead) });
  }

  private place = (): void => {
    const { l, r } = this.edge;
    const w = Math.max(1, r - l);
    const stretch = this.size ? Math.min(1, Math.max(0, w / this.size - 1)) : 0;
    const sy = 1 - 0.14 * stretch;
    this.thumb.style.width = `${w}px`;
    this.thumb.style.transform = `translateX(${l}px) scaleY(${sy.toFixed(3)})`;
    const v = (this.inset + (this.size * (1 - sy)) / 2).toFixed(2);
    const right = (this.track.clientWidth - r).toFixed(2);
    this.lit.style.clipPath = `inset(${v}px ${right}px ${v}px ${l.toFixed(2)}px round ${this.radius}px)`;
  };

  private showLabel(mode: Mode, preview: boolean): void {
    this.label.dataset.show = mode;
    this.label.classList.toggle('is-preview', preview);
  }
}
