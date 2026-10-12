import * as THREE from 'three';
import { Specimen, chunks, glsl } from '../Specimen';
import coreVert from './core.vert?raw';
import coreFrag from './core.frag?raw';
import glassyVert from './glassy.vert?raw';
import glassyFrag from './glassy.frag?raw';
import beadFrag from './bead.frag?raw';
import motesVert from './motes.vert?raw';
import motesFrag from './motes.frag?raw';
import type { Frame } from '../../core/types';
import { Spring, clamp, damp } from '../../core/math';

/** Core radius, the ring's radius and its capsules' radius (local units). */
const CORE = 0.6;
const RING = 0.92;
const BEAD = 0.185;
const BEADS = 6;

/** The molecule suspended in the core: atoms (centre, radius) and bonds (atom pairs, radius). */
const ATOMS: [number, number, number, number][] = [
  [0.0, -0.06, 0.06, 0.1],
  [-0.27, -0.2, 0.1, 0.085],
  [0.27, -0.1, 0.12, 0.085],
  [0.03, 0.22, 0.0, 0.07],
  [0.02, 0.36, -0.04, 0.045],
  // a small ring molecule, further back
  ...Array.from({ length: 6 }, (_, i): [number, number, number, number] => {
    const a = (i / 6) * Math.PI * 2;
    return [-0.24 + Math.cos(a) * 0.085, 0.16 + Math.sin(a) * 0.085, -0.22, 0.026];
  }),
  [-0.12, 0.22, -0.2, 0.022],
  [-0.05, 0.3, -0.18, 0.02],
];
const BONDS: [number, number, number][] = [
  [0, 1, 0.026],
  [0, 2, 0.026],
  [0, 3, 0.024],
  [3, 4, 0.018],
  ...Array.from({ length: 6 }, (_, i): [number, number, number] => [5 + i, 5 + ((i + 1) % 6), 0.008]),
  [5, 11, 0.008],
  [11, 12, 0.008],
];

