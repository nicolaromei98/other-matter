/**
 * Viewport sizes that stay put while mobile browsers show and hide their
 * toolbars during a scroll. Those changes fire `resize` and move innerHeight on
 * every change of scroll direction. Re-laying out, resizing the canvas or
 * reallocating render targets there makes the scroll stutter, so:
 *
 * - layout that must fit the screen uses the small viewport (toolbars shown),
 * - layers that must cover it use the large one (toolbars hidden),
 * - and onViewportChange() only fires when one of those, or the width, changes:
 *   a rotation or a real window resize, never a toolbar.
 *
 * Both heights are read from fixed probes sized in svh / lvh (100vh where those
 * units are missing, which mobile browsers resolve to the large viewport).
 */

let small: HTMLElement | null = null;
let large: HTMLElement | null = null;

function probe(unit: 'svh' | 'lvh'): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:0;top:0;width:0;height:100vh;height:100${unit};visibility:hidden;pointer-events:none`;
  document.body.appendChild(el);
  return el;
}

/** Height with the browser toolbars shown, px: what a full-screen layout must fit. */
export function smallHeight(): number {
  small ??= probe('svh');
  return small.offsetHeight || window.innerHeight;
}

/** Height with the browser toolbars hidden, px: what a fixed full-screen layer must cover. */
export function largeHeight(): number {
  large ??= probe('lvh');
  return Math.max(large.offsetHeight, window.innerHeight);
}

/** Calls `fn` (once per frame at most) when the width or either stable height changes. */
export function onViewportChange(fn: () => void): void {
  let key = '';
  let queued = false;
  const check = () => {
    queued = false;
    const next = `${window.innerWidth}x${smallHeight()}x${largeHeight()}`;
    if (next === key) return;
    key = next;
    fn();
  };
  key = `${window.innerWidth}x${smallHeight()}x${largeHeight()}`;
  window.addEventListener('resize', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(check);
  });
}
