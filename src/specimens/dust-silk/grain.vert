// OM—004 DUST SILK — grains
// The grains keep the crumpled sheets they were placed on; the whole mass
// breathes and drifts in a slow field, neighbours together. The cursor pushes
// a local hollow into it; a tap disperses everything and the spring brings it
// back. Sound compresses it in a wave. Depth of field: grains away from the
// focal plane grow into soft discs (the fragment shader draws them).

attribute vec3 aNormal;          // the sheet's normal where the grain sits
attribute vec4 aSeed;            // xyz: dispersal direction, w: size jitter
attribute vec2 aInfo;            // x: cavity (0 on a crest … 1 deep in a fold), y: kind (0 grain, 1 turquoise, 2 dust)

uniform float uDisperse;
uniform float uPointScale;       // px per unit size at the current on-screen radius
uniform float uDensity;          // > 1 when the LOD draws only part of the grains

varying vec3 vColor;
varying float vGlow;
varying float vBlur;
varying float vSize;
varying float vAlpha;

void main() {
  vec3 p = position;
  float t = uIdle * 0.1;
  float r0 = length(p);
  vec3 dir0 = p / max(r0, 1e-3);

  // slow organic breathing of the whole mass (the folds keep their shape)
  p *= 1.0 + organic(dir0, t * 0.6, 0.9, 0.7) * 0.12;
  p *= 1.0 + 0.035 * sin(uIdle * 0.8 - r0 * 3.2) * uMotion;

  // drift: a smooth field, so neighbouring grains move together
  vec3 drift = noise3(p * 1.3 + vec3(0.0, t, t * 0.5));
  p += drift * 0.028;

  // cursor force field: a hollow opens where it passes
  vec3 dp = p - uPointerL;
  float fd = exp(-dot(dp, dp) * 6.0) * uHover * (0.16 + 0.3 * uPress);
  p += normalize(dp + vec3(1e-4)) * fd;

  // dispersion and reconstruction
  vec3 dir = normalize(aSeed.xyz * 2.0 - 1.0 + drift * 0.8);
  p += dir * uDisperse * (0.3 + aSeed.w * 0.9);

  // sound: a compression wave
  float wave = resWave(p, 1.5, 7.0);
  p -= normalize(p - uResPos + vec3(1e-4)) * wave * 0.08;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float unit = max(length(modelMatrix[0].xyz), 1.0);
  vec3 rel = (mv.xyz - centre.xyz) / unit;      // view space, in specimen radii (+z toward the camera)

  // depth of field: sharp a little in front of the centre, soft at the front-most
  // grains and through the tears at the back; milder when it is small on screen
  float blur = smoothstep(0.28, 0.78, abs(rel.z - 0.25)) * mix(0.35, 1.0, uDetail);
  float kind = aInfo.y;
  float dust = step(1.5, kind);
  if (dust > 0.5) blur = max(blur, 0.55);
  blur = min(1.0, blur + uDisperse * 0.25);
  vBlur = blur;

  float size = mix(1.45, 2.05, aSeed.w) * mix(1.0, 0.6, dust) * mix(1.0, 1.15, step(0.5, kind) * (1.0 - dust)) * uDensity;
  size *= 1.0 + smoothstep(0.3, 1.0, blur) * 2.2;          // bokeh: the disc opens up
  float scan = scanReveal(p.y) + scanLine(p.y) * 2.0;
  size *= 1.0 + scan * 0.6 + wave * 1.2;
  float persp = length(cameraPosition) / max(-mv.z, 1.0);
  gl_PointSize = max(1.0, size * uPointScale * persp);
  vSize = gl_PointSize;

  // light: the folds are lit like a surface (the sheet's normal against the key
  // light, top front-left), the valleys between them sit in shadow
  float cav = aInfo.x;
  float glow = step(0.5, kind) * (1.0 - dust);
  vec3 N = normalize(normalMatrix * aNormal);
  vec3 L = normalize(vec3(-0.35, 0.8, 0.5));
  float lit = smoothstep(-0.45, 0.8, dot(N, L));
  lit *= mix(1.0, 0.45, smoothstep(0.2, 0.85, cav));
  lit *= mix(0.55, 1.0, smoothstep(-0.6, 0.3, N.z));             // folds turned away read darker
  lit *= mix(0.7, 1.0, smoothstep(-0.8, 0.5, dot(normalize(rel + vec3(1e-4)), L)));   // the mass's own shadow side

  vec3 white = srgb(vec3(0.96, 0.97, 0.98));
  vec3 slate = srgb(vec3(0.17, 0.22, 0.27));
  vec3 col = mix(slate, white, lit) * mix(1.0, 0.88, aSeed.y);
  // turquoise: deep teal in shadow, bright aqua where lit
  vec3 teal = srgb(vec3(0.02, 0.42, 0.46));
  vec3 turq = srgb(vec3(0.2, 0.9, 0.82));
  vec3 aqua = srgb(vec3(0.55, 0.98, 0.95));
  vec3 tq = mix(teal, turq, smoothstep(0.0, 0.7, lit + aSeed.y * 0.25));
  tq = mix(tq, aqua, smoothstep(0.75, 1.0, lit) * 0.6);
  col = mix(col, tq, glow);
  vGlow = glow * (0.15 + 0.3 * aSeed.z);
  col = mix(col, srgb(vec3(0.62, 0.95, 1.0)), sat(scan) * 0.5);
  vColor = col;

  vAlpha = mix(1.0, 0.75, dust) * (1.0 - smoothstep(0.6, 1.2, uDisperse) * 0.4);

  gl_Position = projectionMatrix * mv;
}
