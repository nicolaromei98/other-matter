import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import noise from '../shaders/noise.glsl?raw';
import env from '../shaders/env.glsl?raw';
import organic from '../shaders/organic.glsl?raw';
import optics from '../shaders/optics.glsl?raw';
import cellular from '../shaders/cellular.glsl?raw';
import specimenChunk from '../shaders/specimen.glsl?raw';
import type { Engine } from '../core/Engine';
import type { Frame, ScreenCircle, Tier } from '../core/types';
import type { MaterialEntry } from '../data/materials';
import { clamp, damp, smoothstep } from '../core/math';

/** Concatenate GLSL chunks; every shader lists its own dependencies. */
export const glsl = (...parts: string[]) => parts.join('\n');
export const chunks = { common, noise, env, organic, optics, cellular, specimen: specimenChunk };

export interface SpecimenContext {
  tier: Tier;
  reducedMotion: boolean;
  globals: Engine['globals'];
}

export interface SpecimenInput {
  /** The pointer ray hits the specimen's body. */
  hit: boolean;
  /** This specimen is the hovered (or captured) one. */
  over: boolean;
  /** 0..1 by screen distance to the specimen, for proximity-based responses. */
  proximity: number;
  /** Pointer in local space: surface hit, or projection on the facing plane. */
  local: THREE.Vector3;
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  /** Released without travelling: a click/tap. */
  tapped: boolean;
  /** Local-space drag offset since the press. */
  drag: THREE.Vector3;
  /** Pointer speed, in specimen radii per second. */
  speed: number;
}

export type SpecimenUniforms = ReturnType<typeof createSpecimenUniforms>;

function createSpecimenUniforms(g: Engine['globals']) {
  return {
    uTime: g.uTime,
    uIdle: g.uIdle,
    uMotion: g.uMotion,
    uEnvRot: g.uEnvRot,
    uHover: { value: 0 },
    uPress: { value: 0 },
    uPointerL: { value: new THREE.Vector3(0, 0, 2) },
    uCamL: { value: new THREE.Vector3(0, 0, 10) },
    uDetail: { value: 1 },
    uRes: { value: 0 },
    uResPos: { value: new THREE.Vector3() },
    uResAge: { value: 10 },
    uScan: { value: new THREE.Vector2(2, 0) },
    /** Hand-off opacity (particle transitions); 1 otherwise. */
    uOpacity: { value: 1 },
  };
}

const _inv = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1);
const _plane = new THREE.Plane();
const _n = new THREE.Vector3();

/**
 * Base class for every specimen.
 *
 * `group` is placed by the layout (position = DOM anchor centre, scale =
 * anchor radius in px). `body` carries the specimen's own slow motion. All
 * shaders work in the body's local space, where the specimen has radius ≈ 1.
 */
export abstract class Specimen {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly entry: MaterialEntry;

  /** Where the layout wants it on screen (CSS px). Written by the exhibition. */
  readonly screen: ScreenCircle = { x: 0, y: 0, r: 0, z: 0 };
  /** Fraction of the anchor radius the body occupies (leaves room for deformation). */
  fit = 0.84;
  /** Local radius used for picking. */
  hitRadius = 1;
  /** Whether pointer interaction reaches it (set by the exhibition per layout). */
  interactive = true;
  /** Whether a tap triggers the specimen's own action (gallery stage only). */
  tapAction = false;
  /** 0..1, used to hand rendering to and from the particle transition. */
  opacity = 1;
  /** Keep updating uniforms while invisible (it is being captured offscreen). */
  keepAlive = false;

  hover = 0;
  press = 0;
  readonly input: SpecimenInput = {
    hit: false,
    over: false,
    proximity: 0,
    local: new THREE.Vector3(0, 0, 2),
    pressed: false,
    justPressed: false,
    justReleased: false,
    tapped: false,
    drag: new THREE.Vector3(),
    speed: 0,
  };

  /** Uniforms owned by this specimen; spread into each of its materials. */
  readonly u: SpecimenUniforms;

  protected readonly ctx: SpecimenContext;
  protected readonly pressStart = new THREE.Vector3();
  /** Current device pixel ratio (for point sizes). */
  protected pixelRatio = 1;
  private lastPx = { x: 0, y: 0 };
  private resStart = -10;
  private resDur = 1;

  constructor(entry: MaterialEntry, ctx: SpecimenContext) {
    this.entry = entry;
    this.ctx = ctx;
    this.u = createSpecimenUniforms(ctx.globals);
    this.group.add(this.body);
    this.group.visible = false;
  }

  /** Build meshes and materials. */
  abstract init(): void;
  /** Per-frame behaviour after input has been resolved. */
  protected abstract step(f: Frame): void;
  /** Called when the pointer is released on the specimen without dragging (stage only). */
  protected onTap(): void {}
  /** Swap geometry detail for the current on-screen radius. */
  protected lod(_radiusPx: number): void {}
  /** Adjust size-dependent uniforms while rendered by another camera (null = restore). */
  protected onCapture(_sizePx: number | null): void {}

  /** Prepare to be rendered by another camera at `sizePx` (thumbnails). */
  beginCapture(camera: THREE.Camera, sizePx: number): void {
    this.u.uOpacity.value = 1;
    this.u.uDetail.value = 0;
    this.lod(sizePx / 2);
    this.onCapture(sizePx);
    this.group.updateMatrixWorld(true);
    _v.copy(camera.position);
    this.body.worldToLocal(_v);
    this.u.uCamL.value.copy(_v);
  }

