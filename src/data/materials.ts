export type Slug = 'aerogel-skin' | 'memory-glass' | 'thermal-foam' | 'dust-silk' | 'liquid-stone' | 'bio-lens';

export interface MaterialEntry {
  slug: Slug;
  index: number;
  /** Design ID, set as "OM — 001". */
  code: string;
  name: string;
  classification: string;
  /** One-line description used in both layouts. */
  short: string;
  /** Longer editorial note, exposed to assistive tech on the stage. */
  description: string;
  /** Static fallback (no WebGL): two sRGB colours for a radial gradient. */
  fallback: [string, string];
  /** What the pointer does to it on the stage (the cursor's label). */
  verb: string;
  /** Page tint while it is on the stage: a whisper of its colour. */
  tint: string;
  /**
   * Specimen sheet for Inspect: three readings, each pinned to a direction from
   * the specimen's centre (body space). Speculative values, like the materials.
   */
  sheet: { label: string; value: string; at: [number, number, number] }[];
}

export const MATERIALS: MaterialEntry[] = [
  {
    slug: 'aerogel-skin',
    index: 1,
    code: 'OM — 001',
    name: 'Aerogel Skin',
    classification: 'Translucent Membrane',
    short: 'A membrane that gives shape to air.',
    description:
      'An inflated membrane that is almost entirely air. Light and colour drift through it like weather: pink, coral, lilac and pale blue clouds moving beneath a pearl skin. Pressure from the cursor bends it; sound swells it from inside.',
    fallback: ['#fbf7f8', '#f4c9d6'],
    verb: 'STRETCH',
    tint: '#fcf9fa',
    sheet: [
      { label: 'DENSITY', value: '0.003 G/CM3', at: [-0.62, 0.55, 0.56] },
      { label: 'AIR FRACTION', value: '99.8 PCT', at: [0.7, 0.28, 0.66] },
      { label: 'SKIN', value: '12 MICRONS', at: [0.12, -0.82, 0.56] },
    ],
  },
  {
    slug: 'memory-glass',
    index: 2,
    code: 'OM — 002',
    name: 'Memory Glass',
    classification: 'Recording Liquid Glass',
    short: 'A glass that keeps what touches it.',
    description:
      'A liquid-glass organism with a black interior and suspended orange inclusions. Every gesture is written into it as a disturbance that drifts, stretches the inclusions and slowly dissolves.',
    fallback: ['#3a3a3a', '#ff7a2a'],
    verb: 'WRITE',
    tint: '#fcfaf7',
    sheet: [
      { label: 'RECALL', value: '72 H', at: [-0.66, 0.48, 0.58] },
      { label: 'INCLUSIONS', value: '4200 / CM3', at: [0.68, 0.36, 0.64] },
      { label: 'VISCOSITY', value: '1E9 PA S', at: [0.06, -0.84, 0.54] },
    ],
  },
  {
    slug: 'thermal-foam',
    index: 3,
    code: 'OM — 003',
    name: 'Thermal Foam',
    classification: 'Thermo-reactive Volume',
    short: 'A surface that remembers warmth.',
    description:
      'A liquid-crystalline volume with a blue-silver skin. Warmth from the cursor spreads through it over seconds, shifting its colour, softening its surface tension and inflating it locally.',
    fallback: ['#eef3fb', '#9fb6d9'],
    verb: 'WARM',
    tint: '#f8f9fc',
    sheet: [
      { label: 'RESPONSE', value: '0.4 S', at: [-0.64, 0.52, 0.56] },
      { label: 'RANGE', value: '18 / 41 C', at: [0.72, 0.3, 0.62] },
      { label: 'CELL', value: '0.8 MM', at: [0.1, -0.84, 0.52] },
    ],
  },
  {
    slug: 'dust-silk',
    index: 4,
    code: 'OM — 004',
    name: 'Dust Silk',
    classification: 'Luminous Fibre Aerosol',
    short: 'A fabric woven from light and dust.',
    description:
      'Thousands of luminous fibres held together by a slow flow field. Moving air disperses them; left alone, they always find their way back into the same breathing shape.',
    fallback: ['#f2fbff', '#2ab8ff'],
    verb: 'DISPERSE',
    tint: '#f7fafc',
    sheet: [
      { label: 'FIBRES', value: '18000', at: [-0.6, 0.56, 0.56] },
      { label: 'DRIFT', value: '0.2 MM / S', at: [0.7, 0.32, 0.64] },
      { label: 'RETURN', value: '6 S', at: [0.08, -0.84, 0.54] },
    ],
  },
  {
    slug: 'liquid-stone',
    index: 5,
    code: 'OM — 005',
    name: 'Liquid Stone',
    classification: 'Paradoxical Mineral',
    short: 'A stone that has not finished flowing.',
    description:
      'A polished mineral mass whose interior never stopped moving. Pressure bends its internal strata; a strike opens seams of light along its grain, which heal over a few seconds.',
    fallback: ['#5a5560', '#1a181c'],
    verb: 'STRIKE',
    tint: '#faf8f6',
    sheet: [
      { label: 'FLOW', value: '2 MM / YEAR', at: [-0.62, 0.52, 0.58] },
      { label: 'HARDNESS', value: '6.5 MOHS', at: [0.7, 0.3, 0.64] },
      { label: 'HEALING', value: '4 S', at: [0.1, -0.84, 0.52] },
    ],
  },
  {
    slug: 'bio-lens',
    index: 6,
    code: 'OM — 006',
    name: 'Bio Lens',
    classification: 'Living Optic',
    short: 'A lens that looks back.',
    description:
      'A transparent hydrogel optic that keeps changing its focus. It turns toward the cursor, bends the room behind it, and contracts like an iris when touched or when it hears something.',
    fallback: ['#f3f6ff', '#b9c7ff'],
    verb: 'FOCUS',
    tint: '#f8fafa',
    sheet: [
      { label: 'FOCAL', value: '38 MM', at: [-0.62, 0.52, 0.58] },
      { label: 'IRIS', value: '0.6 / 9 MM', at: [0.7, 0.3, 0.64] },
      { label: 'BLINK', value: '11 / MIN', at: [0.08, -0.84, 0.54] },
    ],
  },
];

export const bySlug = (slug: string) => MATERIALS.find((m) => m.slug === slug);
