/* ==========================================================================
   HQFlow landing page runtime

   Three pieces:
     1. the workflow canvas demo (real data from examples/motiona)
     2. the hero preview, same components and data at a smaller scale
     3. the spine, one continuous line connecting the whole page
   ========================================================================== */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NS = "http://www.w3.org/2000/svg";

/* ==========================================================================
   DATA
   ========================================================================== */

const CAT_VAR = {
  entry: "var(--blue)", decision: "var(--amber)", logic: "var(--ink-3)",
  data: "var(--green)", external: "var(--violet)", output: "var(--green)",
};

const STEPS = [
  {
    id: "receive-request", idx: "01", name: "Receive Request", cat: "entry", conf: "verified",
    x: 4, y: 14, io: "url → GenerateRequestBody",
    purpose: "Accepts the website URL, optional reference images, and tone setting.",
    sources: [{ file: "app/api/generate/route.ts", symbol: "POST", line: "14-39" }],
    inputs: [], outputs: [{ name: "GenerateRequestBody" }], edgeCases: [], tests: [],
  },
  {
    id: "validate-request", idx: "02", name: "Validate Request", cat: "decision", conf: "verified",
    x: 28, y: 14, io: "request → validated",
    purpose: "Checks the URL and reference images, and normalizes the tone.",
    sources: [{ file: "lib/validation.ts", symbol: "validateGenerateRequest" }],
    inputs: [{ name: "GenerateRequestBody" }], outputs: [{ name: "ValidatedGenerateRequest" }],
    edgeCases: [
      { name: "Malformed or unreachable URL", handling: "Returns a 400 with an explanatory error message." },
      { name: "Too many reference images", handling: "Returns a 400 rejecting the request." },
    ],
    tests: [
      { symbol: "accepts a valid generation request", file: "tests/unit/lib/validation.test.ts", status: "passing" },
      { symbol: "rejects a malformed URL", file: "tests/unit/lib/validation.test.ts", status: "passing" },
    ],
  },
  {
    id: "check-quota", idx: "03", name: "Check Quota", cat: "decision", conf: "verified",
    x: 52, y: 14, io: "account → allow / 429",
    purpose: "Confirms the account has not exceeded its monthly generation quota.",
    sources: [{ file: "lib/validation.ts", symbol: "hasRemainingQuota" }],
    inputs: [], outputs: [],
    edgeCases: [{ name: "Monthly quota exceeded", handling: "Returns a 429." }],
    tests: [],
  },
  {
    id: "scrape-website", idx: "04", name: "Scrape Website", cat: "logic", conf: "verified",
    x: 76, y: 14, io: "request → ScrapedWebsite",
    purpose: "Fetches the submitted page and extracts its title, description, body text, and images.",
    sources: [{ file: "lib/scraper.ts", symbol: "scrapeWebsite" }],
    inputs: [{ name: "ValidatedGenerateRequest" }], outputs: [{ name: "ScrapedWebsite" }],
    edgeCases: [{ name: "Website unreachable or error status", handling: "Returns a 502 without persisting a generation." }],
    tests: [{ symbol: "extracts the title and description", file: "tests/unit/lib/scraper.test.ts", status: "passing" }],
  },
  {
    id: "understand-product", idx: "05", name: "Understand Product", cat: "logic", conf: "inferred",
    x: 76, y: 61, io: "website → product model",
    purpose: "Converts the scraped page into a structured product model: name, tagline, summary, hero image, and keywords.",
    sources: [{ file: "lib/product-model.ts", symbol: "buildProductContext" }],
    inputs: [{ name: "ScrapedWebsite" }], outputs: [{ name: "ProductContext" }],
    edgeCases: [], tests: [],
    impl: "Ranks the most frequent non-trivial words in the body text as keywords, and assumes the first scraped image is representative of the product.",
    assumptions: ["The first image found on the page is a reasonable hero image."],
  },
  {
    id: "generate-story", idx: "06", name: "Generate Story", cat: "logic", conf: "verified",
    x: 52, y: 61, io: "ProductContext → StoryPlan",
    purpose: "Builds a short, tone-appropriate beat sequence (hook, problem, payoff) from the product context.",
    sources: [{ file: "lib/story.ts", symbol: "generateStoryPlan" }],
    inputs: [{ name: "ProductContext" }], outputs: [{ name: "StoryPlan" }],
    edgeCases: [], tests: [],
  },
  {
    id: "save-result", idx: "07", name: "Save Result", cat: "output", conf: "verified",
    x: 28, y: 61, io: "StoryPlan → 200 / error",
    purpose: "Persists the generation and returns it to the caller, or returns an error response for any failed step above.",
    sources: [
      { file: "lib/persistence.ts", symbol: "saveGeneration" },
      { file: "app/api/generate/route.ts", symbol: "POST" },
    ],
    inputs: [{ name: "StoryPlan" }], outputs: [],
    edgeCases: [], tests: [{ symbol: "returns the generated story plan", file: "tests/integration/api/generate.test.ts", status: "passing" }],
  },
];

