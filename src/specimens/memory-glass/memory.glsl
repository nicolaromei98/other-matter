// OM—002 MEMORY GLASS — shared by the cells and the membrane.
// The gesture memory (a ring buffer of trail points), and the shape: two
// cells caught dividing, side by side on x, in a membrane that wraps both.
// Requires specimen.glsl.

#define TRAIL_N 24

uniform vec4 uTrail[TRAIL_N];   // xyz local, w birth time
uniform float uTrailE[TRAIL_N];

// How much recent gestures press on p (0…~1), and a ring wave around them.
float memory(vec3 p, out float ripple) {
  float m = 0.0;
  ripple = 0.0;
  for (int i = 0; i < TRAIL_N; i++) {
    float e = uTrailE[i];
    if (e <= 0.0) continue;
    float age = max(uTime - uTrail[i].w, 0.0);
    vec3 d = p - uTrail[i].xyz;
    float dist = length(d);
    float fade = exp(-age * 0.4) * e;
    m += exp(-dist * dist * 22.0) * fade;
    ripple += sin(dist * 34.0 - age * 9.0) * exp(-dist * 5.0) * exp(-age * 1.6) * e;
  }
  return m;
}

// Half the distance between the two cells: they drift apart and back, slowly.
float cellGap() {
  return 0.5 + 0.018 * sin(uIdle * 0.23) * uMotion;
}

// From a point inside a sphere (centre c relative to it, radius r), the
// distance to the sphere's surface along unit direction n.
float toSphere(vec3 n, vec3 c, float r) {
  float b = dot(n, c);
  return b + sqrt(max(b * b - dot(c, c) + r * r, 0.0));
}

// Smooth maximum (log-sum-exp): joins two surfaces seen from inside with a soft fillet.
float smax(float a, float b, float k) {
  float m = max(a, b);
  return m + k * log(exp((a - m) / k) + exp((b - m) / k));
}

// Distance from the centre to the membrane along unit direction n: a soft
// figure of eight, two spheres around the cells joined at a pinched waist.
float membrane(vec3 n) {
  float g = cellGap();
  float r = 0.54;
  return smax(toSphere(n, vec3(-g, 0.0, 0.0), r), toSphere(n, vec3(g, 0.0, 0.0), r), 0.11);
}
