import gsap from 'gsap';
import { MATERIALS, type MaterialEntry } from '../data/materials';
import type { Engine } from '../core/Engine';
import type { Sound } from '../core/Sound';
import type { ScreenCircle } from '../core/types';
import type { Specimen } from '../specimens/Specimen';
import { clamp, damp, easeMove, lerp } from '../core/math';
import { Transmutation } from './transmute/Transmutation';
import { GooeySlider } from './GooeySlider';
import { Atmosphere } from './Atmosphere';
import { InspectSheet } from './InspectSheet';
import { ViewSwitch } from '../ui/ViewSwitch';
import { Flap } from '../ui/Flap';
import { CursorTag } from '../ui/CursorTag';
import { magnetic } from '../ui/Magnetic';
import { LiquidNav } from './LiquidNav';

type Mode = 'gallery' | 'grid';

/** Duration of the grid ↔ gallery move; the page scroll runs on the same clock and curve. */
const MOVE = 1.2;

/** Per-specimen motion between two anchors. `t` is driven (and eased) by GSAP. */
interface Track {
  from: ScreenCircle;
  t: number;
  /** Depth arc, as a fraction of the larger radius (negative = recede). */
  lift: number;
  /** Lateral arc, as a fraction of the travelled distance. */
  arc: number;
  /** Interpolate the radius in log space (perceptually even scaling). */
  logScale: boolean;
  /**
   * Fixed screen target while in flight (where the anchor will be once the page
   * has finished scrolling). Keeps the path straight even though the page scrolls
   * under it; the live anchor takes over when the track completes.
   */
  to: ScreenCircle | null;
  tween?: gsap.core.Tween;
}

interface TrackOptions {
  duration: number;
  delay?: number;
  lift?: number;
  arc?: number;
  ease?: string | ((t: number) => number);
  from?: ScreenCircle;
  to?: ScreenCircle;
  logScale?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const qs = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const qsa = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
const ln = (html: string) => `<span class="ln"><span>${html}</span></span>`;

/**
 * The whole site: one continuous exhibition with two presentations.
 *
 * Every specimen always exists in the shared WebGL space. A layout is only a
 * set of DOM anchors (gallery stage, gallery dots, grid ellipses) measured
 * every frame; changing layout re-targets each specimen's track from wherever
 * it is right now to its new anchor. Because targets are live, scrolling,
 * resizing and interrupting a transition never cause jumps.
 */
export class Exhibition {
  mode: Mode;
  selected: number;

  private readonly root: HTMLElement;
  private readonly stageArea: HTMLElement;
  private readonly gallery: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly shortEl: HTMLElement;
  private readonly navEl: HTMLElement;
  private readonly pillEl: HTMLElement;
  private readonly dotEls: HTMLButtonElement[] = [];
  private readonly cardEls: HTMLElement[] = [];
  private readonly ellipseEls: HTMLElement[] = [];
  private readonly viewSwitch: ViewSwitch;
  /** Split-flap codes: the gallery's, and each card's (decoded on hover). */
  private codeFlap!: Flap;
  private readonly cardFlaps: Flap[][] = [];

  private readonly anchors: ScreenCircle[] = MATERIALS.map(() => ({ x: 0, y: 0, r: 0, z: 0 }));
  private readonly tracks: Track[] = MATERIALS.map(() => ({ from: { x: 0, y: 0, r: 0, z: 0 }, t: 1, lift: 0, arc: 0, logScale: true, to: null }));
  private modeToken = 0;
  private textToken = 0;
  private wasOver: boolean[] = MATERIALS.map(() => false);
  private swipe: { x: number; y: number; on: boolean } = { x: 0, y: 0, on: false };
  /** Surface transmutation between gallery specimens (null → spatial fallback without WebGL). */
  private readonly morph: Transmutation | null;
  /** Specimens held on the stage regardless of selection (outgoing, mid-transition). */
  private readonly hold = new Set<number>();
  /** Latest destination requested while a transition runs. */
  private pending: number | null = null;
  /** Specimens dissolving in place in their card while the gallery opens. */
  private readonly fading = new Set<number>();
  /** In-place scale used by the dissolve-in / dissolve-out of the non-selected specimens. */
  private readonly fx = MATERIALS.map(() => ({ scale: 1 }));
  /** Liquid slider: motion and hit areas (DOM) … */
  private readonly nav: LiquidNav;
  /** … and its rendering, with live thumbnails (WebGL). */
  private readonly slider: GooeySlider | null;
  /** Inspect: the stage specimen close up, turnable, with its sheet pinned to it. */
  inspecting = false;
  private readonly sheet: InspectSheet | null;
  /** Contextual tag next to the pointer, and the card under it (grid). */
  private readonly cursor: CursorTag;
  private cardHover: number | null = null;
  /** Grid scroll response: smoothed page velocity (px/s) and the last scroll position. */
  private scrollVel = 0;
  private lastScrollY = 0;
  /** Contact shadows, vignette and grain (WebGL). */
  readonly atmosphere: Atmosphere | null;

