import type { Behavior, VerdictStatus } from "@schema/behavior";

/**
 * Lays a behavior out as a story tree, read top to bottom like the reference statecharts: each
 * moment appears once, the event is written on the arrow into it, and a moment with several next
 * events splits below a decision diamond. A transition to a moment that is already in the tree
 * (a loop, or a second way in) does not draw a long arrow back up: it ends on a small pill that
 * names that moment, so the map stays a tree.
 */

export const MOMENT_BOX = { width: 176, height: 56 };
export const JUMP_PILL = { width: 176, height: 40 };
/** Horizontal space between sibling subtrees. */
const SIBLING_GAP = 32;
/** From a moment's bottom edge to the top edge of the moments below it; fits a two-line label. */
const ROW_GAP = 100;
/** The start dot sits this far above the first moment. */
const START_GAP = 40;
const MARGIN = 24;
/** Room above the tree for the verdict key. */
export const KEY_SPACE = 40;
/** Below a moment with several next events: the diamond, then the bar that fans out to them. */
const DIAMOND_Y = 20;
const DIAMOND_HALF = 11;
const BAR_Y = 40;

export interface StoryNode {
  id: string;
  kind: "moment" | "jump";
  /** The moment the box shows, or the moment the jump pill goes to. */
  momentId: string;
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Jump pills only: true when the target is not deeper in the tree than the event's source. */
  back?: boolean;
}

export interface StoryEdge {
  id: string;
  /** An SVG path with right angles only. */
  path: string;
  arrow: boolean;
  label?: { x: number; y: number; text: string; verdict?: VerdictStatus };
}

export interface StoryTree {
  nodes: StoryNode[];
  edges: StoryEdge[];
  starts: Array<{ x: number; y: number }>;
  diamonds: Array<{ x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

interface TreeItem {
  id: string;
  momentId: string;
  kind: "moment" | "jump";
  depth: number;
  back?: boolean;
  /** The transition into this item, from its parent. */
  incoming?: { label: string; verdict?: VerdictStatus; index: number };
  children: TreeItem[];
  width: number;
  height: number;
  centerX: number;
}

export function layoutStoryTree(behavior: Behavior): StoryTree {
  const momentIds = new Set(behavior.moments.map((moment) => moment.id));
  const transitions = behavior.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => momentIds.has(transition.from) && momentIds.has(transition.to));
  const hasIncoming = new Set(transitions.map(({ transition }) => transition.to));
  const starts = behavior.moments.filter((moment) => moment.kind === "start");
  const rootOrder = [
    ...starts,
    ...behavior.moments.filter((moment) => moment.kind !== "start" && !hasIncoming.has(moment.id)),
    ...behavior.moments,
  ];

  // Breadth first, so each moment sits at the shallowest point where the story reaches it.
  const placed = new Map<string, TreeItem>();
  const roots: TreeItem[] = [];
  const item = (momentId: string, kind: TreeItem["kind"], depth: number, id = momentId): TreeItem => ({
    id, momentId, kind, depth, children: [], centerX: 0,
    width: kind === "moment" ? MOMENT_BOX.width : JUMP_PILL.width,
    height: kind === "moment" ? MOMENT_BOX.height : JUMP_PILL.height,
  });
  for (const root of rootOrder) {
    if (placed.has(root.id)) continue;
    const rootItem = item(root.id, "moment", 0);
    placed.set(root.id, rootItem);
    roots.push(rootItem);
    const queue = [rootItem];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const { transition, index } of transitions) {
        if (transition.from !== parent.momentId) continue;
        const incoming = { label: transition.label, index, ...(transition.verdict !== undefined ? { verdict: transition.verdict.status } : {}) };
        const known = placed.get(transition.to);
        if (known === undefined) {
          const child = { ...item(transition.to, "moment", parent.depth + 1), incoming };
          placed.set(transition.to, child);
          parent.children.push(child);
          queue.push(child);
        } else {
          parent.children.push({ ...item(transition.to, "jump", parent.depth + 1, `jump-${index}`), incoming, back: known.depth <= parent.depth });
        }
      }
    }
  }

  // Each subtree takes the width of its children side by side; a parent centres over them.
  const span = (node: TreeItem): number => {
    if (node.children.length === 0) return node.width;
    const total = node.children.reduce((sum, child) => sum + span(child), 0) + SIBLING_GAP * (node.children.length - 1);
    return Math.max(node.width, total);
  };
  const place = (node: TreeItem, left: number) => {
    const width = span(node);
    node.centerX = left + width / 2;
    const childrenWidth = node.children.reduce((sum, child) => sum + span(child), 0) + SIBLING_GAP * Math.max(0, node.children.length - 1);
    let x = node.centerX - childrenWidth / 2;
    for (const child of node.children) {
      place(child, x);
      x += span(child) + SIBLING_GAP;
    }
  };
  let left = MARGIN;
  for (const root of roots) {
    place(root, left);
    left += span(root) + SIBLING_GAP * 2;
  }

  const firstRowTop = MARGIN + KEY_SPACE + START_GAP;
  // Every box in a row shares its top edge, so the arrows into one row are the same length.
  const rowTop = (depth: number) => firstRowTop + depth * (MOMENT_BOX.height + ROW_GAP);
  const result: StoryTree = { nodes: [], edges: [], starts: [], diamonds: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 } };

  const visit = (node: TreeItem) => {
    const top = rowTop(node.depth);
    result.nodes.push({
      id: node.id, kind: node.kind, momentId: node.momentId,
      x: node.centerX - node.width / 2, y: top, width: node.width, height: node.height,
      ...(node.back !== undefined ? { back: node.back } : {}),
    });
    const bottom = top + node.height;
    const split = node.children.length > 1;
    if (split) {
      result.diamonds.push({ x: node.centerX, y: bottom + DIAMOND_Y });
      result.edges.push({ id: `${node.id}-split`, path: `M${node.centerX},${bottom} V${bottom + DIAMOND_Y - DIAMOND_HALF}`, arrow: false });
    }
    for (const child of node.children) {
      const childTop = rowTop(child.depth);
      const from = split ? bottom + DIAMOND_Y + DIAMOND_HALF : bottom;
      const bar = bottom + BAR_Y;
      const path = split
        ? `M${node.centerX},${from} V${bar} H${child.centerX} V${childTop}`
        : `M${node.centerX},${from} V${childTop}`;
      const incoming = child.incoming!;
      result.edges.push({
        id: `transition-${incoming.index}`,
        path,
        arrow: true,
        label: {
          x: child.centerX,
          y: split ? (bar + childTop) / 2 : (from + childTop) / 2,
          text: incoming.label,
          ...(incoming.verdict !== undefined ? { verdict: incoming.verdict } : {}),
        },
      });
      visit(child);
    }
  };
  roots.forEach((root, index) => {
    visit(root);
    // The start dot marks where the journey begins: the start moments, or the first root.
    const isStart = starts.some((moment) => moment.id === root.momentId) || (starts.length === 0 && index === 0);
    if (isStart) {
      const top = rowTop(0);
      result.starts.push({ x: root.centerX, y: top - START_GAP + 6 });
      result.edges.push({ id: `${root.id}-start`, path: `M${root.centerX},${top - START_GAP + 12} V${top}`, arrow: true });
    }
  });

  const maxX = Math.max(...result.nodes.map((node) => node.x + node.width)) + MARGIN;
  const maxY = Math.max(...result.nodes.map((node) => node.y + node.height)) + MARGIN;
  result.bounds = { minX: 0, minY: 0, maxX, maxY, width: maxX, height: maxY };
  return result;
}
