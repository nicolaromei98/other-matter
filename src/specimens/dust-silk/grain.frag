// OM—004 DUST SILK — one grain: a small lit bead when in focus, a soft
// bokeh disc when not. SHARP 1 draws the grains in focus (opaque, depth
// written, edges by alpha to coverage); SHARP 0 blends the blurred ones.

uniform float uOpacity;

varying vec3 vColor;
varying float vGlow;
varying float vBlur;
varying float vSize;
varying float vAlpha;

void main() {
  float soft = smoothstep(0.5, 1.0, vBlur);
#if SHARP
  if (vBlur > 0.5) discard;
#else
  if (vBlur <= 0.5) discard;
#endif
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float aa = min(0.5, 2.5 / max(vSize, 1.0));
  float bead = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  float disc = 1.0 - smoothstep(0.25, 1.0, r);
  float shape = mix(bead, disc, soft);
  float a = shape * vAlpha * mix(1.0, 0.2, soft);
  if (a < 0.01) discard;

  // the bead's own shading: lit from the top, front-left, with a small highlight
  vec3 n = vec3(c.x, -c.y, sqrt(max(1.0 - r * r, 0.0)));
  vec3 L = normalize(vec3(-0.35, 0.8, 0.5));
  float diff = sat(dot(n, L) * 0.55 + 0.5);
  float spec = pow(sat(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 22.0) * 0.22;
  vec3 col = vColor * mix(diff, 0.92, soft) + spec * (1.0 - soft);
  col += vColor * vGlow;

  gl_FragColor = vec4(toDisplay(col), a * uOpacity);
}
