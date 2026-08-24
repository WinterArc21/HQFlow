# Canvas Layout Discussion

A design conversation about whether the workflow canvas's top-to-bottom spine layout
should stay linear, and what alternatives exist. No code changes resulted from this
conversation — it is captured here as reference for a future decision.

---

## The question

> okay fable,
> i told you right, it's very important we make it visually aesthetic and easy to understand.
>
> if it's linear, it'll break that rule of ours. just discuss with me, what can we do about this?

## Initial response

Good instinct to poke at this. Let me give you my honest read rather than defend the choice reflexively.

### Where I'd push back

The spine isn't the problem when the workflow *is* a pipeline. `generate-video` genuinely is seven sequential steps — that's its true topology. If we scatter a linear process across 2D space to look more "graph-like," we're lying about the code to seem impressive, and the reader pays for it: they have to reconstruct the order we deliberately obscured. Honest linearity beats fake topology. A straight line that says "this is a pipeline, read top to bottom" *is* information.

### Where you're right

Three real weaknesses in what we have:

1. **Monotony.** Seven identical boxes, evenly spaced, one column — it reads like a fancy to-do list. The aesthetic failure isn't linearity, it's *uniformity*. Nothing about the composition rewards looking at it.
2. **Wasted canvas.** We're using ~340px of a ~1100px field. Margins that big need to either carry meaning or shrink.
3. **The spine is currently a universal rule, not a special case.** A workflow with genuine parallelism — two tracks that fork and rejoin — would get force-fed into spine + side gutter and look wrong. We built for the shape of two linear fixtures.

### What I'd actually do

**1. Topology-adaptive layout.** Classify the graph first (cheap, deterministic — we already walk it): near-linear → spine; real fan-out/fan-in → let ranks spread horizontally into a proper tiered layout; hub-shaped → hub composition. The spine becomes the *pipeline case*, not the only case. This is the structural fix.

**2. Spend the margins on meaning.** This is the biggest aesthetic win available. Instead of empty gutters: edge cases and tests as small marginal annotations anchored to their step by hairlines — like callouts on a technical drawing. The canvas starts reading as a composed instrument, not a centered list. It also surfaces the "what can go wrong" story without opening the drawer.

**3. Trace-on-hover/select.** Hover a step → its upstream/downstream path stays full-strength, everything else dims. Cheap to build, dramatic for both beauty and comprehension — it answers "what feeds this, what depends on this" with zero clicks. Motion and response is where a restrained design earns its wow, since decoration is off the table.

**4. Test the engine with representative graphs.** Both current fixtures are pipelines. Add one test workflow with genuine parallel branches that rejoin so the canvas proves its 2D layout.

Smaller idea worth considering: style the branch gutter lanes like transit lines — continuous colored routes with the label as a station chip. The routing already exists; it's purely a visual treatment, and metro maps are the canonical proof that "mostly linear + meaningful branches" can be gorgeous.

Priority order suggested: **2 → 3 → 1 → 4**: the margins and hover-trace transform how it feels immediately; adaptive layout matters the moment a real repo throws a non-pipeline at us.

---

## The screenshot that reframed the problem

The user attached a screenshot of the real canvas showing steps 03–07 of `generate-video`,
with three dashed red failure-edge lines ("rejected", "quota exceeded", "scrape failed")
running down the right side of the spine, and said:

> i don't get what you're saying.
>
> we can still present the information in non-linear and be true about. in linear there's a
> huge issue, like in the pic, rejected and the other red lines, hardly helps the viewer
> understand.
>
> is it possible to do non-linear, and what would be the best setup?

### Response

Yes, it's fully possible — the layout engine is a pure function we own end to end (the schema
deliberately has no coordinates), so nothing technical binds us to a column.

The actual failure, precisely named: it isn't that the happy path is vertical. It's the
**rank-skipping failure edges**. Three exits from steps 02/03/04 all target step 07, so they
become three long parallel dashed lines running down a gutter for five ranks, with labels
floating in space. Nobody can read "rejected" there and answer *"rejected... and then what?"*
The line is long, the destination is off-screen, and three of them overlap. That spaghetti
would survive almost any generic re-layout, because the *topology* (early exits converging on
a terminal) is what produces long edges.

So the fix isn't "make it 2D" in the abstract — it's choosing a setup that makes **failure
exits short and local**.

### Recommended setup: zones + a failure bus

Split the canvas into two meaningful regions instead of spine + leftover margin:

