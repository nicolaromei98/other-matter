// ── specimen ───────────────────────────────────────────────────────────
// Uniforms every specimen material receives, plus the shared scan and
// resonance helpers. Local space is the specimen's own unit space (radius
// ≈ 1), so patterns look the same in a 20 px dot and a 600 px stage.

uniform float uTime;
uniform float uIdle;
uniform float uMotion;
uniform float uHover;       // 0..1, proximity-weighted
uniform float uPress;       // 0..1
uniform vec3 uPointerL;     // pointer in local space (surface hit or projection)
uniform vec3 uCamL;         // camera position in local space
uniform float uDetail;      // 0 in a nav dot → 1 on the stage: gates micro detail
uniform float uRes;         // resonance envelope of the hover sound
uniform vec3 uResPos;       // where that sound entered (local)
uniform float uResAge;      // seconds since it entered
uniform vec2 uScan;         // x: scan line height (local y), y: scan amount
uniform float uOpacity;     // hand-off to/from the particle transition

// A pressure shell travelling outward from where the sound entered.
float resWave(vec3 p, float speed, float sharp) {
  float d = length(p - uResPos);
  return uRes * exp(-abs(d - uResAge * speed) * sharp);
}

// The scan sweeps top → bottom. Above the line the x-ray layer lingers and fades.
float scanReveal(float y) {
  float d = y - uScan.x;
  return uScan.y * step(0.0, d) * exp(-d * 3.5);
}

float scanLine(float y) {
  return uScan.y * exp(-pow((y - uScan.x) / 0.012, 2.0));
}
