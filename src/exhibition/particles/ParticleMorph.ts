import * as THREE from 'three';
import gsap from 'gsap';
import noise from '../../shaders/noise.glsl?raw';
import pointsVert from './points.vert?raw';
import pointsFrag from './points.frag?raw';
import { galleryParticleConfig, type GalleryParticleConfig } from './config';
import type { Engine } from '../../core/Engine';
import type { ScreenCircle } from '../../core/types';
import type { Specimen } from '../../specimens/Specimen';

/** Texel indices of an n×n grid (n a power of two) in Hilbert-curve order. */
function hilbertOrder(n: number): Uint32Array {
  const out = new Uint32Array(n * n);
  for (let d = 0; d < n * n; d++) {
    let t = d;
    let x = 0;
    let y = 0;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        const tmp = x;
        x = y;
        y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    out[d] = y * n + x;
  }
  return out;
}

const pow2Floor = (v: number) => Math.pow(2, Math.floor(Math.log2(Math.max(4, v))));
/** C2-smooth 0→1 between a and b. */
const smoother = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export interface MorphOptions {
  /** Live stage circle (CSS px), measured each frame. */
  stage: () => ScreenCircle;
}

const _clear = new THREE.Color();

/**
 * Particle transition between two gallery specimens: dissolve, then condense.
 *
 * 1. Capture: both specimens are rendered in isolation through the main
 *    camera, cropped to the stage, so particles carry the real colours and
 *    silhouettes on screen.
 * 2. Sampling: the opaque texels of each capture, walked in Hilbert-curve
 *    order, are spread evenly over the particles (uniform coverage whatever
 *    the shape), with a sub-texel jitter.
 * 3. Animation (vertex shader, deterministic): the outgoing particles lift
 *    off in place and fade, region by region; the incoming ones settle into
 *    place and appear. Particles never travel across the stage.
 * 4. Hand-off: the live outgoing specimen fades into its own particles at the
 *    start; at the end the incoming particles tile the silhouette and the
 *    live specimen fades in over them on a long, C2-smooth curve.
 *
 * Buffers, textures and programs are created once and reused.
 */
export class ParticleMorph {
  readonly config: GalleryParticleConfig;
  readonly supported: boolean;
  running = false;

  private readonly count: number;
  private readonly capSize: number;
  private rtA?: THREE.WebGLRenderTarget;
  private rtB?: THREE.WebGLRenderTarget;
  private corr?: THREE.DataTexture;
  private corrData?: Float32Array;
  private jitter?: Float32Array;
  private hilbert?: Uint32Array;
  private bufA?: Uint8Array;
  private bufB?: Uint8Array;
  private listA?: Int32Array;
  private listB?: Int32Array;
  private geo?: THREE.BufferGeometry;
  private pointsA?: THREE.Points;
  private pointsB?: THREE.Points;
  private matA?: THREE.ShaderMaterial;
  private matB?: THREE.ShaderMaterial;

  private readonly shared = {
    tCorr: { value: null as THREE.Texture | null },
    uP: { value: 0 },
    uStageR: { value: 200 },
    uCamDist: { value: 1000 },
    uSpread: { value: 1.1 },
    uLift: { value: 0.22 },
    uSwirl: { value: 0.7 },
    uSoft: { value: 1.2 },
    uDepth: { value: 24 },
    uStagger: { value: 0.18 },
    uOpacity: { value: 1 },
  };

  private readonly state = { p: 0 };
  private tween?: gsap.core.Tween;
  private a?: Specimen;
  private b?: Specimen;
  private opts?: MorphOptions;
  private capture = { x: 0, y: 0, half: 100 };
  /** Fraction of the capture square covered by each silhouette (for particle size). */
  private coverA = 0.5;
  private coverB = 0.5;
  private phase: 'idle' | 'capture' | 'readback' | 'play' = 'idle';
  private resolve?: () => void;
  private token = 0;

