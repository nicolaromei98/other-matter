import * as THREE from 'three';
import { Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import dustVert from './dust.vert?raw';
import dustFrag from './dust.frag?raw';
import shellVert from './shell.vert?raw';
import shellFrag from './shell.frag?raw';
import type { Frame } from '../../core/types';
import { Spring, clamp } from '../../core/math';

/** Fibres as great-circle arcs on nested shells, plus loose dust. */
function fibreCloud(fibres: number, perFibre: number, dust: number): THREE.BufferGeometry {
  const count = fibres * perFibre + dust;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const info = new Float32Array(count * 2);
  const u = new THREE.Vector3();
  const a = new THREE.Vector3();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let k = 0;
  for (let f = 0; f < fibres; f++) {
    u.randomDirection();
    a.randomDirection().cross(u).normalize();
    const r = 0.45 + Math.pow(Math.random(), 0.45) * 0.55;
    const len = 0.9 + Math.random() * 1.6;
    const phase = Math.random() * Math.PI * 2;
    const fs = Math.random();
    for (let s = 0; s < perFibre; s++, k++) {
      const x = s / (perFibre - 1);
      q.setFromAxisAngle(a, (x - 0.5) * len);
      v.copy(u).applyQuaternion(q).multiplyScalar(r * (1 + 0.035 * Math.sin(x * 9 + phase)));
      pos.set([v.x, v.y, v.z], k * 3);
      seed.set([Math.random(), fs * 0.7 + Math.random() * 0.3, Math.random(), Math.random()], k * 4);
      info.set([x, 0], k * 2);
    }
  }
  for (let d = 0; d < dust; d++, k++) {
    v.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * 1.05);
    pos.set([v.x, v.y, v.z], k * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], k * 4);
    info.set([0, 1], k * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  return g;
}

/**
 * OM—004 DUST SILK
 * Thousands of luminous fibres in one draw call. The shape is held by a flow
 * field, not by geometry: disperse it and it finds its way back.
 */
export default class DustSilk extends Specimen {
  private readonly disperse = new Spring(0, 9, 2.8);
  private readonly uDisperse = { value: 0 };
  private readonly uPointScale = { value: 1 };
  count = 0;

  init(): void {
    const hi = this.ctx.tier === 'high';
    const geo = hi ? fibreCloud(260, 64, 1500) : fibreCloud(120, 44, 600);
    this.count = geo.attributes.position.count;
    const points = new THREE.Points(
      geo,
      this.material(
        glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, dustVert),
        glsl(chunks.common, dustFrag),
        { uDisperse: this.uDisperse, uPointScale: this.uPointScale },
        { transparent: true, depthWrite: false },
      ),
    );
    points.renderOrder = 2;

    const shell = new THREE.Mesh(
      weldedSphere(64, 48),
      this.material(
        glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, shellVert),
        glsl(chunks.common, chunks.specimen, shellFrag),
        {},
        { transparent: true, depthWrite: false },
      ),
    );
    shell.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
    shell.renderOrder = 1;
    this.body.add(shell, points);
    this.hitRadius = 0.95;
  }

  protected onCapture(sizePx: number | null): void {
    this.uPointScale.value = sizePx === null ? (this.screen.r / 150) * this.pixelRatio : sizePx / 120;
  }

  protected onTap(): void {
    this.disperse.velocity += 3.6;
  }

  protected step(f: Frame): void {
    // fast passes stir the fibres a little even without a tap
    const stir = this.input.over ? clamp(this.input.speed * 0.02, 0, 0.12) : 0;
    this.uDisperse.value = Math.max(-0.08, this.disperse.step(stir, f.dt));
    this.uPointScale.value = (this.screen.r / 150) * this.pixelRatio;

    const m = f.motion;
    this.body.rotation.y = f.idle * 0.04 * m;
    this.body.rotation.x = Math.sin(f.idle * 0.08) * 0.2 * m;
  }
}
