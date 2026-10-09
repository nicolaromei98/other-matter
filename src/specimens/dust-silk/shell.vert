// OM—004 DUST SILK — boundary membrane (cheap: one organic evaluation, no normal rebuild)
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vPosL;

void main() {
  vec3 n = normalize(normal);
  float d = organic(position, uIdle * 0.06, 0.9, 0.7) * 0.2;
  d += 0.05 * sin(uIdle * 0.8 - 3.2) * uMotion;
  vec3 p = position * 1.02 + n * d;
  vPosL = p;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
