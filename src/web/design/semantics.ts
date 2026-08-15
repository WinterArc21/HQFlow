/**
 * The ONLY place domain semantics map to visual tokens (contract §10). Every other module
 * that needs a colour, marker style, or dash pattern for a category/confidence/connection
 * type/status imports from here instead of re-deriving the mapping. Plain data only, no JSX.
 */
import type { Workflow } from "@schema/workflow";
import type { TestReference } from "@schema/workflow";
import type { WorkflowConnection } from "@schema/workflow";
import type { WorkflowStep } from "@schema/workflow";
import type { SourceStatus } from "../api/types";

export type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

export interface CategoryVisual {
  /** A `--accent-*` custom property name, e.g. `"--accent-blue"`. */
  varName: string;
  label: string;
}

export interface ConfidenceVisual {
  marker: "solid" | "dashed" | "solid-dot";
  label: string;
}

export interface ConnectionVisual {
  varName: string;
  dash: "none" | "dashed" | "dotted";
  showLabel: boolean;
  /** `"primary"` (the happy path) renders as the visually dominant line; `"branch"` (failure,
   * conditional, async, or terminal outcome) renders thinner and slightly translated so it reads as subordinate to
   * the primary path it diverges from, never competing with it (contract §10.3). Driven purely
   * by connection `type` or terminal outcome band. */
  weight: "primary" | "branch";
}

export interface ToneVisual {
  tone: BadgeTone;
  label: string;
}

/**
 * Since the card carries its category as a full-surface tint rather than a 6px spine, these
 * colours have to stay separable as large fills, not just as slivers — which is what drove the
 * two rules this table follows.
 *
 * 1. Entry and output deliberately share `--accent-output`, and nothing else may use it. The two
 *    ends of a workflow are the pair you most often want to find at a glance, and they are never
 *    ambiguous with each other in practice: entry has no inbound edges, output has no outbound
 *    ones, and the spine layout puts them at opposite ends of the canvas. Spending two hues on a
 *    distinction that position already makes let every *middle* category — the ones that really do
 *    sit side by side — move further apart.
 * 2. Card hues avoid the connection hues where they can. The one place this could not be fully
 *    satisfied is `data`: orange (h24) sits in the 30deg corridor between failure red (h6) and the
 *    amber of conditional/retry edges (h36), 12deg off the latter. Accepted rather than solved —
 *    an edge is a 1.5px stroke and a card is a 320px fill, so the form difference carries the
 *    distinction that hue alone cannot here. If it ever reads as ambiguous on a real graph, the
 *    fix is to move the conditional edge toward yellow, not to move this card.
 *
 * `--accent-blue` is no longer a category colour at all: it is the focus ring and the selection
 * ring, and a card tinted the same blue as the ring that marks "you are here" fought with it.
 */
const CATEGORY_VISUALS: Record<NonNullable<WorkflowStep["category"]>, CategoryVisual> = {
  entry: { varName: "--accent-output", label: "Entry" },
  logic: { varName: "--accent-neutral", label: "Logic" },
  decision: { varName: "--accent-rose", label: "Decision" },
  data: { varName: "--accent-orange", label: "Data" },
  external: { varName: "--accent-orchid", label: "External" },
  output: { varName: "--accent-output", label: "Output" },
};

const UNSPECIFIED_CATEGORY_VISUAL: CategoryVisual = { varName: "--accent-neutral", label: "Unspecified" };

/** Left-marker colour + label for a step's `category` (contract §10 table). */
export function categoryToken(category?: WorkflowStep["category"]): CategoryVisual {
  if (category === undefined) {
    return UNSPECIFIED_CATEGORY_VISUAL;
  }
  return CATEGORY_VISUALS[category];
}

const CONFIDENCE_VISUALS: Record<NonNullable<WorkflowStep["confidence"]>, ConfidenceVisual> = {
  verified: { marker: "solid", label: "Verified" },
  inferred: { marker: "dashed", label: "Inferred" },
  "human-confirmed": { marker: "solid-dot", label: "Human-confirmed" },
};

const UNSPECIFIED_CONFIDENCE_VISUAL: ConfidenceVisual = { marker: "solid", label: "Unspecified" };

/** Marker style + label for a step's `confidence` (contract §10 table). */
export function confidenceStyle(confidence?: WorkflowStep["confidence"]): ConfidenceVisual {
  if (confidence === undefined) {
    return UNSPECIFIED_CONFIDENCE_VISUAL;
  }
  return CONFIDENCE_VISUALS[confidence];
}

type ConnectionType = NonNullable<Parameters<typeof connectionStyle>[0]>;

/**
 * The approved edge grammar (see `prototypes/edge-grammar`, canvas-layout-discussion.md): stroke
 * *pattern* always distinguishes a connection type too, never colour alone. Normal sync flow is
 * solid and the visually dominant line; conditional/failure both dash but split amber/red;
 * async dots in blue. Failure and async now carry short labels ("invalid", "queued") — collapsing
 * every guard's exit into an unlabelled red dash was what originally made the failure fan-out
 * unreadable; a 1-3 word label is what turns "a red line" into "invalid" or "over limit". Normal
 * edges keep `showLabel: false` — on the single dominant path, a label is wallpaper, not
 * information.
 */
