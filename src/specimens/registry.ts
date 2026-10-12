import type { MaterialEntry, Slug } from '../data/materials';
import type { Specimen, SpecimenContext } from './Specimen';
import AerogelSkin from './aerogel-skin/AerogelSkin';
import MemoryGlass from './memory-glass/MemoryGlass';
import OrbitalSerum from './orbital-serum/OrbitalSerum';
import DustSilk from './dust-silk/DustSilk';
import LiquidStone from './liquid-stone/LiquidStone';
import BioLens from './bio-lens/BioLens';

type SpecimenClass = new (entry: MaterialEntry, ctx: SpecimenContext) => Specimen;

/** Material → implementation. Every specimen is built once at boot and never re-created. */
export const SPECIMENS: Record<Slug, SpecimenClass> = {
  'aerogel-skin': AerogelSkin,
  'memory-glass': MemoryGlass,
  'orbital-serum': OrbitalSerum,
  'dust-silk': DustSilk,
  'liquid-stone': LiquidStone,
  'bio-lens': BioLens,
};
