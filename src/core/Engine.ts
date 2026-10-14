import * as THREE from 'three';
import Lenis from 'lenis';
import { largeHeight, onViewportChange } from './viewport';
import gsap from 'gsap';
import { Pointer } from './Pointer';
import { Pacer } from './Pacer';
import { damp } from './math';
import type { Frame, Tier } from './types';
import type { Specimen } from '../specimens/Specimen';

interface EngineOptions {
  tier: Tier;
  reducedMotion: boolean;
}

/** Uniforms shared by every material in the exhibition (same objects, not copies). */
export type Globals = ReturnType<typeof createGlobals>;

function createGlobals() {
  return {
    uTime: { value: 0 },
    uIdle: { value: 0 },
    uMotion: { value: 1 },
    /** Interactive light field: the cursor turns the studio rig. */
    uEnvRot: { value: new THREE.Matrix3() },
  };
}

const _ndc = new THREE.Vector2();
const _euler = new THREE.Euler();
const _m4 = new THREE.Matrix4();

/**
 * One renderer, one scene, one camera, one draw pass.
 *
 * The canvas is a transparent overlay above the page (pointer-events: none).
 * The camera is set so that 1 world unit = 1 CSS pixel on the z = 0 plane:
 * a specimen placed at a DOM element's centre with a scale equal to its
 * radius lands exactly on that element. Every specimen lives in this single
 * space all the time; layouts only move them. Nothing is re-created when the
 * view changes, so shader time, deformation and interaction state carry over.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(16, 1, 1, 10000);
  readonly globals = createGlobals();
  readonly pointer = new Pointer();
  readonly tier: Tier;
  readonly reducedMotion: boolean;
  readonly motion: number;
  readonly lenis: Lenis | null;

  readonly specimens: Specimen[] = [];
  /** Specimen currently under the pointer (ray hit), if any. */
  hovered: Specimen | null = null;
  /** Called every frame before picking/rendering (layout + choreography). */
  onLayout: ((dt: number) => void) | null = null;
  /** Called after rendering (diagnostics, UI that reads specimen state). */
  onAfterRender: ((dt: number) => void) | null = null;
  /** Offscreen work right before the main render (GPU simulation, captures). */
  readonly beforeRender = new Set<(dt: number) => void>();

  width = 0;
  height = 0;
  /** Resolution applied to the renderer; the pacer decides it (see Pacer). */
  private dpr = 1;
  private readonly pacer: Pacer;
  private lastRaf = 0;
  /** A refresh measurement running (see measureRefresh()): nothing is drawn meanwhile. */
  private measuring = 0;
  /** Set when the viewport really changed (see viewport.ts): toolbars sliding in and out don't count. */
  private sizeDirty = true;
  private lastFrame = 0;
  private time = 0;
  private idle = 0;
  private captured: Specimen | null = null;
  private envYaw = 0;
  private envPitch = 0;
  /** Phones: device tilt drives the light field instead of the pointer. */
  private tilt: { yaw: number; pitch: number } | null = null;
  private lost = false;
  private running = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly frame: Frame = { time: 0, idle: 0, dt: 0, motion: 1 };

  static create(canvas: HTMLCanvasElement, opts: EngineOptions): Engine | null {
    try {
      return new Engine(canvas, opts);
    } catch (err) {
      console.warn('[engine] WebGL unavailable, falling back to static plates', err);
      return null;
    }
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    opts: EngineOptions,
  ) {
    this.tier = opts.tier;
    this.reducedMotion = opts.reducedMotion;
    this.motion = opts.reducedMotion ? 0.35 : 1;
    this.globals.uMotion.value = this.motion;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = true;

    // The canvas carries the slider's liquid edges and icons and the specimens'
    // silhouettes, right next to crisp DOM text: render at the screen's own
    // density (up to 2x); the pacer trades some of it away while frames stutter.
    this.pacer = new Pacer(opts.tier === 'high');
    this.pacer.fit(window.devicePixelRatio);
    // loading, warm-up and intro first: slow frames then say nothing about the GPU
    this.pacer.hold(4);
    this.dpr = this.pacer.dpr;

    this.lenis = opts.reducedMotion ? null : new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => (this.lost = false));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.pacer.hold(1.5);
    });
    onViewportChange(() => (this.sizeDirty = true));
    this.watchScreen();
    this.measureRefresh();
    this.resize();
    if (!this.pointer.fine) this.listenTilt();
  }

  /**
   * Device orientation → light field. iOS asks for permission, which only a
   * user gesture may request: the first touch does it.
   */
  private listenTilt(): void {
    const Orientation = (window as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!Orientation) return;
    const listen = () =>
      window.addEventListener('deviceorientation', (e) => {
        if (e.gamma === null || e.beta === null) return;
        const c = (v: number) => Math.max(-1, Math.min(1, v));
        this.tilt = { yaw: c(e.gamma / 35) * 0.375, pitch: c((e.beta - 45) / 35) * 0.2 };
      });
    if (typeof Orientation.requestPermission === 'function') {
      const ask = () => {
        window.removeEventListener('touchend', ask);
        Orientation.requestPermission!()
          .then((state) => state === 'granted' && listen())
          .catch(() => {});
      };
      window.addEventListener('touchend', ask);
    } else {
      listen();
    }
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  /** Pacing as it stands (diagnostics): refresh and cadence in ms, every refresh or every other, share of late frames. */
  get pacing(): { refresh: number; cadence: number; every: 1 | 2; late: number } {
    const { refresh, cadence, every, late } = this.pacer;
    return { refresh, cadence, every, late };
  }

  add(s: Specimen): void {
    this.specimens.push(s);
    this.scene.add(s.group);
  }

  /** Compile every program before the first visible frame. */
  async prepare(): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(this.tick);
  }

  /** Hide everything in the scene except `target`; returns a function that restores visibility. */
  isolate(target: THREE.Object3D): () => void {
    const kids = this.scene.children;
    const vis = kids.map((c) => c.visible);
    kids.forEach((c) => (c.visible = c === target));
    return () => kids.forEach((c, i) => (c.visible = vis[i]));
  }

  /** CSS-pixel screen point → world point on the z = 0 plane. */
  screenToWorld(x: number, y: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x - this.width / 2, this.height / 2 - y, z);
  }

  private resize(): void {
    if (!this.sizeDirty) return;
    this.sizeDirty = false;
    // the canvas covers the large viewport: on phones the browser toolbars slide
    // over it instead of resizing it (and reallocating it) mid-scroll
    const w = window.innerWidth;
    const h = largeHeight();
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, true);
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.aspect = w / h;
    this.camera.position.set(0, 0, dist);
    this.camera.near = dist * 0.25;
    this.camera.far = dist * 2.5;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /**
   * The window moved to another screen (or the page zoom changed): a new
   * density, and maybe a new refresh rate (a 120 Hz laptop panel, a 60 Hz
   * monitor). Pacing starts over from the top there.
   */
  private watchScreen(): void {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const moved = () => {
      query.removeEventListener('change', moved);
      this.watchScreen();
      this.pacer.fit(window.devicePixelRatio);
      this.applyDpr();
      this.measureRefresh();
    };
    query.addEventListener('change', moved);
  }

  /**
   * Measures the display's refresh interval on some 24 animation frames that
   * draw nothing: first while the loader is up, then after a move to another
   * screen, where a few held frames go unnoticed.
   */
  private measureRefresh(): void {
    const id = ++this.measuring;
    const gaps: number[] = [];
    let last = -1;
    let frames = 0;
    const step = (t: number) => {
      if (id !== this.measuring) return;
      const gap = t - last;
      if (last >= 0 && gap > 4 && gap < 40) gaps.push(gap);
      last = t;
      if (gaps.length < 24 && ++frames < 90) {
        requestAnimationFrame(step);
        return;
      }
      this.measuring = 0;
      if (gaps.length >= 8) {
        gaps.sort((a, b) => a - b);
        this.pacer.setRefresh(gaps[Math.floor(gaps.length * 0.25)]);
      }
    };
    requestAnimationFrame(step);
  }

  /** The pacer's resolution onto the renderer (reallocates the canvas: a hitch of a frame or two). */
  private applyDpr(): void {
    if (this.pacer.dpr === this.dpr) return;
    this.dpr = this.pacer.dpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, true);
  }

  /** Light field: the cursor gently turns the studio environment. */
  private updateLightField(dt: number): void {
    const p = this.pointer;
    const on = p.x > -1000;
    let yaw = on ? (p.x / this.width - 0.5) * 0.75 : 0;
    let pitch = on ? (p.y / this.height - 0.5) * 0.4 : 0;
    if (this.tilt) {
      yaw = this.tilt.yaw;
      pitch = this.tilt.pitch;
    }
    this.envYaw = damp(this.envYaw, yaw, 2.2, dt);
    this.envPitch = damp(this.envPitch, pitch, 2.2, dt);
    _euler.set(this.envPitch, this.envYaw, 0);
    _m4.makeRotationFromEuler(_euler);
    this.globals.uEnvRot.value.setFromMatrix4(_m4);
  }

  private pick(): void {
    const p = this.pointer;
    _ndc.set((p.x / this.width) * 2 - 1, -(p.y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(_ndc, this.camera);
    const ray = this.raycaster.ray;

    let top: Specimen | null = null;
    let best = Infinity;
    for (const s of this.specimens) {
      const d = s.pick(ray, p.x, p.y);
      if (s.input.hit && s.interactive && d < best) {
        best = d;
        top = s;
      }
    }
    if (p.pressedThisFrame && top) this.captured = top;
    this.hovered = this.captured ?? top;

    for (const s of this.specimens) {
      const pressed = this.captured === s && p.down;
      s.input.justPressed = pressed && !s.input.pressed;
      s.input.justReleased = s.input.pressed && !pressed;
      s.input.tapped = s.input.justReleased && p.travel < 6;
      s.input.pressed = pressed;
      s.input.over = s === this.hovered;
    }
    if (!p.down) this.captured = null;
    document.documentElement.classList.toggle('is-over-specimen', !!this.hovered);
  }

  private tick = (): void => {
    const now = performance.now();
    // measuring the display's refresh: nothing drawn, the time picks up from here
    if (this.measuring) {
      this.lastRaf = this.lastFrame = now;
      return;
    }
    this.pacer.raf(now - this.lastRaf);
    this.lastRaf = now;
    const elapsed = now - this.lastFrame;
    // every refresh, or every other one when the pacer asks for a steady half rate
    if (this.pacer.skip(elapsed)) return;
    this.lastFrame = now;
    const dt = Math.min(1 / 20, Math.max(1 / 1000, elapsed / 1000));
    this.time += dt;
    this.idle += dt * this.motion;
    this.globals.uTime.value = this.time;
    this.globals.uIdle.value = this.idle;
    const f = this.frame;
    f.time = this.time;
    f.idle = this.idle;
    f.dt = dt;
    f.motion = this.motion;

    this.lenis?.raf(now);
    this.resize();
    this.onLayout?.(dt);

    for (const s of this.specimens) s.place(this);
    this.scene.updateMatrixWorld();
    this.updateLightField(dt);
    this.pick();
    for (const s of this.specimens) if (s.group.visible || s.keepAlive) s.update(f, this);

    if (!this.lost) {
      this.beforeRender.forEach((fn) => fn(dt));
      this.renderer.render(this.scene, this.camera);
    }
    this.onAfterRender?.(dt);
    this.pointer.endFrame(dt);
    this.pacer.frame(elapsed, dt);
    this.applyDpr();
  };
}
