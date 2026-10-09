// ── cellular ───────────────────────────────────────────────────────────
// 3D Worley noise returning F1/F2 and the offset vectors to both nearest
// feature points, which gives an analytic gradient for bump mapping:
//   ∇F1 = -d1 / F1,  ∇F2 = -d2 / F2   (d = feature - p)
// Requires common.glsl (hash33, TAU).

struct Cell {
  float f1;
  float f2;
  vec3 d1;
  vec3 d2;
  vec3 id;
};

Cell worley(vec3 p, float jitter, float t) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  Cell c;
  c.f1 = 8.0; c.f2 = 8.0;
  c.d1 = vec3(0.0); c.d2 = vec3(0.0); c.id = vec3(0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = hash33(ip + o);
    vec3 f = o + 0.5 + jitter * 0.5 * sin(t + TAU * h);
    vec3 d = f - fp;
    float dd = dot(d, d);
    if (dd < c.f1) {
      c.f2 = c.f1; c.d2 = c.d1;
      c.f1 = dd; c.d1 = d; c.id = ip + o;
    } else if (dd < c.f2) {
      c.f2 = dd; c.d2 = d;
    }
  }
  c.f1 = sqrt(c.f1);
  c.f2 = sqrt(c.f2);
  return c;
}