```
   MAIN LINE                    OUTCOME ZONE
   ─────────                    ────────────
   01 Receive ──┐
   02 Validate ─┼─ rejected ──────►┐
   03 Quota ────┼─ quota exceeded ─►│  (one shared rail,
   04 Scrape ───┼─ scrape failed ──►│   junction dots)
   05 Understand│                   │
   06 Story ────┘                   │
   07 Save Result ◄─────────────────┘
```

- **Left region:** the happy path, still strictly ordered (that ordering is genuinely
  valuable — don't give it up).
- **Right region:** an *outcome zone* that's a first-class part of the composition, not a
  gutter. Each failure exit is a **short horizontal hop** — one node-width long, immediately
  readable — onto a **single shared rail** (a "failure bus"), with a junction dot and a chip
  that carries its destination inline: `rejected → 07`. The rail runs down once and enters
  Save Result once.

Three long tangled lines become three short hops + one clean shared line. The viewer's
question "what happens when validation fails?" is answered *at the step*: exits right,
labeled, destination named. And the convergence itself becomes visible as a story — "every
failure ends at Save Result, which returns the error" — which was completely illegible before.

This stays honest: same nodes, same edges, same topology. Presentation changed, not truth.

### Two variations considered alongside it

- **Ghost stubs** — instead of any long line, each failing step gets a small stub chip beside
  it: `⤳ 07 Save Result (error)`. Clicking it jumps there; hovering the real Save Result
  highlights all its ghosts. Zero long edges at all. Slightly less honest visually (you don't
  *see* the convergence), best kept as the fallback for pathological cases (a failure edge
  spanning 10+ ranks).
- **True 2D spread for genuinely parallel workflows** — when a graph has real fan-out that
  rejoins (two branches that both *continue*, not just exit), the spine is wrong and ranks
  should spread horizontally into a proper tiered layout. That's the adaptive piece: pipeline
  → spine+bus; parallel → tiered; don't force either shape onto the other.

Suggested next step (not taken): prototype failure-bus vs. ghost-stubs on the real fixture,
screenshot both themes, decide by looking rather than arguing.

---

## Seven layout variations, ASCII sketches

The user asked for several variations in the "zones" format, all applied to the real
`generate-video` topology so they'd compare like for like.

### A · Failure bus *(repeated from above, for reference)*

```
   MAIN LINE                     OUTCOME ZONE
   ─────────                     ────────────
   01 Receive
   02 Validate ──── rejected ────────►┐
   03 Quota ─────── quota exceeded ──►│   one shared rail
   04 Scrape ────── scrape failed ───►│   junction dots
   05 Understand                      │
   06 Story                           │
   07 Save Result ◄───────────────────┘
```
Short local hops, one clean rail. Convergence is visible. Still a column though.

### B · Ghost stubs — no long edges anywhere

```
   01 Receive Request
        │
   02 Validate Request ──⤳ 07 Save Result  (rejected)
        │
   03 Check Quota ───────⤳ 07 Save Result  (quota exceeded)
        │
   04 Scrape Website ────⤳ 07 Save Result  (scrape failed)
        │
   05 Understand Product
        │
   06 Generate Story
        │
   07 Save Result   ◄── 3 error paths arrive here
```
Zero spaghetti, destination named in place. Cost: you *read* the convergence instead of
seeing it.

### C · Zigzag timeline — breaks the column, uses width

```
   ┌───────────────┐
   │ 01 Receive    │
   └───────┬───────┘
           └──────────────┐
                  ┌───────▼────────┐
                  │ 02 Validate    │──⚑ rejected
                  └───────┬────────┘
           ┌──────────────┘
   ┌───────▼───────┐
   │ 03 Quota      │──⚑ quota exceeded
   └───────┬───────┘
           └──────────────┐
                  ┌───────▼────────┐
                  │ 04 Scrape      │──⚑ scrape failed
                  └────────────────┘
```
Feels composed rather than list-like. Cost: sequence is slightly slower to read.

### D · Category swimlanes — column position *means* what kind of step it is

```
   ENTRY        DECISION          LOGIC            OUTPUT
   ─────        ────────          ─────            ──────
   01 Receive
        └─────► 02 Validate
                    │ └── rejected ──────────────────┐
                    ▼                                │
                03 Quota
                    │ └── quota exceeded ────────────┤
                    ▼                                │
                            04 Scrape                │
                                │ └─ scrape failed ──┤
                                ▼                    │
                            05 Understand            │
                                ▼                    │
                            06 Story ────────────────┤
                                                     ▼
                                              07 Save Result
```
Genuinely 2D and fully honest — x-axis carries real meaning (category), failures drift
naturally rightward into OUTPUT where they belong.

### E · Two-track braid — success and failure as named parallel tracks

```
   SUCCESS TRACK                    FAILURE TRACK
   ─────────────                    ─────────────
   01 Receive
        │
   02 Validate ──── rejected ──────────► ●
        │                                │
   03 Quota ─────── quota exceeded ────► ●
        │                                │
   04 Scrape ────── scrape failed ─────► ●
        │                                │
   05 Understand                         │
        │                                │
   06 Story                              │
        │                                │
        └──────────► 07 Save ◄───────────┘
```
Same geometry as A, but the label turns it into a story: two tracks, one destination.

### F · Outcome island — the terminal is a place, not another card

```
   01 Receive
        │
   02 Validate ──┐
        │        │
   03 Quota ─────┤
        │        │       ╔══════════════════════╗
   04 Scrape ────┼──────►║   07 SAVE RESULT     ║
        │        │       ║   ──────────────     ║
   05 Understand │       ║   1 success path     ║
        │        │       ║   3 error paths      ║
   06 Story ─────┘       ╚══════════════════════╝
```
Instantly answers "where does this all end up," and the island can summarise its inbound
paths.

### G · Phase columns — group steps, then flow between groups

```
   INTAKE               PROCESSING             OUTPUT
   ──────               ──────────             ──────
   ┌────────────┐       ┌────────────────┐     ┌──────────────┐
   │ 01 Receive │       │ 04 Scrape      │     │ 07 Save      │
   │ 02 Validate│ ────► │ 05 Understand  │ ──► │    Result    │
   │ 03 Quota   │       │ 06 Story       │     │              │
   └─────┬──────┘       └───────┬────────┘     └───────▲──────┘
         └──────── failures ────┴──────────────────────┘
```
Fewest top-level elements — grasp the shape in one glance, then drill in. Cost: needs phase
inference (or a schema field), and hides step-level detail until you expand.

### Assessment given at the time

**D** was flagged as the strongest answer to the spaghetti complaint — it's truly non-linear,
the horizontal axis carries real information, and the failure edges stop being long parallel
dashes because they're drifting toward a column that's already on the right. **F** was flagged
as the cheapest big win, composable with anything else. **G** was flagged as the most
*beautiful* but the biggest leap.

The user picked **D and C** as the ones that looked good, then redirected the conversation
(next section) before either was prototyped.

---

## Reframing around real codebase topologies

The user's next question:

> D and C looks good, but i want you to think in terms of actual codebases and stuff.
>
> What is the genuine workflows of codebases? what is the optimal display of the workflow?
> give me several variations of this, just like how you gave me several

### Response: seven real topologies

Starting from what code actually does rather than graph aesthetics — real product workflows
fall into roughly seven topologies, each with a display that fits it naturally.

#### 1 · Guarded pipeline — the most common shape by far
Every REST route, server action, RPC handler. Linear happy path, guard clauses bailing early.
This is `generate-video`. The framing mistake identified: treating early exits as edges to a
*step*, when a developer thinks of them as **outcomes**.

```
   MAIN LINE                              OUTCOMES
   ─────────                              ────────
   01 Receive
   02 Validate ─────✗ invalid URL ────────► ⬛ 400 Bad Request
   03 Check Quota ──✗ over limit ─────────► ⬛ 429 Too Many
   04 Scrape ───────✗ unreachable ────────► ⬛ 502 Upstream
   05 Understand
   06 Generate Story
   07 Save Result ────────────────────────► ⬛ 200 OK
```
Terminals become a labelled outcome column. Three tangled dashes become three short hops to
three *distinct, named results*. Reading it answers "what can this endpoint return?" — the
real question.

#### 2 · Layered descent — "how does a click reach the database?"
Flagged as the single most valuable view for understanding an unfamiliar repo. A workflow
crosses architectural layers, and these can be inferred for free from `sources[].file`
prefixes — no schema change needed.

```
   app/              components/        lib/              db/
   ────              ──────────         ───               ──
   01 Submit form
        └──────────► 02 useGenerate()
                          └───────────► 03 validateRequest()
                                             │
                                        04 scrapeWebsite()
                                             │
                                        05 buildStoryPlan()
                                             └──────────► 06 insertGeneration()
                                                                │
   08 Render result ◄───────────────────────────────────────────┘
```
Horizontal position = **where the code lives**. Instantly shows that a feature spans four
layers, and that only one step touches the database. The canvas becomes a map of the repo,
not an abstract flowchart.

#### 3 · Event fan-out — pub/sub, no rejoin
One publish, N independent consumers that never reconverge. Extremely common in modern
backends.

```
                     ┌──────────────────┐
                     │  order.created   │
                     │  events/emit.ts  │
                     └────────┬─────────┘
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌───────────┐    ┌─────────────┐   ┌─────────────┐
      │  Email    │    │  Analytics  │   │  Warehouse  │
      │ svc/mail  │    │ svc/track   │   │ svc/fulfil  │
      │  (async)  │    │  (async)    │   │  (async)    │
      └───────────┘    └─────────────┘   └─────────────┘
```
Hub over stations. Forcing this into a spine would be an outright lie — nothing is
sequential.

#### 4 · Parallel fan-out / fan-in — real concurrency
`Promise.all`, job batches, multi-provider calls. Genuinely 2D; a column misrepresents it.

```
                   01 Receive Order
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
        02 Charge    03 Reserve   04 Fraud
           card         stock       check
             │            │            │
             └────────────┼────────────┘
                          ▼
                   05 Confirm Order
```
The diamond *is* the information: these three run at once, and all must land before step 05.

#### 5 · State machine with retries — cycles are the point
Job runners, order lifecycles, render queues. Loops drawn above the line so the forward path
stays clean.

```
              ┌────────── retry (≤3) ──────────┐
              │                                │
   queued ──► running ──┬──► succeeded         │
                        │                      │
                        └──► failed ───────────┘
                                │ (attempts exhausted)
                                ▼
                          dead-letter
```

#### 6 · Middleware onion — descend, hit core, ascend
Express/Fastify/Next middleware, interceptors, decorators. The U-turn is the truth of it.

```
   INBOUND                              OUTBOUND
   ───────                              ────────
   01 CORS ──────────┐        ┌────────── 07 Serialize
   02 Auth ──────────┤        ├────────── 06 Log timing
   03 Rate limit ────┤        ├────────── 05 Map errors
                     ▼        │
                    04 Route handler
```
Each inbound layer pairs with its outbound counterpart — which is exactly the bug people
hunt ("why did my error skip the logger?").

#### 7 · Sync / async split — the response returns before the work finishes
Queue-backed endpoints, webhooks, background jobs. Two timelines, not one.

```
   SYNC  (user is waiting)          ASYNC  (background worker)
   ──────────────────────          ──────────────────────────
   01 Receive
   02 Validate
   03 Enqueue job ──┐
   04 Return 202 ◄──┘
        │           ╰╌╌╌╌╌╌╌╌╌╌╌╌► 05 Worker picks up job
        ▼                               │
   user has job id                 06 Scrape + render
                                        │
                                   07 Write result
                                        ╎
                                   08 Notify via SSE ╌╌► client
```
Solid = blocking the user. Dashed = happens later. That distinction was invisible before and
matters enormously.

### What was proposed to build

**Classify, then choose.** The graph is already walked deterministically, so detection is
cheap: count fan-out degree, detect cycles, check whether branches rejoin or terminate, check
`type: "async"`. Then pick the matching renderer. The spine becomes *the guarded-pipeline
case*, not the universal rule.

Two flagged as worth far more than the rest:

- **#2 layered descent** — the strongest match to the product thesis. Deriving lanes from
  `sources[].file` directory prefixes costs nothing, needs no schema change, and turns the
  x-axis into real information about the repo's architecture. The one that makes the canvas
  feel like it *knows the codebase*.
- **#1 outcome column** — the direct fix for the spaghetti originally flagged, and small.

Noted that they compose cleanly — layer bands on x, outcomes column on the right, short local
exits — giving a genuinely 2D canvas where **every axis means something**: down = sequence,
across = architecture, right edge = results.

---

## The precedence problem

The user's question, keying off an "honest caveat" from the previous answer:

> One honest caveat: multiple families can be simultaneously true — a workflow can be layered
> and have a cycle. That's why precedence matters, and why I'd let the user override the
> auto-choice with a small view switcher rather than pretending the classifier is always right.
>
> exactly, keeping this in mind, what's your proposal now?

### Response: the reframe

The user had found the real flaw, and it invalidated the prior proposal.

**Precedence was a smell.** If a workflow is genuinely layered *and* genuinely cyclic, then
ranking those facts and discarding the loser throws away something true. The mistake was
treating "families" as the unit — seven mutually exclusive renderers competing for one slot.

#### The reframe: one engine, three composable layers

Decompose the layout instead of switching between whole layouts:

| Layer | What decides it | Composable? |
|---|---|---|
| **Y — sequence** | execution order (rank) | fixed, always |
| **X — lens** | a *grouping key* the user can switch | one at a time |
| **Edges** | structural facts (terminals, cycles, async, fan-out) | **additive, all at once** |
| **Density** | scale × detail | independent |

The cycle/layer conflict dissolves: **layers are an X-axis concern, cycles are an edge
concern.** They never compete for the same slot. A layered cyclic workflow gets layer lanes
*and* loop-back rails. Both truths survive.

#### Almost every "family" falls out for free

| Shape | How it emerges — no special renderer |
|---|---|
| Guarded pipeline | linear ranks + terminal edges → outcome column |
| Layered descent | lens = **layers** (from `sources[].file` prefixes) |
| Hub fan-out | consumers all land at rank 2 → they spread horizontally on their own |
| Diamond parallel | divergent paths share a rank, rejoin at a later one → automatic |
| State machine | back edges detected → loop rail above the line |
| Sync/async | `type: "async"` → dashed lane treatment |
| **Onion middleware** | **doesn't fall out** — inbound/outbound pairing is genuinely special |

Six of seven need no bespoke code. That was flagged as the tell that this decomposition is
the right one. Onion is rare enough to defer honestly rather than contort the model around
it.

#### What the user controls

Not a "layout switcher" (which would imply guessing at shape), but a **lens switcher** — one
small control changing what the horizontal axis *means*:

```
   LENS: COMPACT              LENS: LAYERS                LENS: CATEGORY
   ─────────────              ────────────                ──────────────
                              app/     lib/    db/        entry  decision  logic  output
   01 Receive                 01 Receive                  01
   02 Validate ─✗ 400         02 Validate                        02
   03 Quota ────✗ 429                  03 Quota                  03
   04 Scrape                           04 Scrape                          04
   05 Understand                       05 Understand                      05
   07 Save Result                              07 Save                            07
```

Same graph, same edges, same truth — three questions answered. *What's the sequence? Where
does this live in the repo? What kind of work is each step?* Honest, and genuinely useful
rather than a cosmetic toggle.

Default lens auto-selected (≥3 distinct dirs → layers; else compact), user can override — a
sensible default, not a claim of always being right.

#### Proposed build order

1. **Outcome column** — terminal edges stop being long dashes. Fixes what was originally
   flagged, small, no classifier needed.
2. **Lens infrastructure + layers lens** — the x-axis becomes meaningful. Highest product
   value, and the data's already in the schema.
3. **Edge modifiers** — loop rails, async lanes. Additive, land independently.
4. **Density ladder** — compact rows and focus mode, so deep detail scales.

Each ships standalone and none blocks the others — which wouldn't be true of the seven-families
plan.

**Caveats held onto:** lens=layers is only as good as the repo's directory hygiene (a flat
`src/` yields one lane and degrades to compact — acceptable, but should be detected with a
fallback rather than rendering a useless single column). Onion stays unsolved — better to
leave it visibly unhandled than fake it.

