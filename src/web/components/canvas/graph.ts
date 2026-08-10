/**
 * Pure graph queries over a `Workflow`'s `connections`, used by keyboard navigation (contract
 * §11), the edge-grammar retry/outcome derivation, and path tracing. Kept separate from
 * `layout.ts` (which positions the graph deterministically) because these answer a different
 * question: given the current step, where does "next"/"previous" go, what is a stable first/last
 * step for Home/End, which connections loop back on the graph, and what does a step's full
 * upstream/downstream trace look like. Never throws or hangs on a cycle.
 */
import type { Workflow, WorkflowConnection } from "@schema/workflow";
import { connectionStyle } from "../../design/semantics";

/** Mirrors the edge-id derivation `layout.ts`'s `LayoutEdge` uses (`connection.id`, falling back
 * to `${from}->${to}#${index}` keyed by the connection's position in `workflow.connections`) so
 * every function here produces ids that line up with the ones `WorkflowEdge` actually renders. */
function connectionEdgeId(connection: WorkflowConnection, index: number): string {
  return connection.id ?? `${connection.from}->${connection.to}#${index}`;
}

function validStepIds(workflow: Workflow): Set<string> {
  return new Set(workflow.steps.map((step) => step.id));
}

function stepOrderIndex(workflow: Workflow): Map<string, number> {
  const order = new Map<string, number>();
  workflow.steps.forEach((step, index) => order.set(step.id, index));
  return order;
}

/**
 * Successor step ids reachable by one outgoing connection from `stepId`, deduplicated and
 * ordered by the target's original position in `workflow.steps` — a deterministic tie-break
 * when a step branches to several others.
 */
export function successorIds(workflow: Workflow, stepId: string): string[] {
  const order = stepOrderIndex(workflow);
  const seen = new Set<string>();
  for (const connection of workflow.connections) {
    if (connection.from === stepId && order.has(connection.to)) {
      seen.add(connection.to);
    }
  }
  return Array.from(seen).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Predecessor step ids with one outgoing connection into `stepId`, same deterministic order. */
export function predecessorIds(workflow: Workflow, stepId: string): string[] {
  const order = stepOrderIndex(workflow);
  const seen = new Set<string>();
  for (const connection of workflow.connections) {
    if (connection.to === stepId && order.has(connection.from)) {
      seen.add(connection.from);
    }
  }
  return Array.from(seen).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * A topological ordering of step ids (Kahn's algorithm), tie-broken by original `steps[]` order
 * so it is deterministic across calls. A cycle leaves some steps with a permanently positive
 * in-degree; rather than hang, each remaining pass picks the lowest-original-index step among
 * whatever is left, breaking the cycle deterministically instead of stalling.
 */
export function computeTopologicalOrder(workflow: Workflow): string[] {
  const order = stepOrderIndex(workflow);
  const inDegree = new Map<string, number>();
  workflow.steps.forEach((step) => inDegree.set(step.id, 0));
  for (const connection of workflow.connections) {
    if (inDegree.has(connection.from) && inDegree.has(connection.to)) {
      inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) + 1);
    }
  }

  const remaining = new Set(workflow.steps.map((step) => step.id));
  const result: string[] = [];

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .filter((id) => (inDegree.get(id) ?? 0) <= 0)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    // No zero-in-degree node left: a cycle accounts for everything remaining. Break it
    // deterministically by taking the lowest-original-index step instead of looping forever.
    const next = ready[0] ?? Array.from(remaining).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
    if (next === undefined) {
      break;
    }

    result.push(next);
    remaining.delete(next);
    for (const connection of workflow.connections) {
      if (connection.from === next && inDegree.has(connection.to)) {
        inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) - 1);
      }
    }
  }

  return result;
}

/** Number of valid outgoing connections per step id — the graph-shape signal an "outcome" node
 * (contract mandate: "terminal steps... render as visually distinct outcome nodes") derives from.
 * No schema change: a step is terminal purely because nothing in `connections` ever names it as
 * a `from`. */
export function computeOutDegree(workflow: Workflow): Map<string, number> {
  const stepIds = validStepIds(workflow);
  const outDegree = new Map<string, number>(workflow.steps.map((step) => [step.id, 0] as const));
  for (const connection of workflow.connections) {
    if (stepIds.has(connection.from) && stepIds.has(connection.to)) {
      outDegree.set(connection.from, (outDegree.get(connection.from) ?? 0) + 1);
    }
  }
  return outDegree;
}

