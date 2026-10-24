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
  mesh: /* glsl */ `
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
