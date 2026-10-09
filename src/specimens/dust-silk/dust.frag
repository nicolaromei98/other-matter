uniform float uOpacity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.05, d);
  float a = core * core * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(toDisplay(vColor), a);
}
