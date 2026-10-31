import type { CSSProperties } from "react";
import styles from "./BuildingPreview.module.css";

interface PreviewCard {
  x: number;
  y: number;
  label: string;
  category: string;
  /** Rounded pill for an outcome, card otherwise. */
  pill?: boolean;
}

const CARDS: PreviewCard[] = [
  { x: 16, y: 58, label: "Receive", category: "entry" },
  { x: 186, y: 58, label: "Validate", category: "decision" },
  { x: 186, y: 150, label: "400", category: "failure", pill: true },
  { x: 356, y: 58, label: "Charge", category: "external" },
];
const W = 136;
const H = 52;

/** Edges in drawing order: each one is inked just before the card it leads to. */
const EDGES = [
  { d: `M${16 + W},84 L186,84`, to: 1, failure: false },
  { d: `M254,${58 + H} L254,150`, to: 2, failure: true },
  { d: `M${186 + W},84 L356,84`, to: 3, failure: false },
];

/**
 * A tiny map that keeps drawing itself, the way the real canvas does when the agent writes:
 * a cursor inks an edge, traces a card, and moves on. Decorative only; it loops while the page
 * waits for the first `.codehq` files, in the active scene's own card colours.
 */
export function BuildingPreview() {
  return (
    <svg className={styles.preview} viewBox="0 0 510 214" aria-hidden="true">
      {EDGES.map((edge) => (
        <path
          key={edge.d}
          d={edge.d}
          pathLength={1}
          className={`${styles.edge} ${edge.failure ? styles.failure : ""}`}
          style={{ "--i": edge.to } as CSSProperties}
        />
      ))}
      {CARDS.map((card, index) => (
        <g
          key={card.label}
          className={styles.card}
          style={{ "--i": index, "--accent": card.category === "failure" ? "var(--accent-red)" : `var(--cat-${card.category})` } as CSSProperties}
        >
          <rect
            x={card.x}
            y={card.y}
            width={W}
            height={card.pill ? 40 : H}
            rx={card.pill ? 20 : 9}
            pathLength={1}
            className={styles.outline}
          />
          {card.pill ? null : <rect x={card.x + 12} y={card.y + 12} width={12} height={12} rx={2} className={styles.chip} />}
          <text x={card.x + (card.pill ? 24 : 32)} y={card.y + (card.pill ? 25 : 23)} className={styles.label}>{card.label}</text>
          {card.pill ? null : <rect x={card.x + 12} y={card.y + 34} width={W - 48} height={5} rx={2.5} className={styles.line} />}
        </g>
      ))}
      <g className={styles.cursor}>
        {/* The canvas's agent cursor (AgentCursor.tsx), shifted so its tip sits on the origin. */}
        <path transform="translate(-3.6 -3)" d="M4.3 3.2C3.8 2.7 3 3.1 3 3.8L3.4 19.4C3.4 20.2 4.4 20.5 4.9 19.9L8.7 15.6C9 15.3 9.4 15.1 9.8 15.1L15.5 15.1C16.3 15.1 16.7 14.2 16.1 13.6Z" />
      </g>
    </svg>
  );
}