  constructor(
    private readonly engine: Engine,
    config: Partial<GalleryParticleConfig> = {},
  ) {
    this.config = { ...galleryParticleConfig, ...config };
    const low = this.config.adaptiveQuality && engine.tier === 'low';
    const side = pow2Floor(Math.sqrt(this.config.particleCount) / (low ? 2 : 1));
    this.count = side * side;
    this.capSize = Math.min(512, side * 2);
    this.supported = this.setup(side);
    if (this.supported) engine.beforeRender.add(this.frame);
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  private setup(side: number): boolean {
    const r = this.engine.renderer;
    if (r.capabilities.maxVertexTextures === 0) return false;
    const C = this.capSize;
    const N = this.count;

    const rt = () =>
      new THREE.WebGLRenderTarget(C, C, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
    this.rtA = rt();
    this.rtB = rt();
    this.bufA = new Uint8Array(C * C * 4);
    this.bufB = new Uint8Array(C * C * 4);
    this.listA = new Int32Array(C * C);
    this.listB = new Int32Array(C * C);
    this.hilbert = hilbertOrder(C);

    this.corrData = new Float32Array(N * 4);
    this.corr = new THREE.DataTexture(this.corrData, side, side, THREE.RGBAFormat, THREE.FloatType);
    this.corr.minFilter = this.corr.magFilter = THREE.NearestFilter;
    this.shared.tCorr.value = this.corr;
    this.jitter = new Float32Array(N * 4);
    for (let i = 0; i < this.jitter.length; i++) this.jitter[i] = Math.random();

    const ref = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      ref[i * 2] = ((i % side) + 0.5) / side;
      ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));

    const make = (role: number, tex: THREE.Texture, order: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.shared, tCol: { value: tex }, uRole: { value: role }, uSize: { value: 2 } },
        vertexShader: `${noise}\n${pointsVert}`,
        fragmentShader: pointsFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const pts = new THREE.Points(this.geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = order;
      pts.visible = false;
      this.engine.scene.add(pts);
      return [pts, mat] as const;
    };
    [this.pointsA, this.matA] = make(0, this.rtA.texture, -2);
    [this.pointsB, this.matB] = make(1, this.rtB.texture, -1);
    return true;
  }

  // ── Public ─────────────────────────────────────────────────────────────

  /**
   * Dissolve `a` (on the stage now) and condense `b` (already placed on the
   * stage by the layout, at opacity 0). Resolves when `b` is fully live.
   */
  run(a: Specimen, b: Specimen, opts: MorphOptions): Promise<void> {
    this.cancel();
    this.a = a;
    this.b = b;
    this.opts = opts;
    this.token++;
    a.opacity = 1;
    b.opacity = 0;
    b.keepAlive = true;
    this.phase = 'capture';
    this.running = true;
    return new Promise((res) => (this.resolve = res));
  }

  /** Jump to the end state immediately (mode switch, etc.). */
  cancel(): void {
    if (!this.running) return;
    this.tween?.kill();
    this.state.p = 1;
    this.finish();
  }