/** Points inside the core (sparkles, bubbles) and around it (halo, droplets); kind in aInfo.x. */
function motes(inner: boolean, scale: number): THREE.BufferGeometry {
  const counts = inner ? [Math.round(1700 * scale), Math.round(70 * scale)] : [Math.round(2600 * scale), 18];
  const total = counts[0] + counts[1];
  const pos = new Float32Array(total * 3);
  const info = new Float32Array(total * 4);
  const v = new THREE.Vector3();
  let k = 0;
  for (let kind = 0; kind < 2; kind++) {
    for (let i = 0; i < counts[kind]; i++, k++) {
      v.randomDirection();
      let r: number;
      if (inner) r = kind === 0 ? CORE * (0.15 + 0.82 * Math.pow(Math.random(), 0.6)) : CORE * (0.2 + 0.7 * Math.random());
      else r = kind === 0 ? CORE * (1.0 + Math.pow(Math.random(), 2.2) * 0.14) : 0.95 + Math.random() * 0.6;
      v.multiplyScalar(r);
      pos.set([v.x, v.y, v.z], k * 3);
      // kind (0/1 inner: sparkle/bubble, 2/3 outer: halo/droplet), seed, size jitter, hue
      info.set([kind + (inner ? 0 : 2), Math.random(), Math.random(), Math.random()], k * 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return g;
}

/** A glass rod, 1 long on y (centred), flaring where it meets the capsules. */
function rodGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = i / 24 - 0.5;
    const flare = Math.pow(Math.abs(y) * 2, 6);
    pts.push(new THREE.Vector2(1 + flare * 1.6, y));
  }
  return new THREE.LatheGeometry(pts, 16);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

/**
 * OM—003 ORBITAL SERUM
 * A drop of green serum in a glass skin, a molecule suspended inside it in a
 * burst of chromatic sparkles, a halo of fine green matter at its edge; around
 * it, six glass capsules of yellow pollen held in a ring by glass bonds,
 * orbiting. The pointer tilts the ring toward it; dragging stirs it faster; a
 * tap lets the ring go wide and draw back in; fragmentation (Specimen.fragment)
 * scatters the capsules, stretches the bonds until they let go, and opens the
 * molecule.
 *
 * Draw order: capsules and bonds (opaque), the liquid's far wall (blended
 * over whatever is behind it), the molecule (opaque), sparkles and bubbles,
 * the glass skin, then the halo and the stray droplets.
 */
export default class OrbitalSerum extends Specimen {
  private beads!: THREE.InstancedMesh;
  private rods!: THREE.InstancedMesh;
  private atoms!: THREE.InstancedMesh;
  private bonds!: THREE.InstancedMesh;
  private readonly ring = new THREE.Group();
  private readonly molecule = new THREE.Group();
  private readonly uPointScale = { value: 1 };
  private readonly release = new Spring(0, 7, 2.2);
  private orbit = 0;
  private stir = 0;
  private readonly tiltX = { v: 0 };
  private readonly tiltY = { v: 0 };
  private readonly beadDirs = Array.from({ length: BEADS }, () => new THREE.Vector3().randomDirection());
  private readonly beadPos = Array.from({ length: BEADS }, () => new THREE.Vector3());

  init(): void {
    const hi = this.ctx.tier === 'high';
    const extra = { uPointScale: this.uPointScale };
    const vertChunks = [chunks.common, chunks.noise, chunks.specimen];
    const fragChunks = [chunks.common, chunks.noise, chunks.env, chunks.specimen];

    // ring: capsules and rods, opaque (their glass is faked against the light page)
    this.beads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, hi ? 40 : 28, hi ? 30 : 20),
      this.material(glsl(...vertChunks, glassyVert), glsl(...fragChunks, beadFrag), extra, { depthWrite: true }),
      BEADS,
    );
    this.rods = new THREE.InstancedMesh(
      rodGeometry(),
      this.material(glsl(...vertChunks, glassyVert), glsl('#define ROD 1', ...fragChunks, glassyFrag), extra, { depthWrite: true }),
      BEADS,
    );
    this.beads.renderOrder = this.rods.renderOrder = 1;
    this.ring.add(this.beads, this.rods);

    // the liquid's far wall
    const coreGeo = new THREE.SphereGeometry(CORE, hi ? 72 : 48, hi ? 54 : 36);
    const back = new THREE.Mesh(
      coreGeo,
      this.material(glsl(...vertChunks, coreVert), glsl('#define BACK 1', ...fragChunks, coreFrag), extra, { depthWrite: false, side: THREE.BackSide }),
    );
    back.renderOrder = 2;

    // the molecule, suspended
    const atomMat = this.material(glsl(...vertChunks, glassyVert), glsl('#define ROD 0', ...fragChunks, glassyFrag), extra, { depthWrite: true });
    this.atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 18), atomMat, ATOMS.length);
    this.bonds = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), atomMat, BONDS.length);
    this.atoms.renderOrder = this.bonds.renderOrder = 3;
    this.molecule.add(this.atoms, this.bonds);

    const inner = new THREE.Points(
      motes(true, hi ? 1 : 0.5),
      this.material(glsl(...vertChunks, motesVert), glsl(chunks.common, motesFrag), extra, { depthWrite: false }),
    );
    inner.renderOrder = 4;
    const front = new THREE.Mesh(
      coreGeo,
      this.material(glsl(...vertChunks, coreVert), glsl('#define BACK 0', ...fragChunks, coreFrag), extra, { depthWrite: false }),
    );
    front.renderOrder = 5;
    const outer = new THREE.Points(
      motes(false, hi ? 1 : 0.5),
      this.material(glsl(...vertChunks, motesVert), glsl(chunks.common, motesFrag), extra, { depthWrite: false }),
    );
    outer.renderOrder = 6;

    for (const o of [this.beads, this.rods, back, this.atoms, this.bonds, inner, front, outer]) o.frustumCulled = false;
    this.body.add(this.ring, back, this.molecule, inner, front, outer);
    // the ring reaches past the core: leave room for it in the anchor
    this.fit = 0.8;
    this.hitRadius = 0.8;
    this.placeMolecule(0);
  }

  protected onCapture(sizePx: number | null): void {
    this.uPointScale.value = sizePx === null ? (this.screen.r / 150) * this.pixelRatio : sizePx / 120;
  }

  protected onTap(strength = 1): void {
    this.release.velocity += 2.6 * strength;
  }

  /** Atoms and bonds; `open` (0…1) draws the atoms apart, thinning the bonds. */
  private placeMolecule(open: number): void {
    ATOMS.forEach(([x, y, z, r], i) => {
      _a.set(x, y, z).multiplyScalar(1 + open * 0.9);
      _m.compose(_a, _q.identity(), _s.setScalar(r));
      this.atoms.setMatrixAt(i, _m);
    });
    BONDS.forEach(([i, j, r], k) => {
      _a.set(ATOMS[i][0], ATOMS[i][1], ATOMS[i][2]).multiplyScalar(1 + open * 0.9);
      _b.set(ATOMS[j][0], ATOMS[j][1], ATOMS[j][2]).multiplyScalar(1 + open * 0.9);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _q.setFromUnitVectors(_Y, _d.normalize());
      const thin = r * Math.max(0, 1 - open * 1.6);
      _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s.set(thin, len, thin));
      this.bonds.setMatrixAt(k, _m);
    });
    this.atoms.instanceMatrix.needsUpdate = true;
    this.bonds.instanceMatrix.needsUpdate = true;
  }

  protected step(f: Frame): void {
    const dt = f.dt;
    const m = f.motion;
    const inp = this.input;
    const frag = this.fragment;
    const wide = Math.max(-0.2, this.release.step(0, dt));

    // stir: dragging across it spins the ring faster; it settles back to its own pace
    const push = inp.pressed && inp.over ? clamp(inp.speed * 0.6, 0, 3) : inp.over ? clamp(inp.speed * 0.08, 0, 0.5) : 0;
    this.stir = damp(this.stir, push, push > this.stir ? 6 : 1.2, dt);
    this.orbit += dt * (0.16 * m + this.stir);

    // the ring leans toward the pointer
    const pl = this.u.uPointerL.value;
    const lean = this.hover * (1 - frag);
    this.tiltX.v = damp(this.tiltX.v, -clamp(pl.y, -1, 1) * 0.35 * lean, 3, dt);
    this.tiltY.v = damp(this.tiltY.v, clamp(pl.x, -1, 1) * 0.35 * lean, 3, dt);
    this.ring.rotation.set(0.88 + this.tiltX.v + Math.sin(f.idle * 0.13) * 0.08 * m, -0.18 + this.tiltY.v, 0.28 + Math.sin(f.idle * 0.09) * 0.06 * m);

    // capsules on a puckered hexagon (alternately above and below the ring's plane)
    const radius = RING * (1 + wide * 0.32 + frag * 0.35);
    const pulse = 1 + this.u.uRes.value * 0.08;
    for (let i = 0; i < BEADS; i++) {
      const a = this.orbit + (i / BEADS) * Math.PI * 2;
      const pos = this.beadPos[i].set(Math.cos(a) * radius, (i % 2 ? 0.11 : -0.11) * (1 + wide), Math.sin(a) * radius);
      // fragmentation: each capsule drifts off on its own
      pos.addScaledVector(this.beadDirs[i], frag * 0.55);
      _m.compose(pos, _q.identity(), _s.setScalar(BEAD * pulse * (1 - frag * 0.15)));
      this.beads.setMatrixAt(i, _m);
    }
    // bonds between neighbours: stretched, they thin out and let go
    for (let i = 0; i < BEADS; i++) {
      _a.copy(this.beadPos[i]);
      _b.copy(this.beadPos[(i + 1) % BEADS]);
      _d.subVectors(_b, _a);
      const len = _d.length();
      const stretch = len / (RING * 1.0);
      const thick = 0.024 * clamp(1.6 - stretch * 0.6, 0, 1) * (1 - smooth(frag, 0.35, 0.7));
      _q.setFromUnitVectors(_Y, _d.normalize());
      _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s.set(thick, Math.max(0, len - BEAD * 1.4), thick));
      this.rods.setMatrixAt(i, _m);
    }
    this.beads.instanceMatrix.needsUpdate = true;
    this.rods.instanceMatrix.needsUpdate = true;

    this.placeMolecule(frag);
    this.molecule.rotation.set(Math.sin(f.idle * 0.17) * 0.35 * m, f.idle * 0.1 * m + this.orbit * 0.3, Math.sin(f.idle * 0.11) * 0.2 * m);

    this.uPointScale.value = (this.screen.r / 150) * this.pixelRatio;
    this.body.rotation.y = Math.sin(f.idle * 0.07) * 0.25 * m;
  }
}

function smooth(x: number, a: number, b: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
