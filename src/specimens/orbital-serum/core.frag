// OM—003 ORBITAL SERUM — the core
// BACK 1: the serum, seen on the far wall: a green that deepens toward the
// top-left, lit from within at its centre, with faint rays of light fanning
// out from it; denser where the ray crosses more of it.
// BACK 0: the glass skin over everything: the studio reflected at grazing
// angles, the softboxes as highlights, and a thin green band at the edge
// where the glass is seen through its thickness.

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec2 vDisc;

void main() {
  float rr = length(vDisc);
#if BACK
  // how much serum the view ray crosses (sphere chord, in core radii)
  vec3 rd = normalize(vPosL - uCamL);
  float R = length(vPosL);
  float b = dot(uCamL, rd);
  float h = b * b - (dot(uCamL, uCamL) - R * R);
  float chord = 2.0 * sqrt(max(h, 0.0)) / R;

  float g = sat(0.5 + dot(vDisc, normalize(vec2(-0.75, 0.66))) * 0.62);    // 1 toward the top-left
  vec3 pale = srgb(vec3(0.89, 0.93, 0.82));
  vec3 mid = srgb(vec3(0.68, 0.79, 0.55));
  vec3 deep = srgb(vec3(0.36, 0.5, 0.25));
  vec3 col = mix(pale, mid, smoothstep(0.25, 0.65, g));
  col = mix(col, deep, smoothstep(0.6, 1.0, g) * 0.85);
  // lit from within, where the molecule sits
  vec2 c = vDisc - vec2(0.05, -0.08);
  col = mix(col, srgb(vec3(0.93, 0.96, 0.88)), exp(-dot(c, c) * 5.0) * 0.45);
  // rays fanning out from the centre
  float ang = atan(vDisc.y, vDisc.x);
  float rays = pow(sat(snoise(vec3(ang * 7.0, uIdle * 0.04, 1.0)) * 0.5 + 0.5), 6.0);
  rays *= smoothstep(0.08, 0.5, rr) * (1.0 - smoothstep(0.8, 1.0, rr));
  col += srgb(vec3(0.95, 1.0, 0.88)) * rays * 0.35;
  // sound: a ripple runs out through the serum
  col += srgb(vec3(0.9, 1.0, 0.8)) * uRes * exp(-abs(rr - uResAge * 0.9) * 8.0) * 0.25;

  float a = (1.0 - exp(-chord * 1.9)) * 0.92;
  gl_FragColor = vec4(toDisplay(col), a * uOpacity);
#else
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  float F = fresnel(NdV, 0.04);
  vec3 env = envMap(reflect(-V, N));
  vec3 refl = mix(env, vec3(1.0), 0.15);
  float shine = sat(F * 1.1 + smoothstep(2.2, 3.1, luma(env)) * 0.28);
  // the glass seen through its own thickness, just inside the rim
  float edge = 1.0 - NdV;
  float band = smoothstep(0.72, 0.93, edge) * (1.0 - smoothstep(0.975, 1.0, edge));
  vec3 tint = srgb(vec3(0.46, 0.6, 0.34));
  float haze = band * 0.4;
  float scan = scanLine(vPosL.y / 0.6);
  shine = sat(shine + scan * 0.5);
  refl += srgb(vec3(0.75, 1.0, 0.7)) * scan;
  float a = shine + haze * (1.0 - shine);
  vec3 col = (refl * shine + tint * haze * (1.0 - shine)) / max(a, 1e-4);
  gl_FragColor = vec4(toDisplay(col), a * uOpacity);
#endif
}
