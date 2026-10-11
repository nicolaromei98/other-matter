// OM—002 MEMORY GLASS — the two cells (vertex)
// Each cell is a cluster of lobes around its centre (on x, ±cellGap()): from
// the centre, the surface is the smooth maximum of the distances to a core and
// eight lobe spheres of uneven size, so lobes meet in soft creases (vCrease).
// The lobes breathe out of step. Gestures dent the cells where they touched; the dents
// fill back in as the trail ages. Requires memory.glsl.

attribute float aCell;            // −1: the cyan cell, +1: the teal one

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vCellL;              // position from the cell's centre (texture space)
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vCrease;
varying float vCell;
varying float vMem;

const float K = 0.034;            // softness of the creases

// Distance from the cell centre to its surface along unit n; crease: 0 on a lobe, 1 where two meet.
float cellRadius(vec3 n, out float crease) {
  float t = uIdle;
  float d[9];
  d[0] = 0.27;
  float m = d[0];
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    // eight lobes on a golden spiral, nudged and sized unevenly, a different set per cell
    vec3 h = hash33(vec3(fi, aCell * 7.0, 3.0)) - 0.5;
    float y = 1.0 - (fi + 0.5) / 8.0 * 2.0 + h.x * 0.35;
    float rr = sqrt(max(1.0 - y * y, 0.0));
    float phi = fi * 2.39996 + aCell * 1.1 + h.y * 0.9;
    vec3 dir = normalize(vec3(cos(phi) * rr, y, sin(phi) * rr));
    float r = 0.205 + h.z * 0.05 + 0.014 * sin(t * 0.37 + fi * 1.9 + aCell) * uMotion;
    d[i + 1] = toSphere(n, dir * (0.235 + h.x * 0.04), r);
    m = max(m, d[i + 1]);
  }
  float s = 0.0;
  for (int i = 0; i < 9; i++) s += exp((d[i] - m) / K);
  crease = sat(log(s) / 0.693 - 0.15);
  return m + K * log(s);
}

vec3 surface(vec3 n, vec3 c, out float crease, out float mem) {
  float r = cellRadius(n, crease);
  vec3 p = c + n * r;
  float ripple;
  mem = memory(p, ripple);
  r -= mem * 0.055;
  r += ripple * 0.003;
  float rd = length(p - uResPos);
  r += sin(rd * 28.0 - uResAge * 10.0) * exp(-rd * 3.0) * uRes * 0.01;
  return c + n * r;
}

void main() {
  vec3 c = vec3(aCell * cellGap(), 0.0, 0.0);
  vec3 n = normalize(position);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  const float e = 0.012;
  float c0, c1, c2, m0, m1, m2;
  vec3 p0 = surface(n, c, c0, m0);
  vec3 p1 = surface(normalize(n + t * e), c, c1, m1);
  vec3 p2 = surface(normalize(n + b * e), c, c2, m2);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, p0 - c) < 0.0) dn = -dn;

  vCrease = c0;
  vCell = aCell;
  vMem = m0;
  vPosL = p0;
  vCellL = p0 - c;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
