import * as THREE from 'three';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import vert from './foam.vert?raw';
import frag from './foam.frag?raw';
import type { Frame } from '../../core/types';

const HEAT_N = 32;
const LIFE = 12;

/**
 * OM—003 THERMAL FOAM
 * The cursor is a heat source. Contacts are written into a ring buffer of
 * heat samples that diffuse over seconds: colour, surface tension and local
 * inflation follow the temperature field, not the pointer.
 */
export default class ThermalFoam extends Specimen {
  private mesh!: LodMesh;
  private readonly heat = Array.from({ length: HEAT_N }, () => new THREE.Vector4(0, 0, 0, -100));
  private readonly heatE = new Float32Array(HEAT_N);
  private cursor = 0;
  private readonly last = new THREE.Vector3(9, 9, 9);
  private lastT = -1;

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = { uHeat: { value: this.heat }, uHeatE: { value: this.heatE } };
    const mat = this.material(
      glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, vert),
      glsl(chunks.common, chunks.noise, chunks.cellular, chunks.env, chunks.specimen, frag),
      extra,
    );
    this.mesh = new LodMesh(weldedSphere(hi ? 160 : 112, hi ? 120 : 84), weldedSphere(hi ? 96 : 72, hi ? 72 : 54), weldedSphere(48, 36), mat);
    this.body.add(this.mesh);
    this.body.scale.set(1.04, 0.95, 1);
  }

  protected lod(px: number): void {
    this.mesh.setRadius(px);
  }

  private spawn(p: THREE.Vector3, e: number, t: number) {
    this.heat[this.cursor].set(p.x, p.y, p.z, t);
    this.heatE[this.cursor] = e;
    this.cursor = (this.cursor + 1) % HEAT_N;
    this.last.copy(p);
    this.lastT = t;
  }

  protected step(f: Frame): void {
    const inp = this.input;
    const t = f.time;
    if (inp.hit && (inp.over || inp.pressed)) {
      const moved = inp.local.distanceTo(this.last);
      if (moved > (inp.pressed ? 0.05 : 0.09) || t - this.lastT > (inp.pressed ? 0.08 : 0.22)) {
        this.spawn(inp.local, inp.pressed ? 0.5 : 0.2, t);
      }
    }
    for (let i = 0; i < HEAT_N; i++) if (this.heatE[i] > 0 && t - this.heat[i].w > LIFE) this.heatE[i] = 0;

    const m = f.motion;
    this.body.rotation.y = Math.sin(f.idle * 0.12) * 0.4 * m;
    this.body.rotation.z = Math.sin(f.idle * 0.09 + 2.0) * 0.1 * m;
  }
}