const EDGES = [
  { from: "receive-request", to: "validate-request", type: "success" },
  { from: "validate-request", to: "check-quota", type: "success" },
  { from: "check-quota", to: "scrape-website", type: "success" },
  { from: "scrape-website", to: "understand-product", type: "success", route: "b2t" },
  { from: "understand-product", to: "generate-story", type: "success" },
  { from: "generate-story", to: "save-result", type: "success" },
  { from: "validate-request", to: "save-result", type: "failure", label: "rejected", route: "b2t" },
  { from: "check-quota", to: "save-result", type: "failure", label: "quota exceeded", route: "b2t" },
  { from: "scrape-website", to: "save-result", type: "conditional", label: "scrape failed", route: "elbow" },
];

const VB_W = 1000, VB_H = 560;

function cubicMid(p0, c1, c2, p1) {
  const t = 0.5, u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}

function nodeMarkup(s) {
  return `
    <span class="node-head">
      <span class="node-idx">${s.idx}</span>
      <span class="node-name">${s.name}</span>
      <span class="node-meta">${s.sources.length} src</span>
    </span>
    <span class="node-sub">${s.purpose ?? s.io}</span>
    ${s.conf === "inferred" ? '<span class="node-conf">inferred</span>' : ""}`;
}

/* ==========================================================================
   1. WORKFLOW CANVAS DEMO
   ========================================================================== */

