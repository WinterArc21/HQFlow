import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowsOutSimple, X } from "@phosphor-icons/react";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { categoryToken } from "../../design/semantics";
import { IconButton } from "../primitives";
import { DataReferenceRow } from "../drawer/DataReferenceRow";
import { DrawerSection } from "../drawer/DrawerSection";
import { EdgeCaseItem } from "../drawer/EdgeCaseItem";
import { ExternalServiceItem } from "../drawer/ExternalServiceItem";
import { SourceReferenceRow } from "../drawer/SourceReferenceRow";
import { StepDrawerConnections } from "../drawer/StepDrawerConnections";
import { StepDrawerNotes } from "../drawer/StepDrawerNotes";
import { TestItem } from "../drawer/TestItem";
import styles from "./StepCard.module.css";

/** The card's fixed size in flow units: it never grows with its content, which scrolls instead. */
export const STEP_CARD_WIDTH = 404;
const STEP_CARD_HEIGHT = 300;

type Tab = "overview" | "source" | "edges" | "tests";

export interface StepCardProps {
  workflow: Workflow;
  step: WorkflowStep;
  /** Position within the walkable flow, for the "Step n of m" footer. */
  stepNumber: number;
  sourceChecks: Record<string, SourceStatus>;
  /** Where the card sits, in flow coordinates (it renders inside the React Flow viewport). */
  origin: { x: number; y: number };
  /** Grows from the node's right edge toward the left, when the node is at the board's edge. */
  growsLeft: boolean;
  onClose: () => void;
  onOpenFull: () => void;
  onWalk: (direction: -1 | 1) => void;
}

/**
 * The selected step, opened in place: the card grows out of its node on the canvas instead of a
 * separate panel. It has a fixed size and never reflows the board — it is drawn over it, so
 * neighbouring cards and every arrow stay exactly where they were — and its sections are tabs
 * that scroll inside the card. ← → walks the flow with the current tab kept; the ↗ button hands
 * a long step to the full side panel.
 */
export function StepCard({ workflow, step, stepNumber, sourceChecks, origin, growsLeft, onClose, onOpenFull, onWalk }: StepCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<Tab>("overview");
  const category = categoryToken(step.category);

  const inputs = step.inputs ?? [];
  const outputs = step.outputs ?? [];
  const sources = step.sources ?? [];
  const edgeCases = step.edgeCases ?? [];
  const tests = step.tests ?? [];
  const externalServices = step.externalServices ?? [];
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "source", label: "Source", count: sources.length },
    { id: "edges", label: "Edge cases", count: edgeCases.length },
    ...(tests.length > 0 ? [{ id: "tests" as const, label: "Tests", count: tests.length }] : []),
  ];
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : "overview";

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const target = event.target as HTMLElement;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && target.closest("input, textarea") === null) {
      event.preventDefault();
      onWalk(event.key === "ArrowRight" ? 1 : -1);
    }
  };

  return (
    <div
      ref={cardRef}
      className={`${styles.card} nodrag nopan nowheel`}
      style={{
        transform: `translate(${origin.x}px, ${origin.y}px)`,
        width: STEP_CARD_WIDTH,
        height: STEP_CARD_HEIGHT,
        transformOrigin: growsLeft ? "top right" : "top left",
        ["--step-accent" as string]: `var(${category.varName})`,
      }}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-step-card={step.id}
      onKeyDown={handleKeyDown}
    >
      <header className={styles.header}>
        <span className={styles.chip} aria-hidden="true">{String(stepNumber).padStart(2, "0")}</span>
        <h2 id={titleId} className={styles.title}>{step.name}</h2>
        <IconButton label="Open full step details" icon={<ArrowsOutSimple size={15} />} size="sm" onClick={onOpenFull} />
        <IconButton label="Close step details" icon={<X size={15} />} size="sm" onClick={onClose} />
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Step details">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === activeTab}
            className={styles.tab}
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
            {candidate.count !== undefined && candidate.count > 0 ? <span className={styles.count}>{candidate.count}</span> : null}
          </button>
        ))}
      </div>

      <div className={styles.body} role="tabpanel" aria-label={tabs.find((candidate) => candidate.id === activeTab)?.label}>
        {activeTab === "overview" ? (
          <>
            <p className={styles.purpose}>{step.purpose}</p>
            {inputs.length > 0 ? (
              <DrawerSection title="Inputs" count={inputs.length}>
                <ul className={styles.list}>{inputs.map((item, index) => <DataReferenceRow key={`${item.name}-${index}`} item={item} />)}</ul>
              </DrawerSection>
            ) : null}
            {outputs.length > 0 ? (
              <DrawerSection title="Outputs" count={outputs.length}>
                <ul className={styles.list}>{outputs.map((item, index) => <DataReferenceRow key={`${item.name}-${index}`} item={item} />)}</ul>
              </DrawerSection>
            ) : null}
            <StepDrawerNotes
              {...(step.details?.implementation !== undefined ? { implementation: step.details.implementation } : {})}
              decisions={step.details?.importantDecisions ?? []}
              assumptions={step.details?.assumptions ?? []}
            />
            {externalServices.length > 0 ? (
              <DrawerSection title="External services" count={externalServices.length}>
                <ul className={styles.list}>{externalServices.map((service, index) => <ExternalServiceItem key={`${service.name}-${index}`} service={service} />)}</ul>
              </DrawerSection>
            ) : null}
          </>
        ) : null}
        {activeTab === "source" ? (
          sources.length > 0
            ? <ul className={styles.list}>{sources.map((source, index) => <SourceReferenceRow key={`${source.file}-${index}`} source={source} sourceChecks={sourceChecks} />)}</ul>
            : <p className={styles.empty}>No source files mapped for this step.</p>
        ) : null}
        {activeTab === "edges" ? (
          edgeCases.length > 0
            ? <ul className={styles.list}>{edgeCases.map((edgeCase, index) => <EdgeCaseItem key={`${edgeCase.name}-${index}`} edgeCase={edgeCase} sourceChecks={sourceChecks} />)}</ul>
            : <p className={styles.empty}>No edge cases mapped for this step.</p>
        ) : null}
        {activeTab === "tests" ? (
          <ul className={styles.list}>{tests.map((test, index) => <TestItem key={`${test.file}-${index}`} test={test} />)}</ul>
        ) : null}
        <StepDrawerConnections
          workflow={workflow}
          incoming={workflow.connections.filter((connection) => connection.to === step.id)}
          outgoing={workflow.connections.filter((connection) => connection.from === step.id)}
        />
      </div>

      <footer className={styles.footer}>
        <span className={styles.kicker}>{category.label}</span>
        <span className={styles.hint} aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> walk the flow <kbd>Esc</kbd> close</span>
      </footer>
    </div>
  );
}
