// OM—002 MEMORY GLASS — the membrane (fragment)
// Clear liquid glass: nearly invisible face-on, where only the studio's lights
// sit on it; at grazing angles its thickness shows as a faint aqua band and a
// bright reflected rim. BACK draws the far wall seen through the near one,
// fainter, which gives the glass its depth. Fresh gestures mist it a little.

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying float vMem;

void main() {
  vec3 N = normalize(vNormalW);
#if BACK
  N = -N;
#endif
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  float F = fresnel(NdV, 0.04);
  vec3 R = reflect(-V, N);
  vec3 env = envMap(R);
  // a clean, watery glass: the room's lights, its dark flags lifted a little
  vec3 refl = mix(env, vec3(1.0), 0.18);

  // two layers: the glass's own body (a faint aqua haze, thicker at grazing
  // angles) under its reflection (the rim, and the softboxes as highlights)
  float edge = 1.0 - NdV;
  float haze = 0.025 + smoothstep(0.4, 0.9, edge) * 0.2;
  vec3 tint = srgb(vec3(0.62, 0.85, 0.87));
  float shine = sat(F * 1.25 + smoothstep(1.6, 2.9, luma(env)) * 0.35);

  // memory: fresh traces mist the glass
  float mist = sat(vMem);
  haze += mist * 0.1;
  tint = mix(tint, vec3(0.92, 0.98, 0.99), mist * 0.5);

#if BACK
  haze *= 0.5;
  shine *= 0.4;
#endif
  float scan = scanLine(vPosL.y);
  shine = sat(shine + scan * 0.5);
  refl += srgb(vec3(0.6, 1.0, 0.98)) * scan;

  // "over" of the reflection on the haze, unpremultiplied for the blend
  float a = shine + haze * (1.0 - shine);
  vec3 col = (refl * shine + tint * haze * (1.0 - shine)) / max(a, 1e-4);
  gl_FragColor = vec4(toDisplay(col), a * uOpacity);
}
