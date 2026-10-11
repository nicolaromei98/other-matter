import * as THREE from 'three';
import { Specimen, chunks, glsl } from '../Specimen';
import grainVert from './grain.vert?raw';
import grainFrag from './grain.frag?raw';
import type { Frame } from '../../core/types';
import { Spring, clamp } from '../../core/math';

// ── Grain placement (CPU, once) ─────────────────────────────────────────

function hash(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth 3D value noise, about −1…1. */
function vnoise(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = l(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = l(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = l(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = l(c(0, 1, 1), c(1, 1, 1), u);
  return l(l(x00, x10, v), l(x01, x11, v), w) * 2 - 1;
}

/** A crumpled sheet of grains around the centre. */
interface Sheet {
  count: number;
  /** Mean radius, and how far its folds push in and out (fraction of it). */
  radius: number;
  fold: number;
  /** Thickness of the sheet (it is several grains deep). */
  thick: number;
  /** Below this the sheet is torn open, so the layers beneath show (−1…1). */
  holes: number;
  /** Above this its grains are turquoise (−1…1); > 1: never. */
  glow: number;
  seed: number;
}

/** Kinds, in aInfo.y. */
const GRAIN = 0;
const GLOW = 1;
const DUST = 2;

/** Radius of a sheet along unit direction d: broad folds plus sharp creases. */
function sheetRadius(s: Sheet, x: number, y: number, z: number): number {
  const broad = vnoise(x * 1.1, y * 1.1, z * 1.1, s.seed) * 0.75 + vnoise(x * 2.2, y * 2.2, z * 2.2, s.seed + 1) * 0.25;
  const crease = 0.45 - Math.abs(vnoise(x * 2.4, y * 2.4, z * 2.4, s.seed + 3));
  return s.radius * (1 + s.fold * (broad + crease * 1.1));
}

/**
 * Tens of thousands of grains: a few crumpled, torn sheets nested inside each
 * other, turquoise clusters glowing in the core, and a little loose dust. Each
 * sheet grain carries the sheet's normal (aNormal), so the folds are lit like
 * a surface, and its concavity (aInfo.x, "cavity"), so the valleys between
 * folds sit in shadow. Shuffled, so any prefix of the buffer is an even sample
 * of the whole (the LOD draws a prefix).
 */
function grainCloud(scale: number): THREE.BufferGeometry {
  const n = (v: number) => Math.round(v * scale);
  const sheets: Sheet[] = [
    { count: n(34000), radius: 0.84, fold: 0.27, thick: 0.045, holes: -0.3, glow: 2, seed: 1 },
    { count: n(19000), radius: 0.66, fold: 0.28, thick: 0.05, holes: -0.42, glow: 0.12, seed: 2 },
    { count: n(10000), radius: 0.48, fold: 0.3, thick: 0.06, holes: -0.7, glow: -0.1, seed: 3 },
  ];
  const coreCount = n(9000);
  const dustCount = n(900);
  const total = sheets.reduce((a, x) => a + x.count, 0) + coreCount + dustCount;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const seed = new Float32Array(total * 4);
  const info = new Float32Array(total * 2);
  let k = 0;
  const put = (p: THREE.Vector3, nrm: THREE.Vector3, cavity: number, kind: number) => {
    pos.set([p.x, p.y, p.z], k * 3);
    nor.set([nrm.x, nrm.y, nrm.z], k * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], k * 4);
    info.set([cavity, kind], k * 2);
    k++;
  };

  const d = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const q = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const at = (s: Sheet, v: THREE.Vector3, out: THREE.Vector3) => out.copy(v).normalize().multiplyScalar(sheetRadius(s, v.x, v.y, v.z));
  const E = 0.035;
  for (const s of sheets) {
    for (let i = 0; i < s.count; i++) {
      for (let tries = 0; tries < 20; tries++) {
        d.randomDirection();
        if (vnoise(d.x * 2.0, d.y * 2.0, d.z * 2.0, s.seed + 5) >= s.holes) break;
      }
      // the sheet's normal and concavity, by finite differences on the sphere
      t1.set(Math.abs(d.y) < 0.95 ? 0 : 1, Math.abs(d.y) < 0.95 ? 1 : 0, 0).cross(d).normalize();
      t2.copy(d).cross(t1);
      at(s, d, p0);
      at(s, q.copy(d).addScaledVector(t1, E), p1);
      at(s, q.copy(d).addScaledVector(t2, E), p2);
      nrm.copy(p1.sub(p0)).cross(p2.sub(p0)).normalize();
      if (nrm.dot(d) < 0) nrm.negate();
      const r = p0.length();
      const ring =
        (at(s, q.copy(d).addScaledVector(t1, 0.12), p1).length() +
          at(s, q.copy(d).addScaledVector(t1, -0.12), p1).length() +
          at(s, q.copy(d).addScaledVector(t2, 0.12), p1).length() +
          at(s, q.copy(d).addScaledVector(t2, -0.12), p1).length()) /
        4;
      const cavity = THREE.MathUtils.clamp((ring - r) * 9 + 0.15, 0, 1);
      p0.addScaledVector(nrm, (Math.random() - 0.5) * s.thick);
      const glows = vnoise(d.x * 1.8, d.y * 1.8, d.z * 1.8, s.seed + 11) > s.glow;
      put(p0, nrm, cavity, glows ? GLOW : GRAIN);
    }
  }

  // turquoise clusters in the core, seen through the tears
  const centres = Array.from({ length: 7 }, () => new THREE.Vector3().randomDirection().multiplyScalar(0.18 + Math.random() * 0.26));
  const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, Math.random()))) * Math.cos(Math.PI * 2 * Math.random());
  for (let i = 0; i < coreCount; i++) {
    const c = centres[i % centres.length];
    const sd = 0.07 + (i % 3) * 0.022;
    q.set(g() * sd, g() * sd, g() * sd);
    nrm.copy(q).normalize();
    put(q.add(c), nrm, 0.3 + Math.random() * 0.3, GLOW);
  }

  // a little loose dust just off the surface
  for (let i = 0; i < dustCount; i++) {
    d.randomDirection();
    q.copy(d).multiplyScalar(0.98 + Math.pow(Math.random(), 2) * 0.22);
    put(q, d, 0.2, DUST);
  }

  // shuffle (Fisher–Yates on every attribute)
  const swap = (a: Float32Array, w: number, i: number, j: number) => {
    for (let c = 0; c < w; c++) [a[i * w + c], a[j * w + c]] = [a[j * w + c], a[i * w + c]];
  };
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    swap(pos, 3, i, j);
    swap(nor, 3, i, j);
    swap(seed, 4, i, j);
    swap(info, 2, i, j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  return geo;
}

/**
 * OM—004 DUST SILK
 * A mass of grains folded like silk: white powder on the crests, slate in the
 * folds, turquoise light glowing through the tears. Each grain is drawn as a
 * small lit bead; grains away from the focal plane open into soft bokeh
 * discs, like a macro photograph. The shape is held by placement, not
 * geometry: disperse it and it finds its way back.
 *
 * Two draws of one buffer: grains in focus are opaque (depth-written, edges
 * by alpha to coverage), so the folds occlude each other; out-of-focus grains
 * are blended over them.
 */
export default class DustSilk extends Specimen {
  private readonly disperse = new Spring(0, 9, 2.8);
  private readonly uDisperse = { value: 0 };
  private readonly uPointScale = { value: 1 };
  /** Grain size compensation when the LOD draws only part of the buffer. */
  private readonly uDensity = { value: 1 };
  private geo!: THREE.BufferGeometry;
  count = 0;

  init(): void {
    const hi = this.ctx.tier === 'high';
    this.geo = grainCloud(hi ? 1 : 0.38);
    this.count = this.geo.attributes.position.count;
    const extra = { uDisperse: this.uDisperse, uPointScale: this.uPointScale, uDensity: this.uDensity };
    const vert = glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, grainVert);

    const sharp = new THREE.Points(
      this.geo,
      this.material(vert, glsl('#define SHARP 1', chunks.common, grainFrag), extra, {
        depthWrite: true,
        alphaToCoverage: true,
      }),
    );
    sharp.renderOrder = 1;
    const soft = new THREE.Points(
      this.geo,
      this.material(vert, glsl('#define SHARP 0', chunks.common, grainFrag), extra, { depthWrite: false }),
    );
    soft.renderOrder = 2;
    this.body.add(sharp, soft);
    this.hitRadius = 0.95;
  }

  protected lod(px: number): void {
    // fewer, slightly larger grains when it is small on screen
    const f = px >= 180 ? 1 : px >= 70 ? 0.5 : 0.22;
    this.geo.setDrawRange(0, Math.round(this.count * f));
    this.uDensity.value = Math.sqrt(1 / f);
  }

  protected onCapture(sizePx: number | null): void {
    this.uPointScale.value = sizePx === null ? (this.screen.r / 150) * this.pixelRatio : sizePx / 120;
  }

  protected onTap(): void {
    this.disperse.velocity += 3.6;
  }

  protected step(f: Frame): void {
    // fast passes stir the grains a little even without a tap
    const stir = this.input.over ? clamp(this.input.speed * 0.02, 0, 0.12) : 0;
    this.uDisperse.value = Math.max(-0.08, this.disperse.step(stir, f.dt));
    this.uPointScale.value = (this.screen.r / 150) * this.pixelRatio;

    const m = f.motion;
    this.body.rotation.y = f.idle * 0.04 * m;
    this.body.rotation.x = Math.sin(f.idle * 0.08) * 0.2 * m;
  }
}
