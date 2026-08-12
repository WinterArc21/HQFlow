# HQFlow — Agent Skill

You are documenting how this repository actually behaves, for a tool called **HQFlow**.
HQFlow has no LLM of its own and never uploads code anywhere — it
only renders the structured JSON files you write here, in `.codehq/`, as an interactive
workflow canvas that a human can explore in their browser. Your job is to read the real
source code and describe real workflows accurately, honestly, and at the right altitude.

Everything you write goes into `.codehq/workflows/<id>.json`. HQFlow validates
every file you write, watches this directory, and updates the canvas live. If you make a
mistake, it will tell you exactly what is wrong in `.codehq/diagnostics.json` — read that
file after every change and fix anything you broke.

## The 18 rules

1. Start from a real user action, route, handler, server action, event consumer, cron task, or system entry point.
2. Trace the relevant code path through the repository.
3. Group low-level functions into meaningful product steps.
4. Do not expose logging, generic utilities, framework internals, or trivial adapters as top-level steps.
5. Prefer five to nine top-level steps for a normal workflow.
6. Attach real repository-relative source files and symbols to each step.
7. Record important inputs and outputs.
8. Record meaningful failure branches and edge cases.
9. Attach tests that prove the behavior when they exist.
10. Mark information as verified only when it is directly supported by the code.
11. Mark reasonable interpretations as inferred.
12. Preserve human-written names, notes, and corrections.
13. Edit only files inside `.codehq` unless the user explicitly asks for source-code changes.
14. Follow the supplied JSON schema exactly.
15. Never add layout coordinates, colors, styling, or visual instructions.
16. Run `hqflow validate` after making changes.
17. Read `.codehq/diagnostics.json` and repair any errors you introduced.
18. Write step `name` and `purpose` in product language a non-author can understand (e.g. "Collect website data", not `pollFirecrawlBatch`). Keep type and symbol names in `inputs`/`outputs`/`sources` — the canvas shows Story by default and Code map on demand.

The goal is not to document every function in the codebase. It is to give the next person (or
agent) who opens this project a fast, trustworthy map of how a handful of real, important
workflows actually work — where they start, what they touch, what can go wrong, and how to
prove it with tests. A workflow file that is short, accurate, and verifiable is worth far more
than one that is exhaustive and speculative.

## Example user prompt

> "Read `.codehq/SKILL.md`, then document the checkout workflow. It starts at the
> `POST /api/checkout` route. Trace it through order creation, payment, and confirmation
> email, and write the result to `.codehq/workflows/checkout.json`. Then run
> `hqflow validate` and fix anything it flags."

## Workflow authoring loop

1. Pick a real entry point (rule 1) and read the code path (rule 2).
2. Group the code into 5–9 top-level steps (rules 3–5).
3. For each step, record sources, inputs/outputs, edge cases, tests, and external services
   that you can actually verify in the code (rules 6–10). Mark anything you had to guess or
   generalize as `"confidence": "inferred"` (rule 11).
4. Write (or update) `.codehq/workflows/<id>.json`. If a human previously edited this
   file, keep their names, notes, and corrections — do not overwrite them with your own
   guesses (rule 12).
5. Do not touch anything outside `.codehq` unless the user explicitly asked you to change
   source code (rule 13). Follow the schema below exactly (rule 14) — do not invent fields,
   and never add layout, color, or styling (rule 15).
6. Run `hqflow validate` (rule 16).
7. Open `.codehq/diagnostics.json`. If it reports any errors for files you touched, fix
   them and re-run `validate` until it is clean (rule 17). Warnings are not blocking, but they
   usually mean the workflow is more complex or less connected than it should be — consider
   whether they point at a real problem.

## Incremental authoring — the map grows as you read

HQFlow renders the canvas the moment a workflow file is complete and valid, and it
watches the directory for changes — so you can build the map incrementally as you trace the
code, not only at the end. Each saved version is a real checkpoint a human could open and
explore.

1. **Create the file early.** Once you have the entry point and the first verified step, write
   a complete, valid workflow — schema-correct, with `schemaVersion`, `id`, `name`, `purpose`,
   `steps` (one is enough), and `connections` (empty is fine). Run `hqflow validate`
   immediately.
2. **Save in complete, valid increments.** Every time you verify a new step or connection,
   rewrite the file as the full, valid workflow — never a partial, malformed, or placeholder
   version. The canvas only advances when the JSON parses and validates; a broken save leaves
   the last valid map on screen and stale diagnostics in the banner.
3. **Check diagnostics after each increment** (rule 17). Read `.codehq/diagnostics.json`
   and repair anything you introduced before continuing to trace.
4. **Never fabricate steps, connections, or categories to make the map move.** Every saved
   version must describe real behavior you have verified — an unverified step that appears then
   vanishes was never real, and a reader who saw it has been misled.

## JSON schema reference

Every object below is validated strictly: **unknown keys are a hard error.** This is
deliberate — HQFlow owns all layout, color, and styling, and a field it does not
recognize (especially something like `x`, `y`, `color`, or `style`) will be rejected with:

> "Visual properties are owned by HQFlow and must not appear in workflow files."

Never add coordinates, colors, fonts, CSS, icons, or any other visual/layout property,
anywhere in these files. HQFlow computes all of that automatically from the
`category`/`confidence`/connection `type` values below.

