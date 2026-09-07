/* ==========================================================================
   HQFlow landing page runtime

   Two pieces:
     1. the feature walkthrough around the embedded production canvas
     2. the spine, one continuous line connecting the whole page
   ========================================================================== */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NS = "http://www.w3.org/2000/svg";

/* ==========================================================================
   2. THE SPINE
   One line down the page in the canvas notation. It forks where the argument
   forks, fans into the three-move loop, enters the canvas, runs as a bus past
   the principles, and terminates at the install step.
   ========================================================================== */

function initSpine() {
  const main = document.querySelector("main");
  const svg = document.getElementById("spine");
  if (!main || !svg) return;

  let M = null;
  const box = (name) => {
    const el = main.querySelector(`[data-sp="${name}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {
      x: r.left - M.left, y: r.top - M.top, w: r.width, h: r.height,
      cx: r.left - M.left + r.width / 2, cy: r.top - M.top + r.height / 2,
      right: r.right - M.left, bottom: r.bottom - M.top,
    };
  };

  /* rounded orthogonal elbows. the corner radius shrinks rather than
     overshooting when the rail and the target are close together. */
  const corner = (span, max) => Math.max(2, Math.min(max, Math.abs(span) * 0.45));

  const elbowRight = (x, fromY, toY, toX, max = 14) => {
    const r = corner(Math.min(toX - x, toY - fromY), max);
    return `M ${x} ${fromY} V ${toY - r} Q ${x} ${toY} ${x + r} ${toY} H ${toX}`;
  };

  const elbowLeft = (fromX, y, x, toY, max = 14) => {
    const r = corner(Math.min(fromX - x, toY - y), max);
    return `M ${fromX} ${y} H ${x + r} Q ${x} ${y} ${x} ${y + r} V ${toY}`;
  };

  const build = () => {
    M = main.getBoundingClientRect();
    const W = main.offsetWidth, H = main.offsetHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));

    const origin = box("origin");
    if (!origin) return;
    const railX = Math.round(origin.cx) + 0.5;

    const contentEl = main.querySelector("#principles .tap h3");
    const contentX = contentEl ? contentEl.getBoundingClientRect().left - M.left : railX + 78;

    const segs = [];
    const push = (sec, d, cls = "", draw = true, arrow = false) => segs.push({ sec, d, cls, draw, arrow });
    const dots = [];

    const why1 = box("why-1"), why2 = box("why-2"), why3 = box("why-3");
    const hub = box("loop-hub");
    const l1 = box("loop-1"), l2 = box("loop-2"), l3 = box("loop-3");
    const lOut = box("loop-out");
    const frame = box("canvas-frame");
    const p1 = box("prin-1"), p4 = box("prin-4");
    const term = box("install-node");

    /* gentle cubic from a hub down into a station top */
    const fan = (from, to) => {
      const dy = Math.max(56, to.y - from.bottom);
      const c1y = from.bottom + dy * 0.55;
      const c2y = to.y - Math.min(28, dy * 0.35);
      return `M ${from.cx} ${from.bottom} C ${from.cx} ${c1y}, ${to.cx} ${c2y}, ${to.cx} ${to.y}`;
    };

    /* The playable canvas follows the hero before the argument continues. */
    if (frame && why3) {
      push("canvas", elbowRight(railX, origin.bottom + 6, frame.y + 46, frame.x - 4), "", true, true);
      push("canvas", elbowLeft(frame.x - 3, frame.bottom - 46, railX, frame.bottom + 34));
      push("why", `M ${railX} ${frame.bottom + 34} V ${why3.cy}`);
    }

    /* two branches peel off and dead-end, the trunk continues.
       when the layout is too narrow to fit a branch, the red marker on the
       node carries the meaning on its own. */
    for (const b of [why1, why2]) {
      if (!b || b.x - 4 <= railX + 12) continue;
      push("why", elbowRight(railX, b.cy - 26, b.cy, b.x - 4, 12), "is-fail", false);
      dots.push({ sec: "why", x: railX, y: b.cy - 26 });
    }
    if (why3) push("why", `M ${why3.right + 3} ${why3.cy} H ${contentX - 10}`);

    /* the loop: rail runs to the hub, then fans into three stations.
       on the stacked layout the hub sits on the rail and the fan collapses
       into short left-side taps. */
    const hubbed = hub && Math.abs(hub.cx - railX) > 36;
    if (why3 && hub) {
      if (hubbed) {
        /* leave the rail, rise into the hub from the left so the fan sits
           above the row instead of reading as a left-to-right bus */
        const approachY = hub.cy;
        push("loop", `M ${railX} ${why3.cy} V ${approachY}`);
        push("loop", `M ${railX} ${approachY} H ${hub.x - 4}`);
      } else {
        push("loop", `M ${railX} ${why3.cy} V ${hub.cy}`);
      }
    }

    if (hub && l1 && l2 && l3) {
      if (hubbed) {
        push("loop", fan(hub, l1));
        push("loop", fan(hub, l2));
        push("loop", fan(hub, l3));
      } else {
        push("loop", `M ${railX} ${hub.cy} V ${l3.cy}`);
        for (const s of [l1, l2, l3]) {
          if (s && s.x - 4 > railX + 8) push("loop", `M ${railX} ${s.cy} H ${s.x - 4}`);
        }
      }
    }

    /* leave through Observe and rejoin the rail */
    let joinY = null;
    if (hubbed && lOut) {
      joinY = lOut.cy + 36;
      push("loop", `M ${lOut.cx} ${lOut.cy} V ${joinY}`);
      push("loop", `M ${lOut.cx} ${joinY} H ${railX}`);
    } else if (l3) {
      joinY = l3.cy;
    }

    /* the bus, with a tap per principle */
    if (frame && p1 && p4 && joinY != null) {
      const principlesStart = joinY;
      push("principles", `M ${railX} ${principlesStart} V ${p4.cy}`);
      for (const n of ["prin-1", "prin-2", "prin-3", "prin-4"]) {
        const t = box(n);
        if (t) push("principles", `M ${t.right + 3} ${t.cy} H ${contentX - 10}`);
      }
    }

    /* everything converges on one terminal node */
    if (p4 && term) push("install", `M ${railX} ${p4.cy} V ${term.y - 4}`);

    /* render */
    svg.replaceChildren();

    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <marker id="sp-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.52 0 0)"/>
      </marker>`;
    svg.appendChild(defs);

    const groups = new Map();
    const groupFor = (sec) => {
      let g = groups.get(sec);
      if (!g) {
        g = document.createElementNS(NS, "g");
        g.setAttribute("class", "sp-group");
        g.dataset.sec = sec;
        groups.set(sec, g);
        svg.appendChild(g);
      }
      return g;
    };

    for (const seg of segs) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", seg.d);
      path.setAttribute("pathLength", "1");
      path.setAttribute("class", `sp-path ${seg.cls} ${seg.draw ? "is-draw" : "is-fade"}`.trim());
      if (seg.arrow) path.setAttribute("marker-end", "url(#sp-arr)");
      groupFor(seg.sec).appendChild(path);
    }
    for (const c of dots) {
      const el = document.createElementNS(NS, "circle");
      el.setAttribute("cx", String(c.x));
      el.setAttribute("cy", String(c.y));
      el.setAttribute("r", "3");
      el.setAttribute("class", "sp-dot");
      groupFor(c.sec).appendChild(el);
    }
    return groups;
  };

  let groups = build();

  /* draw each section's segments as that section arrives */
  const drawn = new Set(REDUCED ? ["why", "loop", "canvas", "principles", "install"] : []);
  const applyDrawn = () => {
    if (!groups) return;
    for (const [sec, g] of groups) g.classList.toggle("in", drawn.has(sec));
  };
  applyDrawn();

  if (!REDUCED) {
    const io = new IntersectionObserver((entries) => {
      let changed = false;
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const id = en.target.id || "why";
        if (!drawn.has(id)) { drawn.add(id); changed = true; }
        io.unobserve(en.target);
      }
      if (changed) applyDrawn();
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.02 });

    for (const id of ["why", "loop", "canvas", "principles", "install"]) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
  }

  let raf = 0;
  const rebuild = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      groups = build();
      applyDrawn();
    });
  };
  new ResizeObserver(rebuild).observe(main);
  window.addEventListener("orientationchange", rebuild);
  if (document.fonts?.ready) document.fonts.ready.then(rebuild).catch(() => {});
}