/** Connected output steps with at least one valid incoming edge and no valid outgoing edge.
 * Category, connectivity, and valid graph endpoints are all intentional: an isolated output is
 * content awaiting wiring, not a truthful workflow outcome. */
export function computeOutcomeStepIds(workflow: Workflow): Set<string> {
  const stepIds = validStepIds(workflow);
  const incoming = new Set<string>();
  const outDegree = computeOutDegree(workflow);
  for (const connection of workflow.connections) {
    if (stepIds.has(connection.from) && stepIds.has(connection.to)) {
      incoming.add(connection.to);
    }
  }
  return new Set(
    workflow.steps
      .filter((step) => step.category === "output" && incoming.has(step.id) && outDegree.get(step.id) === 0)
      .map((step) => step.id),
  );
}

export interface ArrowNavigation {
  up?: string;
  down?: string;
  left?: string;
  right?: string;
}

/** Pure keyboard neighbours following the same primary/branch distinction as canvas layout.
 * Horizontal movement describes sibling placement, not concurrency. Invalid endpoints are
 * ignored and no graph walk is performed, so malformed cycles cannot hang navigation. */
export function computeArrowNavigation(workflow: Workflow, stepId: string): ArrowNavigation {
  const ids = validStepIds(workflow);
  if (!ids.has(stepId)) return {};

  const outcomes = computeOutcomeStepIds(workflow);
  const successors = successorIds(workflow, stepId);
  const predecessors = predecessorIds(workflow, stepId);
  const connectionsBetween = (from: string, to: string) =>
    workflow.connections.filter((connection) => connection.from === from && connection.to === to && ids.has(from) && ids.has(to));
  const isPrimary = (from: string, to: string) =>
    connectionsBetween(from, to).some((connection) => connectionStyle(connection.type).weight === "primary");
  const isLateral = (from: string, to: string) => outcomes.has(to) || !isPrimary(from, to);

  const result: ArrowNavigation = {};
  const down = successors.find((id) => !outcomes.has(id) && isPrimary(stepId, id)) ?? successors[0];
  const up = predecessors.find((id) => isPrimary(id, stepId)) ?? predecessors[0];
  if (down !== undefined) result.down = down;
  if (up !== undefined) result.up = up;

  // Outcomes fed solely by one source are laid out as a declaration-ordered vertical stack.
  if (outcomes.has(stepId) && predecessors.length === 1) {
    const source = predecessors[0]!;
    const stack = successorIds(workflow, source).filter(
      (id) => outcomes.has(id) && predecessorIds(workflow, id).length === 1 && predecessorIds(workflow, id)[0] === source,
    );
    const index = stack.indexOf(stepId);
    const previousOutcome = index > 0 ? stack[index - 1] : undefined;
    const nextOutcome = index >= 0 && index < stack.length - 1 ? stack[index + 1] : undefined;
    if (previousOutcome !== undefined) result.up = previousOutcome;
    if (nextOutcome !== undefined) result.down = nextOutcome;
  }

  const ownLateral = successors
    .filter((id) => isLateral(stepId, id))
    // A normal terminal outcome and an exception outcome can share one source. Right should
    // enter the exceptional branch; Down already reaches the normal/default successor.
    .sort((a, b) => Number(isPrimary(stepId, a)) - Number(isPrimary(stepId, b)));
  const firstOwnLateral = ownLateral[0];
  if (firstOwnLateral !== undefined) result.right = firstOwnLateral;

  // A child in a fan-out can move across the source's sibling lanes. Prefer this only when the
  // child itself has no lateral destination, preserving Right-to-outcome from a work step.
  for (const parent of predecessors) {
    const siblings = successorIds(workflow, parent);
    const index = siblings.indexOf(stepId);
    const rightSibling = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
    if (result.right === undefined && rightSibling !== undefined) result.right = rightSibling;
    if (isLateral(parent, stepId)) {
      if (result.right === undefined) {
        const lateralSibling = siblings.find((id) => id !== stepId && isLateral(parent, id));
        if (lateralSibling !== undefined) result.right = lateralSibling;
      }
      result.left = parent;
      break;
    }
    const leftSibling = index > 0 ? siblings[index - 1] : undefined;
    if (result.left === undefined && leftSibling !== undefined) result.left = leftSibling;
  }
  return result;
}

