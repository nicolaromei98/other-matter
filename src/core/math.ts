/** Frame-rate independent exponential smoothing toward a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** CSS `cubic-bezier(x1, y1, x2, y2)` as an easing function (Newton steps, bisection fallback). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sampleX(u) - x;
      if (Math.abs(e) < 1e-6) return u;
      const d = slopeX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
      if (sampleX(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

/** Grid ↔ gallery move of the selected specimen (and the page scroll that goes with it). */
export const easeMove = cubicBezier(0.7, 0, 0.3, 1);

/**
 * Semi-implicit spring integrator. `k` is stiffness, `c` damping. `step`
 * advances the spring toward a target and returns its new value; kick it by
 * adding to `velocity` for impulses (taps, focus pulls).
 */
export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0, public k = 60, public c = 9) {
    this.value = value;
  }
  step(target: number, dt: number): number {
    // sub-step for stability at low frame rates
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (target - this.value) * this.k - this.velocity * this.c;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}
