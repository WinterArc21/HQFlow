# HQFlow — Engineering Contract

This document is the **binding technical contract** for every agent working on this repository.
Read it fully before writing code. Do not deviate. If something here is genuinely wrong,
say so in your final report instead of silently changing it.

---

## 1. Product in one paragraph

HQFlow is an open-source, local-first web app. A developer runs it inside their own
repository. Their existing coding agent (Cursor / Claude Code / Codex) reads `.codehq/SKILL.md`,
inspects the real source code, and writes structured workflow JSON into `.codehq/`.
HQFlow validates those files, watches them, and renders them as an interactive
workflow canvas in the browser. **HQFlow contains no LLM and never uploads code.**

---

## 2. Non-negotiable decisions

| Decision | Value |
|---|---|
| Language | TypeScript, strict, ESM (`"type": "module"`) |
| Package layout | **Single package**, no monorepo, no workspaces |
| Closed enums | Never widen an enum to `string` "to be safe". A closed set is the contract. |
| Node build | `tsup` (esbuild bundling). `tsc` is used **only** for `--noEmit` typecheck |
| Web build | Vite 7 + React 19 |
| Server | Fastify 5 |
| Validation | Zod (v4 API) |
| Watching | Chokidar 5 |
| Canvas | `@xyflow/react` (React Flow 12) + HQFlow's deterministic layout |
| Client state | Zustand |
| Icons | `@phosphor-icons/react` |
| Unit tests | Vitest |
| Browser tests | Playwright |
| CLI | `commander` |
| Package manager | **pnpm** (`packageManager` field pinned; lockfile is `pnpm-lock.yaml`) |
| Node engine | `>=20` |
| Web fonts | **None downloaded.** System font stacks only (offline-first) |

Forbidden: Next.js, Tailwind, any CSS framework, any component library, any CDN asset,
any network call at runtime other than localhost.

---

## 3. Directory layout

```
package.json
tsconfig.base.json          # shared compilerOptions + path aliases
tsconfig.node.json          # src/{schema,core,server,cli} + tests
tsconfig.web.json           # src/{schema,web}
tsup.config.ts
vite.config.ts
vitest.config.ts
eslint.config.js
playwright.config.ts
docs/CONTRACT.md
src/
  schema/     # ISOMORPHIC. Zod schemas, types, semantic validation. NO node builtins.
  core/       # node-only. repo root, loading, validation orchestration, diagnostics, watcher, store
  server/     # node-only. Fastify app + routes + SSE
  cli/        # node-only. commander CLI
  web/        # browser. React app
templates/codehq/      # files copied by `init`
tests/
  unit/
  integration/
  e2e/
```

### Path aliases (tsconfig `paths`, vite `resolve.alias`, vitest `resolve.alias` — keep all three in sync)

```
@schema/*  ->  src/schema/*
@core/*    ->  src/core/*
@server/*  ->  src/server/*
@web/*     ->  src/web/*
```

`moduleResolution: "Bundler"` everywhere. **Do not write `.js` extensions in import specifiers.**

### Build outputs

- `dist/node/cli.js` — CLI entry, has the shebang. `package.json` → `"bin": { "hqflow": "dist/node/cli.js" }`
- `dist/node/server.js` — programmatic server entry
- `dist/web/` — Vite output, served statically by the server in production
- `dist/export-viewer/` — browser-safe `export-viewer.js` and `export-viewer.css`, inlined into self-contained export files

---

## 4. `.codehq` format (source of truth)

```
.codehq/
├── project.json
├── SKILL.md
├── diagnostics.json        # written by HQFlow, read by agents
├── workflows/
│   └── <id>.json
└── .runtime/               # gitignored, runtime scratch only
```

`init` appends `.codehq/.runtime/` to the repo `.gitignore` (creating it if absent, never
duplicating the line). It must **not** ignore the rest of `.codehq`.

---

## 5. Schemas (`src/schema`)

Author with Zod; export inferred TS types. Exact shapes are in the product brief and must be
followed literally. Summary:

- `CodeHQProject` — `schemaVersion: "0.1"`, `project { id, name, description? }`,
  `settings? { defaultWorkflowId?, sourceLinkMode?: "editor"|"github"|"none" }`
- `Workflow` — `schemaVersion: "0.1"`, `id`, `name`, `purpose`,
  `entryPoint?: SourceReference` (**an object, not a string**),
  `status?: "draft" | "verified" | "needs-review"` (**a closed enum**),
  `steps[]`, `connections[]`, `notes?: string[]` (**an array of strings**)