function initDemo() {
  const canvas = document.getElementById("demoCanvas");
  const svg = document.getElementById("demoEdges");
  const nodesEl = document.getElementById("demoNodes");
  const drawer = document.getElementById("drawer");
  const hint = document.getElementById("demoHint");
  if (!canvas || !svg || !nodesEl || !drawer) return;

  const nodeEls = new Map();
  for (const s of STEPS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "node" + (s.conf === "inferred" ? " is-inferred" : "");
    el.style.left = s.x + "%";
    el.style.top = s.y + "%";
    el.style.setProperty("--cat", CAT_VAR[s.cat]);
    el.dataset.id = s.id;
    el.setAttribute("aria-label", `Step ${s.idx}: ${s.name}`);
    el.setAttribute("aria-expanded", "false");
    el.innerHTML = nodeMarkup(s);
    nodesEl.appendChild(el);
    nodeEls.set(s.id, el);
  }

  const rectOf = (id) => {
    const el = nodeEls.get(id);
    const cw = nodesEl.clientWidth, ch = nodesEl.clientHeight;
    return {
      x: (el.offsetLeft / cw) * VB_W,
      y: (el.offsetTop / ch) * VB_H,
      w: (el.offsetWidth / cw) * VB_W,
      h: (el.offsetHeight / ch) * VB_H,
    };
  };

  const buildEdges = () => {
    svg.replaceChildren();

    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <marker id="arr-n" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.74 0 0)"/>
      </marker>
      <marker id="arr-r" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.545 0.115 38)"/>
      </marker>
      <marker id="arr-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.665 0.115 72)"/>
      </marker>`;
    svg.appendChild(defs);

    for (const e of EDGES) {
      const a = rectOf(e.from), b = rectOf(e.to);
      let d, labelAt = null;

      if (e.route === "elbow") {
        const sx = a.x + a.w * 0.72, sy = a.y + a.h;
        const tx = b.x + b.w / 2, ty = b.y + b.h;
        const runY = VB_H * 0.87;
        d = `M ${sx} ${sy} L ${sx} ${runY} L ${tx} ${runY} L ${tx} ${ty + 4}`;
        labelAt = [(sx + tx) / 2, runY + 13];
      } else if (e.route === "b2t" || b.y > a.y + a.h) {
        const p0 = [a.x + a.w / 2, a.y + a.h];
        const p1 = [b.x + b.w / 2, b.y];
        const dy = Math.max(60, (p1[1] - p0[1]) * 0.45);
        const c1 = [p0[0], p0[1] + dy], c2 = [p1[0], p1[1] - dy];
        d = `M ${p0[0]} ${p0[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p1[0]} ${p1[1]}`;
        const m = cubicMid(p0, c1, c2, p1);
        labelAt = [m[0] + 8, m[1] + 3];
      } else if (b.x >= a.x + a.w) {
        const p0 = [a.x + a.w, a.y + a.h / 2];
        const p1 = [b.x, b.y + b.h / 2];
        const dx = Math.max(36, (p1[0] - p0[0]) * 0.45);
        const c1 = [p0[0] + dx, p0[1]], c2 = [p1[0] - dx, p1[1]];
        d = `M ${p0[0]} ${p0[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p1[0]} ${p1[1]}`;
        labelAt = [(p0[0] + p1[0]) / 2, p0[1] - 8];
      } else {
        const p0 = [a.x, a.y + a.h / 2];
        const p1 = [b.x + b.w, b.y + b.h / 2];
        const dx = Math.max(36, (p0[0] - p1[0]) * 0.45);
        const c1 = [p0[0] - dx, p0[1]], c2 = [p1[0] + dx, p1[1]];
        d = `M ${p0[0]} ${p0[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p1[0]} ${p1[1]}`;
        labelAt = [(p0[0] + p1[0]) / 2, p0[1] - 8];
      }

      const marker = e.type === "failure" ? "arr-r" : e.type === "conditional" ? "arr-a" : "arr-n";

      const base = document.createElementNS(NS, "path");
      base.setAttribute("d", d);
      base.setAttribute("class", "edge" + (e.type === "failure" ? " is-failure" : e.type === "conditional" ? " is-conditional" : ""));
      base.setAttribute("marker-end", `url(#${marker})`);
      svg.appendChild(base);

      if (e.label && labelAt) {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", String(labelAt[0]));
        t.setAttribute("y", String(labelAt[1]));
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("class", "edge-label" + (e.type === "failure" ? " is-failure" : " is-conditional"));
        t.textContent = e.label;
        svg.appendChild(t);
      }
    }
  };

  buildEdges();
  let resizeRaf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(buildEdges);
  }).observe(nodesEl);

  /* ---- step drawer ---- */
  const dIdx = document.getElementById("dIdx");
  const dName = document.getElementById("dName");
  const dCat = document.getElementById("dCat");
  const dConf = document.getElementById("dConf");
  const dBody = document.getElementById("drawerBody");
  let selectedId = null;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const renderDrawer = (s) => {
    dIdx.textContent = s.idx;
    dName.textContent = s.name;
    dCat.textContent = s.cat;
    dCat.style.setProperty("--badge-c", CAT_VAR[s.cat]);
    dConf.textContent = s.conf;
    dConf.classList.toggle("is-inferred", s.conf === "inferred");

    const sections = [];
    sections.push(`<div class="d-section"><span>Purpose</span><p class="d-purpose">${esc(s.purpose)}</p></div>`);

    if (s.sources.length) {
      sections.push(`<div class="d-section"><span>Sources</span>${
        s.sources.map((r) => `<div class="d-src">${esc(r.file)} · ${esc(r.symbol)}${r.line ? ` :${esc(r.line)}` : ""}</div>`).join("")
      }</div>`);
    }
    if (s.inputs.length) {
      sections.push(`<div class="d-section"><span>Inputs</span><div class="d-io">${
        s.inputs.map((i) => `<span class="d-chip">${esc(i.name)}</span>`).join("")
      }</div></div>`);
    }
    if (s.outputs.length) {
      sections.push(`<div class="d-section"><span>Outputs</span><div class="d-io">${
        s.outputs.map((o) => `<span class="d-chip out">${esc(o.name)}</span>`).join("")
      }</div></div>`);
    }
    if (s.edgeCases.length) {
      sections.push(`<div class="d-section"><span>Edge cases</span>${
        s.edgeCases.map((c) => `<div class="d-edge"><strong>${esc(c.name)}</strong><p class="d-hand">→ ${esc(c.handling)}</p></div>`).join("")
      }</div>`);
    }
    if (s.tests.length) {
      sections.push(`<div class="d-section"><span>Tests</span>${
        s.tests.map((t) => `<div class="d-test"><span class="dot${t.status === "unknown" ? " unknown" : ""}"></span><span>${esc(t.symbol)}<span class="file">${esc(t.file)}</span></span></div>`).join("")
      }</div>`);
    }
    if (s.impl) {
      sections.push(`<div class="d-section"><span>Implementation</span><p class="d-note">${esc(s.impl)}</p></div>`);
    }
    if (s.assumptions?.length) {
      sections.push(`<div class="d-section"><span>Assumptions</span>${
        s.assumptions.map((a) => `<p class="d-note" style="margin-bottom:6px">${esc(a)}</p>`).join("")
      }</div>`);
    }
    sections.push(`<p class="d-foot">marked ${s.conf} by agent · ${s.sources.length} source${s.sources.length === 1 ? "" : "s"} attached</p>`);
    dBody.innerHTML = sections.join("");
  };

  const openDrawer = (id) => {
    const s = STEPS.find((x) => x.id === id);
    if (!s) return;
    selectedId = id;
    renderDrawer(s);
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    for (const [nid, el] of nodeEls) {
      el.classList.toggle("is-selected", nid === id);
      el.setAttribute("aria-expanded", String(nid === id));
    }
    hint?.classList.add("is-hidden");
  };

  const closeDrawer = () => {
    selectedId = null;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    for (const el of nodeEls.values()) {
      el.classList.remove("is-selected");
      el.setAttribute("aria-expanded", "false");
    }
  };

  for (const [id, el] of nodeEls) {
    el.addEventListener("click", () => (selectedId === id ? closeDrawer() : openDrawer(id)));
  }
  document.getElementById("drawerClose")?.addEventListener("click", closeDrawer);
  canvas.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(".node")) closeDrawer();
  });
  document.getElementById("demo")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const order = STEPS.map((s) => s.id);
    const cur = document.activeElement?.closest?.(".node")?.dataset?.id;
    const i = Math.max(0, order.indexOf(cur ?? order[0]));
    const next = order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    nodeEls.get(next)?.focus();
    e.preventDefault();
  });

}

