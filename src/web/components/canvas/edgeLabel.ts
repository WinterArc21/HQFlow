/** The text a connection would actually render as a label (mirrors `WorkflowEdge.tsx`'s own
 * `showLabel` check: `label`, falling back to `condition`, and only when non-blank). */
export function connectionLabelText(connection: { label?: string | undefined; condition?: string | undefined }): string | undefined {
  const text = connection.label ?? connection.condition;
  return text !== undefined && text.trim().length > 0 ? text : undefined;
}

/** Width the rendered label pill takes, from `WorkflowEdge.module.css`'s `.label`: 11px monospace
 * text (estimated generously per character, like the outcome pill's width) clamped to 120px, plus
 * 8px padding and a 1px border on each side. Pure, so layout never measures the DOM. */
const LABEL_CHAR_WIDTH = 7;
const LABEL_TEXT_MAX_WIDTH = 120;
const LABEL_CHROME_WIDTH = 18;

export function estimateEdgeLabelWidth(text: string): number {
  return Math.min(LABEL_TEXT_MAX_WIDTH, text.length * LABEL_CHAR_WIDTH) + LABEL_CHROME_WIDTH;
}