- `WorkflowStep` — `id, name, purpose, category?, confidence?, sources?, inputs?, outputs?,
  edgeCases?, tests?, externalServices?, details? { implementation?, importantDecisions?, assumptions? }`
- `WorkflowConnection` — `id?, from, to, label?, condition?, type?: "success"|"failure"|"conditional"|"async"`
- `SourceReference` — `file, symbol?, line?, endLine?, description?`
- `DataReference` — `name, type?, description?`
- `EdgeCase` — `name, description?, handling?, confidence?, sources?`
- `TestReference` — `file, symbol?, description?, status?: "passing"|"failing"|"unknown"`
- `ExternalServiceReference` — `name, purpose?, operation?`

`.strict()` on every object: unknown keys are an error, because they usually mean an agent
invented a field (especially visual ones).

### Semantic rules (beyond shape) — implement in `src/schema/semantics.ts`, pure functions

1. Step `id`s unique within a workflow.
2. Every `connection.from` / `connection.to` references an existing step id.
3. `steps.length >= 1`.
4. Every `SourceReference.file` / `TestReference.file` is repository-relative:
   rejects absolute paths, drive letters (`C:\`), leading `/`, and any `..` segment.
5. `line <= endLine` when both present.
6. Workflow `id` matches `^[a-z0-9][a-z0-9-]*$`.
7. Warning (not error): a step unreachable from any entry step, or a workflow with >14 steps
   ("prefer 5–9 top-level steps").
8. Warning: duplicate connection (same from/to/type).

Semantic validation returns `Issue[]`, never throws.

### Explicitly rejected content

The schema must reject visual/layout keys anywhere (`x`, `y`, `position`, `color`, `colour`,
`style`, `width`, `height`, `font`, `css`, `layout`, `icon`) with the message
`"Visual properties are owned by HQFlow and must not appear in workflow files."`
`.strict()` gets most of this; add an explicit check so the error message is actionable.

---

## 6. Diagnostics

```ts
type Severity = "error" | "warning";
type Issue = {
  severity: Severity;
  file: string;      // repo-relative, e.g. ".codehq/workflows/checkout.json"
  path?: string;     // JSON pointer-ish, e.g. "connections[3].to"
  message: string;   // complete sentence, human readable
  hint?: string;     // what to do about it
};
type DiagnosticsReport = {
  generatedAt: string;  // ISO
  valid: boolean;       // false iff any severity === "error"
  issues: Issue[];
};
```

Written to `.codehq/diagnostics.json` (pretty, 2-space, trailing newline) after every
load/revalidation. Must be both human-readable and machine-readable — agents repair from it.

---

## 7. Wire model (server → web)

```ts
type SourceStatus = "verified" | "file-only" | "missing";

type WorkflowRecord = {
  id: string;
  file: string;                 // repo-relative
  workflow: Workflow;           // the last VALID version
  modifiedAt: string;           // ISO
  state: "valid" | "stale";     // "stale" => a newer INVALID version exists on disk
  staleSince?: string;          // ISO
  /** key = `${file}` or `${file}#${symbol}` */
  sourceChecks: Record<string, SourceStatus>;
};

type CodeHQSnapshot = {
  generatedAt: string;
  status: "uninitialized" | "empty" | "ready";  // no .codehq | no workflows | ok
  repository: { name: string; root: string; codeHQDir: string };
  project: CodeHQProject | null;
  workflows: WorkflowRecord[];
  diagnostics: DiagnosticsReport;
};
```

**Rule 7.1 — last-valid-state preservation.** When a workflow file becomes invalid (agent wrote
partial JSON, schema error), the previously valid `workflow` stays in the snapshot with
`state: "stale"` and the diagnostics explain why. The board never blanks out. A workflow that has
*never* been valid is not included in `workflows[]`; it only appears in diagnostics.

---

## 8. HTTP API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/state` | Primary. Full `CodeHQSnapshot`. |
| GET | `/api/project` | `CodeHQProject \| null` |
| GET | `/api/workflows` | `WorkflowRecord[]` |
| GET | `/api/workflows/:id` | `WorkflowRecord`, 404 if unknown |
| DELETE | `/api/workflows/:id` | Delete a verified workflow; returns the refreshed snapshot. |
| GET | `/api/workflows/:id/layout` | `{ positions: Record<stepId, {x,y}> }`. Manually-saved canvas node positions; empty object if none saved. 404 if unknown workflow. |
| PUT | `/api/workflows/:id/layout` | Body: `Record<stepId, {x,y}>`. Overwrites the saved positions for this workflow. 204 on success, 404 if unknown workflow. Stored at `.codehq/.runtime/layout.json` — gitignored per §4, never in workflow JSON. |
| GET | `/api/diagnostics` | `DiagnosticsReport` |
| GET | `/api/source?file=<rel>&line=<n>` | Metadata only: `{ file, absolutePath, exists, editorUrl, line? }`. **Never returns file contents.** |
| GET | `/api/export/:id?hideFilePaths=<bool>` | Self-contained HTML export; `hideFilePaths` defaults to `false`. |
| POST | `/api/recheck` | Force a full reload; returns the new snapshot |
| GET | `/api/events` | SSE |

SSE frames: `data: {"type":"snapshot","payload":CodeHQSnapshot}` on connect and on every
change; `data: {"type":"ping"}` every 25s to keep proxies alive.

### Security (mandatory, tested)

`/api/source` resolves the path against the repository root with `path.resolve` + `fs.realpath`,
then verifies the result is inside the root using a
separator-aware prefix check (`resolved === root || resolved.startsWith(root + path.sep)`).
Reject `..`, absolute paths, drive letters, and symlink escapes with **400**. There is no
endpoint that returns arbitrary file contents. Ever.

---

## 9. CLI

```
hqflow init       # scaffold .codehq
hqflow open       # start server + open browser
hqflow validate   # validate, print, exit non-zero on error
```

Also `--help`, `--version`, and `open --port <n>`, `open --no-open`.

- `init` — never overwrites an existing human file without `--force`; prints exactly what it created.
- `open` — default port 4310, probes upward for a free port, prints the URL, opens the browser
  (failure to open is a warning, not an error).
- `validate` — human-readable grouped output, exit 1 on any error.

Repository root resolution: walk up from cwd looking for `.codehq/`, then `.git/`, then
`package.json`; fall back to cwd. Implemented once in `src/core/repository.ts` and reused.

Output text is specified in the product brief — match it closely.

---

## 10. Design system — the visual contract

The interface must feel like a **professional code instrument**: calm, technical, premium,
information-dense without clutter. Not an analytics dashboard, not an editor, not a chatbot.

**Banned:** purple AI gradients, glassmorphism, blur backdrops, chat bubbles, pill spam,
big rounded cards, drop shadows for decoration, emoji in UI, meaningless charts, skeleton
shimmer that never resolves, `border-radius > 6px`.

### Themes

Dark is the default. A light "paper" theme also exists and is toggleable from the shell.
**Every colour lives in `src/web/styles/tokens.css`.** No hex value may appear in any component
file, ever. Components use `var(--...)` exclusively.

```css
/* dark (default, :root) */
--bg-canvas:      #0E0F11;
--bg-surface:     #141619;
--bg-raised:      #191C20;
--bg-inset:       #0A0B0D;
--border-subtle:  #23262B;
--border-strong:  #32363D;
--text-primary:   #EDEAE4;   /* warm off-white */
--text-secondary: #9BA1A9;
--text-tertiary:  #6B7178;
--accent-blue:    #5B8DEF;   /* entry */
--accent-green:   #4FA97A;   /* data, verified */
--accent-amber:   #D19A45;   /* decision, needs-review */
--accent-red:     #C4665C;   /* failure */
--accent-violet:  #8B7BC7;   /* external */
--accent-neutral: #7E858D;   /* logic */
--accent-output:  #7FBF9A;   /* output / completion */
--focus-ring:     #5B8DEF;

/* light "paper" (:root[data-theme="light"]) */
--bg-canvas:      #F6F4F0;
--bg-surface:     #FFFFFF;
--bg-raised:      #FFFFFF;
--bg-inset:       #EFECE6;
--border-subtle:  #E3DFD8;
--border-strong:  #CBC5BA;
--text-primary:   #16181B;
--text-secondary: #5F5C56;
--text-tertiary:  #8B877F;
/* accents darkened for AA contrast on paper */
```

Also tokenise: spacing (4px base, `--space-1..10`), radius (`--radius-sm: 2px`,
`--radius-md: 4px`, `--radius-lg: 6px`), font sizes (`--fs-micro: 11px` … `--fs-display: 34px`),
font families (`--font-ui` system sans, `--font-mono` system mono), transitions
(`--dur-fast: 120ms`, `--dur-base: 200ms`, easing).

### Semantics → visuals (the ONLY mapping allowed)

| Semantic | Visual |
|---|---|
| category `entry` | blue left marker |
| category `logic` | neutral left marker |
| category `decision` | amber left marker |
| category `data` | green left marker |
| category `external` | violet left marker |
| category `output` | brighter green left marker |
| confidence `verified` | solid 2px marker |
| confidence `inferred` | dashed/striped marker + "inferred" micro-label |
| confidence `human-confirmed` | solid marker + small filled dot |
| connection `failure` | muted red, dashed |
| connection `conditional` | amber, dashed, label shown |
| connection `async` | neutral, dotted |
| connection `success`/default | neutral solid |

Workflow JSON **never** controls colour, font, coordinates, shape, connector style, background,
animation, or layout. The renderer is deterministic.

### Canvas graph grammar

- An **outcome pill** is a step with `category: "output"` and out-degree zero. Output steps
  that continue to another step remain ordinary work cards.
- A terminal outcome receives failure tone only when all of its incoming connections are
  `failure`. Terminals reached by `conditional` or `async` connections are neutral, not errors;
  exclusively success/default arrivals may use success tone.
- An explicitly labelled self-loop (for example `retry ≤3`) may render as a compact retry
  curl. A non-self back edge (for example `re-encode`) remains a real return connection to
  its target; it must not be collapsed into a self-loop glyph.
- Multiple success branches may be laid out side-by-side for readability. Fan-out placement
  alone does **not** claim concurrency: only explicit schema semantics such as an `async`
  connection communicate asynchronous behavior.

Node dragging/pinning and edge inspectors are deferred. They are not part of this grammar.

### Structural language

Thin 1px borders (`--border-subtle`), square-ish corners, generous whitespace, uppercase
letterspaced micro-labels (11px, `letter-spacing: .08em`) for section headers, monospace for all
code identifiers and file paths, numeric step indices in mono. Subtle technical grid on the
canvas background (1px `--border-subtle` lines at 32px, very low opacity).

### CSS approach

CSS Modules (`Component.module.css`) co-located with components. No CSS-in-JS, no Tailwind.
Global files: `tokens.css`, `reset.css`, `base.css`.

---

## 11. Web app structure

```
src/web/
  main.tsx
  App.tsx
  styles/{tokens.css,reset.css,base.css}
  api/{client.ts,events.ts}        # fetch wrappers + SSE hook
  store/{useCodeHQStore.ts}   # zustand: selectedWorkflowId, selectedStepId, depth,
                                   # expandedStepIds, searchQuery, diagnosticsOpen, theme
  components/
    shell/      AppShell, TopBar, StatusIndicator, ThemeToggle, LocalOnlyBadge
    navigator/  WorkflowNavigator, WorkflowListItem
    canvas/     WorkflowCanvas, nodes/StepNode, edges/WorkflowEdge, layout.ts, CanvasToolbar
    drawer/     StepDrawer + section components
    search/     CommandPalette
    diagnostics/ DiagnosticsPanel, DiagnosticsBanner
    states/     EmptyState, UninitializedState, LoadingState, ErrorState
    primitives/ Button, IconButton, Badge, Kbd, SectionLabel, CopyButton, Tooltip
```

Client state holds **only** UI state. Workflow data always comes from the server snapshot.

### Progressive depth

The board is one story. Same canvas, same nodes — a node grows only when that step is
expanded. Never a separate screen, and never a second global mode.

- **Story** (default): human step names and purposes; no file paths, no type-level IN/OUT on the card.
- **Per-step expand**: files, symbols, and compact IN/OUT for that one step.
- **Drawer**: full detail for the selected step (sources, data, edge cases, tests, notes).

### Accessibility (mandatory)

Keyboard navigation between steps (arrow keys / Tab), visible focus rings using `--focus-ring`,
AA contrast in both themes, `prefers-reduced-motion` respected, real `aria-label`s, no
drag-only interactions, works down to 1024px width.

---

## 12. Code quality bar

- No placeholder components, no fake buttons, no TODO-only functions.
- No React component file over ~200 lines. Split it.
- No `any` without a `// eslint-disable-next-line` and a one-line justification.
- No silent `catch {}`. Every catch either handles or surfaces.
- No magic numbers or colours in components — tokens only.
- Comments only where the logic is non-obvious. No comment restating the code.
- Every exported function in `schema`/`core` has a precise TS signature.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass before you report done.

---

## 13. Definition of done for the whole product

A developer can `npx hqflow init`, then `open`, see the local app, copy the agent
prompt, have their agent write a workflow JSON, watch the board update live without refreshing,
click a step, understand its purpose/sources/data/edge cases/tests, open the referenced file in
their editor, and see honest diagnostics when the agent writes something invalid — all with
nothing leaving their machine.

> Your coding agent can read the code. HQFlow lets you see what it understands.
