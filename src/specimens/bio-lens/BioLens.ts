import * as THREE from 'three';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import vert from './lens.vert?raw';
import frag from './lens.frag?raw';
import type { Frame } from '../../core/types';
import { Spring, clamp, damp } from '../../core/math';

/**
 * OM—006 BIO LENS
 * A living optic. Its focusing core drifts toward the cursor and the whole
 * lens turns to follow it; touching it or hearing its own sound makes the
 * iris contract and the focus overshoot, as if it were accommodating.
 */
export default class BioLens extends Specimen {
  private mesh!: LodMesh;
  private readonly coreC = new THREE.Vector3(0, 0, 0.15);
  private readonly coreR = { value: 0.42 };
  private readonly iris = { value: 0 };
  private readonly distort = { value: 0 };
  private readonly focus = new Spring(0, 40, 4.5);
  private readonly turn = new THREE.Vector2();

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = { uCoreC: { value: this.coreC }, uCoreR: this.coreR, uIris: this.iris, uDistort: this.distort };
    const mat = this.material(
      glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, vert),
      glsl(chunks.common, chunks.noise, chunks.env, chunks.specimen, frag),
      extra,
    );
    this.mesh = new LodMesh(weldedSphere(hi ? 144 : 104, hi ? 108 : 78), weldedSphere(hi ? 96 : 72, hi ? 72 : 54), weldedSphere(48, 36), mat);
    this.body.add(this.mesh);
    this.body.scale.set(1, 1, 0.9);
  }

  protected lod(px: number): void {
    this.mesh.setRadius(px);
  }

  protected onTap(): void {
    this.focus.velocity += 4.2;
  }

  protected step(f: Frame): void {
    const { dt } = f;
    const inp = this.input;
    const near = inp.over || inp.proximity > 0.2;

    // the focusing core drifts toward the cursor
    const tx = near ? clamp(inp.local.x * 0.35, -0.3, 0.3) : Math.sin(f.idle * 0.3) * 0.08;
    const ty = near ? clamp(inp.local.y * 0.35, -0.3, 0.3) : Math.cos(f.idle * 0.23) * 0.08;
    this.coreC.x = damp(this.coreC.x, tx, 3.5, dt);
    this.coreC.y = damp(this.coreC.y, ty, 3.5, dt);

    // iris: contracts under the cursor, on touch and with its sound
    const focus = this.focus.step(inp.pressed ? 0.6 : 0, dt);
    const irisTarget = clamp(this.hover * 0.45 + this.press * 0.3 + this.u.uRes.value * 0.6 + focus * 0.4, 0, 1);
    this.iris.value = damp(this.iris.value, irisTarget, 4, dt);
    this.coreR.value = 0.42 - this.iris.value * 0.16 + Math.sin(f.idle * 1.1) * 0.012;
    this.distort.value = damp(this.distort.value, clamp(focus + this.u.uRes.value * 0.8, -0.5, 1.5), 6, dt);

    // the lens turns subtly toward the cursor
    this.turn.x = damp(this.turn.x, near ? clamp(inp.local.x, -1, 1) : 0, 2, dt);
    this.turn.y = damp(this.turn.y, near ? clamp(inp.local.y, -1, 1) : 0, 2, dt);
    const m = f.motion;
    this.body.rotation.y = this.turn.x * 0.35 + Math.sin(f.idle * 0.15) * 0.1 * m;
    this.body.rotation.x = -this.turn.y * 0.3 + Math.sin(f.idle * 0.12 + 1.0) * 0.08 * m;
  }
}
