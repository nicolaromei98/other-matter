import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LodMesh, Specimen, chunks, glsl } from '../Specimen';
import { weldedSphere } from '../geometry';
import memory from './memory.glsl?raw';
import cellVert from './cell.vert?raw';
import cellFrag from './cell.frag?raw';
import glassVert from './glass.vert?raw';
import glassFrag from './glass.frag?raw';
import type { Frame } from '../../core/types';

const TRAIL_N = 24;
const LIFE = 9;

/** Two unit spheres in one geometry, told apart by aCell (−1 / +1): the two cells. */
function twinSphere(w: number, h: number): THREE.BufferGeometry {
  const halves = [-1, 1].map((side) => {
    const g = weldedSphere(w, h);
    g.setAttribute('aCell', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(side), 1));
    return g;
  });
  return mergeGeometries(halves)!;
}

/**
 * OM—002 MEMORY GLASS
 * Two cells caught dividing, suspended in a membrane of clear liquid glass:
 * lobed, granular, one cyan and one teal. Gestures are written into a ring
 * buffer of 3D trail points: the glass presses in and rings out around them,
 * the cells give way where they were touched, and everything relaxes as the
 * trail ages.
 *
 * Draw order: the cells (opaque, depth written), then the membrane's far side,
 * then its near side, both blended over them.
 */
export default class MemoryGlass extends Specimen {
  private cells!: LodMesh;
  private glass!: LodMesh[];
  private readonly trail = Array.from({ length: TRAIL_N }, () => new THREE.Vector4(0, 0, 0, -100));
  private readonly trailE = new Float32Array(TRAIL_N);
  private cursor = 0;
  private readonly last = new THREE.Vector3(9, 9, 9);
  private lastT = -1;

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = { uTrail: { value: this.trail }, uTrailE: { value: this.trailE } };
    const vertChunks = [chunks.common, chunks.noise, chunks.organic, chunks.specimen, memory];

    const cellMat = this.material(
      glsl(...vertChunks, cellVert),
      glsl(chunks.common, chunks.noise, chunks.env, chunks.specimen, cellFrag),
      extra,
      { depthWrite: true },
    );
    this.cells = new LodMesh(twinSphere(hi ? 112 : 80, hi ? 84 : 60), twinSphere(72, 54), twinSphere(40, 30), cellMat);
    this.cells.renderOrder = 1;
    this.cells.children.forEach((m) => (m.renderOrder = 1));

    this.glass = [THREE.BackSide, THREE.FrontSide].map((side, i) => {
      const mat = this.material(
        glsl(...vertChunks, glassVert),
        glsl(`#define BACK ${side === THREE.BackSide ? 1 : 0}`, chunks.common, chunks.env, chunks.specimen, glassFrag),
        extra,
        { depthWrite: false, side },
      );
      const lod = new LodMesh(weldedSphere(hi ? 144 : 96, hi ? 108 : 72), weldedSphere(80, 60), weldedSphere(44, 33), mat);
      lod.children.forEach((m) => (m.renderOrder = 2 + i));
      return lod;
    });
    this.body.add(this.cells, ...this.glass);
    this.hitRadius = 1;
  }

  protected lod(px: number): void {
    this.cells.setRadius(px);
    this.glass.forEach((g) => g.setRadius(px));
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
    this.body.rotation.y = f.idle * 0.05 * m + Math.sin(f.idle * 0.11) * 0.35;
    this.body.rotation.x = Math.sin(f.idle * 0.09 + 0.6) * 0.15 * m;
    this.body.rotation.z = Math.sin(f.idle * 0.07) * 0.12 * m;
  }
}
