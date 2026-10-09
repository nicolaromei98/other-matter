uniform float uOpacity;

varying vec4 vColor;
varying float vK;

void main() {
  // a solid dot while it is part of the specimen, a soft-edged speck once airborne
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(mix(0.6, 0.2, vK), 1.0, d)) * vColor.a * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
