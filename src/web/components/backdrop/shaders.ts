import type { ShaderId } from "../../design/scenes";

/**
 * Fragment shaders for the scene backgrounds (GLSL ES 3.00, WebGL2). Every scene writes one
 * function, `vec3 sceneColor(vec2 css)`, where `css` is the pixel in CSS pixels from the window's
 * top-left — the same space as the island dot grid, so a scene can line its art up with it.
 *
 * Colours never appear here: each scene reads `u_c[0..4]`, filled from that scene's
 * `--scene-c0..c4` tokens. Shared inputs:
 *   u_res    viewport size in CSS pixels
 *   u_time   scene clock in seconds (slowed by the "calm" motion level, frozen by "still")
 *   u_mouse  pointer in CSS pixels, or negative when the pointer is away
 *   u_pan    canvas pan in CSS pixels, for a little parallax
 *   u_pulse  xy = where a live update landed (CSS px), z = its age in seconds (< 0 = none)
 *   u_px     CSS pixels per dither cell (1 for smooth scenes)
 */
const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec2 u_buf;
uniform float u_scale;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_pan;
uniform vec3 u_pulse;
uniform vec3 u_c[5];
uniform float u_px;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

/** The dither cell a pixel belongs to, and that cell's centre in CSS pixels. */
vec2 cellOf(vec2 css) { return floor(css / u_px); }
vec2 cellCentre(vec2 css) { return (floor(css / u_px) + 0.5) * u_px; }

/**
 * Maps 0..1 onto the five scene colours, ordered-dithering between the two neighbours a value
 * falls between. Only adjacent colours ever mix, so a smooth field reads as a smooth gradient
 * with the dither grain on top, never as noise.
 */
vec3 ditherRamp(float v, vec2 cell) {
  float level = clamp(v, 0.0, 1.0) * 3.999;
  float base = floor(level);
  int i = int(base + step(bayer8(cell), level - base));
  return u_c[i];
}

float mouseGlow(vec2 css, float radius) {
  if (u_mouse.x < 0.0) return 0.0;
  vec2 d = css - u_mouse;
  return exp(-dot(d, d) / (radius * radius));
}

/** A ring that spreads from where a live update landed, fading as it grows. */
float pulseRing(vec2 css) {
  float age = u_pulse.z;
  if (age < 0.0 || age > 2.6) return 0.0;
  float r = age * 480.0;
  float d = abs(length(css - u_pulse.xy) - r);
  return exp(-d * d / 900.0) * (1.0 - age / 2.6);
}

vec3 sceneColor(vec2 css);

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_buf.y - gl_FragCoord.y) / u_scale;
  outColor = vec4(clamp(sceneColor(css), 0.0, 1.0), 1.0);
}
`;

const SCENES: Record<ShaderId, string> = {
  aurora: /* glsl */ `
vec3 sceneColor(vec2 css) {
  vec2 uv = css / u_res.y;
  vec2 p = uv - u_pan * 0.00008;
  float t = u_time * 0.05;
  vec3 col = mix(u_c[0], u_c[1], smoothstep(0.0, 1.2, uv.y));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float line = 0.2 + fi * 0.16
      + 0.08 * sin(p.x * 2.1 + t * 3.0 + fi * 1.9)
      + 0.16 * (fbm(vec2(p.x * 1.2 + fi * 7.0, t + fi)) - 0.5);
    float d = p.y - line;
    float band = d > 0.0 ? exp(-d * 6.0) : exp(d * 38.0);
    float streak = 0.45 + 0.55 * fbm(vec2(p.x * 26.0 + fi * 3.0, t * 3.0));
    vec3 tint = i == 0 ? u_c[2] : (i == 1 ? u_c[3] : u_c[4]);
    col += tint * band * streak * (0.42 - fi * 0.08) * (1.0 + mouseGlow(css, 300.0) * 0.8);
  }
  float star = step(0.9978, hash(floor(css / 2.5)));
  col += star * (0.5 + 0.5 * sin(u_time * 2.0 + hash(floor(css)) * 40.0)) * (1.0 - smoothstep(0.0, 0.7, uv.y)) * 0.55;
  col += u_c[2] * pulseRing(css) * 0.45;
  vec2 v = css / u_res - 0.5;
  col *= 1.0 - dot(v, v) * 0.7;
  return col;
}
`,
  nebula: /* glsl */ `
vec3 starLayer(vec2 css, float cell, float seed, float twinkle) {
  vec2 g = floor(css / cell);
  vec2 f = fract(css / cell) - 0.5;
  float h = hash(g + seed);
  vec2 o = vec2(hash(g + seed + 1.3), hash(g + seed + 7.1)) - 0.5;
  float d = length(f - o * 0.7) * cell;
  float size = mix(0.6, 1.8, h * h);
  float b = exp(-d * d / (size * size)) * step(0.55, h);
  b *= 0.65 + 0.35 * sin(u_time * twinkle + h * 50.0);
  return mix(vec3(1.0), u_c[4], h) * b;
}

