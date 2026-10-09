import * as THREE from 'three';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import vert from './glass.vert?raw';
import frag from './glass.frag?raw';
import type { Frame } from '../../core/types';

const TRAIL_N = 24;
const LIFE = 9;

/**
 * OM—002 MEMORY GLASS
 * Gestures are written into a ring buffer of 3D trail points. The surface
 * presses in and rings out around them, the orange inclusions inside are
 * pushed along them, and everything relaxes as the trail ages.
 */
export default class MemoryGlass extends Specimen {
  private mesh!: LodMesh;
  private readonly trail = Array.from({ length: TRAIL_N }, () => new THREE.Vector4(0, 0, 0, -100));
  private readonly trailE = new Float32Array(TRAIL_N);
  private cursor = 0;
  private readonly last = new THREE.Vector3(9, 9, 9);
  private lastT = -1;

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = { uTrail: { value: this.trail }, uTrailE: { value: this.trailE } };
    const mat = this.material(
      glsl(chunks.common, chunks.noise, chunks.organic, chunks.specimen, vert),
      glsl(chunks.common, chunks.noise, chunks.env, chunks.specimen, frag),
      extra,
    );
    this.mesh = new LodMesh(weldedSphere(hi ? 160 : 112, hi ? 120 : 84), weldedSphere(hi ? 96 : 72, hi ? 72 : 54), weldedSphere(48, 36), mat);
    this.body.add(this.mesh);
  }

  protected lod(px: number): void {
    this.mesh.setRadius(px);
  }

  private write(p: THREE.Vector3, e: number, t: number) {
    this.trail[this.cursor].set(p.x, p.y, p.z, t);
    this.trailE[this.cursor] = e;
    this.cursor = (this.cursor + 1) % TRAIL_N;
    this.last.copy(p);
    this.lastT = t;
  }

  protected step(f: Frame): void {
    const inp = this.input;
    const t = f.time;
    if (inp.hit && (inp.over || inp.pressed)) {
      const moved = inp.local.distanceTo(this.last);
      const pressed = inp.pressed;
      if (moved > (pressed ? 0.06 : 0.12) && t - this.lastT > 0.03) this.write(inp.local, pressed ? 1 : 0.35, t);
      if (inp.justPressed) this.write(inp.local, 1.2, t);
    }
    for (let i = 0; i < TRAIL_N; i++) if (this.trailE[i] > 0 && t - this.trail[i].w > LIFE) this.trailE[i] = 0;

    const m = f.motion;
    this.body.rotation.y = f.idle * 0.05 * m + Math.sin(f.idle * 0.11) * 0.2;
    this.body.rotation.x = Math.sin(f.idle * 0.09 + 0.6) * 0.15 * m;
  }
}
