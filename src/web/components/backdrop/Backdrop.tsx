import { useEffect, useRef } from "react";
import { sceneFor, type Scene } from "../../design/scenes";
import { useCodeHQStore, type CodeHQStore, type MotionLevel } from "../../store/useCodeHQStore";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { fragmentSource, VERTEX_SOURCE } from "./shaders";
import { readCssColor } from "./cssColor";
import styles from "./Backdrop.module.css";

/** Smooth scenes render below device resolution: the art is soft, and this keeps it cheap. */
const SMOOTH_SCALE = 0.5;
const TIME_SCALE: Record<MotionLevel, number> = { full: 1, calm: 0.35, still: 0 };
/** The live-update ripple the shaders draw; see `pulseRing` in shaders.ts. */
export const PULSE_EVENT = "hqflow:pulse";

export interface PulseDetail {
  x: number;
  y: number;
}

/** Sends a ripple through the scene background from a point in window CSS pixels. */
export function emitScenePulse(detail: PulseDetail): void {
  window.dispatchEvent(new CustomEvent<PulseDetail>(PULSE_EVENT, { detail }));
}

function toggleAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

export function activeScene(state: Pick<CodeHQStore, "theme" | "darkScene" | "lightScene">): Scene {
  return sceneFor(state.theme === "dark" ? state.darkScene : state.lightScene, state.theme);
}

/**
 * Writes the active scene and motion level onto `<html>`. It runs from a store
 * subscription, not an effect, so the document already shows the new scene by the time any
 * component re-renders and reads a colour back from it.
 */
function applyAppearance(state: CodeHQStore): void {
  const root = document.documentElement;
  const scene = activeScene(state);
  root.setAttribute("data-theme", state.theme);
  root.setAttribute("data-scene", scene.id);
  root.setAttribute("data-motion", prefersReducedMotion() ? "still" : state.motion);
  toggleAttribute(root, "data-scene-shader", scene.shader !== null && supportsWebGL2() ? "" : null);
}

/**
 * Paints a shader scene's background with WebGL2 behind every surface. The document-level scene
 * attributes are kept in sync by `applyAppearance` above, so without WebGL2 the scene's colours
 * still apply over the plain dot field.
 */
export function Backdrop() {
  const scene = useCodeHQStore(activeScene);
  const motion = useCodeHQStore((state) => state.motion);
  const reducedMotion = usePrefersReducedMotion();
  return scene.shader !== null ? <ShaderCanvas key={scene.id} scene={scene} motion={reducedMotion ? "still" : motion} /> : null;
}

let webgl2: boolean | undefined;
function supportsWebGL2(): boolean {
  if (webgl2 === undefined) {
    try {
      webgl2 = document.createElement("canvas").getContext("webgl2") !== null;
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  // A driver that rejects a scene just leaves the plain scene colours behind the app.
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function ShaderCanvas({ scene, motion }: { scene: Scene; motion: MotionLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef(motion);
  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" }) ?? null;
    if (canvas === null || gl === null || scene.shader === null) {
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource(scene.shader));
    const program = gl.createProgram();
    if (vs === null || fs === null || program === null) {
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      res: uniform("u_res"),
      buf: uniform("u_buf"),
      scale: uniform("u_scale"),
      time: uniform("u_time"),
      mouse: uniform("u_mouse"),
      pan: uniform("u_pan"),
      pulse: uniform("u_pulse"),
      colors: uniform("u_c"),
    };

    // Scene colours come from the scene's own tokens, so the shader never carries a literal.
    const colors = new Float32Array(15);
    for (let i = 0; i < 5; i += 1) {
      const [r, g, b] = readCssColor(`var(--scene-c${i})`);
      colors.set([r / 255, g / 255, b / 255], i * 3);
    }
    gl.uniform3fv(u.colors, colors);

    const mouse = { x: -1, y: -1, tx: -1, ty: -1 };
    let pulse = { x: 0, y: 0, start: -1 };
    let pan = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      mouse.tx = event.clientX;
      mouse.ty = event.clientY;
      if (mouse.x < 0) {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
      }
    };
    const onPointerLeave = () => {
      mouse.x = mouse.y = mouse.tx = mouse.ty = -1;
    };
    const onPulse = (event: Event) => {
      const { x, y } = (event as CustomEvent<PulseDetail>).detail;
      pulse = { x, y, start: performance.now() };
    };
    window.addEventListener("pointermove", onPointerMove);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener(PULSE_EVENT, onPulse);

    const resize = () => {
      // Scenes render below device resolution; they are soft, so it is not visible.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = SMOOTH_SCALE * dpr;
      canvas.width = Math.max(1, Math.ceil(window.innerWidth * scale));
      canvas.height = Math.max(1, Math.ceil(window.innerHeight * scale));
      canvas.style.width = `${canvas.width / scale}px`;
      canvas.style.height = `${canvas.height / scale}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, window.innerWidth, window.innerHeight);
      gl.uniform2f(u.buf, canvas.width, canvas.height);
      gl.uniform1f(u.scale, scale);
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let sceneTime = 0;
    let last = performance.now();
    let lastDraw = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const speed = TIME_SCALE[motionRef.current];
      const delta = Math.min(now - last, 100);
      last = now;
      sceneTime += (delta / 1000) * speed;
      if (document.hidden) return;
      // A still scene redraws only for the pointer and ripples, and never faster than ~30fps.
      if (speed === 0 && now - lastDraw < 33) return;
      lastDraw = now;
      if (mouse.x >= 0) {
        mouse.x += (mouse.tx - mouse.x) * 0.12;
        mouse.y += (mouse.ty - mouse.y) * 0.12;
      }
      const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
      const match = viewport?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
      if (match) {
        pan = { x: Number(match[1]), y: Number(match[2]) };
      }
      gl.uniform1f(u.time, sceneTime + 40);
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.uniform2f(u.pan, pan.x, pan.y);
      gl.uniform3f(u.pulse, pulse.x, pulse.y, pulse.start < 0 ? -1 : (now - pulse.start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener(PULSE_EVENT, onPulse);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [scene]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas}`}
      data-scene-canvas={scene.id}
      aria-hidden="true"
    />
  );
}

// Last, so every helper above is initialised before the first write.
if (typeof document !== "undefined") {
  applyAppearance(useCodeHQStore.getState());
  useCodeHQStore.subscribe(applyAppearance);
}
