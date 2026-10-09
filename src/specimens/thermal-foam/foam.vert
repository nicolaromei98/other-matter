// OM—003 THERMAL FOAM — vertex
// Inflated liquid-crystalline volume. Heat from the cursor is a ring buffer
// of diffusing Gaussians (variance grows with age, peak falls), evaluated
// per vertex: warm regions swell and lose surface tension (their creases
// relax). Sound sends a heat wave through the volume.

#define HEAT_N 32

uniform vec4 uHeat[HEAT_N];    // xyz local, w birth time
uniform float uHeatE[HEAT_N];

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vHeat;

float heatAt(vec3 p) {
  float h = 0.0;
  for (int i = 0; i < HEAT_N; i++) {
    float e = uHeatE[i];
    if (e <= 0.0) continue;
    float age = max(uTime - uHeat[i].w, 0.0);
    float s2 = 0.02 + age * 0.03;
    vec3 d = p - uHeat[i].xyz;
    h += e * (0.02 / s2) * exp(-dot(d, d) / (2.0 * s2)) * exp(-age * 0.22);
  }
  h += resWave(p, 1.4, 6.0) * 0.7 + uRes * 0.15;
  return h;
}

vec3 deform(vec3 p, vec3 n, out float heat) {
  heat = heatAt(p);
  float hs = 1.0 - exp(-heat * 1.4);
  float t = uIdle * 0.08;
  float d = organic(p, t, 0.7, 0.7) * 0.15;
  // liquid-crystal creases; heat lowers surface tension and relaxes them
  float crease = 1.0 - abs(snoise(p * 1.3 + vec3(t * 0.6, 0.0, -t * 0.4)));
  d -= crease * crease * crease * 0.035 * (1.0 - hs * 0.8);
  // microscopic reorganisation
  d += snoise(p * 7.0 + vec3(uIdle * 0.25)) * 0.006 * uDetail;
  d += hs * 0.085;
  return p + n * d;
}

void main() {
  vec3 n = normalize(normal);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  const float e = 0.012;
  float h0, h1, h2;
  vec3 p0 = deform(position, n, h0);
  vec3 p1 = deform(position + t * e, n, h1);
  vec3 p2 = deform(position + b * e, n, h2);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, n) < 0.0) dn = -dn;

  vHeat = 1.0 - exp(-h0 * 1.4);
  vPosL = p0;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
