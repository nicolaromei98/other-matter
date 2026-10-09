// ── particle transition: one cloud, two specimens ─────────────────────
// A single set of particles carries the change. Each particle has a texel on
// the outgoing specimen and one on the incoming one (matched along a Hilbert
// curve, so neighbours stay neighbours). It starts as part of the outgoing
// specimen, with its colour; mid-way it loosens into fine dust (a short drift
// with a slight swirl and lift, smaller and a little fainter) while it glides
// to its texel on the incoming specimen and takes on that colour; then it
// settles into place on a long ease-out, slowing down instead of stopping.
// Regions move at different moments (noise), so the change ripples through the
// form instead of happening all at once.

attribute vec2 aRef;

uniform sampler2D tCorr;      // xy: outgoing texel, zw: incoming texel
uniform sampler2D tColA;      // capture of the outgoing specimen (premultiplied)
uniform sampler2D tColB;      // capture of the incoming specimen (premultiplied)
uniform float uP;
uniform float uStageR;
uniform float uCamDist;
uniform float uSizeA;         // px (device) that tiles each silhouette
uniform float uSizeB;
uniform float uSpread;        // fraction of the radius
uniform float uLift;          // fraction of the radius
uniform float uSwirl;         // radians
uniform float uDust;          // size while loosened, relative to the resting size
uniform float uDepth;
uniform float uStagger;

varying vec4 vColor;
varying float vK;

vec4 hash4(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Captured texel → 3D point that projects exactly onto that pixel.
vec3 stagePos(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0 * uStageR;
  float d = length(p) / uStageR;
  float z = sqrt(max(0.0, 1.0 - d * d)) * uStageR * 0.35;
  p *= (uCamDist - z) / uCamDist;
  return vec3(p, z);
}

// Soft start, long slow arrival: zero velocity at both ends, most of the
// deceleration spread over the second half.
float settle(float t) {
  t = clamp(t, 0.0, 1.0);
  float s = 1.0 - pow(t, 1.6);
  return 1.0 - s * s * s;
}

vec4 colourAt(sampler2D t, vec2 uv) {
  vec4 c = texture2D(t, uv);
  c.rgb /= max(c.a, 0.001);
  return c;
}

void main() {
  vec4 corr = texture2D(tCorr, aRef);
  vec4 ca = colourAt(tColA, corr.xy);
  vec4 cb = colourAt(tColB, corr.zw);
  vec3 pa = stagePos(corr.xy);
  vec3 pb = stagePos(corr.zw);

  vec4 rnd = hash4(aRef * 512.0);
  vec4 rnd2 = hash4(aRef * 731.0 + 5.3);
  float n = snoise(vec3(pa.xy / uStageR * 1.8, 0.0)) * 0.5 + 0.5;
  float o = uStagger * (0.75 * n + 0.25 * rnd.x);

  // m: 0 = outgoing shape and colour, 1 = incoming
  // k: how loose the particle is, 0 in either specimen, highest mid-way
  float m = settle((uP - 0.04 - o) / 0.82);
  float k = smoothstep(0.0 + o, 0.32 + o, uP) * (1.0 - settle((uP - 0.3 - o) / 0.66));

  vec3 base = mix(pa, pb, m);

  // loosening: outward from the centre, turned by a slight swirl; most stay near
  vec2 radial = base.xy / uStageR;
  float rl = length(radial);
  vec2 dir = rl > 1e-3 ? radial / rl : normalize(rnd2.xy - 0.5 + 1e-3);
  float ang = (rnd2.z - 0.5) * 0.9 + (n - 0.5) * 2.0 * uSwirl;
  float cs = cos(ang);
  float sn = sin(ang);
  dir = vec2(cs * dir.x - sn * dir.y, sn * dir.x + cs * dir.y);
  float reach = uSpread * uStageR * (0.15 + 0.85 * rnd.z * rnd.z) * (0.6 + 0.4 * rl);
  vec3 drift = vec3(dir * reach, (rnd.w - 0.3) * uDepth);
  drift.y += uLift * uStageR * (0.4 + rnd2.w);
  drift.xy += vec2(sin(uP * 4.0 + rnd2.x * 6.283), cos(uP * 3.0 + rnd2.y * 6.283)) * uStageR * 0.012;
  vec3 pos = base + drift * k;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float size = mix(uSizeA, uSizeB, m) * mix(1.0, uDust, k) * (0.8 + 0.4 * rnd.w);
  gl_PointSize = max(0.5, size * uCamDist / max(-mv.z, 1.0));

  // the cloud thins a little while loose, but every particle stays: one continuous change
  vec4 col = mix(ca, cb, m);
  vColor = vec4(col.rgb, col.a * (1.0 - k * (0.1 + 0.25 * rnd.y)));
  vK = k;
  gl_Position = projectionMatrix * mv;
}
