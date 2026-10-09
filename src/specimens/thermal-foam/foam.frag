// OM—003 THERMAL FOAM — fragment
// A reflective blue-silver skin with liquid-crystal interference bands that
// follow its folds. Where the skin thins, windows open onto the interior:
// the studio seen through it, and bubbles (Worley cells at depth). Heat
// softens the reflection (lower surface tension), shifts the film and adds
// warm accents. Microstructure keeps reorganising in the normal.

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vHeat;

uniform mat4 modelMatrix;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float h = sat(vHeat);
  float t = uIdle * 0.08;

  // reorganising microstructure (analytic Worley gradient, gated by size)
#if HIGH
  if (uDetail > 0.05) {
    // smooth cushions (∇(−F1²) = 2·d1): reorganising cells without hard seams
    Cell c = worley(vPosL * 5.0, 0.9, uIdle * 0.6);
    vec3 gW = mat3(modelMatrix) * (2.0 * c.d1);
    N = normalize(N - 0.0011 * uDetail * (1.0 - h) * (gW - dot(gW, N) * N));
  }
#endif
  float NdV = sat(dot(N, V));

  // liquid-crystal film following the folds; heat thickens it
  float folds = snoise(vPosL * 1.9 + vec3(t, -t * 0.6, 0.0));
  vec3 film = thinFilm(NdV, 0.36 + folds * 0.18 + h * 0.3);

  // reflective blue-silver skin; warmth lowers surface tension (softer reflection)
  vec3 R = reflect(-V, N);
  float rough = 0.04 + h * 0.35;
  vec3 tint = srgb(vec3(0.8, 0.88, 1.0));
  float F = fresnel(NdV, 0.62);
  vec3 skin = envRough(R, rough) * tint * mix(vec3(1.0), film * 1.5, 0.55) * F;

  // translucent windows onto the interior, with bubbles
  float window = smoothstep(0.1, 0.55, snoise(vPosL * 1.2 + vec3(0.0, t * 0.7, 3.0))) * pow(NdV, 0.6);
  vec3 Vl = normalize(uCamL - vPosL);
  vec3 rdL = refract(-Vl, normalize(vNormalL), 1.0 / 1.33);
  vec3 rdW = normalize(mat3(modelMatrix) * rdL);
  vec3 inner = envMap(rdW) * srgb(vec3(0.62, 0.76, 0.98));
  // sparse round bubbles: only some cells hold one, each with its own size
  vec3 bp = vPosL + rdL * 0.3;
  Cell b = worley(bp * 4.5 + vec3(0.0, uIdle * 0.15, 0.0), 0.7, 0.0);
  vec3 bh = hash33(b.id);
  float br = mix(0.07, 0.2, bh.y) * step(0.62, bh.x);
  float wall = (1.0 - smoothstep(0.0, 0.025, abs(b.f1 - br))) * step(0.01, br);
  float core = (1.0 - smoothstep(br - 0.02, br, b.f1)) * step(0.01, br);
  inner = inner * (1.0 - core * 0.25) + vec3(0.92, 0.96, 1.0) * wall * 0.7;
  vec3 col = mix(skin + envMap(R) * F * 0.15, inner, window * (1.0 - F) * 0.75);

  // strong specular from the softboxes
  col += envMap(R) * pow(F, 2.0) * 0.4;

  // warm accents where heat gathers
  vec3 warm = mix(srgb(vec3(1.0, 0.6, 0.3)), srgb(vec3(1.0, 0.42, 0.42)), smoothstep(0.5, 1.0, h));
  col = mix(col, col * 0.6 + warm * (0.45 + 0.55 * film.r), smoothstep(0.15, 0.9, h) * 0.75);

  // scan: temperature isolines
  float rev = scanReveal(vPosL.y);
  float iso = 1.0 - smoothstep(0.0, 0.08, abs(fract(h * 6.0 + folds * 0.3) - 0.5) - 0.4);
  vec3 xray = mix(srgb(vec3(0.1, 0.22, 0.6)), srgb(vec3(1.0, 0.55, 0.25)), h) * (0.4 + 0.6 * iso);
  col = mix(col, xray, rev * 0.8);
  col += srgb(vec3(0.5, 0.75, 1.0)) * scanLine(vPosL.y);

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