All file paths (`SourceReference.file`, `TestReference.file`) **must be repository-relative**:
no leading `/`, no drive letters (`C:\`), no UNC paths (`\\server\...`), and no `..` segments.
Use forward slashes or backslashes, e.g. `"src/server/routes/checkout.ts"`.

### `Workflow` (one file per workflow, `.codehq/workflows/<id>.json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `"0.1"` | yes | Must be exactly `"0.1"`. |
| `id` | string | yes | Must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens). Should match the filename, e.g. `checkout.json` → `"id": "checkout"`. |
| `name` | string | yes | Short human-readable name, e.g. `"Checkout"`. |
| `purpose` | string | yes | One or two sentences: what this workflow accomplishes and for whom. |
| `entryPoint` | `SourceReference` | no | A `SourceReference` pointing at the code that begins this workflow, e.g. the route handler. Example: `{ "file": "app/api/generate/route.ts", "symbol": "POST" }`. |
| `status` | one of: `"draft"`, `"verified"`, `"needs-review"` | no | Lifecycle status of this workflow document. `"draft"`: not yet reviewed. `"verified"`: a human has confirmed it. `"needs-review"`: something may be stale or uncertain. |
| `steps` | `WorkflowStep[]` | yes | At least one step. Prefer 5–9 top-level steps; more than 14 triggers a warning. |
| `connections` | `WorkflowConnection[]` | yes | May be empty. Every `from`/`to` must reference an existing step `id`. |
| `notes` | `string[]` | no | Free-form notes, corrections, or context a human added, one per array entry. Preserve these. |

### `WorkflowStep`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the workflow. |
| `name` | string | yes | Short product-language step name (Story altitude), e.g. `"Collect website data"` — not a function identifier. |
| `purpose` | string | yes | One plain sentence: what this step does and why. No file paths or type names. |
| `category` | one of: `"entry"`, `"logic"`, `"decision"`, `"data"`, `"external"`, `"output"` | no | Drives the step's marker color. Use `"entry"` for the step(s) that begin the workflow — this is also how reachability is computed. |
| `confidence` | one of: `"verified"`, `"inferred"`, `"human-confirmed"` | no | `"verified"`: directly supported by the code you read. `"inferred"`: a reasonable interpretation you could not fully confirm. `"human-confirmed"`: a human explicitly confirmed this — never downgrade it. |
| `sources` | `SourceReference[]` | no | Real files/symbols that implement this step (shown on Code map / expand). |
| `inputs` | `DataReference[]` | no | What this step consumes (type names belong here, not in `name`). |
| `outputs` | `DataReference[]` | no | What this step produces (type names belong here, not in `name`). |
| `edgeCases` | `EdgeCase[]` | no | Meaningful failure branches or special cases. |
| `tests` | `TestReference[]` | no | Tests that prove this step's behavior, if any exist. |
| `externalServices` | `ExternalServiceReference[]` | no | Third-party or internal services this step calls. |
| `details` | `{ implementation?, importantDecisions?, assumptions? }` | no | See below. |

`details` is an object with:
- `implementation` (string, optional) — a short prose note on how the step is implemented, when that is non-obvious from the sources alone.
- `importantDecisions` (string[], optional) — notable design decisions visible in the code.
- `assumptions` (string[], optional) — things you assumed rather than verified.

### `WorkflowConnection`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | no | Optional identifier for the connection. |
| `from` | string | yes | Source step `id`. |
| `to` | string | yes | Target step `id`. |
| `label` | string | no | Short label shown on the connection. |
| `condition` | string | no | The condition under which this branch is taken. |
| `type` | one of: `"success"`, `"failure"`, `"conditional"`, `"async"` | no | Defaults to a plain solid connection. `"failure"` for error branches, `"conditional"` for branches gated on a condition, `"async"` for fire-and-forget or queued work. |

Describe graph semantics, not desired pictures: an output-category step is shown as an outcome
only when it has no outgoing connections; use `failure` only for genuine failure paths, and use
`async` only when the source proves an asynchronous handoff. A labelled self-loop can document a
real retry (for example `"retry ≤3"`), while a loop back to a different step remains a normal
return connection. Several success branches do not imply that they run concurrently. Never add
fictional branches merely to demonstrate these canvas forms.

### `SourceReference`

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | string | yes | Repository-relative path. |
| `symbol` | string | no | Function, method, class, or route name. |
| `line` | integer | no | 1-based start line. |
| `endLine` | integer | no | 1-based end line; must be `>= line` when both are present. |
| `description` | string | no | What this reference shows. |

### `DataReference`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Name of the input or output. |
| `type` | string | no | Its type, e.g. `"string"`, `"OrderId"`, `"Buffer"`. |
| `description` | string | no | What it represents. |

### `EdgeCase`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Short name for the edge case. |
| `description` | string | no | What can go wrong or diverge. |
| `handling` | string | no | How the code handles it today. |
| `confidence` | one of: `"verified"`, `"inferred"`, `"human-confirmed"` | no | Same meaning as on `WorkflowStep`. |
| `sources` | `SourceReference[]` | no | Where this handling lives in the code. |

### `TestReference`

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | string | yes | Repository-relative path to the test file. |
| `symbol` | string | no | Test name or `describe`/`it` block. |
| `description` | string | no | What the test proves. |
| `status` | one of: `"passing"`, `"failing"`, `"unknown"` | no | If you did not run it, use `"unknown"`. |

### `ExternalServiceReference`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Name of the external or internal service. |
| `purpose` | string | no | Why this step calls it. |
| `operation` | string | no | The specific operation, e.g. `"POST /charges"`, `"read"`, `"publish"`. |

### `.codehq/project.json`

You will not usually need to edit this file, but its shape is:

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `"0.1"` | yes | Must be exactly `"0.1"`. |
| `project.id` | string | yes | Stable identifier for this project. |
| `project.name` | string | yes | Human-readable project name. |
| `project.description` | string | no | Optional short description. |
| `settings.defaultWorkflowId` | string | no | Workflow shown by default when the app opens. |
| `settings.sourceLinkMode` | one of: `"editor"`, `"github"`, `"none"` | no | How "open source" links behave. |
