uniform float uOpacity;

varying vec4 vColor;
varying float vK;

void main() {
  // a solid dot in a specimen, a slightly softer speck while loose
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(mix(0.6, 0.4, vK), 1.0, d)) * vColor.a * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
