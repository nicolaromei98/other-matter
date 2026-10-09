// ── optics ─────────────────────────────────────────────────────────────
// Two-interface refraction through a roughly spherical body (radius ≈ 1 in
// local space): refract in, find the exit on the sphere through the entry
// point, refract out (or reflect on total internal reflection). This is
// what gives clear specimens the inverted, dark-edged look of real glass.

vec3 refractThrough(vec3 pos, vec3 Vl, vec3 Nl, float ior, out vec3 exitPos) {
  vec3 rd = refract(-Vl, Nl, 1.0 / ior);
  float t = max(-2.0 * dot(pos, rd), 0.05);
  exitPos = pos + rd * t;
  vec3 nb = normalize(exitPos);
  vec3 o = refract(rd, -nb, ior);
  if (dot(o, o) < 1e-4) o = reflect(rd, -nb);
  return o;
}
