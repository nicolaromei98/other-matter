// ── surface transmutation ──────────────────────────────────────────────
// The outgoing specimen (A) turns into the incoming one (B) across a moving
// front. Both are rendered live, each into its own copy of the stage square,
// and composited here. The front is a tilted plane cutting an implied sphere,
// so the seam curves around the form, roughened by a slow domain-warped noise.
// Along it: a crisp, antialiased change of material, a lens-like bend of both
// with a touch of dispersion, a thin iridescent line and, just behind it, the
// new material briefly brighter, as if still warm. A darkens slightly just
// ahead, as if being consumed. Where the two silhouettes differ, the outline
// changes over a wider, soft band, and whatever of the old form sticks out of
// the new one melts away over the second half, so no island is ever left
// floating.
// Requires common.glsl and noise.glsl.

uniform sampler2D tA;         // outgoing specimen, premultiplied
uniform sampler2D tB;         // incoming specimen, premultiplied
uniform float uP;             // progress 0 → 1 (eased)
uniform float uTime;
uniform vec2 uDir;            // side the new material enters from (unit, y up)
uniform float uDetail;        // 1: extra noise octave (high tier)

varying vec2 vUv;

const float PAD = 1.25;       // quad half-size in stage radii

float front(vec2 p) {
  float z = sqrt(max(0.0, 1.0 - dot(p, p)));
  vec3 n = normalize(vec3(uDir * 0.85, 0.55));
  float g = dot(vec3(p, z), n);
  vec3 q = vec3(p * 1.4, uTime * 0.08);
  vec2 w = vec2(snoise(q), snoise(q + vec3(5.2, 1.3, 2.7)));
  float r = snoise(vec3(p * 2.0 + w * 0.55, uTime * 0.11 + 3.0));
  r += uDetail * 0.35 * snoise(vec3(p * 5.5 + w, uTime * 0.17 + 7.0));
  return g + r * 0.2;
}

// Sample with a small offset, red and blue spread a little further apart.
vec4 bent(sampler2D t, vec2 uv, vec2 o) {
  vec4 c = texture2D(t, uv + o);
  c.r = texture2D(t, uv + o * 0.8).r;
  c.b = texture2D(t, uv + o * 1.25).b;
  return c;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0 * PAD;
  float f = front(p);
  // the front's travel spans what is visible of the form (plus the noise), no dead time at either end
  float d = f - mix(1.32, -0.8, uP);           // > 0: already the new material

  vec2 grad = vec2(dFdx(f), dFdy(f));
  float perPx = length(grad);
  vec2 nrm = grad / max(perPx, 1e-6);           // towards the new material
  float aa = max(perPx * 0.9, 0.004);
  // both ends match the live specimens exactly: the seam's light fades in at the
  // start, and in the last stretch whatever the front has not reached yet fades
  // out with it
  float head = smoothstep(0.0, 0.15, uP);
  float tail = smoothstep(0.8, 1.0, uP);
  float swept = smoothstep(-aa, aa, d);
  float m = max(swept, tail);

  float lit = head * (1.0 - tail);
  float band = exp(-(d * d) / (0.07 * 0.07)) * lit;
  float core = exp(-(d * d) / pow(aa * 2.5 + 0.006, 2.0)) * lit;

  // lens along the seam: both sides lean towards it, with a little dispersion
  vec4 a;
  vec4 b;
  if (band > 0.01) {
    vec2 o = nrm * band * (0.03 / (2.0 * PAD));
    a = bent(tA, vUv, -o);
    b = bent(tB, vUv, o);
  } else {
    a = texture2D(tA, vUv);
    b = texture2D(tB, vUv);
  }

  // material: crisp change; outline: soft band (premultiplied in, premultiplied out)
  vec3 ua = a.rgb / max(a.a, 0.001);
  vec3 ub = b.rgb / max(b.a, 0.001);
  vec3 c = mix(a.a > 0.004 ? ua : ub, b.a > 0.004 ? ub : ua, m);
  float aOut = a.a * (1.0 - b.a);                     // old form outside the new one
  // it melts as the front approaches (well ahead of it) and, at the latest, over the second half
  float aKeep = a.a - aOut * max(smoothstep(-0.3, 0.0, d), smoothstep(0.35, 0.8, uP));
  float alpha = mix(aKeep, b.a, max(smoothstep(-0.07, 0.07, d), tail));
  vec4 col = vec4(c * alpha, alpha);

  // ahead of the seam the old material darkens a touch, behind it the new one glows
  float ahead = exp(-pow((d + 0.05) / 0.05, 2.0)) * (1.0 - m) * lit;
  col.rgb *= 1.0 - 0.2 * ahead;
  float warm = exp(-max(d, 0.0) / 0.2) * swept * (1.0 - tail);
  col.rgb += (col.rgb * 0.18 + col.a * 0.07) * warm;

  // the seam itself: a fine bright line with an iridescent halo
  vec3 film = thinFilm(sat(0.55 + d * 5.0), 0.42 + 0.22 * sin(uTime * 0.6 + p.x * 2.5 + p.y * 1.7));
  col.rgb += (vec3(0.9) * core * 0.5 + film * band * 0.16) * alpha;

  // premultiplied output: colour can't exceed coverage (the page behind is white anyway)
  gl_FragColor = vec4(min(col.rgb, vec3(col.a)), col.a);
}
