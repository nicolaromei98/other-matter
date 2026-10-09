import * as THREE from 'three';
import gsap from 'gsap';
import common from '../../shaders/common.glsl?raw';
import noise from '../../shaders/noise.glsl?raw';
import frag from './transmute.frag?raw';
import type { Engine } from '../../core/Engine';
import type { ScreenCircle } from '../../core/types';
import type { Specimen } from '../../specimens/Specimen';

/** The one place to art-direct the gallery transition. */
export const transmuteConfig = {
  /** Total length, s. */
  duration: 1.5,
  /** GSAP ease of the front's progress: gentle at both ends, even through the middle. */
  ease: 'sine.inOut',
  /** MSAA samples of the two live copies (matches the main canvas antialiasing). */
  samples: 4,
};

export interface TransmuteOptions {
  /** Live stage circle (CSS px), measured each frame. */
  stage: () => ScreenCircle;
  /** +1: the new specimen enters from the right (next), -1: from the left (previous). */
  dir: number;
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Quad half-size in stage radii: room for bodies that deform past their circle. Same as PAD in the shader. */
const PAD = 1.25;
const _clear = new THREE.Color();

/**
 * Gallery transition: the specimen on the stage transmutes into the next one.
 *
 * While it runs, both specimens stay live (animated, lit, reacting to the
 * light field) but are drawn off screen: each into its own antialiased copy of
 * the stage square, through the main camera. One quad composites them across a
 * moving front with a fine iridescent seam (transmute.frag). At either end the
 * composite equals the live specimen, so the hand-over to and from the normal
 * render is invisible.
 */
export class Transmutation {
  readonly supported = true;
  running = false;

  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly state = { p: 0 };
  private size = 0;
  private tween?: gsap.core.Tween;
  private a?: Specimen;
  private b?: Specimen;
  private opts?: TransmuteOptions;
  private resolve?: () => void;

  constructor(private readonly engine: Engine) {
    const rt = () =>
      new THREE.WebGLRenderTarget(16, 16, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        samples: transmuteConfig.samples,
      });
    this.rtA = rt();
    this.rtB = rt();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: this.rtA.texture },
        tB: { value: this.rtB.texture },
        uP: { value: 0 },
        uTime: engine.globals.uTime,
        uDir: { value: new THREE.Vector2(1, -0.35).normalize() },
        uDetail: { value: engine.tier === 'high' ? 1 : 0 },
      },
      vertexShader: vert,
      fragmentShader: [common, noise, frag].join('\n'),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    engine.scene.add(this.mesh);
    engine.beforeRender.add(this.frame);
  }

  /**
   * Allocate the two live copies for a stage of `radius` CSS px ahead of time,
   * so the first transition does not pay for it (MSAA buffers are not cheap).
   */
  prepare(radius: number): void {
    if (this.running || radius < 1) return;
    this.fit(radius * PAD);
    const r = this.engine.renderer;
    const prev = r.getRenderTarget();
    r.getClearColor(_clear);
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const rt of [this.rtA, this.rtB]) {
      r.setRenderTarget(rt);
      r.clear(true, true, false);
    }
    r.setRenderTarget(prev);
    r.setClearColor(_clear, alpha);
  }

  /**
   * Draw every specimen once into a live copy and onto the canvas, and the
   * composite once, behind the loader. GPU drivers build pipeline state per
   * program and target format on first use; doing it here keeps that stall
   * (tens of ms) out of the first transition.
   */
  warm(specimens: Specimen[]): void {
    const e = this.engine;
    const r = e.renderer;
    const x = e.width / 2;
    const y = e.height / 2;
    const half = 32;
    this.fit(half);
    for (const s of specimens) {
      this.renderInto(s, this.rtA, x, y, half);
      const restore = e.isolate(s.group);
      s.group.visible = true;
      r.render(e.scene, e.camera);
      restore();
    }
    const restore = e.isolate(this.mesh);
    this.mesh.visible = true;
    e.screenToWorld(x, y, 0, this.mesh.position);
    this.mesh.scale.set(half, half, 1);
    r.render(e.scene, e.camera);
    restore();
    this.mesh.visible = false;
    this.size = 0; // the next prepare() / run() sizes the copies for the real stage
  }

  /**
   * Transmute `a` (on the stage now) into `b` (placed on the stage by the
   * layout). Resolves when `b` is fully live again.
   */
  run(a: Specimen, b: Specimen, opts: TransmuteOptions): Promise<void> {
    this.cancel();
    this.a = a;
    this.b = b;
    this.opts = opts;
    // both leave the normal render (the composite takes over) but keep living
    a.opacity = 0;
    b.opacity = 0;
    a.keepAlive = true;
    b.keepAlive = true;
    this.mat.uniforms.uDir.value.set(opts.dir >= 0 ? 1 : -1, -0.35).normalize();
    this.state.p = 0;
    this.mat.uniforms.uP.value = 0;
    this.running = true;
    this.mesh.visible = true;
    const reduced = this.engine.reducedMotion;
    this.tween = gsap.to(this.state, {
      p: 1,
      duration: reduced ? 0.6 : transmuteConfig.duration,
      ease: transmuteConfig.ease,
      onComplete: () => this.finish(),
    });
    return new Promise((res) => (this.resolve = res));
  }

  /** Jump to the end state immediately (mode switch, etc.). */
  cancel(): void {
    if (!this.running) return;
    this.tween?.kill();
    this.finish();
  }

  dispose(): void {
    this.engine.beforeRender.delete(this.frame);
    this.rtA.dispose();
    this.rtB.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
    this.engine.scene.remove(this.mesh);
  }

  private finish(): void {
    const { a, b } = this;
    // the outgoing specimen stays invisible: the exhibition collapses it into
    // its slot before making it opaque again (otherwise it flashes on the stage)
    if (a) {
      a.opacity = 0;
      a.keepAlive = false;
    }
    if (b) {
      b.opacity = 1;
      b.keepAlive = false;
    }
    this.mesh.visible = false;
    this.running = false;
    const res = this.resolve;
    this.resolve = undefined;
    res?.();
  }

  /** Render one specimen alone through the main camera, cropped to the stage square. */
  private renderInto(s: Specimen, rt: THREE.WebGLRenderTarget, x: number, y: number, half: number): void {
    const e = this.engine;
    const r = e.renderer;
    const cam = e.camera;
    const restore = e.isolate(s.group);
    s.group.visible = true;
    const op = s.u.uOpacity.value;
    s.u.uOpacity.value = 1;

    cam.setViewOffset(e.width, e.height, x - half, y - half, half * 2, half * 2);
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

  /** One texel per device pixel, so the composite is as sharp as the live render. */
  private fit(half: number): void {
    const size = Math.min(2048, Math.max(16, Math.round(half * 2 * this.engine.pixelRatio)));
    if (size === this.size) return;
    this.size = size;
    this.rtA.setSize(size, size);
    this.rtB.setSize(size, size);
  }

  private frame = (): void => {
    if (!this.running || !this.opts) return;
    const e = this.engine;
    const st = this.opts.stage();
    const half = st.r * PAD;
    if (half < 1) return;

    this.fit(half);
    this.renderInto(this.a!, this.rtA, st.x, st.y, half);
    this.renderInto(this.b!, this.rtB, st.x, st.y, half);

    this.mat.uniforms.uP.value = this.state.p;
    e.screenToWorld(st.x, st.y, 0, this.mesh.position);
    this.mesh.scale.set(half, half, 1);
  };
}
