// ── particle transition: dissolve / condense ──────────────────────────
// Two point sets share this shader: role 0 is the outgoing specimen (it comes
// apart into dust that spreads out softly around it), role 1 the incoming one
// (the same motion backwards: dust gathers into it). Each particle samples its
// colour from the real capture of its specimen; regions start at different
// moments (noise). As a particle disperses it drifts a short way outward with a
// slight swirl and lift, becomes finer and fades on its own schedule, so the
// specimen thins into a light veil of dust instead of bursting.

attribute vec2 aRef;

uniform sampler2D tCorr;      // xy: outgoing texel, zw: incoming texel
uniform sampler2D tCol;       // capture of this role's specimen (premultiplied)
uniform float uRole;
uniform float uP;
uniform float uStageR;
uniform float uCamDist;
uniform float uSize;          // px (device) that tiles the silhouette
uniform float uSpread;        // fraction of the radius
uniform float uLift;          // fraction of the radius
uniform float uSwirl;         // radians
uniform float uDust;          // size once dispersed, relative to the resting size
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

void main() {
  vec4 corr = texture2D(tCorr, aRef);
  vec2 uv = uRole < 0.5 ? corr.xy : corr.zw;
  vec4 c = texture2D(tCol, uv);
  c.rgb /= max(c.a, 0.001);
  vec3 base = stagePos(uv);

  vec4 rnd = hash4(aRef * 512.0 + uRole * 17.0);
  vec4 rnd2 = hash4(aRef * 731.0 + 5.3 + uRole * 11.0);
  float n = snoise(vec3(base.xy / uStageR * 1.8, uRole * 3.1)) * 0.5 + 0.5;
  float o = uStagger * (0.75 * n + 0.25 * rnd.x);

  // k: 0 = part of the specimen, 1 = dispersed into air
  // the two sets overlap, so there is never an empty stage
  float k = uRole < 0.5
    ? smoothstep(0.02 + o, 0.58 + o, uP)
    : 1.0 - smoothstep(0.2 + o, 0.68 + o, uP);

  // outward from the centre, turned by a slight swirl; most stay near, some drift a little further
  vec2 radial = base.xy / uStageR;
  float rl = length(radial);
  vec2 dir = rl > 1e-3 ? radial / rl : normalize(rnd2.xy - 0.5 + 1e-3);
  float ang = (rnd2.z - 0.5) * 0.9 + (n - 0.5) * 2.0 * uSwirl;
  float ca = cos(ang);
  float sa = sin(ang);
  dir = vec2(ca * dir.x - sa * dir.y, sa * dir.x + ca * dir.y);
  float far = rnd.z * rnd.z;
  float reach = uSpread * uStageR * (0.15 + 0.85 * far) * (0.6 + 0.4 * rl);
  vec3 drift = vec3(dir * reach, (rnd.w - 0.3) * uDepth);
  drift.y += uLift * uStageR * (0.4 + rnd2.w);
  // a faint meander while airborne
  drift.xy += vec2(sin(uP * 4.0 + rnd2.x * 6.283), cos(uP * 3.0 + rnd2.y * 6.283)) * uStageR * 0.012;
  vec3 pos = base + drift * k;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float size = uSize * mix(1.0, uDust, k) * (0.8 + 0.4 * rnd.w);
  gl_PointSize = max(0.5, size * uCamDist / max(-mv.z, 1.0));

  // thin out gradually, each particle on its own schedule
  float life = mix(0.5, 1.0, rnd.y);
  float fade = 1.0 - smoothstep(life * 0.25, life, k);
  vColor = vec4(c.rgb, c.a * fade * (1.0 - 0.3 * k));
  vK = k;
  gl_Position = projectionMatrix * mv;
}