/** The connection `type`s of every valid connection arriving at each step id — what
 * `design/semantics.ts`'s `outcomeTone` uses to decide whether a terminal step reads as a
 * success or a failure outcome. */
export function computeIncomingTypes(workflow: Workflow): Map<string, Array<WorkflowConnection["type"]>> {
  const stepIds = validStepIds(workflow);
  const incoming = new Map<string, Array<WorkflowConnection["type"]>>();
  for (const connection of workflow.connections) {
    if (!stepIds.has(connection.from) || !stepIds.has(connection.to)) {
      continue;
    }
    const list = incoming.get(connection.to) ?? [];
    list.push(connection.type);
    incoming.set(connection.to, list);
  }
  return incoming;
}

/**
 * Ids (in `layout.ts`/`WorkflowEdge`'s `${from}->${to}#${index}` scheme) of every connection that
 * is a "back edge": a self-loop, or a connection whose target is already an ancestor of its
 * source in the graph (contract: "Detect back edges... no schema change needed"). Standard DFS
 * back-edge detection — a connection closes a back edge exactly when its target is still on the
 * current recursion stack when the source is visited. Deterministic: steps and their outgoing
 * connections are always walked in `workflow.steps`/`workflow.connections` order.
 */
export function computeBackEdgeIds(workflow: Workflow): Set<string> {
  const stepIds = validStepIds(workflow);
  const backEdgeIds = new Set<string>();
  const adjacency = new Map<string, Array<{ to: string; edgeId: string }>>();

  workflow.connections.forEach((connection, index) => {
    if (!stepIds.has(connection.from) || !stepIds.has(connection.to)) {
      return;
    }
    const edgeId = connectionEdgeId(connection, index);
    if (connection.from === connection.to) {
      backEdgeIds.add(edgeId);
      return;
    }
    const list = adjacency.get(connection.from) ?? [];
    list.push({ to: connection.to, edgeId });
    adjacency.set(connection.from, list);
  });

  const state = new Map<string, "visiting" | "done">();
  function visit(stepId: string): void {
    state.set(stepId, "visiting");
    for (const { to, edgeId } of adjacency.get(stepId) ?? []) {
      const toState = state.get(to);
      if (toState === "visiting") {
        backEdgeIds.add(edgeId);
      } else if (toState === undefined) {
        visit(to);
      }
    }
    state.set(stepId, "done");
  }
  for (const step of workflow.steps) {
    if (!state.has(step.id)) {
      visit(step.id);
    }
  }

  return backEdgeIds;
}

export interface TracePath {
  /** The anchor plus every step reachable by one valid connection into or out of it. */
  stepIds: Set<string>;
  /** Every valid outgoing connection id from the anchor. Upstream connections remain dimmed so
   * the highlighted edges always show what happens next from the hovered/focused step. */
  edgeIds: Set<string>;
}

/**
 * A step's local upstream/downstream trace — the anchor, its immediate predecessors, and its
 * immediate successors. Edges are intentionally narrower than nodes: only the anchor's outgoing
 * connections are highlighted. This keeps a hover local and makes the highlighted arrows answer
 * the directional question "what happens next from here?" Pure: same `Workflow` and `stepId`
 * always produce the same result, no DOM, no randomness — kept that way so it stays unit-testable
 * on its own.
 */
export function computeTracePath(workflow: Workflow, stepId: string): TracePath {
  const stepIds = validStepIds(workflow);
  if (!stepIds.has(stepId)) {
    return { stepIds: new Set(), edgeIds: new Set() };
  }

  const resultSteps = new Set<string>([stepId]);
  for (const predecessorId of predecessorIds(workflow, stepId)) {
    resultSteps.add(predecessorId);
  }
  for (const successorId of successorIds(workflow, stepId)) {
    resultSteps.add(successorId);
  }

  const resultEdges = new Set<string>();
  workflow.connections.forEach((connection, index) => {
    if (connection.from !== stepId || !stepIds.has(connection.to)) {
      return;
    }
    resultEdges.add(connectionEdgeId(connection, index));
  });

  return { stepIds: resultSteps, edgeIds: resultEdges };
}
