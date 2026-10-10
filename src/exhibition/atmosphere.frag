// ── atmosphere ─────────────────────────────────────────────────────────
// One full-screen pass under the specimens that turns the white page into a
// space: a soft contact shadow under every specimen (a tight core and a wide
// penumbra on an implied floor), a faint vignette that opens up around the
// pointer (the same light field that turns the studio), and a fine paper grain
// refreshed a few times a second. Premultiplied output: black shades, the
// grain adds a touch of white where there is something to lighten.

uniform vec2 uRes;            // viewport, CSS px
uniform float uDpr;
uniform vec2 uPointer;        // CSS px (far away when there is none)
uniform vec4 uShadow[6];      // centre (CSS px), body radius (px), strength
uniform float uTime;
uniform float uInspect;       // 0 → 1 while inspecting: a deeper, closer room
uniform float uGrain;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;

  // contact shadows: an ellipse on the floor just under each body
  float sh = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 s = uShadow[i];
    if (s.w <= 0.001) continue;
    vec2 q = (p - vec2(s.x, s.y + s.z * 1.06)) / vec2(s.z * 0.74, s.z * 0.12);
    float d = dot(q, q);
    sh += (exp(-d * 1.6) + 0.35 * exp(-d * 0.25)) * s.w;
  }
  sh = min(sh, 1.0) * 0.22;

  // vignette, eased off around the pointer
  vec2 c = (p / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(0.42, 1.25, length(c)) * (0.05 + 0.09 * uInspect);
  float reach = min(uRes.x, uRes.y) * 0.5;
  vec2 dp = p - uPointer;
  vig *= 1.0 - 0.65 * exp(-dot(dp, dp) / (2.0 * reach * reach));

  float dark = 1.0 - (1.0 - sh) * (1.0 - vig);

  // grain
  float g = (hash(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * 37.0) - 0.5) * 0.07 * uGrain;
  gl_FragColor = vec4(vec3(max(g, 0.0)), clamp(dark + abs(g) * 0.5, 0.0, 1.0));
}
