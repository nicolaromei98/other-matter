varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vPosL;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float g = 1.0 - abs(dot(N, V));
  float rim = pow(g, 3.2);
  vec3 col = mix(srgb(vec3(0.55, 0.92, 1.0)), srgb(vec3(0.1, 0.55, 1.0)), rim);
  float a = rim * 0.3 + 0.008 + uHover * rim * 0.12;
  a += scanLine(vPosL.y) * 0.6;
  gl_FragColor = vec4(toDisplay(col), a * uOpacity);
}