  constructor(
    root: HTMLElement,
    private readonly engine: Engine | null,
    private readonly specimens: Specimen[],
    private readonly sound: Sound,
  ) {
    this.root = root;
    this.stageArea = qs('.om-stage', root);
    this.gallery = qs('.gallery', root);
    this.stageEl = qs('.g-stage', root);
    this.titleEl = qs('.g-title', root);
    this.shortEl = qs('.g-short', root);
    this.navEl = qs('.g-nav', root);
    this.pillEl = qs('.g-pill', root);

    const params = new URLSearchParams(location.search);
    const fromUrl = MATERIALS.findIndex((m) => m.slug === params.get('specimen'));
    this.selected = fromUrl >= 0 ? fromUrl : 0;
    // the archive grid is the landing view; ?view=gallery opens on the stage
    this.mode = params.get('view') === 'gallery' ? 'gallery' : 'grid';

    this.cursor = new CursorTag(!!engine?.reducedMotion, this.tick);
    this.build();
    this.bind();
    magnetic(qsa('.om-sound, .g-scan, .g-inspect, .sw-track', root));
    this.root.dataset.mode = this.mode;
    this.viewSwitch = new ViewSwitch(
      qs('.om-switch', root),
      this.mode,
      (mode) => (mode === 'grid' ? this.toGrid() : this.toGallery()),
      !!engine?.reducedMotion,
      this.tick,
    );
    this.syncDots();
    this.setGalleryText(this.selected);
    this.applyInteractivity();
    this.measureGallery();
    this.nav = new LiquidNav(this.pillEl, this.dotEls, qs('.g-next', root), qs('.g-prev', root));
    this.nav.select(this.selected, true);
    this.nav.layout();
    this.measureAnchors();
    this.specimens.forEach((s, i) => Object.assign(s.screen, this.anchors[i]));

    this.morph = engine ? new Transmutation(engine) : null;
    this.morph?.prepare(this.stageRadius());
    this.slider = engine ? new GooeySlider(engine, specimens, this.nav) : null;
    this.atmosphere = engine ? new Atmosphere(engine, specimens) : null;
    this.sheet = engine ? new InspectSheet(engine, engine.reducedMotion, this.tick) : null;
    this.setTint(this.mode === 'gallery' ? this.selected : null);
    this.measureNav();
    if (engine) engine.onLayout = (dt) => this.layout(dt);
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  private build(): void {
    const dots = qs('.g-dots', this.root);
    const grid = qs('.grid', this.root);
    MATERIALS.forEach((m, i) => {
      const dot = document.createElement('button');
      dot.className = 'g-dot';
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show ${m.name}`);
      dot.style.setProperty('--fb1', m.fallback[0]);
      dot.style.setProperty('--fb2', m.fallback[1]);
      dot.addEventListener('click', () => this.select(i));
      dots.appendChild(dot);
      this.dotEls.push(dot);

      const card = document.createElement('article');
      card.className = 'card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${m.name}, ${m.classification}. Open in gallery view.`);
      card.style.setProperty('--fb1', m.fallback[0]);
      card.style.setProperty('--fb2', m.fallback[1]);
      card.innerHTML = `
        <div class="card-bg"></div>
        <div class="card-head">
          <div class="card-idblock">
            <div class="card-id">${ln(m.code)}</div>
            <p class="card-name">${ln(`<b>${m.name.toUpperCase()}</b>`)}${ln(m.classification)}</p>
          </div>
          <div class="om-label card-spec">${ln(`SPECIMEN — ${pad(m.index)}`)}</div>
        </div>
        <div class="card-ellipse"></div>
        <div class="card-foot">
          <p class="card-desc">${ln(m.short)}</p>
          <div class="card-brand">${ln('Other Matter®')}</div>
        </div>`;
      card.addEventListener('click', () => {
        // a drag that ends on the card is handling the specimen, not a click
        if (this.engine && this.engine.pointer.travel > 6) return;
        this.toGallery(i);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toGallery(i);
        }
      });
      grid.appendChild(card);
      this.cardEls.push(card);
      this.ellipseEls.push(qs('.card-ellipse', card));
      const flaps = [qs('.card-id .ln > span', card), qs('.card-spec .ln > span', card)].map(
        (el) => new Flap(el, el.textContent ?? '', { stagger: 0.03, reducedMotion: this.reduced, onLand: this.tick }),
      );
      this.cardFlaps.push(flaps);
      card.addEventListener('pointerenter', () => {
        this.cardHover = i;
        flaps.forEach((f) => f.shuffle());
      });
      card.addEventListener('pointerleave', () => {
        if (this.cardHover === i) this.cardHover = null;
      });
    });
    this.codeFlap = new Flap(qs('.g-code', this.root), MATERIALS[this.selected].code, {
      reducedMotion: this.reduced,
      onLand: this.tick,
    });
    this.stageEl.style.setProperty('--fb1', MATERIALS[this.selected].fallback[0]);
    this.stageEl.style.setProperty('--fb2', MATERIALS[this.selected].fallback[1]);
  }