const CONNECTION_VISUALS: Record<ConnectionType, ConnectionVisual> = {
  success: { varName: "--accent-neutral", dash: "none", showLabel: false, weight: "primary" },
  failure: { varName: "--accent-red", dash: "dashed", showLabel: true, weight: "branch" },
  conditional: { varName: "--accent-amber", dash: "dashed", showLabel: true, weight: "branch" },
  async: { varName: "--accent-blue", dash: "dotted", showLabel: true, weight: "branch" },
};

/** Line colour/dash + whether to render the connection label (contract §10 table). */
export function connectionStyle(type?: "success" | "failure" | "conditional" | "async"): ConnectionVisual {
  if (type === undefined) {
    return CONNECTION_VISUALS.success;
  }
  return CONNECTION_VISUALS[type];
}

export type OutcomeEdgeBand = "success" | "failure";

/** A successful terminal is a distinct branch from an ordinary success/default connection. */
const SUCCESS_OUTCOME_EDGE_VISUAL: ConnectionVisual = {
  varName: "--accent-output",
  dash: "dashed",
  showLabel: true,
  weight: "branch",
};

/** Line colour/dash + label treatment for a connection entering a terminal outcome band. */
export function outcomeEdgeStyle(band: OutcomeEdgeBand): ConnectionVisual {
  return band === "failure" ? CONNECTION_VISUALS.failure : SUCCESS_OUTCOME_EDGE_VISUAL;
}

/**
 * The retry-loop grammar entry: a step retrying itself (or, more generally, any detected back
 * edge — see `canvas/graph.ts`'s `computeBackEdgeIds`) is neither a plain failure nor a plain
 * conditional. It reads as "recoverable" — amber, dashed, always labelled ("retry ≤3") — distinct
 * from the red "this is final" failure exit a retry-exhausted step also has. Not keyed by
 * `connection.type` (the schema has no "retry" type — the loop shape itself, not a JSON field, is
 * what makes an edge a retry), so it lives here as its own constant rather than another
 * `CONNECTION_VISUALS` entry.
 */
export const RETRY_EDGE_VISUAL: ConnectionVisual = {
  varName: "--accent-amber",
  dash: "dashed",
  showLabel: true,
  weight: "branch",
};

export type OutcomeTone = "success" | "failure" | "neutral";

/**
 * Visual tone for a terminal ("outcome") step — pill-shaped nodes with out-degree 0 (contract:
 * "Terminal steps... render as visually distinct outcome nodes... Derive success/failure from the
 * step's `category` and from the type of the connections arriving at it"). No schema change:
 * driven entirely by the `type` of whatever connections land on the step, which `canvas/graph.ts`'s
 * `computeIncomingTypes` already derives from the graph shape. A step reached only by
 * `failure` connections reads as failure; one reached only by `success`/default connections reads
 * as success. Conditional, async, mixed, or absent intent is neutral rather than guessed.
 */
export function outcomeTone(incomingTypes: ReadonlyArray<WorkflowConnection["type"]>): OutcomeTone {
  if (incomingTypes.length === 0) {
    return "neutral";
  }
  if (incomingTypes.every((type) => type === "failure")) return "failure";
  if (incomingTypes.every((type) => type === "success" || type === undefined)) return "success";
  return "neutral";
}

const STATUS_VISUALS: Record<NonNullable<Workflow["status"]>, ToneVisual> = {
  draft: { tone: "neutral", label: "Draft" },
  verified: { tone: "green", label: "Verified" },
  "needs-review": { tone: "amber", label: "Needs review" },
};

const UNSPECIFIED_STATUS_VISUAL: ToneVisual = { tone: "neutral", label: "Unspecified" };

/** Badge tone + label for a workflow's `status`. */
export function statusTone(status?: Workflow["status"]): ToneVisual {
  if (status === undefined) {
    return UNSPECIFIED_STATUS_VISUAL;
  }
  return STATUS_VISUALS[status];
}

const SOURCE_STATUS_VISUALS: Record<SourceStatus, ToneVisual> = {
  verified: { tone: "green", label: "Verified" },
  "file-only": { tone: "amber", label: "File only" },
  missing: { tone: "red", label: "Missing" },
};

/** Badge tone + label for a `sourceChecks` entry's resolution state. */
export function sourceStatusTone(status: SourceStatus): ToneVisual {
  return SOURCE_STATUS_VISUALS[status];
}

const TEST_STATUS_VISUALS: Record<NonNullable<TestReference["status"]>, ToneVisual> = {
  passing: { tone: "green", label: "Passing" },
  failing: { tone: "red", label: "Failing" },
  unknown: { tone: "neutral", label: "Unknown" },
};

const UNSPECIFIED_TEST_STATUS_VISUAL: ToneVisual = { tone: "neutral", label: "Unspecified" };

/** Badge tone + label for a `TestReference.status`. */
export function testStatusTone(status?: TestReference["status"]): ToneVisual {
  if (status === undefined) {
    return UNSPECIFIED_TEST_STATUS_VISUAL;
  }
  return TEST_STATUS_VISUALS[status];
}
