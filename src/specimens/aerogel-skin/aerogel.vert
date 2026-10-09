// OM—001 AEROGEL SKIN — vertex
// A slightly unstable inflated membrane: domain-warped lobes, a slow breath,
// a pressure dent under the cursor with the displaced volume bulging around
// it, drag stretch with volume preservation, and a pressure shell when its
// sound plays. Normals are rebuilt from two neighbouring deformations.

uniform vec3 uStretch;

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vShell;

vec3 deform(vec3 p, vec3 n) {
  float t = uIdle * 0.11;
  float d = organic(p, t, 0.72, 0.55) * 0.16;
  d += snoise(p * 1.9 + vec3(t * 1.7)) * 0.014;
  d += (sin(uIdle * 0.55) * 0.5 + 0.5) * 0.025 * uMotion;

  vec3 dp = p - uPointerL;
  float dd = dot(dp, dp);
  float pressure = uHover * (0.55 + 0.7 * uPress);
  d -= exp(-dd * 5.0) * 0.12 * pressure;
  d += exp(-pow(sqrt(dd) - 0.62, 2.0) * 14.0) * 0.028 * pressure;

  d += resWave(p, 1.7, 8.0) * 0.06 + uRes * 0.03;

  vec3 q = p + n * d;
  float sl = length(uStretch);
  vec3 sd = uStretch / max(sl, 1e-4);
  q += uStretch * smoothstep(-0.4, 1.0, dot(p, sd)) * 0.8;
  q -= (q - sd * dot(q, sd)) * sl * 0.15;
  return q;
}

void main() {
  vec3 n = normalize(normal);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  const float e = 0.012;
  vec3 p0 = deform(position, n);
  vec3 p1 = deform(position + t * e, n);
  vec3 p2 = deform(position + b * e, n);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, n) < 0.0) dn = -dn;

  vShell = resWave(position, 1.7, 8.0);
  vPosL = p0;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
