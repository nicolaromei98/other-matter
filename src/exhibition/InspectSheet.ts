import * as THREE from 'three';
import gsap from 'gsap';
import { Flap } from '../ui/Flap';
import type { Engine } from '../core/Engine';
import type { MaterialEntry } from '../data/materials';
import type { Specimen } from '../specimens/Specimen';

const SVG = 'http://www.w3.org/2000/svg';
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

interface Pin {
  at: THREE.Vector3;
  line: SVGPolylineElement;
  box: HTMLElement;
  label: Flap;
  value: Flap;
  /** 0 → 1: how much of the leader line is drawn. */
  draw: { v: number };
}

/**
 * The specimen sheet shown while inspecting: three readings pinned to points
 * on the surface. Each pin projects its body-space point every frame, so the
 * leader lines and labels ride along as the specimen turns; a pin whose point
 * turns away fades out. Lines draw in from the surface, labels flap in.
 */
export class InspectSheet {
  private readonly el: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly title: Flap;
  private readonly hint: Flap;
  private pins: Pin[] = [];
  private shown = false;

  constructor(
    private readonly engine: Engine,
    private readonly reducedMotion: boolean,
    private readonly onLand?: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'om-sheet';
    this.el.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS(SVG, 'svg');
    this.el.appendChild(this.svg);
    const head = document.createElement('div');
    head.className = 'om-sheet-head';
    const title = document.createElement('span');
    title.className = 'om-label';
    const hint = document.createElement('span');
    hint.className = 'om-label om-sheet-hint';
    head.append(title, hint);
    this.el.appendChild(head);
    document.body.appendChild(this.el);
    const opts = { reducedMotion, onLand };
    this.title = new Flap(title, '', { ...opts, cells: 20 });
    this.hint = new Flap(hint, '', { ...opts, cells: 24, stagger: 0.02 });
    gsap.set(this.el, { autoAlpha: 0 });
  }

  show(entry: MaterialEntry): void {
    this.clear();
    this.shown = true;
    gsap.to(this.el, { autoAlpha: 1, duration: 0.4, overwrite: true });
    this.title.set(`INSPECT · ${entry.code}`.padEnd(20, '\u00a0'));
    this.hint.set('DRAG TO TURN · ESC CLOSE'.padEnd(24, '\u00a0'));
    entry.sheet.forEach((row, i) => {
      const line = document.createElementNS(SVG, 'polyline');
      this.svg.appendChild(line);
      const box = document.createElement('div');
      box.className = 'om-pin';
      const label = document.createElement('span');
      label.className = 'om-label om-pin-label';
      const value = document.createElement('span');
      value.className = 'om-label om-pin-value';
      box.append(label, value);
      this.el.appendChild(box);
      const len = Math.max(row.label.length, row.value.length);
      // readings on the left hug their line: pad them at the start
      const fit = (t: string) => (row.at[0] >= 0 ? t.padEnd(len, '\u00a0') : t.padStart(len, '\u00a0'));
      const pin: Pin = {
        at: new THREE.Vector3(...row.at).normalize(),
        line,
        box,
        label: new Flap(label, ''.padEnd(len, '\u00a0'), { cells: len, stagger: 0.025, reducedMotion: this.reducedMotion }),
        value: new Flap(value, ''.padEnd(len, '\u00a0'), {
          cells: len,
          stagger: 0.03,
          reducedMotion: this.reducedMotion,
          onLand: this.onLand,
        }),
        draw: { v: 0 },
      };
      this.pins.push(pin);
      // the line grows out of the surface, then the reading flaps in at its end
      const delay = 0.55 + i * 0.18;
      gsap.to(pin.draw, { v: 1, duration: 0.7, delay, ease: 'power3.inOut' });
      gsap.delayedCall(delay + 0.45, () => {
        pin.label.set(fit(row.label));
        pin.value.set(fit(row.value));
      });
    });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const p of this.pins) gsap.to(p.draw, { v: 0, duration: 0.35, ease: 'power2.in', overwrite: true });
    gsap.to(this.el, { autoAlpha: 0, duration: 0.4, delay: 0.15, overwrite: true, onComplete: () => this.clear() });
  }

  private clear(): void {
    for (const p of this.pins) {
      gsap.killTweensOf(p.draw);
      p.line.remove();
      p.box.remove();
    }
    this.pins = [];
  }

  /** Per frame while visible: project the pins and lay out lines and labels. */
  update(s: Specimen): void {
    if (!this.pins.length) return;
    const e = this.engine;
    const W = e.width;
    const H = e.height;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const sc = s.screen;
    const R = sc.r * s.fit;
    s.body.updateMatrixWorld();
    _c.setFromMatrixPosition(s.body.matrixWorld);
    for (const pin of this.pins) {
      // a point just off the surface, in world space, and how much it faces the viewer
      _p.copy(pin.at).multiplyScalar(0.92);
      s.body.localToWorld(_p);
      const facing = (_p.z - _c.z) / Math.max(R * 0.92, 1);
      const alpha = THREE.MathUtils.smoothstep(facing, 0.05, 0.35);
      _p.project(e.camera);
      const ax = ((_p.x + 1) / 2) * W;
      const ay = ((1 - _p.y) / 2) * H;
      let dx = ax - sc.x;
      let dy = ay - sc.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const ex = sc.x + dx * R * 1.16;
      const ey = sc.y + dy * R * 1.16;
      const side = dx >= 0 ? 1 : -1;
      const lx = ex + side * 34;
      // partial polyline: anchor → elbow → end, drawn up to `draw`
      const segA = Math.hypot(ex - ax, ey - ay);
      const total = segA + 34;
      let left = pin.draw.v * total;
      const pts = [`${ax.toFixed(1)},${ay.toFixed(1)}`];
      const k1 = Math.min(1, left / Math.max(segA, 1e-3));
      pts.push(`${(ax + (ex - ax) * k1).toFixed(1)},${(ay + (ey - ay) * k1).toFixed(1)}`);
      left -= segA;
      if (left > 0) pts.push(`${(ex + side * Math.min(34, left)).toFixed(1)},${ey.toFixed(1)}`);
      pin.line.setAttribute('points', pts.join(' '));
      pin.line.style.opacity = alpha.toFixed(3);
      const bw = pin.box.offsetWidth;
      const bx = Math.min(W - bw - 8, Math.max(8, side > 0 ? lx + 8 : lx - 8 - bw));
      pin.box.style.transform = `translate(${bx.toFixed(1)}px, ${(ey - pin.box.offsetHeight / 2).toFixed(1)}px)`;
      pin.box.style.opacity = alpha.toFixed(3);
    }
  }
}
