// OM—003 ORBITAL SERUM — the capsules
// A clear glass bead full of yellow pollen: the ray through the bead's unit
// sphere is marched through a soft fibrous density, lit from above; around
// it, the glass (faked opaque against the light page) shows a pale body, a
// grey refracted band and a bright reflected rim.

#if HIGH
  #define STEPS 7
#else
  #define STEPS 4
#endif

varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vRayL;
varying float vId;

float pollen(vec3 q, float seed) {
  float t = uIdle * 0.06;
  vec3 w = vec3(snoise(q * 1.6 + seed), snoise(q * 1.6 + seed + 7.1), snoise(q * 1.6 + seed - 3.3));
  float f = snoise(q * 2.4 + w * 0.8 + vec3(0.0, t, seed)) * 0.65 + snoise(q * 5.5 + w + seed) * 0.35;
  // fibrous, cloudy, filling most of the bead but not its glass
  return smoothstep(-0.55, 0.35, f) * smoothstep(0.95, 0.6, length(q));
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  vec3 rd = normalize(vRayL);
  vec3 p = vLocal;
  float exitT = max(-2.0 * dot(p, rd), 0.0);
  float stepLen = exitT / float(STEPS);
  float seed = vId * 3.7;

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 q = p + rd * stepLen * (float(i) + 0.5);
    float d = pollen(q, seed);
    // lit from above: the tops of the tufts are pale butter, their undersides ochre
    float light = 0.55 + 0.45 * sat(q.y * 0.9 + 0.4);
    vec3 c = mix(srgb(vec3(0.9, 0.76, 0.42)), srgb(vec3(1.0, 0.96, 0.82)), light);
    float a = d * stepLen * 4.5;
    acc += trans * a * c;
    trans *= exp(-a * 1.35);
  }
  // what the glass shows where the pollen is thin: the light room behind it
  vec3 glass = srgb(vec3(0.93, 0.94, 0.945));
  vec3 col = acc + trans * glass;

  // the glass itself
  float rim = pow(1.0 - NdV, 2.2);
  col = mix(col, srgb(vec3(0.72, 0.75, 0.78)), smoothstep(0.45, 0.85, rim) * 0.6);   // refracted band
  vec3 env = envMap(reflect(-V, N));
  col += env * fresnel(NdV, 0.04) * 0.35;
  col += smoothstep(2.0, 3.0, luma(env)) * 0.35;
  // sound: the capsules glow briefly
  col += srgb(vec3(1.0, 0.92, 0.6)) * uRes * 0.15;

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
