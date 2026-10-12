// OM—003 ORBITAL SERUM — motes (see motes.vert for the kinds)

uniform float uOpacity;

varying float vKind;
varying float vHue;
varying float vGlint;
varying vec2 vDir;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float d = length(c);
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // a glint streaked along the ray from the centre, in a pastel spectral tint
    float along = dot(c, vDir);
    float across = dot(c, vec2(-vDir.y, vDir.x));
    float shape = exp(-(along * along * 1.4 + across * across * 16.0));
    vec3 hue = 0.5 + 0.5 * cos(TAU * (vHue + vec3(0.0, 0.33, 0.67)));
    // half are spectral glints, half are specks of deeper green serum
    vec3 glint = mix(vec3(1.0), hue, 0.75) * (1.0 + vGlint * 0.8);
    vec3 speck = srgb(vec3(0.42, 0.6, 0.26));
    float isGlint = step(0.45, vHue);
    col = mix(speck, glint, isGlint);
    a = shape * mix(0.75, vGlint, isGlint);
  } else if (vKind < 1.5) {
    // a bubble: a thin bright ring and a highlight
    float ring = smoothstep(0.62, 0.82, d) * (1.0 - smoothstep(0.86, 1.0, d));
    float hl = exp(-dot(c - vec2(-0.32, 0.34), c - vec2(-0.32, 0.34)) * 30.0);
    col = mix(srgb(vec3(0.88, 0.95, 0.85)), vec3(1.2), hl);
    a = ring * 0.65 + hl * 0.8 + 0.06 * step(d, 0.85);
  } else if (vKind < 2.5) {
    // halo matter: small soft green grains
    col = mix(srgb(vec3(0.5, 0.68, 0.34)), srgb(vec3(0.75, 0.86, 0.55)), vHue);
    a = (1.0 - smoothstep(0.35, 1.0, d)) * 0.8 * vGlint;
  } else {
    // a stray droplet: clear, a darker rim, a bright spot
    float ring = smoothstep(0.7, 0.88, d) * (1.0 - smoothstep(0.9, 1.0, d));
    float hl = exp(-dot(c - vec2(-0.3, 0.32), c - vec2(-0.3, 0.32)) * 24.0);
    col = mix(srgb(vec3(0.62, 0.68, 0.7)), vec3(1.15), hl);
    a = ring * 0.5 + hl * 0.85 + 0.05 * step(d, 0.9);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(toDisplay(col), sat(a) * uOpacity);
}