vec3 sceneColor(vec2 css) {
  vec2 p = (css - u_pan * 0.15) / u_res.y;
  float t = u_time * 0.015;
  float n1 = fbm(p * 1.5 + vec2(t, -t) + fbm(p * 2.2 + t) * 1.3);
  float n2 = fbm(p * 2.7 - vec2(t * 1.3, 0.0) + 4.0);
  vec3 col = u_c[0];
  col = mix(col, u_c[1], smoothstep(0.25, 0.8, n1) * 0.9);
  col = mix(col, u_c[2], smoothstep(0.45, 0.95, n1 * n2 * 1.7) * 0.55);
  col += u_c[3] * pow(smoothstep(0.5, 1.0, n2), 3.0) * 0.4;
  col += u_c[2] * mouseGlow(css, 280.0) * 0.18;
  col += starLayer(css - u_pan * 0.05, 70.0, 0.0, 1.7) * 0.9;
  col += starLayer(css - u_pan * 0.25, 38.0, 19.0, 3.1) * 0.55;
  col += u_c[4] * pulseRing(css) * 0.4;
  return col;
}
`,
  abyss: /* glsl */ `
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

vec3 sceneColor(vec2 css) {
  vec2 uv = css / u_res;
  vec2 p = (css - u_pan * 0.2) / 900.0;
  float depth = uv.y;
  vec3 col = mix(u_c[1], u_c[0], smoothstep(0.0, 1.0, depth));
  float c = caustic(p, u_time * 0.35 + 23.0);
  col += u_c[2] * c * 0.32 * (1.15 - depth);
  float rays = fbm(vec2(css.x / 140.0 + css.y / 600.0, u_time * 0.05));
  col += u_c[3] * pow(rays, 3.0) * 0.16 * (1.0 - depth);
  vec2 g = floor(css / 90.0);
  vec2 f = fract(css / 90.0) - 0.5;
  float h = hash(g);
  vec2 drift = vec2(sin(u_time * 0.3 + h * 6.0), cos(u_time * 0.23 + h * 9.0)) * 0.25;
  float spark = exp(-dot(f - drift, f - drift) * 900.0) * step(0.86, h);
  col += u_c[4] * spark * (0.5 + 0.5 * sin(u_time * 1.4 + h * 30.0));
  col += u_c[3] * mouseGlow(css, 240.0) * 0.14;
  col += u_c[2] * pulseRing(css) * 0.5;
  return col;
}
`,
  synthwave: /* glsl */ `
vec3 sceneColor(vec2 css) {
  vec2 uv = vec2(css.x - 0.5 * u_res.x - u_pan.x * 0.04, css.y) / u_res.y;
  float horizon = 0.66;
  vec3 col;
  if (uv.y < horizon) {
    float k = uv.y / horizon;
    col = mix(u_c[0], u_c[1], pow(k, 1.8));
    vec2 sc = vec2(0.0, horizon - 0.15);
    float r = 0.21;
    float d = length(uv - sc);
    float sy = clamp((uv.y - (sc.y - r)) / (2.0 * r), 0.0, 1.0);
    vec3 sun = mix(u_c[2], u_c[3], sy);
    float gap = smoothstep(0.42, 1.0, sy) * 0.55;
    float stripe = step(gap, fract(uv.y * 34.0 - u_time * 0.25));
    float disc = smoothstep(r + 0.002, r - 0.002, d);
    col = mix(col, sun, disc * stripe * 0.85);
    col += u_c[3] * exp(-max(d - r, 0.0) * 7.0) * 0.22;
    float star = step(0.998, hash(floor(css / 2.0))) * (1.0 - k);
    col += star * 0.6;
  } else {
    float y = uv.y - horizon;
    float z = 0.14 / max(y, 0.0004);
    vec2 g = vec2(uv.x * z * 2.2, z + u_time * 0.55);
    vec2 w = fwidth(g);
    vec2 a = abs(fract(g - 0.5) - 0.5) / max(w, 0.0001);
    float line = 1.0 - min(min(a.x, a.y), 1.0);
    float fade = smoothstep(0.0, 0.12, y);
    col = mix(u_c[1] * 0.35, u_c[0], smoothstep(0.0, 0.3, y));
    col += u_c[4] * line * (0.25 + 0.55 * fade) * (1.0 + mouseGlow(css, 220.0) * 1.5);
    col += u_c[3] * exp(-y * 30.0) * 0.5;
    col += u_c[4] * pulseRing(css) * 0.6;
  }
  return col;
}
`,
  ember: /* glsl */ `
vec3 sceneColor(vec2 css) {
  float px = 3.0;
  vec2 cell = floor(css / px);
  vec2 cp = cell * px;
  vec2 uv = cp / u_res.y;
  float t = u_time * 0.07;
  float heat = fbm(vec2(uv.x * 2.4, uv.y * 1.6 + t * 2.0) + fbm(uv * 3.0 - vec2(0.0, t * 3.0)) * 0.9);
  heat *= smoothstep(-0.2, 1.1, cp.y / u_res.y);
  heat = pow(heat, 1.45) * 1.25 + mouseGlow(cp, 200.0) * 0.45 + pulseRing(cp) * 0.6;
  float level = clamp(heat, 0.0, 1.0) * 4.0 + bayer8(cell) - 0.5;
  int idx = int(clamp(floor(level), 0.0, 4.0));
  return u_c[idx];
}
`,
  sorbet: /* glsl */ `
