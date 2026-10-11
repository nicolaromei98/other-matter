// OM—002 MEMORY GLASS — the membrane (vertex)
// A soft figure of eight of clear liquid glass around the two cells. Near
// recent gesture points it is pressed in and rings out, then relaxes as the
// trail ages. Sound adds a short local ripple. Requires memory.glsl.

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying float vMem;

vec3 deform(vec3 q, out float mem) {
  vec3 n = normalize(q);
  float t = uIdle * 0.09;
  float r = membrane(n);
  r *= 1.0 + organic(n, t, 0.7, 0.6) * 0.025;
  float ripple;
  vec3 p = n * r;
  mem = memory(p, ripple);
  r -= mem * 0.05;
  r += ripple * 0.005;
  float rd = length(p - uResPos);
  r += sin(rd * 30.0 - uResAge * 11.0) * exp(-rd * 3.0) * uRes * 0.014;
  return n * r;
}

void main() {
  vec3 n = normalize(position);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  const float e = 0.01;
  float m0, m1, m2;
  vec3 p0 = deform(n, m0);
  vec3 p1 = deform(n + t * e, m1);
  vec3 p2 = deform(n + b * e, m2);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, p0) < 0.0) dn = -dn;

  vMem = m0;
  vPosL = p0;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
