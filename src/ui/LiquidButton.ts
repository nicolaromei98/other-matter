/**
 * Liquid attraction for a Button 038: when the pointer comes within a few px
 * of the pill (from outside), a small tip of the button's own liquid reaches
 * out of the nearest point of its edge toward the pointer, longer the closer
 * the pointer is, and draws back as it moves away. The tip is a blob merged
 * with the pill by an SVG goo filter (#om-goo-button in index.html), so it
 * always stays attached. Over the button itself nothing deforms (the Button 038
 * hover plays alone). Fine pointers only; off with reduced motion.
 */
export function liquidButton(button: HTMLElement): void {
  if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const blob = button.querySelector<HTMLElement>('.button-038__blob');
  if (!blob) return;

  /** The pull starts this far from the edge and is full at FULL px. */
  const ZONE = 14;
  const FULL = 2;
  /** Blob radius (see .button-038__blob), and how far past the edge its outer side goes at full pull. */
  const R = 7;
  const TIP = 8;

  const pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let running = false;
  let last = 0;

  const centre = () => {
    target.x = button.offsetWidth / 2;
    target.y = button.offsetHeight / 2;
  };
  const place = () => {
    blob.style.transform = `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px)`;
  };
  // start (and, once the label's font has set the width, restart) in the middle, merged and invisible
  const reset = () => {
    centre();
    pos.x = target.x;
    pos.y = target.y;
    vel.x = vel.y = 0;
    place();
  };
  reset();
  document.fonts?.ready.then(reset);

  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
    last = now;
    // soft spring: liquid, without bouncing around
    const k = 260;
    const c = 26;
    vel.x += ((target.x - pos.x) * k - vel.x * c) * dt;
    vel.y += ((target.y - pos.y) * k - vel.y * c) * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    place();
    if (Math.hypot(target.x - pos.x, target.y - pos.y) < 0.05 && Math.hypot(vel.x, vel.y) < 0.05) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
  };
  const wake = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  };

  window.addEventListener(
    'pointermove',
    (e) => {
      const r = button.getBoundingClientRect();
      if (!r.width || getComputedStyle(button).visibility === 'hidden') return;
      const w = r.width;
      const h = r.height;
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      // the pill is a capsule: nearest point of its centre line, then of its outline
      const hr = h / 2;
      const cx = Math.max(hr, Math.min(w - hr, px));
      const dx = px - cx;
      const dy = py - hr;
      const len = Math.hypot(dx, dy) || 1e-3;
      const gap = len - hr;
      const tx0 = target.x;
      const ty0 = target.y;
      if (gap <= 0 || gap > ZONE) {
        centre();
      } else {
        const t = Math.min(1, (ZONE - gap) / (ZONE - FULL));
        const pull = t * t * (3 - 2 * t);
        const nx = dx / len;
        const ny = dy / len;
        // the blob's centre, from just inside the edge (hidden) out until its tip just wraps the pointer
        const out = -R + TIP * pull;
        target.x = cx + nx * (hr + out);
        target.y = hr + ny * (hr + out);
      }
      if (target.x !== tx0 || target.y !== ty0) wake();
    },
    { passive: true },
  );
}
