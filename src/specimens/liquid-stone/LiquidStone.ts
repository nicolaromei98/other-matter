import * as THREE from 'three';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import vert from './stone.vert?raw';
import frag from './stone.frag?raw';
import type { Frame } from '../../core/types';
import { damp } from '../../core/math';

const CRACK_N = 4;
const CRACK_LIFE = 6;

/**
 * OM—005 LIQUID STONE
 * Everything is slow on purpose: pressure is followed with heavy lag, a
 * strike opens seams of light that close over a few seconds, the interior
 * keeps drifting under a shell that barely moves.
 */
export default class LiquidStone extends Specimen {
  private mesh!: LodMesh;
  private readonly pressL = new THREE.Vector3(0, 0, 2);
  private readonly pressAmt = { value: 0 };
  private readonly flowT = { value: 0 };
  private readonly cracks = Array.from({ length: CRACK_N }, () => new THREE.Vector4(0, 0, 0, -100));
  private readonly crackE = new Float32Array(CRACK_N);
  private readonly crackAny = { value: 0 };
  private crackCursor = 0;
  private readonly lastCrack = new THREE.Vector3(9, 9, 9);
  private lastCrackT = -1;
  private flowSpeed = 1;

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = {
      uPressL: { value: this.pressL },
      uPressAmt: this.pressAmt,
      uFlowT: this.flowT,
      uCrack: { value: this.cracks },
      uCrackE: { value: this.crackE },
      uCrackAny: this.crackAny,
    };
    const mat = this.material(
      glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, vert),
      glsl(chunks.common, chunks.noise, chunks.cellular, chunks.env, chunks.specimen, frag),
      extra,
    );
    this.mesh = new LodMesh(weldedSphere(hi ? 144 : 104, hi ? 108 : 78), weldedSphere(hi ? 96 : 72, hi ? 72 : 54), weldedSphere(48, 36), mat);
    this.body.add(this.mesh);
    this.body.scale.set(0.94, 1.06, 0.92);
    this.fit = 0.86;
  }

  protected lod(px: number): void {
    this.mesh.setRadius(px);
  }

  private strike(p: THREE.Vector3, e: number, t: number) {
    this.cracks[this.crackCursor].set(p.x, p.y, p.z, t);
    this.crackE[this.crackCursor] = e;
    this.crackCursor = (this.crackCursor + 1) % CRACK_N;
    this.lastCrack.copy(p);
    this.lastCrackT = t;
  }

  protected onTap(): void {
    if (this.input.hit) this.strike(this.input.local, 1, this.u.uTime.value);
  }

  protected step(f: Frame): void {
    const { dt, time: t } = f;
    const inp = this.input;
    if (inp.hit) {
      this.pressL.x = damp(this.pressL.x, inp.local.x, 1.4, dt);
      this.pressL.y = damp(this.pressL.y, inp.local.y, 1.4, dt);
      this.pressL.z = damp(this.pressL.z, inp.local.z, 1.4, dt);
    }
    const target = inp.hit ? 0.5 + this.press * 0.5 : 0;
    this.pressAmt.value = damp(this.pressAmt.value, target, target > this.pressAmt.value ? 1.1 : 0.6, dt);

    // dragging keeps fracturing along the path
    if (inp.pressed && inp.hit && inp.local.distanceTo(this.lastCrack) > 0.3 && t - this.lastCrackT > 0.18) {
      this.strike(inp.local, 0.75, t);
    }
    let any = 0;
    for (let i = 0; i < CRACK_N; i++) {
      if (this.crackE[i] > 0 && t - this.cracks[i].w > CRACK_LIFE) this.crackE[i] = 0;
      if (this.crackE[i] > 0) any = 1;
    }
    this.crackAny.value = any;

    this.flowSpeed = damp(this.flowSpeed, 1 + this.pressAmt.value * 1.2 + this.u.uRes.value * 4, 1.2, dt);
    this.flowT.value += dt * 0.045 * this.flowSpeed * f.motion;

    const m = f.motion;
    this.body.rotation.y = Math.sin(f.idle * 0.06) * 0.25 * m;
    this.body.rotation.x = Math.sin(f.idle * 0.05 + 0.4) * 0.06 * m;
  }
}
