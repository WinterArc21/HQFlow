import type { Workflow, WorkflowConnection } from "@schema/workflow";
import { connectionLabelText } from "../canvas/edgeLabel";
import { stepNameById } from "./connectionLookup";
import styles from "./StepDrawer.module.css";

export interface StepDrawerConnectionsProps {
  workflow: Workflow;
  incoming: WorkflowConnection[];
  outgoing: WorkflowConnection[];
}

function connectionKey(connection: WorkflowConnection): string {
  return connection.id ?? `${connection.from}-${connection.to}-${connection.type ?? "success"}`;
}

function describe(workflow: Workflow, connection: WorkflowConnection, direction: "from" | "to"): string {
  const name = stepNameById(workflow, direction === "from" ? connection.from : connection.to);
  const label = connectionLabelText(connection);
  return `${direction === "from" ? "From" : "To"} ${name}${label !== undefined ? `, when ${label}` : ""}`;
}

/**
 * Incoming and outgoing connections, for screen readers only. On the canvas the arrows already
 * are the connections, so a visible list repeated what a sighted reader sees; the arrows are
 * invisible to a screen reader, though, so the same facts stay in the accessibility tree as plain
 * text (no buttons, so nothing invisible ever takes keyboard focus). ← → on the step card walks
 * the flow for everyone.
 */
export function StepDrawerConnections({ workflow, incoming, outgoing }: StepDrawerConnectionsProps) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return null;
  }

  return (
    <section className={styles.visuallyHidden} aria-label="Connections">
      <h3>Connections</h3>
      <ul>
        {incoming.map((connection) => (
          <li key={`in-${connectionKey(connection)}`}>{describe(workflow, connection, "from")}</li>
        ))}
        {outgoing.map((connection) => (
          <li key={`out-${connectionKey(connection)}`}>{describe(workflow, connection, "to")}</li>
        ))}
      </ul>
    </section>
  );
}
