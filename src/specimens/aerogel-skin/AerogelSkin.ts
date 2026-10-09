import * as THREE from 'three';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import vert from './aerogel.vert?raw';
import frag from './aerogel.frag?raw';
import type { Frame } from '../../core/types';
import { Spring } from '../../core/math';

/**
 * OM—001 AEROGEL SKIN
 * Pressure field under the cursor, drag stretch on an under-damped spring,
 * internal pressure waves when its sound plays.
 */
export default class AerogelSkin extends Specimen {
  private mesh!: LodMesh;
  private readonly stretch = new THREE.Vector3();
  private readonly sx = new Spring(0, 18, 3.4);
  private readonly sy = new Spring(0, 18, 3.4);

  init(): void {
    const hi = this.ctx.tier === 'high';
    const mat = this.material(
      glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, vert),
      glsl(chunks.common, chunks.noise, chunks.env, chunks.specimen, frag),
      { uStretch: { value: this.stretch } },
    );
    this.mesh = new LodMesh(weldedSphere(hi ? 160 : 112, hi ? 120 : 84), weldedSphere(hi ? 96 : 72, hi ? 72 : 54), weldedSphere(48, 36), mat);
    this.body.add(this.mesh);
    this.body.scale.set(1.08, 0.94, 0.96);
  }

  protected lod(px: number): void {
    this.mesh.setRadius(px);
  }

  protected step(f: Frame): void {
    const d = this.input.drag;
    const max = 0.45;
    const tx = this.input.pressed ? Math.max(-max, Math.min(max, d.x * 0.6)) : 0;
    const ty = this.input.pressed ? Math.max(-max, Math.min(max, d.y * 0.6)) : 0;
    this.stretch.set(this.sx.step(tx, f.dt), this.sy.step(ty, f.dt), 0);

    const m = f.motion;
    this.body.rotation.y = Math.sin(f.idle * 0.13) * 0.35 * m;
    this.body.rotation.x = Math.sin(f.idle * 0.1 + 1.3) * 0.12 * m;
  }
}
