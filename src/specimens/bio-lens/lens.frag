// OM—006 BIO LENS — fragment
// Looking through a living transparent material:
//  · three refracted rays (R, G, B at different indices) → chromatic edges
//  · each ray passes an inner focusing core (analytic sphere) that drifts
//    toward the cursor and changes size with the iris, then exits through
//    the outer body (second interface) into the shared studio
//  · an iris ring where the view grazes the core, with radial striations
//  · small suspended bubbles, traced analytically along the ray
//  · wet glossy surface: Fresnel reflections and sharp catchlights

uniform vec3 uCoreC;
uniform float uCoreR;
uniform float uIris;
uniform float uDistort;
uniform mat4 modelMatrix;

varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vNormalW;
varying vec3 vNormalL;

float hitSphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}

vec3 throughLens(vec3 pos, vec3 Vl, vec3 Nl, float ior) {
  vec3 rd = refract(-Vl, Nl, 1.0 / ior);
  float th = hitSphere(pos, rd, uCoreC, uCoreR);
  if (th > 0.0) {
    vec3 hp = pos + rd * th;
    rd = refract(rd, normalize(hp - uCoreC), 1.0 / (1.18 + uDistort * 0.2));
    pos = hp;
  }
  float b = dot(pos, rd);
  float t = -b + sqrt(max(b * b - (dot(pos, pos) - 1.0), 0.0));
  vec3 nb = normalize(pos + rd * max(t, 0.02));
  vec3 o = refract(rd, -nb, ior);
  if (dot(o, o) < 1e-4) o = reflect(rd, -nb);
  return normalize(mat3(modelMatrix) * o);
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = sat(dot(N, V));
  float g = 1.0 - NdV;
  vec3 Vl = normalize(uCamL - vPosL);
  vec3 Nl = normalize(vNormalL);

  float spread = 0.022 + g * 0.03 + uDistort * 0.01;
  vec3 col;
  col.r = envMap(throughLens(vPosL, Vl, Nl, 1.34 - spread)).r;
  col.g = envMap(throughLens(vPosL, Vl, Nl, 1.34)).g;
  col.b = envMap(throughLens(vPosL, Vl, Nl, 1.34 + spread)).b;
  col *= mix(vec3(1.0), srgb(vec3(0.84, 0.88, 1.0)), 0.55);

  // iris: where the view grazes the focusing core
  vec3 rd = refract(-Vl, Nl, 1.0 / 1.34);
  vec3 toC = uCoreC - vPosL;
  float along = dot(toC, rd);
  vec3 closest = vPosL + rd * along;
  float dc = length(closest - uCoreC);
  vec3 axisX = normalize(cross(rd, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 axisY = cross(rd, axisX);
  vec3 rel = closest - uCoreC;
  float ang = atan(dot(rel, axisY), dot(rel, axisX));
  float stria = 0.55 + 0.45 * sin(ang * 46.0 + snoise(vec3(ang * 3.0, uIdle * 0.2, 0.0)) * 2.0);
  float ring = exp(-pow((dc - uCoreR) / (0.018 + uIris * 0.01), 2.0)) * step(0.0, along);
  vec3 violet = srgb(vec3(0.42, 0.28, 0.95));
  vec3 blue = srgb(vec3(0.2, 0.45, 1.0));
  col = mix(col, mix(blue, violet, stria) * (0.5 + 0.6 * stria), ring * 0.55);

  // suspended bubbles along the main ray
  float bub = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec3 h = hash33(vec3(fi, 3.7, 9.1));
    vec3 c = (h - 0.5) * 1.1;
    c += 0.12 * vec3(sin(uIdle * (0.2 + h.x * 0.3) + fi), cos(uIdle * (0.17 + h.y * 0.3) + fi * 2.0), sin(uIdle * 0.13 + fi * 3.0));
    float r = 0.025 + h.z * 0.05;
    float tb = hitSphere(vPosL, rd, c, r);
    if (tb > 0.0) {
      vec3 n = normalize(vPosL + rd * tb - c);
      float rim = pow(1.0 - abs(dot(n, rd)), 2.0);
      bub = max(bub, rim);
    }
  }
  col = mix(col, vec3(0.95, 0.97, 1.0), bub * 0.7);
  col *= 1.0 - bub * 0.1;

  // wet surface
  vec3 R = reflect(-V, N);
  float F = fresnel(NdV, 0.035);
  vec3 film = thinFilm(NdV, 0.42 + uIris * 0.2);
  col = mix(col, envMap(R) * mix(vec3(1.0), film, 0.4), F);
  col += pow(sat(envMap(R).g - 1.8), 1.5) * 0.25;

  // scan: optical power — fringes of how strongly the lens bends the view
  float rev = scanReveal(vPosL.y);
  float bend = length(rd + Vl);
  float fringe = 0.5 + 0.5 * sin(bend * 70.0 - uIdle * 2.0);
  vec3 xray = mix(srgb(vec3(0.92, 0.94, 1.0)), violet, fringe * smoothstep(0.02, 0.4, bend));
  col = mix(col, xray, rev * 0.8);
  col += violet * scanLine(vPosL.y);

  gl_FragColor = vec4(toDisplay(col), uOpacity);
}
