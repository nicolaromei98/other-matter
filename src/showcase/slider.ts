import '@fontsource-variable/manrope';
import '../styles/fonts.css';
import '../styles/base.css';

import { Engine } from '../core/Engine';
import { MATERIALS } from '../data/materials';
import { SPECIMENS } from '../specimens/registry';
import type { Specimen } from '../specimens/Specimen';
import { LiquidNav } from '../exhibition/LiquidNav';
import { GooeySlider } from '../exhibition/GooeySlider';
import { bindSliderDrag } from '../exhibition/SliderDrag';
import { LiquidCursor } from '../ui/LiquidCursor';

/**
 * Showcase: the gallery's liquid slider on its own, large, for screen
 * recordings. Same LiquidNav, GooeySlider (live thumbnails of every specimen)
 * and drag as the site; beads and arrows click as usual, ← → step through.
 */
async function boot() {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const zoom = Number(params.get('zoom'));
  if (zoom > 0) root.style.setProperty('--zoom', String(zoom));
  const bg = params.get('bg');
  if (bg && /^[0-9a-f]{3,8}$/i.test(bg)) root.style.setProperty('--bg', `#${bg}`);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.querySelector('canvas.gl') as HTMLCanvasElement;
  const engine = Engine.create(canvas, { tier: 'high', reducedMotion });
  if (!engine) {
    document.body.textContent = 'WebGL is needed for the slider.';
    return;
  }
  root.classList.add('has-webgl');

  // the specimens live only in the portholes: kept animating, never drawn on the page itself
  const ctx = { tier: engine.tier, reducedMotion, globals: engine.globals };
  const specimens: Specimen[] = MATERIALS.map((m) => {
    const s = new SPECIMENS[m.slug](m, ctx);
    s.init();
    s.keepAlive = true;
    s.interactive = false;
    engine.add(s);
    return s;
  });

  const pill = document.querySelector('.g-pill') as HTMLElement;
  const dotsEl = pill.querySelector('.g-dots') as HTMLElement;
  const dots = MATERIALS.map((m) => {
    const d = document.createElement('button');
    d.className = 'g-dot';
    d.type = 'button';
    d.setAttribute('aria-label', `Show ${m.name}`);
    dotsEl.appendChild(d);
    return d;
  });
  const next = pill.querySelector('.g-next') as HTMLButtonElement;
  const prev = pill.querySelector('.g-prev') as HTMLButtonElement;
  const nav = new LiquidNav(pill, dots, next, prev, reducedMotion);
  const slider = new GooeySlider(engine, specimens, nav);
  slider.visibility.value = 1;
  nav.select(0, true);

  const n = MATERIALS.length;
  const go = (i: number) => {
    nav.select(i);
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
  };
  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
  next.addEventListener('click', () => go((nav.active + 1) % n));
  prev.addEventListener('click', () => go((nav.active - 1 + n) % n));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go((nav.active + 1) % n);
    else if (e.key === 'ArrowLeft') go((nav.active - 1 + n) % n);
  });
  bindSliderDrag(pill, nav, n, { live: () => true, preview: () => {}, choose: go, settle: () => {} });

  if (params.get('cursor') !== '0') new LiquidCursor(reducedMotion);

  // thumbnails sized to the active porthole (see gooey.frag: RING, THUMB), as on the site
  const measure = () => {
    nav.measure();
    const ra = (pill.offsetHeight || 51) / 2;
    slider.setThumbSize(ra * (1 - 0.13) * 0.8 * 1.15 * 2);
  };
  measure();
  window.addEventListener('resize', measure);
  document.fonts?.ready.then(measure);

  if (import.meta.env.DEV) Object.assign(window, { __showcase: { engine, nav, slider } });
  engine.onLayout = () => nav.layout();
  await engine.prepare();
  engine.start();
}

boot();
