/* ==========================================================================
   HQFlow landing page runtime

   Two pieces:
     1. the feature walkthrough around the embedded production canvas
     2. the halftone prints: each section's figure, printed in dots
   ========================================================================== */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ==========================================================================
   HALFTONE PRINTS
   Each [data-print] host gets one canvas: a drawing painted offscreen, then
   printed as dots whose size follows the painted alpha. Inks come from the
   --print-* tokens in styles.css. The prints are static, so reduced motion
   needs nothing special; they redraw when the layout width changes.
   ========================================================================== */

function readInks() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(name).trim();
  return {
    ink: get("--print-ink"),
    grey: get("--print-grey"),
    soft: get("--print-soft-rgb").split(/[\s,]+/).join(","),
    night: get("--print-night"),
  };
}

function dotPrint({ width, height, step = 5, draw, fade }) {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const o = off.getContext("2d", { willReadFrequently: true });
  draw(o, w, h);
  const data = o.getImageData(0, 0, w, h).data;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const paths = new Map();
  for (let row = 0, y = step / 2; y < h; y += step, row++) {
    for (let x = row % 2 ? step : step / 2; x < w; x += step) {
      const i = ((y | 0) * w + (x | 0)) * 4;
      const a = data[i + 3] / 255;
      if (a < 0.04) continue;
      const r = step * 0.5 * Math.sqrt(a) * 0.92 * (fade ? fade(x, y, w, h) : 1);
      if (r < 0.45) continue;
      const key = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
      if (!paths.has(key)) paths.set(key, new Path2D());
      const p = paths.get(key);
      p.moveTo(x + r, y);
      p.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  for (const [color, p] of paths) { ctx.fillStyle = color; ctx.fill(p); }
  return canvas;
}

/* Strokes an inline icon SVG (path, rect, circle children) onto a canvas at (x, y), `size` wide. */
function drawSVG(o, svg, x, y, size, color, weight = 1) {
  const vb = (svg.getAttribute("viewBox") || "0 0 24 24").trim().split(/[\s,]+/).map(Number);
  const s = size / vb[2];
  o.save();
  o.translate(x, y);
  o.scale(s, s);
  o.translate(-vb[0], -vb[1]);
  o.strokeStyle = color;
  o.lineWidth = Number(svg.getAttribute("stroke-width") || 1.5) * weight;
  o.lineCap = "round";
  o.lineJoin = "round";
  const num = (node, attr) => Number(node.getAttribute(attr) || 0);
  for (const node of svg.querySelectorAll("path, rect, circle")) {
    const p = new Path2D();
    if (node.tagName === "path") p.addPath(new Path2D(node.getAttribute("d")));
    else if (node.tagName === "rect") p.roundRect(num(node, "x"), num(node, "y"), num(node, "width"), num(node, "height"), num(node, "rx"));
    else p.arc(num(node, "cx"), num(node, "cy"), num(node, "r"), 0, Math.PI * 2);
    o.stroke(p);
  }
  o.restore();
}

const rr = (o, x, y, w, h, r) => { o.beginPath(); o.roundRect(x, y, w, h, r); o.fill(); };

const dome = (o, inks, cx, cy, R, alpha) => {
  const g = o.createRadialGradient(cx - R * 0.2, cy - R * 0.45, R * 0.05, cx, cy, R);
  g.addColorStop(0, `rgba(${inks.soft},${alpha * 0.25})`);
  g.addColorStop(0.75, `rgba(${inks.soft},${alpha * 0.45})`);
  g.addColorStop(0.97, `rgba(${inks.soft},${alpha})`);
  g.addColorStop(1, `rgba(${inks.soft},0)`);
  o.fillStyle = g;
  o.beginPath(); o.arc(cx, cy, R, 0, Math.PI * 2); o.fill();
};

/* One recipe per data-print value: the print's size and step, and what it draws. */
const PRINTS = {
  /* why: a wall of code */
  code: (host, inks) => ({
    draw(o, w) {
      o.fillStyle = inks.grey;
      const s = Math.min(1, w / 168); // the card's print panel narrows on a phone
      const lines = [[0, .5], [1, .72], [1, .44], [2, .64], [2, .36], [1, .56], [0, .3], [1, .68], [2, .5]];
      lines.forEach(([ind, f], i) => rr(o, (30 + ind * 22) * s, 20 + i * 15, (w - 90 * s) * f, 9, 4));
    },
    fade: (x, y, w, h) => 1 - (y / h) * 0.7,
  }),

  /* why: a stack of docs */
  docs: (host, inks) => ({
    draw(o, w, h) {
      const x = w / 2 - 60;
      [[x - 26, 34, .35], [x - 13, 22, .6], [x, 10, 1]].forEach(([px, py, a]) => {
        o.globalAlpha = a; o.fillStyle = inks.grey; rr(o, px, py, 120, h - 30, 6);
        o.globalCompositeOperation = "destination-out"; rr(o, px + 4, py + 4, 112, h - 38, 4);
        o.globalCompositeOperation = "source-over";
      });
      o.globalAlpha = 1; o.fillStyle = inks.grey;
      [.8, .6, .75, .5, .7, .4].forEach((f, i) => rr(o, x + 14, 26 + i * 16, 92 * f, 7, 3));
    },
  }),

  /* map: the shadow under the tipped pull request, a flat disc seen low */
  shadow: () => ({
    step: 6,
    draw(o, w, h) {
      o.save(); o.translate(w / 2, h / 2); o.scale(1, h / w);
      const g = o.createRadialGradient(0, 0, w * 0.1, 0, 0, w / 2);
      g.addColorStop(0, "rgba(10,10,10,.5)"); g.addColorStop(1, "rgba(10,10,10,0)");
      o.fillStyle = g; o.beginPath(); o.arc(0, 0, w / 2, 0, Math.PI * 2); o.fill(); o.restore();
    },
  }),

  /* trust: the host's own icon, printed large */
  icon: (host, inks) => {
    const icon = host.querySelector("svg");
    return {
      step: 4,
      draw(o, w, h) {
        dome(o, inks, w / 2, h * 1.05, h * 0.82, 0.45);
        drawSVG(o, icon, w / 2 - 46, h / 2 - 50, 92, inks.ink, 1.7);
      },
    };
  },

  /* footer: the wordmark, at most ~80% of the footer's width so it never crops on a phone */
  word: (host, inks) => {
    const size = Math.round(Math.min(230, host.clientWidth / 4.4));
    const font = `600 ${size}px "Inter Tight"`;
    return {
      font,
      width: host.clientWidth, height: size, step: size < 120 ? 4 : 6,
      draw(o, w, h) {
        o.font = font; o.textAlign = "center"; o.textBaseline = "alphabetic"; o.fillStyle = inks.night;
        o.fillText("HQFlow", w / 2, h * 0.85);
      },
      fade: (x, y, w, h) => 0.35 + 0.65 * (1 - y / h),
    };
  },
};

function initPrints() {
  const hosts = Array.from(document.querySelectorAll("[data-print]"));
  if (!hosts.length) return;

  const printAll = () => {
    const inks = readInks();
    for (const host of hosts) {
      const recipe = PRINTS[host.dataset.print]?.(host, inks);
      if (!recipe) continue;
      const paint = () => {
        const canvas = dotPrint({ width: host.clientWidth, height: host.clientHeight, step: 5, ...recipe });
        host.querySelector(":scope > canvas")?.remove();
        host.append(canvas);
      };
      if (recipe.font) document.fonts.load(recipe.font).then(paint, paint);
      else paint();
    }
  };
  printAll();

  /* Redraw only when the width changes: mobile browsers resize the height as their toolbars move. */
  let width = window.innerWidth, timer = 0;
  window.addEventListener("resize", () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    clearTimeout(timer);
    timer = window.setTimeout(printAll, 150);
  });
}

/* ==========================================================================
   FEATURE WALKTHROUGH
   ========================================================================== */

const TOUR_INSTRUCTIONS = {
  draw: "Your agent saves the workflow file. HQFlow draws each step as it lands.",
  details: "Click “Agent Maps Code” to inspect its real sources, inputs, outputs, and agent boundary.",
  trace: "Hover “Agent Maps Code.” HQFlow strengthens its visible path and quiets everything else.",
  arrange: "Drag a card to reshape the flow. The edges follow.",
  export: "Export the complete diagram as a PNG, or take an interactive HTML snapshot offline.",
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadInteractiveDemo() {
  const demoUrl = new URL("demo.html", window.location.href);
  const demoResponse = await fetch(demoUrl);
  if (!demoResponse.ok) throw new Error("The interactive demo could not be loaded.");
  const demoDocument = new DOMParser().parseFromString(await demoResponse.text(), "text/html");
  const moduleScript = demoDocument.querySelector('script[type="module"][src]');
  const styleLinks = Array.from(demoDocument.querySelectorAll('link[rel="stylesheet"][href]'));
  const preloadLinks = Array.from(demoDocument.querySelectorAll('link[rel="modulepreload"][href]'));
  if (!moduleScript) throw new Error("The interactive demo bundle was not found.");

  const styles = await Promise.all(styleLinks.map(async (link) => {
    const response = await fetch(new URL(link.getAttribute("href"), demoUrl));
    if (!response.ok) throw new Error("The interactive demo styles could not be loaded.");
    return response.text();
  }));
  const preloadModules = await Promise.all(preloadLinks.map(async (link) => {
    const href = link.getAttribute("href");
    const response = await fetch(new URL(href, demoUrl));
    if (!response.ok) throw new Error("The interactive demo support bundle could not be loaded.");
    return { href, source: await response.text() };
  }));
  const moduleResponse = await fetch(new URL(moduleScript.getAttribute("src"), demoUrl));
  if (!moduleResponse.ok) throw new Error("The interactive demo bundle could not be loaded.");
  let moduleSource = await moduleResponse.text();
  for (const preload of preloadModules) {
    const filename = preload.href.split("/").pop();
    moduleSource = moduleSource.replace(`import${JSON.stringify(`./${filename}`)};`, `${preload.source}\n`);
  }

  const safeStyles = styles.join("\n").replace(/<\/style/gi, "<\\/style");
  const safeModule = moduleSource.replace(/<\/script/gi, "<\\/script");
  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>How HQFlow Works — Interactive HQFlow Demo</title>
<style>${safeStyles}</style>
</head>
<body>
<div id="root"></div>
<script type="module">${safeModule}<\/script>
</body>
</html>`;
  downloadBlob(new Blob([html], { type: "text/html" }), "how-hqflow-works.html");
}

function initWalkthrough() {
  const tabs = Array.from(document.querySelectorAll("[data-tour-step]"));
  const instructionLabel = document.querySelector("#tourInstruction span");
  const instruction = document.querySelector("#tourInstruction strong");
  const exportPreview = document.getElementById("tourExport");
  const frame = document.querySelector(".tour-frame");
  const formatInputs = Array.from(document.querySelectorAll('input[name="tour-export-format"]'));
  const downloadButton = document.getElementById("tourExportDownload");
  const error = document.getElementById("tourExportError");
  if (!tabs.length || !instructionLabel || !instruction || !exportPreview || !frame || !formatInputs.length || !downloadButton || !error) return;

  /* The one canvas draws itself first (tab "draw"), then hosts the feature tour. */
  const tell = (command) => frame.contentWindow?.postMessage({ type: "hqflow-demo", command }, window.location.origin);
  const tabFor = (step) => tabs.find((tab) => tab.dataset.tourStep === step);

  const activate = (tab) => {
    const step = tab.dataset.tourStep;
    if (!step || !(step in TOUR_INSTRUCTIONS)) return;
    tell(step === "draw" ? "replay" : "finish");
    instructionLabel.textContent = step === "draw" ? "Live" : "Try it";
    for (const candidate of tabs) {
      const active = candidate === tab;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
    }
    instruction.textContent = TOUR_INSTRUCTIONS[step];
    const showExport = step === "export";
    exportPreview.classList.toggle("is-visible", showExport);
    exportPreview.setAttribute("aria-hidden", String(!showExport));
    if (showExport) exportPreview.querySelector("input:checked")?.focus();
  };

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "hqflow-demo") return;
    if (event.data.event === "export") activate(tabFor("export"));
    else if (event.data.event === "drawn" && tabFor("draw")?.classList.contains("is-active")) activate(tabFor("details"));
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      activate(next);
      next.focus();
      event.preventDefault();
    });
  });

  const updateFormat = () => {
    const selected = formatInputs.find((input) => input.checked)?.value ?? "image";
    for (const input of formatInputs) input.closest(".tour-export-option")?.classList.toggle("is-selected", input.checked);
    downloadButton.textContent = selected === "html" ? "Download HTML" : "Download image";
    error.hidden = true;
  };
  formatInputs.forEach((input) => input.addEventListener("change", updateFormat));

  document.querySelectorAll("[data-export-close]").forEach((button) => {
    button.addEventListener("click", () => activate(tabFor("details")));
  });

  downloadButton.addEventListener("click", async () => {
    const format = formatInputs.find((input) => input.checked)?.value ?? "image";
    const originalLabel = downloadButton.textContent;
    downloadButton.disabled = true;
    downloadButton.textContent = "Preparing…";
    error.hidden = true;
    try {
      if (format === "html") {
        await downloadInteractiveDemo();
      } else {
        const frameDocument = frame.contentDocument;
        const exportButton = frameDocument?.querySelector('button[aria-label="Export canvas"]');
        if (!exportButton) throw new Error("The canvas is still loading. Try again in a moment.");
        exportButton.click();
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        const imageButton = Array.from(frameDocument.querySelectorAll("button"))
          .find((button) => button.textContent?.trim() === "Download image");
        if (!imageButton) throw new Error("The image exporter could not be opened.");
        imageButton.click();
      }
    } catch (exportError) {
      error.textContent = exportError instanceof Error ? exportError.message : "The export could not be created.";
      error.hidden = false;
    } finally {
      window.setTimeout(() => {
        downloadButton.disabled = false;
        downloadButton.textContent = originalLabel;
      }, format === "image" ? 1200 : 0);
    }
  });
}

/* ==========================================================================
   SUPPORTING UI
   ========================================================================== */

function initUI() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    const label = btn.querySelector("span");
    btn.addEventListener("click", async () => {
      const commands = Array.from(
        btn.closest(".cmd")?.querySelectorAll(".cmd-line code") ?? [],
        (code) => code.textContent?.trim() ?? "",
      ).filter(Boolean).join("\n");

      if (!commands) return;

      try {
        await navigator.clipboard.writeText(commands);
        btn.classList.add("is-copied");
        if (label) label.textContent = "copied";
        window.setTimeout(() => {
          btn.classList.remove("is-copied");
          if (label) label.textContent = "copy";
        }, 1400);
      } catch { /* clipboard unavailable, leave the button as-is */ }
    });
  });

  /* header hairline, driven by a sentinel rather than a scroll listener */
  const head = document.getElementById("siteHead");
  if (head) {
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:0;height:8px;width:1px;pointer-events:none";
    document.body.prepend(sentinel);
    new IntersectionObserver(
      ([en]) => head.classList.toggle("is-scrolled", !en.isIntersecting),
    ).observe(sentinel);
  }

  if (!REDUCED) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        }
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".section .reveal").forEach((el) => io.observe(el));
  }

  initStarCount();

  const progress = document.querySelector(".progress");
  if (progress && REDUCED) progress.remove();
}

/* The star count beside the GitHub link. It is a nicety: on any failure (offline, rate
   limited) the button simply reads "Star" without a number. Cached for the session so
   moving between pages does not spend the 60-per-hour anonymous API budget. */
async function initStarCount() {
  const slots = document.querySelectorAll("[data-stars]");
  if (!slots.length) return;
  const KEY = "hqflow.stars";
  let stars = Number(sessionStorage.getItem(KEY));
  if (!stars) {
    try {
      const response = await fetch("https://api.github.com/repos/WinterArc21/HQFlow", { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return;
      stars = Number((await response.json()).stargazers_count);
      if (!Number.isFinite(stars) || stars <= 0) return;
      sessionStorage.setItem(KEY, String(stars));
    } catch {
      return;
    }
  }
  const label = stars >= 1000 ? `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k` : String(stars);
  for (const slot of slots) {
    slot.textContent = label;
    slot.hidden = false;
    slot.closest("a")?.setAttribute("aria-label", `Star HQFlow on GitHub (${stars} stars)`);
  }
}

/* ==========================================================================
   PRODUCT SHOT
   The way-through card shows the app's step cards at real size. The board
   fits the window like the canvas zoom; on a phone it crops at 36% rather
   than shrinking further. The hover light follows the pointer, as in the app.
   ========================================================================== */

function initShot() {
  const body = document.querySelector(".shot-body");
  const board = body?.querySelector(".sn-world");
  const zoom = body?.querySelector(".sn-zoom");
  if (!body || !board || !zoom) return;
  const fit = () => {
    const k = Math.max(0.36, Math.min(0.62, (body.clientWidth - 40) / board.offsetWidth));
    board.style.scale = String(k);
    board.style.left = `${Math.max(16, (body.clientWidth - board.offsetWidth * k) / 2)}px`;
    zoom.textContent = `${Math.round(k * 100)}%`;
  };
  fit();
  new ResizeObserver(fit).observe(body);
  board.addEventListener("pointermove", (event) => {
    const card = event.target.closest(".sn-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${((event.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty("--my", `${((event.clientY - r.top) / r.height) * 100}%`);
  });
}

/* ---- boot ---- */
initWalkthrough();
initUI();
initPrints();
initShot();
