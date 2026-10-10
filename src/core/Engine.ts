import * as THREE from 'three';
import Lenis from 'lenis';
import gsap from 'gsap';
import { Pointer } from './Pointer';
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
  private dpr: number;
  private readonly dprMin: number;
  private frameAvg = 1 / 60;
  private slowTime = 0;
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

    // The specimens are soft, shader-heavy surfaces: fragment cost grows with the
    // square of the pixel ratio, and past 1.5 the gain is hard to see.
    const cap = opts.tier === 'high' ? 1.5 : 1.25;
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.dprMin = opts.tier === 'high' ? 1 : 0.75;

    this.lenis = opts.reducedMotion ? null : new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => (this.lost = false));
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
    const w = window.innerWidth;
    const h = window.innerHeight;
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

  /** Degrade resolution when frames stay below ~50 fps for a second; never oscillates back up. */
  private adapt(dt: number): void {
    this.frameAvg += (dt - this.frameAvg) * 0.08;
    if (this.frameAvg > 1 / 50) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt * 0.5);
    if (this.slowTime > 1 && this.dpr > this.dprMin) {
      this.dpr = Math.max(this.dprMin, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, true);
      this.slowTime = 0;
      this.frameAvg = 1 / 60;
    }
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
    // At most one frame per ~10.5 ms: 120/144 Hz screens draw every other
    // refresh (60/72 fps, half the GPU work), 60 and 90 Hz draw every one.
    const now = performance.now();
    const elapsed = now - this.lastFrame;
    if (elapsed < 10.5) return;
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
    this.adapt(dt);
  };
}
