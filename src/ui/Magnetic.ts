import gsap from 'gsap';

/**
 * Small controls lean toward a nearby pointer (a few px) and settle back when
 * it leaves. One shared listener for all of them; fine pointers only.
 */
export function magnetic(elements: HTMLElement[], reach = 70, pull = 0.22, max = 6): void {
  if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = elements.map((el) => ({
    el,
    x: gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' }),
    y: gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' }),
    near: false,
  }));
  window.addEventListener(
    'pointermove',
    (e) => {
      for (const it of items) {
        const r = it.el.getBoundingClientRect();
        if (!r.width) continue;
        // distance from the element's box, not its centre, so wide labels feel the same as small buttons
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const gap = Math.hypot(Math.max(0, Math.abs(dx) - r.width / 2), Math.max(0, Math.abs(dy) - r.height / 2));
        const near = gap < reach;
        if (!near && !it.near) continue;
        it.near = near;
        const f = near ? 1 - gap / reach : 0;
        it.x(Math.max(-max, Math.min(max, dx * pull * f)));
        it.y(Math.max(-max, Math.min(max, dy * pull * f)));
      }
    },
    { passive: true },
  );
}
