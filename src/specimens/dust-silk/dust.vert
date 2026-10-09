// OM—004 DUST SILK — particles
// Fibres of luminous dust held in a slow curl-noise flow: neighbours along a
// fibre move together, so the volume reads as a breathing fibrous organism.
// The cursor pushes a local force field; a tap disperses everything along
// the flow and the spring brings it back. Sound compresses it in a wave.

attribute vec4 aSeed;
attribute vec2 aInfo;            // x: position along the fibre, y: 1 = loose dust

uniform float uDisperse;
uniform float uPointScale;       // px per unit size at the current on-screen radius

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  float t = uIdle * 0.1;
  float r0 = length(p);

  // irregular organic silhouette (shells are sculpted, not spherical)
  p *= 1.0 + organic(normalize(p), t * 0.6, 0.9, 0.7) * 0.2;

  // breathing, travelling outward through the volume
  p *= 1.0 + 0.05 * sin(uIdle * 0.8 - r0 * 3.2) * uMotion;

  // coherent flow
  vec3 flow = curlNoise(p * 0.85 + vec3(0.0, t, t * 0.5));
  p += flow * 0.065;

  // cursor force field
  vec3 dp = p - uPointerL;
  float fd = exp(-dot(dp, dp) * 4.5) * uHover * (0.2 + 0.4 * uPress);
  p += normalize(dp + vec3(1e-4)) * fd;

  // dispersion and reconstruction
  vec3 dir = normalize(aSeed.xyz * 2.0 - 1.0 + flow * 0.6);
  p += dir * uDisperse * (0.3 + aSeed.w * 0.9);

  // sound: a compression wave
  float shell = resWave(p, 1.5, 7.0);
  p -= normalize(p - uResPos + vec3(1e-4)) * shell * 0.08;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // floating clusters of brighter light
  float cluster = smoothstep(0.5, 0.85, snoise(position * 1.6 + vec3(t * 2.0, 0.0, -t)));
  float dust = aInfo.y;
  float size = mix(0.8, 1.9, aSeed.w) * mix(1.0, 0.7, dust) * (1.0 + cluster * 1.1 + shell * 1.5);

  // scan: particles in the swept band flare
  float scan = scanReveal(p.y) + scanLine(p.y) * 2.0;
  size *= 1.0 + scan * 0.8;

  float persp = length(cameraPosition) / max(-mv.z, 1.0);
  gl_PointSize = max(1.0, size * uPointScale * persp);

  vec3 deep = srgb(vec3(0.0, 0.28, 1.0));
  vec3 cyan = srgb(vec3(0.0, 0.76, 1.0));
  vec3 ice = srgb(vec3(0.45, 0.93, 1.0));
  vColor = mix(deep, cyan, aSeed.y);
  vColor = mix(vColor, cyan, cluster * 0.7);
  vColor = mix(vColor, ice, sat(scan) * 0.6);
  vColor = mix(vColor, deep * 0.7, smoothstep(0.6, 0.15, r0) * 0.4);   // denser core reads deeper
  vAlpha = mix(0.92, 0.5, dust) * (0.75 + 0.25 * aSeed.z);
  vAlpha *= 1.0 - smoothstep(0.6, 1.2, uDisperse) * 0.4;
  // volume: fibres on the far side recede
  float back = (mv.z - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z) / max(length(modelMatrix[0].xyz), 1.0);
  vAlpha *= mix(0.45, 1.0, smoothstep(-0.9, 0.6, back));

  gl_Position = projectionMatrix * mv;
}
