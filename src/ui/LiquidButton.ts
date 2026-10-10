/**
 * Liquid hover for a Button 038: a blob of the button's own colour lives in
 * its background layer, merged with the pill by an SVG goo filter
 * (#om-goo-button in index.html), and springs after the pointer. As the
 * pointer moves off-centre the pill swells toward it (the blob never goes far
 * enough to detach); leaving, the bulge follows for a beat and then snaps back
 * with a wobble. The label sits above, crisp.
 * Fine pointers only; off with reduced motion.
 */
export function liquidButton(button: HTMLElement): void {
  if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const blob = button.querySelector<HTMLElement>('.button-038__blob');
  if (!blob) return;

  /** How far past the outline the blob's centre may go, px: always less than its radius, so it never detaches (less above and below, the pill is short). */
  const REACH = 9;
  const REACH_Y = 5;
  const pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let hover = false;
  let running = false;
  let last = 0;

  const rest = () => {
    target.x = button.offsetWidth / 2;
    target.y = button.offsetHeight / 2;
  };
  const place = () => {
    const w = button.offsetWidth;
    const h = button.offsetHeight;
    // the further out of the pill, the thinner the liquid
    const out = Math.max(0, Math.max(Math.abs(pos.x - w / 2) - w / 2, Math.abs(pos.y - h / 2) - h / 2));
    const s = 1 - 0.18 * Math.min(1, out / REACH);
    blob.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) scale(${s.toFixed(3)})`;
  };

  // start (and, once the label's font has set the width, restart) in the middle, merged and invisible
  const centre = () => {
    rest();
    pos.x = target.x;
    pos.y = target.y;
    place();
  };
  centre();
  document.fonts?.ready.then(centre);

  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
    last = now;
    // a lively spring: a little overshoot reads as liquid
    const k = 190;
    const c = 13;
    vel.x += ((target.x - pos.x) * k - vel.x * c) * dt;
    vel.y += ((target.y - pos.y) * k - vel.y * c) * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    place();
    const settled = !hover && Math.hypot(target.x - pos.x, target.y - pos.y) < 0.2 && Math.hypot(vel.x, vel.y) < 0.2;
    if (settled) {
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

  const follow = (e: PointerEvent) => {
    const r = button.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    // pushed outward from the centre: still inside in the middle, bulging the pill toward the pointer as it moves off-centre
    const x = cx + (e.clientX - r.left - cx) * 1.45;
    const y = cy + (e.clientY - r.top - cy) * 1.6;
    target.x = Math.max(-REACH, Math.min(r.width + REACH, x));
    target.y = Math.max(-REACH_Y, Math.min(r.height + REACH_Y, y));
  };

  button.addEventListener('pointerenter', (e) => {
    hover = true;
    follow(e);
    wake();
  });
  button.addEventListener('pointermove', follow);
  button.addEventListener('pointerleave', (e) => {
    // the liquid reaches after the pointer for a beat, then lets go
    follow(e);
    hover = false;
    wake();
    window.setTimeout(() => {
      if (hover) return;
      rest();
      wake();
    }, 90);
  });
}