---

## Pulling back

The user's next message:

> i feel lost, idk what to do

### Response: course correction

Acknowledged the conversation had drifted into design-astronaut territory — seven topologies,
a three-axis matrix, a composable layout engine — in response to what was originally a simple
complaint: *the red lines are confusing, can we do better?*

#### Where the user actually was

A working product, committed, tested, and running. The canvas legible. One concrete
irritant: three dashed red lines running down the side that don't help anyone understand
anything.

#### What was recommended

Fix that one thing. Nothing else. Replace the three long dashed lines with a small outcome
column on the right — each failure exits its step sideways, one short hop, landing on a
labelled result:

```
   02 Validate ──✗──► ⬛ 400 Bad Request
   03 Quota ────✗──► ⬛ 429 Too Many Requests
   04 Scrape ───✗──► ⬛ 502 Upstream Failed
```

Short lines. Named destinations. No spaghetti. A contained change to code already owned,
directly answering the original complaint, judgeable in thirty seconds.

Everything else raised in the conversation — lenses, layer inference, classifiers — was
explicitly marked as **not needed now**, possibly never needed, exploration rather than a
plan owed to anyone.

#### Why stop there

No real users have hit this with real repos yet. Every layout idea proposed was a guess about
problems not yet encountered. The suggested honest move: ship the small outcome-column fix,
then point CodeHQ at an actual codebase not written by the team and see what genuinely
breaks — more informative in ten minutes than another hour of sketching.

**No code was changed as a result of this conversation.** The repository remains in the clean
committed state described earlier in the session. This document exists purely as a record of
the design options discussed, for reference if/when the canvas layout is revisited.
