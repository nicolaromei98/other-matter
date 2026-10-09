// OM—002 MEMORY GLASS — fragment
// Black liquid glass. Silver reflections of the shared studio sit on the
// surface; through it, the refracted ray is marched into a dense dark
// interior where vivid orange inclusions merge, split and circulate in a
// curling flow. The memory trail displaces the inclusion field, so gestures
// stretch and drag the orange matter, then let it drift back.

#define TRAIL_N 24
#if HIGH
  #define STEPS 5
#else
  #define STEPS 3
#endif

uniform vec4 uTrail[TRAIL_N];
uniform float uTrailE[TRAIL_N];

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;
varying float vMem;

// Displacement of the interior field by recent gestures.
vec3 memoryPush(vec3 p) {
  vec3 push = vec3(0.0);
  for (int i = 0; i < TRAIL_N; i++) {
    float e = uTrailE[i];
    if (e <= 0.0) continue;
    float age = max(uTime - uTrail[i].w, 0.0);
    vec3 d = p - uTrail[i].xyz;
    push += d * exp(-dot(d, d) * 6.0) * exp(-age * 0.35) * e;
  }
  return push;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  vec3 Vl = normalize(uCamL - vPosL);
  vec3 Nl = normalize(vNormalL);

  vec3 orangeDeep = srgb(vec3(0.85, 0.22, 0.02));
  vec3 orange = srgb(vec3(1.0, 0.45, 0.06));
  vec3 orangeHot = srgb(vec3(1.0, 0.78, 0.42));

  // interior: march the refracted ray through the dark liquid
  vec3 rd = refract(-Vl, Nl, 1.0 / 1.5);
  vec3 pos = vPosL;
  vec3 push = memoryPush(vPosL) * 1.6;
  float t = uIdle * 0.06;
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float stepLen = 1.0 / float(STEPS);
  float field = 0.0;
  for (int i = 0; i < STEPS; i++) {
    pos += rd * stepLen;
    float inside = smoothstep(1.0, 0.55, length(pos));
    vec3 q = pos * 1.45 - push + vec3(0.0, t, 0.0);
    vec3 w = vec3(snoise(q * 0.7 + vec3(t, 0.0, 0.0)), snoise(q * 0.7 + vec3(0.0, -t, 3.0)), 0.0);
    float f = snoise(q + w * 0.9);
    field = max(field, f * inside);
    float inc = smoothstep(0.36, 0.56, f) * inside;
    float drop = smoothstep(0.86, 0.94, snoise(pos * 4.2 + vec3(3.0, -t * 2.0, 1.0))) * inside;
    float dens = inc + drop * 1.2;
    vec3 c = mix(orangeDeep, orange, smoothstep(0.32, 0.6, f));
    c = mix(c, orangeHot, smoothstep(0.62, 0.85, f) + drop * 0.6);
    acc += trans * dens * c * stepLen * 4.2;
    trans *= exp(-dens * stepLen * 5.0);
  }
  vec3 interior = acc + trans * srgb(vec3(0.025, 0.022, 0.024));

  // surface: glossy silver reflections
  vec3 R = reflect(-V, N);
  float F = fresnel(NdV, 0.06);
  vec3 refl = envMap(R) * mix(vec3(1.0), vec3(0.93, 0.96, 1.0), 0.6);
  vec3 col = mix(interior, refl, F);
  col += refl * 0.06;                        // faint sheen over the whole body

  // memory: fresh traces cloud the glass with a dim amber haze
  col += orange * sat(vMem) * 0.12 * (1.0 - F);

  // scan: memory field and inclusion boundaries
  float rev = scanReveal(vPosL.y);
  float edges = 1.0 - smoothstep(0.0, 0.06, abs(field - 0.3));
  vec3 xray = mix(srgb(vec3(0.06, 0.06, 0.07)), orangeHot, sat(edges + vMem * 1.5));
  col = mix(col, xray, rev * 0.85);
  col += orangeHot * scanLine(vPosL.y) * 1.2;

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
