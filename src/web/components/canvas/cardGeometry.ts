/** Card geometry shared by live cursor travel and construction overlays. */
import type { CanvasFlowNode } from "./types";
import type { PresencePoint } from "./livePresence";

export const STEP_OUTLINE_RADIUS = 10;

export interface PresenceNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export function inboundPoint(box: PresenceNodeBox): PresencePoint {
  return { x: box.x, y: box.y + box.height / 2 };
}

export function outboundPoint(box: PresenceNodeBox): PresencePoint {
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

export function nodeBoxFromFlowNode(node: CanvasFlowNode): PresenceNodeBox | null {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width,
    height,
    radius: node.type === "outcome" ? height / 2 : STEP_OUTLINE_RADIUS,
  };
}

export function collectNodeBoxes(nodes: readonly CanvasFlowNode[]): Map<string, PresenceNodeBox> {
  const boxes = new Map<string, PresenceNodeBox>();
  for (const node of nodes) {
    const box = nodeBoxFromFlowNode(node);
    if (box !== null) {
      boxes.set(node.id, box);
    }
  }
  return boxes;
}