  dispose(): void {
    this.engine.beforeRender.delete(this.frame);
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.corr?.dispose();
    this.geo?.dispose();
    this.matA?.dispose();
    this.matB?.dispose();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private showPoints(on: boolean): void {
    this.pointsA!.visible = on;
    this.pointsB!.visible = on;
  }

  private finish(): void {
    const { a, b } = this;
    // the outgoing specimen stays invisible: the exhibition collapses it into
    // its slot before making it opaque again (otherwise it flashes on the stage)
    if (a) a.opacity = 0;
    if (b) {
      b.opacity = 1;
      b.keepAlive = false;
    }
    this.showPoints(false);
    this.running = false;
    this.phase = 'idle';
    const res = this.resolve;
    this.resolve = undefined;
    res?.();
  }

  /** Render one specimen in isolation through the main camera, cropped to the stage. */
  private renderInto(s: Specimen, rt: THREE.WebGLRenderTarget): void {
    const e = this.engine;
    const r = e.renderer;
    const cam = e.camera;
    const c = this.capture;
    const restore = e.isolate(s.group);
    s.group.visible = true;
    const op = s.u.uOpacity.value;
    s.u.uOpacity.value = 1;

    cam.setViewOffset(e.width, e.height, c.x - c.half, c.y - c.half, c.half * 2, c.half * 2);
    const prev = r.getRenderTarget();
    r.getClearColor(_clear);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(e.scene, cam);
    r.setRenderTarget(prev);
    r.setClearColor(_clear, alpha);
    cam.clearViewOffset();

    s.u.uOpacity.value = op;
    restore();
  }

  /** Opaque texels in Hilbert order. */
  private list(buf: Uint8Array, out: Int32Array): number {
    const h = this.hilbert!;
    let n = 0;
    for (let k = 0; k < h.length; k++) {
      const idx = h[k];
      if (buf[idx * 4 + 3] > 40) out[n++] = idx;
    }
    return n;
  }

  /** Spread each silhouette's texels evenly over the particles (rank along the curve). */
  private distribute(nA: number, nB: number): void {
    const d = this.corrData!;
    const jit = this.jitter!;
    const la = this.listA!;
    const lb = this.listB!;
    const C = this.capSize;
    const N = this.count;
    for (let i = 0; i < N; i++) {
      const a = la[Math.min(nA - 1, Math.floor(((i + 0.5) * nA) / N))];
      const b = lb[Math.min(nB - 1, Math.floor(((i + 0.5) * nB) / N))];
      const j = i * 4;
      d[j] = ((a % C) + jit[j]) / C;
      d[j + 1] = (Math.floor(a / C) + jit[j + 1]) / C;
      d[j + 2] = ((b % C) + jit[j + 2]) / C;
      d[j + 3] = (Math.floor(b / C) + jit[j + 3]) / C;
    }
    this.corr!.needsUpdate = true;
  }

  private async begin(token: number): Promise<void> {
    const r = this.engine.renderer;
    const C = this.capSize;
    this.renderInto(this.a!, this.rtA!);
    this.renderInto(this.b!, this.rtB!);
    this.phase = 'readback';
    try {
      await Promise.all([
        r.readRenderTargetPixelsAsync(this.rtA!, 0, 0, C, C, this.bufA!),
        r.readRenderTargetPixelsAsync(this.rtB!, 0, 0, C, C, this.bufB!),
      ]);
    } catch {
      r.readRenderTargetPixels(this.rtA!, 0, 0, C, C, this.bufA!);
      r.readRenderTargetPixels(this.rtB!, 0, 0, C, C, this.bufB!);
    }
    if (token !== this.token || !this.running) return;

    let nA = this.list(this.bufA!, this.listA!);
    const nB = this.list(this.bufB!, this.listB!);
    if (nB === 0) {
      // destination not renderable: hand over without particles
      this.finish();
      return;
    }
    if (nA === 0) {
      this.listA!.set(this.listB!.subarray(0, nB));
      nA = nB;
    }
    this.distribute(nA, nB);
    this.coverA = nA / (C * C);
    this.coverB = nB / (C * C);

    const cfg = this.config;
    const reduced = this.engine.reducedMotion;
    const calm = reduced ? 0.3 : 1;
    this.shared.uSpread.value = cfg.spread * calm;
    this.shared.uLift.value = cfg.lift * calm;
    this.shared.uSwirl.value = cfg.swirl * calm;
    this.shared.uSoft.value = cfg.softness;
    this.shared.uDepth.value = cfg.depth * calm;
    this.shared.uStagger.value = cfg.stagger;
    this.shared.uOpacity.value = cfg.particleOpacity;

    this.state.p = 0;
    this.shared.uP.value = 0;
    this.phase = 'play';
    this.showPoints(true);
    this.tween = gsap.to(this.state, {
      p: 1,
      duration: reduced ? Math.min(0.8, cfg.duration) : cfg.duration,
      ease: 'none',
      onComplete: () => token === this.token && this.finish(),
    });
  }

  private frame = (): void => {
    if (!this.running || !this.opts) return;
    const e = this.engine;

    // capture region: the stage square, padded for deformation beyond the circle
    const st = this.opts.stage();
    const c = this.capture;
    c.x = st.x;
    c.y = st.y;
    c.half = st.r * 1.18;
    this.shared.uStageR.value = c.half;
    this.shared.uCamDist.value = e.camera.position.z;

    if (this.phase === 'capture') {
      this.begin(this.token);
      return;
    }
    if (this.phase !== 'play') return;

    const p = this.state.p;
    this.shared.uP.value = p;

    // live hand-off: A dissolves into its particles, B fades in over its own
    const [h0, h1] = this.config.handoff;
    this.a!.opacity = 1 - smoother(0.0, 0.25, p);
    this.b!.opacity = smoother(h0, h1, p);

    // keep the incoming colours in sync with the living specimen
    if (p > 0.3) this.renderInto(this.b!, this.rtB!);

    // particle size that tiles each silhouette: sqrt(area / count), in device px
    const side = c.half * 2;
    const tile = (cover: number) => Math.sqrt((cover * side * side) / this.count) * this.config.particleSize * e.pixelRatio;
    this.matA!.uniforms.uSize.value = tile(this.coverA);
    this.matB!.uniforms.uSize.value = tile(this.coverB);
    e.screenToWorld(st.x, st.y, 0, this.pointsA!.position);
    this.pointsB!.position.copy(this.pointsA!.position);
  };
}