/* ==========================================================================
   3. FEATURE WALKTHROUGH
   ========================================================================== */

const TOUR_INSTRUCTIONS = {
  details: "Click “Agent Maps Code” to inspect its real sources, inputs, outputs, and agent boundary.",
  trace: "Hover “Agent Maps Code.” HQFlow strengthens its visible path and quiets everything else.",
  arrange: "Drag a card to reshape the flow. Then drag the dot on a solid edge to bend or snap it.",
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
  const instruction = document.querySelector("#tourInstruction strong");
  const exportPreview = document.getElementById("tourExport");
  const frame = document.querySelector(".tour-frame");
  const formatInputs = Array.from(document.querySelectorAll('input[name="tour-export-format"]'));
  const downloadButton = document.getElementById("tourExportDownload");
  const error = document.getElementById("tourExportError");
  if (!tabs.length || !instruction || !exportPreview || !frame || !formatInputs.length || !downloadButton || !error) return;

  const activate = (tab) => {
    const step = tab.dataset.tourStep;
    if (!step || !(step in TOUR_INSTRUCTIONS)) return;
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
    button.addEventListener("click", () => activate(tabs[0]));
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

  const progress = document.querySelector(".progress");
  if (progress && REDUCED) progress.remove();
}

/* ---- boot ---- */
initWalkthrough();
initUI();
initSpine();
