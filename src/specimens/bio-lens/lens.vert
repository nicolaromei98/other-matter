// OM—006 BIO LENS — vertex
// Irregular round hydrogel body with slow liquid folds travelling across it.
// The front pinches around the optical axis when the iris contracts.

uniform float uIris;

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;

vec3 deform(vec3 p, vec3 n) {
  float t = uIdle * 0.07;
  float d = organic(p, t, 0.65, 0.5) * 0.075;
  d += sin(dot(p, vec3(0.6, 0.8, 0.0)) * 6.0 - uIdle * 1.1) * 0.009 * uMotion;
  d += sin(dot(p, vec3(-0.7, 0.2, 0.69)) * 8.0 - uIdle * 0.8) * 0.006 * uMotion;
  d -= uIris * 0.05 * smoothstep(0.2, 0.9, p.z) * (1.0 - smoothstep(0.0, 0.65, length(p.xy)));
  d += resWave(p, 1.6, 9.0) * 0.03;
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

  vPosL = p0;
  vNormalL = dn;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * world;
}
