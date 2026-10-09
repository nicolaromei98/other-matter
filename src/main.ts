import '@fontsource-variable/manrope';
import './styles/fonts.css';
import './styles/base.css';

import gsap from 'gsap';
import { Engine } from './core/Engine';
import { Sound } from './core/Sound';
import { Diagnostics } from './core/Diagnostics';
import type { Tier } from './core/types';
import { MATERIALS } from './data/materials';
import { SPECIMENS } from './specimens/registry';
import type { Specimen } from './specimens/Specimen';
import { Exhibition } from './exhibition/Exhibition';
import { runLoader } from './ui/Loader';

function detectTier(): Tier {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return coarse || cores <= 4 || mem <= 4 ? 'low' : 'high';
}

async function boot() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  history.scrollRestoration = 'manual';
  // Reduced motion: every choreography plays, just much faster.
  if (reducedMotion) gsap.globalTimeline.timeScale(3);
  const root = document.querySelector('.om') as HTMLElement;
  const canvas = document.querySelector('canvas.gl') as HTMLCanvasElement;
  const engine = Engine.create(canvas, { tier: detectTier(), reducedMotion });
  const sound = new Sound();

  const specimens: Specimen[] = [];
  if (engine) {
    const ctx = { tier: engine.tier, reducedMotion, globals: engine.globals };
    for (const m of MATERIALS) {
      const s = new SPECIMENS[m.slug](m, ctx);
      s.init();
      engine.add(s);
      specimens.push(s);
    }
    document.documentElement.classList.add('has-webgl');
  } else {
    document.documentElement.classList.add('no-webgl');
  }

  const exhibition = new Exhibition(root, engine, specimens, sound);
  if (engine) {
    const debug = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
    if (debug) new Diagnostics(engine, document.querySelector('.hud') as HTMLElement);
    if (import.meta.env.DEV) Object.assign(window, { __om: { engine, exhibition, specimens, sound } });
  }

  const tasks: Promise<unknown>[] = [document.fonts?.ready ?? Promise.resolve()];
  if (engine) tasks.push(engine.prepare());
  await runLoader(document.querySelector('.loader') as HTMLElement, tasks);
  engine?.start();
  exhibition.intro();
}

boot();
