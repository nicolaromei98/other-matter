// OM—001 AEROGEL SKIN — fragment
// Light and colour moving through a semi-transparent organic volume:
// the refracted view ray is marched through domain-warped clouds of pink,
// coral, lilac and pale blue, with absorption, under a pearl skin with
// luminous iridescent edges. Scan reveals the density contours.

#if HIGH
  #define STEPS 6
#else
  #define STEPS 4
#endif
#define STEP_LEN (1.1 / float(STEPS))

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vShell;

vec3 pastel(float h) {
  vec3 pink = srgb(vec3(1.0, 0.68, 0.79));
  vec3 coral = srgb(vec3(1.0, 0.62, 0.5));
  vec3 lilac = srgb(vec3(0.78, 0.68, 1.0));
  vec3 blue = srgb(vec3(0.58, 0.78, 1.0));
  h = fract(h) * 4.0;
  vec3 c = mix(pink, coral, smoothstep(0.0, 1.0, h));
  c = mix(c, lilac, smoothstep(1.0, 2.0, h));
  c = mix(c, blue, smoothstep(2.0, 3.0, h));
  return mix(c, pink, smoothstep(3.0, 4.0, h));
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  float g = 1.0 - NdV;

  vec3 Vl = normalize(uCamL - vPosL);
  vec3 Nl = normalize(vNormalL);
  vec3 rd = refract(-Vl, Nl, 1.0 / 1.12);
  vec3 pos = vPosL;

  float t = uIdle * 0.07;
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float contour = 0.0;
  for (int i = 0; i < STEPS; i++) {
    pos += rd * STEP_LEN;
    float inside = smoothstep(1.08, 0.5, length(pos));
    vec3 q = pos * 1.3;
    vec2 w = vec2(snoise(q + vec3(t, 0.0, 0.0)), snoise(q + vec3(0.0, 4.1, -t)));
    float dens = snoise(q * 1.15 + vec3(w * 0.95, t * 1.4));
    dens = sat(dens * 0.75 + 0.32 + uRes * 0.25 + uHover * 0.06) * inside;
    float hue = 0.5 + 0.5 * snoise(pos * 0.75 + vec3(3.0, t * 0.8, 1.0)) + uIdle * 0.01;
    acc += trans * dens * pastel(hue) * STEP_LEN * 2.5;
    trans *= exp(-dens * STEP_LEN * 2.3);
    contour += (1.0 - smoothstep(0.0, 0.08, abs(fract(dens * 5.0) - 0.5) - 0.42)) * inside / float(STEPS);
  }

  // pearl skin over the coloured volume
  vec3 pearl = srgb(vec3(0.99, 0.98, 0.985));
  vec3 body = pearl * trans * 0.97 + acc;
  float shade = 0.84 + 0.16 * sat(dot(N, normalize(vec3(-0.35, 0.85, 0.4))) * 0.5 + 0.5);
  body *= shade;

  // luminous, iridescent membrane edge (defines the form on white)
  vec3 film = thinFilm(NdV, 0.5 + 0.2 * sin(uIdle * 0.3) + vShell * 0.3);
  vec3 col = body;
  col = mix(col, col * (0.72 + film * 0.5), smoothstep(0.35, 0.95, g));
  col *= 1.0 - pow(g, 5.0) * 0.18;
  col += film * pow(g, 2.5) * 0.18;

  // soft spectral highlights from the shared studio
  vec3 R = reflect(-V, N);
  col += envMap(R) * fresnel(NdV, 0.025) * 0.28 * (0.6 + 0.4 * film);

  // pressure from sound brightens the core
  col += pastel(uIdle * 0.05 + 0.3) * vShell * 0.25;

  // scan: density contours
  float rev = scanReveal(vPosL.y);
  vec3 xray = mix(vec3(0.97, 0.96, 1.0), srgb(vec3(0.55, 0.42, 0.95)), sat(contour * 2.2));
  col = mix(col, xray, rev * 0.85);
  col += srgb(vec3(0.6, 0.45, 1.0)) * scanLine(vPosL.y) * 0.8;

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
