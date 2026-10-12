// OM—003 ORBITAL SERUM — rods (ROD 1) and the molecule (ROD 0)
// Opaque, with their glass faked against the light page: rods are milky
// clear glass, white through the middle, grey-blue along their sides; the
// molecule's atoms and bonds are droplets of the serum itself, pale in the
// middle, deeper green at their rims, with a bright highlight.

varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vRayL;
varying float vId;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  if (dot(N, V) < 0.0) N = -N;            // open-ended bonds: shade their inside like their outside
  float NdV = sat(dot(N, V));
  vec3 R = reflect(-V, N);
  vec3 env = envMap(R);
  float rim = pow(1.0 - NdV, 1.6);

#if ROD
  vec3 col = mix(srgb(vec3(0.95, 0.96, 0.965)), srgb(vec3(0.68, 0.73, 0.77)), rim);
  col = mix(col, srgb(vec3(0.99)), smoothstep(0.85, 1.0, 1.0 - rim) * 0.4);   // the bright core of the rod
  col += env * fresnel(NdV, 0.04) * 0.25;
  col += smoothstep(1.8, 3.0, luma(env)) * 0.35;
#else
  vec3 pale = srgb(vec3(0.84, 0.9, 0.74));
  vec3 deep = srgb(vec3(0.42, 0.56, 0.3));
  vec3 col = mix(pale, deep, smoothstep(0.15, 0.95, rim));
  col += env * fresnel(NdV, 0.04) * 0.22;
  col += smoothstep(1.7, 3.0, luma(env)) * 0.5;        // highlight
  // seen through the liquid: lifted toward the serum's own colour
  col = mix(col, srgb(vec3(0.72, 0.81, 0.6)), 0.25);
  // fragmentation: the molecule thins into the serum as it opens
  col = mix(col, srgb(vec3(0.78, 0.85, 0.68)), uFragment * 0.4);
#endif
  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
