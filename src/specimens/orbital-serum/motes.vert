// OM—003 ORBITAL SERUM — motes (aInfo.x: kind)
// 0 sparkles in the serum: chromatic glints streaked away from the centre, twinkling
// 1 bubbles in the serum, rocking gently
// 2 the halo: fine green matter crawling over the core's surface
// 3 stray droplets drifting around the whole
// Fragmentation blows the halo and the droplets outward and bursts the sparkles.

attribute vec4 aInfo;          // kind, seed, size jitter, hue
uniform float uPointScale;

varying float vKind;
varying float vHue;
varying float vGlint;
varying vec2 vDir;             // on screen, away from the core's centre (y up)

void main() {
  vec3 p = position;
  float kind = aInfo.x;
  float seed = aInfo.y;
  float t = uIdle;
  float r0 = length(p);
  vec3 dir = p / max(r0, 1e-4);

  float size;
  float glint = 1.0;
  if (kind < 0.5) {
    p += dir * 0.015 * sin(t * 0.5 + seed * 6.283);
    p += dir * uFragment * (0.1 + 0.2 * seed);
    // twinkle: mostly dim, now and then a bright glint
    glint = pow(0.5 + 0.5 * sin(t * (0.8 + seed * 2.0) + seed * 40.0), 4.0) * 0.8 + 0.3;
    size = mix(1.6, 3.6, aInfo.z) * (0.6 + 0.4 * smoothstep(0.1, 0.55, r0));
    // the burst leans toward the pointer
    p += (uPointerL - p) * 0.06 * uHover * smoothstep(0.3, 0.0, length(p - uPointerL) - 0.2);
  } else if (kind < 1.5) {
    p.y += sin(t * 0.4 + seed * 6.283) * 0.02;
    size = mix(2.0, 5.5, aInfo.z * aInfo.z);
  } else if (kind < 2.5) {
    float a = t * (0.02 + 0.03 * seed);
    p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
    p += dir * uFragment * (0.25 + 0.6 * seed);
    size = mix(0.9, 1.7, aInfo.z);
  } else {
    p += 0.04 * vec3(sin(t * 0.3 + seed * 6.283), cos(t * 0.25 + seed * 9.0), sin(t * 0.2 + seed * 3.0));
    p += dir * uFragment * 0.5;
    size = mix(5.0, 13.0, aInfo.z * aInfo.z);
  }
  // sound: a shell of light runs through them
  glint += resWave(p, 1.2, 6.0) * 1.5;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 centre = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vDir = normalize(mv.xy - centre.xy + vec2(1e-5));
  float persp = length(cameraPosition) / max(-mv.z, 1.0);
  gl_PointSize = max(1.0, size * uPointScale * persp);

  vKind = kind;
  vHue = aInfo.w;
  vGlint = glint;
  gl_Position = projectionMatrix * mv;
}
