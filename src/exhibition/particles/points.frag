uniform float uOpacity;

varying vec4 vColor;
varying float vSoft;

void main() {
  // a crisp dot while it is part of the specimen, a soft blur once it disperses
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float crisp = 1.0 - smoothstep(0.6, 1.0, d);
  float soft = exp(-d * d * 3.2) * (1.0 - smoothstep(0.8, 1.0, d));
  float a = mix(crisp, soft, vSoft) * vColor.a * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