  /** Back to the layout's placement and the main camera. */
  endCapture(engine: Engine): void {
    this.onCapture(null);
    this.place(engine);
    this.group.updateMatrixWorld(true);
    _v.copy(engine.camera.position);
    this.body.worldToLocal(_v);
    this.u.uCamL.value.copy(_v);
    this.u.uDetail.value = clamp((this.screen.r - 30) / 150);
  }

  get radiusPx(): number {
    return this.screen.r;
  }

  /** Apply the layout's screen circle to the 3D transform. */
  place(engine: Engine): void {
    const s = this.screen;
    const onScreen =
      s.r > 0.5 && s.x + s.r > -50 && s.x - s.r < engine.width + 50 && s.y + s.r > -50 && s.y - s.r < engine.height + 50;
    this.group.visible = onScreen && this.opacity > 0.002;
    this.u.uOpacity.value = this.opacity;
    if (!onScreen) return;
    engine.screenToWorld(s.x, s.y, s.z, this.group.position);
    this.group.scale.setScalar(Math.max(s.r * this.fit, 1e-3));
    this.lod(s.r);
  }

  /** Ray in world space → local hit. Returns ray distance for depth ordering. */
  pick(ray: THREE.Ray, px: number, py: number): number {
    const inp = this.input;
    inp.hit = false;
    if (!this.group.visible || !this.interactive) {
      inp.proximity = 0;
      return Infinity;
    }
    _inv.copy(this.body.matrixWorld).invert();
    _ray.copy(ray).applyMatrix4(_inv);
    _sphere.radius = this.hitRadius;
    let dist = Infinity;
    if (_ray.intersectSphere(_sphere, _v)) {
      inp.hit = true;
      inp.local.copy(_v);
      dist = _v.applyMatrix4(this.body.matrixWorld).distanceTo(ray.origin);
    } else {
      // project on the plane through the centre facing the ray, for proximity fields
      _n.copy(_ray.direction).negate();
      _plane.setFromNormalAndCoplanarPoint(_n, _sphere.center);
      if (_ray.intersectPlane(_plane, _v)) inp.local.copy(_v);
    }
    const d = Math.hypot(px - this.screen.x, py - this.screen.y) / Math.max(this.screen.r, 1);
    inp.proximity = 1 - smoothstep(0.75, 1.5, d);
    return dist;
  }

  /** Start a resonance envelope (hover sound) at the current pointer position. */
  resonate(duration: number, time: number): void {
    this.resStart = time;
    this.resDur = Math.max(0.3, duration);
    this.u.uResPos.value.copy(this.input.local).clampLength(0, 1);
  }

  update(f: Frame, engine: Engine): void {
    const inp = this.input;
    const dt = f.dt;
    this.pixelRatio = engine.pixelRatio;

    // speed in radii per second
    const p = engine.pointer;
    const moved = Math.hypot(p.x - this.lastPx.x, p.y - this.lastPx.y);
    this.lastPx.x = p.x;
    this.lastPx.y = p.y;
    inp.speed = damp(inp.speed, moved / dt / Math.max(this.screen.r, 1), 8, dt);

    const target = inp.over ? 1 : this.interactive ? inp.proximity * 0.45 : 0;
    this.hover = damp(this.hover, target, target > this.hover ? 6 : 2.4, dt);
    this.press = damp(this.press, inp.pressed ? 1 : 0, inp.pressed ? 10 : 3.5, dt);

    if (inp.justPressed) this.pressStart.copy(inp.local);
    if (inp.pressed) inp.drag.copy(inp.local).sub(this.pressStart);
    else inp.drag.set(0, 0, 0);

    const u = this.u;
    u.uHover.value = this.hover;
    u.uPress.value = this.press;
    const pl = u.uPointerL.value;
    if (this.interactive && (inp.over || inp.proximity > 0)) {
      pl.lerp(inp.local, 1 - Math.exp(-14 * dt));
    }
    u.uDetail.value = clamp((this.screen.r - 30) / 150);

    _v.copy(engine.camera.position);
    this.body.worldToLocal(_v);
    u.uCamL.value.copy(_v);

    const age = f.time - this.resStart;
    u.uResAge.value = age;
    u.uRes.value = age < 0 ? 0 : Math.min(1, age / 0.06) * Math.exp(-age / (this.resDur * 0.45));

    if (inp.tapped && this.tapAction) this.onTap();
    this.step(f);
  }

  /** Standard ShaderMaterial for a specimen surface. */
  protected material(
    vertexShader: string,
    fragmentShader: string,
    extra: Record<string, THREE.IUniform> = {},
    params: Partial<THREE.ShaderMaterialParameters> = {},
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.u, ...extra },
      vertexShader,
      fragmentShader,
      defines: { HIGH: this.ctx.tier === 'high' ? 1 : 0 },
      // transparent so the hand-off opacity works; bodies still write depth
      transparent: true,
      ...params,
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

/**
 * Three levels of detail sharing one material, picked by on-screen radius:
 * the dense mesh on the stage, a middle one in grid cards, a light one in the
 * slider thumbnails and in flight at small sizes. Vertex work (the specimens
 * deform their surface per vertex) drops with the size it is seen at.
 */
export class LodMesh extends THREE.Group {
  private readonly levels: THREE.Mesh[];
  constructor(hi: THREE.BufferGeometry, mid: THREE.BufferGeometry, lo: THREE.BufferGeometry, material: THREE.Material) {
    super();
    this.levels = [hi, mid, lo].map((g) => {
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
      return new THREE.Mesh(g, material);
    });
    this.add(...this.levels);
    this.setRadius(1000);
  }
  /** About 11 px per segment around the rim at every level's upper bound. */
  setRadius(px: number): void {
    const k = px >= 180 ? 0 : px >= 70 ? 1 : 2;
    this.levels.forEach((m, i) => (m.visible = i === k));
  }
}
