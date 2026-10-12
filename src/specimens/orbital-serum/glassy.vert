// OM—003 ORBITAL SERUM — instanced glass pieces (capsules, rods, atoms, bonds)
// World position and normal through the instance transform (the rods and
// bonds are scaled unevenly, so the normal uses the inverse transpose). For
// the capsules, the ray in the instance's own unit-sphere space too, so the
// fragment shader can march through their pollen.

varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vLocal;          // vertex in the instance's own space (unit sphere for capsules and atoms)
varying vec3 vRayL;           // camera → vertex, in that space
varying float vId;

void main() {
#ifdef USE_INSTANCING
  mat4 inst = instanceMatrix;
#else
  mat4 inst = mat4(1.0);
#endif
  mat4 m = modelMatrix * inst;
  vec4 world = m * vec4(position, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(transpose(inverse(mat3(m))) * normal);
  vLocal = position;
  vec3 camL = (inverse(m) * vec4(cameraPosition, 1.0)).xyz;
  vRayL = position - camL;
  vId = float(gl_InstanceID);
  gl_Position = projectionMatrix * viewMatrix * world;
}
