// OM—002 MEMORY GLASS — the two cells (fragment)
// Soft, granular matter: a fine relief of grains (a simplex bump, two octaves
// on the high tier, only when it is large enough to see), lit by the shared
// studio with a wrapped, translucent diffuse; the creases between lobes sink
// into deeper colour. One cell leans cyan-blue, the other teal-green.

uniform mat4 modelMatrix;         // three only declares it in vertex shaders (it still sets it by name)

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vCellL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vCrease;
varying float vCell;
varying float vMem;

vec3 grad(vec3 q, out float h) {
  const float e = 0.3;
  h = snoise(q);
  return (vec3(snoise(q + vec3(e, 0.0, 0.0)), snoise(q + vec3(0.0, e, 0.0)), snoise(q + vec3(0.0, 0.0, e))) - h) / e;
}

void main() {
  vec3 Nl = normalize(vNormalL);

  // granular relief
  float pit = 0.0;
  if (uDetail > 0.01) {
    float h;
    vec3 g = grad(vCellL * 36.0, h);
    pit = h;
#if HIGH
    float h2;
    g += grad(vCellL * 83.0 + 7.0, h2) * 0.55;
    pit = pit * 0.7 + h2 * 0.3;
#endif
    g -= Nl * dot(g, Nl);
    Nl = normalize(Nl - g * 0.05 * uDetail);
  }
  vec3 N = normalize(mat3(modelMatrix) * Nl);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));

  // the two cells
  float side = step(0.0, vCell);
  vec3 deep = mix(srgb(vec3(0.05, 0.38, 0.56)), srgb(vec3(0.04, 0.42, 0.4)), side);
  vec3 mid = mix(srgb(vec3(0.16, 0.66, 0.82)), srgb(vec3(0.18, 0.72, 0.62)), side);
  vec3 pale = mix(srgb(vec3(0.7, 0.93, 0.97)), srgb(vec3(0.7, 0.95, 0.88)), side);
  // a slow drift of hue across each cell
  mid = mix(mid, pale, 0.18 + 0.12 * snoise(vCellL * 2.2 + vCell));

  // wrapped diffuse from the studio: soft, a little translucent
  vec3 irr = envDiffuse(N);
  float light = luma(irr);
  vec3 col = mix(deep, mid, smoothstep(0.1, 0.95, light)) * (0.55 + 0.6 * light);
  col = mix(col, pale * 1.1, smoothstep(1.05, 1.5, light) * 0.55);
  // light coming through the thin edges
  col += mid * pow(1.0 - NdV, 2.5) * 0.35;
  // creases between lobes and pits between grains sink into deeper colour
  col = mix(col, deep, smoothstep(0.2, 1.0, vCrease) * 0.4);
  col *= 1.0 - 0.18 * sat(-pit) * uDetail;

  // a soft sheen; the grains catch small glints
  vec3 R = reflect(-V, N);
  float F = fresnel(NdV, 0.035);
  col += envRough(R, 0.5) * F * 0.45;

  // memory: where it was touched the matter pales, then recovers
  col = mix(col, pale, sat(vMem) * 0.3);

  // scan: the creases light up as an x-ray of its structure
  float rev = scanReveal(vPosL.y);
  vec3 xray = mix(srgb(vec3(0.03, 0.12, 0.16)), srgb(vec3(0.6, 1.0, 0.98)), sat(vCrease * 1.3 + vMem));
  col = mix(col, xray, rev * 0.85);
  col += srgb(vec3(0.6, 1.0, 0.98)) * scanLine(vPosL.y) * 1.2;

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