/* ==========================================================================
   2. HERO PREVIEW
   The first four steps of the same workflow, same node component, no
   interaction. It is a real preview of the product, not a picture of one.
   ========================================================================== */

const HERO_LAYOUT = [
  { id: "receive-request", x: 2, y: 3 },
  { id: "validate-request", x: 50, y: 24 },
  { id: "check-quota", x: 6, y: 46 },
  { id: "scrape-website", x: 52, y: 69 },
];

function initHeroGraph() {
  const wrap = document.getElementById("heroGraph");
  const svg = document.getElementById("heroEdges");
  const nodesEl = document.getElementById("heroNodes");
  if (!wrap || !svg || !nodesEl) return;

  const els = new Map();
  for (const spot of HERO_LAYOUT) {
    const s = STEPS.find((x) => x.id === spot.id);
    if (!s) continue;
    const el = document.createElement("div");
    el.className = "node node-mini";
    el.style.left = spot.x + "%";
    el.style.top = spot.y + "%";
    el.style.setProperty("--cat", CAT_VAR[s.cat]);
    el.innerHTML = nodeMarkup(s);
    nodesEl.appendChild(el);
    els.set(s.id, el);
  }

  const draw = () => {
    const w = nodesEl.clientWidth, h = nodesEl.clientHeight;
    if (!w || !h) return;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.replaceChildren();

    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <marker id="hero-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.74 0 0)"/>
      </marker>
      <marker id="hero-arr-r" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 0 L8 4 L0 8 z" fill="oklch(0.545 0.115 38)"/>
      </marker>`;
    svg.appendChild(defs);

    for (let i = 0; i < HERO_LAYOUT.length - 1; i += 1) {
      const a = els.get(HERO_LAYOUT[i].id), b = els.get(HERO_LAYOUT[i + 1].id);
      if (!a || !b) continue;
      const p0 = [a.offsetLeft + a.offsetWidth / 2, a.offsetTop + a.offsetHeight];
      const p1 = [b.offsetLeft + b.offsetWidth / 2, b.offsetTop];
      const dy = Math.max(22, (p1[1] - p0[1]) * 0.6);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", `M ${p0[0]} ${p0[1]} C ${p0[0]} ${p0[1] + dy}, ${p1[0]} ${p1[1] - dy}, ${p1[0]} ${p1[1]}`);
      path.setAttribute("class", "edge");
      path.setAttribute("marker-end", "url(#hero-arr)");
      svg.appendChild(path);
    }

    /* the real failure edge off Validate Request, heading out of frame */
    const v = els.get("validate-request");
    if (v) {
      const p0 = [v.offsetLeft + v.offsetWidth * 0.82, v.offsetTop + v.offsetHeight];
      const ex = Math.min(w - 8, p0[0] + 64), ey = p0[1] + h * 0.2;
      const fail = document.createElementNS(NS, "path");
      fail.setAttribute("d", `M ${p0[0]} ${p0[1]} C ${p0[0]} ${p0[1] + 30}, ${ex} ${ey - 34}, ${ex} ${ey}`);
      fail.setAttribute("class", "edge is-failure");
      fail.setAttribute("marker-end", "url(#hero-arr-r)");
      svg.appendChild(fail);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(ex + 2));
      t.setAttribute("y", String(ey - 42));
      t.setAttribute("text-anchor", "end");
      t.setAttribute("class", "edge-label is-failure");
      t.textContent = "rejected";
      svg.appendChild(t);
    }
  };

  draw();
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }).observe(nodesEl);
}

/* ==========================================================================
   3. THE SPINE
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
    const text = [];
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

    /* hero into the fork */
    if (why3) push("why", `M ${railX} ${origin.bottom + 6} V ${why3.cy}`);

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

    /* leave through Observe, rejoin the rail, then enter the canvas */
    let joinY = null;
    if (hubbed && lOut) {
      joinY = lOut.cy + 36;
      push("loop", `M ${lOut.cx} ${lOut.cy} V ${joinY}`);
      push("loop", `M ${lOut.cx} ${joinY} H ${railX}`);
    } else if (l3) {
      joinY = l3.cy;
    }

    /* the line enters the canvas frame and the workflow graph continues it,
       then it picks back up on the way out */
    if (l3 && frame && joinY != null) {
      push("canvas", elbowRight(railX, joinY, frame.y + 46, frame.x - 4), "", true, true);
      push("canvas", elbowLeft(frame.x - 3, frame.bottom - 46, railX, frame.bottom + 34));
    }

    /* the bus, with a tap per principle */
    if (frame && p1 && p4) {
      push("principles", `M ${railX} ${frame.bottom + 34} V ${p4.cy}`);
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
    for (const t of text) {
      const el = document.createElementNS(NS, "text");
      el.setAttribute("x", String(t.x));
      el.setAttribute("y", String(t.y));
      el.setAttribute("class", "sp-text");
      el.textContent = t.s;
      groupFor(t.sec).appendChild(el);
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
initDemo();
initHeroGraph();
initUI();
initSpine();