vec3 sceneColor(vec2 css) {
  vec2 uv = css / u_res.y;
  float t = u_time * 0.06;
  vec2 q = uv + 0.09 * vec2(fbm(uv * 1.8 + t), fbm(uv * 1.8 - t + 3.0));
  float aspect = u_res.x / u_res.y;
  vec2 m = u_mouse.x < 0.0 ? vec2(aspect * 0.8, 0.75) : u_mouse / u_res.y;
  vec2 pts[4];
  pts[0] = vec2(aspect * (0.2 + 0.08 * sin(t * 1.3)), 0.25 + 0.1 * cos(t * 1.1));
  pts[1] = vec2(aspect * (0.78 + 0.07 * cos(t * 0.9)), 0.2 + 0.12 * sin(t * 1.4));
  pts[2] = vec2(aspect * (0.35 + 0.1 * cos(t * 0.7)), 0.85 + 0.08 * sin(t));
  pts[3] = mix(pts[1], m, 0.35) + vec2(0.0, 0.4);
  vec3 col = u_c[0] * 0.6;
  float total = 0.6;
  for (int i = 0; i < 4; i++) {
    vec2 d = q - pts[i];
    float w = exp(-dot(d, d) * 5.0);
    col += u_c[i + 1] * w;
    total += w;
  }
  col /= total;
  col += (u_c[1] - u_c[0]) * pulseRing(css) * 0.4;
  col += (hash(css) - 0.5) * 0.04;
  return col;
}
`,
  riso: /* glsl */ `
float dotLayer(vec2 css, vec2 offset, float seed, float t) {
  vec2 local = css - offset - 14.0;
  vec2 cell = floor(local / 28.0 + 0.5);
  vec2 centre = cell * 28.0 + 14.0 + offset;
  float v = fbm(centre / 340.0 + vec2(t, seed));
  v = smoothstep(0.38, 0.82, v);
  v += mouseGlow(centre, 170.0) * 0.75 + pulseRing(centre) * 0.9;
  float r = mix(0.9, 7.5, clamp(v, 0.0, 1.0));
  float d = length(css - centre);
  return 1.0 - smoothstep(r - 0.75, r + 0.75, d);
}

vec3 sceneColor(vec2 css) {
  float t = u_time * 0.035;
  float pink = dotLayer(css, vec2(0.0), 0.0, t);
  float blue = dotLayer(css, vec2(4.0, 3.0), 11.0, t * 1.2);
  vec3 col = u_c[0];
  col *= mix(vec3(1.0), u_c[1], pink * 0.5);
  col *= mix(vec3(1.0), u_c[2], blue * 0.42);
  col -= (hash(floor(css)) - 0.5) * 0.03;
  return col;
}
`,
  topo: /* glsl */ `
vec3 sceneColor(vec2 css) {
  vec2 p = (css - u_pan * 0.2) / 460.0;
  if (u_mouse.x >= 0.0) {
    vec2 m = (u_mouse - u_pan * 0.2) / 460.0;
    p = mix(p, m, mouseGlow(css, 180.0) * 0.35);
  }
  float h = fbm(p + vec2(u_time * 0.008, 0.0)) + 0.35 * fbm(p * 2.3 - u_time * 0.006);
  h += pulseRing(css) * 0.03;
  vec3 col = mix(u_c[3], u_c[4], smoothstep(0.35, 0.85, h));
  col = mix(u_c[0], col, 0.6);
  float lv = h * 16.0;
  float f = abs(fract(lv) - 0.5);
  float w = fwidth(lv);
  bool major = mod(floor(lv + 0.5), 5.0) == 0.0;
  float width = major ? 1.3 : 0.7;
  float line = 1.0 - smoothstep(w * width * 0.5, w * width, f);
  col = mix(col, major ? u_c[2] : u_c[1], line * (major ? 0.7 : 0.45));
  return col;
}
`,
  dawn: /* glsl */ `
vec3 sceneColor(vec2 css) {
  float px = 4.0;
  vec2 cell = floor(css / px);
  vec2 cp = cell * px;
  vec2 uv = cp / u_res;
  float t = u_time * 0.02;
  float cloud = fbm(vec2(cp.x / 360.0 + t, cp.y / 160.0));
  float v = uv.y * 0.9 + (cloud - 0.5) * 0.45 + mouseGlow(cp, 220.0) * 0.18 - pulseRing(cp) * 0.25;
  float level = clamp(v, 0.0, 0.999) * 5.0 + (bayer8(cell) - 0.5) * 0.9;
  int idx = int(clamp(floor(level), 0.0, 4.0));
  vec3 ramp[5];
  ramp[0] = u_c[3];
  ramp[1] = u_c[4];
  ramp[2] = u_c[0];
  ramp[3] = u_c[1];
  ramp[4] = u_c[2];
  return ramp[idx];
}
`,
};

export function fragmentSource(id: ShaderId): string {
  return PRELUDE + SCENES[id];
}

export const VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
