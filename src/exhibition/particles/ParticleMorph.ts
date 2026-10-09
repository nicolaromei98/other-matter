import * as THREE from 'three';
import gsap from 'gsap';
import noise from '../../shaders/noise.glsl?raw';
import pointsVert from './points.vert?raw';
import pointsFrag from './points.frag?raw';
import { galleryParticleConfig, type GalleryParticleConfig } from './config';
import type { Engine } from '../../core/Engine';
import type { ScreenCircle } from '../../core/types';
import type { Specimen } from '../../specimens/Specimen';

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
 * Particle transition between two gallery specimens: one cloud that turns
 * from the first into the second.
 *
 * 1. Capture: both specimens are rendered in isolation through the main
 *    camera, cropped to the stage, so particles carry the real colours and
 *    silhouettes on screen.
 * 2. Sampling: the opaque texels of each capture are ordered by angle (in
 *    narrow wedges around the stage centre) and then by distance from it, and
 *    spread evenly over the particles (uniform coverage whatever the shape),
 *    with a sub-texel jitter. Each particle so gets a texel on both specimens
 *    in the same direction from the centre: it only moves in or out a little,
 *    and the cloud stays even all the way through.
 * 3. Animation (vertex shader, deterministic): every particle starts in the
 *    outgoing specimen, loosens into fine dust while it glides to its texel on
 *    the incoming one and takes on its colour, then settles. Region by region,
 *    in place on the stage.
 * 4. Hand-off: the live outgoing specimen fades into the cloud at the start;
 *    at the end the cloud tiles the incoming silhouette and the live specimen
 *    fades in over it on a long, C2-smooth curve.
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
  /** Polar ordering scratch: key and texel per opaque texel, and the counting-sort buckets. */
  private keys?: Uint32Array;
  private texels?: Uint32Array;
  private buckets?: Uint32Array;
  private bins = 512;
  private rings = 768;
  /** Per wedge: where its texels start in each sorted list, and how many there are. */
  private wedgeA?: { start: Uint32Array; count: Uint32Array };
  private wedgeB?: { start: Uint32Array; count: Uint32Array };
  private bufA?: Uint8Array;
  private bufB?: Uint8Array;
  private listA?: Int32Array;
  private listB?: Int32Array;
  private geo?: THREE.BufferGeometry;
  private points?: THREE.Points;
  private mat?: THREE.ShaderMaterial;

  private readonly shared = {
    tCorr: { value: null as THREE.Texture | null },
    uP: { value: 0 },
    uStageR: { value: 200 },
    uCamDist: { value: 1000 },
    uSpread: { value: 0.26 },
    uLift: { value: 0.07 },
    uSwirl: { value: 0.3 },
    uDust: { value: 0.72 },
    uDepth: { value: 14 },
    uStagger: { value: 0.14 },
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
    this.bins = C;
    this.rings = Math.ceil(C * 1.5);
    this.keys = new Uint32Array(C * C);
    this.texels = new Uint32Array(C * C);
    this.buckets = new Uint32Array(this.bins * this.rings);
    const wedge = () => ({ start: new Uint32Array(this.bins), count: new Uint32Array(this.bins) });
    this.wedgeA = wedge();
    this.wedgeB = wedge();

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

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.shared,
        tColA: { value: this.rtA.texture },
        tColB: { value: this.rtB.texture },
        uSizeA: { value: 2 },
        uSizeB: { value: 2 },
      },
      vertexShader: `${noise}\n${pointsVert}`,
      fragmentShader: pointsFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -1;
    this.points.visible = false;
    this.engine.scene.add(this.points);
    return true;
  }

  // ── Public ─────────────────────────────────────────────────────────────

  /**
   * Turn `a` (on the stage now) into `b` (already placed on the stage by the
   * layout, at opacity 0) through one particle cloud. Resolves when `b` is
   * fully live.
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
    this.mat?.dispose();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private showPoints(on: boolean): void {
    this.points!.visible = on;
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

  /** Opaque texels ordered by angle (one wedge per bin), then by distance from the centre. Counting sort. */
  private list(buf: Uint8Array, out: Int32Array, wedge: { start: Uint32Array; count: Uint32Array }): number {
    const C = this.capSize;
    const half = C / 2;
    const keys = this.keys!;
    const texels = this.texels!;
    const buckets = this.buckets!;
    const { bins, rings } = this;
    buckets.fill(0);
    wedge.count.fill(0);
    let n = 0;
    for (let idx = 0; idx < C * C; idx++) {
      if (buf[idx * 4 + 3] <= 40) continue;
      const x = (idx % C) + 0.5 - half;
      const y = Math.floor(idx / C) + 0.5 - half;
      const bin = Math.min(bins - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * bins));
      const ring = Math.min(rings - 1, Math.floor(Math.hypot(x, y) * 2));
      const key = bin * rings + ring;
      keys[n] = key;
      texels[n] = idx;
      buckets[key]++;
      wedge.count[bin]++;
      n++;
    }
    for (let w = 0, at = 0; w < bins; w++) {
      wedge.start[w] = at;
      at += wedge.count[w];
    }
    let sum = 0;
    for (let k = 0; k < buckets.length; k++) {
      const c = buckets[k];
      buckets[k] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) out[buckets[keys[i]]++] = texels[i];
    return n;
  }

  /**
   * Pair the two silhouettes wedge by wedge. Each wedge gets a share of the
   * particles in proportion to both shapes there; inside it, a particle keeps
   * its relative distance from the centre (near the centre in one specimen,
   * near the centre in the other), so the cloud stays filled while it changes.
   */
  private distribute(nA: number, nB: number): void {
    const d = this.corrData!;
    const jit = this.jitter!;
    const la = this.listA!;
    const lb = this.listB!;
    const wa = this.wedgeA!;
    const wb = this.wedgeB!;
    const C = this.capSize;
    const N = this.count;
    const bins = this.bins;
    // a wedge one shape leaves empty borrows the nearest wedge that shape fills
    const nearest = (count: Uint32Array, w: number) => {
      for (let s = 0; s < bins; s++) {
        if (count[(w + s) % bins]) return (w + s) % bins;
        if (count[(w - s + bins) % bins]) return (w - s + bins) % bins;
      }
      return w;
    };
    let cum = 0;
    let i = 0;
    for (let w = 0; w < bins; w++) {
      cum += (wa.count[w] / nA + wb.count[w] / nB) / 2;
      const end = w === bins - 1 ? N : Math.min(N, Math.round(cum * N));
      const n = end - i;
      if (n <= 0) continue;
      const ka = wa.count[w] ? w : nearest(wa.count, w);
      const kb = wb.count[w] ? w : nearest(wb.count, w);
      for (let q = 0; q < n; q++, i++) {
        const f = (q + 0.5) / n;
        const a = la[wa.start[ka] + Math.min(wa.count[ka] - 1, Math.floor(f * wa.count[ka]))];
        const b = lb[wb.start[kb] + Math.min(wb.count[kb] - 1, Math.floor(f * wb.count[kb]))];
        const j = i * 4;
        d[j] = ((a % C) + jit[j]) / C;
        d[j + 1] = (Math.floor(a / C) + jit[j + 1]) / C;
        d[j + 2] = ((b % C) + jit[j + 2]) / C;
        d[j + 3] = (Math.floor(b / C) + jit[j + 3]) / C;
      }
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

    let nA = this.list(this.bufA!, this.listA!, this.wedgeA!);
    const nB = this.list(this.bufB!, this.listB!, this.wedgeB!);
    if (nB === 0) {
      // destination not renderable: hand over without particles
      this.finish();
      return;
    }
    if (nA === 0) {
      this.listA!.set(this.listB!.subarray(0, nB));
      this.wedgeA!.start.set(this.wedgeB!.start);
      this.wedgeA!.count.set(this.wedgeB!.count);
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
    this.shared.uDust.value = cfg.dust;
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

    // live hand-off: A fades into the cloud, B fades in over it once it has settled
    const [h0, h1] = this.config.handoff;
    this.a!.opacity = 1 - smoother(0.02, 0.38, p);
    this.b!.opacity = smoother(h0, h1, p);

    // keep the incoming colours in sync with the living specimen
    if (p > 0.3) this.renderInto(this.b!, this.rtB!);

    // particle size that tiles each silhouette: sqrt(area / count), in device px
    const side = c.half * 2;
    const tile = (cover: number) => Math.sqrt((cover * side * side) / this.count) * this.config.particleSize * e.pixelRatio;
    this.mat!.uniforms.uSizeA.value = tile(this.coverA);
    this.mat!.uniforms.uSizeB.value = tile(this.coverB);
    e.screenToWorld(st.x, st.y, 0, this.points!.position);
  };
}
