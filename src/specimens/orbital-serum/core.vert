// OM—003 ORBITAL SERUM — the core (both passes)
// The core sphere is built at its real radius in the body's space. vDisc is
// the point's offset from the core's centre on screen, in core radii (y up):
// the liquid's gradient and its rays of light are laid out on it.

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec2 vDisc;

void main() {
  vPosL = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec3 centre = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 here = (modelViewMatrix * vec4(position, 1.0)).xyz;
  float radius = length(modelMatrix[0].xyz) * length(position);
  vDisc = (here.xy - centre.xy) / max(radius, 1e-4);
  gl_Position = projectionMatrix * viewMatrix * world;
}
