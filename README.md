# OTHER MATTER — A catalogue of matter that does not yet exist

One continuous interactive exhibition of six impossible materials, rendered live.
There are no pages and no reloads: one WebGL scene and two presentations of it (Gallery and Grid).

```bash
npm install
npm run dev        # http://localhost:5190
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve dist/ locally
```

Deploys to Vercel as is: `vercel.json` sets the Vite build, `dist/` as output and
year-long immutable caching for the hashed files in `/assets`.

The site opens on the Grid. State lives in the URL (`?view=gallery&specimen=bio-lens`)
and is written with `history.replaceState`, never as navigation.

---

## Architecture

```
┌─ DOM (layout = source of truth) ──────────────────────────────────────┐
│ header · gallery (stage, name, description, dots + ruler) · grid      │
│ The stage, the six dots and the six card ellipses are ANCHORS.        │
└───────────────────────────────────────────────────────────────────────┘
┌─ one transparent <canvas>, fixed, above the page, pointer-events:none ┐
│ Engine: 1 renderer · 1 scene · 1 camera · 1 render pass per frame     │
│ camera mapped so 1 world unit = 1 CSS px on z = 0                     │
│ six Specimen groups that are always alive, never re-created           │
└───────────────────────────────────────────────────────────────────────┘
```

- **Shared space.** Every specimen lives in the same 3D scene for the life of the
  page. A layout is only a set of DOM anchors, measured with
  `getBoundingClientRect()` every frame. Each specimen is placed at its anchor's
  centre, with a scale equal to the anchor's radius. Scrolling, resizing and
  aspect changes therefore never misalign anything, and nothing stretches.
- **Tracks.** Changing layout gives every specimen a track from where it is now
  (a screen-space snapshot) to its new anchor. The anchor is measured live, so it
  stays correct while the page scrolls under it. GSAP drives each track's `t`.
  Radius is interpolated in log space; a depth arc (`lift`) and a lateral arc
  (`arc`) give the motion volume. A new transition snapshots the current state,
  so rapid toggling never jumps or duplicates anything.
- When a layout switch also scrolls the page (to the top, or to the selected card),
  the travelling specimen aims at where its anchor will be once the scroll ends. Its
  path stays a straight line while the page moves underneath, and the live anchor
  takes over when the track completes.
- **Single loop.** `gsap.ticker` drives Lenis, layout, picking, specimen updates
  and the render, all in one frame, in that order.

```
src/
  main.ts                 boot: engine, specimens, exhibition, loader
  exhibition/particles/   GPU particle transition: config, ParticleMorph, sim + render shaders
  exhibition/LiquidNav.ts  liquid slider: bead layout, droplet motion, hit areas, index label
  exhibition/GooeySlider.ts liquid slider rendering + live thumbnail atlas (gooey.frag)
  core/
    Engine.ts             renderer, pixel-mapped camera, loop, picking, light field, adaptive DPR
    Sound.ts              Web Audio synthesis: one voice per material, reverb, mute
    Diagnostics.ts        HUD: fps, frame ms, draw calls, triangles, points, dpr
    Pointer.ts · math.ts · types.ts
  exhibition/
    Exhibition.ts         modes, selection, anchors, tracks, choreography, input
  specimens/
    Specimen.ts           base: transform from layout, analytic picking, uniforms, LOD
    registry.ts           slug → class
    <material>/           Material.ts + .vert/.frag
  shaders/
    common · noise · cellular · organic (domain warp, curl) · env (studio, light field)
    optics (two-interface refraction) · specimen (shared uniforms, scan, resonance)
  styles/                 base.css (design system), fonts.css
  data/materials.ts       IDs, names, classes, copy
```

## Gallery ↔ Grid

| | Gallery → Grid | Grid → Gallery |
|---|---|---|
| Selected specimen | shrinks from the stage into its exact card ellipse (log-scale, slight depth arc) | rises from its card to the stage, growing toward the viewer |
| Other five | appear in place in their own card: a soft dissolve with a slight scale-in, staggered by grid distance | dissolve away in place in their card (fade + slight scale-out); they never travel |
| Cards | background fades in under each specimen as it lands; labels rise through line masks | labels drop out; backgrounds fade |
| Scroll | smooth-scrolls so the selected card is centred, while the specimen tracks it | smooth-scrolls to the top while specimens fly |
| Text | gallery copy leaves through masks | gallery copy and nav rise in; a scan sweeps the arriving specimen |

