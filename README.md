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
  exhibition/transmute/   gallery transition: Transmutation (live copies + composite), transmute.frag
  exhibition/LiquidNav.ts  liquid slider: bead layout, droplet motion, hit areas, index label
  exhibition/GooeySlider.ts liquid slider rendering + live thumbnail atlas (gooey.frag)
  exhibition/Atmosphere.ts the room: contact shadows, vignette around the pointer, grain (atmosphere.frag)
  exhibition/InspectSheet.ts Inspect: readings pinned to the specimen's surface
  ui/Flap.ts               split-flap text, used across the interface
  ui/CursorTag.ts          contextual tag next to the pointer
  ui/ViewSwitch.ts         Gallery / Grid segmented control
  ui/Button038.ts          Osmo Supply Button 038 (INSPECT SPECIMEN)
  ui/LiquidButton.ts       liquid attraction toward a nearby pointer for Button 038
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

**Specimen to specimen** (slider beads, the droplet's arrows, ← →, swipe): a
surface transmutation. A front sweeps across the specimen on the stage and turns
it into the next one, with a fine iridescent seam. The new material comes in from
the side the slider moves to: from the right with →, from the left with ←.

1. **Two live copies.** While it runs, both specimens stay alive (animated, lit,
   following the light field) but are drawn off screen, each into its own
   antialiased (MSAA) copy of the stage square through the main camera, at one
   texel per device pixel.
2. **One composite.** A quad on the stage blends them across the front
   (`transmute.frag`). The front is a tilted plane cutting an implied sphere, so
   the seam curves around the form, roughened by a slow domain-warped noise.
   Along it: a crisp, antialiased change of material, a slight lens with a touch
   of dispersion, a thin bright line with an iridescent halo, the new material
   briefly warmer just behind it and the old one a touch darker just ahead.
3. **Outlines.** Where the two silhouettes differ, the outline changes over a
   wider soft band, and whatever of the old form sticks out of the new one melts
   away as the front approaches, so no fragment is ever left floating.
4. **Seamless ends.** The seam's light fades in at the start, and the last
   stretch fades whatever the front has not reached, so at both ends the
   composite equals the live specimen. Measured: entering and leaving the
   composite changes the image no more than two ordinary consecutive frames.
5. **No first-time stall.** Behind the loader every specimen is drawn once into
   an MSAA copy and onto the canvas, and the composite once, so GPU drivers build
   their pipeline state before the first click (it cost ~70 ms otherwise).

Navigating during a transition keeps only the latest destination and plays it
next. Switching to Grid ends the transition instantly in its final state. Every
parameter lives in `transmuteConfig` (`src/exhibition/transmute/Transmutation.ts`) and in `transmute.frag`.

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

## Interaction and atmosphere

- **Opening.** After the loader the headline rises at full size with a line of
  data flapping in under it, then shrinks and slides exactly into the header
  while the grid assembles. Skipped with reduced motion.
- **Room.** One full-screen pass under the specimens (`atmosphere.frag`): a soft
  contact shadow under each body, a faint vignette that opens around the pointer
  (the same light field that turns the studio), fine paper grain. On the stage,
  the page takes a whisper of the specimen's colour (`tint` in
  `data/materials.ts`), turning with the transmutation.
- **Scroll.** In the grid, specimens lag a little behind their cards while the
  user scrolls (each at its own depth) and stretch and tip with the speed.
- **Cursor tag.** The system hand stays; a small liquid tag next to it says what
  a click or drag does: OPEN in the grid, the material's verb on the stage
  (STRETCH, WRITE, WARM, DISPERSE, STRIKE, FOCUS), DRAG / ROTATE / CLOSE in
  Inspect. The pill is black liquid (an SVG goo filter on the blob layer only):
  it drips in with an elastic give, trails a droplet out of its back end while
  it chases the pointer, and swells or narrows to fit each word, centred.
  Buttons themselves never move.
- **Inspect** ("INSPECT SPECIMEN" under the description, or I; ESC, I or a click
  on empty space to leave). The button is Osmo Supply's Button 038 (resource CSS
  kept as is at the end of `base.css`, script in `ui/Button038.ts`), themed black
  for the light page, with liquid attraction (`ui/LiquidButton.ts`): when the
  pointer comes within a few px of the pill from outside, a small tip of the same
  black (a blob merged with the pill by a goo filter) reaches out of the nearest
  point of the edge toward it, just wrapping the pointer at about 2 px, and draws
  back as it leaves. Over the button nothing deforms. It fades with the gallery
  text when the view changes. The stage
  specimen comes forward and the room deepens. Three speculative readings
  (`sheet`) are pinned to points on the surface: leader lines draw out, values
  flap in, both ride along as it turns and fade when their point turns away.
  Dragging turns it like a ball, with inertia; its own reactions pause.
- **Split-flap** everywhere text changes: the view label, SOUND — ON/OFF, the
  gallery code, card codes (they decode on hover), the cursor tag, the sheet.
  Each landing letter is a tiny, rate-limited click.
- **Phones.** Tilting the device moves the studio light (iOS asks on first touch).
- Keys: ← → specimens, I inspect, V view, ESC close.

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

A very low room tone (two breathing sine drones a fifth apart, a soft noise bed
through a drifting lowpass) fades in after the first gesture. Its filter takes a
colour per specimen on the stage. It follows the mute toggle, and the audio
context suspends while the page is hidden.

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
- Slider thumbnails refresh round robin, two per frame (~20 fps each). Each is
  drawn into a small 4× MSAA target and copied into its atlas cell (the atlas
  itself can't be multisampled: three discards the samples after each resolve).
- Micro-detail is gated by on-screen size (`uDetail`), march steps and
  octaves drop on the low tier, and off-screen specimens are hidden and skip their
  update.
- DPR follows the screen up to 2 on desktop (1.5 on the low tier): the canvas
  holds the slider's liquid edges and icons next to crisp DOM text, and below the
  native density they turned soft. Fragment cost grows with its square (at
  1512×945, 2× costs ~5–5.5 ms per frame against ~3.5–4 ms at 1.5×). It steps
  down by 0.25 (to 1 / 0.75) when frames stay under ~50 fps for about two seconds
  of drawing. Stalls over 100 ms (shader compiles, texture uploads, tab switches)
  don't count, nor do the first 4 s or the 1.5 s after the tab comes back:
  before, a few loading hitches halved the resolution for the whole visit.
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
- View switch, reworked for clarity: a segmented control on a light track. A
  black thumb sits under the current view and flows to the other one (leading
  edge first, like the slider's liquid), with white icons clipped to it. The
  label states the view ("VIEW — GRID") and previews the other one in grey on
  hover. Its word is a row of split-flap cells: each changing letter turns over
  in perspective, flashes a random glyph and lands on the new letter, in a
  cascade from the left (letters that stay, like GRID → GALLERY's G, don't move). Yellow only answers the pointer on the option you can switch to. It
  is a radio group: ←/→ move it when focused, V toggles the view anywhere.
- Two small mono controls were added in the existing type system: "SOUND — ON/OFF"
  in the header sub-row, and "SCAN SPECIMEN" under the gallery description.
