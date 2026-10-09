// ── organic ────────────────────────────────────────────────────────────
// Domain-warped scalar field for organic silhouettes and a curl-noise
// velocity field for particles. Requires noise.glsl.

float organic(vec3 p, float t, float freq, float warp) {
  vec3 q = p * freq;
  vec3 w = vec3(
    snoise(q + vec3(0.0, 0.0, t)),
    snoise(q + vec3(5.2, 1.3, -t)),
    snoise(q + vec3(-3.1, 7.7, t * 0.7))
  );
  return snoise(q * 0.85 + w * warp + vec3(t * 0.3, 0.0, 0.0));
}

vec3 noise3(vec3 p) {
  return vec3(snoise(p), snoise(p + vec3(31.4, 17.1, 5.9)), snoise(p + vec3(-12.3, 44.7, 9.2)));
}

// Divergence-free flow (curl of a noise potential), central differences.
vec3 curlNoise(vec3 p) {
  const float e = 0.12;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 x0 = noise3(p - dx), x1 = noise3(p + dx);
  vec3 y0 = noise3(p - dy), y1 = noise3(p + dy);
  vec3 z0 = noise3(p - dz), z1 = noise3(p + dz);
  float cx = (y1.z - y0.z) - (z1.y - z0.y);
  float cy = (z1.x - z0.x) - (x1.z - x0.z);
  float cz = (x1.y - x0.y) - (y1.x - y0.x);
  return vec3(cx, cy, cz) / (2.0 * e);
}