**Specimen to specimen** (slider beads, the droplet's arrows, ← →, swipe): one
particle cloud turns the first specimen into the second. The cloud (65,536
particles; 16,384 on low-tier devices) starts as the outgoing specimen, loosens
into fine dust mid-way while every particle glides to its place on the incoming
specimen and takes on its colour, then slows to rest as the live specimen fades
in over it. It is one continuous change: no particle appears or vanishes on its
own, and it all happens in place on the stage.

1. **Capture.** Both specimens are rendered in isolation through the main camera,
   cropped to the stage, into 512² render targets. Particles take the real
   colours and silhouettes on screen. The incoming one is re-captured every frame
   while it forms, so the cloud tracks the living specimen.
2. **Pairing.** The opaque texels of each capture are sorted by angle (narrow
   wedges around the stage centre), then by distance from it (counting sort,
   a few ms). Each wedge gets a share of the particles in proportion to both
   shapes there, and inside it a particle keeps its relative distance from the
   centre. So each particle has a texel on both specimens in the same direction,
   it moves only a little in or out, and the cloud stays even all the way (a
   Hilbert-curve pairing, tried first, left gaps along the quadrant seams).
3. **Animation.** Deterministic, in the vertex shader. Each region starts at a
   noise-driven moment. A particle's position and colour blend from one specimen
   to the other on a curve with a soft start and a long, slow arrival. Mid-way it
   also loosens: a short drift (about a quarter of the radius) with a slight
   swirl and lift, a little smaller and fainter. At the end the cloud exactly
   tiles the incoming silhouette (`sqrt(area / count)`), so the hand-off to the
   live specimen has no gaps and nothing pops.

Navigating during a transition keeps only the latest destination and plays it
next. Switching to Grid ends the transition instantly in its final state. Every
parameter lives in `src/exhibition/particles/config.ts` (`galleryParticleConfig`).

## The six materials

All six share one procedural studio (`env.glsl`): a paper-white cyclorama, softboxes,
black flags and a dark floor band. Clear specimens refract this studio, not the
page, which gives them the dark liquid edges of real glass. The cursor slowly turns
the whole rig (the interactive light field), so highlights move across reflective
specimens and new structure appears inside transparent ones.

| | Look | Pointer | Signature |
|---|---|---|---|
| **OM—001 Aerogel Skin** | pearl membrane; pink, coral, lilac and pale-blue clouds marched inside along the refracted ray | pressure dent with a displaced bulge; drag stretches it (spring) | light and colour moving through a volume |
| **OM—002 Memory Glass** | black liquid glass, silver reflections, orange inclusions merging in a curling flow, suspended droplets | hover and drag write a 3D trail; the surface presses and rings, the inclusions are pushed | a memory field that relaxes over about 9 s |
| **OM—003 Thermal Foam** | blue-silver liquid chrome, liquid-crystal film bands, translucent windows with bubbles | the cursor is a heat source: diffusing heat swells it, softens reflections and shifts colour | temperature spreading through the material |
| **OM—004 Dust Silk** | ~18k cyan fibres and dust in one draw call, inside a faint boundary | local force field; a tap disperses everything | disperse and reconstruct along a curl-noise flow |
| **OM—005 Liquid Stone** | graphite and violet mineral, flow-mapped strata, garnet translucency, polished highlights | heavy, late pressure that bends the inner flow; a click or drag opens light seams | fracture and heal along its own grain |
| **OM—006 Bio Lens** | clear hydrogel, three-channel dispersion, inner focusing core, iris ring, traced bubbles | the core and the lens follow the cursor; a tap pulls focus (spring overshoot) | looking through a living optic |

**Scan** (button under the description, key `S`, and automatic on arrival): a
line sweeps the specimen and leaves a material-specific x-ray behind it. That is
density contours, the memory field and inclusion boundaries, temperature isolines,
flaring fibres, the stress network, or optical-power fringes.

## Sound

Voice input was removed. Hovering a live specimen plays its own voice through
Web Audio. Memory Glass and Liquid Stone use recorded sounds
(`src/assets/sounds/*.mp3`, decoded once after the first gesture). Re-hovering
fades the previous take out in 0.15 s instead of stacking it. The other four are
synthesised: breath, warm chord, granular shimmer and a wet bloom. Each recording
falls back to a synthesised voice while it is still loading. The sound is panned to the specimen's
screen position. The material resonates with it: a pressure shell travels through
it from the point where the cursor entered (`uRes`, `uResPos`, `uResAge`).
Browsers only allow audio after a gesture, so sounds start after the first click
or key. "SOUND — ON/OFF" in the header is remembered per viewer.

## Performance

- One context, one scene, one render pass, no post-processing. Draw calls are
  about 7–8 (six bodies, the Dust Silk boundary and its points).
- Picking is analytic (ray against a sphere in local space): no proxy meshes and no
  Raycaster traversal.
- LOD, by on-screen radius: the dense mesh only on the stage (≥ 180 px), a
  96×72 mesh in grid cards, 48×36 in the slider thumbnails and in flight. The
  bodies deform per vertex, so this matters most in the grid.
- At most one frame every ~10.5 ms: 120/144 Hz screens draw every other refresh
  (60/72 fps, half the GPU work); 60 and 90 Hz screens draw every refresh.
- Slider thumbnails refresh round robin, two per frame (~20 fps each).
- Micro-detail is gated by on-screen size (`uDetail`), march steps and
  octaves drop on the low tier, and off-screen specimens are hidden and skip their
  update.
- DPR is capped (1.5 desktop / 1.25 low tier); fragment cost grows with its
  square. It steps down by 0.25 (to 1 / 0.75) when frames stay under ~50 fps for
  a second.
- Production builds minify the GLSL (`vite.config.ts`) and preload the four
  font files visible on first paint. Sound samples load only after the first
  gesture. three.js is tree-shaken to the WebGL renderer (~132 kB gzip, its
  own long-cached chunk); the app is ~62 kB gzip.
- Measured on an Apple M5 at 1440×900 (CPU + GPU per frame, synchronised):
  gallery 2.2–5.5 ms depending on the specimen, grid 3.7 ms. Before these
  changes: 2.4–7.9 ms and 9.3 ms, at twice the frame rate on 120 Hz screens.
- Measure with the HUD: `?debug`, or the <kbd>`</kbd> key in dev.
- Reduced motion: slower idle, no smooth scroll, choreography at 3× speed.
- No WebGL: anchors show static gradient plates, and all copy and navigation still work.

## Deliberate deviations from the design files

- Text below 10 px on the 1920 px artboard (6.4, 7, 9.7 px) gets a px floor
  (`max(9px, 6.4u)` …) so it stays legible below 1920 px wide.
- Gallery slider: liquid / gooey, after the user's reference. It is a row of black
  beads, one per specimen, each with a porthole showing the live specimen. The
  active bead is larger and carries two droplets with a dot and an arrow: "next"
  on its right, "previous" on its left.
  - Selecting a specimen makes the droplet on that side flow to the new bead. Its
    head runs ahead, its tail follows, and it bridges every bead it passes. The
    other droplet sinks into the old bead and wells up from the new one, while
    the row reflows as beads swell and shrink. Everything is weights tweened toward the
    target, so a move interrupted mid-way just continues from where it is.
  - It is one signed distance field in WebGL: circles plus a tapered capsule,
    joined with a smooth minimum (`gooey.frag`). Proportions are in `LiquidNav.ts`;
    the size comes from `--bead-a` in CSS. Without WebGL, CSS draws plain beads.
- In gallery view, the other five specimens are hidden. Switching layout moves only
  the selected specimen; the others dissolve out of, or into, their own cards.
- Switch: black = current mode, yellow = the other mode, as in the gallery reference.
- Two small mono controls were added in the existing type system: "SOUND — ON/OFF"
  in the header sub-row, and "SCAN SPECIMEN" under the gallery description.
