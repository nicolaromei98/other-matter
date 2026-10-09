// ── common ─────────────────────────────────────────────────────────────
// Shared helpers. All shading happens in linear space; toDisplay() is the
// single exit point (soft highlight shoulder + gamma), so no tone-mapping
// pass or post-processing is needed.

#define PI 3.141592653589793
#define TAU 6.283185307179586

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 sat(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 sat(vec3 x) { return clamp(x, 0.0, 1.0); }

// Author colours in sRGB, shade in linear.
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float fresnel(float cosT, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - sat(cosT), 5.0);
}

// Thin-film interference: optical path difference through a film of
// thickness d (µm, n = 1.33), evaluated at three wavelengths.
vec3 thinFilm(float cosT, float d) {
  float cosR = sqrt(max(1.0 - (1.0 - cosT * cosT) / 1.77, 0.0));
  vec3 phase = (2.0 * 1.33 * d * cosR) / vec3(0.65, 0.53, 0.45);
  return 0.5 + 0.5 * cos(TAU * phase);
}

// Exit transform: identity below 0.78, then a C1-continuous shoulder to 1.0.
vec3 toDisplay(vec3 c) {
  vec3 hi = max(c - 0.78, 0.0);
  c = c - hi + 0.22 * (1.0 - exp(-hi / 0.22));
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
