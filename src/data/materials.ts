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
  },
];

export const bySlug = (slug: string) => MATERIALS.find((m) => m.slug === slug);
