// OM—002 MEMORY GLASS — vertex
// Irregular liquid-glass body. Gestures are stored as a trail of 3D points;
// near recent points the surface is pressed in and rings out, then relaxes
// as the trail ages. Sound adds a short local ripple.

#define TRAIL_N 24

uniform vec4 uTrail[TRAIL_N];   // xyz local, w birth time
uniform float uTrailE[TRAIL_N];

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vMem;

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

vec3 deform(vec3 p, vec3 n, out float mem) {
  float t = uIdle * 0.09;
  float d = organic(p, t, 0.6, 0.7) * 0.2;
  d += snoise(p * 1.8 + vec3(0.0, t * 2.0, 0.0)) * 0.016;
  float ripple;
  mem = memory(p, ripple);
  d -= mem * 0.06;
  d += ripple * 0.006;
  float rd = length(p - uResPos);
  d += sin(rd * 30.0 - uResAge * 11.0) * exp(-rd * 3.0) * uRes * 0.016;
  return p + n * d;
}

void main() {
  vec3 n = normalize(normal);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  const float e = 0.012;
  float m0, m1, m2;
  vec3 p0 = deform(position, n, m0);
  vec3 p1 = deform(position + t * e, n, m1);
  vec3 p2 = deform(position + b * e, n, m2);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, n) < 0.0) dn = -dn;

  vMem = m0;
  vPosL = p0;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
