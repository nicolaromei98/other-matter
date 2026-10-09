// ── env ────────────────────────────────────────────────────────────────
// One procedural studio lights every specimen, so the six read as if they
// were photographed in the same room. Linear radiance, roughly 0–3.5.
//   · bright paper cyclorama behind the specimens (what refraction sees),
//     matching the white interface
//   · overhead softbox, a key box front-left, a cool rim strip back-right
//   · black flags and a dark floor band: they give clear volumes the dark,
//     liquid edges of real glass
// uEnvRot is the interactive light field: the cursor turns the whole rig.
// Requires common.glsl.

uniform mat3 uEnvRot;

float softRect(vec2 p, vec2 c, vec2 h, float s) {
  vec2 d = abs(p - c) - h;
  return 1.0 - smoothstep(0.0, s, max(d.x, d.y));
}

vec3 envMap(vec3 dir) {
  vec3 d = uEnvRot * dir;
  float az = atan(d.x, d.z);                 // 0 = toward the viewer
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 p = vec2(az, el);
  vec2 pb = vec2(abs(az), el);               // mirrored, for the back wall

  float wall = smoothstep(-0.5, 0.12, el);
  vec3 c = mix(vec3(0.05, 0.05, 0.06), vec3(0.84, 0.85, 0.87), wall);
  c *= 0.86 + 0.14 * smoothstep(0.0, 1.2, el);
  // back wall: paper white
  c = mix(c, vec3(1.04), smoothstep(1.7, 2.7, abs(az)) * wall * 0.7);

  c += vec3(2.3) * smoothstep(0.84, 0.95, d.y);                                        // overhead
  c += vec3(3.3, 3.25, 3.1) * softRect(p, vec2(-0.78, 0.36), vec2(0.27, 0.3), 0.07);   // key
  c += vec3(2.2, 2.45, 2.9) * softRect(p, vec2(2.2, 0.12), vec2(0.07, 0.55), 0.04);    // rim strip
  c += vec3(1.4) * softRect(p, vec2(0.55, -0.05), vec2(0.05, 0.4), 0.05);              // thin front strip

  c *= 1.0 - 0.95 * softRect(p, vec2(1.08, 0.1), vec2(0.2, 0.62), 0.08);               // flag right
  c *= 1.0 - 0.9 * softRect(p, vec2(-2.3, 0.0), vec2(0.17, 0.72), 0.08);               // flag back-left
  c *= 1.0 - 0.85 * softRect(pb, vec2(3.14, -0.22), vec2(0.62, 0.08), 0.06);           // low band, back
  return c;
}

// Cheap "rough" environment: the same room without its sharp features.
vec3 envDiffuse(vec3 dir) {
  vec3 d = uEnvRot * dir;
  float wall = smoothstep(-0.6, 0.3, d.y);
  return mix(vec3(0.12, 0.12, 0.13), vec3(0.95, 0.95, 0.97), wall) + vec3(0.5) * smoothstep(0.3, 1.0, d.y);
}

vec3 envRough(vec3 dir, float rough) {
  return mix(envMap(dir), envDiffuse(dir), sat(rough));
}
