import type { LiquidNav } from './LiquidNav';
import { clamp } from '../core/math';

export interface SliderDragHooks {
  /** Whether a drag may choose right now (e.g. the gallery is showing and Inspect is closed). */
  live(): boolean;
  /** During a drag the liquid passed onto bead `i`: preview it. */
  preview(i: number): void;
  /** A drag ended on bead `i`: play that selection (LiquidNav already settles into it). */
  choose(i: number): void;
  /** A drag is over, with or without a choice: put any preview back in step. */
  settle(): void;
}

/**
 * Makes the liquid slider draggable. Past a few px of horizontal travel a press
 * on it becomes a scrub: the liquid follows the pointer live (LiquidNav.scrub),
 * `preview` hears about each bead it passes onto; on release it settles on the
 * nearest bead (a flick carries it one further, holding still before letting
 * go none) and `choose` plays the selection. A press that does not travel
 * stays a click on a bead or an arrow.
 *
 * Anything else that chooses meanwhile takes over (LiquidNav.isScrubbing goes
 * false), and a drag that is cut short (pointercancel when the browser takes a
 * touch over, focus loss, `live()` turning false) settles back without choosing.
 */
export function bindSliderDrag(pill: HTMLElement, nav: LiquidNav, n: number, hooks: SliderDragHooks): void {
  let drag: { id: number; x0: number; f0: number; spacing: number; on: boolean; near: number; f: number; v: number; t: number } | null = null;
  /** When the last drag ended (ms): the click that follows a drag is swallowed. */
  let ended = -1e9;

  // a drag that stops without choosing: the row settles back where it started
  const abort = () => {
    const d = drag;
    drag = null;
    if (!d?.on) return;
    ended = performance.now();
    try {
      pill.releasePointerCapture(d.id);
    } catch {
      /* not captured */
    }
    if (nav.isScrubbing) nav.endScrub(d.f0);
    hooks.settle();
  };

  pill.addEventListener('pointerdown', (e) => {
    // one drag at a time: a second finger (or the mouse during a touch drag) does not take it over
    if (drag || !hooks.live() || e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, f0: 0, spacing: 1, on: false, near: 0, f: 0, v: 0, t: e.timeStamp };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // the button came up somewhere we did not hear about (focus loss, a system gesture): release here
    if (e.pointerType === 'mouse' && e.buttons === 0) return end(e);
    // something else changed or chose meanwhile: the drag is over
    if (!hooks.live() || (drag.on && !nav.isScrubbing)) return abort();
    const dx = e.clientX - drag.x0;
    if (!drag.on) {
      // fingers wobble: a tap on a bead or an arrow must stay a tap
      if (Math.abs(dx) < (e.pointerType === 'touch' ? 12 : 6)) return;
      drag.on = true;
      // from the bead the row shows now (it runs ahead of the stage while a transition plays)
      drag.f0 = drag.f = drag.near = nav.active;
      drag.spacing = nav.spacing();
      drag.t = e.timeStamp;
      try {
        pill.setPointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      nav.beginScrub();
      // the speed is measured from here on (the travel before the threshold is not a sample)
      drag.f = drag.f0 + dx / drag.spacing;
    }
    const f = drag.f0 + dx / drag.spacing;
    // velocity, blended by time (not by event count) and never over less than a frame
    const dt = Math.max(0.008, (e.timeStamp - drag.t) / 1000);
    const k = 1 - Math.exp(-dt / 0.05);
    drag.v += ((f - drag.f) / dt - drag.v) * k;
    drag.f = f;
    drag.t = e.timeStamp;
    nav.scrub(f);
    const near = clamp(Math.round(f), 0, n - 1);
    if (near !== drag.near) {
      drag.near = near;
      hooks.preview(near);
    }
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      drag = null;
      return;
    }
    // no longer allowed to choose (the view changed, Inspect opened): settle back, choose nothing
    if (!hooks.live()) return abort();
    const d = drag;
    drag = null;
    ended = performance.now();
    if (!nav.isScrubbing) {
      // taken over by another selection while held: that choice stands
      hooks.settle();
      return;
    }
    // a flick carries it on by its momentum (at most one bead); held still before letting go, none
    const idle = e.timeStamp - d.t;
    const v = idle > 100 ? 0 : d.v * Math.exp(-idle / 90);
    const i = clamp(Math.round(d.f + clamp(v * 0.16, -1, 1)), 0, n - 1);
    nav.endScrub(i);
    hooks.choose(i);
    hooks.settle();
  };
  window.addEventListener('pointerup', end);
  // the browser took the touch over (to scroll): not a choice
  window.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.id) abort();
  });
  window.addEventListener('blur', abort);
  // the click a drag's release may produce (it follows the pointerup at once) is not a choice
  pill.addEventListener(
    'click',
    (e) => {
      if (performance.now() - ended < 120) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
