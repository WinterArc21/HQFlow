import styles from "./EdgeMarkers.module.css";

const MARKER_VARIANTS = ["success", "success-outcome", "failure", "conditional", "async", "retry"] as const;
type MarkerVariant = (typeof MARKER_VARIANTS)[number];

const MARKER_CLASS_NAMES: Record<MarkerVariant, string | undefined> = {
  success: styles.markerSuccess,
  "success-outcome": styles.markerSuccessOutcome,
  failure: styles.markerFailure,
  conditional: styles.markerConditional,
  async: styles.markerAsync,
  retry: styles.markerRetry,
};

/** The SVG marker id for a connection visual (`undefined` maps to the `"success"` marker). */
export function edgeMarkerId(type: MarkerVariant | undefined): string {
  return `codehq-arrow-${type ?? "success"}`;
}

/**
 * One arrowhead `<marker>` per connection type/colour, defined once and shared by every edge via
 * `markerEnd="url(#codehq-arrow-<type>)"`. Coloured entirely through CSS classes that
 * reference `--accent-*` tokens (never a literal colour), matching `connectionStyle` (contract
 * §10's connection-type table).
 *
 * A small filled triangle. `markerUnits="userSpaceOnUse"` makes the 9x9 dimensions real canvas
 * units instead of SVG's default stroke-width multiples (which inflated these to roughly
 * 16-20px on the strengthened edges). Every connection type now gets the same quiet directional
 * cue without a large triangle competing with its line or destination node.
 *
 * `refX` sits behind the tip, so the point reaches about 2px past the path's end and covers the
 * line's round end cap; otherwise the cap shows as a small ball past the arrow's point.
 */
export function EdgeMarkers() {
  return (
    <svg className={styles.defs} aria-hidden="true">
      <defs>
        {MARKER_VARIANTS.map((variant) => (
          <marker
            key={variant}
            id={edgeMarkerId(variant)}
            viewBox="0 0 10 10"
            refX="6.5"
            refY="5"
            markerWidth="9"
            markerHeight="9"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M1,1.5 L9,5 L1,8.5 Z" className={MARKER_CLASS_NAMES[variant]} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
