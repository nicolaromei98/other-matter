// OM—005 LIQUID STONE — fragment
//  · two-phase flow map in object space: domain-warped strata advected along
//    a slow noise flow (bent by pressure), crossfaded so it never stretches
//  · a deeper strata layer seen along the view ray, lit from inside
//  · garnet translucency where the mineral thins
//  · metallic, mixed-roughness reflections of the shared studio
//  · fractures: Worley seams opened around strikes, narrowing as they heal

#define CRACK_N 4

uniform vec3 uPressL;
uniform float uPressAmt;
uniform float uFlowT;
uniform vec4 uCrack[CRACK_N];
uniform float uCrackE[CRACK_N];
uniform float uCrackAny;

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;

vec3 flowField(vec3 p) {
  vec3 f = vec3(snoise(p * 0.6 + vec3(0.0, 0.0, 3.1)), snoise(p * 0.6 + vec3(5.2, 1.3, 0.0)) * 0.35, snoise(p * 0.6 + vec3(2.7, 8.1, 4.4)));
  vec3 d = p - uPressL;
  float w = exp(-dot(d, d) * 2.2) * uPressAmt;
  vec3 dn = normalize(d + 1e-4);
  return f + dn * w * 1.3 + cross(dn, vec3(0.0, 1.0, 0.0)) * w * 1.1;
}

// x: band, y: vein, z: warp
vec3 mineral(vec3 p) {
#if HIGH
  float w = fbm4(p * 1.05);
#else
  float w = fbm3(p * 1.05);
#endif
  float bands = 0.5 + 0.5 * sin((p.y * 2.3 + p.x * 0.45 + w * 3.1) * PI);
  float ridge = 1.0 - abs(snoise(p * 2.2 + w * 1.3));
  return vec3(bands, pow(ridge, 12.0), w);
}

vec3 flowMineral(vec3 p) {
  vec3 f = flowField(p) * 0.32;
  float ph0 = fract(uFlowT);
  float ph1 = fract(uFlowT + 0.5);
  vec3 a = mineral(p - f * ph0);
  vec3 b = mineral(p - f * ph1 + vec3(0.31, 0.17, 0.53));
  return mix(a, b, abs(1.0 - 2.0 * ph0));
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));

  vec3 graphite = srgb(vec3(0.13, 0.125, 0.135));
  vec3 black = srgb(vec3(0.035, 0.032, 0.04));
  vec3 violet = srgb(vec3(0.24, 0.16, 0.3));
  vec3 deepred = srgb(vec3(0.42, 0.06, 0.06));
  vec3 rust = srgb(vec3(0.55, 0.22, 0.1));
  vec3 amber = srgb(vec3(0.95, 0.56, 0.18));

  vec3 m = flowMineral(vPosL);
  vec3 base = mix(black, graphite, m.x);
  base = mix(base, violet, smoothstep(0.55, 0.98, m.x) * 0.6);
  base = mix(base, rust, m.y * 0.7);

  // deeper layer, lit from inside (tectonic glow with low voice)
  vec3 Vl = normalize(uCamL - vPosL);
  vec3 dp = vPosL - Vl * 0.26;
  float dm = fbm3(dp * 1.25 + vec3(0.0, uFlowT * 0.12, 0.0));
  float pulse = resWave(vPosL, 0.9, 4.0);
  float deep = smoothstep(0.05, 0.75, dm) * (0.1 + pulse * 0.9);
  vec3 deepCol = mix(deepred, amber, smoothstep(0.35, 0.95, dm));

  // garnet translucency where the strata thin
  float garnet = smoothstep(0.35, 0.65, m.z) * smoothstep(0.4, 0.9, NdV);

  // lighting: metallic highlights, mixed roughness
  vec3 R = reflect(-V, N);
  float rough = mix(0.05, 0.45, smoothstep(-0.25, 0.55, m.z));
  float F = fresnel(NdV, 0.05);
  vec3 refl = envRough(R, rough) * mix(vec3(1.0), srgb(vec3(0.82, 0.8, 0.95)), 0.5);
  float diff = sat(dot(N, normalize(vec3(-0.5, 0.75, 0.45)))) * 0.45 + 0.08;
  vec3 col = base * diff;
  // metallic highlights: only the polished strata catch the softboxes
  float polish = 1.0 - smoothstep(0.08, 0.3, rough);
  col += refl * F * (0.35 + 0.65 * polish);
  col += max(envMap(R) - 1.2, 0.0) * polish * 0.3 * srgb(vec3(0.9, 0.86, 1.0));
  col += deepred * garnet * 0.22;
  // veins carry a faint inner light at rest
  col += mix(rust, amber, 0.4) * m.y * 0.16;
  col += deepCol * deep * (0.35 + 0.65 * NdV);
  col += mix(deepred, amber, m.y) * m.y * pulse * 1.2;

  // fractures along the stone's own grain
  float seams = 0.0;
  float glow = 0.0;
  if (uCrackAny > 0.5) {
    Cell c = worley(vPosL * 3.4, 1.0, 0.0);
    float edge = c.f2 - c.f1;
    for (int i = 0; i < CRACK_N; i++) {
      float e = uCrackE[i];
      if (e <= 0.0) continue;
      float age = max(uTime - uCrack[i].w, 0.0);
      float dist = length(vPosL - uCrack[i].xyz);
      float radius = 0.75 * (1.0 - exp(-age * 4.5));
      float reach = smoothstep(radius, radius - 0.3, dist);
      float heal = exp(-age * 0.8);
      float width = 0.045 * heal + 0.003;
      seams += (1.0 - smoothstep(0.0, width, edge)) * reach * heal * e;
      glow += (1.0 - smoothstep(0.0, width * 5.0, edge)) * reach * heal * e;
    }
    col += mix(amber, vec3(1.0, 0.92, 0.78), sat(seams)) * sat(seams) * 2.4 + amber * sat(glow) * 0.35;
  }

  // scan: the stress field (fracture network the stone would follow)
  float rev = scanReveal(vPosL.y);
  if (rev > 0.002) {
    Cell s = worley(vPosL * 3.4, 1.0, 0.0);
    float net = 1.0 - smoothstep(0.0, 0.05, s.f2 - s.f1);
    vec3 xray = mix(srgb(vec3(0.05, 0.04, 0.06)), amber, net * 0.9 + m.y * 0.4);
    col = mix(col, xray, rev * 0.85);
  }
  col += amber * scanLine(vPosL.y) * 1.4;

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