  private bind(): void {
    qs('.g-scan', this.root).addEventListener('click', () => this.scan(this.selected));
    qs('.g-inspect', this.root).addEventListener('click', () => this.enterInspect());
    // a click on empty space closes Inspect
    window.addEventListener('pointerup', (e) => {
      if (!this.inspecting || !this.engine || this.engine.hovered || this.engine.pointer.travel > 6) return;
      if ((e.target as HTMLElement).closest?.('button, a')) return;
      this.exitInspect();
    });
    qs('.g-next', this.root).addEventListener('click', () => this.step(1));
    qs('.g-prev', this.root).addEventListener('click', () => this.step(-1));

    const soundBtn = qs<HTMLButtonElement>('.om-sound', this.root);
    const soundFlap = new Flap(qs('.om-sound-v', soundBtn), this.sound.enabled ? 'ON' : 'OFF', {
      cells: 3,
      reducedMotion: this.reduced,
      onLand: this.tick,
    });
    const renderSound = (on: boolean) => {
      soundFlap.set(on ? 'ON' : 'OFF');
      soundBtn.setAttribute('aria-pressed', String(on));
    };
    renderSound(this.sound.enabled);
    soundBtn.addEventListener('click', () => this.sound.toggle());
    this.sound.onChange(renderSound);

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        this.exitInspect();
      } else if (e.key === 'i' || e.key === 'I') {
        if (this.inspecting) this.exitInspect();
        else this.enterInspect();
      } else if (this.mode === 'gallery' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        this.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 's' || e.key === 'S') {
        if (this.mode === 'gallery') this.scan(this.selected);
      } else if (e.key === 'v' || e.key === 'V') {
        // V toggles the view
        if (this.mode === 'grid') this.toGallery();
        else this.toGrid();
      }
    });

    // Swipe between specimens in the gallery (outside the specimen itself).
    window.addEventListener('pointerdown', (e) => {
      this.swipe.on = this.mode === 'gallery' && !this.engine?.hovered && e.clientY > this.stageArea.getBoundingClientRect().top;
      this.swipe.x = e.clientX;
      this.swipe.y = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.swipe.on) return;
      this.swipe.on = false;
      const dx = e.clientX - this.swipe.x;
      const dy = e.clientY - this.swipe.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) this.step(dx < 0 ? 1 : -1);
    });

    const onResize = () => {
      this.measureGallery();
      this.measureNav();
      this.morph?.prepare(this.stageRadius());
    };
    window.addEventListener('resize', onResize);
    document.fonts?.ready.then(onResize);
  }

  private syncSwitch(): void {
    this.viewSwitch.set(this.mode);
  }

  private syncDots(): void {
    this.dotEls.forEach((d, i) => d.setAttribute('aria-current', String(i === this.selected)));
    const m = MATERIALS[this.selected];
    this.stageEl.setAttribute('aria-label', `${m.name}, ${m.classification}. ${m.description}`);
  }

  private syncUrl(): void {
    const p = new URLSearchParams(location.search);
    p.set('view', this.mode);
    p.set('specimen', MATERIALS[this.selected].slug);
    history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
  }

  /** Split-flap landing sound (rate-limited in Sound). */
  private readonly tick = (): void => this.sound.tick();

  private get reduced(): boolean {
    return !!this.engine?.reducedMotion;
  }

  /** The page takes a whisper of the colour of the specimen on the stage (white in the grid). */
  private setTint(i: number | null): void {
    document.documentElement.style.setProperty('--bg', i === null ? '#ffffff' : MATERIALS[i].tint);
  }

  private galleryMarkup(m: MaterialEntry): [string, string] {
    return [ln(`<b>${m.name}</b>`) + ln(m.classification), ln(m.short)];
  }

  private setGalleryText(i: number): void {
    const [title, short] = this.galleryMarkup(MATERIALS[i]);
    this.titleEl.innerHTML = title;
    this.shortEl.innerHTML = short;
  }

  private galleryLines(): HTMLElement[] {
    return qsa('.g-title .ln > span, .g-short .ln > span', this.gallery);
  }

  /** Masked text swap: old lines leave upward, new lines rise in; the code flaps over. */
  private swapGalleryText(i: number): void {
    const token = ++this.textToken;
    this.codeFlap.set(MATERIALS[i].code);
    const old = this.galleryLines();
    gsap.killTweensOf(old);
    gsap.to(old, {
      yPercent: -110,
      duration: 0.42,
      ease: 'power3.in',
      stagger: 0.04,
      onComplete: () => {
        if (token !== this.textToken) return;
        this.setGalleryText(i);
        gsap.fromTo(this.galleryLines(), { yPercent: 110 }, { yPercent: 0, duration: 0.85, ease: 'power4.out', stagger: 0.06 });
      },
    });
  }

  /** GPU warm-up behind the loader (see Transmutation.warm). */
  warm(): void {
    this.morph?.warm(this.specimens);
    this.morph?.prepare(this.stageRadius());
  }

  private stageRadius(): number {
    const r = this.stageEl.getBoundingClientRect();
    return Math.min(r.width, r.height) / 2;
  }

  private measureNav(): void {
    this.nav.measure();
    // thumbnail cell = the active porthole's specimen box (see gooey.frag: RING, THUMB)
    const ra = (this.pillEl.offsetHeight || 51) / 2;
    this.slider?.setThumbSize(ra * (1 - 0.13) * 0.8 * 1.15 * 2);
  }

  // ── Measurement ────────────────────────────────────────────────────────

  /** Gallery fills the viewport under the header; the stage fits what is left. */
  private measureGallery(): void {
    const style = this.root.style;
    const top = this.stageArea.getBoundingClientRect().top + window.scrollY;
    const padBottom = parseFloat(getComputedStyle(this.root).paddingBottom) || 0;
    const gh = Math.max(360, window.innerHeight - top - padBottom);
    style.setProperty('--gallery-h', `${gh}px`);
    const vw = window.innerWidth;
    const mobile = vw <= 760;
    const navH = this.navEl.offsetHeight;
    let stage: number;
    if (mobile) {
      const nameH = qs('.g-name', this.gallery).offsetHeight;
      const descH = qs('.g-desc', this.gallery).offsetHeight;
      stage = Math.min(vw * 0.78, gh - navH - nameH - descH - 48);
    } else {
      stage = Math.min((555 * vw) / 1920, gh - navH - 24);
    }
    style.setProperty('--stage', `${Math.max(140, Math.round(stage))}px`);
  }

  private rectOf(el: HTMLElement, out: ScreenCircle, fit = 1): void {
    const r = el.getBoundingClientRect();
    out.x = r.left + r.width / 2;
    out.y = r.top + r.height / 2;
    out.r = (Math.min(r.width, r.height) / 2) * fit;
    out.z = 0;
  }

  /**
   * Gallery: the selected specimen (and an outgoing one mid-transition) on the
   * stage; the others wait, collapsed to nothing, at the centre of their slot,
   * except while they are still dissolving in their card.
   * Grid: each specimen in its card ellipse.
   */
  private measureAnchors(): void {
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (this.mode === 'grid' || this.fading.has(i)) this.rectOf(this.ellipseEls[i], a);
      else if (this.inspecting && i === this.selected) this.inspectAnchor(a);
      else if (i === this.selected || this.hold.has(i)) this.rectOf(this.stageEl, a);
      else this.rectOf(this.dotEls[i], a, 0);
    }
  }

  // ── Per-frame layout ───────────────────────────────────────────────────

  private layout(dt: number): void {
    this.nav.layout();
    this.measureAnchors();
    this.scrollResponse(dt);
    this.cursor.set(this.cursorContext());
    this.sheet?.update(this.specimens[this.selected]);
    for (let i = 0; i < this.specimens.length; i++) {
      const s = this.specimens[i];
      const a = this.anchors[i];
      const tr = this.tracks[i];
      const out = s.screen;
      const e = tr.t;
      if (e >= 1) {
        out.x = a.x;
        out.y = a.y + this.scrollLag(i);
        out.r = a.r * this.fx[i].scale;
        out.z = 0;
        continue;
      }
      const f = tr.from;
      const b = tr.to ?? a;
      out.x = lerp(f.x, b.x, e);
      out.y = lerp(f.y, b.y, e);
      out.r = tr.logScale && f.r > 0.5 && b.r > 0.5 ? Math.exp(lerp(Math.log(f.r), Math.log(b.r), e)) : lerp(f.r, b.r, e);
      const s1 = Math.sin(Math.PI * e);
      const dx = b.x - f.x;
      const dy = b.y - f.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        out.x += (-dy / dist) * s1 * tr.arc * dist;
        out.y += (dx / dist) * s1 * tr.arc * dist;
      }
      out.z = lerp(f.z, 0, e) + s1 * tr.lift * Math.max(f.r, b.r);
    }
    this.hoverSounds();
  }

  /**
   * Grid only, user scrolling only (not the scroll a transition drives): the
   * specimens lag a little behind their cards, each at its own depth, and
   * stretch and tip with the speed, settling back when the page stops.
   */
  private scrollResponse(dt: number): void {
    const y = window.scrollY;
    const v = (y - this.lastScrollY) / Math.max(dt, 1 / 240);
    this.lastScrollY = y;
    const live = this.mode === 'grid' && !this.root.classList.contains('is-transitioning') && !this.reduced;
    this.scrollVel = damp(this.scrollVel, live ? clamp(v, -4000, 4000) : 0, 7, dt);
    const sv = this.scrollVel;
    for (const s of this.specimens) {
      s.squash = clamp(Math.abs(sv) * 0.000045, 0, 0.09);
      s.tilt = clamp(sv * 0.00012, -0.2, 0.2);
    }
  }

  /** What the pointer would do here, for the cursor tag (null: nothing to say). */
  private cursorContext(): string | null {
    const e = this.engine;
    if (!e || e.pointer.x < -1000) return null;
    const h = e.hovered;
    const onSpecimen = !!h && h.interactive && h.input.hit;
    if (this.inspecting) {
      if (h === this.specimens[this.selected] && h.input.pressed) return 'ROTATE';
      return onSpecimen ? 'DRAG' : 'CLOSE';
    }
    if (this.mode === 'grid') return onSpecimen || this.cardHover !== null ? 'OPEN' : null;
    if (onSpecimen && h === this.specimens[this.selected] && !this.morph?.running) return h.entry.verb;
    return null;
  }

  /** Vertical lag behind the card (px): deeper cards lag more, a slow parallax. */
  private scrollLag(i: number): number {
    const depth = 0.7 + 0.15 * ((i * 3) % 5);
    return clamp(this.scrollVel * 0.014 * depth, -24, 24);
  }

  /** Hover enter on a live specimen plays its voice; the material resonates with it. */
  private hoverSounds(): void {
    const engine = this.engine;
    if (!engine) return;
    this.specimens.forEach((s, i) => {
      const over = s.input.over && s.input.hit && s.interactive;
      if (over && !this.wasOver[i]) {
        const pan = ((s.screen.x / engine.width) * 2 - 1) * 0.6;
        const dur = this.sound.play(s.entry.slug, this.mode === 'grid' ? 0.6 : 1, pan);
        // long recordings: the visual resonance follows the attack, not the whole tail
        s.resonate(Math.min(dur || 1.2, 2), engine.globals.uTime.value);
      }
      this.wasOver[i] = over;
    });
  }

  private applyInteractivity(): void {
    const morphing = !!this.morph?.running;
    this.specimens.forEach((s, i) => {
      const onStage = this.mode === 'gallery' && i === this.selected && !morphing;
      s.interactive = this.mode === 'grid' || onStage;
      s.tapAction = onStage && !this.inspecting;
    });
  }

  // ── Tracks ─────────────────────────────────────────────────────────────

  private startTrack(i: number, o: TrackOptions): void {
    const tr = this.tracks[i];
    tr.tween?.kill();
    const cur = this.specimens[i]?.screen ?? this.anchors[i];
    tr.from = o.from ? { ...o.from } : { x: cur.x, y: cur.y, r: cur.r, z: cur.z };
    tr.t = 0;
    tr.lift = o.lift ?? 0;
    tr.arc = o.arc ?? 0;
    tr.logScale = o.logScale ?? true;
    tr.to = o.to ? { ...o.to } : null;
    const reduced = this.engine?.reducedMotion;
    tr.tween = gsap.to(tr, {
      t: 1,
      duration: reduced ? 0.35 : o.duration,
      delay: reduced ? 0 : (o.delay ?? 0),
      ease: o.ease ?? 'power3.inOut',
      onComplete: () => {
        tr.to = null;
      },
    });
  }

  /** Order specimens by distance (in grid cells) from the focused one. */
  private rankFrom(focus: number): number[] {
    const cell = (i: number) => [i % 2, Math.floor(i / 2)];
    const [fx, fy] = cell(focus);
    const rank = MATERIALS.map((_, i) => {
      const [x, y] = cell(i);
      return Math.hypot(x - fx, y - fy);
    });
    const order = MATERIALS.map((_, i) => i).sort((a, b) => rank[a] - rank[b]);
    const out: number[] = [];
    order.forEach((i, k) => (out[i] = k));
    return out;
  }

  // ── Public transitions ─────────────────────────────────────────────────

  /** Entry choreography: every specimen grows out of its own anchor. */
  intro(): void {
    this.measureAnchors();
    const order = this.rankFrom(this.selected);
    this.specimens.forEach((_, i) => {
      const a = this.anchors[i];
      this.startTrack(i, {
        from: { x: a.x, y: a.y + a.r * 0.15, r: 0, z: 0 },
        duration: i === this.selected || this.mode === 'grid' ? 1.6 : 1.1,
        delay: 0.15 + order[i] * 0.08,
        ease: 'expo.out',
        logScale: false,
      });
    });
    const lines = [...qsa('.om-title .ln > span', this.root)];
    gsap.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: 0.08, delay: 0.1 });
    gsap.fromTo(qs('.om-rule', this.root), { scaleX: 0 }, { scaleX: 1, duration: 1.4, ease: 'power3.inOut', delay: 0.15 });
    gsap.fromTo(qsa('.om-label, .sw-track, .om-logo', qs('.om-head', this.root)), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, stagger: 0.04, delay: 0.4 });
    if (this.mode === 'gallery') {
      gsap.fromTo(this.galleryLines(), { yPercent: 110 }, { yPercent: 0, duration: 1, ease: 'power4.out', stagger: 0.06, delay: 0.55 });
      gsap.fromTo(this.navEl, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.8, delay: 0.7 });
      if (this.slider) gsap.fromTo(this.slider.visibility, { value: 0 }, { value: 1, duration: 0.8, delay: 0.75 });
      gsap.delayedCall(1.3, () => this.scan(this.selected));
    } else {
      this.cardEls.forEach((c, i) => this.revealCard(c, 0.35 + order[i] * 0.08));
    }
  }

  /** Gallery → Grid: the stage specimen settles into its card; the others dissolve in, in place. */
  toGrid(): void {
    if (this.mode === 'grid') return;
    this.exitInspect(true);
    this.pending = null;
    this.morph?.cancel();
    this.hold.forEach((i) => this.collapseToSlot(i));
    this.hold.clear();
    const token = ++this.modeToken;
    // specimens still dissolving from a previous switch are visible on their card
    const onCard = new Set(this.fading);
    this.fading.clear();
    this.mode = 'grid';
    this.setTint(null);
    this.syncSwitch();
    this.syncUrl();
    this.sound.ui('switch');
    this.root.classList.add('is-transitioning');
    this.root.dataset.mode = 'grid';
    this.applyInteractivity();

    // Grid is laid out now: prepare cards hidden, they appear as specimens land.
    this.cardEls.forEach((c) => this.collapseCard(c, true));
    const scrollTarget = this.scrollToCard(this.selected, MOVE);
    const card = this.ellipseEls[this.selected].getBoundingClientRect();
    const landing: ScreenCircle = {
      x: card.left + card.width / 2,
      y: card.top + card.height / 2 + window.scrollY - scrollTarget,
      r: Math.min(card.width, card.height) / 2,
      z: 0,
    };

    gsap.killTweensOf(this.galleryLines());
    gsap.to(this.galleryLines(), { yPercent: -110, duration: 0.45, ease: 'power3.in', stagger: 0.03 });
    gsap.to(this.navEl, { autoAlpha: 0, y: 8, duration: 0.4, ease: 'power2.in', overwrite: true });
    if (this.slider) gsap.to(this.slider.visibility, { value: 0, duration: 0.3, ease: 'power2.in', overwrite: true });

    const order = this.rankFrom(this.selected);
    let end = 0;
    this.specimens.forEach((s, i) => {
      if (i === this.selected) {
        // the stage specimen is the only one that travels: it settles into its card
        gsap.killTweensOf([s, this.fx[i]]);
        this.fx[i].scale = 1;
        this.startTrack(i, { duration: MOVE, lift: 0.08, ease: easeMove, to: landing });
        this.revealCard(this.cardEls[i], 0.65);
        end = Math.max(end, 1.8);
        return;
      }
      // the others appear in place, in their own card, with a soft dissolve
      gsap.killTweensOf([s, this.fx[i]]);
      const tr = this.tracks[i];
      tr.tween?.kill();
      tr.t = 1;
      if (!onCard.has(i)) {
        s.opacity = 0;
        this.fx[i].scale = 0.9;
      }
      const delay = 0.4 + order[i] * 0.08;
      gsap.to(s, { opacity: 1, duration: 1, delay, ease: 'power2.out' });
      gsap.to(this.fx[i], { scale: 1, duration: 1.3, delay, ease: 'power3.out' });
      this.revealCard(this.cardEls[i], delay - 0.1);
      end = Math.max(end, delay + 1.3);
    });

    gsap.delayedCall(end, () => {
      if (token !== this.modeToken) return;
      this.root.classList.remove('is-transitioning');
    });
  }

  /** Grid → Gallery: the chosen specimen scales to the stage; the others dissolve away in their cards. */
  toGallery(index?: number): void {
    if (this.mode === 'gallery') {
      if (index !== undefined) this.select(index);
      return;
    }
    const token = ++this.modeToken;
    if (index !== undefined && index !== this.selected) {
      this.selected = index;
      this.syncDots();
    }
    this.textToken++;
    this.setGalleryText(this.selected);
    this.codeFlap.set(MATERIALS[this.selected].code, true);
    this.mode = 'gallery';
    this.setTint(this.selected);
    this.syncSwitch();
    this.syncUrl();
    this.sound.ui('switch');
    this.root.classList.add('is-transitioning');
    this.root.dataset.mode = 'gallery';
    this.applyInteractivity();
    this.measureGallery();
    this.nav.select(this.selected, true);

    // where the stage will be once the page is back at the top
    const st = this.stageEl.getBoundingClientRect();
    // the site opens on the grid: size the transition buffers now that the stage exists
    this.morph?.prepare(Math.min(st.width, st.height) / 2);
    const stage: ScreenCircle = {
      x: st.left + st.width / 2,
      y: st.top + st.height / 2 + window.scrollY,
      r: Math.min(st.width, st.height) / 2,
      z: 0,
    };
    if (window.scrollY > 1) {
      if (this.engine?.lenis) this.engine.lenis.scrollTo(0, { duration: MOVE, easing: easeMove });
      else window.scrollTo({ top: 0, behavior: 'auto' });
    }

    const order = this.rankFrom(this.selected);
    this.cardEls.forEach((c, i) => this.collapseCard(c, false, order[i] * 0.04));

    this.specimens.forEach((s, i) => {
      gsap.killTweensOf([s, this.fx[i]]);
      if (i === this.selected) {
        this.fading.delete(i);
        s.opacity = 1;
        this.fx[i].scale = 1;
        // straight line to where the stage will be, in step with the page scroll
        this.startTrack(i, { duration: MOVE, lift: 0.08, ease: easeMove, to: stage });
        return;
      }
      // stays on its card (anchor = card while fading) and dissolves away there
      this.fading.add(i);
      const tr = this.tracks[i];
      tr.tween?.kill();
      tr.t = 1;
      const delay = order[i] * 0.025;
      gsap.to(this.fx[i], { scale: 0.94, duration: 0.45, delay, ease: 'power2.out' });
      gsap.to(s, {
        opacity: 0,
        duration: 0.4,
        delay,
        ease: 'power2.out',
        onComplete: () => {
          if (!this.fading.delete(i)) return;
          this.collapseToSlot(i);
        },
      });
    });

    gsap.set(this.galleryLines(), { yPercent: 110 });
    gsap.fromTo(this.galleryLines(), { yPercent: 110 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, delay: 0.7 });
    gsap.fromTo(this.navEl, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.7, delay: 0.75, overwrite: true });
    if (this.slider) gsap.fromTo(this.slider.visibility, { value: 0 }, { value: 1, duration: 0.7, delay: 0.8, overwrite: true });
    gsap.delayedCall(1.15, () => token === this.modeToken && this.scan(this.selected));

    gsap.delayedCall(1.5, () => {
      if (token !== this.modeToken) return;
      this.root.classList.remove('is-transitioning');
      this.cardEls.forEach((c) => this.resetCard(c));
      this.measureGallery();
    });
  }

  /**
   * Gallery: change the specimen on the stage. With WebGL the specimen on the
   * stage transmutes into the next one across a moving front; while that runs,
   * only the latest request is kept and played afterwards.
   */
  select(i: number): void {
    if (this.mode !== 'gallery') return this.toGallery(i);
    if (this.inspecting) return;
    if (this.morph?.running) {
      this.pending = i === this.selected ? null : i;
      return;
    }
    if (i === this.selected) return;
    if (this.morph?.supported) this.morphTo(i);
    else this.selectSpatial(i);
  }

  private async morphTo(i: number): Promise<void> {
    const prev = this.selected;
    this.selected = i;
    this.hold.add(prev);
    this.tracks[i].tween?.kill();
    this.tracks[i].t = 1;
    this.syncDots();
    this.syncUrl();
    this.sound.ui('select');
    this.swapGalleryText(i);
    this.nav.select(i);
    this.setTint(i);

    // the new material comes in from the side the slider moves to (as its droplet does)
    const done = this.morph!.run(this.specimens[prev], this.specimens[i], {
      stage: () => this.anchors[i],
      dir: i > prev ? 1 : -1,
    });
    this.applyInteractivity();
    await done;

    if (this.hold.has(prev)) {
      this.hold.delete(prev);
      this.collapseToSlot(prev);
    }
    this.applyInteractivity();
    const next = this.pending;
    this.pending = null;
    if (this.mode === 'gallery' && next !== null && next !== this.selected) this.select(next);
  }

  /** Put a specimen back in its slider slot (collapsed, so invisible) and make it opaque again. */
  private collapseToSlot(i: number): void {
    const d = this.dotEls[i].getBoundingClientRect();
    const s = this.specimens[i];
    this.tracks[i].tween?.kill();
    this.tracks[i].t = 1;
    Object.assign(s.screen, { x: d.left + d.width / 2, y: d.top + d.height / 2, r: 0, z: 0 });
    s.group.visible = false;
    gsap.killTweensOf([s, this.fx[i]]);
    this.fx[i].scale = 1;
    s.opacity = 1;
  }

  /** Fallback without GPU support: the two specimens trade places through depth. */
  private selectSpatial(i: number): void {
    const prev = this.selected;
    this.selected = i;
    this.syncDots();
    this.syncUrl();
    this.applyInteractivity();
    this.sound.ui('select');
    this.startTrack(i, { duration: 1.15, lift: 0.55, arc: 0.16, ease: 'power3.inOut' });
    this.startTrack(prev, { duration: 1.0, lift: -0.4, arc: -0.12, ease: 'power3.inOut' });
    this.swapGalleryText(i);
    this.nav.select(i);
  }

  private step(dir: number): void {
    const n = MATERIALS.length;
    this.select((this.selected + dir + n) % n);
  }

  // ── Inspect ────────────────────────────────────────────────────────────

  /** Close up: centred in the viewport, larger than the stage. */
  private inspectAnchor(a: ScreenCircle): void {
    const e = this.engine!;
    a.x = e.width / 2;
    a.y = e.height * 0.5;
    a.r = Math.min(e.width, e.height) * (e.width <= 760 ? 0.33 : 0.36);
    a.z = 0;
  }

  /** The stage specimen comes forward; the gallery steps back; the sheet pins itself on. */
  enterInspect(): void {
    if (this.mode !== 'gallery' || this.inspecting || this.morph?.running || !this.engine) return;
    this.inspecting = true;
    const s = this.specimens[this.selected];
    s.spinMode = true;
    this.root.classList.add('is-inspecting');
    this.applyInteractivity();
    this.startTrack(this.selected, { duration: 1.1, lift: 0.12, ease: easeMove });
    gsap.to(qsa('.g-name, .g-desc', this.gallery), { autoAlpha: 0, duration: 0.45, ease: 'power2.out', overwrite: true });
    gsap.to(this.navEl, { autoAlpha: 0, y: 8, duration: 0.45, ease: 'power2.out', overwrite: true });
    if (this.slider) gsap.to(this.slider.visibility, { value: 0, duration: 0.35, overwrite: true });
    if (this.atmosphere) gsap.to(this.atmosphere.inspect, { value: 1, duration: 1.1, ease: 'power2.inOut', overwrite: true });
    this.sheet?.show(MATERIALS[this.selected]);
    this.sound.ui('switch');
  }

  /** Back to the stage, upright. `instant` when leaving the gallery altogether. */
  exitInspect(instant = false): void {
    if (!this.inspecting) return;
    this.inspecting = false;
    const s = this.specimens[this.selected];
    s.spinMode = false;
    s.resetSpin(instant ? 0 : 0.9);
    this.root.classList.remove('is-inspecting');
    this.applyInteractivity();
    this.sheet?.hide();
    if (this.atmosphere) gsap.to(this.atmosphere.inspect, { value: 0, duration: instant ? 0 : 0.9, ease: 'power2.inOut', overwrite: true });
    if (instant) {
      gsap.set(qsa('.g-name, .g-desc', this.gallery), { autoAlpha: 1 });
      return;
    }
    this.startTrack(this.selected, { duration: 1.0, lift: -0.06, ease: easeMove });
    gsap.to(qsa('.g-name, .g-desc', this.gallery), { autoAlpha: 1, duration: 0.6, delay: 0.35, ease: 'power2.out', overwrite: true });
    gsap.to(this.navEl, { autoAlpha: 1, y: 0, duration: 0.6, delay: 0.4, ease: 'power2.out', overwrite: true });
    if (this.slider) gsap.to(this.slider.visibility, { value: 1, duration: 0.6, delay: 0.45, overwrite: true });
    this.sound.ui('switch');
  }

  /** A scan line sweeps the specimen and leaves its x-ray layer behind it. */
  scan(i: number): void {
    const s = this.specimens[i];
    if (!s) return;
    const v = s.u.uScan.value;
    gsap.killTweensOf(v);
    gsap.set(v, { x: 1.35, y: 0 });
    const tl = gsap.timeline();
    tl.to(v, { y: 1, duration: 0.25, ease: 'power1.out' }, 0);
    tl.to(v, { x: -1.35, duration: this.engine?.reducedMotion ? 0.6 : 2.1, ease: 'power1.inOut' }, 0);
    tl.to(v, { y: 0, duration: 0.6, ease: 'power2.in' }, '-=0.45');
  }

  // ── Cards ──────────────────────────────────────────────────────────────

  private cardLines(card: HTMLElement): HTMLElement[] {
    return qsa('.ln > span', card);
  }

  /** Card background fades in under the landed specimen; labels rise in after it. */
  private revealCard(card: HTMLElement, delay: number): void {
    const bg = qs('.card-bg', card);
    const lines = this.cardLines(card);
    gsap.killTweensOf([bg, ...lines]);
    gsap.fromTo(bg, { opacity: 0 }, { opacity: 1, duration: 0.9, delay, ease: 'power2.out' });
    gsap.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 0.8, delay: delay + 0.2, ease: 'power4.out', stagger: 0.035 });
  }

  /** Hide a card (instantly to prepare, or animated on exit). */
  private collapseCard(card: HTMLElement, instant: boolean, delay = 0): void {
    const bg = qs('.card-bg', card);
    const lines = this.cardLines(card);
    gsap.killTweensOf([bg, ...lines]);
    if (instant) {
      gsap.set(bg, { opacity: 0 });
      gsap.set(lines, { yPercent: 110 });
      return;
    }
    gsap.to(lines, { yPercent: -110, duration: 0.35, ease: 'power2.in', stagger: 0.02, delay });
    gsap.to(bg, { opacity: 0, duration: 0.6, ease: 'power2.inOut', delay: delay + 0.1 });
  }

  private resetCard(card: HTMLElement): void {
    const bg = qs('.card-bg', card);
    const lines = this.cardLines(card);
    gsap.killTweensOf([bg, ...lines]);
    gsap.set(bg, { clearProps: 'opacity' });
    gsap.set(lines, { yPercent: 0 });
  }

  /** Scroll so card `i` is centred; returns the scroll position the page is heading to. */
  private scrollToCard(i: number, duration: number): number {
    const lenis = this.engine?.lenis;
    lenis?.resize();
    const r = this.cardEls[i].getBoundingClientRect();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.max(0, Math.min(max, window.scrollY + r.top - (window.innerHeight - r.height) / 2));
    if (target < 4 && window.scrollY < 4) return window.scrollY;
    if (lenis) lenis.scrollTo(target, { duration, easing: easeMove });
    else window.scrollTo({ top: target, behavior: 'auto' });
    return target;
  }
}
