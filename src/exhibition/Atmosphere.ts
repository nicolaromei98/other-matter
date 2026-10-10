import * as THREE from 'three';
import frag from './atmosphere.frag?raw';
import type { Engine } from '../core/Engine';
import type { Specimen } from '../specimens/Specimen';

const vert = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The room the specimens sit in (atmosphere.frag): contact shadows, a vignette
 * that opens around the pointer, and grain. One full-screen quad drawn before
 * everything else, so the specimens cover their own shadows. Captures (the
 * slider thumbnails, the transmutation copies) isolate their specimen, so the
 * room never ends up inside them.
 */
export class Atmosphere {
  /** 0 → 1 while a specimen is inspected (tweened by the exhibition). */
  readonly inspect = { value: 0 };

  private readonly mat: THREE.ShaderMaterial;
  private readonly shadows = Array.from({ length: 6 }, () => new THREE.Vector4());

  constructor(
    private readonly engine: Engine,
    private readonly specimens: Specimen[],
  ) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uDpr: { value: 1 },
        uPointer: { value: new THREE.Vector2(-1e5, -1e5) },
        uShadow: { value: this.shadows },
        uTime: engine.globals.uTime,
        uInspect: this.inspect,
        uGrain: { value: engine.tier === 'high' ? 1 : 0.6 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -100;
    engine.scene.add(mesh);
    engine.beforeRender.add(this.update);
  }

  private update = (): void => {
    const e = this.engine;
    const u = this.mat.uniforms;
    u.uRes.value.set(e.width, e.height);
    u.uDpr.value = e.pixelRatio;
    const p = e.pointer;
    u.uPointer.value.set(p.x, p.y);
    this.specimens.forEach((s, i) => {
      const sc = s.screen;
      // specimens handed to the transmutation are invisible but still on the stage: share the shadow
      const w = s.keepAlive ? 0.5 : s.group.visible ? s.opacity : 0;
      const rise = 1 / (1 + Math.max(0, sc.z) / Math.max(sc.r, 1));
      this.shadows[i].set(sc.x, sc.y, sc.r * s.fit * s.shadowScale, sc.r > 2 ? w * rise : 0);
    });
  };
}
