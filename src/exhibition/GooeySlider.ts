import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import gooeyFrag from './gooey.frag?raw';
import type { Engine } from '../core/Engine';
import type { Specimen } from '../specimens/Specimen';
import type { LiquidNav } from './LiquidNav';

const vert = /* glsl */ `
uniform vec2 uQuad;
varying vec2 vP;
void main() {
  vP = position.xy * uQuad;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const _clear = new THREE.Color();
/** Room around the row for swelling beads and the droplet's stretch. */
const PAD = 24;
/** Thumbnails refreshed per frame (round robin): each one updates every third frame, ~20 fps. */
const PER_FRAME = 2;

/**
 * Renders the liquid slider (see LiquidNav for the motion). Every specimen is
 * rendered on its own, by a small camera, with MSAA, then copied into one cell
 * of a thumbnail atlas; the gooey shader draws the black liquid and shows the
 * thumbnails through each bead's porthole.
 */
export class GooeySlider {
  /** Global visibility, tweened with the gallery navigation. */
  readonly visibility = { value: 0 };

  private readonly cam = new THREE.PerspectiveCamera(16, 1, 1, 30);
  private readonly atlas: THREE.WebGLRenderTarget;
  /**
   * One thumbnail is drawn here (multisampled) and copied into its atlas cell.
   * The atlas itself can't be multisampled: three resolves the whole target and
   * discards the samples on every render, which would wipe the other cells.
   */
  private readonly cell: THREE.WebGLRenderTarget;
  private readonly region = new THREE.Box2();
  private readonly at = new THREE.Vector2();
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly beads = Array.from({ length: 6 }, () => new THREE.Vector4());
  private readonly heads = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly tails = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly icons = [1, 1];
  private res = 64;
  /** Next thumbnail to refresh (round robin). */
  private next = 0;
  /** Thumbnails to draw at once on the next frame (all of them after a resize). */
  private stale = 6;

  constructor(
    private readonly engine: Engine,
    private readonly specimens: Specimen[],
    private readonly nav: LiquidNav,
  ) {
    this.cam.position.set(0, 0, 1.15 / Math.sin(THREE.MathUtils.degToRad(8)));
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();

    this.atlas = new THREE.WebGLRenderTarget(this.res * 6, this.res, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.cell = new THREE.WebGLRenderTarget(this.res, this.res, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
    });
    // the copies need the atlas texture to exist before anything renders into it
    engine.renderer.initRenderTarget(this.atlas);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tAtlas: { value: this.atlas.texture },
        uBead: { value: this.beads },
        uHead: { value: this.heads },
        uTail: { value: this.tails },
        uK: { value: 12 },
        uIcon: { value: this.icons },
        uQuad: { value: new THREE.Vector2(100, 40) },
        uVis: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: [common, gooeyFrag].join('\n'),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    engine.scene.add(this.mesh);
    engine.beforeRender.add(this.render);
  }

  /** Thumbnail resolution from the active porthole's diameter (CSS px). */
  setThumbSize(px: number): void {
    const res = Math.max(16, Math.round(px * this.engine.renderer.getPixelRatio()));
    if (res === this.res) return;
    this.res = res;
    this.atlas.setSize(res * 6, res);
    this.cell.setSize(res, res);
    this.engine.renderer.initRenderTarget(this.atlas);
    this.stale = 6;
  }

  private update(): void {
    const { box, beads, drops } = this.nav;
    const vis = this.visibility.value;
    this.mesh.visible = vis > 0.01 && box.w > 0;
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    const hw = box.w / 2 + PAD;
    const hh = box.h / 2 + PAD;
    u.uVis.value = vis;
    u.uQuad.value.set(hw, hh);
    u.uK.value = this.nav.k;
    this.mesh.scale.set(hw, hh, 1);
    this.engine.screenToWorld(box.x, box.y, 6, this.mesh.position);
    beads.forEach((b, i) => this.beads[i].set(b.x - box.x, box.y - b.y, b.r, b.swell));
    drops.forEach((d, i) => {
      this.heads[i].set(d.head.x - box.x, box.y - d.head.y, d.head.r);
      this.tails[i].set(d.tail.x - box.x, box.y - d.tail.y, d.tail.r);
      this.icons[i] = d.icon;
    });
  }

  private render = (): void => {
    this.update();
    if (!this.mesh.visible) return;
    const e = this.engine;
    const r = e.renderer;
    const prev = r.getRenderTarget();
    r.getClearColor(_clear);
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const res = this.res;
    this.region.min.set(0, 0);
    this.region.max.set(res, res);
    const count = Math.max(PER_FRAME, this.stale);
    this.stale = 0;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.specimens.length;
      const s = this.specimens[i];
      const g = s.group;
      const restore = e.isolate(g);
      g.visible = true;
      g.position.set(0, 0, 0);
      g.scale.setScalar(s.fit);
      s.beginCapture(this.cam, res);
      r.setRenderTarget(this.cell);
      r.clear(true, true, false);
      r.render(e.scene, this.cam);
      s.endCapture(e);
      restore();
      r.copyTextureToTexture(this.cell.texture, this.atlas.texture, this.region, this.at.set(i * res, 0));
    }
    r.setRenderTarget(prev);
    r.setClearColor(_clear, alpha);
  };

  dispose(): void {
    this.engine.beforeRender.delete(this.render);
    this.atlas.dispose();
    this.cell.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
    this.engine.scene.remove(this.mesh);
  }
}
