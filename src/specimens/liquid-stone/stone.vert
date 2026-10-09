// OM—005 LIQUID STONE — vertex
// A dense organic mass whose shell barely moves: a very slow domain-warped
// drift, a heavy viscous give under pressure, and a faint tectonic pulse
// when its low voice sounds.

uniform vec3 uPressL;
uniform float uPressAmt;

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;

vec3 deform(vec3 p, vec3 n) {
  float t = uIdle * 0.025;
  float d = organic(p, t, 0.55, 0.55) * 0.13;
  d += snoise(p * 1.2 + vec3(t)) * 0.012;
  vec3 dp = p - uPressL;
  d -= exp(-dot(dp, dp) * 3.2) * uPressAmt * 0.05;
  d += resWave(p, 0.9, 5.0) * 0.02;
  return p + n * d;
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

  vPosL = position;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
