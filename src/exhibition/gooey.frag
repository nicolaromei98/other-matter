// ── liquid slider ──────────────────────────────────────────────────────
// One signed distance field for the whole slider: six beads and two droplets
// (tapered capsules from tail to head), joined with a smooth minimum so they
// read as one black liquid that necks, bridges and pinches off as things move.
// Each bead holds a porthole (a pale disc with the live thumbnail); each
// droplet carries a dot and an arrow pointing away from its bead. A thin sheen along the upper edges gives
// the liquid some volume.
// Requires common.glsl.

uniform sampler2D tAtlas;   // six thumbnails side by side (premultiplied)
uniform vec4 uBead[6];      // centre (px from the quad centre, y up), radius, swell (0 small → 1 active)
uniform vec3 uHead[2];      // droplet heads ("next", "previous"): centre, radius
uniform vec3 uTail[2];      // droplet tails: centre, radius
uniform float uK;           // smooth-union radius, px
uniform float uIcon[2];     // dot + arrow opacity per droplet
uniform float uVis;

varying vec2 vP;            // px from the quad centre, y up

const float RING = 0.13;    // black ring around each porthole, fraction of the bead radius
const float THUMB = 0.8;    // specimen radius, fraction of the porthole radius

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Tapered capsule from a (radius ra) to b (radius rb), exact distance. Unlike a
// smooth union of two circles it does not swell when the ends coincide.
float sdTaper(vec2 p, vec2 a, float ra, vec2 b, float rb) {
  vec2 ab = b - a;
  float h = length(ab);
  if (h < abs(ra - rb) + 1e-3) return min(length(p - a) - ra, length(p - b) - rb);
  vec2 dir = ab / h;
  vec2 q = vec2(abs(dot(p - a, vec2(-dir.y, dir.x))), dot(p - a, dir));
  float s = (ra - rb) / h;
  float c = sqrt(1.0 - s * s);
  float k = dot(q, vec2(-s, c));
  if (k < 0.0) return length(q) - ra;
  if (k > c * h) return length(q - vec2(0.0, h)) - rb;
  return dot(q, vec2(c, s)) - ra;
}

float field(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < 6; i++) d = smin(d, length(p - uBead[i].xy) - uBead[i].z, uK);
  for (int i = 0; i < 2; i++) {
    if (uHead[i].z < 0.05 && uTail[i].z < 0.05) continue;
    d = smin(d, sdTaper(p, uTail[i].xy, uTail[i].z, uHead[i].xy, uHead[i].z), uK);
  }
  return d;
}

// Dot by the bead, arrow pointing away from it (side +1 → right, -1 → left).
float icon(vec2 p, vec3 head, float side) {
  vec2 q = (p - head.xy) / head.z;
  q.x *= side;
  float w = max(0.075, 0.6 / head.z);                     // stroke half-width, at least ~0.6px
  float dot_ = length(q - vec2(-0.4, 0.0)) - 0.13;
  float shaft = sdSeg(q, vec2(-0.08, 0.0), vec2(0.5, 0.0)) - w;
  float tip = min(sdSeg(q, vec2(0.5, 0.0), vec2(0.27, 0.23)), sdSeg(q, vec2(0.5, 0.0), vec2(0.27, -0.23))) - w;
  return min(dot_, min(shaft, tip)) * head.z;             // back to px
}

void main() {
  vec2 p = vP;
  float d = field(p);
  float aa = max(fwidth(d), 1e-3) * 0.7;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.001) discard;

  // the liquid: near-black, with a thin sheen along its upper edges
  vec2 g = vec2(field(p + vec2(0.5, 0.0)) - field(p - vec2(0.5, 0.0)), field(p + vec2(0.0, 0.5)) - field(p - vec2(0.0, 0.5)));
  g /= max(length(g), 1e-5);
  float rim = exp(-pow((d + 1.6) / 1.3, 2.0));
  float top = sat(dot(g, normalize(vec2(-0.35, 1.0))));
  vec3 col = vec3(0.03);
  col += rim * top * top * 0.22;
  col += exp(d / 3.5) * 0.035;                            // faint lift towards the edge

  // portholes with the live thumbnails
  for (int i = 0; i < 6; i++) {
    vec4 b = uBead[i];
    float ri = b.z * (1.0 - RING);
    vec2 o = p - b.xy;
    float di = length(o) - ri;
    float m = 1.0 - smoothstep(-aa, aa, di);
    if (m <= 0.0) continue;
    vec3 c = mix(vec3(0.86, 0.86, 0.85), vec3(0.955, 0.955, 0.948), b.w);
    // the ring shades the porthole a little, mostly from above
    c *= 1.0 - 0.22 * exp(di / (ri * 0.16)) * (0.55 + 0.45 * sat(o.y / ri));
    vec2 q = o / (ri * THUMB * 1.15);
    if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
      vec4 t = texture2D(tAtlas, vec2((float(i) + q.x * 0.5 + 0.5) / 6.0, q.y * 0.5 + 0.5));
      c = mix(c, t.rgb / max(t.a, 0.001), t.a);
    }
    col = mix(col, c, m);
  }

  // the droplets' dots and arrows
  for (int i = 0; i < 2; i++) {
    if (uIcon[i] < 0.01 || uHead[i].z < 1.0) continue;
    float di = icon(p, uHead[i], i == 0 ? 1.0 : -1.0);
    col = mix(col, vec3(1.0), (1.0 - smoothstep(-aa, aa, di)) * uIcon[i]);
  }

  gl_FragColor = vec4(col, inside * uVis);
}
